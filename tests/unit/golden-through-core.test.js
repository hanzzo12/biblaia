// Independent golden cases (tests/fixtures/golden-cases.json, derived from the PDF by the verifier)
// run through the REAL core with the REAL normative data, selected by mission ID.
// Expected values come only from the fixture, never from the core's own output.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculate, emptyScenario, emptyFamilyMember, insuranceBand } from '../../src/core/index.js';

const ROOT = new URL('../../', import.meta.url);
const DATA = JSON.parse(fs.readFileSync(new URL('src/data/normative-data.json', ROOT), 'utf8'));
const GOLDEN = JSON.parse(fs.readFileSync(new URL('tests/fixtures/golden-cases.json', ROOT), 'utf8'));
const G = (id) => {
  const c = GOLDEN.cases.find((x) => x.id === id);
  if (!c) throw new Error(`golden ${id} missing`);
  return c;
};

// ---- exact rational comparison independent of src/core/rational.js
function frac(s) {
  s = String(s);
  if (s.includes('/')) {
    const [a, b] = s.split('/').map(frac);
    return [a[0] * b[1], a[1] * b[0]];
  }
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace('-', '').split('.');
  const num = BigInt(i + f) * (neg ? -1n : 1n);
  return [num, 10n ** BigInt(f.length)];
}
const same = (a, b) => { const x = frac(a), y = frac(b); return x[0] * y[1] === y[0] * x[1]; };

/** compare a core Component with a golden {exact, display} (or plain decimal string) */
function expectComp(comp, exp, label) {
  assert.ok(comp, `${label}: component missing`);
  if (exp === 'undetermined') {
    assert.equal(comp.exact, null, `${label}: expected undetermined, got ${comp.exact}`);
    assert.equal(comp.status, 'undetermined', `${label} status`);
    return;
  }
  const e = typeof exp === 'object' ? exp : { exact: exp };
  assert.notEqual(comp.exact, null, `${label}: core gave null (${comp.status}: ${comp.reason_ka})`);
  assert.ok(same(comp.exact, e.exact), `${label}: core exact ${comp.exact} != golden ${e.exact}`);
  if (e.display) assert.equal(comp.value, e.display, `${label}: display`);
}

// ---- scenario builders
const VIENNA = 'M-A5-R1', KYIV = 'M-A6-R26', WASHINGTON = 'M-A6-R4', LYON = 'M-A5-R44', ODESA = 'M-A6-R29';
function scen({ mission = VIENNA, entry = 'A2-R5', mode = 'annex2', head = false, rent = null, family = [] } = {}) {
  const s = emptyScenario();
  s.missionId = mission;
  s.position = { mode, entryId: entry };
  s.status.rentHead = head ? 'head' : 'not-head';
  if (head) s.status.headBasis = 'institution-head';
  s.rent.amount = rent;
  s.family = family;
  return s;
}
const member = (id, over = {}) => ({ ...emptyFamilyMember(id), role: 'child', age: 10, ...over });
const kids = (n) => Array.from({ length: n }, (_, i) => member(`F${i + 1}`, { role: i === 0 ? 'spouse' : 'child', age: i === 0 ? 40 : 8 }));
const run = (s, data = DATA) => calculate(s, data);

/** clone of the real data with Austria K=1, E=20 and H-EUR=1000: with A2-R1 (100%) and C=0 -> D=1000, T=200 */
function isolationData() {
  const d = structuredClone(DATA);
  const m = d.missions.find((x) => x.id === VIENNA);
  const k = d.costCoefficients.find((x) => x.id === m.costCoefficientId);
  k.k = '1'; k.ePercent = '20';
  d.baseAmounts.find((x) => x.id === 'H-EUR').amount = '1000';
  return d;
}
const ISO = isolationData();

