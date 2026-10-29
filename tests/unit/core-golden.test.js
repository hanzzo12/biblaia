// Runs the tester's golden cases (tests/fixtures/golden-cases.json) against the core.
// Formula-level inputs are fed through calculate() with synthetic normative data where possible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, insuranceBand } from '../../src/core/index.js';
import * as F from '../../src/core/formulas.js';
import { eq, R, toFixed2 } from '../../src/core/rational.js';
import { DATA, golden, goldenOfKind, assertGolden, synthData, synthScenario, compExact, parseExact } from './_core-helpers.mjs';

test('golden rent cases (T-RENT-*) through calculate with D = 1000', () => {
  for (const c of goldenOfKind('rent')) {
    const i = c.inputs;
    const data = synthData({ H: i.D, A: '100', K: '1', E: i.E_percent });
    const r = calculate(synthScenario({ C: 0, G: i.G, head: i.isHead }), data);
    const ex = c.expected;
    if (ex.T) assertGolden(r.monthly.T, ex.T, `${c.id} T`);
    assertGolden(r.monthly.F, ex.F, `${c.id} F`);
    assertGolden(r.monthly.S, ex.S, `${c.id} S`);
    if (ex.uncoveredHousing) assertGolden(r.monthly.uncoveredRent, ex.uncoveredHousing, `${c.id} uncovered`);
    if (ex.subsidyAboveRent) assertGolden(r.monthly.rentSurplus, ex.subsidyAboveRent, `${c.id} surplus`);
    if (c.mustNotEqual?.F) assert.notEqual(r.monthly.F.exact, c.mustNotEqual.F, c.id);
  }
});

test('golden monthly cases (Vienna, Kyiv, Washington, positions) through calculate', () => {
  for (const c of goldenOfKind('monthly', 'monthly-with-education')) {
    const i = c.inputs;
    const data = synthData({ currency: i.currency, H: i.H, A: i.A_percent, K: i.K, E: i.E_percent });
    const family = Array.from({ length: i.C }, (_, k) => ({ id: `F${k + 1}`, role: k === 0 ? 'spouse' : 'child', status: 'regular', age: k === 0 ? 40 : 10 }));
    const extra = {};
    if (i.educationExpenses) {
      if (!family.some((m) => m.role === 'child')) family.push({ id: 'FX', role: 'child', status: 'regular', age: 10, supplementPaidToOtherEmployee: true });
      extra.education = i.educationExpenses.map((e) => ({ memberId: family.find((m) => m.role === 'child').id, tuition: e }));
    }
    const r = calculate(synthScenario({ G: i.G, head: i.isHead, mode: i.positionMode === 'annex3' ? 'annex3' : 'annex2', family, ...extra }), data);
    const ex = c.expected;
    for (const k of ['D', 'T', 'F', 'S']) {
      if (!ex[k]) continue;
      if (ex[k] === 'undetermined') { assert.equal(r.monthly[k].status, 'undetermined', `${c.id} ${k}`); assert.equal(r.monthly[k].value, null); }
      else assertGolden(r.monthly[k], ex[k], `${c.id} ${k}`);
    }
    if (ex.uncoveredHousing) assertGolden(r.monthly.uncoveredRent, ex.uncoveredHousing, `${c.id} uncovered`);
    if (ex.DminusT) assertGolden(r.monthly.DminusT, ex.DminusT, `${c.id} D−T`);
    if (ex.educationReimbursement) assertGolden(r.education.total, ex.educationReimbursement, `${c.id} edu`);
    if (ex.remainderAfterRentAndEducation) assertGolden(r.remainder.value, ex.remainderAfterRentAndEducation, `${c.id} remainder`);
    if (ex.S === 'undetermined') assert.notEqual(r.completeness, 'complete', `${c.id}: unknown rent must not be complete`);
  }
});

