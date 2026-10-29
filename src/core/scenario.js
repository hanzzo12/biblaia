// ScenarioV1: defaults and validation (contracts §2).
import { parseDecimalInput } from './decimal.js';
import { isValidDate, compareDates, daysInclusive } from './calendar.js';
import { ROLES, MEMBER_STATUSES, EXTRA_CATEGORIES, TRAVEL_KINDS, BAGGAGE_KINDS, SETTLEMENT_EXCLUSIONS, ADVANCE_KINDS, RENT_BASIS } from './enums.js';
import { getIndex } from './lookup.js';

export const SCENARIO_SCHEMA_VERSION = 1;
const MAX_TEXT = 500;
const MAX_ITEMS = 50;
const MAX_PERIOD_DAYS = 3660;

/** A fresh, empty scenario (all unknowns are null, never "0"). */
export function emptyScenario() {
  return {
    schemaVersion: SCENARIO_SCHEMA_VERSION,
    missionId: null,
    position: { mode: 'annex2', entryId: null },
    status: {
      rentHead: null, headBasis: null,
      actingHead201: { applies: false, actRef: null },
      adminManager202: { applies: false, actRef: null },
    },
    period: { mode: 'full-month' },
    family: [],
    rent: { amount: null, basis: 'actual', marketRef: null, changes: [] },
    education: [],
    insurance: [],
    employee: { age: null, birthDate: null },
    broker: null,
    baggage: null,
    settlement: { dailyRate: null, fx: null, exclusion9: null, transfer10: false },
    travel: [],
    advances: [],
    extras: [],
  };
}

