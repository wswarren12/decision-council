---
name: deploy-to-labs
description: Deploy the app in ./app to the Protocol Labs Network sandbox. Use when the member asks to deploy, ship, or publish the app — recognize this whether they say "PLN" or "PL" (both refer to the same network).
---

# Deploy to PLN Labs

Deploys the app in `app/` to the PLN sandbox and returns its live URL.

**Needs secrets? Decide BEFORE deploying — don't wait for the member to say so.**
The member usually has no coding background and won't know their app "has secrets".
Check for it yourself: does the app read any credential from the environment
(`process.env.*` or equivalent), or call any external service that needs an API
key (OpenAI/Anthropic, email/SMS, a database, a paid API)? A quick check:

```bash
grep -rniE 'process\.env\.|os\.environ|getenv' app --include='*.js' --include='*.ts' --include='*.py' | grep -viE 'PORT|NODE_ENV'
```

If anything secret shows up (or you wrote code that needs a key), do steps 1–5 as
written but then follow "**Apps that need secrets (draft flow)**" below instead of
step 6 — you register a draft and the member deploys from LabOS after entering the
values there. Never deploy a secrets app directly and never accept key values in
the chat.

**Needs a database? Decide this too, BEFORE deploying.** Check whether the app
talks to a database (an ORM/driver import, a `DATABASE_URL`/`DB_*` read, or
code you wrote that needs one):

```bash
grep -rniE "DATABASE_URL|postgres|pg\.Pool|prisma|mongoose|mysql" app --include='*.js' --include='*.ts' --include='*.py' --include='*.json'
```

If the app needs one, **ask the member which they want — don't assume**:

- *"I can set up a database for you automatically — no accounts or setup on
  your end. Or, if you already have your own database, you can connect that
  instead. Which would you like?"*

**They want PLN to provision one** (the easy path for non-technical members):
follow "**Apps that want a provisioned database**" below — add the `database`
field to your deploy/draft call, and the app gets ready-to-use connection env
vars automatically. You never create the database or generate credentials
yourself.

**They want to bring their own**: this is just a runtime secret — add a
connection env var name (e.g. `DATABASE_URL`) to `requiredEnvVars` and follow
"**Apps that need secrets (draft flow)**" below; the member pastes their own
connection string into the LabOS secrets page, same as an API key.

## Steps
1. Read `pln-app.config.json` to get `connectEndpoint`, `deployEndpoint`,
   `draftEndpoint`, `metadataEndpoint`, the `kitVersion` (sent with every upload
   so PLN knows which kit built the app), and (if present) saved `appId`,
   `appUid`, `appName`, and `appDescription`. If no `appId` exists yet, pick a
   short, stable, lowercase slug (e.g. `hello-board`) and save it back to the
   config. `appId`s are **global across ALL PLN members** — the app's URL and
   infrastructure are derived from it — so pick something distinctive; a generic
   slug another member already claimed is rejected with `409 Conflict` at deploy
   time (see step 7). Never edit `kitVersion` by hand.
2. **Settle the display name & description.** If `appName` in the config is
   empty (first deploy), load the **app-metadata** skill
   (`.claude/skills/app-metadata/SKILL.md`): propose a human-friendly name and
   a 1–2 sentence description, get the member's **explicit approval** (revise
   until they approve), and save the approved values to `appName`/
   `appDescription` in the config. If `appName` is already set, **reuse the
   saved values verbatim and don't re-ask** — the deploy form overwrites the
   stored metadata, so anything else would revert what the member approved.
   Only re-run the propose flow when the member explicitly asks to change the
   name or description.