test('T-MON-KYV-01 and T-MON-VIE-01 with the real normative data', () => {
  const kyiv = golden('T-MON-KYV-01').expected;
  const r = calculate({ schemaVersion: 1, missionId: 'M-A6-R26', position: { mode: 'annex2', entryId: 'A2-R6' }, status: { rentHead: 'not-head' },
    family: [{ id: 'F1', role: 'spouse', status: 'regular', age: 35 }], rent: { amount: '2500', basis: 'actual', changes: [] } }, DATA);
  assert.equal(r.currency, 'USD');
  for (const k of ['D', 'T', 'F', 'S']) assertGolden(r.monthly[k], kyiv[k], `Kyiv ${k}`);
  const vie = golden('T-MON-VIE-01').expected;
  const v = calculate({ schemaVersion: 1, missionId: 'M-A5-R1', position: { mode: 'annex2', entryId: 'A2-R5' }, status: { rentHead: 'not-head' },
    family: [{ id: 'F1', role: 'spouse', status: 'regular', age: 35 }, { id: 'F2', role: 'child', status: 'regular', age: 7 }], rent: { amount: '1500' } }, DATA);
  for (const k of ['D', 'T', 'F', 'S']) assertGolden(v.monthly[k], vie[k], `Vienna ${k}`);
  assert.equal(v.completeness, 'complete');
});

test('T-ROUND-02: S from exact intermediates, not from rounded ones', () => {
  const c = golden('T-ROUND-02');
  const r = calculate(synthScenario({ C: 2, G: c.inputs.G }), synthData({}));
  assert.equal(r.monthly.S.value, c.expected.S_display);
  assert.notEqual(r.monthly.S.value, c.mustNotEqual.S_display);
});

test('T-FAM-01: higher category receives the supplement, the other C = 0 and G = 0', () => {
  const c = golden('T-FAM-01');
  const hi = calculate(synthScenario({ C: 2, G: c.inputs.higher.G }), synthData({ A: c.inputs.higher.A_percent }));
  const lo = calculate(synthScenario({ G: '0', family: [{ id: 'F1', role: 'spouse', status: 'regular', supplementPaidToOtherEmployee: true }, { id: 'F2', role: 'child', status: 'regular', supplementPaidToOtherEmployee: true }] }),
    synthData({ A: c.inputs.lower.A_percent }));
  assertGolden(hi.monthly.D, c.expected.higher.D, 'higher D'); assertGolden(hi.monthly.S, c.expected.higher.S, 'higher S');
  assertGolden(lo.monthly.D, c.expected.lower.D, 'lower D'); assertGolden(lo.monthly.S, c.expected.lower.S, 'lower S');
  assert.equal(lo.monthly.C.value, '0');
});

test('T-POS-03: annex 2 vs annex 3 position percentages from data', () => {
  const c = golden('T-POS-03');
  for (const mode of ['annex2', 'annex3']) {
    const prof = DATA.positionProfiles.find((p) => p.id === mode);
    for (const [title, pctV] of Object.entries(c.expected[mode])) {
      const e = prof.entries.find((x) => x.positions_ka.includes(title));
      assert.ok(e, `${mode} ${title}`);
      assert.equal(e.percent, pctV, `${mode} ${title}`);
    }
  }
});

test('golden education cases', () => {
  for (const c of goldenOfKind('education')) {
    const i = c.inputs;
    const data = synthData({ currency: i.currency });
    const edu = { memberId: 'F1', tuition: i.P };
    if (i.ineligibleReason === 'holiday-extra-contract-pt35') Object.assign(edu, { tuition: null, holidayExtraContract: i.P });
    if (i.ineligibleReason === 'free-state-language-school-pt36') edu.freeStateLanguageSchoolAvailable = true;
    if (i.ineligibleReason === 'category-not-in-pt31') {
      // a non-pt31 cost (books, uniform) has no field: entering it as zero allowed expense gives 0 reimbursement
      const f = F.educationReimbursement('0', '690');
      assert.ok(eq(f.reimbursement, c.expected.reimbursement.exact), c.id);
      continue;
    }
    const r = calculate(synthScenario({ G: '0', family: [{ id: 'F1', role: 'child', status: 'regular', age: 10 }], education: [edu] }), data);
    const ch = r.education.perChild[0];
    assertGolden(ch.reimbursement, c.expected.reimbursement, `${c.id} reimbursement`);
    assertGolden(ch.personalCost, c.expected.personalCost, `${c.id} personal`);
  }
});

