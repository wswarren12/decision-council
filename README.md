# PLN AI Apps — Starter Kit v1.3

Welcome! This kit lets you vibe-code an app with your AI assistant and deploy it
to the Protocol Labs Network sandbox with a single instruction.

## What's inside
- `CLAUDE.md` / `AGENTS.md` — instructions your AI agent reads automatically.
- `.claude/skills/deploy-to-labs/` — the deploy skill your agent uses.
- `.claude/skills/pl-design-system/` — how to build on-brand UI with the PL Design System.
- `pln-app.config.json` — the LabOS connect + deploy endpoints (no secrets).
- `pl-design-system/` — the **PL Design System**: ready-made React components
  (Button, MemberCard, TeamCard, Table, Tabs, Badge, PageHeader, SearchInput,
  Pagination, …), SCSS design tokens, the Inter font, and `USAGE.md` /
  `guidelines.md`. Your agent uses these instead of hand-building UI.
- `styles/` — a tiny CSS-variable fallback (`pln-theme.css`) for plain-HTML apps
  that don't use React, plus font guidance.
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
3. When you're happy, say "deploy this app". The first time you deploy, your agent
   will give you a LabOS link to open and approve — sign in and click **Approve**
   to authorize the deploy. Your agent then ships the app to the PLN sandbox; the
   first deploy can take a minute or two.
4. Your app appears on the PL Infra → AI Apps dashboard, where you can open it.

## Apps that need an API key or password (secrets)
Some apps need a secret to work — for example an app that talks to ChatGPT/OpenAI,
sends emails, or connects to a database needs an **API key** or password for that
service. If yours does, the flow is slightly different, and your agent handles it
for you:

1. Build your app as usual — just tell your agent what you want (e.g. "an app that
   summarizes news with ChatGPT"). It knows the app will need a key.
2. **Never paste your API key into the chat** (and don't put it in any file). If
   you do it by accident, your agent will ask you to use the secure page instead.
3. When it's time to deploy, your agent registers the app as a **draft** and gives
   you a LabOS link. Open it, enter your key(s) in the form there, and click
   **Deploy** — that page is the only place your secrets should ever go.
4. Updating a key later? Open your app's page in LabOS (PL Infra → AI Apps → your
   app), click **Update secrets & redeploy**, enter the new value, and Deploy.

Secrets never go into the code, the chat, or the uploaded ZIP — they are stored
securely on the sandbox and injected into your app when it runs.

## Embedding in the dashboard
Your app is shown inside the AI Apps dashboard. Apps built with this kit display
correctly out of the box, and your agent checks this for you on every deploy — so you
don't need to do anything special. (The technical rule lives in `AGENTS.md` for your
agent's reference.)

## How deploy authorization works
This kit contains **no token**. When your agent deploys, it asks LabOS for a
short-lived deploy credential: you open a LabOS link, sign in, and approve. The
credential is tied to your account, expires after about an hour, and is never
written to disk — so this folder is safe to commit or share (it grants nothing on
its own). Each new deploy session just asks you to approve again.
