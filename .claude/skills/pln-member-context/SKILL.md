---
name: pln-member-context
description: Get the signed-in PLN (or PL) member's identity (name, teams, role, skills) inside a deployed AI App, for personalization and feedback. Use whenever the app should greet the user, tag content with who created it, or adapt to the member using it. Load before writing any code that needs to know who is using the app.
---

# PLN Member Context — who is using the app

Deployed apps are opened by signed-in PLN members from the PL Infra → AI Apps
dashboard. The LabOS login cookie (`authToken`) is scoped to the shared apps
domain, so the app's own origin receives it — the app reads it and presents it
to the PLN API as a Bearer token. No login UI of its own is needed.

## The endpoint

`memberContextEndpoint` in `pln-app.config.json`:

```
GET https://api-directory.plnetwork.io/v1/ai-apps/me
```

Call it from **browser code**, sending the `authToken` cookie value as the
`Authorization` header. Do NOT rely on `credentials: 'include'` alone — the
cookie's domain covers the app hosts but not necessarily the API host, so the
browser may silently omit it (a guaranteed 401). Reading the cookie only needs
the app's own origin, which always works. The config file is not shipped inside
`app/`, so bake the URL into the frontend as a constant:

```js
const MEMBER_CONTEXT_URL = 'https://api-directory.plnetwork.io/v1/ai-apps/me';

// The cookie value is URL-encoded and JSON-quoted (e.g. %22eyJhbGci...%22).
function readAuthToken() {
  const match = document.cookie.match(/(?:^|;\s*)authToken=([^;]*)/);
  if (!match) return null;
  const raw = decodeURIComponent(match[1]).replace(/^"|"$/g, '');
  return raw || null;
}

async function getMemberContext() {
  try {
    const token = readAuthToken();
    const res = await fetch(MEMBER_CONTEXT_URL, {
      // Bearer from the cookie is the reliable path; credentials:'include' is
      // only a fallback for environments where the cookie reaches the API host.
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      credentials: token ? 'omit' : 'include',
    });
    if (!res.ok) return null; // 401 = not signed in, 403 = no AI Apps access
    const { member } = await res.json();
    return member;
  } catch {
    return null; // network/CORS error — treat as signed out
  }
}
```

Response shape (`member`):

```json
{
  "uid": "…",
  "name": "Ada Lovelace",
  "image": "https://…/profile.png",
  "location": { "city": "London", "country": "United Kingdom", "continent": "Europe" },
  "skills": ["Engineering", "Research"],
  "teams": [
    { "uid": "…", "name": "Protocol Labs", "role": "Engineer", "mainTeam": true, "teamLead": false }
  ]
}
```

Fields may be `null`/empty, and new fields may be added over time — ignore
anything you don't recognize. The response deliberately contains **no contact
info** (no email, no office-hours link) — don't build features that assume a
way to reach the member, and don't ask them to type contact details in to
compensate.

## Rules

- **Always handle the signed-out case.** `getMemberContext()` returns `null`
  when the visitor is not signed in, lacks AI Apps access, or when the app runs
  locally (`npm start` — no PLN cookie on localhost). Show a friendly note like
  *"Open this app from the LabOS → AI Apps dashboard to personalize it"* and keep
  the rest of the app working. Never crash or block on missing identity.
- **Personalization only, not authentication.** Use the identity to greet the
  member, tag feedback/content with who wrote it, or tailor behavior. Do not
  gate sensitive or destructive actions on it, and don't build your own
  session/auth system on top.
- Call it client-side. If you must know the member on your server, do the same
  thing there: the `authToken` cookie arrives on every request to the app, so
  decode it (URL-decode, strip the surrounding double quotes) and forward it to
  the endpoint as `Authorization: Bearer <token>`. Never store or log the
  token, and never send it — or the member's data — to any third-party service.
- Keep the token in memory for the current page only — don't persist it to
  localStorage, files, or your own backend.
- This is the only PLN member API available to apps. Don't call other internal
  PLN endpoints; if the app needs more PLN data than this provides, tell the
  member it isn't available yet.