test('golden multi-child education: per-child limit, pooled alternative shown separately', () => {
  for (const c of goldenOfKind('education-multi')) {
    const kids = c.inputs.children.map((k, n) => ({ id: `K${n}`, role: 'child', status: 'regular', age: 8 + n }));
    const r = calculate(synthScenario({ G: '0', family: kids, education: c.inputs.children.map((k, n) => ({ memberId: `K${n}`, tuition: k.P })) }), synthData({ currency: c.inputs.currency }));
    c.expected.perChild.forEach((e, n) => assertGolden(r.education.perChild[n].reimbursement, e, `${c.id} child ${n}`));
    assertGolden(r.education.total, c.expected.total, `${c.id} total`);
    assertGolden(r.education.personal, c.expected.personalCost, `${c.id} personal`);
    assertGolden(r.education.alternativePooled, c.alternativeIfPooled.total, `${c.id} pooled`);
    assert.equal(r.education.alternativePooled.status, 'scenario');
    assert.ok(r.assumptions.some((a) => a.openQuestion === 'OQ-02'));
  }
});

test('T-EDU-12: adult child note', () => {
  const c = golden('T-EDU-12');
  assert.deepEqual(c.inputs.cases.map((x) => F.adultChildEligible(x)), c.expected.eligible);
});

test('golden broker cases through calculate', () => {
  for (const c of goldenOfKind('broker')) {
    const i = c.inputs;
    if (i.serviceDates) {
      const got = i.serviceDates.map((d) => F.brokerWindow(i.postingDate, d));
      assert.deepEqual(got.map((g) => (g === null ? 'undetermined' : g)), c.expected.eligible, c.id);
      continue;
    }
    const r = calculate(synthScenario({ G: i.rent, head: i.isHead, broker: { fee: i.fee, serviceDate: i.serviceDate, rotationStartDate: i.postingDate, alreadyReimbursed: i.alreadyReimbursed, documented: true, specialDecision81: false } }), synthData({}));
    const b = r.oneTimeReimbursements.broker;
    assertGolden(b, c.expected.reimbursement, c.id);
    assert.equal(b.status, 'calculated', c.id);
    if (c.legacyValue?.reimbursement) assert.notEqual(b.value, toFixed2(c.legacyValue.reimbursement), `${c.id} must differ from legacy`);
  }
});

test('broker: fee never defaults to rent; 8¹ is unconfirmed', () => {
  const r = calculate(synthScenario({ G: '1500', broker: { fee: null, serviceDate: '2027-02-01', rotationStartDate: '2027-01-15', documented: true } }), synthData({}));
  assert.equal(r.oneTimeReimbursements.broker.status, 'undetermined');
  assert.ok(r.missingInputs.some((m) => m.path === 'broker.fee'));
  const s = calculate(synthScenario({ G: '1500', broker: { fee: '300', serviceDate: '2027-09-01', rotationStartDate: '2027-01-15', documented: true, specialDecision81: true } }), synthData({}));
  assert.equal(s.oneTimeReimbursements.broker.status, 'unconfirmed');
  assert.equal(s.completeness, 'partial');
});

test('golden baggage cases', () => {
  for (const c of goldenOfKind('baggage')) {
    const i = c.inputs;
    const res = F.baggageReimbursement(R(i.cap), R(i.previouslyUsed), i.claims.map((x) => R(x)));
    assert.deepEqual(res.reimbursements.map((x) => toFixed2(x)), c.expected.reimbursements.map((x) => toFixed2(x)), c.id);
    if (c.expected.remaining) assert.ok(eq(res.remainingCap, c.expected.remaining), c.id);
    if (c.expected.personalCost) assert.ok(eq(res.personalCost, c.expected.personalCost), c.id);
    // and through calculate with the cap from data
    const r = calculate(synthScenario({ G: '0', baggage: { kind: i.event ?? 'departure', previouslyUsed: i.previouslyUsed, claims: i.claims.map((a) => ({ who: 'EMP', amount: a })) } }), synthData({ bag: i.cap }));
    assert.ok(eq(compExact(r.oneTimeReimbursements.baggage.reimbursable), c.expected.reimbursements.reduce((s, x) => s + Number(x), 0).toString()), c.id);
  }
  const ev = golden('T-BAG-06');
  const r = calculate(synthScenario({ G: '0', baggage: { kind: 'recall', previouslyUsed: '0', callbackAlreadyReimbursed: ev.inputs.callBackAlreadyReimbursed, claims: ev.inputs.claims.map((a) => ({ who: 'EMP', amount: a })) } }), synthData({ bag: ev.inputs.cap }));
  assert.equal(r.oneTimeReimbursements.baggage.reimbursable.value, '0.00');
});

