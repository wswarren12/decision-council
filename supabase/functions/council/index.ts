// council — the deliberation engine (PRD F-1), a Supabase Edge Function.
//
// This is the ONLY place (with claude-proxy) that touches the Anthropic key
// and the ONLY place that reads the persona<->letter `mappings` table. The
// container and browser never see either (mappings is RLS-on/no-policy).
//
// Security layers mirror claude-proxy: verify_jwt at the gateway, Origin
// allowlist, and the global daily call cap via bump_usage() before every
// batch of LLM calls.
//
// Actions (POST JSON {action, ...}):
//   intake   {question}                          -> triage + one-line restatement
//   start    {question, restated, mode, attachments[]} -> deliberation + mapping
//   stage    {deliberation_id, stage:1|2|3}      -> SSE stream of stage progress
//   followup {deliberation_id, question}         -> Chairman answers from record

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  LETTERS,
  buildChairmanPrompt,
  buildFollowupPrompt,
  buildIntakePrompt,
  buildPreamble,
  buildStage1Prompt,
  buildStage2Prompt,
  confidenceSpread,
  extractConfidence,
  extractJson,
  fitAttachments,
  parseMemoryFromVerdict,
  randomMapping,
  relevantHistorySummary,
  sanitizeOpinion,
  stripMemoryBlock,
} from "./council-core.mjs";
import { PERSONAS, PERSONA_KEYS } from "./personas.mjs";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const COUNCIL_MODEL = Deno.env.get("COUNCIL_MODEL") ?? "claude-sonnet-4-6";
const INTAKE_MODEL = Deno.env.get("INTAKE_MODEL") ?? "claude-haiku-4-5-20251001";
const DAILY_CALL_CAP = Number(Deno.env.get("DAILY_CALL_CAP") ?? "500");

const ORIGIN_ALLOW = /^https:\/\/([a-z0-9-]+\.)*plnetwork\.io$/i;
const LOCAL_ALLOW = /^http:\/\/localhost(:\d+)?$/i;

function corsHeaders(origin: string | null): HeadersInit {
  const allowed = origin && (ORIGIN_ALLOW.test(origin) || LOCAL_ALLOW.test(origin));
  return {
    "Access-Control-Allow-Origin": allowed ? origin! : "https://plnetwork.io",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

// verify_jwt=true means the gateway already validated the signature; we only
// need the subject claim. Never log the token (AC-7.4).
//
// v1 runs IDENTITY-LESS (per-user history / LabOS auth deferred to v2): the
// public anon key is itself a valid project JWT with role "anon" and no
// subject, so it maps to the shared owner id "anonymous". Everything keyed
// on user identity (Stage-0 memory) is disabled for that id — one member's
// past deliberations must never surface in another's prompts.
const ANON_SUB = "anonymous";

function jwtSub(req: Request): string | null {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof payload.sub === "string" && payload.sub) return payload.sub;
    if (payload.role === "anon") return ANON_SUB;
    return null;
  } catch {
    return null;
  }
}

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

// Count calls against the global daily cap BEFORE spending them (F-6).
async function reserveCalls(db: ReturnType<typeof admin>, calls: number) {
  const { data: count, error } = await db.rpc("bump_usage", { p_calls: calls, p_tokens: 0 });
  if (error) throw new Error(`usage_check_failed: ${error.message}`);
  if (typeof count === "number" && count > DAILY_CALL_CAP) {
    const err = new Error("daily_cap_reached");
    (err as { status?: number }).status = 429;
    throw err;
  }
}

async function anthropic(
  db: ReturnType<typeof admin>,
  prompt: string,
  { model = COUNCIL_MODEL, maxTokens = 1600 } = {},
): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    const err = new Error("no_api_key");
    (err as { status?: number }).status = 503;
    throw err;
  }
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (res.status === 401) {
    const err = new Error("invalid_api_key");
    (err as { status?: number }).status = 503;
    throw err;
  }
  if (!res.ok) throw new Error(`anthropic_${res.status}`);
  const body = await res.json();
  const used = (body?.usage?.input_tokens ?? 0) + (body?.usage?.output_tokens ?? 0);
  if (used > 0) await db.rpc("bump_usage", { p_calls: 0, p_tokens: used });
  return (body?.content ?? []).filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text).join("\n");
}

// Retry-once wrapper (PRD error states: per-call retry-once).
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 429 || status === 503) throw e; // cap/key problems don't retry
    return await fn();
  }
}

