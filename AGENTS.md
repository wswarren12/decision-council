# AI Agent Instructions — PLN AI Apps

You are helping a Protocol Labs Network member build and deploy a small web app
to the PLN sandbox. Follow these rules.

**Skills note (non-Claude tools):** detailed how-to guides live as plain
markdown under `.claude/skills/<name>/SKILL.md`. Claude Code discovers them
automatically; if you are a different agent (Codex, Cursor, etc.), just READ
the referenced file whenever these instructions say to "load a skill" — they
are ordinary docs, not Claude-specific magic.

## Building the app
- All application code lives in the `app/` directory.
- `app/` must stay independently runnable: `npm install && npm start` serves it
  on the port given by the `PORT` env var (default 3000), bound to `0.0.0.0` (not
  `localhost` — the container must accept connections from outside it).
- The app must expose a `GET /health` endpoint returning HTTP 200, and a usable
  `GET /` (the dashboard loads the app at its root — a bare `/` that 404s looks
  broken in the iframe; a redirect to your main page is fine).
- Keep dependencies minimal. The sandbox builds from the `app/Dockerfile`.

## Use the PL Design System — do NOT hand-roll UI
This kit ships the **PL Design System** as the ready-to-use `pl-design-system/`
folder. Before any UI work, load the **pl-design-system** skill
(`.claude/skills/pl-design-system/SKILL.md`) and follow
`pl-design-system/USAGE.md` + `pl-design-system/guidelines.md`.

- **Reuse** React components from `pl-design-system/components/` — do not recreate
  buttons, cards, inputs, badges, tables, tabs, menus, or page shells.
- **Semantic tokens only** via Tailwind utilities (e.g. `bg-surface`,
  `text-secondary`, `border-border`, `shadow-card`). Never hardcode hex, use
  palette utilities (`slate-*`), or reach for `--pl-*` primitives in app styles.
- For UI work, scaffold a **Next.js** app with **Tailwind v4** in `app/`, copy
  `pl-design-system/` into `app/` so it ships on deploy, and consume it per
  `USAGE.md` (including `@source` for vendored components). For a
  non-React/plain-HTML app, `styles/pln-theme.css` is a minimal fallback — the
  React components are strongly preferred.
- **Must be iframe-embeddable from `*.plnetwork.io`.** The app is shown inside the
  PL Infra → AI Apps dashboard via an `<iframe>` served from a sibling
  `*.plnetwork.io` subdomain. A different subdomain is a *different origin*, so any
  framing guard that defaults to "same-origin only" will break the embed with
  `refused to connect`. Therefore:
  - **Do NOT send `X-Frame-Options`.** It only understands `DENY`/`SAMEORIGIN` —
    it cannot allow a sibling subdomain, and if present browsers honor it and block
    the frame. (Note: `helmet()` sends `X-Frame-Options: SAMEORIGIN` by default —
    pass `frameguard: false` to turn it off.)
  - If you set a `Content-Security-Policy`, its `frame-ancestors` MUST include
    `'self' https://plnetwork.io https://*.plnetwork.io`. Never use
    `frame-ancestors 'none'`.
  - The default scaffold sends neither header, so it already embeds fine — this
    only matters once you add `helmet`, a CSP, or other security headers.

## Signed-in member context (personalization)
The app can identify the PLN member using it. Load the **pln-member-context**
skill (`.claude/skills/pln-member-context/SKILL.md`) before writing any code
that needs the current user. In short: the LabOS session cookie (`authToken`,
shared across the PLN apps domain) reaches the app's own origin, so browser
code reads it from `document.cookie` (URL-decode + strip quotes) and calls the
`memberContextEndpoint` from `pln-app.config.json` with
`Authorization: Bearer <token>` — use the exact snippet from the skill, and do
NOT rely on `credentials: 'include'` alone (the cookie may not reach the API
host). The response carries the member's public profile (uid, name, image,
teams + roles, skills — deliberately no email or other contact info). Bake the
endpoint URL into the app's frontend as a constant — the config file itself is
not shipped inside `app/`.
- Handle the signed-out case gracefully (401/403/local dev): show a friendly
  note and keep the app usable without identity. Never hard-fail on it.
