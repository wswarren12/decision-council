# AI Agent Instructions — PLN AI Apps

You are helping a Protocol Labs Network member build and deploy a small web app
to the PLN sandbox. Follow these rules.

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
  buttons, cards, inputs, badges, tables, tabs, dropdowns, or sidebars.
- **Use tokens only** from `pl-design-system/tokens/` (e.g.
  `var(--background-brand-default)`, `var(--spacing-md)`). Never hardcode hex or
  pixel font sizes.
- For UI work, scaffold a **Next.js 14** app in `app/`, copy `pl-design-system/`
  into `app/` so it ships on deploy, and consume it per `USAGE.md`. For a
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
3. Give the member the `appPageUrl` from the response: they open it in LabOS,
   enter the secret values, and click **Deploy** there. The deploy then runs
   with the stored secrets.
4. To ship a code update later, register the draft again (same `appId`, fresh
   `deploymentId`) — already-stored secret values stay valid; the member just
   clicks Deploy again in LabOS.
5. To change a key later, the member doesn't need you at all: on the app's LabOS
   page they click **Update secrets & redeploy**, enter the new value, and Deploy.

Never ask the member for secret values in the chat, and never write them to any
file — LabOS is the only place they should be entered.

## Deploying the app
When the member asks you to deploy, use the **deploy-to-labs** skill in
`.claude/skills/deploy-to-labs/SKILL.md`. If the app needs runtime secrets,
follow "Apps that need secrets" above instead of deploying directly. In short:
1. Read `pln-app.config.json` for the `connectEndpoint`, `deployEndpoint`, and
   (if present) a saved `appId`.
2. **Get a deploy token via LabOS (the connect flow).** There is no token in the
   kit. POST to `connectEndpoint` to start a connect session, give the member the
   returned `connectUrl` + confirmation `userCode` to open and approve in LabOS,
   then poll until you receive a short-lived `deployToken`. Full steps are in the
   deploy skill. Keep the token **in memory only** — never write it to
   `pln-app.config.json` or any file.
3. Choose a stable, lowercase `appId` (e.g. `my-leaderboard`) and a fresh
   `deploymentId` for each deploy.
4. Zip the **contents** of `app/` (so the `Dockerfile` sits at the root of the ZIP),
   excluding `node_modules`, build output, and any secrets/`.env`/data dirs, then
   upload that ZIP to `deployEndpoint` as multipart/form-data with the
   `deployToken` in the `x-app-token` header. The PLN backend stores it
   and runs the build — you do not need any cloud credentials.
5. Tell the member the deploy succeeded and that they can open their app from the
   PL Infra → AI Apps dashboard. **Do NOT reveal the deployment URL, host, or port**
   (see "Keep the deployment URL private" in the deploy skill).

## Deploy token
There is **no long-lived token** in this kit. You obtain a short-lived deploy
token at deploy time through the LabOS connect flow (see the deploy skill), and
send it in the `x-app-token` header. The token expires after about an
hour and is tied to the member who approved the connect link. Never print it in
logs, write it to a file, or commit it; if a deploy returns 401 (expired), just
run the connect flow again to get a fresh one.

Do not ask for or use any internal PLN APIs — only the connect and deploy
endpoints in the config are available to you.
