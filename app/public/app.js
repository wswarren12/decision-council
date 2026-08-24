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
  me: null,                  // {member:{uid,name}, preferences, usage} | null
  path: null,                // null (choosing) | 'council' | 'table'
  mode: 'full',
  attachments: [],           // {filename, bytes, text, chars, words, warning}
  running: false,
  currentId: null,           // deliberation being run (session-only)
  dt: null,                  // decision-table-only flow: {step, answers[]}
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
      setSessionChip('Live');
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
  // LabOS identity: signed-in members get a profile (preferences, history,
  // daily runs). Signed-out visitors keep the full anonymous experience.
  try {
    const me = await (await fetch('/api/me')).json();
    if (me.member) {
      state.me = me;
      const btn = $('#profile-btn');
      btn.textContent = me.member.name;
      btn.hidden = false;
    }
  } catch { /* signed out */ }
  renderChooser();
}

// ---------------------------------------------------------------------------
// Mode chooser — the first screen: full council vs. decision table only
// ---------------------------------------------------------------------------

function renderChooser() {
  followupMode = false;
  state.path = null;
  state.dt = null;
  state.currentId = null;
  clearAttachments();
  const composer = $('#composer');
  composer.hidden = true;
  composer.classList.remove('table-mode');
  thread.innerHTML = '';
  const node = el(`
    <div class="empty-state chooser">
      <div class="glyphs">${LETTERS.map((l) => `<span class="letter-avatar">${l}</span>`).join('')}</div>
      <h2>How do you want to work this decision?</h2>
      <div class="chooser-cards">
        <button type="button" class="chooser-card" data-path="council">
          <h3>Consult AI Council</h3>
          <p>Five independent AI advisors deliberate your decision — blind opinions,
          anonymized peer review, and a Chairperson's verdict you can question with
          follow-ups. Every council ends with a downloadable decision table.</p>
        </button>
        <button type="button" class="chooser-card" data-path="table">
          <h3>Generate Decision Table</h3>
          <p>Answer three quick questions and drop in any supporting documents.
          A silent council pressure-tests your options behind the scenes — you see
          only the finished decision table (.md and .docx).</p>
        </button>
      </div>
    </div>`);
  addToThread(node);
  node.querySelector('[data-path="council"]').addEventListener('click', chooseCouncil);
  node.querySelector('[data-path="table"]').addEventListener('click', chooseTable);
}

// ---------------------------------------------------------------------------
// Profile: preferences, daily usage, last-10 history with re-downloads
// ---------------------------------------------------------------------------

async function renderProfile() {
  if (!state.me?.member) return;
  followupMode = false;
  state.path = null;
  state.dt = null;
  const composer = $('#composer');
  composer.hidden = true;
  thread.innerHTML = '';

  const { member, preferences, usage } = state.me;
  const node = addToThread(el(`
    <div class="profile">
      <div class="bubble system">
        <strong>${esc(member.name)}</strong> · ${usage.cap - usage.used} of ${usage.cap} runs left today
        <span class="confirm-row"><button class="ghost-btn" data-act="back" type="button">← Back</button></span>
      </div>
      <div class="bubble system">
        <strong>Preferences</strong>
        <p class="profile-hint">Standing instructions the council and decision tables take into account — e.g. “we're a 6-person team, favor low-ops options, always weigh privacy impact”.</p>
        <textarea class="prefs-input" rows="4" maxlength="2000" placeholder="Anything the advisors should always consider…">${esc(preferences || '')}</textarea>
        <span class="confirm-row">
          <button class="pln-button" data-act="save" type="button">Save preferences</button>
          <span class="profile-saved" data-act="saved" hidden>Saved ✓</span>
        </span>
      </div>
      <div class="bubble system profile-history">
        <strong>History</strong>
        <p class="profile-hint">Your last 10 councils and tables — re-download any output.</p>
        <div data-act="list">Loading…</div>
      </div>
    </div>`));

  node.querySelector('[data-act="back"]').addEventListener('click', renderChooser);
  node.querySelector('[data-act="save"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const res = await fetch('/api/me/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: node.querySelector('.prefs-input').value }),
      });
      if (!res.ok) throw new Error('save failed');
      state.me = { member, ...(await res.json()), };
      state.me.member = member;
      const saved = node.querySelector('[data-act="saved"]');
      saved.hidden = false;
      setTimeout(() => { saved.hidden = true; }, 2000);
    } catch {
      setBanner('Saving preferences failed — try again.');
    } finally {
      btn.disabled = false;
    }
  });

  const list = node.querySelector('[data-act="list"]');
  try {
    const { history } = await (await fetch('/api/me/history')).json();
    if (!history.length) {
      list.textContent = 'No runs yet — your completed councils and tables will appear here.';
      return;
    }
    list.innerHTML = '';
    for (const h of history) {
      const when = new Date(h.created_at).toLocaleString();
      const row = el(`
        <div class="history-row">
          <span class="history-kind">${h.kind === 'table' ? '▦ Table' : '⚖ Council'}</span>
          <span class="history-title"><strong>${esc(h.title)}</strong><br><small>${esc(when)}</small></span>
          <span class="history-dl">
            <button class="ghost-btn" data-fmt="md" type="button">.md</button>
            <button class="ghost-btn" data-fmt="docx" type="button">.docx</button>
          </span>
        </div>`);
      for (const btn of row.querySelectorAll('[data-fmt]')) {
        btn.addEventListener('click', () => downloadTable(h.table, btn, btn.dataset.fmt));
      }
      list.appendChild(row);
    }
  } catch {
    list.textContent = 'Could not load history — try again later.';
  }
}

