---
name: app-logs
description: Fetch the deployed app's build logs (Docker/Kaniko image build output) and runtime logs (the running app's stdout/stderr) from the PLN (or PL) sandbox. Use whenever a deploy fails or returns status ERROR, the deployed app crashes / misbehaves / shows a 5xx, or the member asks what their app is doing ("get the logs", "why is it broken?"). Requires a deploy token from the connect flow.
---

# App logs — build & runtime

The PLN sandbox keeps two log streams per app in CloudWatch, and you can fetch
both through the PLN API:

- **Build logs** — the output of the image build (Docker/Kaniko) from the latest
  successful build. Read these when a **deploy fails** or the build seems wrong
  (missing dependency, compile error, bad Dockerfile step).
- **Runtime logs** — stdout + stderr of the running app pod from the latest
  successful runtime deployment. Read these when the **deployed app errors,
  crashes, or misbehaves** (5xx from the app, feature not working, silent
  failures).

## Endpoints

`buildLogsEndpoint` and `runtimeLogsEndpoint` in `pln-app.config.json` are URL
**templates** — replace the literal `{appUid}` with the app's `uid` (saved as
`appUid` in the config after the first deploy/draft upload). Auth is the same
short-lived deploy token used for deploys, in the `x-app-token`
header — if you don't hold a live one, run the connect flow from the
deploy-to-labs skill first.

Query parameters (all optional):

- `limit` — max number of log events per page.
- `sinceMinutes` — time window looking back from now (e.g. `60` = last hour,
  `1440` = last 24 h, `10080` = last 7 days).
- `nextToken` — pagination cursor from the previous response.

```bash
# Runtime logs for the last hour
curl -sS "<runtimeLogsEndpoint with {appUid} replaced>?limit=100&sinceMinutes=60" \
  -H "x-app-token: <deployToken>"

# Build logs for the last 24 hours
curl -sS "<buildLogsEndpoint with {appUid} replaced>?limit=100&sinceMinutes=1440" \
  -H "x-app-token: <deployToken>"
```

Response shape (log events are CloudWatch events, oldest first):

```json
{
  "appId": "my-app",
  "deploymentId": "deploy-…",
  "phase": "runtime",
  "source": "cloudwatch",
  "logGroup": "/eks/…",
  "events": [ { "timestamp": 1786000000000, "message": "app listening on 3000" } ],
  "nextToken": "…"
}
```

## Pagination — empty pages are normal

CloudWatch may return an **empty `events` page that still carries a
`nextToken`**. An empty first page does NOT mean there are no logs — keep
following `nextToken` (URL-encode it) for a few pages before concluding the
window has nothing:

```bash
curl -sS "<logs endpoint>?limit=100&sinceMinutes=1440&nextToken=<url-encoded token>" \
  -H "x-app-token: <deployToken>"
```

Stop when a page repeats the same `nextToken` or you've seen enough. Log
availability is bounded by the CloudWatch retention policy — very old deploys
may have no logs left.

## How to use them when debugging

1. **Deploy returned ERROR / the build failed** → fetch **build** logs
   (`sinceMinutes` covering the deploy attempt, e.g. 60) and look for the
   failing Dockerfile step, npm/compile error, or missing file. Fix and redeploy.
2. **App is deployed but broken** (blank page, 5xx, feature not working) →
   fetch **runtime** logs for the last 30–60 min, reproduce the issue (reload
   the app), then fetch again and diff for new errors/stack traces.
3. **`OOMKilled` or exit code 137 in either log stream** means the build or
   the running app exceeded its memory limit (see "Resource limits" in
   `AGENTS.md`) — this isn't a code bug to trace, it's a memory-footprint
   problem. Reduce memory usage (fewer parallel build workers, disable
   source maps, avoid large in-memory caches/datasets) and redeploy.
3. Summarize what you found for the member in plain words ("the build failed
   because a package is missing"), fix it, and redeploy. Don't dump raw logs on
   a non-technical member unless they ask.

## Rules

- Owner-only: the token's member must own the app (403 otherwise), and the app
  must have been uploaded at least once (404 before that).
- The privacy rule from the deploy skill applies: log lines may contain the
  app's own URL/host — keep using them internally, don't surface the URL to
  the member.
- Never paste secret values that may appear in logs back into the chat or any
  file; if you spot one in a log line, tell the member to rotate it via
  Deployment settings.
- The deploy token stays in memory only — same handling as deploys.
