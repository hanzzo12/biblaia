// Regression tests for the legal review findings (docs/legal-review.md, LR-xx) fixed in src/core.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, validateScenario } from '../../src/core/index.js';
import { synthData, synthScenario } from './_core-helpers.mjs';

const D = synthData({});
const dep = (presence) => ({ id: 'D', role: 'other', status: 'support-recipient', age: 60, presence });

test('LR-06: dependent in full-month mode — [] = not present; partial/unknown month = scenario; full coverage = calculated', () => {
  const none = calculate(synthScenario({ G: '0', family: [dep([])] }), D);
  assert.equal(none.monthly.C.value, '0');
  assert.equal(none.monthly.D.status, 'calculated');
  const partial = calculate(synthScenario({ G: '0', family: [dep([{ from: '2027-03-10', to: '2027-03-20' }])], period: { mode: 'full-month', month: '2027-03' } }), D);
  assert.equal(partial.monthly.C.value, '1');
  assert.equal(partial.monthly.C.status, 'scenario');
  assert.equal(partial.monthly.S.status, 'scenario', 'never full-month calculated');
  const noMonth = calculate(synthScenario({ G: '0', family: [dep([{ from: '2027-01-01', to: '2027-12-31' }])] }), D);
  assert.equal(noMonth.monthly.S.status, 'scenario');
  const full = calculate(synthScenario({ G: '0', family: [dep([{ from: '2027-02-20', to: '2027-04-05' }])], period: { mode: 'full-month', month: '2027-03' } }), D);
  assert.equal(full.monthly.C.status, 'calculated');
  assert.equal(full.monthly.C.value, '1');
  const absent = calculate(synthScenario({ G: '0', family: [dep([{ from: '2027-05-01', to: '2027-05-10' }])], period: { mode: 'full-month', month: '2027-03' } }), D);
  assert.equal(absent.monthly.C.value, '0');
});

test('LR-12: pt 20² applies only to the admin manager (A2-R5) and only within its period', () => {
  const wrong = synthScenario({ G: '0' });
  wrong.status.adminManager202 = { applies: true, actRef: 'ბრძ. 1', from: null, to: null };
  const w = calculate(wrong, D);
  assert.equal(w.monthly.A.value, '65', 'no 75% for a non-admin-manager position');
  assert.ok(w.errors.some((e) => e.code === 'POS_202_ENTRY'));
  assert.ok(validateScenario(wrong, D).errors.some((e) => e.code === 'POS_202_ENTRY'));
  const sc = synthScenario({ G: '0', entryId: 'A2-R5', period: { mode: 'dates', start: '2027-03-01', end: '2027-03-31' } });
  sc.status.adminManager202 = { applies: true, actRef: 'ბრძ. 1', from: '2027-03-16', to: null };
  const r = calculate(sc, D);
  assert.deepEqual(r.periodSegments.map((s) => [s.from, s.A]), [['2027-03-01', '65'], ['2027-03-16', '75']]);
  // full month: covered → calculated; not known → scenario; outside → base
  const fm = (month, from, to) => {
    const x = synthScenario({ G: '0', entryId: 'A2-R5', period: { mode: 'full-month', month } });
    x.status.adminManager202 = { applies: true, actRef: 'ბრძ. 1', from, to };
    return calculate(x, D).monthly.A;
  };
  assert.deepEqual([fm('2027-03', '2027-01-01', '2027-06-30').value, fm('2027-03', '2027-01-01', '2027-06-30').status], ['75', 'calculated']);
  assert.deepEqual([fm('2027-03', '2027-03-10', '2027-06-30').value, fm('2027-03', '2027-03-10', '2027-06-30').status], ['75', 'scenario']);
  assert.deepEqual([fm('2027-08', '2027-01-01', '2027-06-30').value, fm('2027-08', '2027-01-01', '2027-06-30').status], ['65', 'calculated']);
  const sc1 = synthScenario({ G: '3000', head: true, period: { mode: 'dates', start: '2027-03-01', end: '2027-03-31' } });
  sc1.status.actingHead201 = { applies: true, actRef: '№01-9', from: '2027-03-01', to: '2027-03-10' };
  assert.deepEqual(calculate(sc1, D).periodSegments.map((s) => s.A), ['100', '65']);
});