3. **Get a deploy token via LabOS.** The kit has no token; obtain a short-lived one
   through the connect flow:

   a. Start a session (no auth needed). Set `clientName` to YOUR actual tool
      name (e.g. "Claude Code", "Cursor", "Codex CLI") — it is shown to the
      member on the approval page and recorded with the deployed app:

   ```bash
   curl -sX POST "<connectEndpoint>" \
     -H "Content-Type: application/json" \
     -d '{"clientName":"<your tool name>"}'
   # → { "sessionId", "userCode", "connectUrl", "pollToken", "pollIntervalSec", "expiresAt" }
   ```

   b. **Tell the member, in your chat:** open `connectUrl` in their browser, sign in
      to LabOS, confirm the code shown matches `userCode`, and click **Approve**.
   c. Poll until the session is decided (every `pollIntervalSec` seconds, up to
      `expiresAt`), sending the `pollToken` you received:

   ```bash
   curl -sX POST "<connectEndpoint>/poll" \
     -H "Content-Type: application/json" \
     -d '{"pollToken":"<pollToken>"}'
   # pending  → keep polling
   # approved → { "status":"approved", "deployToken":"plndeploy_…", "deployTokenExpiresAt" }
   # denied   → the member lacks ai_apps.write; stop and tell them
   # expired  → the link timed out; start a new session (step 3a)
   ```

   Hold `deployToken` **in memory only** — never write it to `pln-app.config.json`
   or any other file, and never print it.
4. Make sure `app/` runs locally first (`npm install && npm start`, hit
   `/health`). For a migrated existing app, also confirm the migration checklist
   in `AGENTS.md` is satisfied (self-contained `app/`, fitting Dockerfile, binds
   `0.0.0.0`, no reliance on injected secrets).
5. Zip the **contents** of `app/` so the `Dockerfile` sits at the ZIP root.
   Exclude `node_modules`, build output, and — importantly — any secrets: real
   `.env` files, tokens/keys, and data dirs must never enter the ZIP (the backend
   stores it server-side).

   ```bash
   cd app && zip -r ../app.zip . \
     -x 'node_modules/*' '*/node_modules/*' 'dist/*' '.next/*' '.env' '.env.*' '.data/*' && cd ..
   # Sanity-check nothing sensitive slipped in:
   unzip -l ../app.zip | grep -iE '\.env|secret|credential|\.pem|\.key' && echo 'STOP: secret in zip' || echo 'ok'
   ```

6. Upload the ZIP to the deploy endpoint as multipart/form-data, sending the
   `deployToken` from step 3 in the `x-app-token` header. `name` and
   `description` are the member-approved `appName`/`appDescription` from
   `pln-app.config.json` (step 2) — send them verbatim. The PLN backend stores
   the ZIP and triggers the build — no cloud credentials are needed:

   ```bash
   curl -X POST "<deployEndpoint>" \
     -H "x-app-token: <deployToken>" \
     -F "appId=<your-app-id>" \
     -F "name=<the approved appName from pln-app.config.json>" \
     -F "description=<the approved appDescription from pln-app.config.json>" \
     -F "deploymentId=<unique id per deploy, e.g. a timestamp>" \
     -F "kitVersion=<the kitVersion from pln-app.config.json>" \
     -F "agentModel=<the model you are running on, e.g. claude-sonnet-4-5; omit the field if unknown>" \
     -F 'database={"enabled":true,"type":"postgres"}' \
     -F "file=@app.zip;type=application/zip"
   ```

   Omit the `database` field entirely if the app doesn't need one, or the
   member is bringing their own — see "Apps that want a provisioned database"
   below for when to include it.

