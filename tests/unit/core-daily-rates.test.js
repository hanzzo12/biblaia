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
