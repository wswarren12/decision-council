// AC-5.C / §0 vocabulary gate: "earn" (any inflection) must be absent from
// the PL context pack and ALL user-facing copy. PLAA points are COLLECTED.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// \bearn catches earn/earned/earning/earns but not "learn"/"yearn".
const EARN = /\bearn\w*/gi;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('PLAA vocabulary (collect, never earn)', () => {
  it('context pack contains no form of "earn" and does use "collect"', () => {
    const pack = readFileSync(join(APP, 'context', 'pl-context-pack.md'), 'utf8');
    expect(pack.match(EARN)).toBeNull();
    expect(pack.toLowerCase()).toContain('collect');
  });

  it('no user-facing asset (public/) contains any form of "earn"', () => {
    for (const file of walk(join(APP, 'public'))) {
      const body = readFileSync(file, 'utf8');
      const hits = body.match(EARN);
      expect(hits, `${file} contains ${JSON.stringify(hits)}`).toBeNull();
    }
  });

  it('the shared preamble carries the vocabulary rules into every LLM call', async () => {
    const { buildPreamble } = await import(join(APP, 'lib', 'council-core.mjs'));
    const preamble = buildPreamble('pack body', '1.0-test');
    expect(preamble).toMatch(/COLLECT points/);
    expect(preamble).toMatch(/never make price predictions/i);
  });
});
