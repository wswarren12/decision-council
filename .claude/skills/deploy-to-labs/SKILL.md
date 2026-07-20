---
name: deploy-to-labs
description: Deploy the app in ./app to the Protocol Labs Network sandbox. Use when the member asks to deploy, ship, or publish the app.
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

If anything secret shows up (or you wrote code that needs a key), do steps 1–4 as
written but then follow "**Apps that need secrets (draft flow)**" below instead of
step 5 — you register a draft and the member deploys from LabOS after entering the
values there. Never deploy a secrets app directly and never accept key values in
the chat.

## Steps
1. Read `pln-app.config.json` to get `connectEndpoint`, `deployEndpoint`,
   `draftEndpoint`, and (if present) a saved `appId`. If no `appId` exists yet,
   pick a short, stable, lowercase slug (e.g. `hello-board`) and save it back to
   the config.
2. **Get a deploy token via LabOS.** The kit has no token; obtain a short-lived one
   through the connect flow:

   a. Start a session (no auth needed):

   ```bash
   curl -sX POST "<connectEndpoint>" \
     -H "Content-Type: application/json" \
     -d '{"clientName":"Claude Code"}'
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
   # expired  → the link timed out; start a new session (step 2a)
   ```

   Hold `deployToken` **in memory only** — never write it to `pln-app.config.json`
   or any other file, and never print it.
3. Make sure `app/` runs locally first (`npm install && npm start`, hit
   `/health`). For a migrated existing app, also confirm the migration checklist
   in `AGENTS.md` is satisfied (self-contained `app/`, fitting Dockerfile, binds
   `0.0.0.0`, no reliance on injected secrets).
4. Zip the **contents** of `app/` so the `Dockerfile` sits at the ZIP root.
   Exclude `node_modules`, build output, and — importantly — any secrets: real
   `.env` files, tokens/keys, and data dirs must never enter the ZIP (the backend
   stores it server-side).

   ```bash
   cd app && zip -r ../app.zip . \
     -x 'node_modules/*' '*/node_modules/*' 'dist/*' '.next/*' '.env' '.env.*' '.data/*' && cd ..
   # Sanity-check nothing sensitive slipped in:
   unzip -l ../app.zip | grep -iE '\.env|secret|credential|\.pem|\.key' && echo 'STOP: secret in zip' || echo 'ok'
   ```

5. Upload the ZIP to the deploy endpoint as multipart/form-data, sending the
   `deployToken` from step 2 in the `x-app-token` header. The PLN backend
   stores the ZIP and triggers the build — no cloud credentials are needed:

   ```bash
   curl -X POST "<deployEndpoint>" \
     -H "x-app-token: <deployToken>" \
     -F "appId=<your-app-id>" \
     -F "name=<human-friendly app name>" \
     -F "description=<one line about the app>" \
     -F "deploymentId=<unique id per deploy, e.g. a timestamp>" \
     -F "file=@app.zip;type=application/zip"
   ```

6. On success the response contains the deployment URL and status:

   ```json
   { "status": "READY", "url": "https://<appId>.deployment.plnetwork.io", "host": "...", "port": 31001 }
   ```

   Use this URL only for the internal checks below — **do not reveal it to the
   member** (see "Keep the deployment URL private"). On `READY`, tell the member the
   app is live and can be opened from the PL Infra → AI Apps dashboard. If `status`
   is `ERROR`, surface `notes` (never the URL).

7. **Verify the app is iframe-embeddable** (internal check — do not surface the URL
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
When the app needs runtime secrets, replace the upload in step 5 with a **draft
registration** — same multipart shape, posted to `draftEndpoint`, plus
`requiredEnvVars` (the env var NAMES the app reads; JSON array or
comma-separated). Nothing is deployed yet:

```bash
curl -X POST "<draftEndpoint>" \
  -H "x-app-token: <deployToken>" \
  -F "appId=<your-app-id>" \
  -F "name=<human-friendly app name>" \
  -F "description=<one line about the app>" \
  -F "deploymentId=<unique id per upload, e.g. a timestamp>" \
  -F 'requiredEnvVars=["OPENAI_API_KEY","SUPABASE_URL"]' \
  -F "file=@app.zip;type=application/zip"
# → { "status": "DRAFT", "appPageUrl": "https://…/pl-infra/ai-apps/<uid>", "missingEnvVars": [ … ] }
```

Then **tell the member, in your chat, in plain non-technical language** — e.g.
*"Your app is registered. Open this link, paste your OpenAI API key into the form,
and click Deploy — that page is the only safe place for your key."* Give them
`appPageUrl`; they enter the values there and click **Deploy**. The deploy runs
immediately with the stored secrets; the app then appears as usual on the AI Apps
dashboard.

- **Never** ask the member to paste secret values into the chat, and never write
  them to a file — LabOS is the only place values are entered. If they paste a
  key into the chat anyway, don't use or repeat it — point them to `appPageUrl`
  (and suggest rotating the key if it's sensitive).
- To ship a **code update** later, re-register the draft (same `appId`, fresh
  `deploymentId`, updated `requiredEnvVars` if they changed) and send the member
  back to `appPageUrl` to click Deploy. Stored secret values remain valid.
- The member can also update secret values and redeploy entirely from LabOS —
  no agent involvement needed.

## Keep the deployment URL private
Do not print, link, or otherwise tell the member the deployment URL, host, or port —
in your messages, summaries, or saved files. The member opens their app through the
PL Infra → AI Apps dashboard, which embeds it; they never need the raw URL. You may
use the URL silently for the verification and health checks here, but it must not
appear in anything you report back. (The config file stores only the `appId`, not the
URL — keep it that way.)

## If the upload times out (504) or seems to hang
A slow build can exceed the gateway's request timeout, so the upload may return a
`504 Gateway Time-out` (or hang) **even though the build succeeded**. Do NOT assume
failure and blindly re-upload. Instead poll the app (internal check — don't share the
URL with the member):

```bash
curl -sS -m 20 -o /dev/null -w '%{http_code}\n' "https://<appId>.deployment.plnetwork.io/health"
```

If it returns `200` within a minute or two, the deploy worked — proceed to the
verification steps. Only re-deploy if it stays unreachable.

## Notes
- Reuse the same `appId` to redeploy an existing app; use a new `deploymentId`
  each time. Derive the URL from the `appId` for your own checks, but treat it as
  sensitive (see "Keep the deployment URL private").
- The deploy token is short-lived (≈1 hour) and tied to the member who approved the
  connect link. Keep it in memory only — never save it to a file or print it. Within
  the window you can redeploy without reconnecting; once it expires (deploy returns
  `401`), run the connect flow again to get a fresh token.
- Runtime secrets are supported only through the draft flow above — the sandbox
  injects exactly the env vars the member provided in LabOS. Non-secret config
  should ship sensible defaults — see the migration checklist in `AGENTS.md`.