test('LR-16: pt 36 excludes only a paid school in the same (state) language', () => {
  const kid = [{ id: 'K', role: 'child', status: 'regular', age: 9 }];
  const run = (same) => calculate(synthScenario({ G: '0', family: kid, education: [{ memberId: 'K', tuition: '1000', freeStateLanguageSchoolAvailable: true, paidSchoolLanguageSameAsState: same }] }), D).education.perChild[0].reimbursement;
  assert.equal(run(true).value, '0.00');
  assert.equal(run(false).value, '938.00');
  assert.equal(run(null).status, 'undetermined');
});

test('LR-17: adult child needs host-state consent and ≤ 1 year after majority', () => {
  const run = (m) => calculate(synthScenario({ G: '0', family: [{ id: 'A', role: 'child', status: 'regular', adultChildInSchool: true, ...m }], education: [{ memberId: 'A', tuition: '500' }] }), D);
  assert.equal(run({ age: 18, hostStateConsent: true }).family[0].eligibility.education.value, true);
  assert.equal(run({ age: 25, hostStateConsent: true }).family[0].eligibility.education.value, false);
  assert.equal(run({ age: 19, hostStateConsent: true }).family[0].eligibility.education.value, false);
  assert.equal(run({ age: 18, hostStateConsent: false }).family[0].eligibility.education.value, false);
  const unk = run({ age: 18, hostStateConsent: null });
  assert.equal(unk.family[0].eligibility.education.value, null);
  assert.equal(unk.education.perChild[0].reimbursement.status, 'undetermined');
});

test('LR-25/26: vacation cap applies to the total per person/year; repeats and pt 16 handled', () => {
  const r = calculate(synthScenario({ G: '0', family: [{ id: 'F1', role: 'spouse', status: 'regular', age: 40 }], travel: [
    { kind: 'vacation', personId: 'EMP', actualCost: '500', comparableTicket: '800', date: '2027-07-01' },
    { kind: 'vacation', personId: 'EMP', actualCost: '500', comparableTicket: '800', date: '2027-07-10' },
    { kind: 'vacation', personId: 'F1', actualCost: '300', comparableTicket: '800', date: '2027-07-01', interruptedLeave: true },
  ] }), D);
  const t = r.oneTimeReimbursements.travel;
  assert.deepEqual(t.map((c) => c.value), ['500.00', '300.00', '0.00'], 'Σ for EMP capped at 800');
  assert.equal(t[0].status, 'scenario');
  assert.ok(r.warnings.some((w) => w.code === 'VAC_MULTIPLE'));
  assert.ok(t[2].ruleIds.includes('R-VAC-OTHER'));
});

test('LR-24: travel recall by minister act (pt 5¹) is unconfirmed', () => {
  const r = calculate(synthScenario({ G: '0', travel: [{ kind: 'recall-5-1', personId: 'EMP', actualCost: '400' }] }), D);
  assert.equal(r.oneTimeReimbursements.travel[0].status, 'unconfirmed');
  assert.ok(r.oneTimeReimbursements.travel[0].ruleIds.includes('R-TRAVEL-CALLBACK'));
  assert.equal(validateScenario(synthScenario({ travel: [{ kind: 'recall-5-1', personId: 'EMP', actualCost: '400' }] }), D).ok, true);
});

test('LR-32: second rent advance before the first is repaid → error + unconfirmed', () => {
  const r = calculate(synthScenario({ G: '1500', advances: [
    { kind: 'rent', amount: '6000', issueDate: '2027-01-10', months: 6 },
    { kind: 'rent', amount: '3000', issueDate: '2027-04-01', months: 3 },
    { kind: 'rent', amount: '3000', issueDate: '2027-08-01', months: 3 },
  ] }), D);
  assert.ok(r.errors.some((e) => e.code === 'ADV_SECOND_BEFORE_REPAYMENT' && e.path === 'advances[1].issueDate'));
  assert.equal(r.advances[1].status, 'unconfirmed');
  assert.equal(r.advances[2].status, 'calculated');
});

test('LR-35: pt 19 retention ≤ 1 month by minister decision, unconfirmed', () => {
  const r = calculate(synthScenario({ C: 2, G: '1500', retention19: { applies: true, from: '2027-03-01', to: '2027-04-15', decisionRef: null } }), D);
  const c = r.oneTimeAllowances.retention19;
  assert.equal(c.status, 'unconfirmed');
  assert.equal(c.value, r.monthly.S.value, 'capped to one month (01.03–31.03)');
  assert.ok(r.warnings.some((w) => w.code === 'RETAIN_LIMIT'));
  assert.equal(r.completeness, 'partial');
});

