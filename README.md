# Decision Council

A PLN AI App (starter kit v1.9) that convenes a **council of five AI advisors**
to deliberate on a decision you're facing. Each advisor argues from a distinct
perspective — first-principles, contrarian, executor, expansionist, outsider —
then the council synthesizes a recommendation you can act on. It can also
generate a **Decision Table** (exportable as `.docx` or Markdown) instead of a
full deliberation.

Deployed as **Decision Council** on the PL Infra → AI Apps dashboard
(`appId: decision-council`).

## How it works

- Everything lives in `app/` — a self-contained Express (Node 20+, ESM) app
  with a plain-HTML/JS frontend in `app/public/` styled with the PLN theme
  (`pln-theme.css`).
- The browser only ever talks to this server. Deliberation runs server-side
  (`council.js`) against the Anthropic API; advisor persona prompts live in
  `app/personas/` and never reach the client (advisors surface only as A–E).
- Uploaded context files (PDF/DOCX/text) are extracted server-side
  (`extract.js` via `pdf-parse`/`mammoth`) and fed into the deliberation.
- Optional LabOS identity (`labos.js`/`identity.js`) enables per-member
  profile, history, and daily call caps; without it the app runs identity-less.
- Baseline usage analytics (`public/analytics.js`, kit v1.9) fire-and-forget
  `opened`/`error`/`closed` events — the app works identically if unreachable.

Key endpoints: `GET /health`, `GET /api/config`, `GET /api/session`,
`GET /api/me`, `GET /api/me/history`, `POST /api/council`,
`GET /llms.txt`, `GET /api/agent`, `POST /api/agent/runs`,
`POST /api/extract`, `POST /api/decision-table.docx`, and
`POST /api/decision-table.md`.

## Using it from a personal agent

The browser flow is not required. Hermes or another personal agent can discover
the machine API at `GET /llms.txt` or `GET /api/agent`, then run the complete
intake → council → verdict → decision-table pipeline server-side.

Give your agent this instruction, replacing `APP_URL` with the app's base URL:

```text
Use the Decision Council at APP_URL for decisions that benefit from several
perspectives. First read APP_URL/llms.txt and APP_URL/api/agent. Submit my
decision and all relevant background to POST APP_URL/api/agent/runs. Use
flow="table" when I want a researched decision table, or flow="council" when I
mainly want council input; use mode="quick" unless I ask for the full peer-review
round. If the response is "answered", return its answer. Otherwise poll the
returned poll URL about every 15 seconds until complete or failed. On completion,
return the verdict, recommendation, important dissent or open questions, and the
color-rated table. Interpret green as best, yellow as medium, and red as worst
within each row; ties are allowed. If context_request is returned, ask me for the
missing information before starting a replacement run when it could materially
change the result. Never invent owner context. On a retriable failure, call the
provided retry endpoint once. Use the followup endpoint for questions about a
completed deliberation.
```

Minimal request:

```bash
curl -X POST "$APP_URL/api/agent/runs" \
  -H 'content-type: application/json' \
  -d '{
    "question": "Should we adopt a monorepo now?",
    "context": "Four-person team, six independently deployed repos, duplicated CI.",
    "mode": "quick",
    "flow": "table"
  }'
```

A deliberation returns `202` with `run_id`, `poll`, and `poll_seconds`. Poll the
returned path until `status` is `complete`; the final JSON includes `verdict`,
`table`, and ready-to-use `table_markdown`. Each row's `ratings` array is parallel
to `cells`: `green` = best, `yellow` = medium, `red` = worst, and `null` = a
non-evaluative cell. Multiple cells may share a rating when options tie.

Useful calls:

```bash
curl "$APP_URL/api/agent/runs/$RUN_ID"
curl -X POST "$APP_URL/api/agent/runs/$RUN_ID/retry"
curl -X POST "$APP_URL/api/agent/runs/$RUN_ID/followup" \
  -H 'content-type: application/json' \
  -d '{"question":"What evidence would reverse the recommendation?"}'
```

The manifest documents response shapes and Markdown/Word export endpoints.
Anonymous calls work under the global daily cap; LabOS member calls also receive
profile/history behavior and the per-member run cap.

## Run it locally

Requires **Node 20.6+** (uses `--env-file`).

```bash
cd app
npm install
# edit local.env (see below), then:
npm run local            # starts on http://localhost:3000
```

In `local.env` set:

- `ANTHROPIC_API_KEY` — required for live deliberations. Without it the app
  still runs; use the built-in **demo session** to see a canned deliberation.
- `DEV_MEMBER` — optional fake identity (any name) to test profile/history
  locally, since there's no LabOS cookie on localhost.
- Optional: `PORT`, `COUNCIL_MODEL`, `INTAKE_MODEL`, `RESEARCH_MODEL`,
  `TABLE_MODEL`, `ANTHROPIC_TIMEOUT_MS`, `DAILY_CALL_CAP`.

`local.env` is git- and docker-ignored — it never ships. In production the key
arrives via the LabOS secrets flow, not from any file.

Verify: `curl localhost:3000/health` → `{"ok":true}`, then open
`http://localhost:3000`.

Tests: `npm test` (vitest — unit + deploy-contract checks).

## Deploying

Say "deploy this app" to your AI agent. It follows
`.claude/skills/deploy-to-labs/` — LabOS connect flow for a short-lived token,
zips `app/`, uploads it. Because the app needs `ANTHROPIC_API_KEY` at runtime,
it registers via the **draft flow**: you get a LabOS link where you paste the
key and click Deploy. Keys are never pasted into chat or written to files.

## Kit contents (v1.9)

- `CLAUDE.md` / `AGENTS.md` — instructions the AI agent reads automatically.
- `pln-app.config.json` — LabOS endpoints + this app's identity (no secrets).
- `.claude/skills/` — deploy-to-labs, app-analytics, app-logs, app-metadata,
  db-migration, pl-design-system, pln-member-context.
- `pl-design-system/` — PL Design System React components + tokens (this app
  uses the plain-HTML fallback `styles/pln-theme.css` instead).
- `styles/` — `pln-theme.css` CSS-variable theme + font guidance.
