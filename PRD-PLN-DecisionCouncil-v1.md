# PRD: PLN — Decision Council (AI Council for the PL Network)

| **Field** | **Value** |
| --- | --- |
| Author | Bill Warren · Product Lead, PLAA |
| Date | 2026-07-07 |
| Status | Draft |
| Version | 1.1 |
| Changelog | v1.2 (2026-07-08): Identity now piggybacks on **LabOS auth** — the LabOS gateway forwards a signed JWT, verified by the app and federated into Supabase (third-party auth) so each decision is tied to the real member and RLS scopes history per LabOS user. Retires anonymous auth as the identity source (new F-7); closes Open Question #3. · v1.1 (2026-07-08): LLM access + persistence resolved via a managed Supabase backend (Postgres + RLS, Edge Function key proxy with a global spend cap). Retires BYO-key and in-container SQLite; closes Open Questions #1 and #2. |
| Design source | PLN AI Apps Starter Kit `styles/pln-theme.css` (PL Foundations tokens: brand blue #1B4CFE, white surfaces, near-black text, Inter) |
| Deploy target | PL Infra → AI Apps dashboard (PLN sandbox), via the starter kit's `deploy-to-labs` skill |

---

## 0. Compliance & Vocabulary Pre-Check (gates the build)

- [x] **Vocabulary:** the app itself has no points mechanic. The PL context pack (F-5) references PLAA and MUST use "collect" (never "earn"), "Rights," "snapshot period," "contribution" correctly. Advisor outputs that discuss PLAA inherit the same vocabulary via the shared system-prompt preamble.
- [x] **Non-promotional:** the context pack describes PLAA factually (contribution-first; Rights as downstream consequence; no value/liquidity claims). Advisors must not be prompted to make price predictions about PLAA or any PL asset.
- [x] **PII/KYC:** No KYC and no onboarding. The app now records **the member's LabOS identity** (the verified `sub` claim from the forwarded LabOS JWT) so each decision is private to its owner — it stores that stable identifier only, not names/emails, unless a future need is reviewed. Identity is never entered by the user; it comes from LabOS auth (F-7). **Also:** user-attached documents may contain sensitive business content and are transmitted to the LLM API. A clear, persistent disclosure at the upload control is required (AC-4.4). No attachment contents, identity tokens, or API keys in URLs or server logs.
- [x] **Economics:** N/A — no points/Rights surfaced.
- [x] **Buyback:** N/A — not surfaced.
- [x] **Eligibility:** N/A — app is available to any member with dashboard access.
- [x] **Legal review gate:** Javier — one-time review of the PL/PLAA context pack copy (F-5) only.

---

## 1. Overview

The Decision Council is a members-only AI deliberation app for the Protocol Labs Network. A member brings a judgment call — take the partnership, kill the feature, restructure the deal — and five independent AI advisors with distinct charters (the Contrarian, the First-Principles Thinker, the Expansionist, the Outsider, and the Executor) deliberate it through a structured protocol: blind opinions, anonymized peer review, and a Chairman's synthesized verdict. Every advisor reasons from a shared, factual understanding of Protocol Labs — its mission to drive breakthroughs in computing to push humanity forward, its history from IPFS/Filecoin origins to a decentralized innovation network of 750+ organizations, and Juan Benet's long-arc vision — so the council's judgment is native to PL, not generic consulting advice. Members can attach up to 20 MB of supporting documents, watch the deliberation unfold in a chat interface, and revisit their last five decisions.

### One-Sentence Description

A PLN sandbox web app that runs a member's strategic decision through a five-advisor AI deliberation protocol — blind opinions → anonymized peer review → Chairman's verdict — grounded in Protocol Labs' mission and history, so members can pressure-test judgment calls before making them.

---

## 2. Problem Statement

### The Problem

PL Network members — founders, researchers, operators across 750+ organizations — face high-stakes judgment calls constantly, but structured pressure-testing is scarce. Advice tends to come from a single perspective (a cofounder, an investor, one AI chat), which produces confirmation rather than deliberation. There is no shared PL-native tool that forces independent, adversarial, multi-perspective analysis and converges to an actionable verdict.

### Evidence

- **Qualitative:** the AI Council skill pattern is already in productive personal use (Bill's workflow) for engagement, pricing, pivot, and deal-term decisions; the network's strongest program signal (PLAA NPS analysis) is that peer connection and visible peer activity are the ecosystem's most valued assets — the council productizes a "peer pressure-test" that most members don't have.
- **Structural:** single-model AI advice exhibits sycophancy; the council protocol (independence in round 1, anonymized challenge in round 2, argument-weighted synthesis) is a known mitigation, but currently lives only in a personal skill file, not a network surface.

### Current Alternatives

Ad-hoc ChatGPT/Claude chats (single perspective, no independence, no memory), Slack polls (shallow), advisor calls (slow, expensive, scarce). None enforce blind independence, structured dissent, or a synthesized verdict; none share PL context.

---

## 3. Target User

### Primary Persona

| **Attribute** | **Description** |
| --- | --- |
| Name | The Network Decision-Maker |
| Role | Founder, lead, or operator at a PL Network organization |
| Goal | Pressure-test a judgment call in minutes and leave with a verdict, a first step, and named risks |
| Pain Point | Advice is one-perspective, sycophantic, or slow; context has to be re-explained every time |
| Technical Level | Intermediate — comfortable with web apps, not necessarily with prompting |

**Secondary:** The Super-Contributor / WG member — uses the council for program decisions (needs the PL context pack to be accurate); the Curious Member — opens the app from the AI Apps dashboard to see what it does (needs demo mode to work with zero setup).

### User Context

Opened inside the PL Infra → AI Apps dashboard iframe (desktop-dominant), mid-decision, often with a doc or two in hand (a term sheet, a spec, a strategy memo). Mindset: "I need to decide this today and I don't fully trust my own read."

---

## 4. Solution Overview

### Value Proposition

Five genuinely independent perspectives, forced disagreement, and one argument-weighted verdict — grounded in what Protocol Labs is and is trying to do — in one deliberation, inside the network's own infrastructure.

### Key Differentiators

- **Protocol over prompt:** independence (blind round 1), anonymized peer review (round 2), and Chairman synthesis are enforced by the orchestration engine, not by hoping a single model role-plays five voices honestly.
- **PL-native:** every advisor shares the same factual context pack on PL's mission, history, network structure, and Juan Benet's vision — they disagree on approach, never on what PL is.
- **Anonymity as a feature:** advisors surface to the user only as Advisor A–E, with a fresh randomized persona→letter mapping per deliberation, so members weigh arguments, not roles.

**Tension resolved (v1.1):** the PLN sandbox injects no env vars or secrets and the starter kit forbids shipping keys — but a live council requires an Anthropic API key and durable storage. Rather than push the key onto members (bring-your-own-key was v1.0's stopgap, now retired), the app **moves the trust boundary out to a managed Supabase project** that is *allowed* to hold secrets. The PLN container ships only Supabase's **public** publishable/anon key (safe by design — access is enforced by Row-Level Security, not by hiding the key). The Anthropic key lives as a **Supabase Edge Function secret**, never in the zip, never in the browser. Members don't paste keys and don't log in *again* — **identity piggybacks on LabOS auth**: the LabOS gateway forwards a signed JWT with each request, which the app verifies (against LabOS's public keys) and federates into Supabase (third-party auth), so `auth`'s identity **is** the LabOS member. RLS then scopes every decision and history row to that member — a member sees only their own decisions (F-7). A **global daily spend cap** bounds the owner-funded Claude usage, and demo mode remains the zero-state/over-cap fallback. See F-6, F-7, and §9; this closes Open Questions #1, #2, and #3.

---

## 5. Features (In Scope)

**Agent Teams note:** each feature is a self-contained unit a teammate can own end-to-end. Whole-app Claude Design and Claude Code prompts are in Appendix A (this app is one coherent surface; per-feature scaffolds are folded into the whole-app pair, with feature IDs referenced inline).

### Feature 1: Council Deliberation Engine

**Feature ID:** F-1 · **Priority:** P0 · **Complexity:** High · **Compliance flags:** advisor prompts embed the PLAA-safe vocabulary rules from §0; otherwise none.

**Description:** Server-side orchestration of the four-stage protocol from the `ai-council` skill, adapted to an app runtime:

- **Stage 0 — Intake.** Restate the question in one sentence for user confirmation. Create a deliberation record. Pull relevant history from council memory (past decisions on similar topics, ≤5 lines). **Randomize the persona→letter mapping** (A–E) per deliberation; the mapping is stored server-side and never exposed to the client.
- **Stage 1 — Blind opinions.** Five parallel LLM calls, one per persona. Each receives: its full persona charter, the shared PL context pack (F-5), the question + attached-document text, and the relevant-history summary — **except the Outsider, whose charter requires ignoring history in round 1.** No advisor sees another's output. Output: 300–500 words — position, reasoning, confidence (high/medium/low), and the one thing that would change its mind.
- **Stage 2 — Anonymized peer review.** Five parallel calls. Each advisor receives its own round-1 opinion plus the other four labeled only Advisor A–E (identity-leaking phrases stripped by a sanitization pass). Each concedes/rebuts/builds per peer in 1–2 sentences, then writes a revised 300–500-word opinion, updated confidence, and its single most important point for the Chairman.
- **Stage 3 — Chairman's verdict.** One synthesis call producing the seven-part verdict: question · convergence (3+ advisors) · live disagreements · the verdict (argument quality over vote count — a 4–1 split can lose to the 1, stated explicitly when it happens) · first step ("Monday morning") · biggest risk · unresolved questions.
- **Stage 4 — Memory write.** Append a structured memory block (question, verdict, confidence spread, key dissent, first step, outcome=pending) to the decisions store; memory feeds Stage 0 of future deliberations.
- **Modes:** Full council (default) and **Quick council** (skips Stage 2; user toggle or auto-suggested for clearly smaller decisions). The engine labels which mode ran. **Follow-up questions** on an existing verdict are answered by the Chairman from the stored record without re-convening.
- **Triage:** if the submitted question is factual or trivially low-stakes, the engine says so and answers directly instead of convening (per the skill's "when NOT to convene" rule).

**Behavior Specification:**
- **Trigger:** user submits a question (+ optional attachments) and confirms the restated intake.
- **Action:** engine runs Stages 1–4, streaming stage-level progress events to the client.
- **Result:** verdict rendered in the chat thread; round-1/round-2 opinions expandable per advisor letter; decision saved to history.

**Acceptance Criteria:**
- ☐ AC-1.1: Given a submitted question, when Stage 1 runs, then five opinions are generated from five isolated calls with no cross-contamination (verified by logging call payloads in test mode).
- ☐ AC-1.2: Given Stage 2, when peer opinions are distributed, then all persona names and charter-identifying phrases are stripped; only "Advisor A–E" labels appear in prompts and UI.
- ☐ AC-1.3: Given a completed deliberation, when the user asks to de-anonymize, then the app explains the mapping exists but is withheld to protect future deliberations (never reveals it in-session).
- ☐ AC-1.4: Given two deliberations, when mappings are compared, then persona→letter assignment is independently randomized each time.
- ☐ AC-1.5: Given an LLM call failure mid-deliberation, then the run pauses with a clear status and a retry control — never a blank or silently truncated verdict (a 4-advisor council is not a council).
- ☐ AC-1.6: Given a factual question ("what's the FIL circulating supply"), then the engine declines to convene and answers directly with the reason.
- ☐ AC-1.C: Compliance — the shared preamble injected into every advisor prompt contains the vocabulary rules (collect/never-earn; no PLAA price predictions); test asserts the preamble is present in all 11 call payloads.

**Error States:** per-stage failure → paused state + retry; rate limit → backoff with visible countdown; malformed model output → single automatic re-ask, then surfaced error.

**Test Requirements:** Unit (mapping randomization, sanitization pass, memory-block format) / Integration (full 4-stage run against a mocked LLM) / E2E (submit → verdict) / Compliance (preamble presence; "earn" absent from context pack).

**Database Needs:** `deliberations` (id, question, restated_question, mode, status, created_at), `rounds` (deliberation_id, stage, letter, content), `mappings` (deliberation_id, letter, persona — server-only, never serialized to client), `memory_blocks` (deliberation_id, verdict_line, dissent_line, confidence_spread, first_step, outcome). **API Endpoints:** `POST /api/deliberations`, `GET /api/deliberations/:id` (mapping excluded), `POST /api/deliberations/:id/retry`, `POST /api/deliberations/:id/followup`, SSE `GET /api/deliberations/:id/stream`.

### Feature 2: Chat & Deliberation Interface

**Feature ID:** F-2 · **Priority:** P0 · **Complexity:** Medium · **Compliance flags:** None.

**Description:** A single-page chat surface: text input for the decision question, mode toggle (Full/Quick), attachment control (F-4), and a streamed deliberation view. Stages render as labeled progress ("Council convened · Round 1: blind opinions (3/5 in)…"), then five collapsible Advisor A–E cards for each round, then the Chairman's verdict as the anchored final message. Follow-ups continue in the same thread.

**User Flow:** user types the question → confirms the one-line restatement → watches staged progress stream → expands advisor cards as they land → reads the verdict → optionally asks a follow-up or starts a new decision.

**Acceptance Criteria:**
- ☐ AC-2.1: Given a running deliberation, when a stage completes, then the UI updates via SSE without page refresh.
- ☐ AC-2.2: Given the verdict, then all seven verdict sections render, and advisor cards show letters only — no persona names anywhere in the DOM.
- ☐ AC-2.3: Given an empty input or a >4,000-character question, then inline validation explains the limit; no dead submit.
- ☐ AC-2.4: Given a follow-up, then it is answered from the stored record (single Chairman call) and appended to the thread, visibly distinguished from a new deliberation.

**Error States:** SSE disconnect → auto-reconnect with "reconnecting…" status; deliberation still running on return → thread resumes from stored state.

**Test Requirements:** component render per state (idle/intake/streaming/complete/failed); E2E full-flow; DOM assertion that persona names never appear.

**Database Needs:** none beyond F-1. **API Endpoints:** consumes F-1's.

**Design System:** PLN starter-kit tokens (`styles/pln-theme.css`); brand primary blue #1B4CFE, white surfaces, near-black text, yellow as secondary highlight only; Inter (Regular/Medium/Semi Bold, tight tracking). Advisor cards use letter avatars (A–E) in the brand blue; verdict card uses an elevated white card with a blue header band so it reads as part of the PL family inside the dashboard iframe.

### Feature 3: Decision History (Last 5)

**Feature ID:** F-3 · **Priority:** P0 · **Complexity:** Low · **Compliance flags:** None.

**Description:** A history rail (or top strip on narrow iframes) showing the five most recent decisions for that logged in user: date, question one-liner, verdict one-liner, confidence spread, and an outcome tag (Pending / Went well / Went badly — user-settable). Clicking opens the full stored deliberation read-only, with follow-up available. Outcome updates write back to the memory block so future deliberations learn from results (per the skill: "advisors should know when past council advice proved right or wrong"). History is user specific. One user should not be able to see the history of another user. 

**Acceptance Criteria:**
- ☐ AC-3.1: Given >5 decisions, then exactly the 5 most recent render, newest first; older remain in the DB and reachable via history search-by-keyword (single input, simple LIKE).
- ☐ AC-3.2: Given an outcome update, then the memory block's outcome line updates and is included in future Stage-0 relevant-history summaries.
- ☐ AC-3.3: Given zero decisions, then an empty state explains the app and offers a one-click example deliberation (demo mode).
- ☐ AC-3.4: Given a user, they cannot see the history of any other user only the >5 they've submitted.

**Error States:** history fetch failure → cached last-known list + retry.

**Test Requirements:** unit (ordering, outcome write-back) / E2E (run decision → appears in history → reopen).

**Database Needs:** reads F-1's tables. **API Endpoints:** `GET /api/deliberations?limit=5`, `PATCH /api/deliberations/:id/outcome`.

### Feature 4: Document Attachments (≤20 MB)

**Feature ID:** F-4 · **Priority:** P1 · **Complexity:** Medium · **Compliance flags:** sensitive-content disclosure required (see §0 PII note).

**Description:** Attach up to 20 MB total per deliberation (multiple files; `.pdf`, `.md`, `.txt`, `.docx`). Server extracts text, truncates to a per-deliberation context budget with a visible "included N of M pages" note, and injects it into every advisor's Stage-1 context. Files are stored on the container filesystem keyed to the deliberation; extracted text is stored in the DB for history replay.

**Acceptance Criteria:**
- ☐ AC-4.1: Given files totaling ≤20 MB in supported formats, then upload succeeds with per-file progress and extracted-text confirmation ("3 files · ~14,200 words included").
- ☐ AC-4.2: Given >20 MB or an unsupported type, then a specific inline error names the limit/type — no silent drop.
- ☐ AC-4.3: Given an attachment, then its extracted text reaches all five Stage-1 prompts (test asserts presence in payloads).
- ☐ AC-4.4: Compliance — a persistent note at the upload control states that document contents are sent to the AI provider for analysis and should not include credentials or regulated PII; attachment contents never appear in URLs or server logs.

**Error States:** extraction failure (scanned/image PDF) → warn that the file yielded no text, proceed without it on confirm.

**Test Requirements:** unit (size/type validation, truncation) / integration (extraction per format) / compliance (no contents in logs/URLs).

**Database Needs:** `attachments` (deliberation_id, filename, bytes, extracted_chars). **API Endpoints:** `POST /api/deliberations/:id/attachments` (multipart; no content in query strings).

### Feature 5: PL Context Pack (shared vision layer)

**Feature ID:** F-5 · **Priority:** P0 · **Complexity:** Low · **Compliance flags:** **None** .

**Description:** A versioned, server-side markdown document injected as a shared preamble into every advisor and Chairman prompt. All five personas share this factual base and PL's vision — they differ in approach, never in mission. Contents (drafted from protocol.ai, the PL Past/Present/Future talk, Juan Benet's public-goods and a16z talks, and the Alignment Asset overview):

- **Mission:** Protocol Labs drives breakthroughs in computing to push humanity forward.
- **What PL is now:** an innovation network connecting 750+ tech startups, funds, accelerators, foundations, service providers, and open-source projects across web3, AI, AR/VR, BCI, and hardware; organizations collaborate to solve common problems, share knowledge and resources, and accelerate R&D. PL completed its transition from a single R&D company to a decentralized innovation network in July 2024.
- **History in brief:** founded 2014 by Juan Benet (YC S14) to improve the internet and computing; created IPFS and Filecoin ($205.8M 2017 token sale); spun out CoinList; launched PL Research, ProtoSchool, the Permissive License Stack, Filecoin mainnet (2020), the Venture Studio (2023); network milestones include Bluesky, World App, and decentralized AI efforts (BitRobot, Prime Intellect).
- **The Benet vision (shared by every advisor):** a Bell Labs-scale innovation engine rebuilt as a network — a full R&D pipeline from early research to deployed products; world-class teams; open source and open technologies; the crypto + VC model to fund and grow many projects; cryptoeconomics and new mechanisms for sustainable public-goods funding; a 100-year framing of computing breakthroughs that reshape economies and governance while ensuring safe outcomes, securing the internet, and defending digital human rights.
- **PLAA (vocabulary-safe):** the PL Alignment Asset is a shared rewards system tying network-wide contributions to shared progress; members **collect** points for verified contributions during monthly snapshot periods; points may **convert** to PLAA issued and managed by a Trust; Rights are a regulated security and not ownership interests; no value or liquidity is promised.
- **Decision lens:** when weighing options, advisors consider effects on the network's long-term mission, member trust, open collaboration, and compliance posture — not just the asker's local optimum.

**Acceptance Criteria:**
- ☐ AC-5.1: Given any advisor or Chairman call, then the current context-pack version is present in the payload (asserted in tests across all 11 calls of a full run).
- ☐ AC-5.2: Given a context-pack edit, then it is a file/DB change requiring no code deploy, and the active version is stamped on each deliberation record.
- ☐ AC-5.C: Compliance — copy passes the §0 vocabulary scan ("earn" absent except inside a flagged prohibited-example, if any).

**Test Requirements:** unit (version stamping) / compliance (vocabulary scan as a test).

**Database Needs:** `context_pack` (version, body, reviewed_at). **API Endpoints:** internal only.

### Feature 6: Hosted LLM Access, Spend Cap & Demo Mode

**Feature ID:** F-6 · **Priority:** P0 · **Complexity:** Medium · **Compliance flags:** key-handling and spend-control rules below are launch-gating.

**Description:** The sandbox injects no env vars or secrets and shipping a key is forbidden, so **all secrets live in a managed Supabase project, not in the container.** LLM access runs through a Supabase **Edge Function (`claude-proxy`)** that holds the Anthropic key as a platform secret and proxies to the Messages API; the browser and the container never see the key. Members do not paste a key or sign in again — the app runs under the member's **LabOS-federated Supabase session** (F-7), whose JWT (a) scopes history via RLS and (b) is required (`verify_jwt`) to invoke `claude-proxy`. Because the owner funds usage, the proxy enforces defense-in-depth: valid member JWT → `Origin` must match `*.plnetwork.io` → an atomic **global daily call cap** (`bump_usage()` against a locked `usage_counter` table) returns 429 when exceeded (a per-member quota is now possible since usage is attributable — see §11 #4). If the key secret is unset or the cap is hit, the proxy returns a structured signal and the app falls back to **demo mode**: one pre-recorded example deliberation plays through the full UI so the dashboard experience is never broken.

**Acceptance Criteria:**
- ☐ AC-6.1: Given no configured key secret (or the daily cap reached), then the app loads/falls back to demo mode with a clear explanatory prompt — never a broken screen in the iframe.
- ☐ AC-6.2: Given any deploy, then the Anthropic key exists ONLY as a Supabase Edge Function secret; tests/log-scan assert it never appears in the container image, the shipped bundle, DB rows, browser storage, logs, or URLs. Only the public anon/publishable key + project URL are shipped.
- ☐ AC-6.3: Given an invalid/expired key secret, then the call fails with a specific, human explanation surfaced in the UI — not a raw 401/500.
- ☐ AC-6.4: Given the member's LabOS-federated session, then every `claude-proxy` invocation carries a valid member JWT (`verify_jwt`), rejects mismatched `Origin`, and increments the global cap; a call over the cap returns 429 and the UI explains the daily limit.
- ☐ AC-6.C: Compliance — no member action is required to reach demo mode; live-council copy states that usage runs on a PL-provided key subject to a shared daily limit (no member key is collected).

**Test Requirements:** unit (cap increment/refuse, origin allowlist, demo fallback) / integration (`claude-proxy` end-to-end against a mocked Anthropic) / log-scan test asserting no key material anywhere client-side or in the image.

**Database Needs:** `usage_counter` (day PK, call_count, token_count) — RLS-on/no-policy, mutated only by the Edge Function via `service_role`. **Endpoints:** Supabase Edge Function `POST /functions/v1/claude-proxy` (JWT-verified; body is the Anthropic payload; streams SSE back).

### Feature 7: Member Identity via LabOS Auth (private per-user history)

**Feature ID:** F-7 · **Priority:** P0 · **Complexity:** Medium · **Compliance flags:** identity-verification rules below are launch-gating; ties to the §0 PII note.

**Description:** The app does **not** run its own login — it piggybacks on the member's existing **LabOS session**. The LabOS dashboard/gateway forwards a **signed JWT** identifying the logged-in member with each request that reaches the app. The thin container **verifies that JWT** (signature against LabOS's published keys/JWKS, plus issuer/audience/expiry checks), extracts the stable member subject (`sub`), and establishes a matching **Supabase session** for the browser — implemented via Supabase **third-party auth** configured to trust the LabOS token issuer, so `auth.jwt()->>'sub'` inside Postgres is the LabOS member id. Every domain row carries that id and RLS restricts reads/writes to the owner, so **a member sees only their own decisions and history** across devices/sessions (as long as LabOS resolves them to the same identity). A **forged or absent** token is never trusted: verification failure → no session → demo mode (read-only), never access to another member's data.

**Behavior Specification:**
- **Trigger:** the member opens the app inside the dashboard; the gateway attaches the signed LabOS JWT.
- **Action:** container verifies the JWT and hands the SPA a LabOS-federated Supabase session; all history/deliberation calls carry it.
- **Result:** the history rail and all decisions are scoped to that member; no cross-member leakage.

**Acceptance Criteria:**
- ☐ AC-7.1: Given a valid forwarded LabOS JWT, then the app establishes a session whose identity equals the member's LabOS `sub`, and all new rows are written with that `user_id`.
- ☐ AC-7.2: Given two different members, then each sees only their own decisions/history; a direct query for another member's rows returns nothing (RLS enforced — test with two tokens).
- ☐ AC-7.3: Given a **missing, malformed, expired, or bad-signature** token (e.g. someone hitting the sandbox URL directly), then the app grants **no** authenticated session and falls back to demo mode — it never trusts an unverified header (spoofing test).
- ☐ AC-7.4: Given the LabOS JWT, then it is verified server-side against LabOS's public keys with issuer/audience/expiry checks; the token is never logged and never placed in a URL.
- ☐ AC-7.C: Compliance — the app stores only the LabOS subject identifier for scoping (no name/email unless a reviewed need arises); §0 PII note reflects this.

**Error States:** verification/JWKS fetch failure → treat as unauthenticated (demo mode) with a clear "sign in to LabOS to run and save councils" message — never a 500 or a silent trust of the header.

**Test Requirements:** unit (JWT verify: good/expired/wrong-sig/wrong-iss) / integration (two-member RLS isolation) / security (forged-header spoofing rejected; direct-URL access yields no data) / compliance (no token in logs/URLs).

**Database Needs:** the `user_id` column on all domain tables (see §9) sourced from `auth.jwt()->>'sub'`. **Dependencies:** the exact LabOS JWT contract — header name, issuer, audience, JWKS URL, and claim names — must be confirmed with PL Infra (Open Question #8). **Endpoints:** identity is ambient (forwarded header); no app login endpoint.

---

## 6. Out of Scope

- **NOT building** our own login, password, or account system — identity **piggybacks on LabOS auth** (a verified, forwarded signed JWT federated into Supabase; F-7). We do not build roles/permissions beyond per-member row isolation via RLS.
- **NOT building** custom/swappable advisor seats ("replace the Outsider with a CFO") — v2 candidate; charters are fixed in v1.
- **NOT building** any points, Rights, buyback, or PLAA-transactional surface; the council only *knows about* PLAA via the context pack.
- **NOT building** web search/browsing for advisors — deliberations run on the question + attachments + context pack only.
- **NOT building** Slack/email delivery of verdicts.
- **NOT storing** raw uploaded files long-term — extracted text persists in Postgres; raw files are transient (Supabase Storage is a v2 option).
- **NOT introducing** Airtable or spreadsheets — structured **Supabase Postgres** schema only, with RLS.

---

## 7. User Flows

### Primary Flow: Run a Full Council

1. User opens the app from the AI Apps dashboard; sees history rail (or demo empty-state) + input.
2. User types the decision, optionally attaches docs (≤20 MB), submits.
3. System restates the question in one line; user confirms (or edits and resubmits).
4. System streams Stage 1 (five advisor cards fill in), Stage 2 (revised cards), Stage 3 (verdict card).
5. User reads the seven-part verdict; expands any Advisor A–E card for the underlying reasoning — a real, complete record, never a partial one.
6. User can now ask a follow-up, tag the decision's outcome later, or start a new deliberation; the decision appears at the top of the user's last-5 history.

### Secondary Flow: Revisit & Update Outcome

1. User clicks one of their past decision in the history rail.
2. Full deliberation renders read-only; user sets outcome to "Went well/badly" with a one-line note.
3. Memory block updates; the next related deliberation's Stage-0 summary includes the outcome.

---

## 8. Success Metrics

| **Metric** | **Target** | **Measurement** |
| --- | --- | --- |
| Deliberations run / week (post-launch month 1) | ≥10 | app analytics (PostHog if wired; else DB count) |
| Full-run completion rate (submitted → verdict) | ≥90% | deliberation status field |
| Median full-council wall-clock time | ≤4 min | stage timestamps |
| Members returning for a 2nd deliberation | ≥40% of users | distinct-session heuristic |
| Outcome tags filled on past decisions | ≥30% | outcome field |

**Phase-1 gate:** deploys to the sandbox on time, passes one QA pass with minimal bugs, demo mode renders correctly inside the dashboard iframe, and ≥3 live full-council runs complete end-to-end in week one.

---

## 9. Implementation Notes

### Recommended Tech Stack (PLN sandbox contract)

| **Component** | **Recommendation** | **Rationale** |
| --- | --- | --- |
| Runtime (container) | Node.js + Express, single service in `app/`, thin: serves the SPA + `/health`, no secrets | Starter-kit contract: `npm install && npm start`, `$PORT`, bind `0.0.0.0`. Holds no DB/LLM credential (sandbox injects none) |
| Frontend | Server-served static SPA (vanilla or lightweight React build) using `styles/pln-theme.css` tokens; `@supabase/supabase-js` client | Minimal deps; reads as PL family in the iframe |
| Backend / secrets | **Supabase project `decision-council`** (`zhetwcmfrzrsokfzthhl`, us-east-2) — the thing *allowed* to hold secrets | Sidesteps "no runtime config": container ships only the public anon key |
| DB | **Supabase Postgres + Row-Level Security** | Managed, durable across redeploys (closes OQ#2); RLS scopes rows to the **LabOS member id**; `mappings`/`usage_counter` locked to `service_role` only |
| Auth / identity | **LabOS SSO** — gateway forwards a signed JWT; app verifies it and federates into Supabase **third-party auth**, so `auth.jwt()->>'sub'` = LabOS member (F-7) | Piggybacks on the member's existing LabOS login; no separate account; closes OQ#3. Verification is mandatory (forged headers rejected) |
| LLM | **Supabase Edge Function `claude-proxy`** → Anthropic Messages API; key held as an Edge secret; `claude-sonnet-4-6` default (11 calls/full run, 6/quick) | Owner-funded key never leaves Supabase; JWT + origin + global daily cap enforced in the function |
| Streaming | Server-Sent Events (Edge Function streams Anthropic SSE through) | Simple, iframe-friendly progress |
| File parsing | pdf-parse + mammoth (docx) + native txt/md | Minimal dependency set for the four formats |
| Testing | Vitest + Playwright + compliance assertions | Guardrail enforcement |

### Deploy contract (hard requirements from the starter kit — gate every deploy)

- Serve on `$PORT` (default 3000), bound to `0.0.0.0`.
- `GET /health` → 200; `GET /` renders the app (never a bare 404 in the iframe).
- **Iframe-embeddable from `*.plnetwork.io`:** send **no `X-Frame-Options`** header (if helmet is used, `frameguard: false`); any CSP must include `frame-ancestors 'self' https://plnetwork.io https://*.plnetwork.io`.
- Dockerfile at the ZIP root builds and starts the server; `node_modules`, `.env`, data dirs excluded from the ZIP; **no secrets shipped.** The Supabase **URL + public anon/publishable key** are shipped in the bundle — these are *not* secrets (they are public by design; RLS enforces access). The Anthropic key and `service_role` key are NEVER in the container/zip — they live only in Supabase (F-6).
- Deploy via the `deploy-to-labs` skill using `pln-app.config.json`; stable lowercase `appId` (proposed: `decision-council`); never print the deploy token; never reveal the deployment URL.

### Database Schema (Supabase Postgres + RLS)

Every domain table carries `user_id text` defaulted to the **LabOS member id** (`auth.jwt()->>'sub'`,
supplied by the verified, forwarded LabOS token via Supabase third-party auth) and RLS
scoping rows to that member (`using (user_id = auth.jwt()->>'sub')`) — **except** `mappings`
and `usage_counter`, which have RLS enabled with **no policy** so the client roles can never
read them; only Edge Functions (via `service_role`, which bypasses RLS) touch them.

> Two distinct privacy properties, don't conflate them: **member isolation** (a member sees
> only their own decisions — enforced by `user_id`-scoped RLS, F-7) and **advisor anonymity**
> (the persona↔letter join is unreadable client-side — enforced by the `mappings` lockdown,
> AC-1.2/1.3). Both are RLS, but they protect different things.

```sql
-- user-scoped (RLS: user_id = auth.jwt()->>'sub' — the LabOS member id)
create table deliberations (id uuid primary key default gen_random_uuid(),
  user_id text not null default (auth.jwt()->>'sub'),
  question text not null, restated text, mode text check (mode in ('full','quick')),
  status text, context_pack_version text, created_at timestamptz default now());
create table rounds (id uuid primary key default gen_random_uuid(),
  deliberation_id uuid references deliberations(id) on delete cascade,
  user_id text not null default (auth.jwt()->>'sub'), stage int, letter text, content text);
create table memory_blocks (deliberation_id uuid primary key references deliberations(id) on delete cascade,
  user_id text not null default (auth.jwt()->>'sub'), verdict_line text, dissent_line text,
  confidence_spread text, first_step text, outcome text default 'pending', outcome_note text);
create table attachments (id uuid primary key default gen_random_uuid(),
  deliberation_id uuid references deliberations(id) on delete cascade,
  user_id text not null default (auth.jwt()->>'sub'), filename text, bytes int,
  extracted_text text, extracted_chars int);
-- each domain table: enable RLS; policies using (user_id = auth.jwt()->>'sub')

-- server-only (RLS ON, NO policy → service_role only)
create table mappings (deliberation_id uuid, letter text, persona text);   -- anonymity: never client-readable
create table usage_counter (day date primary key default current_date,     -- global spend cap (F-6)
  call_count int not null default 0, token_count bigint not null default 0);

-- shared, read-only to clients (or kept server-only): context pack
create table context_pack (version text primary key, body text, reviewed_at timestamptz);
```

> **Provisioned so far (2026-07-08):** the Supabase project, a starter `conversations`
> table, the `usage_counter` table + locked `bump_usage()` function, and the `claude-proxy`
> Edge Function are live. **Note:** the starter `conversations` table's RLS was written for
> the earlier anonymous-auth model (`auth.uid()`); it must be re-pointed to the LabOS
> identity (`auth.jwt()->>'sub'`) once third-party auth is configured. The full domain
> schema above (deliberations, rounds, mappings, memory_blocks, attachments, context_pack)
> is created during Phase 1, following the same RLS pattern — `mappings` MUST land as
> RLS-on/no-policy, and every domain table's policy must key on the LabOS member id.
> **Blocked on Infra (OQ#8):** configure Supabase third-party auth to trust the LabOS JWT
> issuer (needs LabOS's JWKS URL, issuer, audience, and claim names).

### Key Implementation Considerations

- **Identity flow (F-7):** the LabOS gateway forwards the signed member JWT only on requests it proxies to the *container* — the browser's direct calls to `supabase.co` do **not** traverse the gateway, so they don't carry it. So on load the container verifies the LabOS JWT (JWKS + iss/aud/exp) and bootstraps the SPA's Supabase session with it (Supabase third-party auth trusts the LabOS issuer). Verification is non-negotiable: the sandbox URL is publicly reachable, so an unverified forwarded header is spoofable — an invalid/absent token yields demo mode, never trust.
- **Orchestration lives in Supabase Edge Functions, not the container.** The container holds no DB/LLM credential, so the stateful, secret-touching work (LLM calls, reading `mappings`, writing rounds) runs in Edge Functions that legitimately hold `service_role` + the Anthropic key. The browser reads its own history directly via RLS (scoped to its LabOS id); it never reaches `mappings` or `usage_counter`.
- Persona charters ship as five markdown files in the repo (verbatim from the `ai-council` skill's `advisors/` directory) + the shared PL context pack preamble; the `mappings` table is the only place persona↔letter is joined, and its RLS-on/no-policy lockdown makes it physically unreadable from the client (the anon key cannot select it) — stronger than "not serialized."
- Sanitization pass before Stage 2: strip persona names, charter phrases, and self-identifying language from round-1 texts (regex list + a cheap LLM scrub as belt-and-braces).
- Attachment text budget: cap injected text (~60k chars/deliberation to start) with visible truncation notice; largest files truncated first.
- All five Stage-1 calls fire in parallel (Promise.allSettled) with per-call retry-once; a stage completes only when 5/5 land.
- No analytics SDK in v1 unless PostHog is trivially embeddable; DB counts satisfy §8.

---

## 10. Claude Code Execution

### Option A: Agent Teams (recommended)

Enable: `export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`

```
Read PRD-PLN-DecisionCouncil-v1.md and the starter kit's CLAUDE.md/AGENTS.md. Build the app
in the starter kit's app/ directory with an Agent Teams workflow.

Before starting:
1. Create TeamWork.md in the project root (template below).
2. Teammates: db-builder, backend-builder (deliberation engine + LLM proxy),
   frontend-builder, test-writer, integrator. Team Lead coordinates (delegate mode);
   Team Lead does not write feature code.
3. Copy the five advisor charter files verbatim into app/personas/ and draft the PL
   context pack per PRD §F-5 into app/context/pl-context-pack.md (stamp "pending Legal
   (Javier) review").

ENFORCE GUARDRAILS IN EVERY PHASE:
- Deploy contract: listen on $PORT, bind 0.0.0.0, GET /health → 200, usable GET /,
  NO X-Frame-Options header, CSP frame-ancestors includes 'self' https://plnetwork.io
  https://*.plnetwork.io. Dockerfile at app/ root; no secrets, .env, or data dirs in
  the deploy ZIP.
- Anonymity: persona names never reach the client — DOM/test assertion; `mappings` table is
  RLS-on/no-policy (client cannot select it), joined only in Edge Functions via service_role.
- Identity (F-7): verify the forwarded LabOS JWT server-side (JWKS + iss/aud/exp) before
  establishing a session; NEVER trust an unverified header. Scope every domain row to
  `auth.jwt()->>'sub'` via RLS — two-member isolation test + forged-header spoofing test.
  Invalid/absent token → demo mode, not access. Never log the token or put it in a URL.
- Key handling: Anthropic key lives ONLY as a Supabase Edge Function secret; never in the
  container image, shipped bundle, browser, DB, logs, or URLs — log-scan + image-scan test.
  Only the public Supabase URL + anon key are shipped.
- Auth/spend: run under the member's LabOS-federated session; `claude-proxy` requires a valid
  member JWT, checks Origin ∈ *.plnetwork.io, and enforces the global daily cap (429 over budget).
- Vocabulary: context pack uses "collect" never "earn"; test asserts "earn" absent from
  user-facing copy and the context pack; the shared preamble is present in all LLM payloads.
- Supabase Postgres + RLS only; no spreadsheets; snapshot-style config (model string,
  text budget, DAILY_CALL_CAP) is data/secret, not hardcode.

Phase 1 — Foundation: db-builder (schema per PRD §9) + test-writer (failing tests from
  all ACs incl. AC-*.C). GATE: npm run test:db.
Phase 2 — Core: backend-builder (deliberation engine F-1, key proxy F-6, attachments F-4,
  context pack F-5) + frontend-builder (F-2 chat UI, F-3 history, demo mode) via mocks
  + test-writer. GATE: npm run test:api && npm run test:components.
Phase 3 — Integration: integrator wires UI→API, removes mocks, records the demo-mode
  deliberation fixture; test-writer E2E per §7 flows incl. SSE reconnect and iframe-header
  checks. GATE: npm run test:e2e.
Phase 4 — Validation & deploy-readiness: test:all, coverage ≥80%, every AC passing;
  verify locally: cd app && npm install && npm start; curl /health → 200; confirm no
  X-Frame-Options; confirm ZIP excludes node_modules/.env/data. Deploy ONLY when the
  member says "deploy this app," via the deploy-to-labs skill (appId: decision-council);
  never print the deploy token or reveal the deployment URL.
```

#### TeamWork.md template

```
# TeamWork — PLN Decision Council
| Field | Value |
|-------|-------|
| PRD | PRD-PLN-DecisionCouncil-v1.md |
| Current Phase | 1 — Foundation |
| Compliance gate | Context pack copy → Javier |

## Feature Progress
| ID | Name | DB | API | UI | Tests | Integration | Status |
|----|------|----|-----|----|-------|-------------|--------|
| F-1 | Deliberation engine | ⏳ | ⏳ | — | ⏳ | ⏳ | Not Started |
| F-2 | Chat interface | — | — | ⏳ | ⏳ | ⏳ | Not Started |
| F-3 | History (last 5) | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | Not Started |
| F-4 | Attachments | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | Not Started |
| F-5 | PL context pack | ⏳ | — | — | ⏳ | ⏳ | Not Started |
| F-6 | Key & demo mode | — | ⏳ | ⏳ | ⏳ | ⏳ | Not Started |
| F-7 | LabOS identity | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | Not Started (blocked: OQ#8 Infra) |

## Phase Gates
| Phase | Gate | Result |
|-------|------|--------|
| 1 | test:db | ⏳ |
| 2 | test:api + test:components | ⏳ |
| 3 | test:e2e (incl. iframe headers, anonymity DOM scan, key log-scan) | ⏳ |
| 4 | test:all + coverage ≥80% + local /health + deploy-ZIP hygiene | ⏳ |

## AC → Test Mapping
| AC | Test | Status |
|----|------|--------|
| AC-1.2 anonymity | /tests/compliance/anonymity.test.ts | ⏳ |
| AC-1.C preamble in all payloads | /tests/compliance/preamble.test.ts | ⏳ |
| AC-5.C vocabulary scan | /tests/compliance/vocabulary.test.ts | ⏳ |
| AC-6.2 key never persisted | /tests/compliance/key-logscan.test.ts | ⏳ |
| AC-7.2 member RLS isolation | /tests/security/member-isolation.test.ts | ⏳ |
| AC-7.3 forged-token rejected | /tests/security/token-spoofing.test.ts | ⏳ |
```

### Option B: Task Tool (fallback)

Spawn parallel Tasks per phase with the same five roles, same gates, and the same guardrail block (deploy contract, anonymity, identity/LabOS-JWT verification, key handling, vocabulary). Test Task writes failing tests first each phase.

---

## 11. Open Questions

| **Question** | **Status** | **Answer** |
| --- | --- | --- |
| **#1 LLM access:** BYO-key vs. hosted key. | **Resolved (v1.1)** | Hosted: Anthropic key held as a Supabase Edge Function secret (`claude-proxy`); no member setup. Owner funds usage, bounded by a global daily cap + JWT + origin checks. BYO-key retired. |
| **#2 Persistence durability:** history durable across redeploys? | **Resolved (v1.1)** | Managed Supabase Postgres — durable independent of the container lifecycle; redeploys no longer reset data. |
| **#3 Tenancy/privacy:** how is per-member data isolation achieved? | **Resolved (v1.2)** | Identity piggybacks on LabOS auth (verified forwarded JWT, federated into Supabase third-party auth); RLS scopes every row to the LabOS member id (F-7). A member sees only their own decisions, across devices. |
| **#4 Model & cost:** ~11 Sonnet calls per full run on the **owner's** key → set the global `DAILY_CALL_CAP` (default 500 calls/day ≈ 45 full runs). Now that usage is attributable to a LabOS member, decide whether to add a **per-member** daily quota alongside the global cap. Confirm default model + whether Quick council defaults for first-time users. | Open | – |
| **#7 Abuse hardening:** with real LabOS identity gating access, drive-by abuse is largely mitigated (only logged-in members reach live councils). Confirm the global cap + per-member quota is sufficient, or whether an org/allowlist restriction is also wanted. | Open | – |
| **#8 LabOS JWT contract (BLOCKS F-7):** confirm with PL Infra the exact forwarded-token details — header name, issuer, audience, JWKS/public-key URL, claim names (which claim is the stable member id), and token lifetime — so the app can verify it and Supabase third-party auth can be configured. Note: the documented deploy contract does not mention this; needs one message to Infra. | Open | – |
| **#5 Context-pack sourcing:** the pack cites public sources (protocol.ai, PL blog talks, alignment-asset overview). Any internal framing (e.g., current network org count — site says both 600+ and 750+) Theresa/Christina want standardized? | Open | – |


---

## 12. Timeline & Phases

### Phase 1: Build & local validation (Target: +1 week)

- ☐ F-1 engine, F-5 context pack, F-6 key/demo, F-2 UI core, F-3 history, F-4 attachments (per §10 phases)
- ☐ All AC tests passing; local deploy-contract checks green

### Phase 2: Sandbox pilot (Target: +2 weeks)

- ☐ Javier sign-off on context pack → deploy via `deploy-to-labs`
- ☐ Week-one gate: ≥3 live full-council runs; demo mode verified in the dashboard iframe
- ☐ **Before build:** resolve Open Question #8 (LabOS JWT contract) with PL Infra — F-7 is blocked on it.
- ☐ Decide Open Questions #4, #7 (cost/quota, abuse) from pilot experience; scope v2 (custom seats)

---

## Appendix A — Handoff Prompts (whole-app pair; feature IDs referenced inline)

### A.1 — Claude Design prompt (interactive prototype)

```
Design an interactive prototype of "Decision Council" — a members-only AI deliberation app
for the Protocol Labs Network, shown inside the PL Infra → AI Apps dashboard via iframe.

WHAT IT DOES
A member submits a strategic judgment call (text input + optional document attachments,
up to 20 MB). Five anonymous AI advisors — shown only as Advisor A–E — deliberate it in
three visible stages: (1) blind opinions, (2) anonymized peer review with revised opinions,
(3) a Chairman's verdict with seven sections: the question, where the council converged,
live disagreements, the verdict, first step, biggest risk, unresolved questions. A history
rail shows the last 5 decisions with outcome tags (Pending / Went well / Went badly).

SCREENS/STATES
1. Empty/demo state — no decisions yet; explains the council; one-click example deliberation
   plays through the full experience. The member is already identified via their LabOS
   session (no API key, no sign-in prompt); if not signed in to LabOS, show a "sign in to
   LabOS to run and save councils" note while demo mode still plays.
2. Intake — question typed; the app restates it in one line for confirmation; mode toggle
   (Full council / Quick council); attachment chips with size + "words included" notes and a
   persistent note that document contents are sent to the AI provider.
3. Deliberation streaming — staged progress ("Round 1: blind opinions · 3/5 in"), advisor
   cards A–E filling in per round (collapsible), then the anchored verdict card.
4. Verdict + follow-up — seven-section verdict; follow-up input continues the thread.
5. History — last 5 decisions (date, question one-liner, verdict one-liner, confidence
   spread, outcome tag); opening one shows the full read-only record.
6. Error/paused — an advisor call failed: clear status + retry, never a partial verdict.

RULES (enforce in all copy/UI)
- Advisors are ONLY ever "Advisor A"–"Advisor E." No persona names anywhere.
- If the app references the PL Alignment Asset, members COLLECT points (never "earn");
  no price predictions or value/liquidity claims about any PL asset.
- Tone: serious decision-support for professionals — restrained, institutional-but-warm.
  No gamification, no hype.

VISUAL SYSTEM
Match the PL family: brand primary blue #1B4CFE (NOT red, NOT yellow), white surfaces,
near-black text, yellow only as a small secondary highlight; Inter typeface
(Regular/Medium/Semi Bold, tight negative letter-spacing). Letter avatars (A–E) in brand
blue for advisor cards; the verdict card is elevated with a blue header band. Design for
an iframe context (no separate top nav — the dashboard provides chrome).

CONTENT
Use realistic PL-flavored sample content, e.g., the question "Should we sunset the Google
Forms submission flow mid-snapshot or wait for the next period?" with plausible advisor
disagreements and a verdict. Placeholder names only, never real member data.

Deliver a clickable prototype: the deliberation streams stage-by-stage, cards expand,
the history rail populates after a run, and the error/paused state is reachable.
```

### A.2 — Claude Code prompt (full-stack build)

```
Build a working full-stack implementation of "Decision Council" from
PRD-PLN-DecisionCouncil-v1.md, inside the PLN AI Apps Starter Kit's app/ directory,
following the kit's CLAUDE.md/AGENTS.md and the Agent Teams plan in PRD §10.

Stack: thin Node.js + Express container (serves the SPA + /health, holds NO secrets; also
verifies the forwarded LabOS JWT and bootstraps the member's Supabase session); Supabase
Postgres + RLS for storage scoped to the LabOS member id; identity via LabOS SSO (forwarded
signed JWT federated into Supabase third-party auth — F-7); a Supabase Edge Function
`claude-proxy` (holds the Anthropic key as a secret, member-JWT + origin + global daily-cap
enforced) for all LLM calls and mappings access; server-served SPA styled with
the kit's styles/pln-theme.css tokens (brand blue #1B4CFE, white surfaces, near-black text,
Inter; yellow secondary only). SSE for stage streaming. Supabase project: `decision-council`
(ref zhetwcmfrzrsokfzthhl); ship only the public anon key + project URL.

Implement F-1 through F-7 exactly as specified: the 4-stage council protocol (blind
parallel round 1, sanitized+anonymized round 2, Chairman verdict, memory write, randomized
per-deliberation persona→letter mapping stored server-side only), quick mode, follow-ups,
triage of factual questions; the chat UI with staged streaming and Advisor A–E cards; the
last-5 history with outcome write-back; attachments (pdf/docx/md/txt, ≤20 MB total, text
extraction + visible truncation); the versioned PL context pack injected into every LLM
call; member identity via LabOS SSO (F-7 — verify the forwarded signed LabOS JWT server-side
against LabOS's JWKS with iss/aud/exp checks, federate into Supabase third-party auth, scope
all rows to the LabOS member id via RLS; invalid/absent token → demo mode, never trusted);
hosted LLM access via the `claude-proxy` Edge Function (Anthropic key as a Supabase secret,
member-JWT-gated, origin-checked, global daily cap) with a demo mode (pre-recorded
deliberation fixture) as the zero-state/over-cap fallback.

Hard deploy contract (test these): listen on $PORT bound to 0.0.0.0; GET /health → 200;
GET / renders; send NO X-Frame-Options header; any CSP includes frame-ancestors 'self'
https://plnetwork.io https://*.plnetwork.io; Dockerfile at app/ root; deploy ZIP excludes
node_modules, .env, and data dirs. Ship ONLY the public Supabase URL + anon key; the
Anthropic key and service_role key never enter the image, bundle, or zip.

Copy/behavior rules (enforce in code + tests): persona names never reach the client (DOM
scan test); the `mappings` table is RLS-locked (client select fails); members see only their
own decisions (two-member RLS isolation test) and a forged/absent LabOS token is never
trusted (spoofing test); "earn" absent from user-facing copy and the context pack ("collect"
is the PLAA vocabulary); no key material, LabOS tokens, attachment contents, or PII in URLs
or logs (log-scan + image-scan test); the shared context-pack preamble present in all 11
calls of a full run; no partial verdicts — failed stages pause with retry.

NOTE (blocker): F-7 needs the LabOS JWT contract (header name, issuer, audience, JWKS URL,
member-id claim) from PL Infra — Open Question #8. Until confirmed, implement verification
behind a config shim and keep anonymous auth as an interim local-dev fallback.

Tests: unit + integration + E2E mapped to every AC including AC-*.C compliance criteria;
target ≥80% coverage. Deploy only on explicit request, via the deploy-to-labs skill
(appId: decision-council); never print the deploy token or reveal the deployment URL.
```

---

## Appendix B — Glossary

| **Term** | **Definition** |
| --- | --- |
| Council | The five-advisor deliberation system (Contrarian, First-Principles Thinker, Expansionist, Outsider, Executor) — surfaced to users only as Advisor A–E. |
| Blind opinion | A round-1 opinion written with no visibility into other advisors' outputs. |
| Chairman | The synthesis role that weighs argument quality over vote count and issues the verdict. |
| Mapping | The per-deliberation randomized persona→letter assignment; server-only, never shown. |
| Memory block | The structured per-decision record (verdict, dissent, outcome) feeding future deliberations. |
| Context pack | The versioned PL mission/history/vision preamble shared by every advisor (F-5). |
| Collect | PLAA vocabulary: members collect points (never "earn") — applies wherever the app mentions PLAA. |
| Deploy contract | The starter kit's hard requirements: $PORT, 0.0.0.0, /health, iframe-embeddable, no shipped secrets. |
| Anon (publishable) key | Supabase's public client key, safe to ship in the browser; access is enforced by RLS, not by hiding it. Distinct from the `service_role` key (a real secret, Supabase-only). |
| RLS | Row-Level Security — Postgres policies that scope each row to its owner (here `auth.jwt()->>'sub'` = the LabOS member id), so one public key serves all members without cross-member reads. |
| LabOS identity (F-7) | The logged-in member's identity, delivered as a signed JWT the LabOS gateway forwards to the app. The app verifies it (JWKS + iss/aud/exp) and federates it into Supabase third-party auth so `auth.jwt()->>'sub'` is the member id. An unverified forwarded header is never trusted. |
| Third-party auth | Supabase feature letting an external issuer's JWT (here LabOS) act as the Supabase session, so RLS reads its claims directly — no separate Supabase login. |
| claude-proxy | The Supabase Edge Function that holds the Anthropic key and gates LLM calls (JWT + origin + global daily cap). The one place the key is used. |

## Appendix C — References

- `ai-council` skill (SKILL.md + `advisors/*.md`) — protocol and persona charters, adopted verbatim.
- PLN AI Apps Starter Kit — `CLAUDE.md`/`AGENTS.md` (deploy contract), `styles/pln-theme.css`, `pln-app.config.json`, `deploy-to-labs` skill.
- https://www.protocol.ai/ and https://www.protocol.ai/about/ — mission, network scale, timeline (2014 founding → July 2024 decentralized-network transition).
- https://www.protocol.ai/blog/pl-past-present-future/ — Juan Benet, PL Leads Summit 2023: mission/vision, innovation-network model, R&D pipeline, crypto+VC model, safe outcomes and digital human rights.
- https://www.protocol.ai/blog/transcription-juan-benet-public-goods/ — cryptoeconomics and sustainable public-goods funding.
- https://a16zcrypto.com/posts/videos/dreaming-big-with-protocol-labs/ — Benet on the founding path and vision.
- https://directory.plnetwork.io/alignment-asset/overview — PLAA framing and approved vocabulary reference.
- PRD — Alignment Asset Web App (v2) — house style and Agent Teams pattern reference.
