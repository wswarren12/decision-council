// council — the deliberation engine (PRD F-1), now hosted in this container.
//
// v1 of this app ran the engine as a Supabase Edge Function purely because the
// old PLN sandbox injected no secrets. The v1.3 kit's secrets flow injects
// ANTHROPIC_API_KEY as a regular env var at runtime, so the orchestration
// lives here and the Supabase middleman is retired.
//
// State is in-memory and session-scoped, matching the identity-less v1 UX
// (no saved history; a container restart forgets in-flight deliberations).
// Idempotent retry is preserved: completed advisor rounds are stored per
// deliberation and never re-run (AC-1.5).
//
// Actions (POST JSON {action, ...} to /api/council):
//   intake   {question}                          -> triage + one-line restatement
//   start    {question, restated, mode, attachments[]} -> deliberation + mapping
//   stage    {deliberation_id, stage:1|2|3}      -> SSE stream of stage progress
//   followup {deliberation_id, question}         -> Chairperson answers from record

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LETTERS,
  buildChairmanPrompt,
  buildDecisionTablePrompt,
  buildFollowupPrompt,
  buildIntakePrompt,
  buildResearchPrompt,
  buildPreamble,
  buildPreferencesBlock,
  buildStage1Prompt,
  buildStage2Prompt,
  confidenceSpread,
  extractConfidence,
  extractJson,
  fitAttachments,
  parseMemoryFromVerdict,
  randomMapping,
  sanitizeOpinion,
  stripMemoryBlock,
  validateDecisionTable,
} from './lib/council-core.mjs';
import { PERSONAS, PERSONA_KEYS } from './lib/personas.mjs';
import { addHistory, getPreferences, reserveRun } from './store.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const COUNCIL_MODEL = process.env.COUNCIL_MODEL || 'claude-opus-5';
const INTAKE_MODEL = process.env.INTAKE_MODEL || 'claude-haiku-4-5';
// Research pass compiles web findings — heavy on search, light on judgment.
const RESEARCH_MODEL = process.env.RESEARCH_MODEL || 'claude-sonnet-4-6';
const TABLE_MODEL = process.env.TABLE_MODEL || 'claude-sonnet-4-6';
const ANTHROPIC_TIMEOUT_MS = Math.max(1000, Number(process.env.ANTHROPIC_TIMEOUT_MS) || 180_000);
const DAILY_CALL_CAP = Number(process.env.DAILY_CALL_CAP || '500');

export function liveEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// ---------------------------------------------------------------------------
// Context pack (PRD F-5) — shipped with the app; version parsed from its header.
// ---------------------------------------------------------------------------

const PACK_PATH = join(dirname(fileURLToPath(import.meta.url)), 'context', 'pl-context-pack.md');
const PACK_BODY = readFileSync(PACK_PATH, 'utf8');
const PACK_VERSION = (PACK_BODY.match(/version\s+([\w.-]+)/i) || [])[1] || 'unversioned';
const PREAMBLE = buildPreamble(PACK_BODY, PACK_VERSION);

// Member preferences ride into every prompt of their deliberation — fenced
// and framed as data (buildPreferencesBlock) so they can never override the
// house rules or change the task.
function preambleFor(delib) {
  const block = buildPreferencesBlock(delib.preferences);
  return block ? `${PREAMBLE}\n\n${block}` : PREAMBLE;
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

// id -> { question, restated, mode, status, mapping, attachmentsText,
//         attachment_note, rounds: Map("stage:letter" -> content), memory }
const deliberations = new Map();

// Global daily call cap (F-6) — counts calls BEFORE spending them.
const usage = { date: '', calls: 0 };

function reserveCalls(calls) {
  const today = new Date().toISOString().slice(0, 10);
  if (usage.date !== today) { usage.date = today; usage.calls = 0; }
  if (usage.calls + calls > DAILY_CALL_CAP) {
    const err = new Error('daily_cap_reached');
    err.status = 429;
    throw err;
  }
  usage.calls += calls;
}

// ---------------------------------------------------------------------------
// Anthropic (raw Messages API; key comes from the LabOS secrets flow)
// ---------------------------------------------------------------------------

export async function anthropic(prompt, {
  model = COUNCIL_MODEL,
  maxTokens = 1600,
  tools = undefined,
  timeoutMs = ANTHROPIC_TIMEOUT_MS,
} = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error('no_api_key');
    err.status = 503;
    throw err;
  }
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
      ...(tools ? { tools } : {}),
    }),
    // Undici otherwise has a minutes-long headers timeout and no useful
    // application deadline. A stalled upstream must fail so retry/polling can
    // surface a paused state instead of spinning forever.
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401) {
    const err = new Error('invalid_api_key');
    err.status = 503;
    throw err;
  }
  if (!res.ok) throw new Error(`anthropic_${res.status}`);
  const body = await res.json();
  return (body?.content ?? []).filter((b) => b.type === 'text')
    .map((b) => b.text).join('\n');
}

