// LabOS member identity (v1.8 member-context contract).
//
// Deployed apps receive the LabOS login cookie (`authToken`) on every
// request; we present it to the PLN member API as a Bearer token and get
// back { uid, name, ... }. No login UI of our own — this IS the login.
// Locally there is no PLN cookie, so DEV_MEMBER=<name> in local.env
// simulates a signed-in member for testing.
//
// Rules honored (pln-member-context skill): the token is never logged,
// never persisted, never sent anywhere but the PLN endpoint; a missing or
// rejected token is a signed-out member, never an error.

const MEMBER_CONTEXT_URL = 'https://api-directory.plnetwork.io/v1/ai-apps/me';

// token -> { member, exp } — avoids hitting the PLN API on every request.
// ponytail: unbounded-ish in-memory cache with 5-min TTL and a hard size
// cap; move to a real cache if this app ever sees serious traffic.
const cache = new Map();
const TTL_MS = 5 * 60 * 1000;
const MAX_CACHE = 500;

function readAuthToken(req) {
  const m = /(?:^|;\s*)authToken=([^;]*)/.exec(req.headers.cookie || '');
  if (!m) return null;
  // Cookie value is URL-encoded and JSON-quoted (%22eyJ...%22).
  const raw = decodeURIComponent(m[1]).replace(/^"|"$/g, '');
  return raw || null;
}

// Returns { uid, name } or null (signed out / unreachable).
export async function resolveMember(req) {
  const token = readAuthToken(req);
  if (!token) {
    const dev = process.env.DEV_MEMBER;
    if (dev) return { uid: `dev:${dev.toLowerCase()}`, name: dev };
    return null;
  }

  const hit = cache.get(token);
  if (hit && hit.exp > Date.now()) return hit.member;

  try {
    const res = await fetch(MEMBER_CONTEXT_URL, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null; // 401 signed out, 403 no AI Apps access
    const { member } = await res.json();
    if (!member?.uid) return null;
    const slim = { uid: String(member.uid), name: String(member.name || 'Member') };
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(token, { member: slim, exp: Date.now() + TTL_MS });
    return slim;
  } catch {
    return null; // network/CORS failure — treat as signed out
  }
}
