// Decision Council SPA (F-2/F-4/F-6 client side).
//
// v1 runs IDENTITY-LESS: LabOS auth (F-7) and per-user history (F-3) are
// deferred to v2 (no JWT source is available yet), so there is no sign-in
// and no history rail. The browser talks ONLY to this container — the
// deliberation engine runs server-side at /api/council, holding the
// Anthropic key as a runtime env var (LabOS secrets flow).
// Advisors surface ONLY as Advisor A–E; persona names never exist client-side.

const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const $ = (sel) => document.querySelector(sel);
const thread = $('#thread');

const state = {
  config: null,
  session: 'live',          // 'live' | 'demo'
  mode: 'full',
  attachments: [],           // {filename, bytes, text, chars, words, warning}
  running: false,
  currentId: null,           // deliberation being run (session-only)
  demo: null,                // loaded fixture
};

// ---------------------------------------------------------------------------
// Rendering helpers (all model/LLM text is escaped before markdown-lite)
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Minimal markdown: headings, bold, italic, lists, paragraphs. Input is
// escaped first, so LLM output can't inject markup.
function mdLite(src) {
  const lines = esc(src).replace(/&lt;!--[\s\S]*?--&gt;/g, '').split(/\r?\n/);
  let html = '', inList = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (const line of lines) {
    const t = line.trim();
    if (!t) { closeList(); continue; }
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeList(); html += `<h3>${inline(h[2])}</h3>`; continue; }
    const li = t.match(/^[-*]\s+(.*)$/) || t.match(/^\d+[.)]\s+(.*)$/);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    closeList();
    html += `<p>${inline(t)}</p>`;
  }
  closeList();
  return html;
}
function inline(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)\*([^*]+)\*(?=\W|$)/g, '$1<em>$2</em>');
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function addToThread(node) {
  thread.appendChild(node);
  thread.scrollTop = thread.scrollHeight;
  return node;
}