- Personalization only: never gate sensitive/destructive actions on it, never
  store or log tokens, and never forward member data to third parties.

## Product analytics (baseline is automatic, custom events are on request)
Load the **app-analytics** skill (`.claude/skills/app-analytics/SKILL.md`)
while scaffolding **every** app — baseline usage tracking (`opened`,
`error`, `closed`) is a standard part of building an app with this kit, the
same as the `/health` endpoint, not something you wait to be asked for. Wire
its `initAppAnalytics()` call in once, early, on every page. Custom events
(button clicks, feature usage) are different: only add those when the member
specifically asks for tracking on something — don't instrument arbitrary
clicks yourself.

Mechanically: POST to `analyticsEndpoint` from `pln-app.config.json` with
`{ event, properties }` — no deploy token, no PostHog SDK, no key of any
kind. Attribution to this app (and to the signed-in member, when there is
one) is resolved server-side; you only choose the event name (snake_case; the
endpoint prefixes it) and behavioral properties. Never put PII in properties,
always fire-and-forget (never block or fail the app on an analytics call),
and never let a failure here affect the deploy or the app's own functionality.
This data goes to the PL team for understanding usage across AI Apps, not to the member —
there is no dashboard yet where the member can see their own app's events, so
don't tell them they'll be able to view this data.

## Migrating an existing app
When the member already has an app and wants it on LabOS, you are *adapting their
code*, not authoring into the scaffold. The scaffold's `app/server.js`,
`app/package.json`, and `app/Dockerfile` are placeholders — replace them. The deploy
contract (PORT / 0.0.0.0 / `/health` / iframe-embeddable, above) is all that matters,
not the scaffold's shape or language.

1. **Put the app in `app/` and make it self-contained.** Copy their project into
   `app/`, overwriting the placeholders. Remove references to anything outside `app/`
   (monorepo `tsconfig` `extends`, workspace/sibling packages, parent lockfiles) and
   include the app's own lockfile — only `app/` is shipped.
2. **Write a `Dockerfile` that fits the app.** The scaffold's assumes a single-file
   Node app with no build. If the app compiles (TypeScript, Go, a bundler, …), write
   an appropriate (e.g. multi-stage) Dockerfile. Only hard requirement: the image
   starts a server that listens on `$PORT`, binds `0.0.0.0`, and answers `GET /health`.
