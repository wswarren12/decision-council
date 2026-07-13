# Decision Council — Build Notes (updated 2026-07-10)

Built from `PRD-PLN-DecisionCouncil-v1.md` (v1.2). Status: **v1 is
identity-less by decision (2026-07-10)** — no JWT source exists yet (LabOS
contract unresolved, anonymous auth off), so per-user history (F-3) and LabOS
identity (F-7) are **deferred to v2**. Live councils run for everyone under a
shared anonymous session; nothing user-identifying is collected or shown.

## v1 identity-less mode — what changed

- **No history UI**: the last-5 rail, keyword search, outcome tagging, and
  read-only reopen are removed from the SPA (markup, styles, and all client
  DB reads — `supabase-js` is no longer loaded at all).
- **Auth**: the browser calls the `council` Edge Function with the public
  anon key as its Bearer (a valid project JWT, role `anon`). The function maps
  it to the shared owner id `anonymous`.
- **Cross-member leak guard**: Stage-0 relevant-history summaries are
  **disabled** for the anonymous id — with one shared owner, "your past
  decisions" would be everyone's. Deliberations/rounds/memory_blocks still
  persist (RLS keeps them unreadable client-side) and become per-user data
  the moment real identity lands in v2.
- **Spend guards without identity**: Origin allowlist (*.plnetwork.io +
  localhost) and the global daily call cap (`DAILY_CALL_CAP`, default 500)
  are now the only abuse bounds — accepted tradeoff for the pilot (PRD OQ#7).
- Follow-ups work within the live session (the deliberation id is held
  client-side only; ids are unguessable UUIDs).

## What runs where

| Piece | Location | Holds secrets? |
|---|---|---|
| Thin container (SPA, `/health`, LabOS JWT shim*, attachment text extraction) | `app/` | No — ships only the public Supabase URL + anon key |
| Deliberation engine (intake/triage, stages 1–3 SSE, memory write, follow-ups) | Supabase Edge Function `council` v2 (source in `supabase/functions/council/`) | Yes — service_role + ANTHROPIC_API_KEY |
| Raw LLM passthrough (pre-existing) | Edge Function `claude-proxy` | Yes |
| Data (RLS per member; mappings/context_pack RLS-on/no-policy) | Supabase Postgres | — |

\* `app/labos.js` stays in place (config-shimmed, inert until the LABOS_* env
vars exist) so v2 can light identity up without re-architecting.

Single-source engine logic: `app/lib/council-core.mjs` is deployed inside the
`council` function AND imported by the Vitest suite; `app/lib/personas.mjs` is
generated verbatim from `app/personas/*.md` (the ai-council skill charters).

## Verified (33 Vitest tests + live smoke tests)

- Deploy contract: `$PORT`/`0.0.0.0`, `/health` 200, `/` renders, **no
  X-Frame-Options**, CSP `frame-ancestors 'self' https://plnetwork.io
  https://*.plnetwork.io`.
- Compliance: no form of "earn" in the context pack or any client asset; no
  persona name in any client asset (incl. demo fixture); sanitizer strips
  charter phrases; no key material in the shippable app.
- Engine units: mapping randomization (AC-1.4), largest-first attachment
  truncation, preamble in every prompt (AC-1.C/5.1), Outsider gets no history
  in round 1, verdict memory-block parsing.
- Live (2026-07-10): anon-key session reaches the engine and gets the
  structured `{error:"no_api_key", demo:true}` fallback; foreign Origin → 403;
  `mappings` SELECT as anon returns nothing (anonymity lockdown).

## Before live councils work

1. **Set the `ANTHROPIC_API_KEY` secret** — Supabase dashboard → Edge
   Functions → Secrets (or `supabase secrets set`). This is now the ONLY
   blocker. Optional: `DAILY_CALL_CAP` (default 500), `COUNCIL_MODEL`
   (default `claude-sonnet-4-6`).

## v2 backlog (deferred with rationale)

- **F-7 LabOS identity** — blocked on PRD OQ#8 (JWT contract from PL Infra);
  the container shim + Supabase third-party auth config are ready to fill in.
- **F-3 per-user history** — schema, RLS policies, and memory write-back are
  already live server-side; restore the rail UI + client reads once identity
  exists. Re-enable Stage-0 history summaries at the same time (they are
  keyed off `sub !== "anonymous"` in the council function).
- Per-member daily quota (PRD OQ#4) becomes possible only with identity.

## Compliance gates still open

- Context pack copy (`app/context/pl-context-pack.md`, seeded as version
  `1.0-draft`) → one-time Legal review (Javier). Edit the `context_pack` DB
  row to update copy without a code deploy (AC-5.2).

## Deploy

Only on explicit request: `deploy-to-labs` skill, appId `decision-council`.
`app/.dockerignore` already excludes node_modules/tests/env files from the zip.