// Retry-once wrapper (PRD error states: per-call retry-once).
async function withRetry(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e.status === 429 || e.status === 503) throw e; // cap/key problems don't retry
    return await fn();
  }
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleIntake(body) {
  const question = String(body.question ?? '').trim();
  if (!question || question.length > 4000) throw new Error('invalid_question');
  reserveCalls(1);
  const raw = await withRetry(() =>
    anthropic(buildIntakePrompt(question), { model: INTAKE_MODEL, maxTokens: 700 })
  );
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed.convene !== 'boolean') throw new Error('malformed_intake');
  return {
    convene: parsed.convene,
    restated: String(parsed.restated ?? question),
    suggest_quick: Boolean(parsed.suggest_quick),
    // Status-quo sufficiency gate: the council weighs proposals against the
    // real baseline, so the Chairperson asks for the current state and any
    // live alternatives when the submission doesn't carry them.
    needs_context: Boolean(parsed.needs_context) && Boolean(parsed.context_request),
    context_request: parsed.context_request ? String(parsed.context_request) : null,
    direct_answer: parsed.direct_answer ? String(parsed.direct_answer) : null,
  };
}

function handleStart(body, member) {
  const question = String(body.question ?? '').trim();
  const restated = String(body.restated ?? '').trim();
  const mode = body.mode === 'quick' ? 'quick' : 'full';
  if (!question || question.length > 4000) throw new Error('invalid_question');

  // Per-member daily cap (5 councils or tables). Anonymous visitors stay on
  // the global DAILY_CALL_CAP only.
  if (member) reserveRun(member.uid);

  const id = randomUUID();
  // Stage 0: randomized persona->letter mapping, server-side only (AC-1.4) —
  // the mapping never leaves this process.
  const mapping = randomMapping(PERSONA_KEYS);

  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  let attachmentsText = '';
  let attachmentNote = '';
  if (attachments.length) {
    const fitted = fitAttachments(attachments.map((a) => ({
      filename: String(a.filename ?? 'attachment').slice(0, 300),
      text: String(a.text ?? ''),
    })));
    attachmentsText = fitted.text;
    attachmentNote = fitted.note;
  }

  deliberations.set(id, {
    question,
    restated,
    mode,
    // 'table' = the decision-table-only path (silent council); 'council' =
    // the full visible deliberation. Recorded in the member's history.
    flow: body.flow === 'table' ? 'table' : 'council',
    owner: member?.uid ?? null,
    preferences: member ? getPreferences(member.uid) : '',
    status: 'created',
    mapping,
    attachmentsText,
    rounds: new Map(),
    memory: null,
  });

  return { deliberation_id: id, mode, attachment_note: attachmentNote };
}

function getDelib(id) {
  const delib = deliberations.get(String(id ?? ''));
  if (!delib) throw new Error('not_found');
  return delib;
}

function existingRounds(delib, stage) {
  const byLetter = {};
  for (const [key, content] of delib.rounds) {
    const [s, letter] = key.split(':');
    if (Number(s) === stage) byLetter[letter] = content;
  }
  return byLetter;
}