// ---------------------------------------------------------------- rent function (T-RENT-*)
test('T-RENT-01..17 rent subsidy boundaries (D=1000, T=200 isolation)', () => {
  const rentCases = GOLDEN.cases.filter((c) => c.kind === 'rent');
  assert.equal(rentCases.length, 18);
  for (const c of rentCases) {
    const r = run(scen({ entry: 'A2-R1', head: c.inputs.isHead, rent: c.inputs.G }), ISO);
    expectComp(r.monthly.D, '1000', `${c.id} D`);
    for (const [k, e] of Object.entries(c.expected)) {
      const comp = { T: r.monthly.T, F: r.monthly.F, S: r.monthly.S, uncoveredHousing: r.monthly.uncoveredRent, subsidyAboveRent: r.monthly.rentSurplus }[k];
      expectComp(comp, e, `${c.id} ${k}`);
    }
    if (c.mustNotEqual) assert.ok(!same(r.monthly.F.exact, c.mustNotEqual.F), `${c.id} anti-pattern`);
  }
});

// ---------------------------------------------------------------- full month
test('T-MON-VIE-01/02 Vienna full month + education + remainder', () => {
  const c1 = G('T-MON-VIE-01'), c2 = G('T-MON-VIE-02');
  const s = scen({ rent: '1500', family: [member('F1', { role: 'spouse', age: 40 }), member('F2', { age: 8 })] });
  s.education = [{ memberId: 'F2', tuition: '1000' }];
  const r = run(s);
  assert.equal(r.currency, 'EUR');
  for (const k of ['D', 'T', 'F', 'S']) expectComp(r.monthly[k], c1.expected[k], `VIE ${k}`);
  expectComp(r.monthly.uncoveredRent, c1.expected.uncoveredHousing, 'VIE uncovered');
  expectComp(r.education.total, c2.expected.educationReimbursement, 'VIE edu');
  expectComp(r.remainder.value, c2.expected.remainderAfterRentAndEducation, 'VIE remainder');
  assert.equal(r.completeness, 'complete');
});

test('T-MON-VIE-03 unknown rent: D,T computed, F/S undetermined', () => {
  const e = G('T-MON-VIE-03').expected;
  const r = run(scen({ rent: null, family: kids(2) }));
  expectComp(r.monthly.D, e.D, 'D'); expectComp(r.monthly.T, e.T, 'T');
  expectComp(r.monthly.F, 'undetermined', 'F'); expectComp(r.monthly.S, 'undetermined', 'S');
  expectComp(r.monthly.DminusT, e.DminusT, 'D-T');
  assert.notEqual(r.completeness, 'complete');
  assert.ok(r.missingInputs.some((m) => m.path === 'rent.amount'));
});

test('T-MON-KYV-01 Kyiv USD; T-MON-WAS-01/02 Washington head', () => {
  let e = G('T-MON-KYV-01').expected;
  let r = run(scen({ mission: KYIV, entry: 'A2-R6', rent: '2500', family: [member('F1', { role: 'spouse', age: 40 })] }));
  assert.equal(r.currency, 'USD');
  for (const k of ['D', 'T', 'F', 'S']) expectComp(r.monthly[k], e[k], `KYV ${k}`);
  for (const [id, G_] of [['T-MON-WAS-01', '9000'], ['T-MON-WAS-02', '10000']]) {
    e = G(id).expected;
    r = run(scen({ mission: WASHINGTON, entry: 'A2-R1', head: true, rent: G_, family: kids(3) }));
    for (const k of Object.keys(e)) expectComp(r.monthly[k], e[k], `${id} ${k}`);
  }
});

// ---------------------------------------------------------------- positions
test('T-POS-01/02 Annex 2 vs Annex 3 second secretary (60% vs 55%)', () => {
  const e1 = G('T-POS-01').expected, e2 = G('T-POS-02').expected;
  const r1 = run(scen({ entry: 'A2-R6', rent: '0' }));
  const r2 = run(scen({ mode: 'annex3', entry: 'A3-R6', rent: '0' }));
  expectComp(r1.monthly.A, '60', 'A2 A'); expectComp(r2.monthly.A, '55', 'A3 A');
  for (const k of ['D', 'T', 'S']) { expectComp(r1.monthly[k], e1[k], `POS-01 ${k}`); expectComp(r2.monthly[k], e2[k], `POS-02 ${k}`); }
});

