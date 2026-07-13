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
- Use the PLN design tokens in `styles/pln-theme.css` for any UI you create.
- Keep dependencies minimal. The sandbox builds from the `app/Dockerfile`.
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
3. **Assume no runtime config.** The sandbox injects NO env vars or secrets. Decide
   how the app runs without its usual credentials — degrade to sample/mock data, or
   clearly surface what's missing. Never hardcode real secrets to compensate.
4. **Never ship secrets.** Keep real `.env` files, tokens, keys, and data dirs OUT of
   the uploaded zip: add them to `.dockerignore` and confirm they're absent before
   deploying. The zip is built and stored server-side.
5. **Verify before deploying:** `cd app && npm install && npm start` (or the app's
   equivalent), then confirm `GET /health` is 200 and `GET /` renders.

## Deploying the app
When the member asks you to deploy, use the **deploy-to-labs** skill in
`.claude/skills/deploy-to-labs/SKILL.md`. In short:
1. Read `pln-app.config.json` for the deploy token and endpoint.
2. Choose a stable, lowercase `appId` (e.g. `my-leaderboard`) and a fresh
   `deploymentId` for each deploy.
3. Zip the **contents** of `app/` (so the `Dockerfile` sits at the root of the ZIP),
   excluding `node_modules`, build output, and any secrets/`.env`/data dirs, then
   upload that ZIP to the deploy endpoint as multipart/form-data. The PLN backend
   stores it and runs the build — you do not need any cloud credentials.
4. Tell the member the deploy succeeded and that they can open their app from the
   PL Infra → AI Apps dashboard. **Do NOT reveal the deployment URL, host, or port**
   (see "Keep the deployment URL private" in the deploy skill).

## Deploy token
Your deploy token is in `pln-app.config.json` and is sent in the
`x-app-token` header. It is tied to this member's account and reused
across all of their apps. Never print it in logs or commit it. (Token starts
with `plnapp_8e5…`.)

Do not ask for or use any internal PLN APIs — only the deploy endpoint in the
config is available to you.
