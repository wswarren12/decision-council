---
name: app-metadata
description: Set or change the app's display name, short description, and optional one-pager PRD shown on the AI Apps dashboard. Use before the FIRST deploy (no approved name saved yet) and whenever the member asks to rename the app, edit its description, or add/update/remove its PRD. Metadata saves go through their own endpoint — no ZIP upload and no redeploy.
---

# App name, description & one-pager PRD

The AI Apps dashboard shows each app's **name**, a short **description**, and —
optionally — a **one-pager PRD** (a short product brief: why the app exists and
what it is meant to do). These are member-facing: YOU draft them, the MEMBER
approves them, and only then do you save them. Saving metadata never rebuilds
or redeploys the app.

## When to run this flow

- **Before the first deploy** (no `appName` saved in `pln-app.config.json` yet):
  do "Propose & approve" below, use the approved values in the deploy form, and
  offer the one-pager PRD once the deploy succeeds.
- **The member asks to change** the name, description, or PRD of an existing
  app: same propose → approve → save flow, via the metadata endpoint.
- **NOT on ordinary redeploys.** Reuse the approved `appName` /
  `appDescription` from `pln-app.config.json` **verbatim** in the deploy form
  and don't re-ask. A deploy overwrites the stored name/description with
  whatever the form sends, so sending fresh drafts silently reverts metadata the
  member already approved. The PRD is never touched by deploys — nothing to
  re-send.

## Propose & approve (name + description)

1. Draft from what the app actually does (its code + the conversation):
   - **Name** — 2–4 plain, human-friendly words (e.g. "Team Availability
     Board"), max 200 chars. Not the `appId` slug, no version numbers.
   - **Description** — 1–2 sentences: what it does and who it's for. Keep it
     well under 2000 chars.
2. Show both to the member and ask them to approve or revise.
3. **Wait for explicit approval.** If they want changes, revise and re-present —
   as many rounds as needed. Never upload a name or description the member has
   not confirmed.
4. After approval, write the values into `pln-app.config.json` (`appName`,
   `appDescription`) so later redeploys reuse them without re-asking.

## Offer the one-pager PRD (optional)

Ask once, in plain words — e.g. *"Want me to add a one-pager PRD? It's a short
brief explaining why the app exists and what it does — shown alongside your app
on the dashboard."* If the member declines, you're done — deploys and updates
work fine without a PRD.

If they want one, produce a short, one-page **Markdown** brief. The author is
usually a non-technical member who vibe-coded the app, so the brief explains
**why** the app was built and **what** it is meant to do — not how it is
engineered or tested.

### How to write the brief

1. Read back through the conversation (and the app) to understand what it does,
   who it is for, and why it was built.
2. **Synthesize what you already know.** Do NOT interview the member with a long
   questionnaire. Ask at most one or two questions, and only when Goals / OKR
   Impact or Success Metrics is genuinely missing and cannot be inferred —
   otherwise mark that section "To be confirmed" rather than guessing.
3. Write in plain language. Avoid jargon, framework names, and internal
   engineering detail. If the member did not say something technical, do not
   invent it.
4. Fill in the template below. Keep the whole thing to roughly one page. Every
   section should be a few sentences or a short list — this is a brief, not a
   spec. Comfortably under 100,000 characters.
5. Save the brief locally as `prd.md`, give the member a faithful summary in
   chat, and get **explicit approval** — revise and re-present on feedback —
   then upload it (below). Never upload an unapproved PRD.

### One-pager template

```markdown
# <App Name>

_One-line description of what the app does._

## Problem Statement

The problem the app is meant to solve, from the user's perspective. What was
hard, slow, or missing before this app existed.

## Solution

A brief executive summary of the app — a few lines describing what it is and
how it addresses the problem above. High level, not a feature-by-feature
breakdown (that comes next).

## Key Features

A short bulleted list of what the app can do — the main capabilities a user
gets. Keep each to a line. This is the "what's in the box" section.

## How to Use

A simple, numbered walkthrough of how someone actually uses the app, start to
finish. Written for a first-time user who has never seen it. Include where to
find it, what to do, and what they will see. Skip anything technical — this is
the "getting started" section.

## Implementation Decisions

Notable choices the builder made, described in plain terms — not code. For
example: what data the app uses, what it deliberately keeps simple, any
assumptions it makes, or anything a future editor should know. Skip this
section if there is nothing meaningful to say.

## Goals / OKR Impact

The goal, objective, or OKR this app is meant to move, and how it contributes.
If it supports a specific team or org OKR, name it. If none is confirmed yet,
mark this "To be confirmed."

## Success Metrics

How you will know the app is working. A few concrete signals — usage, time
saved, adoption, a number going up or down. Keep it to what can actually be
observed.

## Out of Scope

What this app deliberately does NOT do, so expectations are clear. Useful for
heading off "can it also…" questions later.
```

## Saving via the metadata endpoint

`metadataEndpoint` in `pln-app.config.json` is a URL **template** — replace the
literal `{appUid}` with the app's `uid` (the `uid` field of the deploy/draft
response, saved as `appUid` in the config after the first upload). Auth is the
same short-lived deploy token used for deploys, in the `x-app-token`
header — for a metadata-only session (no deploy planned), run the connect flow
from the deploy-to-labs skill to get one.

Name/description only:

```bash
curl -sX PATCH "<metadataEndpoint with {appUid} replaced>" \
  -H "x-app-token: <deployToken>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Team Availability Board","description":"See at a glance who on your team is free this week."}'
```

With a PRD, build the JSON body in a file — the `prd` value is the whole
Markdown document as one JSON string, so don't hand-escape it in the shell:

```bash
node -e 'const fs=require("fs");fs.writeFileSync("body.json",JSON.stringify({prd:fs.readFileSync("prd.md","utf8")}))'
curl -sX PATCH "<metadataEndpoint with {appUid} replaced>" \
  -H "x-app-token: <deployToken>" \
  -H "Content-Type: application/json" \
  --data @body.json
```

All three fields are optional — send only what changed. `"prd": null` removes
the PRD, `"description": null` clears the description. The response is the
updated app record; the dashboard reflects it immediately.

## Rules

- **Approval first, always.** Name, description, and PRD are what other PLN
  members see — never save a draft the member hasn't explicitly approved.
- **Metadata saves are instant and deploy-free**: no ZIP, no build, no downtime.
  Never redeploy "to apply" a name/description/PRD change.
- The endpoint edits only apps owned by the member who approved the token, and
  404s before the first deploy/draft upload (the app record is created by the
  first upload) — a brand-new app gets its approved name/description through
  the deploy form, and its PRD right after via this endpoint.
- Keep `pln-app.config.json` in sync: after any approved rename or description
  change, update `appName`/`appDescription` there too.
- The deploy token stays in memory only — never write it to the config or any
  file (same rule as the deploy skill).
