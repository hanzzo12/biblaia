// Normative data vs values the independent verifier read from the PDF (tests/fixtures/golden-cases.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from './_support.js';

const one = (arr, what) => {
  assert.equal(arr.length, 1, `${what}: expected exactly one entry, got ${arr.length}`);
  return arr[0];
};
const bandsArray = (row) => S.BAND_KEYS.map((k) => row.bands[k]);

test('Annex 4 K/E spot checks (T-DATA-KE-01/02)', () => {
  const iran = one(S.kFor(22), 'A4 r22');
  assert.ok(S.decEq(iran.k, '1.89'), `Iran K ${iran.k}`);
  assert.ok(S.decEq(iran.ePercent, '24'));
  for (const r of S.goldenCase('T-DATA-KE-02').expected.rows) {
    const row = one(S.kFor(r.row), `A4 r${r.row}`);
    assert.ok(S.decEq(row.k, r.K), `A4 r${r.row} K: data ${row.k} vs golden ${r.K}`);
    assert.ok(S.decEq(row.ePercent, r.E), `A4 r${r.row} E: data ${row.ePercent} vs golden ${r.E}`);
    assert.equal(row.page, r.page, `A4 r${r.row} page`);
  }
});

test('Washington vs New York K/E; city rows take priority (T-DATA-KE-03)', () => {
  const ke = (annex, row) => S.kRows.get(one(S.missionFor(annex, row), `A${annex} r${row}`).costCoefficientId);
  const was = ke(6, 4), un = ke(6, 5), nyc = ke(6, 28);
  assert.equal(was.annex4Row, 5); assert.ok(S.decEq(was.k, '2.185')); assert.ok(S.decEq(was.ePercent, '28'));
  for (const r of [un, nyc]) { assert.equal(r.annex4Row, 6); assert.ok(S.decEq(r.k, '2.65')); assert.ok(S.decEq(r.ePercent, '32')); }
  assert.equal(ke(5, 39).annex4Row, 65, 'Bari uses its city row 65 (E 21), not Italy row 24');
  assert.equal(ke(5, 44).annex4Row, 68, 'Lyon city row 68');
});

test('insurance rows: all 12 bands equal golden values (T-INS-ROW-*, T-INS-ROW-SPOT)', () => {
  const rows = [];
  for (const id of ['T-INS-ROW-VIE', 'T-INS-ROW-KYV', 'T-INS-ROW-ODS', 'T-INS-ROW-BRN', 'T-INS-ROW-PEK']) {
    const c = S.goldenCase(id);
    rows.push({ annex: c.inputs.annex, row: c.inputs.row, page: c.inputs.page, bands: c.expected.bands });
  }
  rows.push(...S.goldenCase('T-INS-ROW-SPOT').expected.rows);
  for (const r of rows) {
    const row = one(S.insFor(r.annex, r.row), `INS A${r.annex} r${r.row}`);
    assert.deepEqual(Object.keys(row.bands).sort(), [...S.BAND_KEYS].sort(), 'band keys');
    assert.deepEqual(bandsArray(row), r.bands, `A${r.annex} r${r.row} bands`);
    assert.equal(row.currency, r.annex === 7 ? 'EUR' : 'USD');
    assert.equal(row.page, r.page, `A${r.annex} r${r.row} page`);
  }
});

test('Odesa has its own insurance row, different from Kyiv (734 vs 1137 at 40-44)', () => {
  const odesa = one(S.missionFor(6, 29), 'Odesa');
  const kyiv = one(S.missionFor(6, 26), 'Kyiv');
  assert.notEqual(odesa.insuranceCapId, kyiv.insuranceCapId);
  assert.equal(S.ins.get(odesa.insuranceCapId).rowNo, 25);
  assert.equal(S.ins.get(kyiv.insuranceCapId).rowNo, 22);
  assert.equal(S.ins.get(odesa.insuranceCapId).bands['40-44'], '734');
  assert.equal(S.ins.get(kyiv.insuranceCapId).bands['40-44'], '1137');
});

test('baggage spot checks incl. Lyon 1950 (T-DATA-BAG-01)', () => {
  for (const r of S.goldenCase('T-DATA-BAG-01').expected.rows) {
    const row = one(S.bagFor(r.annex, r.row), `BAG A${r.annex} r${r.row}`);
    assert.ok(S.decEq(row.amount, r.cap), `A${r.annex} r${r.row}: data ${row.amount} vs golden ${r.cap}`);
    assert.equal(row.currency, r.currency);
  }
  const lyon = one(S.missionFor(5, 44), 'Lyon');
  assert.equal(S.bag.get(lyon.baggageCapId).amount, '1950');
  assert.equal(S.bag.get(lyon.baggageCapId).rowNo, 43);
});

