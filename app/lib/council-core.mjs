// council-core — pure deliberation-protocol logic shared by the council
// engine (council.js) and the Vitest suite. No runtime APIs may be used here.

export const LETTERS = ["A", "B", "C", "D", "E"];

// Persona names + charter-identifying phrases that must never reach a peer
// prompt or the client (AC-1.2), each with a grammatically neutral stand-in.
// Order matters: longer phrases first.
export const IDENTITY_LEAKS = [
  { rx: /(?:the\s+)?first[- ]principles thinker/gi, sub: "this advisor" },
  { rx: /first[- ]principles/gi, sub: "fundamentals-based" },
  { rx: /(?:the\s+)?\bcontrarian\b/gi, sub: "this advisor" },
  { rx: /(?:the\s+)?\bexpansionist\b/gi, sub: "this advisor" },
  { rx: /(?:the\s+)?\boutsider\b/gi, sub: "this advisor" },
  { rx: /(?:the\s+)?\bexecutor\b/gi, sub: "this advisor" },
  { rx: /designated adversary/gi, sub: "advisor" },
  { rx: /possibility engine/gi, sub: "advisor" },
  { rx: /foundation[- ]checker/gi, sub: "advisor" },
  { rx: /council'?s operator/gi, sub: "advisor" },
  { rx: /smart friend from a completely different world/gi, sub: "fresh perspective" },
  { rx: /dumb[- ]smart question/gi, sub: "basic question" },
  { rx: /monday[- ]morning plan/gi, sub: "immediate action plan" },
];

// Replace identity-leaking phrases with neutral stand-ins so a peer (or the
// DOM) cannot infer which charter wrote a given opinion.
export function sanitizeOpinion(text) {
  let out = String(text ?? "");
  for (const { rx, sub } of IDENTITY_LEAKS) out = out.replace(rx, sub);
  // Collapse awkward doubled articles like "the this advisor".
  out = out.replace(/\b(the|a|an)\s+this advisor/gi, "this advisor");
  return out;
}

// Fisher–Yates over the persona keys; `rand` injected for testability.
export function randomMapping(personaKeys, rand = Math.random) {
  const keys = [...personaKeys];
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  const mapping = {};
  LETTERS.forEach((letter, i) => { mapping[letter] = keys[i]; });
  return mapping;
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export const ATTACHMENT_CHAR_BUDGET = 60_000;

// Largest files are truncated first (PRD §9). Returns the combined text plus
// a human note like "included 2 of 3 documents in full".
export function fitAttachments(files, budget = ATTACHMENT_CHAR_BUDGET) {
  const total = files.reduce((n, f) => n + (f.text?.length ?? 0), 0);
  if (total <= budget) {
    return {
      text: files.map((f) => docBlock(f.filename, f.text)).join("\n\n"),
      truncated: false,
      note: files.length ? `${files.length} document(s) included in full` : "",
    };
  }
  const overBy = total - budget;
  // Sort descending by size; shave the overage off the largest files first.
  const sized = files.map((f) => ({ ...f, keep: f.text?.length ?? 0 }))
    .sort((a, b) => b.keep - a.keep);
  let remaining = overBy;
  for (const f of sized) {
    if (remaining <= 0) break;
    const next = sized.find((g) => g !== f && g.keep < f.keep)?.keep ?? 0;
    const cut = Math.min(remaining, f.keep - next);
    f.keep -= cut;
    remaining -= cut;
  }
  const text = sized
    .map((f) => docBlock(
      f.filename,
      (f.text ?? "").slice(0, f.keep) + (f.keep < (f.text?.length ?? 0) ? "\n[…truncated…]" : ""),
    ))
    .join("\n\n");
  return {
    text,
    truncated: true,
    note: `attachments exceeded the context budget — included ~${Math.round((budget / total) * 100)}% of the attached text (largest files truncated first)`,
  };
}

function docBlock(filename, text) {
  return `<document filename=${JSON.stringify(filename ?? "attachment")}>\n${text ?? ""}\n</document>`;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

// Shared preamble injected into EVERY LLM call of a run (AC-1.C / AC-5.1).
export function buildPreamble(contextPackBody, contextPackVersion) {
  return [
    `<pl-context-pack version="${contextPackVersion}">`,
    contextPackBody.trim(),
    `</pl-context-pack>`,
    "",
    "House rules for every council output:",
    "- If the PL Alignment Asset (PLAA) comes up, members COLLECT points (that is the only permitted verb); never make price predictions or value/liquidity claims about PLAA or any PL asset.",
    "- Attribute nothing to named advisors; peers are only ever 'Advisor A'…'Advisor E'.",
    "- Serious decision-support for professionals: restrained, specific, no hype.",
  ].join("\n");
}

export function buildIntakePrompt(question) {
  return [
    "You are the intake officer for a five-advisor decision council. A member has submitted the text below.",
    "",
    "Decide whether it warrants convening the council. The council is for judgment calls only — decisions with real stakes and no objectively right answer. If the question is factual, has one correct answer, or is trivially low-stakes, the council must NOT convene; answer it directly instead.",
    "",
    "When the council WILL convene, also judge whether the submission gives enough of the baseline to deliberate fairly: the council weighs every proposal against the true Status Quo, so it needs (a) the current state of things — what happens today if nothing changes — and (b) any other alternatives the member is already considering. If either is materially missing and cannot be reasonably inferred, set needs_context to true and write context_request as one short, polite question from the Chairperson asking specifically for the current state and any other alternatives under consideration. If the submission already covers the baseline (or it is safely inferable), set needs_context to false.",
    "",
    "Respond with ONLY a JSON object, no other text:",
    '{"convene": true|false, "restated": "<the decision restated in one sentence>", "suggest_quick": true|false, "needs_context": true|false, "context_request": "<only when needs_context is true: the Chairperson\'s request for the current state and alternatives>", "direct_answer": "<only when convene is false: the direct answer plus one sentence on why the council is not convening>"}',
    "",
    "suggest_quick should be true when the decision is clearly smaller-stakes and a quick council (no peer-review round) would serve.",
    "",
    `<member-submission>\n${question}\n</member-submission>`,
  ].join("\n");
}

export function buildStage1Prompt({ preamble, charter, question, restated, attachmentsText, historySummary, isOutsider }) {
  const history = isOutsider
    ? "" // The Outsider's charter requires ignoring history in round 1.
    : historySummary
      ? `\nRelevant history from this member's past councils:\n${historySummary}\n`
      : "";
  return [
    preamble,
    "",
    "<your-charter>",
    charter.trim(),
    "</your-charter>",
    "",
    "You are one of five council advisors. You cannot see the others. Write your opinion in 300–500 words: your position, your reasoning, your confidence (high/medium/low), and the one thing that would change your mind. Stay ruthlessly in character per your charter. Do not hedge toward consensus — there is no consensus yet.",
    "Do not state your charter's name or role label anywhere in your output; write only as an anonymous advisor. End with a line exactly of the form `Confidence: high|medium|low`.",
    "",
    `The decision before the council: ${restated}`,
    "",
    `<full-question>\n${question}\n</full-question>`,
    attachmentsText ? `\n<attached-documents>\n${attachmentsText}\n</attached-documents>` : "",
    history,
  ].join("\n");
}

export function buildStage2Prompt({ preamble, charter, ownLetter, ownOpinion, peers, restated }) {
  const peerBlocks = peers
    .map((p) => `<opinion advisor="Advisor ${p.letter}">\n${p.text}\n</opinion>`)
    .join("\n\n");
  return [
    preamble,
    "",
    "<your-charter>",
    charter.trim(),
    "</your-charter>",
    "",
    `The decision before the council: ${restated}`,
    "",
    `Your own round-1 opinion (you are Advisor ${ownLetter}):`,
    `<your-round-1>\n${ownOpinion}\n</your-round-1>`,
    "",
    "Your four fellow advisors' round-1 opinions. You do not know who they are:",
    peerBlocks,
    "",
    "Read your fellow advisors' opinions. You do not know who they are. For each one, state in 1–2 sentences whether you concede, rebut, or build on their point — engage with the strongest version of their argument, not a strawman. Then write your REVISED opinion (300–500 words). It is a strength, not a weakness, to change your position when someone made a better argument. It is also a strength to hold your position against weak objections. End with your updated confidence and your single most important point for the Chairperson.",
    "Structure your output as EXACTLY these two markdown sections, in this order, using these exact headings:",
    "### Peer review",
    "### Revised opinion",
    "Your concede/rebut/build responses go under `### Peer review`; your revised opinion goes under `### Revised opinion`.",
    "Do not state your charter's name or role label anywhere in your output. Refer to peers only as Advisor A–E. End the `### Revised opinion` section with a line exactly of the form `Confidence: high|medium|low` followed by a line `For the Chairperson: <one sentence>`.",
  ].join("\n");
}

export function buildChairmanPrompt({ preamble, restated, question, opinions, mode }) {
  const blocks = opinions
    .map((o) => `<revised-opinion advisor="Advisor ${o.letter}">\n${o.text}\n</revised-opinion>`)
    .join("\n\n");
  return [
    preamble,
    "",
    "You are the Chairperson of a five-advisor decision council. Below are the advisors' " +
      (mode === "quick" ? "blind opinions (quick council — no peer-review round ran)" : "revised opinions after anonymized peer review") +
      ". Weigh argument quality over vote count — a 4–1 split can lose to the 1 if the 1 has the better argument, and you must say so explicitly when it happens.",
    "",
    `The decision: ${restated}`,
    `<full-question>\n${question}\n</full-question>`,
    "",
    blocks,
    "",
    "Write the verdict in EXACTLY these eight markdown sections, in this order, using these exact headings:",
    "## Council direction",
    "## The question",
    "## Where the council converged",
    "## Live disagreements",
    "## The verdict",
    "## First step",
    "## Biggest risk",
    "## Unresolved questions",
    "",
    "Attribute everything to Advisor A–E only. 'Council direction' is a 2–4 sentence executive summary of the council's directional feedback: state the consensus view plainly, then name any divergent views and who holds them (Advisor A–E only). 'Where the council converged' lists points 3+ advisors agree on. 'First step' is what to do Monday morning. Keep the whole verdict under 750 words.",
    "",
    "Then, after the last section, append this machine-readable block exactly (fill the values, one line each):",
    "<!--memory",
    "verdict: <one line>",
    "dissent: <the strongest minority argument, one line>",
    "confidence_spread: <e.g. 4 lean yes (2 high conf), 1 opposed>",
    "first_step: <one line>",
    "-->",
  ].join("\n");
}

export function buildFollowupPrompt({ preamble, restated, verdict, rounds, followupQuestion }) {
  const record = rounds
    .map((r) => `<record stage="${r.stage}" advisor="Advisor ${r.letter}">\n${r.content}\n</record>`)
    .join("\n\n");
  return [
    preamble,
    "",
    "You are the Chairperson of a five-advisor decision council. A deliberation has already concluded; its record is below. Answer the member's follow-up question FROM THIS RECORD — do not re-convene the council, do not invent new advisor opinions. If the follow-up materially changes the question, say that a new deliberation is warranted instead.",
    "",
    `The original decision: ${restated}`,
    "",
    `<verdict>\n${verdict}\n</verdict>`,
    "",
    record,
    "",
    `Member's follow-up: ${followupQuestion}`,
    "",
    "Answer as the Chairperson in under 250 words. Attribute anything advisor-specific to Advisor A–E only.",
  ].join("\n");
}

// The Chairperson's decision table (post-verdict). The shape and rules come
// from the PLAA decision-table method: a row-label column, the TRUE Status
// Quo, then 1–3 genuinely distinct options; rows chosen around the
// constituents the decision actually touches; Recommendation and
// Notes / open questions as the final two rows. Output is strict JSON so the
// same object renders the in-app table and the downloadable Word document.
export function buildDecisionTablePrompt({ preamble, restated, question, opinions, verdict, mode }) {
  const blocks = opinions
    .map((o) => `<opinion advisor="Advisor ${o.letter}">\n${o.text}\n</opinion>`)
    .join("\n\n");
  return [
    preamble,
    "",
    "You are the Chairperson of a five-advisor decision council. The deliberation below has concluded. Distill it into a decision table — a tight option matrix the member can read in one sitting and act on.",
    "",
    `The decision: ${restated}`,
    `<full-question>\n${question}\n</full-question>`,
    "",
    (mode === "quick" ? "The advisors' blind opinions (quick council — no peer-review round ran):" : "The advisors' revised opinions after anonymized peer review:"),
    blocks,
    "",
    `<verdict>\n${verdict}\n</verdict>`,
    "",
    "Build the table by these rules:",
    "- Columns: the first column is always the TRUE Status Quo — the member's real current path if nothing changes, stated honestly (what continues, what stays unsolved, why it may still be tolerable for now). It is never a strawman. Then 1–3 genuinely distinct options drawn from the deliberation (the member's proposal is one; add others only if the council actually surfaced them). Name each option by label + mechanism (e.g. 'Boundary Cutover + Warm Start'), never 'Option A'.",
    "- Rows: start from Description; Problem solved / primary objective; then 2–4 rows tailored to the constituents and systems THIS decision touches (member/user impact, operational impact, technical/systems impact, legal/compliance/tax impact when relevant, time/cost, key risks). Drop rows that don't apply — no filler. The final two rows MUST be 'Recommendation' and 'Notes / open questions'.",
    "- Cells: 1–3 sentences, short but substantive. Lead with an evaluative label where it helps scanning (Low / Medium / High / Favorable / Unfavorable / No impact / Requires review / Unknown — needs input), then the concrete implication. Name the mechanism behind every tradeoff — never a vague 'more complex'. Where the council lacked evidence, write 'Unknown — needs input' and say what input would resolve it.",
    "- The Recommendation row must follow from the verdict and the cells above it, give a clear verdict-plus-reason per column, and be able to stand alone in an email. The Notes / open questions row carries assumptions, missing inputs, and the council's unresolved questions — visible, not buried.",
    "- Frame legal, tax, and securities points as issues to review, not conclusions (e.g. 'Requires counsel review: …').",
    "- Attribute anything advisor-specific to Advisor A–E only.",
    "",
    "Respond with ONLY a JSON object, no other text, in exactly this shape:",
    '{"title": "<short table title>", "decision_question": "<the decision question in one sentence>", "recommendation_preview": "<one-sentence bottom line consistent with the verdict>", "columns": ["Status Quo", "<Option name + mechanism>", "..."], "rows": [{"label": "<row label>", "cells": ["<Status Quo cell>", "<option cell>", "..."]}]}',
    "",
    "Every row's cells array must have exactly one cell per column, in column order.",
  ].join("\n");
}

// Shape gate for the model's decision-table JSON. Returns a normalized copy
// (strings trimmed and length-capped) or null when the structure is unusable
// — the caller treats null as a malformed round and retries once.
export function validateDecisionTable(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const str = (v, cap) => {
    const s = String(v ?? "").trim();
    return s.length > cap ? s.slice(0, cap - 1) + "…" : s;
  };
  const title = str(parsed.title, 200);
  const decisionQuestion = str(parsed.decision_question, 500);
  const preview = str(parsed.recommendation_preview, 500);
  if (!title || !decisionQuestion) return null;
  const columns = Array.isArray(parsed.columns) ? parsed.columns.map((c) => str(c, 160)).filter(Boolean) : [];
  // Status Quo + 1–3 options (4 max keeps the doc readable on one page).
  if (columns.length < 2 || columns.length > 4) return null;
  if (!/status quo/i.test(columns[0])) return null;
  const rows = Array.isArray(parsed.rows)
    ? parsed.rows
      .map((r) => ({
        label: str(r?.label, 120),
        cells: Array.isArray(r?.cells) ? r.cells.map((c) => str(c, 900)) : [],
      }))
      .filter((r) => r.label)
    : [];
  if (rows.length < 4 || rows.length > 12) return null;
  for (const r of rows) {
    if (r.cells.length !== columns.length) return null;
  }
  // The two rows that make this a decision aid rather than a discovery dump.
  if (!rows.some((r) => /recommendation/i.test(r.label))) return null;
  if (!rows.some((r) => /notes|open questions/i.test(r.label))) return null;
  return { title, decision_question: decisionQuestion, recommendation_preview: preview, columns, rows };
}

// ---------------------------------------------------------------------------
// Parsing model output
// ---------------------------------------------------------------------------

export function extractJson(text) {
  const match = String(text ?? "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

export function extractConfidence(text) {
  const matches = [...String(text ?? "").matchAll(/confidence\s*[:\-]?\s*\(?\s*(high|medium|low)/gi)];
  return matches.length ? matches[matches.length - 1][1].toLowerCase() : null;
}

export function parseMemoryFromVerdict(verdictText) {
  const block = String(verdictText ?? "").match(/<!--memory([\s\S]*?)-->/);
  const fields = { verdict: null, dissent: null, confidence_spread: null, first_step: null };
  if (block) {
    for (const key of Object.keys(fields)) {
      const m = block[1].match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
      if (m) fields[key] = m[1].trim();
    }
  }
  return fields;
}

// Strip the machine block before the verdict is shown or stored for display.
export function stripMemoryBlock(verdictText) {
  return String(verdictText ?? "").replace(/<!--memory[\s\S]*?-->/g, "").trim();
}

// ---------------------------------------------------------------------------
// Council memory (Stage 0 / Stage 4)
// ---------------------------------------------------------------------------

// ≤5-line relevant-history summary for Stage 0, most recent first, naive
// keyword overlap with the current question decides relevance ties.
export function relevantHistorySummary(question, pastBlocks, limit = 5) {
  const qWords = new Set(
    String(question).toLowerCase().split(/\W+/).filter((w) => w.length > 3),
  );
  const scored = pastBlocks.map((b) => {
    const text = `${b.question ?? ""} ${b.verdict_line ?? ""}`.toLowerCase();
    let score = 0;
    for (const w of qWords) if (text.includes(w)) score++;
    return { ...b, score };
  });
  scored.sort((a, b) => b.score - a.score || new Date(b.created_at ?? 0) - new Date(a.created_at ?? 0));
  return scored.slice(0, limit)
    .map((b) => {
      const outcome = b.outcome && b.outcome !== "pending"
        ? ` (outcome: ${b.outcome.replace("_", " ")}${b.outcome_note ? ` — ${b.outcome_note}` : ""})`
        : " (outcome pending)";
      return `- ${(b.created_at ?? "").slice(0, 10)}: asked "${truncate(b.question, 90)}" → verdict: ${truncate(b.verdict_line, 110)}${outcome}`;
    })
    .join("\n");
}

function truncate(s, n) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// The confidence spread across five advisors, e.g. "3 high / 1 medium / 1 low".
export function confidenceSpread(confidences) {
  const counts = { high: 0, medium: 0, low: 0, unknown: 0 };
  for (const c of confidences) counts[c ?? "unknown"] = (counts[c ?? "unknown"] ?? 0) + 1;
  return ["high", "medium", "low"]
    .filter((k) => counts[k] > 0)
    .map((k) => `${counts[k]} ${k}`)
    .join(" / ") || "unreported";
}