/** A family member template. */
export function emptyFamilyMember(id, label = null) {
  return {
    id, label, role: 'child', status: 'regular', age: null, birthDate: null, from: null, to: null, presence: null,
    worksInSameMissionOrCity: false, supplementPaidToOtherEmployee: false, spousePostedInOtherCity: false,
    reimbursedElsewhere: { insurance: false, education: false, travel: false, baggage: false }, adultChildInSchool: false,
  };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Validate a scenario against the schema and the normative data.
 * Never throws. Unknown values are allowed to be null.
 * @returns {{ ok: boolean, errors: { path: string, code: string, message_ka: string }[] }}
 */
export function validateScenario(scenario, data) {
  const errors = [];
  const e = (path, code, message_ka) => errors.push({ path, code, message_ka });
  if (!isObj(scenario)) { e('', 'NOT_OBJECT', 'სცენარი უნდა იყოს JSON ობიექტი.'); return { ok: false, errors }; }
  if (hasDangerousKeys(scenario)) e('', 'FORBIDDEN_KEY', 'სცენარი შეიცავს დაუშვებელ გასაღებს (__proto__/constructor/prototype).');
  if (scenario.schemaVersion !== SCENARIO_SCHEMA_VERSION) e('schemaVersion', 'SCHEMA_VERSION', `სქემის ვერსია უნდა იყოს ${SCENARIO_SCHEMA_VERSION}.`);
  const ix = data ? getIndex(data) : null;

  const amount = (path, v) => {
    if (v === null || v === undefined) return;
    if (typeof v !== 'string') { e(path, 'AMOUNT_TYPE', 'თანხა უნდა იყოს ტექსტური რიცხვი ან null.'); return; }
    const p = parseDecimalInput(v);
    if (!p.ok) e(path, 'AMOUNT_INVALID', p.error_ka);
  };
  const date = (path, v, required = false) => {
    if (v === null || v === undefined) { if (required) e(path, 'DATE_REQUIRED', 'თარიღი აუცილებელია.'); return; }
    if (!isValidDate(v)) e(path, 'DATE_INVALID', 'თარიღი უნდა იყოს ფორმატით YYYY-MM-DD (რეალური კალენდარული დღე).');
  };
  const text = (path, v) => {
    if (v === null || v === undefined) return;
    if (typeof v !== 'string') e(path, 'TEXT_TYPE', 'მოსალოდნელია ტექსტი.');
    else if (v.length > MAX_TEXT) e(path, 'TEXT_TOO_LONG', `ტექსტი არ უნდა აღემატებოდეს ${MAX_TEXT} სიმბოლოს.`);
  };
  const oneOf = (path, v, allowed, nullable = true) => {
    if ((v === null || v === undefined) && nullable) return;
    if (!allowed.includes(v)) e(path, 'ENUM', `დაუშვებელი მნიშვნელობა: ${String(v).slice(0, 40)}`);
  };
  const bool = (path, v) => { if (v !== undefined && v !== null && typeof v !== 'boolean') e(path, 'BOOL', 'მოსალოდნელია true/false.'); };
  const list = (path, v) => {
    if (v === null || v === undefined) return [];
    if (!Array.isArray(v)) { e(path, 'LIST', 'მოსალოდნელია სია.'); return []; }
    if (v.length > MAX_ITEMS) e(path, 'LIST_TOO_LONG', `სიაში არაუმეტეს ${MAX_ITEMS} ჩანაწერი.`);
    return v;
  };

  // mission & position
  if (scenario.missionId !== null && scenario.missionId !== undefined) {
    if (typeof scenario.missionId !== 'string') e('missionId', 'MISSION_TYPE', 'დაწესებულების ID უნდა იყოს ტექსტი.');
    else if (ix && !ix.missions.has(scenario.missionId)) e('missionId', 'MISSION_UNKNOWN', 'დაწესებულება ნორმატიულ მონაცემებში არ მოიძებნა.');
  }
  const pos = scenario.position;
  if (pos !== undefined && pos !== null) {
    if (!isObj(pos)) e('position', 'POSITION', 'თანამდებობის ბლოკი უნდა იყოს ობიექტი.');
    else {
      oneOf('position.mode', pos.mode, ['annex2', 'annex3'], false);
      if (pos.entryId !== null && pos.entryId !== undefined) {
        const entry = ix?.positions.get(pos.entryId);
        if (ix && !entry) e('position.entryId', 'POSITION_UNKNOWN', 'თანამდებობა დანართ №2/№3-ში არ მოიძებნა.');
        else if (entry && entry.mode !== pos.mode) e('position.entryId', 'POSITION_MODE', 'თანამდებობა არჩეულ რეჟიმს (№2/№3) არ ეკუთვნის.');
      }
      text('position.orderRef37', pos.orderRef37);
    }
  }
  const st = scenario.status;
  if (st !== undefined && st !== null) {
    if (!isObj(st)) e('status', 'STATUS', 'სტატუსის ბლოკი უნდა იყოს ობიექტი.');
    else {
      oneOf('status.rentHead', st.rentHead, ['head', 'not-head']);
      oneOf('status.headBasis', st.headBasis, ['institution-head', 'acting-head-20-1']);
      for (const k of ['actingHead201', 'adminManager202']) {
        if (st[k] === undefined || st[k] === null) continue;
        if (!isObj(st[k])) { e(`status.${k}`, 'STATUS', 'მოსალოდნელია ობიექტი.'); continue; }
        bool(`status.${k}.applies`, st[k].applies);
        text(`status.${k}.actRef`, st[k].actRef);
        date(`status.${k}.from`, st[k].from); date(`status.${k}.to`, st[k].to);
        if (isValidDate(st[k].from) && isValidDate(st[k].to) && compareDates(st[k].to, st[k].from) < 0) e(`status.${k}.to`, 'RANGE_ORDER', '„მდე“ თარიღი „დან“-ზე ადრეა.');
      }
      if (st.adminManager202?.applies && pos?.entryId && pos.entryId !== 'A2-R5') e('status.adminManager202', 'POS_202_ENTRY', 'პ.20² ვრცელდება მხოლოდ ადმინისტრაციულ მენეჯერზე (დანართი №2, სტრ.5).');
    }
  }
  // period
  const per = scenario.period;
  if (per !== undefined && per !== null) {
    if (!isObj(per)) e('period', 'PERIOD', 'პერიოდი უნდა იყოს ობიექტი.');
    else {
      oneOf('period.mode', per.mode, ['full-month', 'dates'], false);
      if (per.month !== undefined && per.month !== null && !(typeof per.month === 'string' && isValidDate(`${per.month}-01`))) e('period.month', 'MONTH_INVALID', 'თვე — ფორმატით YYYY-MM.');
      if (per.mode === 'dates') {
        date('period.start', per.start, true);
        date('period.end', per.end, true);
        if (isValidDate(per.start) && isValidDate(per.end)) {
          if (compareDates(per.end, per.start) < 0) e('period.end', 'PERIOD_ORDER', 'დასრულების თარიღი დაწყებაზე ადრეა.');
          else if (daysInclusive(per.start, per.end) > MAX_PERIOD_DAYS) e('period.end', 'PERIOD_TOO_LONG', 'პერიოდი არ უნდა აღემატებოდეს 10 წელს.');
        }
      }
    }
  }
  // family
  const ids = new Set();
  list('family', scenario.family).forEach((m, i) => {
    const p = `family[${i}]`;
    if (!isObj(m)) { e(p, 'MEMBER', 'ოჯახის წევრი უნდა იყოს ობიექტი.'); return; }
    if (typeof m.id !== 'string' || !m.id || m.id === 'EMP' || m.id.length > 40) e(`${p}.id`, 'MEMBER_ID', 'ოჯახის წევრის ID სავალდებულოა (არა „EMP“).');
    else if (ids.has(m.id)) e(`${p}.id`, 'MEMBER_ID_DUP', 'ოჯახის წევრის ID მეორდება.');
    else ids.add(m.id);
    text(`${p}.label`, m.label);
    oneOf(`${p}.role`, m.role, Object.keys(ROLES), false);
    oneOf(`${p}.status`, m.status, Object.keys(MEMBER_STATUSES), false);
    if (m.age !== null && m.age !== undefined && !(Number.isInteger(m.age) && m.age >= 0 && m.age <= 120)) e(`${p}.age`, 'AGE', 'ასაკი — მთელი რიცხვი 0–120 ან ცარიელი.');
    date(`${p}.birthDate`, m.birthDate); date(`${p}.from`, m.from); date(`${p}.to`, m.to);
    if (isValidDate(m.from) && isValidDate(m.to) && compareDates(m.to, m.from) < 0) e(`${p}.to`, 'RANGE_ORDER', '„მდე“ თარიღი „დან“-ზე ადრეა.');
    if (m.presence !== null && m.presence !== undefined) {
      list(`${p}.presence`, m.presence).forEach((r, j) => {
        if (!isObj(r)) { e(`${p}.presence[${j}]`, 'RANGE', 'მოსალოდნელია { from, to }.'); return; }
        date(`${p}.presence[${j}].from`, r.from, true); date(`${p}.presence[${j}].to`, r.to, true);
        if (isValidDate(r.from) && isValidDate(r.to) && compareDates(r.to, r.from) < 0) e(`${p}.presence[${j}].to`, 'RANGE_ORDER', 'ყოფნის დასრულება დაწყებაზე ადრეა.');
      });
    }
    for (const k of ['worksInSameMissionOrCity', 'supplementPaidToOtherEmployee', 'spousePostedInOtherCity', 'adultChildInSchool', 'hostStateConsent']) bool(`${p}.${k}`, m[k]);
    if (m.reimbursedElsewhere !== undefined && m.reimbursedElsewhere !== null) {
      if (!isObj(m.reimbursedElsewhere)) e(`${p}.reimbursedElsewhere`, 'OBJECT', 'მოსალოდნელია ობიექტი.');
      else for (const k of ['insurance', 'education', 'travel', 'baggage']) bool(`${p}.reimbursedElsewhere.${k}`, m.reimbursedElsewhere[k]);
    }
  });
  const person = (path, v, allowEmp = true) => {
    if (v === 'EMP' && allowEmp) return;
    if (!ids.has(v)) e(path, 'PERSON_UNKNOWN', 'პირი (EMP ან ოჯახის წევრის ID) არ მოიძებნა.');
  };
  // rent
  const rent = scenario.rent;
  if (rent !== undefined && rent !== null) {
    if (!isObj(rent)) e('rent', 'RENT', 'ქირის ბლოკი უნდა იყოს ობიექტი.');
    else {
      amount('rent.amount', rent.amount);
      oneOf('rent.basis', rent.basis, Object.keys(RENT_BASIS));
      list('rent.changes', rent.changes).forEach((c, i) => {
        if (!isObj(c)) { e(`rent.changes[${i}]`, 'RENT_CHANGE', 'მოსალოდნელია { from, amount }.'); return; }
        date(`rent.changes[${i}].from`, c.from, true);
        amount(`rent.changes[${i}].amount`, c.amount);
      });
    }
  }
  list('education', scenario.education).forEach((x, i) => {
    const p = `education[${i}]`;
    if (!isObj(x)) { e(p, 'EDU', 'მოსალოდნელია ობიექტი.'); return; }
    person(`${p}.memberId`, x.memberId, false);
    for (const k of ['tuition', 'registration', 'transport', 'meals', 'holidayExtraContract']) amount(`${p}.${k}`, x[k]);
    bool(`${p}.freeStateLanguageSchoolAvailable`, x.freeStateLanguageSchoolAvailable);
    bool(`${p}.ministerDecision34`, x.ministerDecision34);
    bool(`${p}.paidSchoolLanguageSameAsState`, x.paidSchoolLanguageSameAsState);
    if (x.schoolYear !== undefined && x.schoolYear !== null) {
      if (!isObj(x.schoolYear)) e(`${p}.schoolYear`, 'RANGE', 'მოსალოდნელია { from, to }.');
      else { date(`${p}.schoolYear.from`, x.schoolYear.from, true); date(`${p}.schoolYear.to`, x.schoolYear.to, true); }
    }
  });
  list('insurance', scenario.insurance).forEach((x, i) => {
    const p = `insurance[${i}]`;
    if (!isObj(x)) { e(p, 'INS', 'მოსალოდნელია ობიექტი.'); return; }
    person(`${p}.personId`, x.personId);
    amount(`${p}.policyCost`, x.policyCost); amount(`${p}.alreadyReimbursed`, x.alreadyReimbursed);
    date(`${p}.policyStart`, x.policyStart); date(`${p}.policyEnd`, x.policyEnd);
  });
  const emp = scenario.employee;
  if (isObj(emp)) {
    if (emp.age !== null && emp.age !== undefined && !(Number.isInteger(emp.age) && emp.age >= 15 && emp.age <= 100)) e('employee.age', 'AGE', 'მოსამსახურის ასაკი — მთელი რიცხვი 15–100 ან ცარიელი.');
    date('employee.birthDate', emp.birthDate);
  }
  const br = scenario.broker;
  if (br !== undefined && br !== null) {
    if (!isObj(br)) e('broker', 'BROKER', 'მოსალოდნელია ობიექტი.');
    else {
      amount('broker.fee', br.fee); date('broker.serviceDate', br.serviceDate); date('broker.rotationStartDate', br.rotationStartDate);
      for (const k of ['alreadyReimbursed', 'documented', 'specialDecision81']) bool(`broker.${k}`, br[k]);
    }
  }
  const bg = scenario.baggage;
  if (bg !== undefined && bg !== null) {
    if (!isObj(bg)) e('baggage', 'BAGGAGE', 'მოსალოდნელია ობიექტი.');
    else {
      oneOf('baggage.kind', bg.kind, Object.keys(BAGGAGE_KINDS), false);
      amount('baggage.previouslyUsed', bg.previouslyUsed);
      bool('baggage.callbackAlreadyReimbursed', bg.callbackAlreadyReimbursed);
      list('baggage.claims', bg.claims).forEach((c, i) => {
        if (!isObj(c)) { e(`baggage.claims[${i}]`, 'CLAIM', 'მოსალოდნელია { who, amount }.'); return; }
        person(`baggage.claims[${i}].who`, c.who);
        amount(`baggage.claims[${i}].amount`, c.amount);
      });
    }
  }
  const se = scenario.settlement;
  if (se !== undefined && se !== null) {
    if (!isObj(se)) e('settlement', 'SETTLEMENT', 'მოსალოდნელია ობიექტი.');
    else {
      if (se.dailyRate !== null && se.dailyRate !== undefined) {
        if (!isObj(se.dailyRate)) e('settlement.dailyRate', 'RATE', 'მოსალოდნელია { amount, currency, source, sourceDate }.');
        else {
          amount('settlement.dailyRate.amount', se.dailyRate.amount);
          if (!/^[A-Z]{3}$/.test(se.dailyRate.currency || '')) e('settlement.dailyRate.currency', 'CURRENCY', 'ვალუტა — სამასოიანი ISO კოდი (მაგ. EUR).');
          text('settlement.dailyRate.source', se.dailyRate.source); date('settlement.dailyRate.sourceDate', se.dailyRate.sourceDate);
          bool('settlement.dailyRate.confirmed', se.dailyRate.confirmed);
        }
      }
      if (se.fx !== null && se.fx !== undefined) {
        if (!isObj(se.fx)) e('settlement.fx', 'FX', 'მოსალოდნელია { rate, date, source }.');
        else { amount('settlement.fx.rate', se.fx.rate); date('settlement.fx.date', se.fx.date); text('settlement.fx.source', se.fx.source); }
      }
      oneOf('settlement.exclusion9', se.exclusion9, Object.keys(SETTLEMENT_EXCLUSIONS));
      date('settlement.postingDate', se.postingDate);
      bool('settlement.transfer10', se.transfer10);
    }
  }
  list('travel', scenario.travel).forEach((t, i) => {
    const p = `travel[${i}]`;
    if (!isObj(t)) { e(p, 'TRAVEL', 'მოსალოდნელია ობიექტი.'); return; }
    oneOf(`${p}.kind`, t.kind, Object.keys(TRAVEL_KINDS), false);
    person(`${p}.personId`, t.personId);
    amount(`${p}.actualCost`, t.actualCost); amount(`${p}.comparableTicket`, t.comparableTicket);
    text(`${p}.route`, t.route); bool(`${p}.ownCar`, t.ownCar);
    date(`${p}.date`, t.date); bool(`${p}.interruptedLeave`, t.interruptedLeave); bool(`${p}.callbackAlreadyReimbursed`, t.callbackAlreadyReimbursed);
  });
  list('advances', scenario.advances).forEach((a, i) => {
    const p = `advances[${i}]`;
    if (!isObj(a)) { e(p, 'ADVANCE', 'მოსალოდნელია ობიექტი.'); return; }
    oneOf(`${p}.kind`, a.kind, Object.keys(ADVANCE_KINDS), false);
    amount(`${p}.amount`, a.amount); date(`${p}.issueDate`, a.issueDate);
    if (!(Number.isInteger(a.months) && a.months >= 1 && a.months <= 120)) e(`${p}.months`, 'MONTHS', 'თვეების რაოდენობა — მთელი რიცხვი 1–120.');
    bool(`${p}.ministerOrder22`, a.ministerOrder22);
  });
  list('extras', scenario.extras).forEach((x, i) => {
    const p = `extras[${i}]`;
    if (!isObj(x)) { e(p, 'EXTRA', 'მოსალოდნელია ობიექტი.'); return; }
    oneOf(`${p}.category`, x.category, Object.keys(EXTRA_CATEGORIES), false);
    amount(`${p}.amount`, x.amount); text(`${p}.justification`, x.justification); bool(`${p}.ministerDecisionRequired`, x.ministerDecisionRequired);
  });
  const rt = scenario.retention19;
  if (rt !== undefined && rt !== null) {
    if (!isObj(rt)) e('retention19', 'RETENTION', 'მოსალოდნელია { applies, from, to, decisionRef }.');
    else { bool('retention19.applies', rt.applies); date('retention19.from', rt.from); date('retention19.to', rt.to); text('retention19.decisionRef', rt.decisionRef); }
  }
  return { ok: errors.length === 0, errors };
}

function hasDangerousKeys(o, depth = 0) {
  if (depth > 8 || o === null || typeof o !== 'object') return false;
  for (const k of Object.keys(o)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return true;
    if (hasDangerousKeys(o[k], depth + 1)) return true;
  }
  return false;
}