test('golden settlement cases (synthetic daily rate)', () => {
  const statusOf = (s) => (s === 'spouse' ? { role: 'spouse', status: 'regular' } : s === 'child' ? { role: 'child', status: 'regular' } : { role: 'other', status: s });
  for (const c of goldenOfKind('settlement')) {
    const i = c.inputs;
    const variants = i.variants ?? [{ members: i.members }];
    variants.forEach((vv, n) => {
      const family = vv.members.map((m, k) => ({ id: `F${k}`, age: 30, ...statusOf(m.status), presence: [{ from: '2027-01-01', to: '2027-12-31' }] }));
      const settlement = { dailyRate: { amount: i.dailyRate, currency: i.dailyRateCurrency, source: 'synthetic', sourceDate: '2026-01-01', confirmed: false },
        fx: null, exclusion9: i.exception === 'pt9a-same-city-transfer' ? 'a' : null, transfer10: i.exception === 'pt10-other-city-transfer' };
      const r = calculate(synthScenario({ G: '0', family, settlement }), synthData({ currency: i.missionCurrency ?? 'EUR' }));
      const s = r.oneTimeAllowances.settlement;
      const exp = c.expected.amounts ? c.expected.amounts[n] : c.expected.amount.exact;
      assert.ok(eq(compExact(s), exp), `${c.id} amount`);
      if (c.expected.countableMembers != null) assert.equal(s.inputsUsed.n, c.expected.countableMembers, `${c.id} n`);
      if (c.expected.currency) assert.equal(s.currency, c.expected.currency);
      if (c.expected.includedInConfirmedEURTotal === false) {
        assert.ok(!r.totals.oneTimeConfirmed.inputsUsed.ids.includes('settlement'));
        assert.ok(r.totals.otherCurrencyIds.includes('settlement'));
      }
      if (!i.exception) assert.equal(s.status, 'unconfirmed', 'manual daily rate is never confirmed (P-9)');
    });
  }
});

test('golden segment cases (dates mode)', () => {
  for (const c of goldenOfKind('segments')) {
    const i = c.inputs;
    const segs = i.segments;
    const start = segs[0].from, end = segs[segs.length - 1].to;
    let family, rent;
    if ('G' in segs[0]) {
      family = Array.from({ length: i.base.C }, (_, k) => ({ id: `F${k}`, role: k ? 'child' : 'spouse', status: 'regular', age: 30 }));
      rent = { amount: segs[0].G, basis: 'actual', changes: segs.slice(1).map((s) => ({ from: s.from, amount: s.G })) };
    } else {
      const base = segs[0].C;
      family = Array.from({ length: base }, (_, k) => ({ id: `F${k}`, role: k ? 'child' : 'spouse', status: 'regular', age: 30 }));
      // extra members for segments with higher C
      segs.forEach((s, n) => { if (s.C > base) for (let k = base; k < s.C; k++) family.push({ id: `X${n}-${k}`, role: 'child', status: 'regular', age: 5, from: s.from, to: s.to }); });
      rent = { amount: i.base.G, basis: 'actual', changes: [] };
    }
    const r = calculate(synthScenario({ family, head: i.base.isHead, period: { mode: 'dates', start, end }, rent }), synthData({ A: i.base.A_percent, K: i.base.K, E: i.base.E_percent, H: i.base.H }));
    assert.equal(r.periodSegments.length, segs.length, c.id);
    r.periodSegments.forEach((s, n) => {
      assert.equal(s.from, segs[n].from); assert.equal(s.to, segs[n].to); assert.equal(s.days, segs[n].days); assert.equal(s.daysInMonth, i.monthDays);
      assert.ok(eq(compExact(s.fullMonth.S), c.expected.segmentFullMonthS[n]), `${c.id} seg ${n} S`);
      if (c.expected.segmentFullMonthD) assert.ok(eq(compExact(s.fullMonth.D), c.expected.segmentFullMonthD[n]), `${c.id} seg ${n} D`);
    });
    assertGolden(r.periodTotal, c.expected.totalS, `${c.id} total`);
    if (typeof c.legacyValue === 'string') assert.notEqual(r.periodTotal.value, c.legacyValue);
  }
});

