// Developer unit tests: calculate() behaviour on ScenarioV1 (statuses, eligibility, completeness).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, emptyScenario, validateScenario, listMissions, resolveMission, listCountries, listLocations, positionProfiles,
  ROLES, MEMBER_STATUSES, EXTRA_CATEGORIES, SCENARIO_SCHEMA_VERSION, ruleCatalog } from '../../src/core/index.js';
import { DATA, synthData, synthScenario } from './_core-helpers.mjs';

const allComponents = (r) => {
  const out = [];
  const walk = (x) => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if ('status' in x && 'ruleIds' in x && 'category' in x) { out.push(x); }
    for (const v of Object.values(x)) walk(v);
  };
  walk(r);
  return out;
};

test('empty / null scenario never throws and is incomplete with missing inputs', () => {
  for (const sc of [null, undefined, {}, emptyScenario(), { schemaVersion: 1, family: 'x', rent: 5 }]) {
    const r = calculate(sc, DATA);
    assert.equal(r.completeness, 'incomplete');
    assert.ok(r.missingInputs.some((m) => m.path === 'missionId'));
    assert.equal(r.monthly.S.value, null);
    assert.equal(r.monthly.S.status, 'undetermined');
  }
  assert.equal(emptyScenario().schemaVersion, SCENARIO_SCHEMA_VERSION);
});

test('every component carries ruleIds from the catalog and a known status', () => {
  const sc = synthScenario({ C: 2, G: '1500', employee: { age: 40 }, insurance: [{ personId: 'EMP', policyCost: '900', alreadyReimbursed: '0' }],
    broker: { fee: '300', serviceDate: '2027-02-01', rotationStartDate: '2027-01-15', documented: true },
    baggage: { kind: 'departure', previouslyUsed: '0', claims: [{ who: 'EMP', amount: '600' }] },
    travel: [{ kind: 'departure', personId: 'EMP', actualCost: '300', comparableTicket: null, route: 'georgia', ownCar: false }],
    extras: [{ category: 'visa', amount: '120', justification: 'ვიზა', ministerDecisionRequired: false }],
    advances: [{ kind: 'rent', amount: '3000', issueDate: '2027-01-10', months: 6 }] });
  const r = calculate(sc, synthData({}));
  const comps = allComponents(r);
  assert.ok(comps.length > 40);
  for (const c of comps) {
    assert.ok(['calculated', 'scenario', 'unconfirmed', 'undetermined', 'not_applicable'].includes(c.status), c.id);
    for (const id of c.ruleIds) assert.ok(ruleCatalog[id], `${c.id}: unknown ruleId ${id}`);
    if (c.status === 'undetermined') assert.equal(c.value, null, c.id);
  }
  for (const w of [...r.warnings, ...r.assumptions]) for (const id of w.ruleIds) assert.ok(ruleCatalog[id], `${w.code}: unknown ruleId ${id}`);
  assert.equal(r.completeness, 'complete');
  assert.equal(r.totals.oneTimeConfirmed.value, (900 + 150 + 600 + 300 + 120).toFixed(2));
});

test('G null vs G "0": unknown rent is partial; zero rent is complete with F = 0', () => {
  const u = calculate(synthScenario({ C: 2, G: null }), synthData({}));
  assert.equal(u.completeness, 'partial');
  assert.equal(u.monthly.G.status, 'undetermined');
  assert.ok(u.missingInputs.some((m) => m.path === 'rent.amount'));
  assert.equal(u.monthly.DminusT.value, '3738.30');
  const z = calculate(synthScenario({ C: 2, G: '0' }), synthData({}));
  assert.equal(z.completeness, 'complete');
  assert.equal(z.monthly.F.value, '0.00');
  assert.equal(z.monthly.S.value, z.monthly.DminusT.value);
});

test('rent above T without head status → F undetermined and rentHead requested; G ≤ T needs no head status', () => {
  const r = calculate(synthScenario({ C: 0, G: '5000', head: null }), synthData({}));
  assert.equal(r.monthly.F.status, 'undetermined');
  assert.ok(r.missingInputs.some((m) => m.path === 'status.rentHead'));
  const ok = calculate(synthScenario({ C: 0, G: '100', head: null }), synthData({}));
  assert.equal(ok.monthly.F.status, 'calculated');
  assert.equal(ok.monthly.rentSurplus.status, 'calculated');
});

