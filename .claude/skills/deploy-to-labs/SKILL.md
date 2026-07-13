---
name: deploy-to-labs
description: Deploy the app in ./app to the Protocol Labs Network sandbox. Use when the member asks to deploy, ship, or publish the app.
---

# Deploy to PLN Labs

Deploys the app in `app/` to the PLN sandbox and returns its live URL.

## Steps
1. Read `pln-app.config.json` to get `deployToken`, `deployEndpoint`, and (if
   present) a saved `appId`. If no `appId` exists yet, pick a short, stable,
   lowercase slug (e.g. `hello-board`) and save it back to the config.
2. Make sure `app/` runs locally first (`npm install && npm start`, hit
   `/health`). For a migrated existing app, also confirm the migration checklist
   in `AGENTS.md` is satisfied (self-contained `app/`, fitting Dockerfile, binds
   `0.0.0.0`, no reliance on injected secrets).
3. Zip the **contents** of `app/` so the `Dockerfile` sits at the ZIP root.
   Exclude `node_modules`, build output, and — importantly — any secrets: real
   `.env` files, tokens/keys, and data dirs must never enter the ZIP (the backend
   stores it server-side).

   ```bash
   cd app && zip -r ../app.zip . \
     -x 'node_modules/*' '*/node_modules/*' 'dist/*' '.env' '.env.*' '.data/*' && cd ..
   # Sanity-check nothing sensitive slipped in:
   unzip -l ../app.zip | grep -iE '\.env|secret|credential|\.pem|\.key' && echo 'STOP: secret in zip' || echo 'ok'
   ```

4. Upload the ZIP to the deploy endpoint as multipart/form-data. The PLN backend
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

5. On success the response contains the deployment URL and status:

   ```json
   { "status": "READY", "url": "https://sandbox-<appId>.plnetwork.io", "host": "...", "port": 31001 }
   ```

   Use this URL only for the internal checks below — **do not reveal it to the
   member** (see "Keep the deployment URL private"). On `READY`, tell the member the
   app is live and can be opened from the PL Infra → AI Apps dashboard. If `status`
   is `ERROR`, surface `notes` (never the URL).

6. **Verify the app is iframe-embeddable** (internal check — do not surface the URL
   to the member). The dashboard shows it in an `<iframe>` from a sibling
   `*.plnetwork.io` subdomain; check the live response headers:

   ```bash
   curl -sSI "https://sandbox-<appId>.plnetwork.io/" | grep -iE 'x-frame-options|content-security-policy'
   ```

   It must pass BOTH:
   - **No `X-Frame-Options` header** (it can't allow a sibling subdomain; if present
     it blocks the embed).
   - If a `Content-Security-Policy` is present, its `frame-ancestors` must include
     `https://*.plnetwork.io` (and must NOT be `'none'`).

   If either fails, the embed will show `refused to connect`. Fix the app's headers
   (see the framing rule in `AGENTS.md`) and redeploy before reporting success.

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
curl -sS -m 20 -o /dev/null -w '%{http_code}\n' "https://sandbox-<appId>.plnetwork.io/health"
```

If it returns `200` within a minute or two, the deploy worked — proceed to the
verification steps. Only re-deploy if it stays unreachable.

## Notes
- Reuse the same `appId` to redeploy an existing app; use a new `deploymentId`
  each time. Derive the URL from the `appId` for your own checks, but treat it as
  sensitive (see "Keep the deployment URL private").
- The deploy token authenticates you as the member — keep it secret.
- The sandbox injects no runtime env vars or secrets. An app that needs config must
  ship sensible defaults or degrade gracefully (e.g. sample data) — see the
  migration checklist in `AGENTS.md`.