test('T-POS-04/05 admin manager 65% vs 75% under pt 20^2', () => {
  const r4 = run(scen({ entry: 'A2-R5', rent: '0' }));
  for (const k of ['D', 'T', 'S']) expectComp(r4.monthly[k], G('T-POS-04').expected[k], `POS-04 ${k}`);
  const s = scen({ entry: 'A2-R5', rent: '0' });
  s.status.adminManager202 = { applies: true, actRef: 'test act' };
  const r5 = run(s);
  expectComp(r5.monthly.A, '75', 'POS-05 A');
  for (const k of ['D', 'T', 'S']) expectComp(r5.monthly[k], G('T-POS-05').expected[k], `POS-05 ${k}`);
});

test('T-POS-06/07 envoy acting head: no change without 20^1 act; head indicators with it', () => {
  const r6 = run(scen({ entry: 'A2-R3', rent: '3000' }));
  for (const k of ['D', 'T', 'F', 'S']) expectComp(r6.monthly[k], G('T-POS-06').expected[k], `POS-06 ${k}`);
  const s = scen({ entry: 'A2-R3', head: true, rent: '3000' });
  s.status.headBasis = 'acting-head-20-1';
  s.status.actingHead201 = { applies: true, actRef: 'test act' };
  const r7 = run(s);
  for (const k of ['D', 'T', 'F', 'S']) expectComp(r7.monthly[k], G('T-POS-07').expected[k], `POS-07 ${k}`);
});

test('T-FAM-01 two spouses in the same mission', () => {
  const e = G('T-FAM-01').expected;
  const hi = run(scen({ entry: 'A2-R5', rent: '1500', family: [member('F1', { role: 'spouse', age: 40, worksInSameMissionOrCity: true }), member('F2'), member('F3')] }));
  const lo = run(scen({ entry: 'A2-R6', rent: '0', family: [member('F1', { role: 'spouse', age: 40, worksInSameMissionOrCity: true }),
    member('F2', { supplementPaidToOtherEmployee: true }), member('F3', { supplementPaidToOtherEmployee: true })] }));
  expectComp(hi.monthly.C, '2', 'higher C'); expectComp(lo.monthly.C, '0', 'lower C');
  for (const k of ['D', 'S']) { expectComp(hi.monthly[k], e.higher[k], `higher ${k}`); expectComp(lo.monthly[k], e.lower[k], `lower ${k}`); }
});

// ---------------------------------------------------------------- education
test('T-EDU-01..06 single child, EUR and USD', () => {
  for (const id of ['T-EDU-01', 'T-EDU-02', 'T-EDU-03', 'T-EDU-04', 'T-EDU-05', 'T-EDU-06']) {
    const c = G(id);
    const s = scen({ mission: c.inputs.currency === 'EUR' ? VIENNA : KYIV, entry: 'A2-R6', rent: '0', family: [member('F1', { age: 9 })] });
    s.education = [{ memberId: 'F1', tuition: c.inputs.P }];
    const r = run(s);
    expectComp(r.education.perChild[0].reimbursement, c.expected.reimbursement, `${id} reimbursement`);
    expectComp(r.education.perChild[0].personalCost, c.expected.personalCost, `${id} personal`);
  }
});

test('T-EDU-07/08 two children: per-child limit, pooled alternative shown', () => {
  for (const id of ['T-EDU-07', 'T-EDU-08']) {
    const c = G(id);
    const s = scen({ mission: c.inputs.currency === 'EUR' ? VIENNA : KYIV, entry: 'A2-R6', rent: '0', family: [member('F1'), member('F2')] });
    s.education = c.inputs.children.map((ch, i) => ({ memberId: `F${i + 1}`, tuition: ch.P }));
    const r = run(s);
    c.expected.perChild.forEach((e, i) => expectComp(r.education.perChild[i].reimbursement, e, `${id} child ${i}`));
    expectComp(r.education.total, c.expected.total, `${id} total`);
    expectComp(r.education.personal, c.expected.personalCost, `${id} personal`);
    expectComp(r.education.alternativePooled, c.alternativeIfPooled.total, `${id} pooled alternative`);
  }
});

