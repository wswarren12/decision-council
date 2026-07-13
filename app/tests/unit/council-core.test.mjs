// Unit tests for the shared engine logic (the same file deployed inside the
// council Edge Function): mapping randomization (AC-1.4), attachment
// truncation (F-4), prompt assembly (AC-1.C/5.1), verdict parsing, memory.

import { describe, it, expect } from 'vitest';
import {
  LETTERS,
  randomMapping,
  fitAttachments,
  buildPreamble,
  buildStage1Prompt,
  buildStage2Prompt,
  buildChairmanPrompt,
  extractConfidence,
  extractJson,
  parseMemoryFromVerdict,
  stripMemoryBlock,
  relevantHistorySummary,
  confidenceSpread,
} from '../../lib/council-core.mjs';
import { PERSONAS, PERSONA_KEYS } from '../../lib/personas.mjs';

describe('randomMapping (AC-1.4)', () => {
  it('assigns each of the five personas to exactly one letter', () => {
    const m = randomMapping(PERSONA_KEYS);
    expect(Object.keys(m).sort()).toEqual([...LETTERS].sort());
    expect(new Set(Object.values(m)).size).toBe(5);
    for (const p of Object.values(m)) expect(PERSONA_KEYS).toContain(p);
  });

  it('is independently randomized per deliberation (varies across runs)', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(JSON.stringify(randomMapping(PERSONA_KEYS)));
    expect(seen.size).toBeGreaterThan(10); // 120 permutations exist; ~10+ in 200 draws is conservative
  });

  it('is deterministic given an injected rand', () => {
    let calls = 0;
    const rand = () => (calls++, 0); // always swap with index 0
    const a = randomMapping(PERSONA_KEYS, rand);
    calls = 0;
    const b = randomMapping(PERSONA_KEYS, rand);
    expect(a).toEqual(b);
  });
});

describe('fitAttachments (F-4 truncation)', () => {
  it('includes everything under budget with a full-inclusion note', () => {
    const out = fitAttachments([{ filename: 'a.md', text: 'short' }], 1000);
    expect(out.truncated).toBe(false);
    expect(out.text).toContain('short');
    expect(out.note).toContain('in full');
  });

  it('truncates the largest files first and says so', () => {
    const big = 'B'.repeat(900);
    const small = 'S'.repeat(100);
    const out = fitAttachments(
      [{ filename: 'small.txt', text: small }, { filename: 'big.txt', text: big }],
      500,
    );
    expect(out.truncated).toBe(true);
    expect(out.text).toContain(small);            // small file survives intact
    expect(out.text).toContain('[…truncated…]');  // big file visibly cut
    expect(out.note).toMatch(/largest files truncated first/);
  });
});

describe('prompt assembly (AC-1.C / AC-5.1 / AC-4.3)', () => {
  const preamble = buildPreamble('THE-PACK-BODY', 'v-test');

  it('preamble stamps the context pack version and body', () => {
    expect(preamble).toContain('THE-PACK-BODY');
    expect(preamble).toContain('version="v-test"');
  });

  it('every stage-1 prompt carries preamble, charter, question, and attachments', () => {
    for (const key of PERSONA_KEYS) {
      const p = buildStage1Prompt({
        preamble,
        charter: PERSONAS[key],
        question: 'THE-QUESTION',
        restated: 'THE-RESTATED',
        attachmentsText: 'THE-ATTACHMENT-TEXT',
        historySummary: 'THE-HISTORY',
        isOutsider: key === 'outsider',
      });
      expect(p).toContain('THE-PACK-BODY');
      expect(p).toContain('THE-QUESTION');
      expect(p).toContain('THE-ATTACHMENT-TEXT');
      expect(p).toContain(PERSONAS[key].slice(0, 40));
    }
  });

  it('the Outsider gets NO history in round 1; everyone else does', () => {
    const args = {
      preamble,
      charter: PERSONAS.outsider,
      question: 'q',
      restated: 'r',
      attachmentsText: '',
      historySummary: 'THE-HISTORY',
    };
    expect(buildStage1Prompt({ ...args, isOutsider: true })).not.toContain('THE-HISTORY');
    expect(buildStage1Prompt({ ...args, isOutsider: false })).toContain('THE-HISTORY');
  });

  it('stage-2 prompts label peers as Advisor A–E only', () => {
    const p = buildStage2Prompt({
      preamble,
      charter: PERSONAS.contrarian,
      ownLetter: 'C',
      ownOpinion: 'mine',
      peers: LETTERS.filter((l) => l !== 'C').map((l) => ({ letter: l, text: `peer-${l}` })),
      restated: 'r',
    });
    expect(p).toContain('Advisor A');
    expect(p).toContain('Advisor E');
    expect(p).toContain('THE-PACK-BODY'); // preamble present in all 11 calls
  });

  it('the chairman prompt demands all seven verdict sections', () => {
    const p = buildChairmanPrompt({
      preamble, restated: 'r', question: 'q',
      opinions: LETTERS.map((l) => ({ letter: l, text: 't' })),
      mode: 'full',
    });
    for (const h of ['## The question', '## Where the council converged', '## Live disagreements',
      '## The verdict', '## First step', '## Biggest risk', '## Unresolved questions']) {
      expect(p).toContain(h);
    }
  });
});

describe('model-output parsing', () => {
  it('extractConfidence takes the LAST stated confidence', () => {
    expect(extractConfidence('Confidence: high\n…revised…\nConfidence: medium')).toBe('medium');
    expect(extractConfidence('no confidence stated')).toBeNull();
  });

  it('extractJson tolerates prose around the object', () => {
    expect(extractJson('Sure!\n{"convene": true, "restated": "x"}\nDone.')).toEqual({ convene: true, restated: 'x' });
    expect(extractJson('not json at all')).toBeNull();
  });

  it('parses and strips the verdict memory block', () => {
    const verdict = '## The verdict\nWait.\n\n<!--memory\nverdict: Wait for the boundary\ndissent: Cut now\nconfidence_spread: 4-1\nfirst_step: Announce the date\n-->';
    const mem = parseMemoryFromVerdict(verdict);
    expect(mem.verdict).toBe('Wait for the boundary');
    expect(mem.first_step).toBe('Announce the date');
    expect(stripMemoryBlock(verdict)).not.toContain('<!--memory');
  });
});

describe('council memory (Stage 0 / AC-3.2)', () => {
  // Block 0 is old but keyword-rich (matches "change" AND "pricing"); the
  // others match only "pricing" — relevance must beat recency for it.
  const blocks = Array.from({ length: 8 }, (_, i) => ({
    question: i === 0 ? 'Should we change the pricing model?' : `Decision about pricing tier ${i}`,
    verdict_line: `Verdict ${i}`,
    outcome: i === 0 ? 'went_well' : 'pending',
    outcome_note: i === 0 ? 'shipped fine' : null,
    created_at: `2026-06-0${(i % 9) + 1}T00:00:00Z`,
  }));

  it('summarizes at most 5 lines, ranks by relevance, includes outcomes', () => {
    const s = relevantHistorySummary('Should we change our pricing?', blocks);
    expect(s.split('\n').length).toBeLessThanOrEqual(5);
    expect(s).toContain('went well');
    expect(s).toContain('shipped fine');
  });

  it('confidenceSpread formats the five confidences', () => {
    expect(confidenceSpread(['high', 'high', 'medium', 'low', 'high'])).toBe('3 high / 1 medium / 1 low');
    expect(confidenceSpread([null, null, null, null, null])).toBe('unreported');
  });
});