function chooseCouncil() {
  state.path = 'council';
  const composer = $('#composer');
  composer.hidden = false;
  composer.classList.remove('table-mode');
  $('#question').placeholder = 'Bring the council a judgment call — take the partnership, kill the feature, restructure the deal…';
  $('#submit-btn').textContent = 'Convene';
  renderEmptyState();
}

function chooseTable() {
  if (state.session === 'demo') {
    setBanner('The decision-table generator needs the live council, which is unavailable right now (no API key configured). The example deliberation still shows the full experience.',
      [{ label: 'Play example', onClick: () => { chooseCouncil(); playDemo(); } }]);
    return;
  }
  state.path = 'table';
  state.dt = { step: 0, answers: [] };
  const composer = $('#composer');
  composer.hidden = false;
  composer.classList.add('table-mode');
  $('#submit-btn').textContent = 'Send';
  setBanner('');
  thread.innerHTML = '';
  addToThread(el(`<div class="bubble system">Three questions, then a decision table. A silent council reviews your options before the table is drafted — only the table is shown. <span class="confirm-row"><button class="ghost-btn" type="button">← Different mode</button></span></div>`))
    .querySelector('button').addEventListener('click', renderChooser);
  askDtQuestion(0);
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

async function council(body, signal) {
  const res = await fetch('/api/council', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let detail = {};
    try { detail = await res.json(); } catch { /* ignore */ }
    const err = new Error(detail.error || `request failed (${res.status})`);
    err.demo = Boolean(detail.demo);
    err.userCap = Boolean(detail.userCap);
    err.cap = res.status === 429 && !err.userCap;
    throw err;
  }
  return res.json();
}

// The decision table drafts in the background server-side (a single silent
// long response would hit the gateway's idle timeout); poll until it's ready.
// Bound both each poll and the whole draft so a dead proxy/upstream becomes a
// retriable paused state instead of an endless spinner.
async function councilTable(deliberationId) {
  const deadline = Date.now() + 7 * 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await council(
        { action: 'table', deliberation_id: deliberationId },
        AbortSignal.timeout(15_000),
      );
      if (res.table) return res;
    } catch (e) {
      if (e.name !== 'TimeoutError' && e.name !== 'AbortError') throw e;
    }
    await sleep(2500);
  }
  throw new Error('decision_table_timeout');
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
      <p><button class="ghost-btn" id="back-chooser" type="button">← Different mode</button></p>
    </div>`);
  addToThread(node);
  node.querySelector('#play-demo').addEventListener('click', playDemo);
  node.querySelector('#back-chooser').addEventListener('click', renderChooser);
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

function buildErrorReport(context, error) {
  return [
    'PLN Decision Council error report',
    `Time: ${new Date().toISOString()}`,
    `Phase: ${context}`,
    state.currentId ? `Deliberation ID: ${state.currentId}` : '',
    `Error: ${String(error?.message || error || 'unknown_error').slice(0, 1000)}`,
  ].filter(Boolean).join('\n');
}

async function copyErrorReport(btn, report) {
  try {
    await navigator.clipboard.writeText(report);
    btn.textContent = 'Error copied';
  } catch {
    // Clipboard access can be blocked by an iframe permissions policy; the
    // native prompt still gives the member selectable report text.
    window.prompt('Copy this error report:', report);
  }
}

function renderPaused(message, onRetry, error) {
  const report = buildErrorReport(message, error);
  const node = addToThread(el(`
    <div class="paused-card">
      <strong>Council paused.</strong> ${esc(message)}
      <div class="confirm-row">
        <button class="ghost-btn" data-act="retry">Retry this round</button>
        <button class="ghost-btn" data-act="copy-error">Copy error to report</button>
      </div>
    </div>`));
  node.querySelector('[data-act="retry"]').addEventListener('click', () => {
    node.remove();
    onRetry();
  });
  node.querySelector('[data-act="copy-error"]').addEventListener('click', (e) => copyErrorReport(e.currentTarget, report));
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
  if (e.userCap) {
    setBanner('You’ve used your 5 councils or decision tables for today — your limit resets at midnight UTC. Past outputs stay downloadable from your profile.');
    state.running = false;
    $('#submit-btn').disabled = false;
  } else if (e.demo) {
    const report = buildErrorReport('Starting the live council', e);
    setBanner('The live council is unavailable right now (no API key configured). The example deliberation still shows the full experience.', [
      { label: 'Play example', onClick: playDemo },
      { label: 'Copy error to report', onClick: (event) => copyErrorReport(event.currentTarget, report) },
    ]);
  } else if (e.cap) {
    setBanner("Today's shared council budget has been used up — the daily limit resets at midnight UTC. The example deliberation is still available.",
      [{ label: 'Play example', onClick: playDemo }]);
  } else {
    const report = buildErrorReport('Council request', e);
    const node = addToThread(el(`<div class="bubble system"><strong>Something went wrong:</strong> ${esc(e.message)}. Your question wasn't lost — try again.<div class="confirm-row"><button class="ghost-btn" data-act="copy-error">Copy error to report</button></div></div>`));
    node.querySelector('[data-act="copy-error"]').addEventListener('click', (event) => copyErrorReport(event.currentTarget, report));
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

  const runStageAt = async (idx, attempt = 0) => {
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
      // Auto-retry once before pausing — completed calls are cached, so this
      // only re-runs what's missing.
      if (!failed.demo && !failed.cap && attempt < 1) return runStageAt(idx, attempt + 1);
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
        failed.error,
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
    const { table } = await councilTable(state.currentId);
    renderDecisionTable(table);
    prog.completeStage(4);
    prog.done(`Deliberation complete · ${mode === 'quick' ? 'Quick council (no peer-review round)' : 'Full council'} · decision table ready`);
  } catch (e) {
    prog.fail('Decision table paused');
    if (e.demo || e.cap) handleCouncilError(e);
    renderPaused(
      'Drafting the decision table failed. The verdict above is unaffected — retry to draft the table.',
      () => runDecisionTable(prog, mode),
      e,
    );
  }
}

