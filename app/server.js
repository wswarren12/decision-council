// Decision Council — thin PLN sandbox container.
//
// Holds NO secrets (the sandbox injects none): it serves the SPA, answers
// /health, verifies the forwarded LabOS JWT (shim — PRD F-7 / OQ#8), and
// extracts attachment text. Everything secret-touching (LLM calls, the
// persona mappings) lives in the Supabase Edge Functions.

const express = require('express');
const multer = require('multer');
const { resolveSession, isConfigured } = require('./labos');
const { extractAll, MAX_TOTAL_BYTES } = require('./extract');

const app = express();
const port = process.env.PORT || 3000;

app.disable('x-powered-by');

// Deploy contract: iframe-embeddable from *.plnetwork.io. NO X-Frame-Options
// header (it cannot express "allow a sibling subdomain"); CSP frame-ancestors
// carries the policy instead.
app.use((_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self' https://plnetwork.io https://*.plnetwork.io",
  );
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// Public, non-secret runtime config for the SPA. The Supabase anon key is
// public by design — access control is enforced by RLS, not by hiding it.
app.get('/api/config', (_req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || 'https://zhetwcmfrzrsokfzthhl.supabase.co',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY ||
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoZXR3Y21mcnpyc29rZnp0aGhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1MzM0MjEsImV4cCI6MjA5OTEwOTQyMX0.jQNd3zLU-O5j7-VF8u8lS4eFp_qhU6BE1LfwIlks2Ko',
    labosConfigured: isConfigured(),
  });
});

// LabOS identity (F-7). The gateway forwards the member JWT on requests it
// proxies to this container, so the SPA asks here for its session. Until
// OQ#8 is resolved this reports "unconfigured" and the SPA uses the interim
// anonymous-auth fallback (or demo mode).
app.get('/api/session', async (req, res) => {
  const session = await resolveSession(req);
  // The verified token is returned to the SPA for Supabase third-party auth;
  // it is never logged and never placed in a URL.
  res.json(session);
});

// Attachment text extraction (F-4). Files are transient — held in memory for
// extraction only; extracted text is stored in Postgres by the Edge Function.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_TOTAL_BYTES, files: 12 },
});
app.post('/api/extract', upload.array('files'), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'no files uploaded' });
    const results = await extractAll(files);
    res.json({ files: results });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'extraction failed' });
  }
});
// Multer errors (per-file >20MB etc.) surface as specific inline messages,
// not silent drops (AC-4.2).
app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(413).json({ error: `upload rejected: ${err.message} — the limit is 20 MB total per deliberation` });
  }
  return next(err);
});

app.use(express.static('public'));

app.listen(port, '0.0.0.0', () => console.log(`decision-council listening on ${port}`));