test('T-EDU-09/11 holiday extra contract (pt 35) and free state-language school (pt 36) -> 0', () => {
  const s9 = scen({ entry: 'A2-R6', rent: '0', family: [member('F1')] });
  s9.education = [{ memberId: 'F1', tuition: null, holidayExtraContract: '800' }];
  const r9 = run(s9);
  expectComp(r9.education.perChild[0].reimbursement, '0', 'EDU-09 reimbursement');
  const s11 = scen({ entry: 'A2-R6', rent: '0', family: [member('F1')] });
  // golden case: paid school in the SAME (state) language while a free one exists
  s11.education = [{ memberId: 'F1', tuition: '500', freeStateLanguageSchoolAvailable: true, paidSchoolLanguageSameAsState: true }];
  expectComp(run(s11).education.perChild[0].reimbursement, '0', 'EDU-11 reimbursement');
  // language not stated -> must not silently reimburse or silently refuse
  s11.education = [{ memberId: 'F1', tuition: '500', freeStateLanguageSchoolAvailable: true }];
  expectComp(run(s11).education.perChild[0].reimbursement, 'undetermined', 'EDU-11 language unknown');
});

test('T-EDU-12 adult child: eligible only while in school (note to the order)', () => {
  const mk = (over) => { const s = scen({ entry: 'A2-R6', rent: '0', family: [member('F1', over)] }); s.education = [{ memberId: 'F1', tuition: '500' }]; return run(s).education.perChild[0]; };
  assert.equal(mk({ age: 18, adultChildInSchool: true, hostStateConsent: true }).eligible, true, 'age 18 in school, consent');
  assert.notEqual(mk({ age: 18, adultChildInSchool: true, hostStateConsent: false }).eligible, true, 'no host consent');
  assert.notEqual(mk({ age: 18, adultChildInSchool: true }).eligible, true, 'consent unknown -> not silently eligible');
  assert.notEqual(mk({ age: 18, adultChildInSchool: false }).eligible, true, 'age 18 not in school');
  assert.notEqual(mk({ age: 21, adultChildInSchool: true }).eligible, true, 'age 21 (> 1 year after majority)');
});

// ---------------------------------------------------------------- broker
test('T-BRK-01..07 broker fee', () => {
  for (const id of ['T-BRK-01', 'T-BRK-02', 'T-BRK-03', 'T-BRK-04', 'T-BRK-05', 'T-BRK-06']) {
    const c = G(id), i = c.inputs;
    const s = scen({ head: i.isHead, entry: i.isHead ? 'A2-R1' : 'A2-R5', rent: i.rent });
    s.broker = { fee: i.fee, serviceDate: i.serviceDate, rotationStartDate: i.postingDate, alreadyReimbursed: i.alreadyReimbursed, documented: true, specialDecision81: false };
    expectComp(run(s).oneTimeReimbursements.broker, c.expected.reimbursement, `${id}`);
  }
  const c = G('T-BRK-07');
  const res = c.inputs.serviceDates.map((d) => {
    const s = scen({ rent: '1500' });
    s.broker = { fee: '300', serviceDate: d, rotationStartDate: c.inputs.postingDate, alreadyReimbursed: false, documented: true, specialDecision81: false };
    return run(s).oneTimeReimbursements.broker;
  });
  expectComp(res[0], '150', 'BRK-07 day before anniversary');
  assert.notEqual(res[1].status, 'calculated', 'BRK-07 anniversary day must not be silently decided');
});

