// docx — renders a validated decision table as a Word (.docx) document.
//
// A .docx is a ZIP archive of WordprocessingML parts. This module hand-rolls
// both layers — stored (uncompressed) ZIP entries plus the three mandatory
// parts — so the app ships no document library, in keeping with the deploy
// contract's minimal-dependency rule. Pure module: no Express, testable.

import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

export function escXml(s) {
  return String(s ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
}

const FONT = '<w:rFonts w:ascii="IBM Plex Sans" w:hAnsi="IBM Plex Sans"/>';
const REGULAR_FONT = readFileSync(new URL('../assets/fonts/IBMPlexSans-Regular.ttf', import.meta.url));
const SEMIBOLD_FONT = readFileSync(new URL('../assets/fonts/IBMPlexSans-SemiBold.ttf', import.meta.url));
const REGULAR_KEY = '001B70DC-AA60-4AD5-90EC-18A0948E1EAE';
const SEMIBOLD_KEY = 'A7B3C4D5-E6F7-4890-ABCD-1234567890EF';

export function obfuscateFont(font, key) {
  const out = Buffer.from(font);
  const bytes = Buffer.from(key.replace(/-/g, ''), 'hex').reverse();
  for (let i = 0; i < Math.min(32, out.length); i++) out[i] ^= bytes[i % 16];
  return out;
}

function run(text, { bold = false, italic = false, color = null, size = null } = {}) {
  const props = [
    FONT,
    bold ? "<w:b/>" : "",
    italic ? "<w:i/>" : "",
    color ? `<w:color w:val="${color}"/>` : "",
    size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : "",
  ].join("");
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${escXml(text)}</w:t></w:r>`;
}

function para(runs, { spacingAfter = 120 } = {}) {
  return `<w:p><w:pPr><w:spacing w:after="${spacingAfter}"/></w:pPr>${runs}</w:p>`;
}

// A table cell: optional shading, cell width in twips, one paragraph.
function cell(text, { width, fill = null, bold = false, color = null, size = 18, vMerge = null } = {}) {
  const shd = fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : "";
  const merge = vMerge ? `<w:vMerge w:val="${vMerge}"/>` : "";
  return [
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${merge}${shd}<w:vAlign w:val="top"/></w:tcPr>`,
    `<w:p><w:pPr><w:spacing w:after="40"/></w:pPr>${text ? run(text, { bold, color, size }) : ""}</w:p>`,
    "</w:tc>",
  ].join("");
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

// Landscape US Letter: 15840 x 12240 twips, 720-twip (0.5") margins leaves
// 14400 twips of usable width for the table.
const PAGE_W = 15840;
const PAGE_H = 12240;
const MARGIN = 720;
const USABLE = PAGE_W - 2 * MARGIN;

const HEADER_FILL = "C9DAF8"; // light blue from the Decision Table template
// Per-cell rating fills: green = best, yellow = medium, red = worst (ties allowed).
const RATING_FILL = { green: "C6EFCE", yellow: "FFEB9C", red: "FFC7CE" };
const BORDER = '<w:top w:val="single" w:sz="4" w:color="000000"/><w:left w:val="single" w:sz="4" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:color="000000"/><w:right w:val="single" w:sz="4" w:color="000000"/><w:insideH w:val="single" w:sz="4" w:color="000000"/><w:insideV w:val="single" w:sz="4" w:color="000000"/>';

function documentXml(table) {
  const categoryW = 1500;
  const featureW = 2200;
  const optionW = Math.floor((USABLE - categoryW - featureW) / table.columns.length);
  const widths = [categoryW, featureW, ...table.columns.map(() => optionW)];

  const headerRow = [
    "<w:tr><w:trPr><w:tblHeader/></w:trPr>",
    cell("Category", { width: widths[0], fill: HEADER_FILL, bold: true }),
    cell("Feature", { width: widths[1], fill: HEADER_FILL, bold: true }),
    ...table.columns.map((c, i) => cell(`${i + 1}. ${c}`, { width: widths[i + 2], fill: HEADER_FILL, bold: true })),
    "</w:tr>",
  ].join("");

  const bodyRows = table.rows.map((r, rowIndex) => {
    const category = r.category || "Evaluation";
    const feature = r.feature || r.label;
    const previousCategory = table.rows[rowIndex - 1]?.category;
    const nextCategory = table.rows[rowIndex + 1]?.category;
    const continuing = category === previousCategory;
    const merge = continuing ? "continue" : category === nextCategory ? "restart" : null;
    const isDecision = category === "Decision";
    return [
      "<w:tr>",
      cell(continuing ? "" : category, { width: widths[0], bold: true, vMerge: merge }),
      cell(feature, { width: widths[1], bold: true }),
      ...r.cells.map((c, i) => cell(c, {
        width: widths[i + 2],
        fill: RATING_FILL[r.ratings?.[i]] ?? null,
        bold: isDecision && i === r.decision_index,
      })),
      "</w:tr>",
    ].join("");
  }).join("");

  const tbl = [
    "<w:tbl><w:tblPr>",
    `<w:tblW w:w="${USABLE}" w:type="dxa"/>`,
    '<w:tblLayout w:type="fixed"/>',
    `<w:tblBorders>${BORDER}</w:tblBorders>`,
    '<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar>',
    "</w:tblPr>",
    `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>`,
    headerRow,
    bodyRows,
    "</w:tbl>",
  ].join("");

  const legend = [
    "<w:tbl><w:tblPr>",
    `<w:tblW w:w="${USABLE}" w:type="dxa"/><w:tblLayout w:type="fixed"/>`,
    "</w:tblPr><w:tr>",
    cell("Green — strongest / positive", { width: Math.floor(USABLE / 3), fill: RATING_FILL.green, bold: true }),
    cell("Yellow — mixed / moderate", { width: Math.floor(USABLE / 3), fill: RATING_FILL.yellow, bold: true }),
    cell("Red — weakest / negative", { width: Math.floor(USABLE / 3), fill: RATING_FILL.red, bold: true }),
    "</w:tr></w:tbl>",
  ].join("");

  const body = [
    para(run(`Decision Table: ${table.title}`, { bold: true, size: 36 }), { spacingAfter: 80 }),
    para(run("Question: ", { bold: true, size: 22 }) + run(table.decision_question, { size: 22 }), { spacingAfter: 80 }),
    para(run("Legend", { bold: true, size: 20 }), { spacingAfter: 30 }),
    legend,
    table.situation
      ? para(run("Situation: ", { bold: true, size: 18 }) + run(table.situation, { size: 18 }), { spacingAfter: 40 })
      : "",
    table.recommendation_preview
      ? para(run("Recommendation preview: ", { bold: true, size: 18 }) + run(table.recommendation_preview, { size: 18 }), { spacingAfter: 120 })
      : "",
    tbl,
    ...(table.notes?.length
      ? [
        para(run("Notes / open questions", { bold: true, size: 22 }), { spacingAfter: 40 }),
        ...table.notes.map((n) => para(run(`• ${n}`, { size: 20 }), { spacingAfter: 30 })),
      ]
      : []),
    para(run("Generated by the PLN Decision Council. Decision support only — not legal, accounting, or financial advice.", { italic: true, size: 16 }), { spacingAfter: 0 }),
    `<w:sectPr><w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}" w:orient="landscape"/><w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}"/></w:sectPr>`,
  ].join("");

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:body>${body}</w:body></w:document>`;
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>'
  + "</Types>";

const RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + "</Relationships>";

const DOCUMENT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>'
  + "</Relationships>";

const FONT_TABLE = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
  + '<w:font w:name="IBM Plex Sans"><w:family w:val="swiss"/><w:pitch w:val="variable"/>'
  + `<w:embedRegular r:id="rId1" w:fontKey="{${REGULAR_KEY}}" w:subsetted="false"/>`
  + `<w:embedBold r:id="rId2" w:fontKey="{${SEMIBOLD_KEY}}" w:subsetted="false"/>`
  + '</w:font></w:fonts>';

const FONT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/IBMPlexSans-Regular.odttf"/>'
  + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/IBMPlexSans-SemiBold.odttf"/>'
  + "</Relationships>";

// ---------------------------------------------------------------------------
// ZIP (stored entries only — no compression, so no external deps)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// entries: [{name, data: Buffer}] -> a stored-mode ZIP Buffer.
export function zipStore(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date (a valid constant DOS date)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central dir signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += 30 + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end-of-central-directory signature
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// table must already have passed validateDecisionTable (council-core.mjs).
export function decisionTableDocx(table) {
  return zipStore([
    { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(RELS, "utf8") },
    { name: "word/document.xml", data: Buffer.from(documentXml(table), "utf8") },
    { name: "word/_rels/document.xml.rels", data: Buffer.from(DOCUMENT_RELS, "utf8") },
    { name: "word/fontTable.xml", data: Buffer.from(FONT_TABLE, "utf8") },
    { name: "word/_rels/fontTable.xml.rels", data: Buffer.from(FONT_RELS, "utf8") },
    { name: "word/fonts/IBMPlexSans-Regular.odttf", data: obfuscateFont(REGULAR_FONT, REGULAR_KEY) },
    { name: "word/fonts/IBMPlexSans-SemiBold.odttf", data: obfuscateFont(SEMIBOLD_FONT, SEMIBOLD_KEY) },
  ]);
}
