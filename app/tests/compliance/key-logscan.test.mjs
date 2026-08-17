// AC-6.2 (v1.3 secrets flow): the Anthropic key exists ONLY as a runtime env
// var injected by LabOS — the member enters it on the app's LabOS page, never
// in code or config. Nothing shippable (anything under app/ that isn't
// excluded from the deploy zip) may contain key material, and since the
// Supabase backend was retired, no JWT of any kind ships either.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// tests/ is excluded from the deploy zip (.dockerignore), and this file
// necessarily contains the very literals it scans for. local.env is the
// local-dev key file and data/ the runtime profile store — both
// dockerignored, never shipped.
const SKIP = new Set(['node_modules', 'coverage', '.DS_Store', 'tests', 'local.env', 'data']);
// Built by concatenation so this scanner never matches itself elsewhere.
const ANTHROPIC_PREFIX = 'sk-' + 'ant-';

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(APP).filter((f) => !/\.(png|jpg|woff2?)$/.test(f));

describe('no secret material in the shippable app', () => {
  it('no Anthropic API key anywhere', () => {
    for (const f of files) {
      expect(readFileSync(f, 'utf8').includes(ANTHROPIC_PREFIX), `${relative(APP, f)} contains an Anthropic key`).toBe(false);
    }
  });

  it('reads the key ONLY from process.env — never a literal or config file', () => {
    // Every mention of ANTHROPIC_API_KEY in code must be a process.env read.
    for (const f of files.filter((x) => /\.(js|mjs|json)$/.test(x))) {
      const src = readFileSync(f, 'utf8');
      for (const line of src.split('\n')) {
        if (line.includes('ANTHROPIC_API_KEY') && !line.trim().startsWith('//')) {
          expect(line.includes('process.env.ANTHROPIC_API_KEY') || line.includes('env.ANTHROPIC_API_KEY'),
            `${relative(APP, f)} references ANTHROPIC_API_KEY outside process.env: ${line.trim()}`).toBe(true);
        }
      }
    }
  });

  it('no JWT-shaped string ships at all (the Supabase anon key is gone)', () => {
    const jwtRx = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
    for (const f of files) {
      const hits = readFileSync(f, 'utf8').match(jwtRx) ?? [];
      expect(hits.length, `${relative(APP, f)} ships a JWT-shaped string`).toBe(0);
    }
  });

  it('the deploy zip excludes env files and node_modules (.dockerignore)', () => {
    const ignore = readFileSync(join(APP, '.dockerignore'), 'utf8');
    expect(ignore).toMatch(/^node_modules$/m);
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^local\.env$/m);
  });
});