// ---------------------------------------------------------------- baggage
test('T-BAG-01..07 baggage within the shared cap', () => {
  const bagRun = (mission, b) => { const s = scen({ mission, rent: '1500' }); s.baggage = b; return run(s).oneTimeReimbursements.baggage; };
  for (const id of ['T-BAG-01', 'T-BAG-02', 'T-BAG-03', 'T-BAG-04', 'T-BAG-05']) {
    const c = G(id);
    const mission = id === 'T-BAG-05' ? LYON : VIENNA;
    const r = bagRun(mission, { kind: 'departure', previouslyUsed: c.inputs.previouslyUsed, claims: c.inputs.claims.map((a, i) => ({ who: i ? `F${i}` : 'EMP', amount: a })) });
    expectComp(r.cap, c.inputs.cap, `${id} cap from data`);
    c.expected.reimbursements.forEach((e, i) => expectComp(r.perClaim[i].reimbursable, e, `${id} claim ${i}`));
    expectComp(r.remainingCap, c.expected.remaining, `${id} remaining`);
    if (c.expected.personalCost) expectComp(r.personalCost, c.expected.personalCost, `${id} personal`);
  }
  const r6 = bagRun(VIENNA, { kind: 'recall', callbackAlreadyReimbursed: true, previouslyUsed: '0', claims: [{ who: 'EMP', amount: '800' }] });
  expectComp(r6.reimbursable, '0', 'BAG-06 pt 5^2');
  const r7 = bagRun(VIENNA, { kind: 'recall', previouslyUsed: '0', claims: [{ who: 'EMP', amount: '1000' }] });
  expectComp(r7.reimbursable, '1000', 'BAG-07 recall separate cap');
});

// ---------------------------------------------------------------- settlement
test('T-SET-01..06 settlement with synthetic manual daily rate', () => {
  const setRun = (members, extra = {}, rate = { amount: '60', currency: 'EUR' }) => {
    const s = scen({ rent: '1500', family: members });
    s.settlement = { dailyRate: { ...rate, source: 'synthetic test', sourceDate: '2026-10-29', confirmed: false }, fx: null, exclusion9: null, transfer10: false, ...extra };
    return run(s);
  };
  const r1 = setRun([member('F1', { role: 'spouse', age: 40 }), member('F2')]);
  expectComp(r1.oneTimeAllowances.settlement, G('T-SET-01').expected.amount, 'SET-01');
  assert.notEqual(r1.oneTimeAllowances.settlement.status, 'calculated', 'manual daily rate must be unconfirmed');
  const dep = [member('F1', { role: 'spouse', age: 40 }), member('F2'), member('F3', { role: 'other', status: 'support-recipient', age: 70, presence: [] }),
    member('F4', { role: 'other', status: 'guardianship', age: 15, presence: [] })];
  expectComp(setRun(dep).oneTimeAllowances.settlement, G('T-SET-02').expected.amount, 'SET-02');
  const [a0, a3] = G('T-SET-03').expected.amounts;
  expectComp(setRun([]).oneTimeAllowances.settlement, a0, 'SET-03 none');
  expectComp(setRun([member('F1', { role: 'spouse', age: 40 }), member('F2'), member('F3')]).oneTimeAllowances.settlement, a3, 'SET-03 three');
  expectComp(setRun([member('F1', { role: 'spouse', age: 40 })], { exclusion9: 'a' }).oneTimeAllowances.settlement, '0', 'SET-04 pt 9a');
  expectComp(setRun([member('F1', { role: 'spouse', age: 40 })], { transfer10: true }).oneTimeAllowances.settlement, '3960', 'SET-05 pt 10');
  const r6 = setRun([member('F1', { role: 'spouse', age: 40 }), member('F2')], {}, { amount: '60', currency: 'USD' });
  const st = r6.oneTimeAllowances.settlement;
  assert.equal(st.currency, 'USD', 'SET-06: amount stays in the daily-rate currency');
  expectComp(st, '4320', 'SET-06 amount in USD');
  assert.ok(r6.totals.otherCurrencyIds.includes('settlement'), 'SET-06 listed as other-currency item');
  assert.ok(!r6.totals.oneTimeConfirmed.exact || !same(r6.totals.oneTimeConfirmed.exact, '4320'), 'SET-06 not in confirmed EUR total');
});

// ---------------------------------------------------------------- proration and segments
test('T-PRO-01..04 proration of a 1000 full-month rate incl. leap February', () => {
  // isolation data: D=1000, T=200, G=T -> S=1000 exactly
  const cases = [['T-PRO-01', '2027-03-01', '2027-03-15'], ['T-PRO-02', '2028-02-01', '2028-02-15'], ['T-PRO-03', '2027-04-01', '2027-04-15'], ['T-PRO-04', '2027-02-01', '2027-02-15']];
  for (const [id, a, b] of cases) {
    const s = scen({ entry: 'A2-R1', rent: '200' });
    s.period = { mode: 'dates', start: a, end: b };
    const r = run(s, ISO);
    expectComp(r.periodSegments[0].fullMonth.S, '1000', `${id} full`);
    assert.equal(r.periodSegments[0].days, 15);
    assert.equal(r.periodSegments[0].daysInMonth, G(id).inputs.monthDays, `${id} month days`);
    expectComp(r.periodTotal, G(id).expected.amount, id);
  }
});