async function loadContextPack(db: ReturnType<typeof admin>) {
  const { data, error } = await db.from("context_pack")
    .select("version, body").order("reviewed_at", { ascending: false, nullsFirst: false })
    .order("version", { ascending: false }).limit(1).single();
  if (error || !data) throw new Error("context_pack_missing");
  return data as { version: string; body: string };
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

async function handleIntake(db: ReturnType<typeof admin>, body: { question?: string }) {
  const question = String(body.question ?? "").trim();
  if (!question || question.length > 4000) throw new Error("invalid_question");
  await reserveCalls(db, 1);
  const raw = await withRetry(() =>
    anthropic(db, buildIntakePrompt(question), { model: INTAKE_MODEL, maxTokens: 700 })
  );
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed.convene !== "boolean") throw new Error("malformed_intake");
  return {
    convene: parsed.convene,
    restated: String(parsed.restated ?? question),
    suggest_quick: Boolean(parsed.suggest_quick),
    direct_answer: parsed.direct_answer ? String(parsed.direct_answer) : null,
  };
}

interface StartBody {
  question?: string;
  restated?: string;
  mode?: string;
  attachments?: { filename: string; bytes: number; text: string }[];
}

async function handleStart(db: ReturnType<typeof admin>, sub: string, body: StartBody) {
  const question = String(body.question ?? "").trim();
  const restated = String(body.restated ?? "").trim();
  const mode = body.mode === "quick" ? "quick" : "full";
  if (!question || question.length > 4000) throw new Error("invalid_question");

  const pack = await loadContextPack(db);
  const { data: delib, error } = await db.from("deliberations").insert({
    user_id: sub,
    question,
    restated,
    mode,
    status: "created",
    context_pack_version: pack.version,
  }).select("id").single();
  if (error || !delib) throw new Error(`create_failed: ${error?.message}`);

  // Stage 0: randomized persona->letter mapping, server-side only (AC-1.4).
  const mapping = randomMapping(PERSONA_KEYS);
  const rows = LETTERS.map((letter) => ({
    deliberation_id: delib.id,
    letter,
    persona: mapping[letter],
  }));
  const { error: mapErr } = await db.from("mappings").insert(rows);
  if (mapErr) throw new Error(`mapping_failed: ${mapErr.message}`);

  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  let attachmentNote = "";
  if (attachments.length) {
    const fitted = fitAttachments(attachments);
    attachmentNote = fitted.note;
    const { error: attErr } = await db.from("attachments").insert(
      attachments.map((a) => ({
        deliberation_id: delib.id,
        user_id: sub,
        filename: String(a.filename ?? "attachment").slice(0, 300),
        bytes: Number(a.bytes ?? 0),
        extracted_text: String(a.text ?? ""),
        extracted_chars: String(a.text ?? "").length,
      })),
    );
    if (attErr) throw new Error(`attachments_failed: ${attErr.message}`);
  }

  return { deliberation_id: delib.id, mode, attachment_note: attachmentNote };
}

interface DelibContext {
  delib: {
    id: string;
    question: string;
    restated: string;
    mode: string;
    status: string;
    user_id: string;
  };
  mapping: Record<string, string>;
  preamble: string;
  attachmentsText: string;
  historySummary: string;
}

async function loadDelib(db: ReturnType<typeof admin>, sub: string, id: string): Promise<DelibContext> {
  const { data: delib } = await db.from("deliberations").select("*").eq("id", id).single();
  if (!delib || delib.user_id !== sub) throw new Error("not_found");

  const { data: mapRows } = await db.from("mappings").select("letter, persona")
    .eq("deliberation_id", id);
  const mapping: Record<string, string> = {};
  for (const r of mapRows ?? []) mapping[r.letter] = r.persona;

  const pack = await loadContextPack(db);
  const preamble = buildPreamble(pack.body, pack.version);

  const { data: atts } = await db.from("attachments")
    .select("filename, extracted_text").eq("deliberation_id", id);
  const attachmentsText = (atts ?? []).length
    ? fitAttachments((atts ?? []).map((a) => ({ filename: a.filename, text: a.extracted_text ?? "" }))).text
    : "";

  // Stage-0 memory: this member's past decisions (excluding this one).
  // DISABLED for the shared anonymous identity — with one owner id, "past
  // decisions" would be every member's decisions (cross-member leakage).
  let historySummary = "";
  if (sub !== ANON_SUB) {
    const { data: mems } = await db.from("memory_blocks")
      .select("verdict_line, dissent_line, outcome, outcome_note, deliberation_id, deliberations!inner(question, created_at, user_id)")
      .eq("deliberations.user_id", sub)
      .neq("deliberation_id", id)
      .limit(25);
    const past = (mems ?? []).map((m) => ({
      question: (m.deliberations as unknown as { question: string }).question,
      created_at: (m.deliberations as unknown as { created_at: string }).created_at,
      verdict_line: m.verdict_line,
      outcome: m.outcome,
      outcome_note: m.outcome_note,
    }));
    historySummary = past.length ? relevantHistorySummary(delib.question, past) : "";
  }

  return { delib, mapping, preamble, attachmentsText, historySummary };
}