test('market-scenario rent marks F/S as scenario; G = T records OQ-01', () => {
  const sc = synthScenario({ C: 0, G: '1500' });
  sc.rent.basis = 'market-scenario';
  const r = calculate(sc, synthData({}));
  assert.equal(r.monthly.G.status, 'scenario');
  assert.equal(r.monthly.S.status, 'scenario');
  assert.equal(r.completeness, 'complete', 'scenario status alone does not make the result partial');
  const eqT = calculate(synthScenario({ C: 0, G: '200', head: false }), synthData({ H: '1000', A: '100', K: '1', E: '20' }));
  assert.ok(eqT.assumptions.some((a) => a.openQuestion === 'OQ-01'));
});

test('head status interpretations: consular head (P-5), acting head 20¹ (P-6), unusual head flag', () => {
  const data = synthData({});
  const cons = calculate(synthScenario({ C: 0, G: '5000', head: true, entryId: 'A2-R2' }), data);
  assert.equal(cons.monthly.F.status, 'scenario');
  assert.ok(cons.assumptions.some((a) => a.openQuestion === 'OQ-10'));
  const consBroker = calculate(synthScenario({ C: 0, G: '1500', head: true, entryId: 'A2-R2', broker: { fee: '300', serviceDate: '2027-02-01', rotationStartDate: '2027-01-15', documented: true } }), data);
  assert.equal(consBroker.oneTimeReimbursements.broker.status, 'calculated', 'broker 80% is direct for consular heads (pt 8)');
  assert.equal(consBroker.oneTimeReimbursements.broker.value, '240.00');
  const sc = synthScenario({ C: 0, G: '3000', head: true });
  sc.status.actingHead201 = { applies: true, actRef: '№01-999' };
  const act = calculate(sc, data);
  assert.equal(act.monthly.A.value, '100');
  assert.equal(act.monthly.F.status, 'scenario');
  assert.ok(act.assumptions.some((a) => a.openQuestion === 'OQ-11'));
  const sc2 = synthScenario({ C: 0, G: '3000', head: false });
  sc2.status.actingHead201 = { applies: true, actRef: null };
  const noAct = calculate(sc2, data);
  assert.equal(noAct.monthly.A.value, '65', 'without act reference A is unchanged');
  assert.ok(noAct.warnings.some((w) => w.code === 'POS_201_ACT'));
  const odd = calculate(synthScenario({ C: 0, G: '3000', head: true }), data);
  assert.ok(odd.warnings.some((w) => w.code === 'HEAD_UNUSUAL'));
});

test('pt 20²: admin manager uses Annex 2 row 3 (75%) only with an order reference, rent rule not head', () => {
  const sc = synthScenario({ C: 0, G: '3000', head: false });
  sc.status.adminManager202 = { applies: true, actRef: 'ბრძანება №01-1' };
  const r = calculate(sc, synthData({}));
  assert.equal(r.monthly.A.value, '75');
  assert.equal(r.monthly.F.value, '2002.90');
});

test('family eligibility: each rule separately; settlement count ≠ C', () => {
  const fam = [
    { id: 'S', role: 'spouse', status: 'regular', age: 40 },
    { id: 'K1', role: 'child', status: 'regular', age: 10, reimbursedElsewhere: { education: true } },
    { id: 'W', role: 'spouse', status: 'regular', age: 40, worksInSameMissionOrCity: true },
    { id: 'D', role: 'other', status: 'support-recipient', age: 70, presence: [{ from: '2027-01-01', to: '2027-12-31' }] },
    { id: 'P', role: 'spouse', status: 'regular', age: 41, spousePostedInOtherCity: true },
    { id: 'A', role: 'child', status: 'regular', age: 18, adultChildInSchool: true },
  ];
  const r = calculate(synthScenario({ G: '0', family: fam, settlement: { dailyRate: { amount: '60', currency: 'EUR', source: 't', sourceDate: '2026-01-01' }, fx: null, exclusion9: null, transfer10: false } }), synthData({}));
  const el = Object.fromEntries(r.family.map((f) => [f.memberId, f.eligibility]));
  assert.equal(el.S.monthlySupplement.value, true);
  assert.equal(el.W.monthlySupplement.value, false); assert.ok(el.W.monthlySupplement.ruleIds.includes('R-FAM-EMPLOYED'));
  assert.equal(el.P.monthlySupplement.value, false); assert.ok(el.P.monthlySupplement.ruleIds.includes('R-FAM-DIFFCITY'));
  assert.equal(el.D.monthlySupplement.value, true);
  assert.equal(el.D.settlement10.value, false);
  assert.equal(el.K1.education.value, false); assert.ok(el.K1.education.ruleIds.includes('R-FAM-OTHERAGENCY'));
  assert.equal(el.A.education.value, true);
  assert.equal(r.monthly.C.value, '4', 'S, K1, D, A count; W and P do not');
  assert.equal(r.oneTimeAllowances.settlement.inputsUsed.n, 5, 'settlement counts all non-dependents');
});