test('T-PRO-05 arrival mid-month (Vienna)', () => {
  const s = scen({ rent: '1500', family: kids(2) });
  s.period = { mode: 'dates', start: '2027-01-20', end: '2027-01-31' };
  expectComp(run(s).periodTotal, G('T-PRO-05').expected.amount, 'PRO-05');
});

test('T-SEG-01/02 mid-month rent change, own full-month rate per segment', () => {
  for (const id of ['T-SEG-01', 'T-SEG-02']) {
    const c = G(id);
    const s = scen({ rent: c.inputs.segments[0].G, family: kids(2) });
    s.period = { mode: 'dates', start: '2027-03-01', end: '2027-03-31' };
    s.rent.changes = [{ from: c.inputs.segments[1].from, amount: c.inputs.segments[1].G }];
    const r = run(s);
    assert.equal(r.periodSegments.length, 2, `${id} segments`);
    c.expected.segmentFullMonthS.forEach((e, i) => expectComp(r.periodSegments[i].fullMonth.S, e, `${id} seg ${i}`));
    expectComp(r.periodTotal, c.expected.totalS, `${id} total`);
  }
});

test('T-SEG-03 family change C 2 -> 3 from 16 April', () => {
  const c = G('T-SEG-03');
  const s = scen({ rent: '1500', family: [...kids(2), member('F3', { age: 0, from: '2027-04-16' })] });
  s.period = { mode: 'dates', start: '2027-04-01', end: '2027-04-30' };
  const r = run(s);
  c.expected.segmentFullMonthD.forEach((e, i) => expectComp(r.periodSegments[i].fullMonth.D, e, `SEG-03 D ${i}`));
  expectComp(r.periodTotal, c.expected.totalS, 'SEG-03 total');
});

test('T-SEG-04 support recipient counted only on presence days', () => {
  const c = G('T-SEG-04');
  const s = scen({ rent: '1500', family: [...kids(2), member('F3', { role: 'other', status: 'support-recipient', age: 70, presence: [{ from: '2027-06-11', to: '2027-06-20' }] })] });
  s.period = { mode: 'dates', start: '2027-06-01', end: '2027-06-30' };
  expectComp(run(s).periodTotal, c.expected.totalS, 'SEG-04 total');
});

// ---------------------------------------------------------------- insurance
test('T-INS-BAND-01 every band boundary, 70+, empty age undetermined', () => {
  const c = G('T-INS-BAND-01');
  const got = c.inputs.ages.map((a) => insuranceBand(a) ?? 'undetermined');
  assert.deepEqual(got.map((b) => (b === null ? 'undetermined' : b)), c.expected.bands);
  // and through calculate(): empty employee age is not band 0-18
  const s = scen({ rent: '1500' });
  s.insurance = [{ personId: 'EMP', policyCost: '500', alreadyReimbursed: '0' }];
  const p = run(s).insurance.perPerson.find((x) => x.personId === 'EMP');
  assert.notEqual(p.band, '0-18');
  assert.equal(p.annualCap.exact, null, 'cap undetermined without age');
});

test('T-INS-ROW-VIE/KYV/ODS via calculate(): annual cap for each of the 12 bands', () => {
  const repAge = [10, 20, 27, 32, 37, 42, 47, 52, 57, 62, 67, 75];
  for (const [id, mission] of [['T-INS-ROW-VIE', VIENNA], ['T-INS-ROW-KYV', KYIV], ['T-INS-ROW-ODS', ODESA]]) {
    const bands = G(id).expected.bands;
    const s = scen({ mission, rent: '1500', family: repAge.map((age, i) => member(`F${i + 1}`, { role: i ? 'child' : 'spouse', age })) });
    s.insurance = repAge.map((_, i) => ({ personId: `F${i + 1}`, policyCost: '1', alreadyReimbursed: '0' }));
    const per = run(s).insurance.perPerson;
    repAge.forEach((_, i) => expectComp(per.find((x) => x.personId === `F${i + 1}`).annualCap, bands[i], `${id} band ${i}`));
  }
});

