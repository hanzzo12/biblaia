'use strict';
// Shared helpers for data tests. Reads only JSON/text files; imports nothing from src/ code.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/normative-data.json'), 'utf8'));
const golden = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/golden-cases.json'), 'utf8'));
const layoutPages = fs.readFileSync(path.join(ROOT, 'sources/extracted/rotation_sources.layout.txt'), 'utf8').split('\f');

const BAND_KEYS = ['0-18', '19-24', '25-29', '30-34', '35-39', '40-44', '45-49', '50-54', '55-59', '60-64', '65-69', '70+'];
const DECIMAL = /^\d+(\.\d+)?$/;

const goldenCase = (id) => {
  const c = golden.cases.find((x) => x.id === id);
  if (!c) throw new Error(`golden case ${id} missing`);
  return c;
};

/** Exact decimal equality of two decimal strings ("2.000" == "2", "1,588" -> "1.588"). */
function decEq(a, b) {
  const norm = (s) => {
    let [i, f = ''] = String(s).replace(',', '.').split('.');
    i = i.replace(/^0+(?=\d)/, '');
    f = f.replace(/0+$/, '');
    return f ? `${i}.${f}` : i;
  };
  return norm(a) === norm(b);
}

function pageTokens(page) {
  return layoutPages[page - 1]
    .split(/\s+/)
    .map((t) => t.replace(/\]$/, '').replace(/\.$/, ''))
    .filter(Boolean);
}

/** All tokens present on the page, respecting multiplicity. */
function pageHasMultiset(page, tokens) {
  const counts = new Map();
  for (const t of pageTokens(page)) counts.set(t, (counts.get(t) || 0) + 1);
  for (const t of tokens) {
    const n = counts.get(t) || 0;
    if (n === 0) return false;
    counts.set(t, n - 1);
  }
  return true;
}

function pageHasSequence(page, seq) {
  const toks = pageTokens(page);
  outer: for (let i = 0; i + seq.length <= toks.length; i++) {
    for (let j = 0; j < seq.length; j++) if (toks[i + j] !== seq[j]) continue outer;
    return true;
  }
  return false;
}

const byId = (arr) => new Map(arr.map((x) => [x.id, x]));
const missions = byId(data.missions);
const ins = byId(data.insuranceCaps);
const bag = byId(data.baggageCaps);
const kRows = byId(data.costCoefficients);

const insFor = (annex, row) => data.insuranceCaps.filter((x) => x.annex === annex && x.rowNo === row);
const bagFor = (annex, row) => data.baggageCaps.filter((x) => x.annex === annex && x.rowNo === row);
const kFor = (row) => data.costCoefficients.filter((x) => x.annex4Row === row);
const missionFor = (annex, row) => data.missions.filter((x) => x.annex === annex && x.rowNo === row);

module.exports = {
  ROOT, data, golden, goldenCase, layoutPages, BAND_KEYS, DECIMAL, decEq,
  pageTokens, pageHasMultiset, pageHasSequence,
  missions, ins, bag, kRows, insFor, bagFor, kFor, missionFor,
};