test('T-FAM-06/07/08: dependent presence days split segments; unknown presence → C undetermined', () => {
  const data = synthData({});
  const dep = { id: 'D', role: 'other', status: 'guardianship', age: 12, presence: [{ from: '2027-04-11', to: '2027-04-20' }] };
  const r = calculate(synthScenario({ G: '0', family: [dep], period: { mode: 'dates', start: '2027-04-01', end: '2027-04-30' } }), data);
  assert.deepEqual(r.periodSegments.map((s) => [s.from, s.to, s.C]), [['2027-04-01', '2027-04-10', '0'], ['2027-04-11', '2027-04-20', '1'], ['2027-04-21', '2027-04-30', '0']]);
  const unk = calculate(synthScenario({ G: '0', family: [{ ...dep, presence: null }] }), data);
  assert.equal(unk.monthly.C.status, 'undetermined');
  assert.equal(unk.monthly.D.status, 'undetermined');
  assert.ok(unk.missingInputs.some((m) => m.path === 'family.D.presence'));
});

test('insurance: empty age → undetermined cap (never 0–18); 70+ band; reimbursed elsewhere → 0', () => {
  const r = calculate(synthScenario({ G: '0', employee: { age: null }, family: [{ id: 'F1', role: 'spouse', status: 'regular', age: 75 }, { id: 'F2', role: 'child', status: 'regular', age: 9, reimbursedElsewhere: { insurance: true } }],
    insurance: [{ personId: 'EMP', policyCost: '800', alreadyReimbursed: '0' }, { personId: 'F2', policyCost: '300', alreadyReimbursed: '0' }] }), synthData({}));
  const p = Object.fromEntries(r.insurance.perPerson.map((x) => [x.personId, x]));
  assert.equal(p.EMP.band, null); assert.equal(p.EMP.annualCap.status, 'undetermined'); assert.equal(p.EMP.reimbursable.status, 'undetermined');
  assert.ok(r.missingInputs.some((m) => m.path === 'employee.age'));
  assert.equal(p.F1.band, '70+'); assert.equal(p.F1.annualCap.value, '5652.00'); assert.equal(p.F1.reimbursable.status, 'not_applicable');
  assert.equal(p.F2.reimbursable.value, '0.00'); assert.equal(p.F2.personalCost.value, '300.00');
  assert.equal(r.completeness, 'partial');
});

test('insurance age from birth date uses the period start and records OQ-08', () => {
  const r = calculate(synthScenario({ G: '0', employee: { age: null, birthDate: '1987-05-01' }, period: { mode: 'dates', start: '2027-04-01', end: '2027-04-30' },
    insurance: [{ personId: 'EMP', policyCost: '800', alreadyReimbursed: '0' }] }), synthData({}));
  assert.equal(r.insurance.perPerson[0].age, 39);
  assert.equal(r.insurance.perPerson[0].band, '35-39');
  assert.ok(r.assumptions.some((a) => a.openQuestion === 'OQ-08'));
});

test('education: free state-language school (pt 36) and minister decision (pt 34) states', () => {
  const fam = [{ id: 'K', role: 'child', status: 'regular', age: 9 }];
  const r = calculate(synthScenario({ G: '0', family: fam, education: [{ memberId: 'K', tuition: '1000', freeStateLanguageSchoolAvailable: true }] }), synthData({}));
  assert.equal(r.education.perChild[0].reimbursement.value, '0.00');
  assert.ok(r.education.perChild[0].ruleIds.includes('R-EDU-FREESTATE'));
  const m = calculate(synthScenario({ G: '0', family: fam, education: [{ memberId: 'K', tuition: '1000', freeStateLanguageSchoolAvailable: true, ministerDecision34: true }] }), synthData({}));
  assert.equal(m.education.perChild[0].reimbursement.status, 'unconfirmed');
  const noAge = calculate(synthScenario({ G: '0', family: [{ id: 'K', role: 'child', status: 'regular', age: null }], education: [{ memberId: 'K', tuition: '500' }] }), synthData({}));
  assert.equal(noAge.education.perChild[0].reimbursement.status, 'undetermined');
  assert.equal(noAge.remainder.value.status, 'undetermined');
});