7. On success the response contains the app record with its deployment URL and
   status:

   ```json
   { "uid": "cl…", "status": "READY", "url": "https://<appId>.deployment.plnetwork.io", "host": "...", "port": 31001 }
   ```

   Save the response's `uid` as `appUid` in `pln-app.config.json` (it addresses
   the metadata endpoint later). Use the URL only for the internal checks below —
   **do not reveal it to the member** (see "Keep the deployment URL private").
   On `READY`, tell the member the app is live and can be opened from the
   PL Infra → AI Apps dashboard. If `status` is `ERROR`, surface `notes`
   (never the URL) — and when `notes` alone doesn't explain the failure, fetch
   the **build logs** via the app-logs skill (`.claude/skills/app-logs/SKILL.md`)
   to find the real error before retrying.

   **If `notes` mentions "OOM-killed" or "exceeded its memory limit"**, the
   deploy hit the platform's fixed resource budget (see "Resource limits" in
   `AGENTS.md`) — a build that ran out of memory during `npm install`/bundling,
   or a running app that leaked/allocated past its runtime limit. Don't just
   retry: reduce the memory footprint first (fewer parallel build workers,
   disable source maps, avoid bundling large datasets, drop large in-memory
   caches at runtime) and redeploy. Only ask PL Infra for a higher limit if
   the app has a genuine, explainable need that can't be designed around.

   **If the upload itself returns `409 Conflict`**, read the error message:
   - *"already in use by another member's app"* — the `appId` is taken globally
     by someone else. Pick a different, more distinctive slug (e.g. prefix it:
     `<team>-<app>`), update `appId` in `pln-app.config.json`, and deploy again.
     Don't retry the same `appId` — it won't free up unless that member deletes
     their app.
   - *"deploy is already in progress"* — a previous deploy for this app is still
     running (possibly one the member triggered from LabOS). Wait a minute and
     retry with the SAME `appId`.

   **After the FIRST successful deploy**, offer the optional one-pager PRD —
   see "Offer the one-pager PRD" in the app-metadata skill. If the member wants
   one, generate it, get approval, and save it via `metadataEndpoint` — no
   redeploy involved. Don't re-offer it on later redeploys.

8. **Verify the app is iframe-embeddable** (internal check — do not surface the URL
   to the member). The dashboard shows it in an `<iframe>` from a sibling
   `*.plnetwork.io` subdomain; check the live response headers:

   ```bash
   curl -sSI "https://<appId>.deployment.plnetwork.io/" | grep -iE 'x-frame-options|content-security-policy'
   ```

   It must pass BOTH:
   - **No `X-Frame-Options` header** (it can't allow a sibling subdomain; if present
     it blocks the embed).
   - If a `Content-Security-Policy` is present, its `frame-ancestors` must include
     `https://*.plnetwork.io` (and must NOT be `'none'`).

   If either fails, the embed will show `refused to connect`. Fix the app's headers
   (see the framing rule in `AGENTS.md`) and redeploy before reporting success.

## Apps that need secrets (draft flow)
When the app needs runtime secrets, replace the upload in step 6 with a **draft
registration** — same multipart shape (including the approved `appName`/
`appDescription` from the config), posted to `draftEndpoint`, plus
`requiredEnvVars` (the env var NAMES the app reads; JSON array or
comma-separated). Nothing is deployed yet:

```bash
curl -X POST "<draftEndpoint>" \
  -H "x-app-token: <deployToken>" \
  -F "appId=<your-app-id>" \
  -F "name=<the approved appName from pln-app.config.json>" \
  -F "description=<the approved appDescription from pln-app.config.json>" \
  -F "deploymentId=<unique id per upload, e.g. a timestamp>" \
  -F "kitVersion=<the kitVersion from pln-app.config.json>" \
  -F "agentModel=<the model you are running on; omit the field if unknown>" \
  -F 'requiredEnvVars=["OPENAI_API_KEY","SUPABASE_URL"]' \
  -F "file=@app.zip;type=application/zip"
# → { "uid": "cl…", "status": "DRAFT", "appPageUrl": "https://…/pl-infra/ai-apps/<uid>", "missingEnvVars": [ … ] }
```

An app can need secrets AND a provisioned database — add `database` (see
"Apps that want a provisioned database" below) to this same draft call.

Save the response's `uid` as `appUid` in `pln-app.config.json`, same as a
regular deploy. A `409 Conflict` here means the same things as in step 7
(appId taken by another member → pick a new one; deploy in progress → wait).

