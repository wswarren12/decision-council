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
  child = spawn('node', ['server.js'], {
    cwd: APP,
    env: { ...process.env, PORT: String(PORT) },
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
    expect(html).toContain('Decision Council');
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

  it('/api/config ships only public values', async () => {
    const cfg = await (await fetch(`${BASE}/api/config`)).json();
    expect(cfg.supabaseUrl).toMatch(/^https:\/\/.*supabase\.co$/);
    const payload = JSON.parse(Buffer.from(cfg.supabaseAnonKey.split('.')[1], 'base64url').toString());
    expect(payload.role).toBe('anon');
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