test('mission -> cap links follow the institution name, not array position', () => {
  // [annex, row, expected insurance annex/row, expected baggage annex/row] read independently from pp.19-34
  const links = [
    [5, 1, 7, 1, 9, 1], [5, 2, 7, 2, 9, 2], [5, 7, 7, 6, 9, 7], [5, 20, 7, 16, 9, 17], [5, 34, 7, 30, 9, 31],
    [5, 41, 7, 41, 9, 40], [5, 44, 7, 44, 9, 43], [5, 37, 7, 28, 9, 29],
    [6, 4, 8, 4, 10, 5], [6, 5, 8, 7, 10, 8], [6, 15, 8, 13, 10, 17], [6, 26, 8, 22, 10, 30],
    [6, 28, 8, 24, 10, 36], [6, 29, 8, 25, 10, 37], [6, 30, 8, 31, 10, 35], [6, 33, 8, 27, 10, 33],
  ];
  for (const [a, r, ia, ir, ba, br] of links) {
    const m = one(S.missionFor(a, r), `A${a} r${r}`);
    const i = S.ins.get(m.insuranceCapId), b = S.bag.get(m.baggageCapId);
    assert.ok(i && b, `${m.id} links resolve`);
    assert.deepEqual([i.annex, i.rowNo], [ia, ir], `${m.id} insurance link`);
    assert.deepEqual([b.annex, b.rowNo], [ba, br], `${m.id} baggage link`);
  }
});

test('separate institutions: Brussels/NATO, NY UN mission/consulate; Stuttgart and CoE present', () => {
  const ids = (a, r) => one(S.missionFor(a, r), `A${a} r${r}`).id;
  assert.notEqual(ids(5, 2), ids(5, 20));
  assert.notEqual(ids(6, 5), ids(6, 28));
  const stuttgart = one(S.missionFor(5, 41), 'Stuttgart');
  assert.match(stuttgart.rawLabel, /შტუტგარტ/);
  assert.equal(stuttgart.fundingCurrency, 'EUR');
  assert.equal(S.kRows.get(stuttgart.costCoefficientId).annex4Row, 11);
  const coe = one(S.missionFor(5, 7), 'Council of Europe');
  assert.match(coe.rawLabel, /ევროპის საბჭოსთან/);
  assert.equal(S.bag.get(coe.baggageCapId).amount, '1950');
  assert.notEqual(coe.id, one(S.missionFor(5, 27), 'Paris').id);
  assert.equal(S.kRows.get(coe.costCoefficientId).annex4Row, 46);
});

test('Vatican K/E is null and documented as a gap (T-DATA-KE-04)', () => {
  const vat = one(S.missionFor(5, 37), 'Holy See');
  assert.equal(vat.costCoefficientId, null);
  assert.ok(S.data.dataGaps.some((g) => (g.affects || []).includes(vat.id)), 'gap documented');
});

test('Serbia, Munich, Montenegro are not institutions (T-DATA-INST-06)', () => {
  for (const m of S.data.missions) {
    assert.notEqual(m.countryId, 'RS', `${m.id} in Serbia`);
    assert.notEqual(m.countryId, 'ME', `${m.id} in Montenegro`);
    assert.doesNotMatch(`${m.rawLabel} ${m.locationId} ${m.name_en}`, /მიუნხენ|MUNICH|Munich|მონტენეგრ|სერბეთ/i, m.id);
  }
  assert.equal(S.kFor(61).length, 1, 'Serbia K row kept');
});

test('Donetsk printed twice yields one entitlement (T-INS-DUP-01)', () => {
  const rows = S.insFor(8, 31);
  assert.equal(rows.length, 1);
  assert.deepEqual(bandsArray(rows[0]), S.goldenCase('T-INS-DUP-01').expected.bands);
  assert.equal(S.data.missions.filter((m) => m.insuranceCapId === rows[0].id).length, 1);
});

test('positions: Annex 2 and Annex 3 separate; admin manager 75% (T-POS-03/05)', () => {
  const prof = Object.fromEntries(S.data.positionProfiles.map((p) => [p.id, p]));
  const pct = (mode, title) => {
    const hits = prof[mode].entries.filter((e) => e.positions_ka.includes(title));
    assert.equal(hits.length, 1, `${mode} ${title}`);
    return hits[0].percent;
  };
  const exp = S.goldenCase('T-POS-03').expected;
  for (const mode of ['annex2', 'annex3']) {
    for (const [title, p] of Object.entries(exp[mode])) assert.ok(S.decEq(pct(mode, title), p), `${mode} ${title}`);
  }
  const r3 = prof.annex2.entries.find((e) => e.id === 'A2-R3');
  assert.ok(S.decEq(r3.percent, '75'));
  assert.ok(r3.positions_ka.some((t) => /ადმინისტრაციული მენეჯერი/.test(t)));
});

test('base amounts and parameters (T-DATA-H-01)', () => {
  const e = S.goldenCase('T-DATA-H-01').expected;
  const h = Object.fromEntries(S.data.baseAmounts.map((b) => [b.id, b.amount]));
  assert.ok(S.decEq(h['H-EUR'], e.H_EUR)); assert.ok(S.decEq(h['H-USD'], e.H_USD));
  const p = Object.fromEntries(S.data.parameters.map((x) => [x.id, x.value]));
  const pairs = [['FAMILY-SUPPLEMENT-PCT', '7'], ['EDU-LIMIT-EUR', e.L_EUR], ['EDU-LIMIT-USD', e.L_USD],
    ['EDU-EXCESS-SHARE-PCT', '80'], ['BROKER-HEAD-PCT', '80'], ['BROKER-OTHER-PCT', '50'],
    ['SETTLEMENT-DSA-MULTIPLIER', e.settlementDays], ['SETTLEMENT-FAMILY-PCT', '10'],
    ['FX-FORECAST-GEL-PER-USD', '2.8'], ['FX-FORECAST-GEL-PER-EUR', '3.2']];
  for (const [id, v] of pairs) assert.ok(S.decEq(p[id], v), `${id}: ${p[id]} vs ${v}`);
});