3. **Runtime config comes from the secrets flow, not the ZIP.** If the app needs
   API keys or other secrets at runtime, use the draft flow ("Apps that need
   secrets" below): declare the env var NAMES and let the member provide the
   values in LabOS. Anything that isn't secret should ship sensible defaults.
4. **Never ship secrets.** Keep real `.env` files, tokens, keys, and data dirs OUT of
   the uploaded zip: add them to `.dockerignore` and confirm they're absent before
   deploying. The zip is built and stored server-side. Secret VALUES are entered by
   the member in LabOS — never ask the member to paste them into the chat or a file.
5. **Verify before deploying:** `cd app && npm install && npm start` (or the app's
   equivalent), then confirm `GET /health` is 200 and `GET /` renders.

## Migrating an app's own database to PLN Postgres
If the member already has a database (their own Postgres, Supabase, MySQL, SQLite,
Mongo, …) and wants to switch to a PLN-provisioned Postgres database instead, load
the **db-migration** skill (`.claude/skills/db-migration/SKILL.md`) — do not
improvise this by hand. It covers detecting the current setup, carrying over
schema/migrations, spotting required Postgres extensions, and rewiring the app's
data-access code. It copies the member's **existing data by default**, not just
structure — one migration, not a separate ask for each half — skipping the
data copy only if the member says to start empty. It ends by handing off to
the normal deploy flow above ("Apps that want a provisioned database").

## Resource limits (design within budget)
Every deployed app runs under a fixed CPU/memory envelope, and every image
build runs under its own — these are a fixed platform default, not something
you request. Design and build with them in mind so a deploy doesn't fail:

- **Runtime** (the running app container): **384Mi memory limit**, 300m CPU
  limit.
- **Build** (the Docker image build): **2Gi memory limit**, 1 CPU limit.

CPU limits only throttle — the app/build just runs slower under load.
**Memory limits are hard**: exceeding one gets the process OOM-killed (the
running app crash-loops; the build fails). Design choices that fit
comfortably within this budget:
- Avoid large in-memory caches or datasets — read from disk/network on
  demand, or bound any cache to a small max size (LRU).
- Prefer streaming responses over buffering entire payloads in memory.
- Don't spawn extra worker threads/processes for background work — a single
  event loop or a small pool is plenty at this scale.
- Avoid heavy in-process ML/image/video processing — call an external API
  instead of bundling a large model or native library.
- Keep the build lean: trim `devDependencies` that end up in the Docker
  build context, disable production source maps, and don't bundle large
  static datasets into the image.

If a deploy fails with `notes` mentioning "OOM-killed" or "exceeded its
memory limit", that's this budget — see the deploy skill's step 7 for what
to do next.

## Apps that need secrets (API keys, tokens, …)
The member is usually **not a developer** — they will never say "environment
variable" or "secret". It is YOUR job to recognize when the app needs one and to
route the deploy through the **draft flow** instead of deploying directly.

**Recognize the need yourself.** The app needs the draft flow whenever it (will)
talk to any external service that requires a credential — an AI/LLM API (OpenAI,
Anthropic, …), email/SMS sending, a database, a paid data API, a webhook with a
signing secret, and so on. If the member asks for a feature like "summarize with
ChatGPT" or "send me an email", that IS a secrets app: wire the code to read the
credential from an env var (e.g. `process.env.OPENAI_API_KEY`), pick a clear
UPPER_SNAKE_CASE name, and plan for the draft flow. Before any deploy, double-check
the code for `process.env.*` reads (or the language's equivalent) you may have
added along the way.

**Explain it in plain words.** Tell the member something like: *"This app needs
your OpenAI API key to work. I never handle keys directly — I'll register the app
and give you a secure LabOS link where you paste the key and click Deploy."*
Don't use the words "env var", "draft registration", or "runtime injection" with
the member.

**If the member pastes a secret into the chat**, do not use it, do not echo it
back, and do not write it anywhere. Tell them the chat isn't a safe place for
keys, ask them to revoke/rotate it if it's sensitive, and point them to the LabOS
page from step 3 below — that form is the only place values should be entered.

The flow (full steps in the deploy skill):
1. Get a deploy token via the connect flow as usual.
2. POST the app ZIP to the `draftEndpoint` from `pln-app.config.json` with a
   `requiredEnvVars` field listing the env var NAMES the app needs. This
   registers the app as a **draft** — nothing runs yet.
3. **Immediately give the member the `appPageUrl` from the response — don't
   wait to be asked.** A draft deploys nothing until they act, so without the
   link they think the deploy is stuck. (This LabOS link is meant to be shared —
   the deployment-URL privacy rule doesn't apply to it.) They open it in LabOS,
   enter the secret values, and click **Deploy** there. The deploy then runs
   with the stored secrets.
4. To ship a code update later, register the draft again (same `appId`, fresh
   `deploymentId`) — already-stored secret values stay valid; the member just
   clicks Deploy again in LabOS.
5. To change a key later, the member doesn't need you at all: on the PL Infra →
   AI Apps dashboard they open the **⋯ menu** on the app's card and choose
   **Deployment settings**, click **Replace** on the value, enter the new one,
   and click **Redeploy**. If they ask you for a direct link, build it from
   `appSettingsUrl` in `pln-app.config.json` (replace `{appUid}` with the saved
   `appUid`) — it opens that modal for them.

Never ask the member for secret values in the chat, and never write them to any
file — LabOS is the only place they should be entered.

## App name, description & one-pager PRD (display metadata)
Every app has member-facing display metadata on the AI Apps dashboard: a
**name**, a short **description**, and an optional **one-pager PRD**. The rules
live in the **app-metadata** skill (`.claude/skills/app-metadata/SKILL.md`) —
load it whenever metadata comes up. In short:
- **Before the first deploy**: propose a human-friendly name + 1–2 sentence
  description drawn from what the app does, present them to the member, and
  **wait for explicit approval** (revise until they approve). Save the approved
  values to `appName`/`appDescription` in `pln-app.config.json` and use them in
  the deploy form.
- **After the first successful deploy**: ask once whether the member wants a
  one-pager PRD. If yes, generate a concise Markdown one-page brief (see the
  app-metadata skill), get their approval, and save it via the
  `metadataEndpoint` — **no new ZIP and no redeploy**. If they decline, carry
  on without one.
- **On redeploys**: reuse the saved `appName`/`appDescription` verbatim and do
  NOT re-run the propose-and-approve flow (the deploy form overwrites stored
  metadata, so fresh drafts would revert what the member approved). Only
  re-propose when the member explicitly asks to change something.
- **When the member asks to rename / edit the description / change the PRD** of
  an existing app: same propose → approve → save flow, via `metadataEndpoint` —
  metadata changes never require a redeploy.

## Deploying the app
When the member asks you to deploy, use the **deploy-to-labs** skill in
`.claude/skills/deploy-to-labs/SKILL.md`. If the app needs runtime secrets,
follow "Apps that need secrets" above instead of deploying directly. In short:
1. Read `pln-app.config.json` for the `connectEndpoint`, `deployEndpoint`,
   `metadataEndpoint`, and (if present) saved `appId`, `appUid`, `appName`, and
   `appDescription`.
2. **Settle the display metadata** ("App name, description & one-pager PRD"
   above): first deploy → propose name/description and get the member's
   approval; redeploy → reuse the saved values without re-asking.
3. **Get a deploy token via LabOS (the connect flow).** There is no token in the
   kit. POST to `connectEndpoint` to start a connect session, give the member the
   returned `connectUrl` + confirmation `userCode` to open and approve in LabOS,
   then poll until you receive a short-lived `deployToken`. Full steps are in the
   deploy skill. Keep the token **in memory only** — never write it to
   `pln-app.config.json` or any file.
4. Choose a stable, lowercase `appId` (e.g. `my-leaderboard`) and a fresh
   `deploymentId` for each deploy.
5. Zip the **contents** of `app/` (so the `Dockerfile` sits at the root of the ZIP),
   excluding `node_modules`, build output, and any secrets/`.env`/data dirs, then
   upload that ZIP to `deployEndpoint` as multipart/form-data with the
   `deployToken` in the `x-app-token` header. The PLN backend stores it
   and runs the build — you do not need any cloud credentials.
6. Save the `uid` from the response as `appUid` in `pln-app.config.json`, then
   tell the member the deploy succeeded and that they can open their app from the
   PL Infra → AI Apps dashboard. **Do NOT reveal the deployment URL, host, or port**
   (see "Keep the deployment URL private" in the deploy skill). That privacy rule
   covers only the app's own `<appId>` address — LabOS links (`connectUrl`,
   `appPageUrl`) must always be shared with the member.

## Debugging a deployed app (build & runtime logs)
When a deploy fails (status `ERROR`), the deployed app crashes or misbehaves,
or the member asks what their app is doing, load the **app-logs** skill
(`.claude/skills/app-logs/SKILL.md`). In short: `buildLogsEndpoint` and
`runtimeLogsEndpoint` in `pln-app.config.json` (`{appUid}` templates, deploy-token
auth) serve the app's CloudWatch logs — **build** logs for image-build failures,
**runtime** logs for the running app's stdout/stderr. Fetch them yourself,
diagnose, explain in plain words, fix, and redeploy — don't ask the member to
find logs.

## Deploy token
There is **no long-lived token** in this kit. You obtain a short-lived deploy
token at deploy time through the LabOS connect flow (see the deploy skill), and
send it in the `x-app-token` header. The token expires after about an
hour and is tied to the member who approved the connect link. Never print it in
logs, write it to a file, or commit it; if a deploy returns 401 (expired), just
run the connect flow again to get a fresh one.

Do not ask for or use any internal PLN APIs — only the connect, deploy, and
member-context endpoints in the config are available to you.