test('LR-18: period outside the entered school year → warning', () => {
  const r = calculate(synthScenario({ G: '0', family: [{ id: 'K', role: 'child', status: 'regular', age: 9 }], period: { mode: 'dates', start: '2027-07-01', end: '2027-07-31' },
    education: [{ memberId: 'K', tuition: '500', schoolYear: { from: '2026-09-15', to: '2027-06-15' } }] }), D);
  assert.ok(r.warnings.some((w) => w.code === 'EDU_SCHOOL_YEAR'));
});

test('LR-07/08/30: settlement n assumption, pt 9e check, currency required', () => {
  const fam = [{ id: 'S', role: 'spouse', status: 'regular', age: 40, worksInSameMissionOrCity: true }, { id: 'K', role: 'child', status: 'regular', age: 4, to: '2026-12-31' }];
  const r = calculate(synthScenario({ G: '0', family: fam, settlement: { dailyRate: { amount: '60', currency: 'EUR', source: 't', sourceDate: '2026-01-01' }, fx: null, exclusion9: null, transfer10: false, postingDate: '2027-01-15' } }), D);
  assert.equal(r.oneTimeAllowances.settlement.inputsUsed.n, 1, 'member who left before posting is not counted');
  assert.ok(r.assumptions.some((a) => a.code === 'SETTLE_N' && a.openQuestion === 'OQ-17'));
  assert.ok(r.warnings.some((w) => w.code === 'SETTLE_CHECK_9E'));
  const noCur = calculate(synthScenario({ G: '0', settlement: { dailyRate: { amount: '60', currency: null }, fx: null, exclusion9: null, transfer10: false } }), D);
  assert.equal(noCur.oneTimeAllowances.settlement.status, 'undetermined');
  assert.ok(noCur.missingInputs.some((m) => m.path === 'settlement.dailyRate.currency'));
});

test('LR-10/11/14/20/22/34/03: labelling fixes', () => {
  const a3 = calculate(synthScenario({ G: '0', mode: 'annex3' }), D);
  assert.equal(a3.monthly.A.status, 'scenario', 'annex 3 without order reference (pt 37)');
  assert.equal(calculate(synthScenario({ G: '0', mode: 'annex3', position: { mode: 'annex3', entryId: 'A3-RX', orderRef37: '№01-5' } }), D).monthly.A.status, 'calculated');
  assert.ok(a3.monthly.A.ruleIds.includes('R-POS-20'));
  const head = calculate(synthScenario({ G: '5000', head: true }), D);
  assert.equal(head.monthly.F.status, 'scenario');
  const ins = calculate(synthScenario({ G: '0', family: [dep([{ from: '2027-01-01', to: '2027-03-31' }])], insurance: [{ personId: 'D', policyCost: '500', alreadyReimbursed: '0', policyStart: '2027-01-01', policyEnd: '2027-12-31' }] }), D);
  assert.equal(ins.insurance.perPerson[1].reimbursable.status, 'scenario');
  const insOk = calculate(synthScenario({ G: '0', family: [dep([{ from: '2027-01-01', to: '2027-12-31' }])], insurance: [{ personId: 'D', policyCost: '500', alreadyReimbursed: '0', policyStart: '2027-01-01', policyEnd: '2027-12-31' }] }), D);
  assert.equal(insOk.insurance.perPerson[1].reimbursable.status, 'calculated');
  const bag = calculate(synthScenario({ G: '0', baggage: { kind: 'departure', claims: [{ who: 'EMP', amount: '600' }] } }), D);
  assert.equal(bag.oneTimeReimbursements.baggage.reimbursable.status, 'undetermined');
  assert.ok(bag.missingInputs.some((m) => m.path === 'baggage.previouslyUsed'));
  const ex = calculate(synthScenario({ G: '0', extras: [{ category: 'covid-aid-6-2', amount: '1000', justification: 'x' }, { category: 'head-residence-29', amount: '2000', justification: 'x' }] }), D);
  assert.equal(ex.oneTimeReimbursements.extras[0].category, 'one-time-allowance');
  assert.deepEqual(ex.oneTimeReimbursements.extras.map((c) => c.status), ['unconfirmed', 'unconfirmed']);
  assert.ok(ex.assumptions.some((x) => x.openQuestion === 'OQ-24'));
  assert.equal(calculate(synthScenario({ G: '0' }), D).monthly.Q.value, '7');
});
