# PLN AI Apps — Starter Kit

Welcome! This kit lets you vibe-code an app with your AI assistant and deploy it
to the Protocol Labs Network sandbox with a single instruction.

## What's inside
- `CLAUDE.md` / `AGENTS.md` — instructions your AI agent reads automatically.
- `.claude/skills/deploy-to-labs/` — the deploy skill your agent uses.
- `pln-app.config.json` — your personal deploy token + the deploy endpoint.
- `styles/` — PLN design tokens (CSS variables) and font guidance.
- `app/` — a minimal runnable Node app to start from (its `server.js`,
  `package.json`, and `Dockerfile` are placeholders you can replace).

## How to use
1. Unzip this folder and open it in Claude Code (or your AI tool of choice).
2. Add your app to the `app/` folder:
   - **New app:** tell your agent what to build (e.g. "build a leaderboard page
     using the PLN styles"). It works in `app/`.
   - **Existing app:** copy your project's files into `app/`, then say "migrate this
     existing app and deploy it to LabOS". Your agent takes care of whatever setup is
     needed to run it there.
3. When you're happy, say "deploy this app". Your agent ships it to the PLN sandbox;
   the first deploy can take a minute or two.
4. Your app appears on the PL Infra → AI Apps dashboard, where you can open it.

> **Don't copy passwords or secret keys into `app/`** — apps run on shared
> infrastructure with no credentials provided. If your app needs them, ask your
> agent how to handle it.

## Embedding in the dashboard
Your app is shown inside the AI Apps dashboard. Apps built with this kit display
correctly out of the box, and your agent checks this for you on every deploy — so you
don't need to do anything special. (The technical rule lives in `AGENTS.md` for your
agent's reference.)

## Keep your token private
`pln-app.config.json` holds a personal deploy token tied to your account. Do not
commit it to a public repo or share it.
