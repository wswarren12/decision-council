// AC-6.2: the Anthropic key and service_role key exist ONLY as Supabase
// secrets. Nothing shippable (anything under app/ that isn't excluded from
// the deploy zip) may contain key material. The only JWT allowed in the
// bundle is the PUBLIC anon key (role: "anon" — safe by design under RLS).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// tests/ is excluded from the deploy zip (.dockerignore), and this file
// necessarily contains the very literals it scans for.
const SKIP = new Set(['node_modules', 'coverage', '.DS_Store', 'tests']);
// Built by concatenation so this scanner never matches itself elsewhere.
const ANTHROPIC_PREFIX = 'sk-' + 'ant-';
const SERVICE_ROLE_LITERAL = 'SUPABASE_SERVICE' + '_ROLE_KEY';

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

  it('every JWT-shaped string in the bundle decodes to role "anon"', () => {
    const jwtRx = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
    for (const f of files) {
      for (const token of readFileSync(f, 'utf8').match(jwtRx) ?? []) {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
        expect(payload.role, `${relative(APP, f)} ships a JWT with role "${payload.role}"`).toBe('anon');
      }
    }
  });

  it('no service_role literal outside comments/docs', () => {
    for (const f of files.filter((x) => /\.(js|mjs|json|html|css)$/.test(x))) {
      const code = readFileSync(f, 'utf8')
        .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
      expect(code.includes(SERVICE_ROLE_LITERAL), `${relative(APP, f)} references the service_role key`).toBe(false);
    }
  });

  it('the deploy zip excludes env files and node_modules (.dockerignore)', () => {
    const ignore = readFileSync(join(APP, '.dockerignore'), 'utf8');
    expect(ignore).toMatch(/^node_modules$/m);
    expect(ignore).toMatch(/^\.env$/m);
  });
});
