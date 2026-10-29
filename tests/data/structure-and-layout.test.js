// Structural invariants of the normative data and a full cross-check against the PDF text layer.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from './_support.js';
const { data } = S;

test('counts: 82 institutions (44 EUR + 38 USD), 69 K/E rows, 82 insurance and 82 baggage entries', () => {
  const e = S.goldenCase('T-DATA-INST-05').expected;
  assert.equal(data.missions.length, e.institutionsTotal);
  assert.equal(data.missions.filter((m) => m.annex === 5).length, e.annex5Active);
  assert.equal(data.missions.filter((m) => m.annex === 6).length, e.annex6);
  assert.equal(data.costCoefficients.length, e.annex4Rows);
  assert.equal(data.insuranceCaps.filter((x) => x.annex === 7).length, e.annex7Active);
  assert.equal(data.insuranceCaps.filter((x) => x.annex === 8).length, e.annex8Distinct);
  assert.equal(data.baggageCaps.filter((x) => x.annex === 9).length, e.annex9);
  assert.equal(data.baggageCaps.filter((x) => x.annex === 10).length, e.annex10);
});

test('removed row 40 (Annex 5/7) is not selectable', () => {
  assert.equal(S.missionFor(5, 40).length, 0);
  assert.equal(S.insFor(7, 40).length, 0);
});

test('no duplicate IDs across all collections', () => {
  const seen = new Map();
  for (const key of ['missions', 'costCoefficients', 'insuranceCaps', 'baggageCaps', 'locations', 'countries', 'parameters', 'baseAmounts', 'sourceReferences', 'dataGaps']) {
    for (const x of data[key] || []) {
      assert.ok(x.id, `${key} entry without id`);
      assert.ok(!seen.has(x.id), `duplicate id ${x.id} (${key} and ${seen.get(x.id)})`);
      seen.set(x.id, key);
    }
  }
  for (const p of data.positionProfiles) for (const e of p.entries) {
    assert.ok(!seen.has(e.id), `duplicate id ${e.id}`); seen.set(e.id, 'position');
  }
});

test('every normative number is a positive decimal string; missing values are null, never 0', () => {
  const NUM_KEYS = new Set(['k', 'ePercent', 'amount', 'value', 'percent']);
  const bad = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        const p = `${path}.${k}`;
        const isNum = NUM_KEYS.has(k) || path.endsWith('.bands');
        if (isNum && v !== null) {
          if (typeof v !== 'string' || !S.DECIMAL.test(v) || /^0+(\.0+)?$/.test(v)) bad.push(`${p}=${JSON.stringify(v)}`);
        } else if (typeof v === 'object') walk(v, p);
      }
    }
  };
  walk(data, '$');
  assert.deepEqual(bad, []);
});

test('every mission: currency matches annex, caps resolve with same currency, gaps documented', () => {
  const gapIds = new Set(data.dataGaps.flatMap((g) => g.affects || []));
  for (const m of data.missions) {
    const cur = m.annex === 5 ? 'EUR' : m.annex === 6 ? 'USD' : null;
    assert.equal(m.fundingCurrency, cur, `${m.id} funding currency`);
    for (const [field, map, annexes] of [['insuranceCapId', S.ins, [7, 8]], ['baggageCapId', S.bag, [9, 10]]]) {
      const cap = map.get(m[field]);
      if (!cap) { assert.ok(gapIds.has(m.id), `${m.id} has no ${field} and no documented gap`); continue; }
      assert.equal(cap.currency, cur, `${m.id} ${field} currency`);
      assert.equal(cap.annex, annexes[m.annex === 5 ? 0 : 1], `${m.id} ${field} annex`);
    }
    if (m.costCoefficientId === null) assert.ok(gapIds.has(m.id), `${m.id} K null without documented gap`);
    else assert.ok(S.kRows.get(m.costCoefficientId), `${m.id} K link resolves`);
  }
  // each cap row belongs to exactly one institution
  for (const [field, list] of [['insuranceCapId', data.insuranceCaps], ['baggageCapId', data.baggageCaps]]) {
    for (const cap of list) {
      const n = data.missions.filter((m) => m[field] === cap.id).length;
      assert.equal(n, 1, `${cap.id} used by ${n} missions`);
    }
  }
});

test('all insurance rows have exactly the 12 bands', () => {
  for (const r of data.insuranceCaps) assert.deepEqual(Object.keys(r.bands), S.BAND_KEYS, r.id);
});

test('PDF text layer: every insurance row\'s 12 values occur on its page', () => {
  for (const r of data.insuranceCaps) {
    assert.ok(S.pageHasMultiset(r.page, S.BAND_KEYS.map((k) => r.bands[k])), `${r.id} values not on p.${r.page}`);
  }
});

test('PDF text layer: every K/E row\'s values occur on its page (raw comma form accepted)', () => {
  for (const r of data.costCoefficients) {
    const toks = S.pageTokens(r.page);
    const kOk = toks.some((t) => S.decEq(t, r.k) && /^\d+[.,]\d+$/.test(t)) || toks.includes(r.k);
    assert.ok(kOk, `${r.id} K ${r.k} not on p.${r.page}`);
    assert.ok(toks.includes(r.ePercent), `${r.id} E ${r.ePercent} not on p.${r.page}`);
    assert.ok(toks.includes(String(r.annex4Row)), `${r.id} row number not on p.${r.page}`);
  }
});

test('PDF text layer: every baggage amount occurs on its page', () => {
  for (const r of data.baggageCaps) {
    assert.ok(S.pageTokens(r.page).includes(r.amount), `${r.id} ${r.amount} not on p.${r.page}`);
  }
});

test('PDF text layer: golden insurance rows occur as consecutive sequences', () => {
  for (const r of S.goldenCase('T-INS-ROW-SPOT').expected.rows) {
    assert.ok(S.pageHasSequence(r.page, r.bands), `A${r.annex} r${r.row} sequence on p.${r.page}`);
  }
});
