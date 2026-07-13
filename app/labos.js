// LabOS identity shim (PRD F-7) — BLOCKED on Open Question #8.
//
// The exact LabOS JWT contract (forwarded header name, issuer, audience,
// JWKS URL, member-id claim) is unconfirmed with PL Infra, so verification
// lives behind this config shim: until the four LABOS_* env vars are set,
// the shim reports "unconfigured" and the SPA falls back to anonymous auth
// (interim, per PRD §A.2) or demo mode.
//
// Hard rules honored here (AC-7.3/7.4): an unverified forwarded header is
// NEVER trusted — bad signature/issuer/audience/expiry → no session. The
// token is never logged and never placed in a URL.

const CONFIG = {
  jwksUrl: process.env.LABOS_JWKS_URL || null,
  issuer: process.env.LABOS_ISSUER || null,
  audience: process.env.LABOS_AUDIENCE || null,
  // Header the LabOS gateway uses to forward the member JWT.
  headerName: (process.env.LABOS_JWT_HEADER || 'x-labos-jwt').toLowerCase(),
};

function isConfigured() {
  return Boolean(CONFIG.jwksUrl && CONFIG.issuer && CONFIG.audience);
}

let jwks = null; // lazily-created remote JWKS (jose is ESM-only)

// Returns { mode: 'labos', token, sub } on a verified forwarded token,
// { mode: 'unconfigured' } while OQ#8 is unresolved, and
// { mode: 'unauthenticated' } for a missing/forged/expired token.
async function resolveSession(req) {
  if (!isConfigured()) return { mode: 'unconfigured' };

  const token = req.headers[CONFIG.headerName];
  if (!token || typeof token !== 'string') return { mode: 'unauthenticated' };

  try {
    const { createRemoteJWKSet, jwtVerify } = await import('jose');
    if (!jwks) jwks = createRemoteJWKSet(new URL(CONFIG.jwksUrl));
    const { payload } = await jwtVerify(token, jwks, {
      issuer: CONFIG.issuer,
      audience: CONFIG.audience,
    });
    if (typeof payload.sub !== 'string' || !payload.sub) {
      return { mode: 'unauthenticated' };
    }
    return { mode: 'labos', token, sub: payload.sub };
  } catch {
    // Verification or JWKS fetch failure → treat as unauthenticated
    // (demo mode downstream), never a 500 and never a silent trust.
    return { mode: 'unauthenticated' };
  }
}

module.exports = { resolveSession, isConfigured };