// Renders the Chairperson's decision table in the thread with a Word-doc
// download. The table JSON stays client-side; the download posts it back to
// the stateless /api/decision-table.docx renderer.
function renderDecisionTable(table) {
  // Notes render BELOW the grid. Older payloads (demo fixture) still carry a
  // notes row — pull it out here so both shapes display the same way.
  const notes = [...(table.notes ?? [])];
  const gridRows = table.rows.filter((r) => {
    if (!/notes|open questions/i.test(r.label)) return true;
    for (const c of r.cells) if (c && c !== '—' && !notes.includes(c)) notes.push(c);
    return false;
  });
  const header = ['Decision row', ...table.columns]
    .map((c, i) => `<th${i === 0 ? ' class="row-label"' : ''}>${esc(c)}</th>`).join('');
  const rows = gridRows.map((r) => `
    <tr${/recommendation/i.test(r.label) ? ' class="reco-row"' : ''}>
      <td class="row-label">${esc(r.label)}</td>
      ${r.cells.map((c, i) => `<td${r.ratings?.[i] ? ` class="rate-${r.ratings[i]}"` : ''}>${esc(c)}</td>`).join('')}
    </tr>`).join('');
  const node = el(`
    <div class="decision-table-card">
      <div class="verdict-band">
        <h3>Decision table</h3>
        <span class="dl-group">
          <button class="ghost-btn dl-md" type="button">Download Markdown</button>
          <button class="pln-button dl-docx" type="button">Download Word doc</button>
        </span>
      </div>
      <div class="dt-meta">
        <p><strong>${esc(table.title)}</strong></p>
        <p><strong>Decision question:</strong> ${esc(table.decision_question)}</p>
        ${table.situation ? `<p><strong>Situation:</strong> ${esc(table.situation)}</p>` : ''}
        ${table.recommendation_preview ? `<p><strong>Recommendation preview:</strong> ${esc(table.recommendation_preview)}</p>` : ''}
      </div>
      <div class="dt-scroll">
        <table class="decision-table">
          <thead><tr>${header}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${notes.length ? `<div class="dt-notes"><h4>Notes / open questions</h4><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
    </div>`);
  node.querySelector('.dl-docx').addEventListener('click', () => downloadTable(table, node.querySelector('.dl-docx'), 'docx'));
  node.querySelector('.dl-md').addEventListener('click', () => downloadTable(table, node.querySelector('.dl-md'), 'md'));
  return addToThread(node);
}

// Stateless downloads: the table JSON is posted back to the matching server
// renderer (/api/decision-table.docx or .md).
async function downloadTable(table, btn, format) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Preparing…';
  try {
    const res = await fetch(`/api/decision-table.${format}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table }),
    });
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `decision-table.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch {
    inputError('The download failed — try the button again.');
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
  const note = el(`<div class="bubble system">You can now ask the Chairperson a follow-up (answered from the record, without re-convening) or clear the thread for a new decision.${state.me ? ' The decision table is saved to your profile history.' : ''} <span class="confirm-row"><button class="ghost-btn">New decision</button></span></div>`);
  note.querySelector('button').addEventListener('click', resetForNew);
  addToThread(note);
}

function resetForNew() {
  renderChooser();
}

// ---------------------------------------------------------------------------
// Decision-table-only flow: three scripted questions → confirm → silent
// council (quick protocol, nothing rendered) → the table + .md/.docx
// ---------------------------------------------------------------------------

const DT_QUESTIONS = [
  "What's the goal?",
  'What are the options you’re deciding between?',
  'Any other information or background that would be helpful? (note: add any supporting documents below)',
];
const DT_PLACEHOLDERS = [
  'Describe the goal this decision serves…',
  'List the options — the real current path counts as one…',
  'Constraints, history, context — or leave blank and hit Send…',
];

function askDtQuestion(step) {
  state.dt.step = step;
  addToThread(el(`<div class="bubble system"><strong>${esc(DT_QUESTIONS[step])}</strong></div>`));
  const q = $('#question');
  q.placeholder = DT_PLACEHOLDERS[step];
  q.focus();
}

function onDtSubmit() {
  if (state.running || !state.dt) return;
  const q = $('#question');
  const text = q.value.trim();
  const step = state.dt.step;
  if (step > 2) return; // questions done — waiting on the confirm card
  if (!text && step === 0) return inputError('Describe the goal first.');
  if (!text && step === 1) return inputError('List the options you’re deciding between.');
  if (text.length > 3000) return inputError('Keep each answer under 3,000 characters — attach the detail as a document instead.');
  inputError('');
  q.value = '';
  addToThread(el(`<div class="bubble user">${text ? esc(text) : '<em>Nothing to add.</em>'}</div>`));
  state.dt.answers[step] = text;
  if (step < 2) return askDtQuestion(step + 1);
  showDtConfirm();
}

function showDtConfirm() {
  state.dt.step = 3; // past the questions; submits are ignored until confirm/restart
  $('#question').placeholder = 'Confirm below — you can still attach documents first…';
  const [goal, options, background] = state.dt.answers;
  const node = addToThread(el(`
    <div class="bubble system">
      <strong>Ready to generate the decision table?</strong>
      <div class="md">
        <p><strong>Goal:</strong> ${esc(goal)}</p>
        <p><strong>Options:</strong> ${esc(options)}</p>
        <p><strong>Background:</strong> ${esc(background || 'none provided')}</p>
        <p><strong>Supporting documents:</strong> ${state.attachments.filter((a) => a.text).length || 'none'} — add more below before confirming if needed.</p>
      </div>
      <div class="confirm-row">
        <button class="pln-button" data-act="go">Generate decision table</button>
        <button class="ghost-btn" data-act="restart">Start over</button>
      </div>
    </div>`));
  node.querySelector('[data-act="restart"]').addEventListener('click', () => { clearAttachments(); chooseTable(); });
  node.querySelector('[data-act="go"]').addEventListener('click', async () => {
    node.querySelector('.confirm-row').remove();
    await runTableOnly();
  });
}

function composeDtQuestion() {
  const [goal, options, background] = state.dt.answers;
  const parts = [`Goal: ${goal}`, `Options under consideration: ${options}`];
  if (background) parts.push(`Additional background: ${background}`);
  // Engine question cap is 4,000 chars; overflow rides in as attachments.
  return parts.join('\n\n').slice(0, 4000);
}

async function runTableOnly() {
  if (state.running) return;
  state.running = true;
  $('#submit-btn').disabled = true;
  let started;
  try {
    started = await council({
      action: 'start',
      question: composeDtQuestion(),
      restated: `Choose among the stated options to achieve the goal: ${state.dt.answers[0]}`.slice(0, 500),
      mode: 'quick', // silent pass: blind opinions + chair verdict, no peer-review round
      flow: 'table', // recorded as a decision table in the member's history
      attachments: state.attachments.filter((a) => a.text),
    });
  } catch (e) {
    handleCouncilError(e);
    state.running = false;
    $('#submit-btn').disabled = false;
    return;
  }
  state.currentId = started.deliberation_id;
  if (started.attachment_note) addToThread(el(`<div class="bubble system">${esc(started.attachment_note)}</div>`));
  clearAttachments();

  const prog = renderStageProgress('quick');
  const silentStages = [
    { stage: 1, label: 'Silent council: five advisors weighing the options' },
    { stage: 3, label: 'Silent council: chair synthesizing the deliberation' },
  ];
  const runAt = async (idx, attempt = 0) => {
    const { stage, label } = silentStages[idx];
    prog.setStage(stage, label);
    let seen = 0;
    let failed = null;
    try {
      await councilStage(state.currentId, stage, (ev) => {
        // Silent by design: rounds and the verdict are never rendered here.
        if (ev.type === 'research_started') prog.tick(stage, 'Researching · referenced products, papers & reputable reporting');
        else if (ev.type === 'research_done') prog.tick(stage, ev.found ? `${label} · research in hand` : label);
        else if (ev.type === 'advisor_done') { seen += 1; prog.tick(stage, `${label} · ${seen}/5 in`); }
        else if (ev.type === 'stage_failed') failed = ev;
      });
    } catch (e) {
      failed = { error: e.message, demo: e.demo, cap: e.cap };
    }
    if (failed) {
      if (!failed.demo && !failed.cap && attempt < 1) return runAt(idx, attempt + 1);
      prog.fail(`${label} paused`);
      if (failed.demo || failed.cap) handleCouncilError({ demo: failed.demo, cap: failed.cap, message: failed.error });
      renderPaused('A silent-council call failed. Completed work is saved; retrying only re-runs what’s missing.', () => runAt(idx), failed.error);
      return;
    }
    prog.completeStage(stage);
    if (idx + 1 < silentStages.length) return runAt(idx + 1);
    await finishTableOnly(prog);
  };
  await runAt(0);
}

async function finishTableOnly(prog) {
  prog.setStage(4, 'Drafting the decision table');
  try {
    const { table } = await councilTable(state.currentId);
    renderDecisionTable(table);
    prog.completeStage(4);
    prog.done('Decision table ready — download it as Markdown or Word.');
    state.running = false;
    $('#submit-btn').disabled = false;
    const note = el(`
      <div class="bubble system">Done.
        <span class="confirm-row">
          <button class="pln-button" data-act="new" type="button">Generate New Decision Table</button>
          <button class="ghost-btn" data-act="md" type="button">Download Markdown</button>
          <button class="ghost-btn" data-act="docx" type="button">Download Docx</button>
        </span>
      </div>`);
    note.querySelector('[data-act="new"]').addEventListener('click', chooseTable);
    note.querySelector('[data-act="md"]').addEventListener('click', (e) => downloadTable(table, e.currentTarget, 'md'));
    note.querySelector('[data-act="docx"]').addEventListener('click', (e) => downloadTable(table, e.currentTarget, 'docx'));
    addToThread(note);
  } catch (e) {
    prog.fail('Decision table paused');
    if (e.demo || e.cap) handleCouncilError(e);
    renderPaused('Drafting the decision table failed — retry to draft it again.', () => finishTableOnly(prog), e);
  }
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

function routeSubmit() {
  if (state.path === 'table') return onDtSubmit();
  return followupMode ? onAsk() : onSubmit();
}

document.querySelectorAll('.mode-opt').forEach((b) =>
  b.addEventListener('click', () => setModeUI(b.dataset.mode)));
$('#submit-btn').addEventListener('click', routeSubmit);
$('#question').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) routeSubmit();
});
$('#file-input').addEventListener('change', (e) => {
  onFilesChosen(e.target.files);
  e.target.value = '';
});
$('#profile-btn').addEventListener('click', renderProfile);

// Drag & drop documents onto the composer (same pipeline as the attach button).
{
  const composer = $('#composer');
  for (const t of ['dragover', 'dragenter']) {
    composer.addEventListener(t, (e) => { e.preventDefault(); composer.classList.add('dragover'); });
  }
  composer.addEventListener('dragleave', (e) => { e.preventDefault(); composer.classList.remove('dragover'); });
  composer.addEventListener('drop', (e) => {
    e.preventDefault();
    composer.classList.remove('dragover');
    if (e.dataTransfer?.files?.length) onFilesChosen(e.dataTransfer.files);
  });
}

boot();
