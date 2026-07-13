// council-core — pure deliberation-protocol logic shared by the `council`
// Supabase Edge Function (deployed alongside it) and the Vitest suite.
// No runtime APIs (Deno/Node) may be used here.

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
    "Respond with ONLY a JSON object, no other text:",
    '{"convene": true|false, "restated": "<the decision restated in one sentence>", "suggest_quick": true|false, "direct_answer": "<only when convene is false: the direct answer plus one sentence on why the council is not convening>"}',
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
    "Read your fellow advisors' opinions. You do not know who they are. For each one, state in 1–2 sentences whether you concede, rebut, or build on their point — engage with the strongest version of their argument, not a strawman. Then write your REVISED opinion (300–500 words). It is a strength, not a weakness, to change your position when someone made a better argument. It is also a strength to hold your position against weak objections. End with your updated confidence and your single most important point for the Chairman.",
    "Do not state your charter's name or role label anywhere in your output. Refer to peers only as Advisor A–E. End with a line exactly of the form `Confidence: high|medium|low` followed by a line `For the Chairman: <one sentence>`.",
  ].join("\n");
}

export function buildChairmanPrompt({ preamble, restated, question, opinions, mode }) {
  const blocks = opinions
    .map((o) => `<revised-opinion advisor="Advisor ${o.letter}">\n${o.text}\n</revised-opinion>`)
    .join("\n\n");
  return [
    preamble,
    "",
    "You are the Chairman of a five-advisor decision council. Below are the advisors' " +
      (mode === "quick" ? "blind opinions (quick council — no peer-review round ran)" : "revised opinions after anonymized peer review") +
      ". Weigh argument quality over vote count — a 4–1 split can lose to the 1 if the 1 has the better argument, and you must say so explicitly when it happens.",
    "",
    `The decision: ${restated}`,
    `<full-question>\n${question}\n</full-question>`,
    "",
    blocks,
    "",
    "Write the verdict in EXACTLY these seven markdown sections, in this order, using these exact headings:",
    "## The question",
    "## Where the council converged",
    "## Live disagreements",
    "## The verdict",
    "## First step",
    "## Biggest risk",
    "## Unresolved questions",
    "",
    "Attribute everything to Advisor A–E only. 'Where the council converged' lists points 3+ advisors agree on. 'First step' is what to do Monday morning. Keep the whole verdict under 700 words.",
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
    "You are the Chairman of a five-advisor decision council. A deliberation has already concluded; its record is below. Answer the member's follow-up question FROM THIS RECORD — do not re-convene the council, do not invent new advisor opinions. If the follow-up materially changes the question, say that a new deliberation is warranted instead.",
    "",
    `The original decision: ${restated}`,
    "",
    `<verdict>\n${verdict}\n</verdict>`,
    "",
    record,
    "",
    `Member's follow-up: ${followupQuestion}`,
    "",
    "Answer as the Chairman in under 250 words. Attribute anything advisor-specific to Advisor A–E only.",
  ].join("\n");
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