test('remainder may be negative and is shown as is', () => {
  const r = calculate(synthScenario({ G: '20000', head: false }), synthData({}));
  assert.ok(r.remainder.value.value.startsWith('-'));
  assert.equal(r.remainder.value.status, 'calculated');
});

test('travel: own car = one ticket once; third country capped; vacation needs comparator', () => {
  const r = calculate(synthScenario({ G: '0', family: [{ id: 'F1', role: 'spouse', status: 'regular', age: 40 }], travel: [
    { kind: 'departure', personId: 'EMP', ownCar: true, comparableTicket: '250', actualCost: null },
    { kind: 'departure', personId: 'F1', ownCar: true, comparableTicket: '250', actualCost: null },
    { kind: 'recall', personId: 'EMP', route: 'third-country', actualCost: '700', comparableTicket: '400' },
    { kind: 'vacation', personId: 'F1', actualCost: '900', comparableTicket: null },
  ] }), synthData({}));
  const t = r.oneTimeReimbursements.travel.map((c) => [c.value, c.status]);
  assert.deepEqual(t, [['250.00', 'calculated'], ['0.00', 'calculated'], ['400.00', 'calculated'], [null, 'undetermined']]);
  assert.ok(r.assumptions.some((a) => a.openQuestion === 'OQ-31'));
});

test('extras: minister-decision categories are unconfirmed, not auto-approved', () => {
  const r = calculate(synthScenario({ G: '0', extras: [
    { category: 'vaccination', amount: '80', justification: 'x', ministerDecisionRequired: false },
    { category: 'early-termination-28', amount: '500', justification: 'x', ministerDecisionRequired: false },
    { category: 'visa', amount: '60', justification: '', ministerDecisionRequired: true },
  ] }), synthData({}));
  assert.deepEqual(r.oneTimeReimbursements.extras.map((c) => c.status), ['calculated', 'unconfirmed', 'unconfirmed']);
  assert.equal(r.totals.oneTimeConfirmed.value, '80.00');
  assert.equal(r.totals.oneTimePending.value, '560.00');
  assert.equal(r.completeness, 'partial');
});

test('settlement: no daily rate → undetermined but does not block completeness; pt 9 exclusion → 0', () => {
  const r = calculate(synthScenario({ C: 1, G: '0' }), synthData({}));
  assert.equal(r.oneTimeAllowances.settlement.status, 'undetermined');
  assert.equal(r.completeness, 'complete');
  const x = calculate(synthScenario({ C: 1, G: '0', settlement: { dailyRate: null, fx: null, exclusion9: 'd', transfer10: false } }), synthData({}));
  assert.equal(x.oneTimeAllowances.settlement.value, '0.00');
  const fx = calculate(synthScenario({ C: 1, G: '0', settlement: { dailyRate: { amount: '60', currency: 'USD', source: 't', sourceDate: '2026-01-01' }, fx: { rate: '0.9', date: '2027-01-01', source: 'NBG' }, exclusion9: null, transfer10: false } }), synthData({}));
  assert.equal(fx.oneTimeAllowances.settlement.currency, 'EUR');
  assert.equal(fx.oneTimeAllowances.settlement.value, '3564.00');
  assert.equal(fx.oneTimeAllowances.settlement.status, 'unconfirmed');
});

test('Vatican: K/E undetermined, insurance and baggage still resolved (P-8)', () => {
  const r = calculate({ schemaVersion: 1, missionId: 'M-A5-R37', position: { mode: 'annex2', entryId: 'A2-R6' }, status: { rentHead: 'not-head' }, rent: { amount: '1000' },
    employee: { age: 45 }, baggage: { kind: 'departure', previouslyUsed: '0', claims: [{ who: 'EMP', amount: '2000' }] } }, DATA);
  assert.equal(r.monthly.K.status, 'undetermined');
  assert.equal(r.completeness, 'incomplete');
  assert.equal(r.insurance.perPerson[0].annualCap.value, '1344.00');
  assert.equal(r.oneTimeReimbursements.baggage.reimbursable.value, '1650.00');
});