test('T-INS-REIMB-01..03 within annual cap incl. already used', () => {
  for (const id of ['T-INS-REIMB-01', 'T-INS-REIMB-02', 'T-INS-REIMB-03']) {
    const c = G(id);
    const s = scen({ rent: '1500' });
    s.employee.age = 40;
    s.insurance = [{ personId: 'EMP', policyCost: c.inputs.policyPrice, alreadyReimbursed: c.inputs.alreadyUsed }];
    const p = run(s).insurance.perPerson[0];
    expectComp(p.annualCap, c.inputs.cap, `${id} cap`);
    expectComp(p.reimbursable, c.expected.reimbursement, `${id} reimbursable`);
    expectComp(p.personalCost, c.expected.personalCost, `${id} personal`);
  }
});

test('T-INS-ANNUAL-01 annual caps are not income', () => {
  const s = scen({ rent: '1500', family: [member('F1', { role: 'spouse', age: 38 }), member('F2', { age: 8 })] });
  s.employee.age = 40;
  const r = run(s);
  expectComp(r.monthly.S, G('T-MON-VIE-01').expected.S, 'S unchanged by caps');
  expectComp(r.remainder.value, '3485.16327', 'remainder (no education) = S - G, caps not added');
});

// ---------------------------------------------------------------- advances, fx, annual
test('T-ADV-01/02 rent advance: schedule, no effect on income', () => {
  const e = G('T-ADV-01').expected;
  const s = scen({ rent: '1500', family: kids(2) });
  const without = run(structuredClone(s));
  s.advances = [{ kind: 'rent', amount: '9000', issueDate: '2027-01-01', months: 6, ministerOrder22: false }];
  const r = run(s);
  const a = r.advances[0];
  expectComp(a.limit, e.maxAdvanceWithoutOrder, 'limit');
  expectComp(a.monthlyRepayment, e.monthlyRepayment, 'repayment');
  assert.deepEqual(a.schedule.map((x) => x.outstandingExact), e.outstandingAfterEachMonth);
  assert.equal(r.monthly.S.exact, without.monthly.S.exact, 'S unchanged');
  assert.equal(r.remainder.value.exact, without.remainder.value.exact, 'remainder unchanged');
  assert.deepEqual(r.totals.oneTimeConfirmed, without.totals.oneTimeConfirmed, 'one-time totals unchanged');
  for (const v of G('T-ADV-02').inputs.variants) {
    const s2 = scen({ rent: '1500' });
    s2.advances = [{ kind: 'rent', amount: v.advance, issueDate: '2027-01-01', months: v.months, ministerOrder22: false }];
    assert.equal(run(s2).advances[0].requiresMinisterOrder, true, `ADV-02 ${v.advance}/${v.months}`);
  }
});

test('T-FX-01 forecast rates labelled, never settlement', () => {
  const e = G('T-FX-01').expected;
  const r = run(scen({ rent: '1500', family: kids(2) }));
  assert.equal(r.fx.forecast.EUR, '3.2'); assert.equal(r.fx.forecast.USD, '2.8');
  assert.equal(r.fx.forecast.usableForSettlement, false);
  assert.match(r.fx.forecast.purpose_ka, /საპროგნოზო/);
  expectComp(r.fx.forecast.illustrativeS_GEL, e.illustrativeGEL, 'illustrative GEL');
});

test('T-ANN-01 vacation month is conditional, not merged', () => {
  const r = run(scen({ rent: '1500', family: kids(2) }));
  const v = r.oneTimeAllowances.vacationMonth;
  expectComp(v, G('T-ANN-01').expected.vacationAmountConditional, 'vacation amount');
  assert.equal(v.status, 'scenario');
});