**IMMEDIATELY give the member the `appPageUrl` link — this is the very next
thing you do after the registration call returns, before anything else.** A
draft deploys NOTHING by itself: until the member opens that link and clicks
Deploy, they see no progress anywhere and will think the deployment is stuck.
(`appPageUrl` is a LabOS page link — the "keep the deployment URL private" rule
below does NOT apply to it; it exists to be shared.) Tell them in plain
non-technical language — e.g. *"Your app is registered. Open this link, paste
your OpenAI API key into the form, and click Deploy — that page is the only safe
place for your key."* They enter the values there and click **Deploy**. The
deploy runs immediately with the stored secrets; the app then appears as usual
on the AI Apps dashboard.

- **Never** ask the member to paste secret values into the chat, and never write
  them to a file — LabOS is the only place values are entered. If they paste a
  key into the chat anyway, don't use or repeat it — point them to `appPageUrl`
  (and suggest rotating the key if it's sensitive).
- To ship a **code update** later, re-register the draft (same `appId`, fresh
  `deploymentId`, updated `requiredEnvVars` if they changed) and send the member
  back to `appPageUrl` to click Deploy. Stored secret values remain valid.
- The member can also update secret values and redeploy entirely from LabOS —
  no agent involvement needed: on the AI Apps dashboard they open the **⋯ menu**
  on the app's card and choose **Deployment settings**. If they want a direct
  link, hand them `appSettingsUrl` from `pln-app.config.json` with `{appUid}`
  replaced by the saved `appUid` — it opens that modal straight away.

## Apps that want a provisioned database

When the member asks PLN to provision a database (see "Needs a database?"
above), add `database` to the SAME deploy or draft call from step 6 — it's
one extra multipart field, not a separate request:

```bash
-F 'database={"enabled":true,"type":"postgres"}'
```

That's the entire contract. You never create the database, generate a
username/password, or write any provisioning code — the Deployment
Orchestrator provisions a dedicated Postgres database and user, and injects
the connection details into the app's runtime as environment variables. Read
them with your normal env-var access (`process.env.DATABASE_URL`,
`os.environ["DATABASE_URL"]`, …) — never hardcode a connection string or ask
the member for one:

| Variable | Use it when… |
|---|---|
| `DATABASE_URL` | your framework/ORM takes a standard Postgres URL (`postgresql://user:pass@host:5432/db`) |
| `JDBC_DATABASE_URL` | a Java/JDBC app (`jdbc:postgresql://host:5432/db`) |
| `DB_TYPE`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | you need the individual parameters |

**The database REQUIRES an encrypted (SSL/TLS) connection — plain connections
are rejected.** None of the variables above include an `sslmode`/`ssl` flag, so
you must turn SSL on yourself in whatever client/ORM you use, or the very first
query fails with something like:

```
no pg_hba.conf entry for host "...", user "...", database "...", no encryption
```

That error means you connected without SSL — it doesn't mean your credentials
are wrong, so don't waste time re-checking `DB_PASSWORD`. How to enable SSL
depends on your stack (check which applies to your code):

- **Node.js, `pg`** — appending `?sslmode=require` to the URL is NOT enough;
  `pg` ignores that query param and needs the `ssl` option set explicitly:
  `new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })`.
- **Prisma** — append `?sslmode=require` to the URL you pass as `DATABASE_URL`
  in its config (Prisma's Postgres connector does read this query param).
- **Python, `psycopg2`/SQLAlchemy** — append `?sslmode=require` to the DSN, or
  pass `sslmode='require'` explicitly if you're not building the DSN from
  `DATABASE_URL` directly.
- **Java/JDBC** — append `?ssl=true&sslmode=require` to `JDBC_DATABASE_URL`.
- **Any other driver** — check its docs for the equivalent of `sslmode=require`;
  when in doubt, prefer an option that disables strict certificate verification
  (e.g. `rejectUnauthorized: false`, `sslmode=require` rather than `verify-full`)
  since this is a managed RDS instance, not a certificate you provision yourself.

The database user can only read/write its own database — it can't create
other databases or roles, so don't write migration code that assumes
superuser rights. `CREATE TABLE`/`INSERT`/etc. work normally.

- **Once provisioned, keep sending `database` on every future deploy of this
  app** (redeploys, code updates — every call from step 6), exactly like you
  resend `appName`/`appDescription`. Save `{"enabled":true,"type":"postgres"}`
  to `pln-app.config.json` (see the `database` key) the first time the member
  opts in, and read it back on every later deploy instead of asking again.
- Only ask the member once per app. If `database` is already set in the
  config, don't re-run the "Needs a database?" prompt on redeploys.
- This is entirely optional — if the member already has their own database,
  don't send this field at all; treat their connection string as a regular
  runtime secret instead (see "Apps that need secrets" above).
- The response's `database` block (`enabled`, `type`, `host`, `port`, `name`,
  `user`, `credentialsInjected`) is informational only — never the password —
  and is not something you need to show the member; the app already has what
  it needs via the injected env vars.

## Keep the deployment URL private
This rule covers ONLY the deployed app's own address — the URL/host/port on
`<appId>.deployment.plnetwork.io`. Do not print, link, or otherwise tell the member
that URL, host, or port — in your messages, summaries, or saved files. The member
opens their app through the PL Infra → AI Apps dashboard, which embeds it; they
never need the raw URL. You may use the URL silently for the verification and
health checks here, but it must not appear in anything you report back. (The
config file stores only the `appId`, not the URL — keep it that way.)

It does NOT cover the LabOS links — `connectUrl` (approval page) and
`appPageUrl` (secrets + deploy page). Those are made to be opened by the member,
and you MUST share them in chat whenever the flow produces one. Withholding
`appPageUrl` strands a draft app: nothing deploys until the member opens it.

## If the upload times out (504) or seems to hang
A slow build can exceed the gateway's request timeout, so the upload may return a
`504 Gateway Time-out` (or hang) **even though the build succeeded**. Do NOT assume
failure and blindly re-upload. Instead poll the app (internal check — don't share the
URL with the member):

```bash
curl -sS -m 20 -o /dev/null -w '%{http_code}\n' "https://<appId>.deployment.plnetwork.io/health"
```

If it returns `200` within a minute or two, the deploy worked — proceed to the
verification steps. Only re-deploy if it stays unreachable — and before
re-deploying, check the **build logs** (app-logs skill) to see whether and why
the build actually failed.

## Debugging with logs
Build and runtime logs are available through the app-logs skill
(`.claude/skills/app-logs/SKILL.md`): `buildLogsEndpoint` /
`runtimeLogsEndpoint` from `pln-app.config.json` with the same deploy token.
Use build logs for failed builds/deploys and runtime logs when the deployed app
errors or misbehaves. Log lines may include the app's URL/host — the
"Keep the deployment URL private" rule applies to anything you quote from them.

## Notes
- Reuse the same `appId` to redeploy an existing app; use a new `deploymentId`
  each time. Derive the URL from the `appId` for your own checks, but treat it as
  sensitive (see "Keep the deployment URL private").
- Redeploys resend the saved `appName`/`appDescription` verbatim and never
  re-run the propose-and-approve flow. Renames, description edits, and PRD
  changes go through the **app-metadata** skill (`metadataEndpoint`) — they
  never require a redeploy, and a redeploy never touches the PRD.
- The deploy token is short-lived (≈1 hour) and tied to the member who approved the
  connect link. Keep it in memory only — never save it to a file or print it. Within
  the window you can redeploy without reconnecting; once it expires (deploy returns
  `401`), run the connect flow again to get a fresh token.
- Runtime secrets are supported only through the draft flow above — the sandbox
  injects exactly the env vars the member provided in LabOS. Non-secret config
  should ship sensible defaults — see the migration checklist in `AGENTS.md`.
- Database provisioning is entirely optional and only for members who ask for
  it — never send `database` unprompted, and never provision one just because
  the app happens to touch a database driver without asking first.