test('T-INS-BAND-01: age bands; empty age is undetermined, not 0–18', () => {
  const c = golden('T-INS-BAND-01');
  assert.deepEqual(c.inputs.ages.map((a) => insuranceBand(a) ?? 'undetermined'), c.expected.bands);
});

test('golden insurance rows and reimbursement', () => {
  for (const c of [...goldenOfKind('insurance-row'), ...golden('T-INS-ROW-SPOT').expected.rows.map((x) => ({ id: `SPOT ${x.annex}/${x.row}`, inputs: x, expected: x }))]) {
    const row = DATA.insuranceCaps.find((x) => x.id === `INS-A${c.inputs.annex}-R${c.inputs.row}`);
    assert.ok(row, c.id);
    assert.deepEqual(F.BANDS.map((b) => row.bands[b]), c.expected.bands, c.id);
    if (c.inputs.page) assert.equal(row.page, c.inputs.page, c.id);
  }
  for (const c of goldenOfKind('insurance-reimb')) {
    const i = c.inputs;
    const r = F.insuranceReimbursement(R(i.cap), R(i.policyPrice), R(i.alreadyUsed));
    assert.ok(eq(r.reimbursable, c.expected.reimbursement), c.id);
    if (c.expected.personalCost) assert.ok(eq(r.personalCost, c.expected.personalCost), c.id);
    if (c.expected.remainingCap) assert.ok(eq(r.remainingCap, c.expected.remainingCap), c.id);
  }
  // T-INS-REIMB-04: support recipient; cap not prorated automatically
  const r = calculate(synthScenario({ G: '0', family: [{ id: 'F1', role: 'other', status: 'support-recipient', age: 42, presence: [{ from: '2027-01-01', to: '2027-03-31' }] }],
    insurance: [{ personId: 'F1', policyCost: '500', alreadyReimbursed: '0' }] }), synthData({}));
  const p = r.insurance.perPerson.find((x) => x.personId === 'F1');
  assert.equal(p.annualCap.value, '1663.00');
  assert.equal(p.reimbursable.value, '500.00');
});

test('T-INS-ANNUAL-01: annual caps are informational, never income', () => {
  const r = calculate(synthScenario({ G: '0', employee: { age: 42 }, family: [{ id: 'F1', role: 'spouse', status: 'regular', age: 38 }, { id: 'F2', role: 'child', status: 'regular', age: 5 }] }), synthData({}));
  const caps = r.annualCaps.insurance.map((c) => c.value);
  assert.deepEqual(caps, ['1663.00', '1504.00', '864.00']);
  assert.equal(r.totals.oneTimeConfirmed.value, '0.00');
  assert.ok(r.annualCaps.insurance.every((c) => c.category === 'annual-cap'));
  assert.equal(r.remainder.value.value, r.monthly.S.value, 'caps not added to the remainder');
});

test('golden advance cases', () => {
  const a = golden('T-ADV-01');
  const r = calculate(synthScenario({ C: 2, G: a.inputs.rent, advances: [{ kind: 'rent', amount: a.inputs.advance, issueDate: '2027-01-10', months: a.inputs.months, ministerOrder22: false }] }), synthData({}));
  const adv = r.advances[0];
  assert.equal(adv.requiresMinisterOrder, false);
  assertGolden(adv.limit, a.expected.maxAdvanceWithoutOrder, 'limit');
  assertGolden(adv.monthlyRepayment, a.expected.monthlyRepayment, 'monthly');
  assert.deepEqual(adv.schedule.map((s) => s.outstandingExact), a.expected.outstandingAfterEachMonth);
  assert.equal(adv.amount.category, 'advance');
  assert.equal(r.totals.oneTimeConfirmed.value, '0.00', 'advance is not income');
  assert.equal(r.remainder.value.value, calculate(synthScenario({ C: 2, G: a.inputs.rent }), synthData({})).remainder.value.value);
  const b = golden('T-ADV-02');
  b.inputs.variants.forEach((vv, n) => {
    const rr = calculate(synthScenario({ G: b.inputs.rent, advances: [{ kind: 'rent', amount: vv.advance, issueDate: '2027-01-10', months: vv.months }] }), synthData({}));
    assert.equal(rr.advances[0].requiresMinisterOrder, b.expected.requiresMinisterOrder[n]);
    assert.equal(rr.advances[0].status, 'unconfirmed');
  });
});

