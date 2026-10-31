// Settlement (pt 7) with normative daily rates from Decree №211 Annex 1 (dailyRates).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, dailyRateForMission } from '../../src/core/index.js';
import { synthData, synthScenario } from './_core-helpers.mjs';

function withRates(base, rows) {
  const d = structuredClone(base);
  d.locations.push({ id: 'ZZ-OTHER', countryId: 'ZZ', name_ka: 'სხვა', name_en: 'Other', altNames: [], region: null });
  d.missions.push({ ...d.missions[0], id: 'M-T2', rowNo: 2, locationId: 'ZZ-OTHER', insuranceCapId: 'INS-T', baggageCapId: 'BAG-T' });
  d.dailyRates = rows;
  return d;
}
const row = (id, locationId, amount, currency) => ({ id, countryId: 'ZZ', locationId, amount, currency, sourceRef: 'SRC-DECREE211', edition: 'test', row: id });

test('dailyRateForMission: city row first, else country row, else null', () => {
  const d = withRates(synthData({}), [row('DR-1', null, '50', 'EUR'), row('DR-2', 'ZZ-CITY', '70', 'EUR')]);
  assert.equal(dailyRateForMission(d, 'M-T').id, 'DR-2');
  assert.equal(dailyRateForMission(d, 'M-T').basis, 'city');
  assert.equal(dailyRateForMission(d, 'M-T2').id, 'DR-1');
  assert.equal(dailyRateForMission(d, 'M-T2').basis, 'country');
  assert.equal(dailyRateForMission(synthData({}), 'M-T'), null);
  assert.equal(dailyRateForMission(d, 'nope'), null);
});

test('normative rate in the funding currency → calculated and counted in the confirmed total', () => {
  const d = withRates(synthData({}), [row('DR-1', null, '60', 'EUR')]);
  const r = calculate(synthScenario({ C: 2, G: '0', family: [{ id: 'S', role: 'spouse', status: 'regular', age: 40 }, { id: 'K', role: 'child', status: 'regular', age: 5 }] }), d);
  const s = r.oneTimeAllowances.settlement;
  assert.equal(s.value, '4320.00');
  assert.equal(s.status, 'calculated');
  assert.equal(s.currency, 'EUR');
  assert.equal(s.inputsUsed.dailyRateId, 'DR-1');
  assert.ok(r.totals.oneTimeConfirmed.inputsUsed.ids.includes('settlement'));
  assert.equal(r.completeness, 'complete');
});

test('normative rate in another currency → shown in its own currency, never converted or summed', () => {
  const d = withRates(synthData({ currency: 'EUR' }), [row('DR-1', 'ZZ-CITY', '60', 'USD')]);
  const sc = synthScenario({ G: '0', family: [{ id: 'S', role: 'spouse', status: 'regular', age: 40 }] });
  sc.settlement = { dailyRate: null, fx: { rate: '0.9', date: '2027-01-01', source: 'x' }, exclusion9: null, transfer10: false };
  const r = calculate(sc, d);
  const s = r.oneTimeAllowances.settlement;
  assert.equal(s.currency, 'USD');
  assert.equal(s.value, '3960.00', '60 × 60 × 1.1, not converted with the given fx');
  assert.equal(s.status, 'calculated');
  assert.ok(!r.totals.oneTimeConfirmed.inputsUsed.ids.includes('settlement'));
  assert.ok(r.totals.otherCurrencyIds.includes('settlement'));
  assert.ok(r.warnings.some((w) => w.code === 'SETTLE_NORM_CURRENCY'));
});

test('manual daily rate overrides the normative one and stays unconfirmed; pt 9 exclusion still 0', () => {
  const d = withRates(synthData({}), [row('DR-1', null, '60', 'EUR')]);
  const sc = synthScenario({ G: '0' });
  sc.settlement = { dailyRate: { amount: '80', currency: 'EUR', source: 'manual', sourceDate: '2026-10-01' }, fx: null, exclusion9: null, transfer10: false };
  const r = calculate(sc, d);
  assert.equal(r.oneTimeAllowances.settlement.value, '4800.00');
  assert.equal(r.oneTimeAllowances.settlement.status, 'unconfirmed');
  sc.settlement = { dailyRate: null, fx: null, exclusion9: 'a', transfer10: false };
  assert.equal(calculate(sc, d).oneTimeAllowances.settlement.value, '0.00');
});

test('no normative row → undetermined, does not block completeness', () => {
  const r = calculate(synthScenario({ G: '0' }), synthData({}));
  assert.equal(r.oneTimeAllowances.settlement.status, 'undetermined');
  assert.equal(r.completeness, 'complete');
});

// ---- real data: Decree №211 Annex 1 (src/data/normative-data.json)
import { DATA } from './_core-helpers.mjs';
const real = (missionId, family = [], extra = {}) => calculate({ schemaVersion: 1, missionId, position: { mode: 'annex2', entryId: 'A2-R6' }, status: { rentHead: 'not-head' },
  family, rent: { amount: '0' }, ...extra }, DATA);
const two = [{ id: 'S', role: 'spouse', status: 'regular', age: 40 }, { id: 'K', role: 'child', status: 'regular', age: 7 }];

test('Vienna: 60 EUR × 60 × (1 + 10% × 2) = 4320 EUR, calculated, in the confirmed total', () => {
  const r = real('M-A5-R1', two);
  const s = r.oneTimeAllowances.settlement;
  assert.deepEqual([s.value, s.currency, s.status, s.inputsUsed.dailyRateId], ['4320.00', 'EUR', 'calculated', 'DSA-AT']);
  assert.ok(r.totals.oneTimeConfirmed.inputsUsed.ids.includes('settlement'));
});

test('Canberra: rate in AUD (80) is shown in AUD, never converted or added to USD totals', () => {
  const r = real('M-A6-R1', two, { settlement: { dailyRate: null, fx: { rate: '0.65', date: '2027-01-01', source: 'x' }, exclusion9: null, transfer10: false } });
  const s = r.oneTimeAllowances.settlement;
  assert.equal(r.currency, 'USD');
  assert.deepEqual([s.value, s.currency, s.status], ['5760.00', 'AUD', 'calculated']);
  assert.ok(r.totals.otherCurrencyIds.includes('settlement'));
  assert.ok(!r.totals.oneTimeConfirmed.inputsUsed.ids.includes('settlement'));
});

test('Washington 75 USD; Tehran 45 USD; Copenhagen in DKK; Holy See has no row (undetermined, Italy not borrowed)', () => {
  assert.equal(real('M-A6-R4').oneTimeAllowances.settlement.value, '4500.00');
  assert.equal(real('M-A6-R15').oneTimeAllowances.settlement.value, '2700.00');
  const dk = real('M-A5-R5').oneTimeAllowances.settlement;
  assert.deepEqual([dk.value, dk.currency], ['27900.00', 'DKK']);
  const va = real('M-A5-R37').oneTimeAllowances.settlement;
  assert.equal(va.status, 'undetermined');
  assert.equal(dailyRateForMission(DATA, 'M-A5-R37'), null);
  const counts = DATA.missions.filter((m) => dailyRateForMission(DATA, m.id)).length;
  assert.equal(counts, 81);
});
