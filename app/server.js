// Decision Council — self-contained PLN sandbox container.
//
// Serves the SPA, answers /health, extracts attachment text, and runs the
// five-advisor deliberation engine (council.js) against the Anthropic API.
// ANTHROPIC_API_KEY arrives as a regular env var via the LabOS secrets flow
// (v1.3 kit draft registration); without it the app degrades to demo mode.

import express from 'express';
import multer from 'multer';
import { resolveSession, isConfigured } from './labos.js';
import { resolveMember } from './identity.js';
import { getHistory, getProfile, setPreferences } from './store.js';
import { extractAll, MAX_TOTAL_BYTES } from './extract.js';
import {
  agentFollowupHandler,
  agentRetryHandler,
  agentStartHandler,
  agentStatusHandler,
  councilHandler,
  liveEnabled,
} from './council.js';
import { decisionTableMarkdown, validateDecisionTable } from './lib/council-core.mjs';
import { decisionTableDocx } from './lib/docx.mjs';

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

// Public, non-secret runtime config for the SPA. `live` only reports WHETHER
// a key is configured — never the key itself.
app.get('/api/config', (_req, res) => {
  res.json({
    live: liveEnabled(),
    labosConfigured: isConfigured(),
  });
});

// LabOS identity (F-7). The gateway forwards the member JWT on requests it
// proxies to this container, so the SPA asks here for its session. Until
// OQ#8 is resolved this reports "unconfigured" and the SPA runs identity-less.
app.get('/api/session', async (req, res) => {
  const session = await resolveSession(req);
  // The verified token is never logged and never placed in a URL.
  res.json(session);
});

// Member identity rides on the LabOS authToken cookie (v1.8 member-context
// contract); resolveMember returns null for signed-out visitors and the app
// keeps working anonymously (no profile/history, global cap only).
const withMember = async (req, _res, next) => {
  req.member = await resolveMember(req);
  next();
};

// Profile: who am I, my preferences, my remaining daily runs.
app.get('/api/me', withMember, (req, res) => {
  if (!req.member) return res.json({ member: null });
  res.json({ member: req.member, ...getProfile(req.member.uid) });
});

app.put('/api/me/preferences', withMember, express.json({ limit: '64kb' }), (req, res) => {
  if (!req.member) return res.status(401).json({ error: 'not_signed_in' });
  setPreferences(req.member.uid, req.body?.preferences);
  res.json({ ok: true, ...getProfile(req.member.uid) });
});

// Last 10 runs (each carries its table JSON, so the stateless .md/.docx
// renderers can re-download any of them).
app.get('/api/me/history', withMember, (req, res) => {
  if (!req.member) return res.status(401).json({ error: 'not_signed_in' });
  res.json({ history: getHistory(req.member.uid) });
});

// The deliberation engine (intake / start / stage / table / followup).
app.post('/api/council', express.json({ limit: '2mb' }), withMember, councilHandler);

// Agent API — a one-shot, pollable surface for machine callers (a member's
// personal agent, e.g. Hermes). GET /api/agent is the JSON manifest;
// /llms.txt is the discovery convention pointing at it.
const AGENT_MANIFEST = {
  name: 'PLN Decision Council',
  description: 'Five-advisor AI deliberation. POST a decision question; poll one URL until the verdict and color-rated decision table are ready.',
  auth: 'none — anonymous calls work (global daily cap); LabOS members also get run history',
  endpoints: [
    {
      method: 'POST',
      path: '/api/agent/runs',
      body: {
        question: 'required — the decision to deliberate (max 4000 chars)',
        context: "optional — background from the agent's owner (current state, constraints, options already considered)",
        mode: "optional — 'quick' (default) or 'full' (adds an advisor peer-review round; slower)",
        flow: "optional — 'table' (default; adds a web-research pass before deliberation) or 'council'",
      },
      returns: '202 {run_id, status, poll, poll_seconds, context_request?} — or 200 {status:"answered", answer} when the question does not need a council',
    },
    {
      method: 'GET',
      path: '/api/agent/runs/:run_id',
      returns: '{status: running|complete|failed, stage, verdict?, table?, table_markdown?, context_request?, error?, retry?}. Poll every ~15s; quick runs take a few minutes, full runs longer. If context_request is set, consider re-running with that background in `context`.',
    },
    { method: 'POST', path: '/api/agent/runs/:run_id/retry', returns: 'resumes a failed run — completed advisor rounds are cached and never re-spent' },
    { method: 'POST', path: '/api/agent/runs/:run_id/followup', body: { question: 'ask the Chairperson about the finished deliberation' }, returns: '{answer}' },
    { method: 'POST', path: '/api/decision-table.md', body: { table: 'a `table` object from a completed run' }, returns: 'text/markdown render' },
    { method: 'POST', path: '/api/decision-table.docx', body: { table: 'a `table` object from a completed run' }, returns: 'Word document' },
  ],
  table_ratings: 'each table row carries ratings[] parallel to cells[]: green = best option on that criterion, yellow = medium, red = worst; ties allowed; null = non-evaluative',
  notes: 'Decision support only — not legal, accounting, or financial advice.',
};
app.get('/api/agent', (_req, res) => res.json(AGENT_MANIFEST));
app.get('/llms.txt', (_req, res) => res.type('text/plain').send(
  'PLN Decision Council — agent API\n\n'
  + 'GET /api/agent for the JSON manifest.\n'
  + 'Typical flow: POST /api/agent/runs {"question":"...","context":"..."} → poll GET /api/agent/runs/:run_id every ~15s until status=complete → read verdict + table (per-cell ratings: green=best, yellow=medium, red=worst).\n',
));
app.post('/api/agent/runs', express.json({ limit: '2mb' }), withMember, agentStartHandler);
app.get('/api/agent/runs/:id', agentStatusHandler);
app.post('/api/agent/runs/:id/retry', agentRetryHandler);
app.post('/api/agent/runs/:id/followup', express.json({ limit: '256kb' }), agentFollowupHandler);

// Word-document render of a Chairperson decision table. Stateless by design:
// the SPA posts back the table JSON it received from the `table` action (or
// the demo fixture), so downloads keep working even after a container
// restart forgets the in-memory deliberation. The same validator that gated
// the model's output gates this input, and every string is XML-escaped.
app.post('/api/decision-table.docx', express.json({ limit: '256kb' }), (req, res) => {
  const table = validateDecisionTable(req.body?.table);
  if (!table) return res.status(400).json({ error: 'invalid_table' });
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'Content-Disposition': 'attachment; filename="decision-table.docx"',
  });
  res.send(decisionTableDocx(table));
});

// Markdown render of a decision table — same stateless contract as the docx
// endpoint: the SPA posts back the validated table JSON it already holds.
app.post('/api/decision-table.md', express.json({ limit: '256kb' }), (req, res) => {
  const table = validateDecisionTable(req.body?.table);
  if (!table) return res.status(400).json({ error: 'invalid_table' });
  res.set({
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': 'attachment; filename="decision-table.md"',
  });
  res.send(decisionTableMarkdown(table));
});

// Attachment text extraction (F-4). Files are transient — held in memory for
// extraction only; extracted text lives on the in-memory deliberation.
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

const server = app.listen(port, '0.0.0.0', () => console.log(`decision-council listening on ${port}`));
// Behind the LabOS gateway: keep-alive must outlive the proxy's idle timeout
// (Node's 5s default causes sporadic 502s when the proxy reuses a socket
// Node just closed), and long SSE deliberations must never be cut by Node.
server.keepAliveTimeout = 120_000;
server.headersTimeout = 125_000;
server.requestTimeout = 0;
