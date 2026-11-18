// Order №01-407 (2026-11-17, in force 2027-01-01): new H, Annexes 2–4, pts 26¹/26².
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, baseAmountInfo } from '../../src/core/index.js';
import { DATA, synthScenario, synthData } from './_core-helpers.mjs';

test('baseAmountInfo: 5000 EUR / 5600 USD from 2027-01-01 with the previous values', () => {
  const e = baseAmountInfo(DATA, 'EUR'), u = baseAmountInfo(DATA, 'USD');
  assert.deepEqual([e.amount, e.effectiveFrom, e.previous.amount, e.previous.until], ['5000', '2027-01-01', '3100', '2026-12-31']);
  assert.deepEqual([u.amount, u.effectiveFrom, u.previous.amount], ['5600', '2027-01-01', '3495']);
  assert.equal(baseAmountInfo(DATA, 'GBP'), null);
});

test('calculate uses the new H and new Annex 4 (Vienna: 5000 × 65% × 1.543 × 1.14), with an effective-date note', () => {
  const r = calculate({ schemaVersion: 1, missionId: 'M-A5-R1', position: { mode: 'annex2', entryId: 'A2-R5' }, status: { rentHead: 'not-head' },
    family: [{ id: 'S', role: 'spouse', status: 'regular', age: 40 }, { id: 'K', role: 'child', status: 'regular', age: 7 }], rent: { amount: '1500' } }, DATA);
  assert.equal(r.monthly.H.value, '5000.00');
  assert.equal(r.monthly.K.value, '1.543');
  assert.equal(r.monthly.E.value, '20');
  assert.equal(r.monthly.D.exact, '5716.815');
  assert.equal(r.monthly.H.inputsUsed.effectiveFrom, '2027-01-01');
  assert.ok(r.warnings.some((w) => w.code === 'H_EFFECTIVE_FROM' && w.severity === 'info'));
  const before = calculate({ schemaVersion: 1, missionId: 'M-A5-R1', position: { mode: 'annex2', entryId: 'A2-R5' }, status: { rentHead: 'not-head' },
    rent: { amount: '0' }, period: { mode: 'dates', start: '2026-12-01', end: '2026-12-31' } }, DATA);
  assert.ok(before.warnings.some((w) => w.code === 'H_EFFECTIVE_FROM' && w.severity === 'warning'), 'period before 2027-01-01 is flagged');
  assert.ok(!r.warnings.some((w) => w.code === 'ANNEX_2_3_4_REPLACED'), 'new annexes are supplied: no gap warning');
});

test('pt 26¹: repeat rent advance before repayment allowed only with the coefficient-reduction flag (unconfirmed)', () => {
  const adv = (flag) => calculate(synthScenario({ G: '1500', advances: [
    { kind: 'rent', amount: '6000', issueDate: '2027-01-10', months: 6 },
    { kind: 'rent', amount: '3000', issueDate: '2027-03-01', months: 3, coefficientReduction261: flag },
  ] }), synthData({}));
  const no = adv(false), yes = adv(true);
  assert.ok(no.errors.some((e) => e.code === 'ADV_SECOND_BEFORE_REPAYMENT'));
  assert.ok(!yes.errors.some((e) => e.code === 'ADV_SECOND_BEFORE_REPAYMENT'));
  assert.ok(yes.warnings.some((w) => w.code === 'ADV_REPEAT_26_1'));
  assert.equal(yes.advances[1].status, 'unconfirmed');
});