async function existingRounds(db: ReturnType<typeof admin>, id: string, stage: number) {
  const { data } = await db.from("rounds").select("letter, content")
    .eq("deliberation_id", id).eq("stage", stage);
  const byLetter: Record<string, string> = {};
  for (const r of data ?? []) byLetter[r.letter] = r.content;
  return byLetter;
}

// Runs one stage, emitting SSE progress events. Idempotent: letters that
// already have a stored round are not re-run (this is how retry resumes a
// paused council without re-spending completed calls — AC-1.5).
function handleStage(
  db: ReturnType<typeof admin>,
  sub: string,
  body: { deliberation_id?: string; stage?: number },
  origin: string | null,
): Response {
  const id = String(body.deliberation_id ?? "");
  const stage = Number(body.stage);
  if (!id || ![1, 2, 3].includes(stage)) return json({ error: "bad_request" }, 400, origin);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: Record<string, unknown>) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        const ctx = await loadDelib(db, sub, id);
        if (stage === 2 && ctx.delib.mode === "quick") throw new Error("quick_mode_has_no_stage2");
        await db.from("deliberations").update({ status: `stage${stage}_running` }).eq("id", id);
        send({ type: "stage_started", stage });

        if (stage === 1 || stage === 2) {
          const done = await existingRounds(db, id, stage);
          const todo = LETTERS.filter((l) => !(l in done));
          for (const l of Object.keys(done)) send({ type: "advisor_done", stage, letter: l, cached: true });
          if (todo.length) await reserveCalls(db, todo.length);

          let round1: Record<string, string> = {};
          if (stage === 2) {
            round1 = await existingRounds(db, id, 1);
            if (Object.keys(round1).length < 5) throw new Error("stage1_incomplete");
          }

          const results = await Promise.allSettled(todo.map(async (letter) => {
            const charter = PERSONAS[ctx.mapping[letter] as keyof typeof PERSONAS];
            const prompt = stage === 1
              ? buildStage1Prompt({
                preamble: ctx.preamble,
                charter,
                question: ctx.delib.question,
                restated: ctx.delib.restated || ctx.delib.question,
                attachmentsText: ctx.attachmentsText,
                historySummary: ctx.historySummary,
                isOutsider: ctx.mapping[letter] === "outsider",
              })
              : buildStage2Prompt({
                preamble: ctx.preamble,
                charter,
                ownLetter: letter,
                ownOpinion: round1[letter],
                peers: LETTERS.filter((l) => l !== letter).map((l) => ({ letter: l, text: round1[l] })),
                restated: ctx.delib.restated || ctx.delib.question,
              });
            const raw = await withRetry(() => anthropic(db, prompt));
            // Sanitize ONCE at write time: peers and the DOM only ever see
            // scrubbed text (AC-1.2).
            const content = sanitizeOpinion(raw);
            const { error } = await db.from("rounds").insert({
              deliberation_id: id, user_id: sub, stage, letter, content,
            });
            if (error) throw new Error(`round_write_failed: ${error.message}`);
            send({ type: "advisor_done", stage, letter });
            return letter;
          }));

          const failed = results.filter((r) => r.status === "rejected");
          if (failed.length) {
            // A 4-advisor council is not a council: pause, let the client retry.
            const reason = (failed[0] as PromiseRejectedResult).reason;
            throw reason instanceof Error ? reason : new Error(String(reason));
          }
          const rounds = await existingRounds(db, id, stage);
          await db.from("deliberations").update({ status: `stage${stage}_complete` }).eq("id", id);
          send({ type: "stage_complete", stage, rounds });
        }

        if (stage === 3) {
          const sourceStage = ctx.delib.mode === "quick" ? 1 : 2;
          const opinions = await existingRounds(db, id, sourceStage);
          if (Object.keys(opinions).length < 5) throw new Error(`stage${sourceStage}_incomplete`);
          const already = await existingRounds(db, id, 3);
          let verdictRaw: string;
          if (already.chair) {
            verdictRaw = already.chair;
          } else {
            await reserveCalls(db, 1);
            verdictRaw = await withRetry(() =>
              anthropic(db, buildChairmanPrompt({
                preamble: ctx.preamble,
                restated: ctx.delib.restated || ctx.delib.question,
                question: ctx.delib.question,
                opinions: LETTERS.map((l) => ({ letter: l, text: opinions[l] })),
                mode: ctx.delib.mode,
              }), { maxTokens: 2500 })
            );
          }
          const memory = parseMemoryFromVerdict(verdictRaw);
          const display = sanitizeOpinion(stripMemoryBlock(verdictRaw));
          if (!already.chair) {
            const { error } = await db.from("rounds").insert({
              deliberation_id: id, user_id: sub, stage: 3, letter: "chair", content: verdictRaw,
            });
            if (error) throw new Error(`round_write_failed: ${error.message}`);
          }
          // Stage 4 — memory write (not optional; a council without memory
          // is just a prompt).
          const confidences = LETTERS.map((l) => extractConfidence(opinions[l]));
          await db.from("memory_blocks").upsert({
            deliberation_id: id,
            user_id: sub,
            verdict_line: memory.verdict ?? display.slice(0, 200),
            dissent_line: memory.dissent,
            confidence_spread: memory.confidence_spread ?? confidenceSpread(confidences),
            first_step: memory.first_step,
            outcome: "pending",
          });
          await db.from("deliberations").update({ status: "complete" }).eq("id", id);
          send({ type: "verdict", stage: 3, content: display, confidence_spread: memory.confidence_spread ?? confidenceSpread(confidences) });
          send({ type: "stage_complete", stage: 3 });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const status = (e as { status?: number }).status;
        try {
          await db.from("deliberations").update({ status: `stage${stage}_failed` })
            .eq("id", String(body.deliberation_id));
        } catch { /* best-effort */ }
        send({
          type: "stage_failed",
          stage,
          error: msg,
          retriable: status !== 429 && status !== 503,
          demo: status === 503,
          cap: status === 429,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

async function handleFollowup(
  db: ReturnType<typeof admin>,
  sub: string,
  body: { deliberation_id?: string; question?: string },
) {
  const id = String(body.deliberation_id ?? "");
  const followup = String(body.question ?? "").trim();
  if (!id || !followup || followup.length > 4000) throw new Error("bad_request");
  const ctx = await loadDelib(db, sub, id);
  const { data: roundRows } = await db.from("rounds").select("stage, letter, content")
    .eq("deliberation_id", id).in("stage", [1, 2, 3]).order("stage");
  const verdictRow = (roundRows ?? []).find((r) => r.stage === 3);
  if (!verdictRow) throw new Error("no_verdict_yet");

  await reserveCalls(db, 1);
  const answerRaw = await withRetry(() =>
    anthropic(db, buildFollowupPrompt({
      preamble: ctx.preamble,
      restated: ctx.delib.restated || ctx.delib.question,
      verdict: stripMemoryBlock(verdictRow.content),
      rounds: (roundRows ?? []).filter((r) => r.stage !== 3),
      followupQuestion: followup,
    }), { maxTokens: 1000 })
  );
  const answer = sanitizeOpinion(answerRaw);
  await db.from("rounds").insert({
    deliberation_id: id,
    user_id: sub,
    stage: 4,
    letter: "chair",
    content: JSON.stringify({ q: followup, a: answer }),
  });
  return { answer };
}

// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);
  if (origin && !(ORIGIN_ALLOW.test(origin) || LOCAL_ALLOW.test(origin))) {
    return json({ error: "forbidden_origin" }, 403, origin);
  }

  const sub = jwtSub(req);
  if (!sub) return json({ error: "unauthorized" }, 401, origin);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400, origin);
  }

  const db = admin();
  try {
    switch (body.action) {
      case "intake":
        return json(await handleIntake(db, body), 200, origin);
      case "start":
        return json(await handleStart(db, sub, body as StartBody), 200, origin);
      case "stage":
        return handleStage(db, sub, body, origin);
      case "followup":
        return json(await handleFollowup(db, sub, body), 200, origin);
      default:
        return json({ error: "unknown_action" }, 400, origin);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = (e as { status?: number }).status ?? 500;
    // Structured demo-mode signal (AC-6.1): missing/invalid key -> demo.
    if (msg === "no_api_key" || msg === "invalid_api_key") {
      return json({ error: msg, demo: true }, 503, origin);
    }
    if (msg === "daily_cap_reached") {
      return json({ error: msg, cap: DAILY_CALL_CAP }, 429, origin);
    }
    return json({ error: msg }, status >= 400 && status < 600 ? status : 500, origin);
  }
});