test('real data: Bari city row (E 21) beats Italy (E 22); Geneva records OQ-09; Odesa ≠ Kyiv insurance', () => {
  const base = { schemaVersion: 1, position: { mode: 'annex2', entryId: 'A2-R2' }, status: { rentHead: 'head' }, rent: { amount: '0' }, employee: { age: 42 } };
  const bari = calculate({ ...base, missionId: 'M-A5-R39' }, DATA);
  assert.equal(bari.monthly.E.value, '21');
  const gen = calculate({ ...base, missionId: 'M-A5-R35' }, DATA);
  assert.ok(gen.assumptions.some((a) => a.openQuestion === 'OQ-09'));
  const ins = (id) => calculate({ ...base, missionId: id, insurance: [{ personId: 'EMP', policyCost: '5000', alreadyReimbursed: '0' }] }, DATA).insurance.perPerson[0].reimbursable.value;
  assert.equal(ins('M-A6-R29'), '734.00');
  assert.equal(ins('M-A6-R26'), '1137.00');
});

test('validateScenario: rejects bad amounts, enums, dates, references and prototype keys', () => {
  assert.equal(validateScenario(emptyScenario(), DATA).ok, true);
  const bad = { ...emptyScenario(), missionId: 'M-NOPE', position: { mode: 'annex3', entryId: 'A2-R1' }, rent: { amount: '1,500.00', basis: 'x', changes: [{ from: '2027-02-30', amount: '-1' }] },
    family: [{ id: 'F1', role: 'cousin', status: 'regular', age: -1 }, { id: 'F1', role: 'child', status: 'regular' }],
    period: { mode: 'dates', start: '2027-05-01', end: '2027-04-01' }, insurance: [{ personId: 'ZZ', policyCost: 'abc' }] };
  const v = validateScenario(bad, DATA);
  assert.equal(v.ok, false);
  const codes = new Set(v.errors.map((e) => e.code));
  for (const c of ['MISSION_UNKNOWN', 'POSITION_MODE', 'AMOUNT_INVALID', 'ENUM', 'DATE_INVALID', 'AGE', 'MEMBER_ID_DUP', 'PERIOD_ORDER', 'PERSON_UNKNOWN']) assert.ok(codes.has(c), c);
  assert.ok(v.errors.every((e) => typeof e.message_ka === 'string' && e.path !== undefined));
  const proto = JSON.parse('{"schemaVersion":1,"__proto__":{"x":1}}');
  assert.ok(validateScenario(proto, DATA).errors.some((e) => e.code === 'FORBIDDEN_KEY'));
  assert.equal(validateScenario('<script>', DATA).ok, false);
  const r = calculate(bad, DATA);
  assert.ok(r.errors.length > 0, 'calculate reports validation errors instead of throwing');
});

test('lookup helpers: names, ISO, market location, currency, explicit no-data K', () => {
  const ms = listMissions(DATA);
  assert.equal(ms.length, 82);
  const ny = listMissions(DATA, { locationId: 'US-NEW-YORK' });
  assert.equal(ny.length, 2);
  assert.ok(listMissions(DATA, { query: 'Odesa' }).some((m) => m.id === 'M-A6-R29'));
  assert.ok(listMissions(DATA, { query: 'Odessa' }).some((m) => m.id === 'M-A6-R29'), 'alt names');
  const v = resolveMission(DATA, 'M-A5-R37');
  assert.equal(v.coefficient.status, 'no-normative-data');
  assert.equal(v.marketFallback.locationId, 'IT-ROME');
  assert.equal(v.marketFallback.matchStatus, 'nearest-city-fallback');
  const w = resolveMission(DATA, 'M-A6-R4');
  assert.equal(w.fundingCurrency, 'USD'); assert.equal(w.marketLocationId, 'US-WASHINGTON'); assert.equal(w.coefficient.k, '2.185');
  assert.equal(resolveMission(DATA, 'nope'), null);
  assert.ok(listCountries(DATA).some((c) => c.id === 'AT' && c.missionCount === 1));
  assert.ok(!listCountries(DATA).some((c) => c.id === 'RS'), 'Serbia has no mission');
  assert.ok(listLocations(DATA, 'US').length === 3);
  const prof = positionProfiles(DATA);
  assert.equal(prof.find((p) => p.id === 'annex2').entries.find((e) => e.id === 'A2-R1').suggestedRentHead, 'head');
  assert.equal(prof.find((p) => p.id === 'annex3').entries.every((e) => e.suggestedRentHead === 'not-head'), true);
  assert.equal(Object.keys(ROLES).length, 4); assert.ok(MEMBER_STATUSES.care); assert.ok(EXTRA_CATEGORIES.visa);
});