function extractConfidence(text) {
  const m = [...String(text ?? '').matchAll(/confidence\s*[:\-]?\s*\(?\s*(high|medium|low)/gi)];
  return m.length ? m[m.length - 1][1].toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  try {
    state.config = await (await fetch('/api/config')).json();
    if (state.config.live) {
      state.session = 'live';
      setSessionChip('Session-only · saved history arrives in v2');
    } else {
      // The container reports no API key configured — demo mode up front.
      state.session = 'demo';
      setSessionChip('Demo mode');
      setBanner('The live council is unavailable right now (no API key configured). The example deliberation still shows the full experience.');
    }
  } catch {
    state.session = 'demo';
    setSessionChip('Demo mode');
    setBanner('Could not load app configuration. The example deliberation below still works.');
  }
  renderEmptyState();
}

function setSessionChip(label) {
  const chip = $('#session-chip');
  chip.textContent = label;
  chip.hidden = false;
}

function setBanner(text, actions = []) {
  const b = $('#banner');
  b.innerHTML = '';
  b.append(document.createTextNode(text));
  for (const { label, onClick } of actions) {
    const btn = el(`<button class="ghost-btn">${esc(label)}</button>`);
    btn.addEventListener('click', onClick);
    b.appendChild(btn);
  }
  b.hidden = !text;
}

// ---------------------------------------------------------------------------
// Council transport — same-origin /api/council on this container
// ---------------------------------------------------------------------------

async function council(body) {
  const res = await fetch('/api/council', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = {};
    try { detail = await res.json(); } catch { /* ignore */ }
    const err = new Error(detail.error || `request failed (${res.status})`);
    err.demo = Boolean(detail.demo);
    err.cap = res.status === 429;
    throw err;
  }
  return res.json();
}

// SSE-over-fetch for stage runs; calls onEvent per parsed event.
async function councilStage(deliberationId, stage, onEvent) {
  const res = await fetch('/api/council', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'stage', deliberation_id: deliberationId, stage }),
  });
  if (!res.ok || !res.body) {
    let detail = {};
    try { detail = await res.json(); } catch { /* ignore */ }
    const err = new Error(detail.error || `stage request failed (${res.status})`);
    err.demo = Boolean(detail.demo);
    err.cap = res.status === 429;
    throw err;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop();
    for (const part of parts) {
      const data = part.split('\n').filter((l) => l.startsWith('data: '))
        .map((l) => l.slice(6)).join('');
      if (!data) continue;
      try { onEvent(JSON.parse(data)); } catch { /* skip malformed frame */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Empty state / demo playback
// ---------------------------------------------------------------------------

function renderEmptyState() {
  thread.innerHTML = '';
  const node = el(`
    <div class="empty-state">
      <div class="glyphs">${LETTERS.map((l) => `<span class="letter-avatar">${l}</span>`).join('')}</div>
      <h2>Bring the council a judgment call</h2>
      <p>Five independent AI advisors — each with a different charter, all grounded in
      Protocol Labs' mission — deliberate your decision through blind opinions,
      anonymized peer review, and a Chairperson's verdict. You see arguments, not roles:
      advisors are only ever A through E.</p>
      <button class="pln-button" id="play-demo">Play an example deliberation</button>
      ${state.session === 'demo' ? '' : '<p style="margin-top:14px">…or type your decision below to convene a live council.</p>'}
    </div>`);
  addToThread(node);
  node.querySelector('#play-demo').addEventListener('click', playDemo);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function playDemo() {
  if (state.running) return;
  state.running = true;
  try {
    if (!state.demo) state.demo = await (await fetch('demo-deliberation.json')).json();
    const d = state.demo;
    thread.innerHTML = '';
    setBanner('This is a pre-recorded example deliberation — no live advisors are running.');
    addToThread(el(`<div class="bubble user">${esc(d.question)}</div>`));
    await sleep(500);
    addToThread(el(`<div class="bubble system"><strong>Restated for the record:</strong> ${esc(d.restated)}</div>`));

    const prog = renderStageProgress(d.mode);
    await sleep(700);

    prog.setStage(1, 'Round 1: blind opinions');
    const r1 = renderRoundBlock(1, 'Round 1 — Blind opinions');
    for (const l of LETTERS) {
      await sleep(650);
      r1.addCard(l, d.round1[l]);
      prog.tick(1, `Round 1: blind opinions · ${LETTERS.indexOf(l) + 1}/5 in`);
    }
    prog.completeStage(1);

    prog.setStage(2, 'Round 2: anonymized peer review');
    const r2 = renderRoundBlock(2, 'Round 2 — Revised after peer review');
    for (const l of LETTERS) {
      await sleep(600);
      r2.addCard(l, d.round2[l]);
      prog.tick(2, `Round 2: peer review · ${LETTERS.indexOf(l) + 1}/5 in`);
    }
    prog.completeStage(2);

    prog.setStage(3, "Chairperson: synthesizing the council's summary & verdict");
    await sleep(900);
    renderVerdict(d.verdict, d.mode, d.confidence_spread);
    prog.completeStage(3);

    if (d.decision_table) {
      prog.setStage(4, 'Chairperson: drafting the decision table');
      await sleep(800);
      renderDecisionTable(d.decision_table);
      prog.completeStage(4);
    }
    prog.done('Deliberation complete · decision table ready');

    await sleep(400);
    addToThread(el(`<div class="bubble followup-q">${esc(d.followup_example.q)}</div>`));
    await sleep(700);
    addToThread(el(`<div class="bubble system"><strong>Chairperson:</strong><div class="md">${mdLite(d.followup_example.a)}</div></div>`));
    addToThread(el(`<div class="bubble system">End of example. ${state.session === 'demo'
      ? 'Live councils are unavailable right now.'
      : 'Type your own decision below to convene a live council.'}</div>`));
  } finally {
    state.running = false;
  }
}

// ---------------------------------------------------------------------------
// Live deliberation UI pieces
// ---------------------------------------------------------------------------

function renderStageProgress(mode) {
  // Stage 4 is the Chairperson's decision table — every council that reaches
  // a verdict ends with one.
  const stages = mode === 'quick' ? [1, 3, 4] : [1, 2, 3, 4];
  const labels = { 1: 'R1', 2: 'R2', 3: '⚖', 4: '▦' };
  const node = addToThread(el(`
    <div class="stage-progress">
      <div class="pips">${stages.map((s) => `<span class="pip" data-stage="${s}">${labels[s]}</span>`).join('')}</div>
      <span class="stage-label" id="stage-label">Council convened<span class="thinking-dots"></span></span>
    </div>`));
  const label = node.querySelector('#stage-label');
  return {
    node,
    setStage(s, text) {
      node.querySelector(`[data-stage="${s}"]`)?.classList.add('working');
      label.innerHTML = `<strong>${esc(text)}</strong><span class="thinking-dots"></span>`;
    },
    tick(s, text) {
      label.innerHTML = `<strong>${esc(text)}</strong><span class="thinking-dots"></span>`;
    },
    completeStage(s) {
      const pip = node.querySelector(`[data-stage="${s}"]`);
      pip?.classList.remove('working');
      pip?.classList.add('done');
    },
    done(text) { label.innerHTML = esc(text); },
    fail(text) { label.innerHTML = `<strong>${esc(text)}</strong>`; },
  };
}

// Round-2 output carries exact `### Peer review` / `### Revised opinion`
// headings. The model WRITES peer reactions first (reacting primes a better
// revision), but members care most about the revised opinion — so the card
// DISPLAYS the revision first and the peer review below it.
function splitRound2(text) {
  const m = String(text ?? '').match(/###\s*Revised opinion\s*\n?/i);
  if (!m) return null;
  const revised = text.slice(m.index + m[0].length).trim();
  const peer = text.slice(0, m.index).replace(/###\s*Peer review\s*\n?/i, '').trim();
  return revised ? { revised, peer } : null;
}

function renderRoundBlock(stage, title) {
  const block = addToThread(el(`
    <div class="round-block" data-round="${stage}">
      <div class="round-title">${esc(title)}</div>
    </div>`));
  return {
    node: block,
    addCard(letter, text) {
      if (block.querySelector(`[data-letter="${letter}"]`)) return;
      const conf = extractConfidence(text);
      const split = stage === 2 ? splitRound2(text) : null;
      const bodyHtml = split
        ? `${mdLite(split.revised)}${split.peer
          ? `<div class="peer-review"><h4>Peer review of fellow advisors</h4>${mdLite(split.peer)}</div>` : ''}`
        : mdLite(text);
      const card = el(`
        <details class="advisor-card" data-letter="${esc(letter)}">
          <summary class="advisor-summary">
            <span class="letter-avatar">${esc(letter)}</span>
            <span class="advisor-name">Advisor ${esc(letter)}</span>
            ${conf ? `<span class="conf-chip">${esc(conf)} confidence</span>` : ''}
            <svg class="caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
          </summary>
          <div class="advisor-body md">${bodyHtml}</div>
        </details>`);
      // Keep letters in order regardless of arrival order.
      const cards = [...block.querySelectorAll('.advisor-card')];
      const after = cards.find((c) => c.dataset.letter > letter);
      block.insertBefore(card, after ?? null);
      thread.scrollTop = thread.scrollHeight;
    },
  };
}

const VERDICT_SECTIONS = [
  'Council direction', 'The question', 'Where the council converged',
  'Live disagreements', 'The verdict', 'First step', 'Biggest risk',
  'Unresolved questions',
];

function renderVerdict(text, mode, confidenceSpread) {
  // Split the markdown on the seven known headings.
  const sections = {};
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    const h = line.match(/^##\s+(.*)$/);
    if (h && VERDICT_SECTIONS.some((s) => h[1].trim().toLowerCase() === s.toLowerCase())) {
      current = h[1].trim();
      sections[current] = [];
    } else if (current) {
      sections[current].push(line);
    }
  }
  // The Council direction summary is split out into its OWN expandable card
  // so it reads as the Chairperson's voice in the thread — after Advisor E,
  // before the full verdict and the follow-up prompt. Open by default.
  const directionKey = Object.keys(sections).find((k) => k.toLowerCase() === 'council direction');
  if (directionKey) {
    addToThread(el(`
      <details class="advisor-card chair-card" open>
        <summary class="advisor-summary">
          <span class="letter-avatar chair-avatar">⚖</span>
          <span class="advisor-name">Chairperson — Council direction</span>
          ${confidenceSpread ? `<span class="conf-chip">${esc(confidenceSpread)}</span>` : ''}
          <svg class="caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
        </summary>
        <div class="advisor-body md">${mdLite(sections[directionKey].join('\n'))}</div>
      </details>`));
  }
  const body = VERDICT_SECTIONS
    .filter((name) => name !== 'Council direction')
    .map((name) => {
      const found = Object.keys(sections).find((k) => k.toLowerCase() === name.toLowerCase());
      if (!found) return '';
      const cls = name === 'The verdict' ? 'verdict-section the-verdict' : 'verdict-section';
      return `<div class="${cls}"><h4>${esc(name)}</h4><div class="md">${mdLite(sections[found].join('\n'))}</div></div>`;
    })
    .join('');
  const node = el(`
    <div class="verdict-card">
      <div class="verdict-band">
        <h3>Chairperson's Verdict</h3>
        <span class="verdict-mode">${mode === 'quick' ? 'Quick council' : 'Full council'}${confidenceSpread ? ` · ${esc(confidenceSpread)}` : ''}</span>
      </div>
      <div class="verdict-body">${body || `<div class="md">${mdLite(text)}</div>`}</div>
    </div>`);
  return addToThread(node);
}

function renderPaused(message, onRetry) {
  const node = addToThread(el(`
    <div class="paused-card">
      <strong>Council paused.</strong> ${esc(message)}
      <div class="confirm-row"><button class="ghost-btn">Retry this round</button></div>
    </div>`));
  node.querySelector('button').addEventListener('click', () => {
    node.remove();
    onRetry();
  });
  return node;
}

// ---------------------------------------------------------------------------
// Submit flow (intake → confirm → start → stages)
// ---------------------------------------------------------------------------

function inputError(msg) {
  const p = $('#input-error');
  p.textContent = msg || '';
  p.hidden = !msg;
}

async function onSubmit() {
  if (state.running) return;
  const q = $('#question').value.trim();
  if (!q) return inputError('Type the decision you want the council to deliberate.');
  if (q.length > 4000) return inputError(`That's ${q.length.toLocaleString()} characters — the limit is 4,000. Attach the detail as a document instead.`);
  inputError('');

  if (state.session === 'demo') {
    setBanner('Live councils are unavailable right now. Playing the example instead.');
    return playDemo();
  }

  state.running = true;
  $('#submit-btn').disabled = true;
  const emptyState = thread.querySelector('.empty-state');
  if (emptyState) thread.innerHTML = '';
  addToThread(el(`<div class="bubble user">${esc(q)}</div>`));
  const thinking = addToThread(el(`<div class="bubble system">Reading your question<span class="thinking-dots"></span></div>`));

  try {
    const intake = await council({ action: 'intake', question: q });
    thinking.remove();

    if (!intake.convene) {
      // Triage: factual/low-stakes → answer directly (AC-1.6). The turn is
      // over: release the running flag so the member can submit a new
      // question right away (the finally block re-enables the button).
      addToThread(el(`<div class="bubble system"><strong>The council isn't convening for this one.</strong><div class="md">${mdLite(intake.direct_answer || 'This reads as a factual question with a checkable answer rather than a judgment call.')}</div></div>`));
      $('#question').value = '';
      state.running = false;
      return;
    }

    // The intake may SUGGEST a quick council, but never switches the mode
    // itself — the member stays in control of the protocol they asked for.
    if (intake.suggest_quick && state.mode === 'full') {
      setBanner('This looks like a smaller call — a Quick council (no peer-review round) may serve. You’re set to Full.',
        [{ label: 'Switch to Quick', onClick: () => { setModeUI('quick'); setBanner(''); } }]);
    }

    // The council weighs every proposal against the true status quo. When
    // the submission doesn't describe the current state (or the other
    // alternatives in play), the Chairperson asks for it before convening.
    if (intake.needs_context && intake.context_request) {
      renderContextRequest(q, intake);
      return;
    }
    showConfirm(q, intake.restated);
  } catch (e) {
    thinking.remove();
    handleCouncilError(e);
    state.running = false;
    $('#submit-btn').disabled = false;
  } finally {
    if (!state.running) $('#submit-btn').disabled = false;
  }
}

function showConfirm(question, restated) {
  const confirm = addToThread(el(`
    <div class="bubble system">
      <strong>Restated for the record:</strong> ${esc(restated)}
      <div class="confirm-row">
        <button class="pln-button" data-act="confirm">Convene the council</button>
        <button class="ghost-btn" data-act="edit">Edit my question</button>
      </div>
    </div>`));
  confirm.querySelector('[data-act="edit"]').addEventListener('click', () => {
    confirm.remove();
    state.running = false;
    $('#submit-btn').disabled = false;
    $('#question').focus();
  });
  confirm.querySelector('[data-act="confirm"]').addEventListener('click', async () => {
    confirm.querySelector('.confirm-row').remove();
    await runDeliberation(question, restated);
  });
}

// The Chairperson's pre-deliberation request for the current state of things
// and any other alternatives being considered. One round only: if the member
// answers, intake re-reads the combined submission for a better restatement,
// but a second context request is never issued — assumptions land in the
// decision table's Notes row instead of an interrogation loop.
function renderContextRequest(originalQuestion, intake) {
  const node = addToThread(el(`
    <div class="bubble system context-request">
      <strong>Chairperson:</strong> Before the council convenes, it needs the baseline.
      <div class="md"><p>${esc(intake.context_request)}</p></div>
      <textarea class="context-answer" rows="3"
        placeholder="Describe the current state of things, and any other alternatives you're weighing…"
        aria-label="Current state and alternatives"></textarea>
      <div class="confirm-row">
        <button class="pln-button" data-act="send">Send to the council</button>
        <button class="ghost-btn" data-act="skip">Proceed without it</button>
      </div>
    </div>`));
  const finish = () => node.querySelector('.confirm-row').remove();
  node.querySelector('[data-act="skip"]').addEventListener('click', () => {
    finish();
    showConfirm(originalQuestion, intake.restated);
  });
  node.querySelector('[data-act="send"]').addEventListener('click', async () => {
    const answer = node.querySelector('.context-answer').value.trim();
    if (!answer) return showConfirm(originalQuestion, intake.restated);
    finish();
    node.querySelector('.context-answer').disabled = true;
    const combined = `${originalQuestion}\n\nCurrent state and alternatives (added at the Chairperson's request):\n${answer}`;
    if (combined.length > 4000) {
      // Stay inside the engine's question limit; the original restatement
      // still stands and the extra context rides along truncated.
      return showConfirm(combined.slice(0, 4000), intake.restated);
    }
    const thinking = addToThread(el(`<div class="bubble system">Re-reading with the added context<span class="thinking-dots"></span></div>`));
    try {
      const second = await council({ action: 'intake', question: combined });
      thinking.remove();
      // Never re-ask: even if intake still wants more, one round is the cap.
      showConfirm(combined, second.convene ? second.restated : intake.restated);
    } catch (e) {
      thinking.remove();
      if (e.demo || e.cap) {
        handleCouncilError(e);
        state.running = false;
        $('#submit-btn').disabled = false;
        return;
      }
      // The re-read is a nicety, not a gate — fall back to the original
      // restatement rather than stranding the member.
      showConfirm(combined, intake.restated);
    }
  });
}

function handleCouncilError(e) {
  if (e.demo) {
    setBanner('The live council is unavailable right now (no API key configured). The example deliberation still shows the full experience.',
      [{ label: 'Play example', onClick: playDemo }]);
  } else if (e.cap) {
    setBanner("Today's shared council budget has been used up — the daily limit resets at midnight UTC. The example deliberation is still available.",
      [{ label: 'Play example', onClick: playDemo }]);
  } else {
    addToThread(el(`<div class="bubble system"><strong>Something went wrong:</strong> ${esc(e.message)}. Your question wasn't lost — try again.</div>`));
  }
}

async function runDeliberation(question, restated) {
  const mode = state.mode;
  let started;
  try {
    started = await council({
      action: 'start',
      question,
      restated,
      mode,
      attachments: state.attachments.filter((a) => a.text),
    });
  } catch (e) {
    handleCouncilError(e);
    state.running = false;
    $('#submit-btn').disabled = false;
    return;
  }

  state.currentId = started.deliberation_id;
  if (started.attachment_note) {
    addToThread(el(`<div class="bubble system">${esc(started.attachment_note)}</div>`));
  }
  clearAttachments();
  $('#question').value = '';

  const prog = renderStageProgress(mode);
  const stages = mode === 'quick' ? [1, 3] : [1, 2, 3];
  const roundBlocks = {};

  const runStageAt = async (idx) => {
    const stage = stages[idx];
    const stageName = stage === 1 ? 'Round 1: blind opinions'
      : stage === 2 ? 'Round 2: anonymized peer review' : "Chairperson: synthesizing the council's summary & verdict";
    prog.setStage(stage, stageName);
    let seen = 0;
    let failed = null;

    try {
      await councilStage(state.currentId, stage, (ev) => {
        if (ev.type === 'advisor_done') {
          seen += 1;
          prog.tick(stage, `${stageName} · ${seen}/5 in`);
        } else if (ev.type === 'stage_complete' && ev.rounds) {
          if (!roundBlocks[stage]) {
            roundBlocks[stage] = renderRoundBlock(stage,
              stage === 1 ? 'Round 1 — Blind opinions' : 'Round 2 — Revised after peer review');
          }
          for (const l of LETTERS) if (ev.rounds[l]) roundBlocks[stage].addCard(l, ev.rounds[l]);
        } else if (ev.type === 'verdict') {
          renderVerdict(ev.content, mode, ev.confidence_spread);
        } else if (ev.type === 'stage_failed') {
          failed = ev;
        }
      });
    } catch (e) {
      failed = { error: e.message, demo: e.demo, cap: e.cap, retriable: !e.demo && !e.cap };
    }

    if (failed) {
      prog.fail(`${stageName} paused`);
      if (failed.demo || failed.cap) {
        handleCouncilError({ demo: failed.demo, cap: failed.cap, message: failed.error });
      }
      // Never a partial verdict: pause with retry (AC-1.5). Completed advisor
      // calls are cached server-side, so retry only re-runs what's missing.
      renderPaused(
        failed.cap ? 'The shared daily limit was reached mid-deliberation. Retry after the reset — completed opinions are saved.'
          : 'An advisor call failed. Completed opinions are saved; retrying only re-runs the missing ones.',
        () => runStageAt(idx),
      );
      return;
    }

    prog.completeStage(stage);
    if (idx + 1 < stages.length) {
      await runStageAt(idx + 1);
    } else {
      // Verdict is in — the Chairperson closes the council with the
      // decision table (stage 4), then follow-ups open.
      await runDecisionTable(prog, mode);
      state.running = false;
      $('#submit-btn').disabled = false;
      enableFollowup();
    }
  };

  await runStageAt(0);
}

// Stage 4: the Chairperson distills the record into a decision table. A
// failure here never touches the verdict above it — the member can retry
// the table on its own.
async function runDecisionTable(prog, mode) {
  prog.setStage(4, 'Chairperson: drafting the decision table');
  try {
    const { table } = await council({ action: 'table', deliberation_id: state.currentId });
    renderDecisionTable(table);
    prog.completeStage(4);
    prog.done(`Deliberation complete · ${mode === 'quick' ? 'Quick council (no peer-review round)' : 'Full council'} · decision table ready`);
  } catch (e) {
    prog.fail('Decision table paused');
    if (e.demo || e.cap) handleCouncilError(e);
    renderPaused(
      'Drafting the decision table failed. The verdict above is unaffected — retry to draft the table.',
      () => runDecisionTable(prog, mode),
    );
  }
}

// Renders the Chairperson's decision table in the thread with a Word-doc
// download. The table JSON stays client-side; the download posts it back to
// the stateless /api/decision-table.docx renderer.
function renderDecisionTable(table) {
  const header = ['Decision row', ...table.columns]
    .map((c, i) => `<th${i === 0 ? ' class="row-label"' : ''}>${esc(c)}</th>`).join('');
  const rows = table.rows.map((r) => `
    <tr${/recommendation/i.test(r.label) ? ' class="reco-row"' : ''}>
      <td class="row-label">${esc(r.label)}</td>
      ${r.cells.map((c) => `<td>${esc(c)}</td>`).join('')}
    </tr>`).join('');
  const node = el(`
    <div class="decision-table-card">
      <div class="verdict-band">
        <h3>Decision table</h3>
        <button class="pln-button dl-docx" type="button">Download Word doc</button>
      </div>
      <div class="dt-meta">
        <p><strong>${esc(table.title)}</strong></p>
        <p><strong>Decision question:</strong> ${esc(table.decision_question)}</p>
        ${table.recommendation_preview ? `<p><strong>Recommendation preview:</strong> ${esc(table.recommendation_preview)}</p>` : ''}
      </div>
      <div class="dt-scroll">
        <table class="decision-table">
          <thead><tr>${header}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`);
  node.querySelector('.dl-docx').addEventListener('click', () => downloadTableDocx(table, node.querySelector('.dl-docx')));
  return addToThread(node);
}

async function downloadTableDocx(table, btn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Preparing…';
  try {
    const res = await fetch('/api/decision-table.docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table }),
    });
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'decision-table.docx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch {
    inputError('The Word download failed — try the button again.');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

// ---------------------------------------------------------------------------
// Follow-ups (answered by the Chairperson from the stored record)
// ---------------------------------------------------------------------------

let followupMode = false;
function enableFollowup() {
  followupMode = true;
  $('#question').placeholder = 'Ask the Chairperson a follow-up on this verdict — or start a new decision…';
  $('#submit-btn').textContent = 'Ask';
  const note = el(`<div class="bubble system">You can now ask the Chairperson a follow-up (answered from the record, without re-convening) or clear the thread for a new decision. Saved decision history arrives in v2. <span class="confirm-row"><button class="ghost-btn">New decision</button></span></div>`);
  note.querySelector('button').addEventListener('click', resetForNew);
  addToThread(note);
}

function resetForNew() {
  followupMode = false;
  state.currentId = null;
  $('#question').placeholder = 'Bring the council a judgment call — take the partnership, kill the feature, restructure the deal…';
  $('#submit-btn').textContent = 'Convene';
  renderEmptyState();
}

async function onAsk() {
  if (!followupMode || !state.currentId) return onSubmit();
  const q = $('#question').value.trim();
  if (!q) return inputError('Type a follow-up question for the Chairperson.');
  if (q.length > 4000) return inputError('Follow-ups are limited to 4,000 characters.');
  inputError('');
  $('#question').value = '';
  addToThread(el(`<div class="bubble followup-q">${esc(q)}</div>`));
  const thinking = addToThread(el(`<div class="bubble system">The Chairperson is reviewing the record<span class="thinking-dots"></span></div>`));
  try {
    const { answer } = await council({ action: 'followup', deliberation_id: state.currentId, question: q });
    thinking.remove();
    addToThread(el(`<div class="bubble system"><strong>Chairperson:</strong><div class="md">${mdLite(answer)}</div></div>`));
  } catch (e) {
    thinking.remove();
    handleCouncilError(e);
  }
}

// ---------------------------------------------------------------------------
// Attachments (F-4)
// ---------------------------------------------------------------------------

function renderAttachmentChips() {
  const wrap = $('#attachment-chips');
  wrap.innerHTML = '';
  state.attachments.forEach((a, i) => {
    const size = a.bytes > 1024 * 1024 ? `${(a.bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(a.bytes / 1024)} KB`;
    const desc = a.warning ? a.warning : a.error ? a.error : `~${(a.words ?? 0).toLocaleString()} words included`;
    const chip = el(`
      <span class="chip${a.warning || a.error ? ' warn' : ''}">
        <strong>${esc(a.filename)}</strong> ${esc(size)} · ${esc(desc)}
        <button class="chip-x" aria-label="Remove ${esc(a.filename)}">✕</button>
      </span>`);
    chip.querySelector('.chip-x').addEventListener('click', () => {
      state.attachments.splice(i, 1);
      renderAttachmentChips();
    });
    wrap.appendChild(chip);
  });
}

function clearAttachments() {
  state.attachments = [];
  renderAttachmentChips();
}

async function onFilesChosen(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const pendingTotal = files.reduce((n, f) => n + f.size, 0)
    + state.attachments.reduce((n, a) => n + a.bytes, 0);
  if (pendingTotal > 20 * 1024 * 1024) {
    return inputError(`Attachments total ${(pendingTotal / 1024 / 1024).toFixed(1)} MB — the limit is 20 MB per deliberation.`);
  }
  inputError('');
  const form = new FormData();
  for (const f of files) form.append('files', f);
  const chipWrap = $('#attachment-chips');
  const pending = el('<span class="chip">Extracting text<span class="thinking-dots"></span></span>');
  chipWrap.appendChild(pending);
  try {
    const res = await fetch('/api/extract', { method: 'POST', body: form });
    const body = await res.json();
    pending.remove();
    if (!res.ok) return inputError(body.error || 'Upload failed.');
    for (const f of body.files) {
      if (f.error) inputError(`${f.filename}: ${f.error}`);
      else state.attachments.push(f);
    }
    renderAttachmentChips();
  } catch {
    pending.remove();
    inputError('Upload failed — check your connection and try again.');
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function setModeUI(mode) {
  state.mode = mode;
  document.querySelectorAll('.mode-opt').forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  });
}

document.querySelectorAll('.mode-opt').forEach((b) =>
  b.addEventListener('click', () => setModeUI(b.dataset.mode)));
$('#submit-btn').addEventListener('click', () => (followupMode ? onAsk() : onSubmit()));
$('#question').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (followupMode ? onAsk() : onSubmit());
});
$('#file-input').addEventListener('change', (e) => {
  onFilesChosen(e.target.files);
  e.target.value = '';
});

boot();