test('T-FX-01 forecast rate is labelled and never a settlement rate; T-ANN-01 vacation month not automatic', () => {
  const f = golden('T-FX-01');
  const r = calculate(synthScenario({ C: 2, G: '1500' }), synthData({}));
  assert.equal(r.fx.forecast.EUR, f.inputs.forecastGELperEUR);
  assert.equal(r.fx.forecast.USD, f.inputs.forecastGELperUSD);
  assert.equal(r.fx.forecast.usableForSettlement, false);
  assertGolden(r.fx.forecast.illustrativeS_GEL, f.expected.illustrativeGEL, 'GEL');
  assert.equal(r.fx.forecast.illustrativeS_GEL.status, 'scenario');
  const a = golden('T-ANN-01');
  assertGolden(r.oneTimeAllowances.vacationMonth, a.expected.vacationAmountConditional, 'vacation month');
  assert.equal(r.oneTimeAllowances.vacationMonth.status, 'scenario');
});

test('golden data spot checks (K/E, institutions, counts, baggage, parameters)', () => {
  const k = (row) => DATA.costCoefficients.find((x) => x.annex4Row === row);
  const ke1 = golden('T-DATA-KE-01');
  assert.equal(k(22).k, ke1.expected.K); assert.equal(k(22).ePercent, ke1.expected.E_percent);
  for (const x of golden('T-DATA-KE-02').expected.rows) { assert.ok(eq(k(x.row).k, x.K), `K row ${x.row}`); assert.equal(k(x.row).ePercent, x.E, `E row ${x.row}`); }
  const cnt = golden('T-DATA-INST-05').expected;
  assert.equal(DATA.missions.filter((m) => m.annex === 5).length, cnt.annex5Active);
  assert.equal(DATA.missions.length, cnt.institutionsTotal);
  assert.equal(DATA.costCoefficients.length, cnt.annex4Rows);
  for (const x of golden('T-DATA-BAG-01').expected.rows) {
    const b = DATA.baggageCaps.find((y) => y.id === `BAG-A${x.annex}-R${x.row}`);
    assert.equal(b.amount, x.cap, `${x.institution}`); assert.equal(b.currency, x.currency);
  }
  const p = Object.fromEntries(DATA.parameters.map((x) => [x.id, x.value]));
  const h = golden('T-DATA-H-01').expected;
  assert.equal(p['EDU-LIMIT-EUR'], h.L_EUR); assert.equal(p['EDU-LIMIT-USD'], h.L_USD); assert.equal(p['FAMILY-SUPPLEMENT-PCT'], h.Q_percent);
  // T-DATA-KE-04 / T-DATA-INST-06 through the core
  const vat = calculate({ schemaVersion: 1, missionId: 'M-A5-R37', position: { mode: 'annex2', entryId: 'A2-R1' }, status: { rentHead: 'head' }, rent: { amount: '0' } }, DATA);
  assert.equal(vat.monthly.K.status, 'undetermined'); assert.equal(vat.monthly.S.value, null); assert.equal(vat.completeness, 'incomplete');
  assert.ok(!DATA.missions.some((m) => ['RS', 'ME'].includes(m.countryId)));
  const ke3 = golden('T-DATA-KE-03').expected;
  const keOf = (id) => { const m = DATA.missions.find((x) => x.id === id); const kk = DATA.costCoefficients.find((x) => x.id === m.costCoefficientId); return { K: kk.k, E: kk.ePercent }; };
  assert.deepEqual(keOf('M-A6-R4'), ke3.washingtonEmbassy); assert.deepEqual(keOf('M-A6-R5'), ke3.newYorkUNMission); assert.deepEqual(keOf('M-A6-R28'), ke3.newYorkConsulate);
  assert.ok(parseExact('1') && true);
});