// Runs one stage, emitting SSE progress events on the Express response.
// Idempotent: letters that already have a stored round are not re-run — this
// is how retry resumes a paused council without re-spending completed calls.
async function handleStage(body, res) {
  const id = String(body.deliberation_id ?? '');
  const stage = Number(body.stage);
  if (!id || ![1, 2, 3].includes(stage)) {
    res.status(400).json({ error: 'bad_request' });
    return;
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // don't let a proxy buffer the stream
  });
  res.flushHeaders?.();
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  // Heartbeat: advisor calls can run minutes with no events, and the LabOS
  // gateway drops connections that go silent. A comment frame every 15s
  // keeps the stream alive for the whole stage.
  const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15_000);

  try {
    const delib = getDelib(id);
    if (stage === 2 && delib.mode === 'quick') throw new Error('quick_mode_has_no_stage2');
    delib.status = `stage${stage}_running`;
    send({ type: 'stage_started', stage });

    // Research pass (decision-table flow only): compile web research BEFORE
    // the advisors deliberate — referenced products (features / pricing /
    // reviews / market position) plus academic papers and reputable reporting
    // on the decision's subject matter. Cached like any round; a failure
    // degrades to no research rather than blocking the run.
    if (stage === 1 && delib.flow === 'table' && !delib.rounds.has('0:research')) {
      send({ type: 'research_started', stage: 1 });
      try {
        reserveCalls(1);
        const raw = await withRetry(() => anthropic(buildResearchPrompt(delib.question), {
          model: RESEARCH_MODEL,
          maxTokens: 2500,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
        }));
        const brief = /^\s*NO_RESEARCH\s*$/.test(raw.trim()) ? '' : raw.trim();
        delib.rounds.set('0:research', brief);
        send({ type: 'research_done', stage: 1, found: Boolean(brief) });
      } catch (e) {
        if (e.status === 429 || e.status === 503) throw e; // real stops still stop
        delib.rounds.set('0:research', ''); // degrade: deliberate without it
        send({ type: 'research_done', stage: 1, found: false });
      }
    }

    if (stage === 1 || stage === 2) {
      const done = existingRounds(delib, stage);
      const todo = LETTERS.filter((l) => !(l in done));
      for (const l of Object.keys(done)) send({ type: 'advisor_done', stage, letter: l, cached: true });
      if (todo.length) reserveCalls(todo.length);

      let round1 = {};
      if (stage === 2) {
        round1 = existingRounds(delib, 1);
        if (Object.keys(round1).length < 5) throw new Error('stage1_incomplete');
      }

      const results = await Promise.allSettled(todo.map(async (letter) => {
        const charter = PERSONAS[delib.mapping[letter]];
        const prompt = stage === 1
          ? buildStage1Prompt({
            preamble: preambleFor(delib),
            charter,
            question: delib.question,
            restated: delib.restated || delib.question,
            attachmentsText: delib.attachmentsText,
            // Stage-0 memory (F-3 history) is a v2 feature: v1 is
            // identity-less, so no member history exists to summarize.
            historySummary: '',
            isOutsider: delib.mapping[letter] === 'outsider',
            researchText: delib.rounds.get('0:research') || '',
          })
          : buildStage2Prompt({
            preamble: preambleFor(delib),
            charter,
            ownLetter: letter,
            ownOpinion: round1[letter],
            peers: LETTERS.filter((l) => l !== letter).map((l) => ({ letter: l, text: round1[l] })),
            restated: delib.restated || delib.question,
          });
        const raw = await withRetry(() => anthropic(prompt));
        // Sanitize ONCE at write time: peers and the DOM only ever see
        // scrubbed text (AC-1.2).
        delib.rounds.set(`${stage}:${letter}`, sanitizeOpinion(raw));
        send({ type: 'advisor_done', stage, letter });
        return letter;
      }));

      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length) {
        // A 4-advisor council is not a council: pause, let the client retry.
        const reason = failed[0].reason;
        throw reason instanceof Error ? reason : new Error(String(reason));
      }
      delib.status = `stage${stage}_complete`;
      send({ type: 'stage_complete', stage, rounds: existingRounds(delib, stage) });
    }

    if (stage === 3) {
      const sourceStage = delib.mode === 'quick' ? 1 : 2;
      const opinions = existingRounds(delib, sourceStage);
      if (Object.keys(opinions).length < 5) throw new Error(`stage${sourceStage}_incomplete`);
      let verdictRaw = delib.rounds.get('3:chair');
      if (!verdictRaw) {
        reserveCalls(1);
        verdictRaw = await withRetry(() =>
          anthropic(buildChairmanPrompt({
            preamble: preambleFor(delib),
            restated: delib.restated || delib.question,
            question: delib.question,
            opinions: LETTERS.map((l) => ({ letter: l, text: opinions[l] })),
            mode: delib.mode,
          }), { maxTokens: 2500 })
        );
        delib.rounds.set('3:chair', verdictRaw);
      }
      const memory = parseMemoryFromVerdict(verdictRaw);
      const display = sanitizeOpinion(stripMemoryBlock(verdictRaw));
      // Stage 4 — memory write (kept in-process; feeds v2 history).
      const confidences = LETTERS.map((l) => extractConfidence(opinions[l]));
      const spread = memory.confidence_spread ?? confidenceSpread(confidences);
      delib.memory = {
        verdict_line: memory.verdict ?? display.slice(0, 200),
        dissent_line: memory.dissent,
        confidence_spread: spread,
        first_step: memory.first_step,
        outcome: 'pending',
      };
      delib.status = 'complete';
      send({ type: 'verdict', stage: 3, content: display, confidence_spread: spread });
      send({ type: 'stage_complete', stage: 3 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = e?.status;
    try {
      const delib = deliberations.get(id);
      if (delib) delib.status = `stage${stage}_failed`;
    } catch { /* best-effort */ }
    send({
      type: 'stage_failed',
      stage,
      error: msg,
      retriable: status !== 429 && status !== 503,
      demo: status === 503,
      cap: status === 429,
    });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}

// Post-verdict: the Chairperson distills the deliberation into a decision
// table (Status Quo vs. the live options) for the member's Word download.
// Cached like any other round, so a retry never re-spends the call.
async function handleTable(body) {
  const id = String(body.deliberation_id ?? '');
  const delib = getDelib(id);
  const verdictRaw = delib.rounds.get('3:chair');
  if (!verdictRaw) throw new Error('no_verdict_yet');

  const cached = delib.rounds.get('4:table');
  if (cached) return { table: JSON.parse(cached) };

  // The Opus table call outlives the gateway's idle timeout on a silent JSON
  // response, so generation runs in the background and the client polls.
  // Every poll returns fast, and a dropped poll never double-spends the call.
  if (delib.tableJob?.error) {
    const e = delib.tableJob.error;
    delib.tableJob = null; // next poll restarts the draft
    throw e;
  }
  if (!delib.tableJob) {
    const job = { error: null };
    delib.tableJob = job;
    generateTable(id, delib, verdictRaw).catch((e) => { job.error = e; });
  }
  return { pending: true };
}

async function generateTable(id, delib, verdictRaw) {
  const sourceStage = delib.mode === 'quick' ? 1 : 2;
  const opinions = existingRounds(delib, sourceStage);
  reserveCalls(1);
  const table = await withRetry(async () => {
    const raw = await anthropic(buildDecisionTablePrompt({
      preamble: preambleFor(delib),
      restated: delib.restated || delib.question,
      question: delib.question,
      opinions: LETTERS.map((l) => ({ letter: l, text: opinions[l] })).filter((o) => o.text),
      verdict: stripMemoryBlock(verdictRaw),
      mode: delib.mode,
      researchText: delib.rounds.get('0:research') || '',
    }), { model: TABLE_MODEL, maxTokens: 3000 });
    const parsed = validateDecisionTable(extractJson(raw));
    if (!parsed) {
      // Structurally unusable output counts as a failed call: retry once.
      throw new Error('malformed_decision_table');
    }
    return parsed;
  });

  // Same write-time scrub as every advisor round: no charter names in cells.
  const clean = {
    ...table,
    title: sanitizeOpinion(table.title),
    decision_question: sanitizeOpinion(table.decision_question),
    recommendation_preview: sanitizeOpinion(table.recommendation_preview),
    columns: table.columns.map(sanitizeOpinion),
    rows: table.rows.map((r) => ({
      label: sanitizeOpinion(r.label),
      cells: r.cells.map(sanitizeOpinion),
    })),
    notes: (table.notes ?? []).map(sanitizeOpinion),
  };
  delib.rounds.set('4:table', JSON.stringify(clean));
  // Every completed run ends in a table — that's the history entry the
  // member can re-download later (.md/.docx via the stateless renderers).
  if (delib.owner) {
    addHistory(delib.owner, {
      id,
      kind: delib.flow,
      title: clean.title,
      created_at: new Date().toISOString(),
      table: clean,
    });
  }
}

async function handleFollowup(body) {
  const id = String(body.deliberation_id ?? '');
  const followup = String(body.question ?? '').trim();
  if (!id || !followup || followup.length > 4000) throw new Error('bad_request');
  const delib = getDelib(id);
  const verdictRaw = delib.rounds.get('3:chair');
  if (!verdictRaw) throw new Error('no_verdict_yet');

  const rounds = [];
  for (const [key, content] of delib.rounds) {
    const [s, letter] = key.split(':');
    if (Number(s) === 1 || Number(s) === 2) rounds.push({ stage: Number(s), letter, content });
  }
  rounds.sort((a, b) => a.stage - b.stage || a.letter.localeCompare(b.letter));

  reserveCalls(1);
  const answerRaw = await withRetry(() =>
    anthropic(buildFollowupPrompt({
      preamble: preambleFor(delib),
      restated: delib.restated || delib.question,
      verdict: stripMemoryBlock(verdictRaw),
      rounds,
      followupQuestion: followup,
    }), { maxTokens: 1000 })
  );
  return { answer: sanitizeOpinion(answerRaw) };
}

// ---------------------------------------------------------------------------
// Express entry point
// ---------------------------------------------------------------------------

export async function councilHandler(req, res) {
  const body = req.body ?? {};
  try {
    switch (body.action) {
      case 'intake':
        return res.json(await handleIntake(body));
      case 'start':
        return res.json(handleStart(body, req.member));
      case 'stage':
        return await handleStage(body, res);
      case 'table':
        return res.json(await handleTable(body));
      case 'followup':
        return res.json(await handleFollowup(body));
      default:
        return res.status(400).json({ error: 'unknown_action' });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = e?.status ?? 500;
    // Structured demo-mode signal (AC-6.1): missing/invalid key -> demo.
    if (msg === 'no_api_key' || msg === 'invalid_api_key') {
      return res.status(503).json({ error: msg, demo: true });
    }
    if (msg === 'daily_cap_reached') {
      return res.status(429).json({ error: msg, cap: DAILY_CALL_CAP });
    }
    if (msg === 'user_daily_cap') {
      return res.status(429).json({ error: msg, userCap: true });
    }
    return res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg });
  }
}
