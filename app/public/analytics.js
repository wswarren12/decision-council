// PLN baseline usage analytics (kit v1.9, .claude/skills/app-analytics).
// Fire-and-forget: never awaited, never throws — the app works identically
// if the endpoint is unreachable. No PII is sent; identity is attributed
// server-side from the Bearer token.
const ANALYTICS_URL = 'https://api-directory.plnetwork.io/v1/ai-apps/track';

function readAuthToken() {
  const match = document.cookie.match(/(?:^|;\s*)authToken=([^;]*)/);
  if (!match) return null;
  const raw = decodeURIComponent(match[1]).replace(/^"|"$/g, '');
  return raw || null;
}

function getAnonId() {
  let id = localStorage.getItem('pln_anon_id');
  if (!id) {
    id = `anon:${crypto.randomUUID()}`;
    localStorage.setItem('pln_anon_id', id);
  }
  return id;
}

function trackEvent(name, properties = {}) {
  const token = readAuthToken();
  const body = JSON.stringify({ event: name, properties, anonId: token ? undefined : getAnonId() });
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  fetch(ANALYTICS_URL, { method: 'POST', headers, body, keepalive: true }).catch(() => {});
}

function initAppAnalytics() {
  const openedAt = Date.now();
  trackEvent('opened');

  // Cap error events so a crash-looping bug can't spam the shared project.
  let errorCount = 0;
  const MAX_ERROR_EVENTS = 5;
  function trackErrorOnce(message, errorSource) {
    if (errorCount >= MAX_ERROR_EVENTS) return;
    errorCount += 1;
    trackEvent('error', { message: String(message).slice(0, 300), errorSource: errorSource });
  }
  window.addEventListener('error', (e) => trackErrorOnce(e.message, 'window.onerror'));
  window.addEventListener('unhandledrejection', (e) =>
    trackErrorOnce(e.reason && e.reason.message ? e.reason.message : String(e.reason), 'unhandledrejection')
  );

  // Approximate session length: fires once per background-tab transition.
  let closedSent = false;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && !closedSent) {
      closedSent = true;
      trackEvent('closed', { durationMs: Date.now() - openedAt });
    } else if (document.visibilityState === 'visible') {
      closedSent = false;
    }
  });
}

initAppAnalytics();
