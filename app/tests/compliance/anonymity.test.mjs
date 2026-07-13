// AC-1.2 / AC-2.2: persona names must never reach the client. The client
// bundle (public/) must not contain them, and the sanitization pass must
// strip them from advisor output before storage.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { sanitizeOpinion } = await import(join(APP, 'lib', 'council-core.mjs'));

const PERSONA_NAMES = [
  /\bcontrarian\b/i,
  /first[- ]principles/i,
  /\bexpansionist\b/i,
  /\bthe outsider\b/i,
  /\bthe executor\b/i,
];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('advisor anonymity', () => {
  it('no client-served asset (public/, incl. the demo fixture) names a persona', () => {
    for (const file of walk(join(APP, 'public'))) {
      const body = readFileSync(file, 'utf8');
      for (const rx of PERSONA_NAMES) {
        expect(rx.test(body), `${file} matches ${rx}`).toBe(false);
      }
    }
  });

  it('sanitizeOpinion strips persona names and charter phrases from output', () => {
    const leaky = [
      'As the Contrarian, my job as the designated adversary is to attack this.',
      'The First-Principles Thinker in me says rebuild from core truths.',
      'Being the council\'s possibility engine, the Expansionist sees three options.',
      'The Outsider asks the dumb-smart question here.',
      'The Executor wants a Monday-morning plan.',
    ].join('\n');
    const clean = sanitizeOpinion(leaky);
    for (const rx of PERSONA_NAMES) expect(rx.test(clean), `sanitized text matches ${rx}`).toBe(false);
    expect(clean).not.toMatch(/designated adversary|possibility engine|dumb[- ]smart|monday[- ]morning plan/i);
  });

  it('sanitizeOpinion leaves ordinary argument text untouched', () => {
    const text = 'The plan rests on one load-bearing assumption about member trust. Confidence: high';
    expect(sanitizeOpinion(text)).toBe(text);
  });
});
