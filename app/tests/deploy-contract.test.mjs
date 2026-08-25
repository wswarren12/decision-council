// Deploy-contract gate (starter kit hard requirements + AC-6.1 adjacent):
// $PORT + 0.0.0.0, /health -> 200, usable GET /, NO X-Frame-Options, CSP
// frame-ancestors includes *.plnetwork.io. Runs the real server.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
let child;

beforeAll(async () => {
  // Strip the key so demo-mode behavior is deterministic regardless of the
  // developer's shell environment.
  const env = { ...process.env, PORT: String(PORT) };
  delete env.ANTHROPIC_API_KEY;
  child = spawn('node', ['server.js'], {
    cwd: APP,
    env,
    stdio: 'ignore',
  });
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start');
}, 15_000);

afterAll(() => { child?.kill(); });

describe('PLN deploy contract', () => {
  it('GET /health returns 200', async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('GET / renders the app (no bare 404 in the iframe)', async () => {
    const res = await fetch(`${BASE}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Decisions');
  });

  it('GET / carries the legal/accounting/financial advice disclaimer', async () => {
    const html = await (await fetch(`${BASE}/`)).text();
    expect(html).toContain('does not provide legal, accounting, or financial advice');
    expect(html).toContain('appropriate Protocol Labs team');
  });

  it('the SPA never auto-switches Full→Quick — a suggestion needs a member click', async () => {
    const src = await (await fetch(`${BASE}/app.js`)).text();
    const suggestBlock = src.match(/if \(intake\.suggest_quick[\s\S]*?\n    \}/)?.[0] ?? '';
    expect(suggestBlock, 'suggest_quick handling not found').not.toBe('');
    // The mode change must live behind a user action (button onClick),
    // never as a direct statement in the suggestion branch.
    expect(suggestBlock).toContain('onClick');
    expect(suggestBlock).toContain('Switch to Quick');
    expect(suggestBlock.replace(/onClick:.*$/gm, '')).not.toContain("setModeUI('quick')");
  });

  it('council failures provide a copyable support report with an iframe-safe fallback', async () => {
    const src = await (await fetch(`${BASE}/app.js`)).text();
    expect(src).toContain('Copy error to report');
    expect(src).toContain('PLN Decision Council error report');
    expect(src).toContain('navigator.clipboard.writeText(report)');
    expect(src).toContain("window.prompt('Copy this error report:', report)");
  });

  it('sends NO X-Frame-Options header', async () => {
    for (const path of ['/', '/health', '/api/config']) {
      const res = await fetch(`${BASE}${path}`);
      expect(res.headers.get('x-frame-options'), `${path} sent X-Frame-Options`).toBeNull();
    }
  });

  it('CSP frame-ancestors allows plnetwork.io and its subdomains', async () => {
    const csp = (await fetch(`${BASE}/`)).headers.get('content-security-policy');
    expect(csp).toBeTruthy();
    expect(csp).toContain("frame-ancestors 'self' https://plnetwork.io https://*.plnetwork.io");
    expect(csp).not.toContain("frame-ancestors 'none'");
  });

  it('/api/config ships only public booleans — never key material', async () => {
    const cfg = await (await fetch(`${BASE}/api/config`)).json();
    expect(typeof cfg.live).toBe('boolean');
    expect(typeof cfg.labosConfigured).toBe('boolean');
    expect(JSON.stringify(cfg)).not.toContain('sk-' + 'ant-');
  });

  it('/api/council degrades to a structured demo signal without an API key (AC-6.1)', async () => {
    // The test server is spawned WITHOUT ANTHROPIC_API_KEY (see beforeAll).
    const res = await fetch(`${BASE}/api/council`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'intake', question: 'Should we take the partnership?' }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('no_api_key');
    expect(body.demo).toBe(true);
  });

  it('/api/council rejects unknown actions', async () => {
    const res = await fetch(`${BASE}/api/council`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'nope' }),
    });
    expect(res.status).toBe(400);
  });

  it('/api/decision-table.docx returns a downloadable Word archive', async () => {
    const table = {
      title: 'Launch timing',
      decision_question: 'Launch now or later?',
      columns: ['Status Quo', 'Launch now'],
      rows: [
        { label: 'Description', cells: ['Wait.', 'Ship.'] },
        { label: 'Risk', cells: ['Delay.', 'Execution.'] },
        { label: 'Recommendation', cells: ['Fallback.', 'Recommended.'] },
      ],
      notes: ['Confirm the owner.'],
    };
    const res = await fetch(`${BASE}/api/decision-table.docx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(res.headers.get('content-disposition')).toContain('decision-table.docx');
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 2).toString()).toBe('PK');
  });

  it('/api/session reports unconfigured while OQ#8 is unresolved (no header trust)', async () => {
    // Even with a forged header, an unconfigured/unverified token yields no session (AC-7.3).
    const res = await fetch(`${BASE}/api/session`, { headers: { 'x-labos-jwt': 'forged.token.here' } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(['unconfigured', 'unauthenticated']).toContain(body.mode);
    expect(body.mode).not.toBe('labos');
  });

  it('/api/extract rejects unsupported types with a specific error (AC-4.2)', async () => {
    const form = new FormData();
    form.append('files', new File(['x'.repeat(10)], 'evil.exe'), 'evil.exe');
    const res = await fetch(`${BASE}/api/extract`, { method: 'POST', body: form });
    const body = await res.json();
    expect(body.files[0].error).toContain('unsupported type');
  });

  it('/api/extract extracts text from md/txt', async () => {
    const form = new FormData();
    form.append('files', new File(['# Term Sheet\nvaluation cap 8M'], 'memo.md'), 'memo.md');
    const res = await fetch(`${BASE}/api/extract`, { method: 'POST', body: form });
    const body = await res.json();
    expect(body.files[0].text).toContain('valuation cap');
    expect(body.files[0].words).toBeGreaterThan(3);
  });
});

// Agent API (personal-agent surface) — discoverable, and degrades to the
// structured demo signal without a key, same as the SPA flow.
describe('agent API', () => {
  it('is discoverable via /llms.txt and GET /api/agent', async () => {
    const txt = await (await fetch(`${BASE}/llms.txt`)).text();
    expect(txt).toContain('/api/agent/runs');
    const manifest = await (await fetch(`${BASE}/api/agent`)).json();
    expect(manifest.endpoints.some((e) => e.path === '/api/agent/runs')).toBe(true);
    expect(manifest.table_ratings).toContain('green');
  });

  it('POST /api/agent/runs without a key returns the demo signal (503)', async () => {
    const res = await fetch(`${BASE}/api/agent/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Should we migrate the forum?' }),
    });
    expect(res.status).toBe(503);
    expect((await res.json()).demo).toBe(true);
  });

  it('rejects an empty question (400) and 404s unknown runs', async () => {
    const bad = await fetch(`${BASE}/api/agent/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(bad.status).toBe(400);
    const missing = await fetch(`${BASE}/api/agent/runs/nope`);
    expect(missing.status).toBe(404);
    const retryMissing = await fetch(`${BASE}/api/agent/runs/nope/retry`, { method: 'POST' });
    expect(retryMissing.status).toBe(404);
  });
});
