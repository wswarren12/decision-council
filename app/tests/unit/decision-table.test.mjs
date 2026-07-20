// Stage 4 — the Chairperson's decision table and its Word (.docx) render.
//
// The table follows the PLAA decision-table method: row-label column, the
// TRUE Status Quo, 1–3 options, constituent-tailored rows, and mandatory
// Recommendation + Notes rows. validateDecisionTable is the shape gate for
// model output AND for the stateless docx endpoint's input.

import { describe, it, expect } from 'vitest';
import {
  buildDecisionTablePrompt,
  buildIntakePrompt,
  validateDecisionTable,
} from '../../lib/council-core.mjs';
import { crc32, decisionTableDocx, escXml, zipStore } from '../../lib/docx.mjs';

const goodTable = () => ({
  title: 'Cutover timing',
  decision_question: 'Cut over now or at the boundary?',
  recommendation_preview: 'Wait for the boundary.',
  columns: ['Status Quo — keep the form', 'Boundary Cutover'],
  rows: [
    { label: 'Description', cells: ['Form stays.', 'Cut at boundary.'] },
    { label: 'Member impact', cells: ['No impact.', 'Favorable: clean reset.'] },
    { label: 'Recommendation', cells: ['Bridge only.', 'Recommended primary direction.'] },
    { label: 'Notes / open questions', cells: ['Assumes no data corruption.', 'Dry-run owner unnamed.'] },
  ],
});

describe('validateDecisionTable', () => {
  it('accepts and normalizes a well-formed table', () => {
    const t = validateDecisionTable(goodTable());
    expect(t).not.toBeNull();
    expect(t.columns).toHaveLength(2);
    expect(t.rows).toHaveLength(4);
  });

  it('requires the first column to be the Status Quo', () => {
    const bad = goodTable();
    bad.columns[0] = 'Option Zero';
    expect(validateDecisionTable(bad)).toBeNull();
  });

  it('rejects rows whose cell count does not match the columns', () => {
    const bad = goodTable();
    bad.rows[1].cells = ['only one'];
    expect(validateDecisionTable(bad)).toBeNull();
  });

  it('requires Recommendation and Notes rows — a table without them is a discovery dump', () => {
    const noReco = goodTable();
    noReco.rows = noReco.rows.filter((r) => r.label !== 'Recommendation');
    // keep row count valid by padding a filler row
    noReco.rows.push({ label: 'Time / cost', cells: ['None.', 'Two weeks.'] });
    expect(validateDecisionTable(noReco)).toBeNull();

    const noNotes = goodTable();
    noNotes.rows = noNotes.rows.filter((r) => !/notes/i.test(r.label));
    noNotes.rows.push({ label: 'Time / cost', cells: ['None.', 'Two weeks.'] });
    expect(validateDecisionTable(noNotes)).toBeNull();
  });

  it('caps table width at Status Quo + 3 options', () => {
    const wide = goodTable();
    wide.columns = ['Status Quo', 'A', 'B', 'C', 'D'];
    wide.rows = wide.rows.map((r) => ({ ...r, cells: ['1', '2', '3', '4', '5'] }));
    expect(validateDecisionTable(wide)).toBeNull();
  });

  it('rejects junk input outright', () => {
    expect(validateDecisionTable(null)).toBeNull();
    expect(validateDecisionTable('table please')).toBeNull();
    expect(validateDecisionTable({})).toBeNull();
  });

  it('length-caps runaway cells instead of passing them through', () => {
    const long = goodTable();
    long.rows[0].cells[0] = 'x'.repeat(5000);
    const t = validateDecisionTable(long);
    expect(t.rows[0].cells[0].length).toBeLessThanOrEqual(900);
  });
});

describe('buildDecisionTablePrompt', () => {
  const prompt = buildDecisionTablePrompt({
    preamble: 'PREAMBLE',
    restated: 'Cut over now or later?',
    question: 'full question',
    opinions: [{ letter: 'A', text: 'opinion A' }],
    verdict: 'the verdict',
    mode: 'full',
  });

  it('carries the decision-table method: honest Status Quo, named options, mandatory closing rows', () => {
    expect(prompt).toMatch(/TRUE Status Quo/);
    expect(prompt).toMatch(/never a strawman|never 'Option A'/i);
    expect(prompt).toMatch(/'Recommendation' and 'Notes \/ open questions'/);
    expect(prompt).toMatch(/label \+ mechanism/i);
  });

  it('demands strict JSON with per-column cells and legal-as-review framing', () => {
    expect(prompt).toMatch(/ONLY a JSON object/);
    expect(prompt).toMatch(/exactly one cell per column/);
    expect(prompt).toMatch(/issues to review, not conclusions/i);
  });

  it('includes the preamble (house rules ride into every call) and the record', () => {
    expect(prompt).toContain('PREAMBLE');
    expect(prompt).toContain('opinion A');
    expect(prompt).toContain('the verdict');
  });
});

describe('intake status-quo gate', () => {
  it('asks the model to flag a missing baseline and request current state + alternatives', () => {
    const prompt = buildIntakePrompt('Should we do X?');
    expect(prompt).toMatch(/needs_context/);
    expect(prompt).toMatch(/current state/i);
    expect(prompt).toMatch(/alternatives/i);
    expect(prompt).toMatch(/context_request/);
  });
});

describe('docx render', () => {
  it('escXml neutralizes markup in model text', () => {
    expect(escXml('<w:evil> & "quotes"')).toBe('&lt;w:evil&gt; &amp; &quot;quotes&quot;');
  });

  it('crc32 matches the reference vector', () => {
    // Canonical CRC-32 check value for the ASCII string "123456789".
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('zipStore writes a readable stored archive (signatures + entry count)', () => {
    const buf = zipStore([{ name: 'a.txt', data: Buffer.from('hello') }]);
    expect(buf.readUInt32LE(0)).toBe(0x04034b50); // local header
    expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50); // EOCD
    expect(buf.readUInt16LE(buf.length - 22 + 10)).toBe(1); // total entries
  });

  it('produces a docx with the three mandatory parts and the table content', () => {
    const buf = decisionTableDocx(validateDecisionTable(goodTable()));
    const s = buf.toString('utf8');
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    expect(s).toContain('[Content_Types].xml');
    expect(s).toContain('_rels/.rels');
    expect(s).toContain('word/document.xml');
    expect(s).toContain('Status Quo — keep the form');
    expect(s).toContain('Recommended primary direction.');
    expect(s).toContain('w:orient="landscape"');
  });

  it('never lets model text break the XML', () => {
    const t = validateDecisionTable(goodTable());
    t.rows[0].cells[0] = 'has <tags> & "chars"';
    const s = decisionTableDocx(t).toString('utf8');
    expect(s).toContain('has &lt;tags&gt; &amp; &quot;chars&quot;');
    expect(s).not.toContain('has <tags>');
  });
});
