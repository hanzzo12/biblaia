// calculate(scenario, data) → CalculationResult (contracts §3). Pure and synchronous; never throws on
// incomplete input. Exact rational arithmetic; display rounding only (P-1).
import { R, ZERO, add, sub, mul, div, min, max, sum, isZero, gt, toFixed2, toExactString, toDecimalString } from './rational.js';
import { parseDecimalInput } from './decimal.js';
import { isValidDate, compareDates, addDays, addMonths, monthKey, monthEnd, segmentPeriod, ageOn, withinOpen, overlapDays, daysInclusive, daysInMonthOf } from './calendar.js';
import { getIndex, dailyRateForMission } from './lookup.js';
import { emptyScenario, validateScenario, SCENARIO_SCHEMA_VERSION } from './scenario.js';
import { DEPENDENT_STATUSES, EXTRA_RULES, EXTRA_CATEGORIES, SETTLEMENT_EXCLUSIONS, ROLES } from './enums.js';
import {
  monthlyRate, prorate, educationReimbursement, adultChildEligible, insuranceBand, insuranceReimbursement, brokerWindow, brokerAmount,
  baggageReimbursement, settlementAmount, advanceSchedule,
} from './formulas.js';

export { SCENARIO_SCHEMA_VERSION };

const RANK = { calculated: 0, not_applicable: 0, scenario: 1, unconfirmed: 2, undetermined: 3 };
const worst = (...ss) => ss.filter(Boolean).reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'calculated');
const amt = (v) => { const p = parseDecimalInput(v); return p.ok ? p.value : null; };

function newCtx() {
  const warnings = [], errors = [], assumptions = [], missingInputs = [];
  const seen = new Set();
  const once = (k) => (seen.has(k) ? false : (seen.add(k), true));
  return {
    warnings, errors, assumptions, missingInputs,
    warn: (code, message_ka, ruleIds = [], path = null, severity = 'warning') => { if (once(`w:${code}:${path}`)) warnings.push({ code, severity, message_ka, ruleIds, path }); },
    info: (code, message_ka, ruleIds = [], path = null) => { if (once(`w:${code}:${path}`)) warnings.push({ code, severity: 'info', message_ka, ruleIds, path }); },
    error: (code, message_ka, ruleIds = [], path = null) => { if (once(`e:${code}:${path}`)) errors.push({ code, severity: 'error', message_ka, ruleIds, path }); },
    assume: (code, message_ka, ruleIds, openQuestion = null) => { if (once(`a:${code}`)) assumptions.push({ code, message_ka, ruleIds, openQuestion }); },
    missing: (path, message_ka) => { if (once(`m:${path}`)) missingInputs.push({ path, message_ka }); },
  };
}

/**
 * Component builder. value: Rational | null | raw string (kind 'raw': shown as in source).
 */
function comp(id, category, label_ka, value, currency, status, reason_ka, ruleIds, inputsUsed = {}, kind = 'money') {
  let v = null, exact = null;
  if (value != null && status !== 'undetermined') {
    if (kind === 'raw') { v = String(value); exact = String(value); }
    else { const r = R(value); v = toFixed2(r); exact = toDecimalString(r) ?? toExactString(r); }
  }
  if (v === null && status !== 'not_applicable') status = 'undetermined';
  return { id, category, label_ka, value: v, exact, currency: kind === 'raw' ? null : currency, status, reason_ka: reason_ka || '', ruleIds, inputsUsed };
}
const rat = (c) => (c && c.exact != null ? fromExact(c.exact) : null);
function fromExact(s) {
  const m = /^(-?\d+)\/(\d+)$/.exec(s);
  return m ? div(m[1], m[2]) : R(s);
}
const str = (r) => (r == null ? null : toDecimalString(r) ?? toExactString(r));

/**
 * @param {object} scenarioIn ScenarioV1 (may be partial)
 * @param {object} data normative data (src/data/normative-data.json)
 */
export function calculate(scenarioIn, data) {
  const ctx = newCtx();
  const raw = scenarioIn && typeof scenarioIn === 'object' ? scenarioIn : {};
  const base = emptyScenario();
  const sc = { ...base, ...raw };
  for (const k of ['position', 'status', 'rent', 'employee', 'settlement']) sc[k] = { ...base[k], ...(raw[k] || {}) };
  sc.status.actingHead201 = { ...base.status.actingHead201, ...(sc.status.actingHead201 || {}) };
  sc.status.adminManager202 = { ...base.status.adminManager202, ...(sc.status.adminManager202 || {}) };
  for (const k of ['family', 'education', 'insurance', 'travel', 'advances', 'extras']) sc[k] = Array.isArray(raw[k]) ? raw[k] : [];
  sc.rent.changes = Array.isArray(sc.rent.changes) ? sc.rent.changes : [];

  const v = validateScenario(raw, data);
  for (const e of v.errors) ctx.error(e.code, e.message_ka, [], e.path);

  const ix = getIndex(data);
  const param = (id) => ix.params.get(id)?.value ?? null;

  // ---------------------------------------------------------------- mission, currency
  const mission = sc.missionId ? ix.missions.get(sc.missionId) || null : null;
  if (!sc.missionId) ctx.missing('missionId', 'აირჩიეთ დაწესებულება (ქვეყანა/ქალაქი).');
  const cur = mission?.fundingCurrency ?? null;
  const location = mission ? ix.locations.get(mission.locationId) : null;
  const H = cur ? ix.base.get(cur)?.amount ?? null : null;
  const kRow = mission?.costCoefficientId ? ix.k.get(mission.costCoefficientId) : null;
  if (mission && !kRow) {
    ctx.warn('K_UNDETERMINED', 'ამ დაწესებულებისთვის დანართ №4-ში K/E სტრიქონი არ არის — K, E და ყოველთვიური თანხა დაუდგენელია.', ['R-K-001'], 'missionId');
    ctx.assume('K_NO_ROW', 'დანართ №4-ში შესაბამისი სტრიქონის არქონისას ახლომდებარე ქვეყნის/ქალაქის K არ გამოიყენება (P-8).', ['R-K-001'], 'OQ-09');
  }
  const embassyCities = new Set((data.missions || []).filter((m) => m.countryId === mission?.countryId && m.type === 'embassy').map((m) => m.locationId));
  if (kRow && mission.costCoefficientBasis === 'country-row' && !embassyCities.has(mission.locationId)) {
    ctx.assume('K_COUNTRY_ROW_CITY', `ქალაქს (${location?.name_ka ?? ''}) დანართ №4-ში საკუთარი სტრიქონი არ აქვს; გამოყენებულია ქვეყნის სტრიქონი №${kRow.annex4Row} (P-7).`, ['R-K-001'], 'OQ-09');
  }

  // ---------------------------------------------------------------- position (A)
  const mode = sc.position.mode === 'annex3' ? 'annex3' : 'annex2';
  let entry = sc.position.entryId ? ix.positions.get(sc.position.entryId) || null : null;
  if (entry && entry.mode !== mode) entry = null;
  if (!sc.position.entryId) ctx.missing('position.entryId', 'აირჩიეთ თანამდებობა.');
  const baseStatus = mode === 'annex3' && !sc.position.orderRef37 ? 'scenario' : 'calculated';
  const baseRules = [mode === 'annex3' ? 'R-POS-A3' : 'R-POS-A2', 'R-POS-20'];
  if (mode === 'annex3') {
    ctx.info('POS_A3_ORDER', 'დანართ №3-ის რეჟიმი გამოიყენება მხოლოდ მინისტრის ბრძანებით განსაზღვრულ შემთხვევაში (პ.37); ამ პერიოდში შრომის ანაზღაურება წყდება (პ.39).', ['R-POS-A3'], 'position.mode');
    if (!sc.position.orderRef37) ctx.warn('POS_A3_NO_ORDER', 'დანართ №3-ის რეჟიმი: მინისტრის ბრძანების რეკვიზიტი (პ.37) მითითებული არ არის — შედეგი სცენარია.', ['R-POS-A3'], 'position.orderRef37');
  }
  const s201 = sc.status.actingHead201, s202 = sc.status.adminManager202;
  if (s201.applies && s202.applies) ctx.warn('POS_BOTH_SPECIAL', 'პ.20¹ და პ.20² ერთდროულად არის მონიშნული; გამოიყენება პ.20¹.', ['R-POS-20-1', 'R-POS-20-2'], 'status');
  // the special position (20¹ / 20²) that may apply, or null
  let special = null;
  if (s201.applies) {
    if (mode !== 'annex2') ctx.warn('POS_201_MODE', 'პ.20¹ ეხება დიპლომატიური წარმომადგენლობის მოსამსახურეს (დანართი №2).', ['R-POS-20-1'], 'status.actingHead201');
    else if (!s201.actRef) ctx.warn('POS_201_ACT', 'პ.20¹: ხელმძღვანელის მაჩვენებელი გამოიყენება მხოლოდ მინისტრის გადაწყვეტილების რეკვიზიტის მითითებით; A არ შეცვლილა.', ['R-POS-20-1'], 'status.actingHead201.actRef');
    else {
      special = { entry: ix.positions.get('A2-R1'), from: s201.from ?? null, to: s201.to ?? null, rules: ['R-POS-20-1', 'R-POS-A2'], path: 'status.actingHead201' };
      ctx.assume('POS_201', 'პ.20¹: მოვალეობის შემსრულებელს A = დანართი №2 სტრ.1 (100%) მინისტრის აქტის საფუძველზე, მხოლოდ შესრულების პერიოდში; ქირისა და საკომისიოს ხელმძღვანელის წესის გავრცელება — ინტერპრეტაცია (P-6).', ['R-POS-20-1'], 'OQ-11');
    }
  } else if (s202.applies) {
    if (mode !== 'annex2') ctx.warn('POS_202_MODE', 'პ.20² ეხება დანართ №2-ის ადმინისტრაციულ მენეჯერს.', ['R-POS-20-2'], 'status.adminManager202');
    else if (sc.position.entryId !== 'A2-R5') ctx.error('POS_202_ENTRY', 'პ.20² ვრცელდება მხოლოდ ადმინისტრაციულ მენეჯერზე (დანართი №2, სტრ.5); A არ შეცვლილა.', ['R-POS-20-2'], 'status.adminManager202');
    else if (!s202.actRef) ctx.warn('POS_202_ACT', 'პ.20²: დანართ №2-ის სტრ.3 (75%) გამოიყენება მინისტრის ბრძანების მითითებით; A არ შეცვლილა.', ['R-POS-20-2'], 'status.adminManager202.actRef');
    else {
      special = { entry: ix.positions.get('A2-R3'), from: s202.from ?? null, to: s202.to ?? null, rules: ['R-POS-20-2', 'R-POS-A2'], path: 'status.adminManager202' };
      ctx.info('POS_202', 'პ.20²: მოვალეობის შესრულების პერიოდში A = დანართი №2 სტრ.3 (75%); ხელმძღვანელობას არ ნიშნავს.', ['R-POS-20-2'], 'status.adminManager202');
    }
  }
  /** A for a date (dates mode) or for the full month (date = null). */
  function positionAt(date) {
    const base = { A: entry?.percent ?? null, status: baseStatus, rules: baseRules, entry };
    if (!special) return base;
    const sp = { A: special.entry?.percent ?? null, rules: special.rules, entry: special.entry };
    if (date) {
      if (special.from || special.to) return withinOpen(date, special.from, special.to) ? { ...sp, status: baseStatus } : base;
      ctx.warn('POS_SPECIAL_PERIOD', 'მიუთითეთ მოვალეობის შესრულების პერიოდი (დან/მდე); მის გარეშე სპეციალური მაჩვენებელი სცენარია.', special.rules, `${special.path}.from`);
      return { ...sp, status: 'scenario' };
    }
    const mon = sc.period.month && isValidDate(`${sc.period.month}-01`) ? sc.period.month : null;
    if (mon && special.from && special.to && compareDates(special.from, `${mon}-01`) <= 0 && compareDates(special.to, monthEnd(`${mon}-01`)) >= 0) return { ...sp, status: baseStatus };
    if (mon && ((special.from && compareDates(special.from, monthEnd(`${mon}-01`)) > 0) || (special.to && compareDates(special.to, `${mon}-01`) < 0))) return base;
    ctx.warn('POS_SPECIAL_PERIOD', 'სრული თვის რეჟიმში სპეციალური მაჩვენებელი (პ.20¹/20²) დადასტურებულია მხოლოდ მაშინ, როცა შესრულების პერიოდი მთელ თვეს (period.month) ფარავს; სხვა შემთხვევაში — სცენარი ან თარიღების რეჟიმი.', special.rules, `${special.path}.from`);
    return { ...sp, status: 'scenario' };
  }

  // ---------------------------------------------------------------- head status
  const head = sc.status.rentHead === 'head' ? true : sc.status.rentHead === 'not-head' ? false : null;
  const actingHead = s201.applies || sc.status.headBasis === 'acting-head-20-1';
  let rentHeadStatus = 'calculated', brokerHeadStatus = 'calculated';
  if (head) {
    if (actingHead) {
      rentHeadStatus = brokerHeadStatus = 'scenario';
      ctx.assume('HEAD_ACTING', 'მოვალეობის შემსრულებელზე ქირისა და საკომისიოს ხელმძღვანელის წესი (80%) — სცენარი (P-6).', ['R-POS-20-1', 'R-HEAD-RENT'], 'OQ-11');
    } else if (mode === 'annex3') {
      rentHeadStatus = brokerHeadStatus = 'scenario';
      ctx.warn('HEAD_ANNEX3', 'დანართ №3-ის რეჟიმში ხელმძღვანელის სტატუსი არ შემოთავაზდება; ხელმძღვანელის წესი სცენარად ჩანს.', ['R-HEAD-RENT', 'R-POS-A3'], 'status.rentHead');
    } else if (entry?.rowNo === 2) {
      rentHeadStatus = 'scenario';
      ctx.assume('HEAD_CONSULAR', 'საკონსულო დაწესებულების ხელმძღვანელი: საკომისიოს 80% პირდაპირ (პ.8); ქირის 80% — სცენარი (P-5).', ['R-HEAD-RENT', 'R-BROKER-001'], 'OQ-10');
    } else if (entry && entry.rowNo !== 1) {
      rentHeadStatus = brokerHeadStatus = 'scenario';
      ctx.warn('HEAD_UNUSUAL', 'ხელმძღვანელის სტატუსი მონიშნულია თანამდებობაზე, რომელიც ჩვეულებრივ დაწესებულებას არ ხელმძღვანელობს — გადაამოწმეთ.', ['R-HEAD-RENT'], 'status.rentHead');
    }
  }

  // ---------------------------------------------------------------- family rights
  const datesMode = sc.period.mode === 'dates' && isValidDate(sc.period.start) && isValidDate(sc.period.end) && compareDates(sc.period.end, sc.period.start) >= 0;
  const refDate = datesMode ? sc.period.start : null;
  const memberAge = (m, onDate = refDate) => {
    if (Number.isInteger(m?.age)) return m.age;
    if (m?.birthDate && onDate) {
      ctx.assume('AGE_FROM_BIRTHDATE', 'ასაკი გამოთვლილია დაბადების თარიღიდან პერიოდის/პოლისის დაწყების დღისთვის (P-10).', ['R-INS-001'], 'OQ-08');
      return ageOn(m.birthDate, onDate);
    }
    return null;
  };
  const isDep = (m) => DEPENDENT_STATUSES.includes(m.status);
  const right = (value, reason_ka, ruleIds, scenario = false) => (scenario ? { value, reason_ka, ruleIds, status: 'scenario' } : { value, reason_ka, ruleIds });
  const periodMonth = !datesMode && sc.period.month && isValidDate(`${sc.period.month}-01`) ? `${sc.period.month}-01` : null;

  /** monthly supplement right on a date (dates mode) or for the full month (date = null). */
  function supplementRight(m, date) {
    if (date && !withinOpen(date, m.from, m.to)) return right(false, 'ამ დღეებში ოჯახის შემადგენლობაში არ არის (დ1 მ.4 პ.5).', ['R-PRORATE-CHANGE']);
    if (m.supplementPaidToOtherEmployee) return right(false, 'დანამატს იღებს ოჯახის სხვა მოსამსახურე (დ1 მ.4 პ.1–2).', ['R-FAM-SAMEPOST', 'R-FAM-DIFFCITY']);
    if (m.role === 'spouse' && m.spousePostedInOtherCity) return right(false, 'მეუღლე სხვა ქალაქში/ქვეყანაშია მივლინებული — მეუღლეზე დანამატი არ გაიცემა (დ1 მ.4 პ.2).', ['R-FAM-DIFFCITY']);
    if (m.worksInSameMissionOrCity) return right(false, 'ამავე ან ადგილსამყოფელ ქალაქში მოსამსახურეა/მივლინებულია (დ1 მ.4 პ.3).', ['R-FAM-EMPLOYED']);
    if (isDep(m)) {
      if (!Array.isArray(m.presence)) return right(null, 'მხარდაჭერის მიმღებზე/მეურვეობის ან მზრუნველობის ქვეშ მყოფზე დანამატი მხოლოდ ქვეყანაში ყოფნის დღეებზე — ყოფნის თარიღები უცნობია.', ['R-FAM-DEPENDENT-PRESENCE']);
      if (date) {
        const present = overlapDays(date, date, m.presence) === 1;
        return right(present, present ? 'ადგილსამყოფელ ქვეყანაშია (ჩამოსვლისა და წასვლის დღეების ჩათვლით).' : 'ამ დღეებში ადგილსამყოფელ ქვეყანაში არ არის.', ['R-FAM-DEPENDENT-PRESENCE']);
      }
      if (!m.presence.length) return right(false, 'ადგილსამყოფელ ქვეყანაში ყოფნის პერიოდი არ არის — დანამატი არ გაიცემა.', ['R-FAM-DEPENDENT-PRESENCE']);
      if (periodMonth) {
        const days = overlapDays(periodMonth, monthEnd(periodMonth), m.presence), dim = daysInMonthOf(periodMonth);
        if (days === dim) return right(true, 'ადგილსამყოფელ ქვეყანაშია მთელი თვე.', ['R-FAM-DEPENDENT-PRESENCE']);
        if (days === 0) return right(false, 'ამ თვეში ადგილსამყოფელ ქვეყანაში არ არის.', ['R-FAM-DEPENDENT-PRESENCE']);
      }
      ctx.warn('DEP_FULL_MONTH', 'დამოკიდებული წევრის ყოფნა მთელ თვეს არ ფარავს ან თვე უცნობია — სრული თვის შედეგი სცენარია; ზუსტი დღეებისთვის აირჩიეთ თარიღების რეჟიმი.', ['R-FAM-DEPENDENT-PRESENCE'], `family.${m.id}.presence`);
      return right(true, 'ყოფნა ნაწილობრივია/თვე უცნობია — სცენარი (მთელი თვე).', ['R-FAM-DEPENDENT-PRESENCE'], true);
    }
    if (m.role === 'other') {
      ctx.assume('FAMILY_MEMBER_OTHER', '„ოჯახის სხვა წევრი“ დანამატში ითვლება; „ოჯახის წევრის“ ცნება მოწოდებულ ტექსტში განსაზღვრული არ არის.', ['R-D-C', 'R-FAM-ROLES'], 'OQ-22');
    }
    return right(true, 'ოჯახის წევრი — დანამატი Q = 7% (დ1 მ.3ბ).', ['R-D-C']);
  }
  function memberRights(m) {
    const age = memberAge(m);
    if (m.supplementPaidToOtherEmployee) ctx.info('RENT_ONE_EMPLOYEE', 'ერთ დაწესებულებაში ოჯახის ორი მოსამსახურისას ბინას ქირაობს მხოლოდ ერთ-ერთი (G > 0 მხოლოდ ერთთან, დ1 მ.4 პ.1).', ['R-FAM-SAMEPOST'], `family.${m.id}`);
    const edu = (() => {
      if (m.reimbursedElsewhere?.education) return right(false, 'განათლების ხარჯს სხვა უწყება ანაზღაურებს (დ1 მ.4 პ.4).', ['R-FAM-OTHERAGENCY']);
      if (age != null && age < 18) return right(true, 'არასრულწლოვანი ოჯახის წევრი (პ.31).', ['R-EDU-SCOPE']);
      if (m.adultChildInSchool && (m.role === 'child' || m.role === 'stepchild')) {
        // note after pt 43: in general school, host-state consent, ≤ 1 year after majority (age 18 completed years)
        const ok = adultChildEligible({ inSchool: true, hostConsent: m.hostStateConsent ?? null, monthsSinceMajority: age == null ? null : age === 18 ? 0 : 12 });
        if (ok === true) return right(true, 'სრულწლოვანი შვილი/გერი: სკოლაში, ადგილსამყოფელი სახელმწიფოს თანხმობით, სრულწლოვანებიდან ≤ 1 წელი (შენიშვნა).', ['R-EDU-ADULT']);
        if (ok === false) return right(false, m.hostStateConsent === false ? 'ადგილსამყოფელი სახელმწიფოს თანხმობა არ არის (შენიშვნა).' : 'სრულწლოვანებიდან 1 წელზე მეტია (შენიშვნა).', ['R-EDU-ADULT']);
        ctx.missing(`family.${m.id}.hostStateConsent`, `${m.label || m.id}: მიუთითეთ ასაკი და ადგილსამყოფელი სახელმწიფოს თანხმობა (სრულწლოვანი შვილის განათლება).`);
        return right(null, 'სრულწლოვანი შვილის უფლებისთვის საჭიროა ასაკი და ადგილსამყოფელი სახელმწიფოს თანხმობა.', ['R-EDU-ADULT']);
      }
      if (age != null) return right(false, 'სრულწლოვანია და შენიშვნის პირობა მონიშნული არ არის.', ['R-EDU-ADULT']);
      return right(null, 'ასაკი უცნობია.', ['R-EDU-SCOPE']);
    })();
    return {
      memberId: m.id, label: m.label ?? ROLES[m.role] ?? m.id, age,
      eligibility: {
        monthlySupplement: supplementRight(m, refDate),
        settlement10: isDep(m) ? right(false, 'მხარდაჭერის მიმღებსა და მეურვეობის/მზრუნველობის ქვეშ მყოფზე 10% არ ემატება (პ.7).', ['R-SETTLE-001'])
          : right(true, 'პირველადი მოწყობის +10% (პ.7).', ['R-SETTLE-001']),
        insurance: m.reimbursedElsewhere?.insurance ? right(false, 'დაზღვევას სხვა უწყება ანაზღაურებს (დ1 მ.4 პ.4).', ['R-FAM-OTHERAGENCY'])
          : isDep(m) ? right(true, 'მხოლოდ ადგილსამყოფელ ქვეყანაში ყოფნის პერიოდში (პ.30ბ).', ['R-INS-PERIOD'])
            : right(true, 'მივლინების მთელი პერიოდი, შვებულებისა და მოკლევადიანი მივლინების ჩათვლით (პ.30ა).', ['R-INS-001', 'R-INS-PERIOD']),
        vacationTravel: m.reimbursedElsewhere?.travel ? right(false, 'მგზავრობას სხვა უწყება ანაზღაურებს (დ1 მ.4 პ.4).', ['R-FAM-OTHERAGENCY'])
          : isDep(m) ? right(true, 'პ.12გ-ის წესით (საქართველო ↔ ადგილსამყოფელი ქვეყანა და სხვა მიმართულება).', ['R-VAC-TICKETS'])
            : right(true, 'პ.12ბ-ის წესით.', ['R-VAC-TICKETS']),
        education: edu,
      },
    };
  }
  const family = sc.family.filter((m) => m && typeof m === 'object' && typeof m.id === 'string');
  const familyOut = family.map(memberRights);
  const famById = new Map(family.map((m) => [m.id, m]));
  const rightsById = new Map(familyOut.map((f) => [f.memberId, f]));
  if (!datesMode && family.some((m) => m.from || m.to)) {
    ctx.info('FAMILY_DATES_FULL_MONTH', 'სრული თვის რეჟიმში წევრის „დან/მდე“ თარიღები არ გამოიყენება; შემადგენლობის ცვლილებისთვის აირჩიეთ თარიღების რეჟიმი.', ['R-PRORATE-CHANGE'], 'family');
  }

  /** C and its status for a date (dates mode) or the full month (date undefined). */
  function countC(date) {
    let c = 0, st = 'calculated';
    for (const m of family) {
      const r = date === undefined ? rightsById.get(m.id).eligibility.monthlySupplement : supplementRight(m, date);
      if (r.value === null) { ctx.missing(`family.${m.id}.presence`, `${m.label || m.id}: მიუთითეთ ადგილსამყოფელ ქვეყანაში ყოფნის თარიღები.`); return { C: null, st: 'undetermined' }; }
      if (r.value) c++;
      if (r.status) st = worst(st, r.status);
    }
    return { C: c, st };
  }

  // ---------------------------------------------------------------- rent G
  const rentAt = (date) => {
    let g = sc.rent.amount, from = null;
    for (const ch of sc.rent.changes) {
      if (ch && isValidDate(ch.from) && compareDates(ch.from, date) <= 0 && (!from || compareDates(ch.from, from) >= 0)) { g = ch.amount; from = ch.from; }
    }
    return amt(g);
  };
  const gStatus = sc.rent.basis === 'market-scenario' || sc.rent.basis === 'planned' ? 'scenario' : 'calculated';
  if (sc.rent.basis === 'market-scenario') ctx.info('RENT_MARKET', 'ქირა აღებულია ბაზრის ფასიდან — შედეგი სცენარია, არა ფაქტობრივი ქირა.', ['R-RENT-UNKNOWN'], 'rent.basis');
  if (!datesMode && sc.rent.changes.length) ctx.info('RENT_CHANGES_FULL_MONTH', 'ქირის ცვლილებები გამოიყენება მხოლოდ თარიღების რეჟიმში.', ['R-PRORATE-CHANGE'], 'rent.changes');
  ctx.info('RENT_CURRENCY', 'ქირა შეიყვანეთ დაწესებულების დაფინანსების ვალუტაში; სხვა ვალუტიდან გადაყვანის წესი ტექსტში არ არის (P-12).', ['R-RENT-CURRENCY'], 'rent.amount');

  // ---------------------------------------------------------------- monthly block (full month, or inputs at period start)
  const { C: C0, st: c0St } = refDate ? countC(refDate) : countC(undefined);
  const pos0 = positionAt(refDate);
  const A = pos0.A;
  const G0 = refDate ? rentAt(refDate) : amt(sc.rent.amount);
  if (G0 == null) ctx.missing('rent.amount', 'შეიყვანეთ ბინის თვიური ქირა (0 = ქირა არ არის; ცარიელი = უცნობი).');
  const Qv = param('FAMILY-SUPPLEMENT-PCT') ?? '7';
  const blockStatus = (C, cSt, pos) => {
    const kSt = kRow ? 'calculated' : 'undetermined';
    const dSt = worst(H ? 'calculated' : 'undetermined', pos.A != null ? pos.status : 'undetermined', kSt, C != null ? cSt : 'undetermined');
    return { kSt, dSt };
  };
  function fullMonth(C, G, idPrefix = '', cSt = 'calculated', pos = pos0) {
    const r = monthlyRate({ H, A: pos.A, K: kRow?.k ?? null, E: kRow?.ePercent ?? null, C, G, head, Q: Qv });
    const { dSt } = blockStatus(C, cSt, pos);
    const tSt = worst(dSt, kRow ? 'calculated' : 'undetermined');
    let fSt = worst(tSt, G != null ? gStatus : 'undetermined');
    if (r.fCase === 'head') fSt = worst(fSt, rentHeadStatus);
    if (r.fCase === 'needs-head') { fSt = 'undetermined'; ctx.missing('status.rentHead', 'ქირა ბინის წილზე (T) მეტია: მიუთითეთ, ხელმძღვანელობთ თუ არა დაწესებულებას.'); }
    if (r.fCase === 'equal') ctx.assume('RENT_G_EQUALS_T', 'G = T ტექსტში ცალკე არ არის; გამოყენებულია F = T (ორივე მეზობელი ფორმულის ზღვარი, P-3).', ['R-RENT-F-EQUAL'], 'OQ-01');
    const sSt = worst(dSt, tSt, fSt);
    const iu = { H, A: pos.A, positionEntryId: pos.entry?.id ?? null, K: kRow?.k ?? null, E: kRow?.ePercent ?? null, C: C == null ? null : String(C), G: str(G), Q: Qv, rentHead: sc.status.rentHead };
    const p = idPrefix;
    return {
      r,
      D: comp(`${p}D`, 'monthly', 'სამივლინებო თანხის პერსონალური განაკვეთი (D)', r.D, cur, dSt, 'D = H × A% × K × (100 + C × Q)%', ['R-D-001', 'R-D-C', ...pos.rules], iu),
      T: comp(`${p}T`, 'monthly', 'ბინის ქირის წილი D-ში (T)', r.T, cur, tSt, 'T = D × E%', ['R-T-001'], iu),
      F: comp(`${p}F`, 'monthly', 'ბინის ქირის სუბსიდია (F)', r.F, cur, fSt, fReason(r.fCase), r.fRuleIds, iu),
      S: comp(`${p}S`, 'monthly', 'გრძელვადიანი მივლინების ყოველთვიური განაკვეთი (S)', r.S, cur, sSt,
        r.S == null ? 'S-ის დასადგენად საჭიროა ყველა შემავალი მონაცემი (მათ შორის ქირა G).' : 'S = D − T + F', ['R-S-001'], iu),
    };
  }
  const fm = fullMonth(C0, G0, '', c0St, pos0);
  const { kSt } = blockStatus(C0, c0St, pos0);
  const g0Comp = comp('G', 'monthly', 'ბინის ფაქტობრივი თვიური ქირა (G)', G0, cur, G0 == null ? 'undetermined' : gStatus,
    G0 == null ? 'ქირა არ არის შეყვანილი (ცარიელი ≠ 0).' : isZero(G0) ? 'ქირა არ არის (G = 0).' : (sc.rent.basis === 'actual' ? 'ფაქტობრივი ქირა.' : 'დაგეგმილი/საბაზრო ქირა — სცენარი.'),
    ['R-RENT-UNKNOWN', 'R-RENT-CURRENCY'], { basis: sc.rent.basis });
  const monthly = {
    H: comp('H', 'parameter', 'საბაზისო თანხა (H)', H, cur, H ? 'calculated' : 'undetermined', H ? `ბრძანება პ.3 (${cur})` : 'დაწესებულება არ არის არჩეული.', ['R-H-001', 'R-CUR-001']),
    A: comp('A', 'parameter', 'თანამდებობრივი მაჩვენებელი (A, %)', A, null, A != null ? pos0.status : 'undetermined',
      pos0.entry ? `${mode === 'annex3' ? 'დანართი №3' : 'დანართი №2'}, სტრ. ${pos0.entry.rowNo}` : 'თანამდებობა არ არის არჩეული.', pos0.rules, { entryId: pos0.entry?.id ?? null }, 'raw'),
    K: comp('K', 'parameter', 'ქვეყნის/ქალაქის კოეფიციენტი (K)', kRow?.k ?? null, null, kSt,
      kRow ? `დანართი №4, სტრ. ${kRow.annex4Row} (${kRow.scope === 'city' ? 'ქალაქის სტრიქონი' : 'ქვეყნის სტრიქონი'})` : 'დანართ №4-ში სტრიქონი არ არის — დაუდგენელი.', ['R-K-001'], { coefficientId: kRow?.id ?? null }, 'raw'),
    C: comp('C', 'parameter', 'დანამატის მქონე ოჯახის წევრები (C)', C0, null, C0 != null ? c0St : 'undetermined',
      'მოსამსახურე არ ითვლება; თითო წევრის უფლება — ოჯახის ცხრილში.', ['R-D-C'], {}, 'raw'),
    Q: comp('Q', 'parameter', 'დანამატი თითო წევრზე (Q, %)', Qv, null, 'calculated', 'დანართი №1, მ.3(ბ)', ['R-D-001'], {}, 'raw'),
    D: fm.D,
    E: comp('E', 'parameter', 'ბინის ქირის ხვედრითი წილი (E, %)', kRow?.ePercent ?? null, null, kSt, kRow ? `დანართი №4, სტრ. ${kRow.annex4Row}` : 'დაუდგენელი.', ['R-K-001', 'R-T-001'], {}, 'raw'),
    T: fm.T, G: g0Comp, F: fm.F, S: fm.S,
    DminusT: comp('DminusT', 'monthly', 'D − T (S ქირის გარეშე)', fm.r.DminusT, cur, worst(fm.D.status, fm.T.status), 'S-ის ქვედა ზღვარი, როცა ქირა არ არის (G = 0).', ['R-RENT-UNKNOWN', 'R-S-001']),
    uncoveredRent: comp('uncoveredRent', 'monthly', 'ქირის დაუფარავი ნაწილი max(G − F, 0)', fm.r.uncoveredRent, cur, worst(fm.F.status, g0Comp.status), 'მოსამსახურის საკუთარი ქირის ხარჯი.', ['R-RENT-UNCOVERED']),
    rentSurplus: comp('rentSurplus', 'monthly', 'სუბსიდიის ნამეტი max(F − G, 0)', fm.r.rentSurplus, cur, worst(fm.F.status, g0Comp.status), 'როცა 0 < G < T, F = T (სუბსიდია ფიქსირდება T-ზე).', ['R-RENT-UNCOVERED', 'R-RENT-F-BELOW']),
  };

  // ---------------------------------------------------------------- dates mode: segments
  const periodSegments = [];
  let periodTotal = null;
  if (sc.period.mode === 'dates' && !datesMode) ctx.missing('period.start', 'მიუთითეთ პერიოდის სწორი დაწყებისა და დასრულების თარიღები.');
  if (datesMode) {
    const cuts = [];
    for (const ch of sc.rent.changes) if (ch && isValidDate(ch.from)) cuts.push(ch.from);
    if (special && isValidDate(special.from)) cuts.push(special.from);
    if (special && isValidDate(special.to)) cuts.push(addDays(special.to, 1));
    for (const m of family) {
      if (isValidDate(m.from)) cuts.push(m.from);
      if (isValidDate(m.to)) cuts.push(addDays(m.to, 1));
      for (const p of Array.isArray(m.presence) ? m.presence : []) {
        if (isValidDate(p?.from)) cuts.push(p.from);
        if (isValidDate(p?.to)) cuts.push(addDays(p.to, 1));
      }
    }
    if (compareDates(sc.period.start, '2025-09-23') < 0) {
      ctx.warn('EDITION_PERIOD', 'პერიოდი იწყება მიმდინარე H-ის (№01-770, გამოქვ. 23.09.2025) გამოქვეყნებამდე; წინა რედაქცია მოწოდებული არ არის — შედეგი შეიძლება არ შეესაბამებოდეს იმ დროის ნორმებს.', ['R-EFF-001'], 'period.start');
    }
    if (sc.rent.changes.length || family.some((m) => m.from || m.to)) {
      ctx.info('FAMILY_CHANGE_NOTICE', 'ქირის ან ოჯახის შემადგენლობის ცვლილებისას ცნობა წარედგინება სამ დღეში (დ1 მ.4, პირველი პ.6).', ['R-FAM-CHANGE-NOTICE'], null);
    }
    const segs = segmentPeriod(sc.period.start, sc.period.end, cuts);
    const parts = [];
    let segStatus = 'calculated';
    segs.forEach((s, i) => {
      const { C, st: cSt } = countC(s.from);
      const G = rentAt(s.from);
      const pos = positionAt(s.from);
      const f = fullMonth(C, G, `seg${i}.`, cSt, pos);
      const pr = prorate(f.r.S, s.days, s.daysInMonth);
      const pc = comp(`seg${i}.prorated`, 'monthly', `S ${s.from} – ${s.to}`, pr, cur, f.S.status,
        `S × ${s.days} / ${s.daysInMonth} (სეგმენტის სრული თვის განაკვეთი × დღეები / თვის დღეები)`, ['R-PRORATE-001', 'R-PRORATE-CHANGE'],
        { S: f.S.exact, days: s.days, daysInMonth: s.daysInMonth });
      parts.push(pr);
      segStatus = worst(segStatus, pc.status);
      periodSegments.push({ from: s.from, to: s.to, month: s.month, days: s.days, daysInMonth: s.daysInMonth, C: C == null ? null : String(C), G: str(G), A: pos.A,
        fullMonth: { D: f.D, T: f.T, F: f.F, S: f.S }, prorated: pc });
    });
    const tot = parts.some((x) => x == null) ? null : sum(parts);
    periodTotal = comp('periodTotal', 'monthly', `S პერიოდში ${sc.period.start} – ${sc.period.end}`, tot, cur, segStatus,
      'სეგმენტების ზუსტი ჯამი, დამრგვალებული ერთხელ (P-1, P-2).', ['R-PRORATE-001', 'R-ROUND-001'], { segments: segs.length });
    ctx.assume('PRORATE_POLICY', 'დღეები ითვლება კალენდარულად, ორივე ბოლო ჩათვლით; ცვლილება მოქმედებს საკუთარი თარიღიდან; სეგმენტი = სრული თვის განაკვეთი × დღეები / თვის დღეები (P-2).', ['R-PRORATE-001', 'R-PRORATE-CHANGE'], 'OQ-13');
  }

  // ---------------------------------------------------------------- education
  const L = cur ? param(cur === 'EUR' ? 'EDU-LIMIT-EUR' : 'EDU-LIMIT-USD') : null;
  const excessPct = param('EDU-EXCESS-SHARE-PCT') ?? '80';
  const perChild = [];
  const eduEntries = sc.education.filter((x) => x && typeof x === 'object');
  eduEntries.forEach((x, i) => {
    const m = famById.get(x.memberId);
    const path = `education[${i}]`;
    const parts = { tuition: amt(x.tuition), registration: amt(x.registration), transport: amt(x.transport), meals: amt(x.meals) };
    const holiday = amt(x.holidayExtraContract);
    const known = Object.values(parts).filter((p) => p != null);
    const P = known.length ? sum(known) : (holiday != null ? ZERO : null);
    if (P == null) ctx.missing(`${path}.tuition`, 'მიუთითეთ განათლების დასაშვები ხარჯი (სწავლა, რეგისტრაცია, ტრანსპორტი, კვება).');
    if (parts.registration != null) ctx.assume('EDU_REGISTRATION', 'რეგისტრაციის საფასური შეყვანილია თვიურ წილად (მომხმარებლის მიერ).', ['R-EDU-SCOPE'], 'OQ-03');
    const elig = m ? rightsById.get(m.id).eligibility.education : right(null, 'ოჯახის წევრი არ მოიძებნა.', ['R-EDU-SCOPE']);
    if (elig.value === null && m) ctx.missing(`family.${m.id}.age`, `${m.label || m.id}: მიუთითეთ ასაკი (განათლების უფლებისთვის).`);
    let reimb = null, status = 'calculated', reason = '', rules = ['R-EDU-SCOPE', 'R-EDU-LIMIT', 'R-EDU-EXCESS'];
    const notes = [];
    if (elig.value === false) { reimb = ZERO; reason = elig.reason_ka; rules = elig.ruleIds; }
    else if (x.freeStateLanguageSchoolAvailable && !x.ministerDecision34 && x.paidSchoolLanguageSameAsState === true) { reimb = ZERO; reason = 'ქალაქში არის სახელმწიფო ენაზე უფასო სასწავლებელი და ფასიანი სკოლა იმავე ენაზეა — ხარჯი არ ანაზღაურდება (პ.36).'; rules = ['R-EDU-FREESTATE']; }
    else if (x.freeStateLanguageSchoolAvailable && !x.ministerDecision34 && x.paidSchoolLanguageSameAsState !== false) {
      reimb = null; status = 'undetermined'; reason = 'პ.36: მიუთითეთ, ფასიანი სკოლის სწავლების ენა იგივეა თუ არა, რაც უფასო სახელმწიფო ენის სკოლისა.'; rules = ['R-EDU-FREESTATE'];
      ctx.missing(`${path}.paidSchoolLanguageSameAsState`, 'პ.36: ფასიანი სკოლის სწავლების ენა სახელმწიფო ენის იგივეა?');
    }
    else {
      reimb = elig.value === null ? null : educationReimbursement(P, L, excessPct).reimbursement;
      reason = 'min(P, L) + 80% × max(P − L, 0) (პ.32–33)';
      if (elig.value === null) status = 'undetermined';
      if (x.ministerDecision34) { status = worst(status, 'unconfirmed'); notes.push('მინისტრის გადაწყვეტილებით შესაძლებელია განსხვავებული წესი (პ.34/პ.36) — სტანდარტული ფორმულა, დაუდასტურებელი.'); rules = [...rules, 'R-EDU-SPECIAL']; }
    }
    if (x.freeStateLanguageSchoolAvailable && x.paidSchoolLanguageSameAsState === false) notes.push('უფასო სახელმწიფო ენის სკოლა არსებობს, მაგრამ ფასიანი სკოლა სხვა ენაზეა — პ.36 არ ზღუდავს.');
    if (x.schoolYear && isValidDate(x.schoolYear.from) && isValidDate(x.schoolYear.to)) {
      const outside = datesMode
        ? compareDates(sc.period.start, x.schoolYear.from) < 0 || compareDates(sc.period.end, x.schoolYear.to) > 0
        : periodMonth ? compareDates(monthEnd(periodMonth), x.schoolYear.from) < 0 || compareDates(periodMonth, x.schoolYear.to) > 0 : false;
      if (outside) ctx.warn('EDU_SCHOOL_YEAR', 'პერიოდი (ნაწილობრივ) სასწავლო წლის გარეთაა — განათლების ხარჯი ანაზღაურდება მხოლოდ სასწავლო წლის დაწყებიდან დასრულებამდე (პ.32).', ['R-EDU-LIMIT'], `${path}.schoolYear`);
    } else if (datesMode) ctx.info('EDU_SCHOOL_YEAR_UNKNOWN', 'განათლების ანაზღაურება — მხოლოდ სასწავლო წლის თვეებში (პ.32); თვიური თანხა პერიოდის ყველა თვეზე ავტომატურად არ მრავლდება.', ['R-EDU-LIMIT'], `${path}.schoolYear`);
    if (holiday != null && !isZero(holiday)) { notes.push('არდადეგების დამატებითი ხელშეკრულება არ ანაზღაურდება (პ.35).'); rules = [...rules, 'R-EDU-HOLIDAY']; }
    const expense = P == null ? null : add(P, holiday ?? ZERO);
    const personal = reimb == null || expense == null ? null : sub(expense, reimb);
    perChild.push({
      memberId: x.memberId, label: m?.label ?? x.memberId, eligible: elig.value, eligibilityReason_ka: elig.reason_ka,
      components: Object.fromEntries([...Object.entries(parts), ['holidayExtraContract', holiday]].map(([k, v2]) => [k, str(v2)])),
      P: comp(`${path}.P`, 'parameter', 'დასაშვები თვიური ხარჯი (P)', P, cur, P == null ? 'undetermined' : 'calculated', 'სწავლა + რეგისტრაცია + ტრანსპორტი + კვება (პ.31)', ['R-EDU-SCOPE']),
      L: comp(`${path}.L`, 'parameter', 'თვიური ზღვარი (L)', L, cur, L ? 'calculated' : 'undetermined', 'პ.32 (690 EUR / 750 USD)', ['R-EDU-LIMIT']),
      reimbursement: comp(`${path}.reimbursement`, 'reimbursement', 'განათლების ანაზღაურება', reimb, cur, reimb == null ? 'undetermined' : status, reason, rules, { P: str(P), L }),
      personalCost: comp(`${path}.personalCost`, 'reimbursement', 'საკუთარი წილი', personal, cur, personal == null ? 'undetermined' : status, 'ხარჯი − ანაზღაურება (არდადეგების ხელშეკრულების ჩათვლით)', rules),
      expense: str(expense), ruleIds: rules, notes_ka: notes,
    });
  });
  if (eduEntries.length) ctx.assume('EDU_PER_CHILD', 'განათლების ზღვარი L გამოიყენება თითო ბავშვზე; ოჯახზე ერთიანი ზღვრის ვარიანტი ჩანს ცალკე (alternativePooled), P-4.', ['R-EDU-LIMIT'], 'OQ-02');
  const eduReimbs = perChild.map((c) => rat(c.reimbursement));
  const eduTotalR = perChild.length ? (eduReimbs.some((r) => r == null) ? null : sum(eduReimbs)) : ZERO;
  const eduExpenses = perChild.map((c) => (c.expense == null ? null : fromExact(c.expense)));
  const eduExpenseR = perChild.length ? (eduExpenses.some((r) => r == null) ? null : sum(eduExpenses)) : ZERO;
  const eduStatus = perChild.reduce((s, c) => worst(s, c.reimbursement.status), 'calculated');
  const pooledKids = perChild.filter((c) => c.eligible === true && rat(c.P) != null && c.reimbursement.status !== 'undetermined' && !c.ruleIds.includes('R-EDU-FREESTATE'));
  const education = {
    perChild,
    total: comp('education.total', 'reimbursement', 'განათლების ანაზღაურება სულ (თვეში)', eduTotalR, cur, perChild.length ? eduStatus : 'calculated', perChild.length ? 'თითო ბავშვის ანაზღაურების ჯამი.' : 'განათლების ხარჯი არ არის შეყვანილი.', ['R-EDU-LIMIT', 'R-EDU-EXCESS']),
    personal: comp('education.personal', 'reimbursement', 'განათლების საკუთარი წილი სულ', eduTotalR == null || eduExpenseR == null ? null : sub(eduExpenseR, eduTotalR), cur, perChild.length ? eduStatus : 'calculated', 'ხარჯი − ანაზღაურება', ['R-EDU-EXCESS']),
    expense: comp('education.expense', 'reimbursement', 'განათლების ხარჯი სულ (თვეში)', eduExpenseR, cur, eduExpenseR == null ? 'undetermined' : 'calculated', '', ['R-EDU-SCOPE']),
    alternativePooled: pooledKids.length >= 2 && L
      ? comp('education.alternativePooled', 'reimbursement', 'ალტერნატივა: ერთი ზღვარი ოჯახზე', educationReimbursement(sum(pooledKids.map((c) => rat(c.P))), L, excessPct).reimbursement, cur, 'scenario',
        'min(ΣP, L) + 80% × max(ΣP − L, 0) — თუ ზღვარი ოჯახზეა (OQ-02); დადასტურებულ ჯამში არ შედის.', ['R-EDU-LIMIT', 'R-EDU-EXCESS'])
      : null,
  };

  // ---------------------------------------------------------------- remainder
  const sForRemainder = rat(fm.S);
  const remR = sForRemainder != null && G0 != null && eduTotalR != null && eduExpenseR != null ? sub(add(sForRemainder, eduTotalR), add(G0, eduExpenseR)) : null;
  const remainder = {
    value: comp('remainder', 'remainder', 'ნაშთი ქირისა და განათლების ხარჯის შემდეგ (თვეში)', remR, cur, worst(fm.S.status, g0Comp.status, education.total.status, education.expense.status),
      'S + განათლების ანაზღაურება − ქირა G − განათლების ხარჯი. სხვა ხარჯები (დაზღვევა, მგზავრობა, ცხოვრება) არ აკლდება; უარყოფითი ნაჩვენებია როგორც არის.', ['R-S-001', 'R-RENT-UNCOVERED', 'R-EDU-EXCESS']),
    terms: { S: fm.S, educationReimbursement: education.total, G: g0Comp, educationExpense: education.expense },
  };

  // ---------------------------------------------------------------- insurance
  const insRow = mission?.insuranceCapId ? ix.ins.get(mission.insuranceCapId) : null;
  const persons = [{ id: 'EMP', label: 'მოსამსახურე', member: null }, ...family.map((m) => ({ id: m.id, label: m.label ?? ROLES[m.role] ?? m.id, member: m }))];
  const perPerson = [];
  const annualCaps = [];
  for (const p of persons) {
    const entryIdx = sc.insurance.findIndex((x) => x && x.personId === p.id);
    const entryI = entryIdx >= 0 ? sc.insurance[entryIdx] : null;
    const ref = entryI && isValidDate(entryI.policyStart) ? entryI.policyStart : refDate;
    const age = p.member ? memberAge(p.member, ref) : memberAge(sc.employee, ref);
    const band = insuranceBand(age);
    const capV = band && insRow ? insRow.bands[band] : null;
    const path = entryI ? `insurance[${entryIdx}]` : p.member ? `family.${p.id}.age` : 'employee.age';
    const eligR = p.member ? rightsById.get(p.id).eligibility.insurance : right(true, 'მოსამსახურე (პ.30).', ['R-INS-001']);
    const capComp = comp(`insurance.${p.id}.cap`, 'annual-cap', `დაზღვევის წლიური ზღვარი — ${p.label}`, capV, cur,
      capV ? 'calculated' : 'undetermined',
      capV ? `დანართი №${insRow.annex}, სტრ. ${insRow.rowNo}, ჯგუფი ${band}. წლიური ზღვარი — არა გასაცემი თანხა და არ ემატება შემოსავალს.`
        : !insRow ? 'დაწესებულების დაზღვევის სტრიქონი არ არის.' : 'ასაკი უცნობია — ასაკობრივი ჯგუფი დაუდგენელია (არა 0–18).',
      ['R-INS-001'], { age, band });
    annualCaps.push(capComp);
    let reimb = null, personal = null, remaining = null, st = 'not_applicable', reason = 'პოლისის ღირებულება არ არის შეყვანილი.';
    const policy = entryI ? amt(entryI.policyCost) : null;
    const already = entryI ? amt(entryI.alreadyReimbursed) : null;
    if (entryI) {
      if (age == null) ctx.missing(path === `insurance[${entryIdx}]` ? (p.member ? `family.${p.id}.age` : 'employee.age') : path, `${p.label}: მიუთითეთ ასაკი (დაზღვევის ზღვრისთვის).`);
      if (policy == null) ctx.missing(`insurance[${entryIdx}].policyCost`, `${p.label}: მიუთითეთ პოლისის ღირებულება.`);
      if (already == null) ctx.missing(`insurance[${entryIdx}].alreadyReimbursed`, `${p.label}: მიუთითეთ ამ წლის ზღვრიდან უკვე ანაზღაურებული თანხა (0, თუ არაფერი).`);
      if (eligR.value === false) { reimb = ZERO; personal = policy; st = 'calculated'; reason = eligR.reason_ka; }
      else {
        const r = insuranceReimbursement(capV, policy, already);
        reimb = r.reimbursable; personal = r.personalCost; remaining = r.remainingCap;
        st = reimb == null ? 'undetermined' : 'calculated';
        reason = 'min(პოლისის ღირებულება, წლიური ზღვარი − უკვე ანაზღაურებული) (პ.30)';
        if (p.member && DEPENDENT_STATUSES.includes(p.member.status)) {
          const pS = entryI.policyStart, pE = entryI.policyEnd;
          const covered = isValidDate(pS) && isValidDate(pE) && Array.isArray(p.member.presence) && compareDates(pE, pS) >= 0
            && overlapDays(pS, pE, p.member.presence) === daysInclusive(pS, pE);
          if (!covered && st === 'calculated') { st = 'scenario'; reason += ' პოლისის პერიოდი ყოფნის პერიოდს ზუსტად არ ემთხვევა ან უცნობია — სცენარი (პ.30ბ).'; }
          ctx.info('INS_DEPENDENT_PERIOD', 'მხარდაჭერის მიმღებს/მეურვეობის ან მზრუნველობის ქვეშ მყოფს დაზღვევა უნაზღაურდება მხოლოდ ქვეყანაში ყოფნის პერიოდში (პ.30ბ); ზღვარი ავტომატურად არ პროპორცირდება (P-11).', ['R-INS-PERIOD'], path);
        }
      }
    }
    perPerson.push({
      personId: p.id, label: p.label, age, band, eligible: eligR.value, eligibilityReason_ka: eligR.reason_ka,
      annualCap: capComp,
      policyCost: entryI ? comp(`insurance.${p.id}.policy`, 'reimbursement', 'პოლისის ღირებულება', policy, cur, policy == null ? 'undetermined' : 'calculated', '', ['R-INS-001']) : null,
      alreadyReimbursed: entryI ? comp(`insurance.${p.id}.already`, 'reimbursement', 'უკვე ანაზღაურებული (იმავე ზღვრიდან)', already, cur, already == null ? 'undetermined' : 'calculated', '', ['R-INS-001']) : null,
      reimbursable: comp(`insurance.${p.id}.reimbursable`, 'reimbursement', 'ასანაზღაურებელი დაზღვევა', reimb, cur, st, reason, eligR.value === false ? eligR.ruleIds : ['R-INS-001']),
      personalCost: comp(`insurance.${p.id}.personal`, 'reimbursement', 'საკუთარი ხარჯი', personal, cur, entryI ? (personal == null ? 'undetermined' : 'calculated') : 'not_applicable', '', ['R-INS-001']),
      remainingCap: comp(`insurance.${p.id}.remaining`, 'annual-cap', 'დარჩენილი ზღვარი', remaining, cur, entryI ? (remaining == null ? (eligR.value === false ? 'not_applicable' : 'undetermined') : 'calculated') : 'not_applicable', '', ['R-INS-001']),
      status: entryI ? st : (capV ? 'calculated' : 'undetermined'),
      entered: !!entryI,
      ruleIds: ['R-INS-001', 'R-INS-PERIOD'],
    });
  }
  for (const [i, x] of sc.insurance.entries()) {
    if (x && x.personId !== 'EMP' && !famById.has(x.personId)) ctx.warn('INS_PERSON_UNKNOWN', 'დაზღვევის ჩანაწერი უცნობ პირს ეკუთვნის.', ['R-INS-001'], `insurance[${i}].personId`);
  }

  // ---------------------------------------------------------------- broker (pt 8, 8¹)
  const broker = brokerBlock();
  function brokerBlock() {
    const b = sc.broker;
    const id = 'broker', label = 'საშუამავლო (მაკლერის) მომსახურება';
    if (!b || (b.fee == null && !b.serviceDate)) return comp(id, 'one-time-reimbursement', label, null, cur, 'not_applicable', 'მოთხოვნა არ არის შეყვანილი.', ['R-BROKER-001']);
    const fee = amt(b.fee);
    if (fee == null) ctx.missing('broker.fee', 'მიუთითეთ ფაქტობრივი საკომისიო (ნაგულისხმევად ქირას არ უტოლდება).');
    const rentForCap = b.serviceDate && isValidDate(b.serviceDate) ? rentAt(b.serviceDate) : G0;
    if (rentForCap == null) ctx.missing('rent.amount', 'საკომისიოს ზღვრისთვის საჭიროა თვიური ქირა.');
    if (head == null) ctx.missing('status.rentHead', 'საკომისიოს წილისთვის (80% / 50%) მიუთითეთ ხელმძღვანელის სტატუსი.');
    const iu = { fee: str(fee), rent: str(rentForCap), rentHead: sc.status.rentHead, serviceDate: b.serviceDate ?? null, rotationStartDate: b.rotationStartDate ?? null };
    const amount = brokerAmount(fee, rentForCap, head);
    if (b.specialDecision81) {
      ctx.warn('BROKER_81', 'პ.8¹: მინისტრის გადაწყვეტილებით განსხვავებული პირობები — თანხა ნაჩვენებია სტანდარტული ფორმულით და დასადასტურებელია.', ['R-BROKER-SPECIAL'], 'broker.specialDecision81');
      return comp(id, 'one-time-reimbursement', label, amount, cur, 'unconfirmed', 'პ.8¹ — მინისტრის გადაწყვეტილება (ავტომატურად არ დასტურდება).', ['R-BROKER-SPECIAL', 'R-BROKER-001'], iu);
    }
    if (b.alreadyReimbursed) return comp(id, 'one-time-reimbursement', label, ZERO, cur, 'calculated', 'ამ როტაციაში უკვე ანაზღაურებულია — ერთჯერადი (პ.8).', ['R-BROKER-001'], iu);
    if (b.documented === false) return comp(id, 'one-time-reimbursement', label, ZERO, cur, 'calculated', 'ხელშეკრულება/დამადასტურებელი დოკუმენტი არ არის (პ.8).', ['R-BROKER-001'], iu);
    const w = brokerWindow(b.rotationStartDate, b.serviceDate);
    if (w === false) return comp(id, 'one-time-reimbursement', label, ZERO, cur, 'calculated', 'მომსახურება წარგზავნიდან 6 თვის შემდეგაა (პ.8).', ['R-BROKER-001'], iu);
    if (w === null) {
      if (!isValidDate(b.rotationStartDate)) ctx.missing('broker.rotationStartDate', 'მიუთითეთ როტაციით წარგზავნის თარიღი (6-თვიანი ვადისთვის).');
      if (!isValidDate(b.serviceDate)) ctx.missing('broker.serviceDate', 'მიუთითეთ მომსახურების თარიღი.');
      if (isValidDate(b.rotationStartDate) && isValidDate(b.serviceDate)) ctx.assume('BROKER_WINDOW', '6-თვიანი ვადის ზღვარი (ზუსტად 6 თვის დღე ან წარგზავნამდე თარიღი) — ინტერპრეტაცია საჭიროებს დადასტურებას.', ['R-BROKER-001'], 'OQ-18');
      return comp(id, 'one-time-reimbursement', label, null, cur, 'undetermined', '6-თვიანი ვადის შესრულება ვერ დგინდება.', ['R-BROKER-001'], iu);
    }
    const st = worst(amount == null ? 'undetermined' : 'calculated', brokerHeadStatus, rentForCap != null ? gStatus : 'undetermined');
    return comp(id, 'one-time-reimbursement', label, amount, cur, st, `min(საკომისიო × ${head ? '80' : '50'}%, ერთი თვის ქირა) (პ.8)`, ['R-BROKER-001'], iu);
  }

  // ---------------------------------------------------------------- baggage (pt 4b, 5¹, 5²)
  const bagRow = mission?.baggageCapId ? ix.bag.get(mission.baggageCapId) : null;
  const baggage = baggageBlock();
  function baggageBlock() {
    const b = sc.baggage;
    const capC = comp('baggage.cap', 'parameter', 'ბარგის ზღვარი (მოსამსახურე + ოჯახი ჯამში)', bagRow?.amount ?? null, cur, bagRow ? 'calculated' : 'undetermined',
      bagRow ? `დანართი №${bagRow.annex}, სტრ. ${bagRow.rowNo}. ზღვარი ≠ ანაზღაურება.` : 'დაწესებულება არ არის არჩეული.', ['R-BAG-001']);
    const na = (id, label) => comp(id, 'one-time-reimbursement', label, null, cur, 'not_applicable', 'მოთხოვნა არ არის შეყვანილი.', ['R-BAG-001']);
    const claimsIn = Array.isArray(b?.claims) ? b.claims.filter((c) => c && typeof c === 'object') : [];
    if (!b || !claimsIn.length) {
      return { cap: capC, previouslyUsed: na('baggage.previouslyUsed', 'უკვე გამოყენებული'), claimed: na('baggage.claimed', 'მოთხოვნილი'),
        reimbursable: na('baggage.reimbursable', 'ასანაზღაურებელი ბარგი'), remainingCap: na('baggage.remainingCap', 'დარჩენილი ზღვარი'), personalCost: na('baggage.personalCost', 'საკუთარი ხარჯი'), perClaim: [], kind: b?.kind ?? null };
    }
    const rules = ['R-BAG-001'];
    let st = 'calculated', reason = 'თითო მოთხოვნა min(ხარჯი, დარჩენილი ზღვარი); ერთი ზღვარი ყველაზე (პ.4ბ).';
    if (b.kind === 'recall-5-1') { st = 'unconfirmed'; rules.push('R-TRAVEL-CALLBACK'); reason += ' გამოძახება — მინისტრის აქტის საფუძველზე (პ.5¹).'; }
    if (b.kind === 'recall' || b.kind === 'recall-5-1') ctx.assume('BAG_RECALL_CAP', 'გამოწვევისას ბარგის ზღვარი ცალკე ითვლება (წარგზავნისას გამოყენებული არ აკლდება) და მოქმედებს იმავე დაწესებულების ზღვარი.', ['R-BAG-001'], 'OQ-16');
    const prev = amt(b.previouslyUsed);
    if (b.previouslyUsed == null) ctx.missing('baggage.previouslyUsed', 'მიუთითეთ ზღვრიდან უკვე გამოყენებული თანხა (0, თუ არაფერი).');
    const blocked = b.kind === 'recall' && b.callbackAlreadyReimbursed;
    const elsewhere = claimsIn.map((c) => c.who !== 'EMP' && famById.get(c.who)?.reimbursedElsewhere?.baggage);
    const amounts = claimsIn.map((c) => amt(c.amount));
    amounts.forEach((a, i) => { if (a == null) ctx.missing(`baggage.claims[${i}].amount`, 'მიუთითეთ ბარგის ფაქტობრივი ხარჯი.'); });
    const capR = bagRow ? R(bagRow.amount) : null;
    const eff = amounts.map((a, i) => (blocked || elsewhere[i] ? (a == null ? null : ZERO) : a));
    const res = baggageReimbursement(capR, prev, eff);
    const claimedR = amounts.some((a) => a == null) ? null : sum(amounts);
    if (blocked) { rules.push('R-TRAVEL-CALLBACK'); reason = 'გამოძახებისას (პ.5¹) უკვე ანაზღაურდა — ამ როტაციაში ხელმეორედ არა (პ.5²).'; }
    const perClaim = claimsIn.map((c, i) => ({ who: c.who, claimed: str(amounts[i]),
      reimbursable: comp(`baggage.claims[${i}]`, 'one-time-reimbursement', `ბარგი — ${c.who === 'EMP' ? 'მოსამსახურე' : famById.get(c.who)?.label ?? c.who}`,
        res?.reimbursements[i] ?? null, cur, res?.reimbursements[i] == null ? 'undetermined' : st,
        elsewhere[i] ? 'სხვა უწყება ანაზღაურებს (დ1 მ.4 პ.4).' : reason, elsewhere[i] ? ['R-FAM-OTHERAGENCY'] : rules) }));
    const reimbR = res?.reimbursable ?? null;
    return {
      kind: b.kind, cap: capC,
      previouslyUsed: comp('baggage.previouslyUsed', 'one-time-reimbursement', 'ზღვრიდან უკვე გამოყენებული', prev, cur, prev == null ? 'undetermined' : 'calculated', '', rules),
      claimed: comp('baggage.claimed', 'one-time-reimbursement', 'მოთხოვნილი ხარჯი', claimedR, cur, claimedR == null ? 'undetermined' : 'calculated', '', rules),
      reimbursable: comp('baggage.reimbursable', 'one-time-reimbursement', 'ასანაზღაურებელი ბარგი', reimbR, cur, reimbR == null ? 'undetermined' : st, reason, rules, { cap: bagRow?.amount ?? null, previouslyUsed: str(prev) }),
      remainingCap: comp('baggage.remainingCap', 'parameter', 'დარჩენილი ზღვარი', res?.remainingCap ?? null, cur, res?.remainingCap == null ? 'undetermined' : 'calculated', '', rules),
      personalCost: comp('baggage.personalCost', 'one-time-reimbursement', 'საკუთარი ხარჯი', reimbR == null || claimedR == null ? null : sub(claimedR, reimbR), cur, reimbR == null ? 'undetermined' : 'calculated', '', rules),
      perClaim,
    };
  }

  // ---------------------------------------------------------------- settlement (pt 7, 9, 10)
  const settlement = settlementBlock();
  function settlementBlock() {
    const s = sc.settlement;
    const id = 'settlement', label = 'პირველადი მოწყობა (ერთჯერადი დახმარება)';
    const posting = isValidDate(s.postingDate) ? s.postingDate : refDate;
    const n = family.filter((m) => rightsById.get(m.id).eligibility.settlement10.value && !(posting && isValidDate(m.to) && compareDates(m.to, posting) < 0)).length;
    ctx.assume('SETTLE_N', 'პირველადი მოწყობის +10% ითვლება წარგზავნისას ოჯახის შემადგენლობაში მყოფ (მხარდაჭერის მიმღებისა და მეურვეობის/მზრუნველობის ქვეშ მყოფის გარდა) წევრებზე; თან ახლება აუცილებელია თუ არა — ღია საკითხი.', ['R-SETTLE-001'], 'OQ-17');
    const employedMember = family.some((m) => m.worksInSameMissionOrCity);
    if (employedMember && !s.exclusion9) ctx.warn('SETTLE_CHECK_9E', 'ოჯახის წევრი იმავე ქალაქში მოსამსახურეა/მივლინებულია — შეამოწმეთ პ.9ე/9ვ (პირველადი მოწყობა შეიძლება არ ეკუთვნოდეს).', ['R-SETTLE-EXCL'], 'settlement.exclusion9');
    const iu = { n, exclusion9: s.exclusion9 ?? null, transfer10: !!s.transfer10, dailyRate: s.dailyRate ?? null, fx: s.fx ?? null };
    if (s.exclusion9) {
      const note = s.exclusion9 === 'f' ? ' (პ.9ვ — ვრცელდება ოჯახის ერთ-ერთ მოსამსახურეზე; ვისზე — OQ-17).' : '';
      return comp(id, 'one-time-allowance', label, ZERO, cur, s.exclusion9 === 'f' ? 'scenario' : 'calculated', `${SETTLEMENT_EXCLUSIONS[s.exclusion9] ?? 'პ.9'} — არ გაიცემა${note}`, ['R-SETTLE-EXCL'], iu);
    }
    const rules = ['R-SETTLE-001', 'R-SETTLE-RATE'];
    if (s.transfer10) { rules.push('R-SETTLE-TRANSFER'); ctx.info('SETTLE_TRANSFER', 'პ.10: სხვა ქალაქში გადაყვანისას ხარჯები ხელახლა ანაზღაურდება (ახალი დაწესებულების ნორმებით).', ['R-SETTLE-TRANSFER'], 'settlement.transfer10'); }
    const dr = s.dailyRate;
    const rate = dr ? amt(dr.amount) : null;
    if (dr && rate != null && !dr.currency) {
      ctx.missing('settlement.dailyRate.currency', 'მიუთითეთ სადღეღამისო ნორმის ვალუტა (ავტომატურად არ ითვლება მისიის ვალუტად).');
      return comp(id, 'one-time-allowance', label, null, cur, 'undetermined', 'ნორმის ვალუტა მითითებული არ არის.', rules, iu);
    }
    if (!dr || rate == null) {
      // normative daily rate (Decree №211 Annex 1): city row first, else country row
      const nr = mission ? dailyRateForMission(data, mission.id) : null;
      if (!nr) {
        return comp(id, 'one-time-allowance', label, null, cur, 'undetermined', 'ამ დაწესებულებისთვის №211 დადგენილების სადღეღამისო ნორმა ნორმატიულ მონაცემებში არ მოიძებნა; შეიძლება შეიყვანოთ ხელით, წყაროთი და თარიღით (P-9).', rules, iu);
      }
      const amountN = settlementAmount(nr.amount, n, param('SETTLEMENT-DSA-MULTIPLIER') ?? '60', param('SETTLEMENT-FAMILY-PCT') ?? '10');
      const iuN = { ...iu, dailyRateId: nr.id, dailyRate: nr.amount, dailyRateCurrency: nr.currency, dailyRateBasis: nr.basis, edition: nr.edition ?? null };
      const where = nr.basis === 'city' ? 'ქალაქის სტრიქონი' : 'ქვეყნის სტრიქონი';
      if (cur && nr.currency !== cur) {
        ctx.warn('SETTLE_NORM_CURRENCY', `სადღეღამისო ნორმა ${nr.currency}-შია, დაწესებულების დაფინანსება — ${cur}-ში. პირველადი მოწყობა ნაჩვენებია ნორმის ვალუტაში; არ გადაიყვანება და ${cur}-ის ჯამებს არ ემატება.`, rules, 'settlement');
        if (s.fx) ctx.info('SETTLE_FX_IGNORED', 'ნორმატიული ნორმისას კურსი არ გამოიყენება — თანხა ნორმის ვალუტაში ჩანს.', rules, 'settlement.fx');
      }
      return comp(id, 'one-time-allowance', label, amountN, nr.currency, 'calculated',
        `№211 დადგენილების დანართი №1 (${where}): ${nr.amount} ${nr.currency} × 60 × (1 + 10% × ${n}) (პ.7).`, rules, iuN);
    }
    ctx.assume('SETTLE_RATE_MANUAL', 'სადღეღამისო ნორმა ხელით არის შეყვანილი — შედეგი დაუდასტურებელია და დადასტურებულ ჯამში არ შედის (P-9).', rules, 'OQ-04');
    const amountR = settlementAmount(rate, n, param('SETTLEMENT-DSA-MULTIPLIER') ?? '60', param('SETTLEMENT-FAMILY-PCT') ?? '10');
    if (dr.currency && cur && dr.currency !== cur) {
      const fx = s.fx ? amt(s.fx.rate) : null;
      if (fx == null) {
        ctx.warn('SETTLE_OTHER_CURRENCY', `ნორმა ${dr.currency}-შია, დაწესებულება — ${cur}-ში; კურსის გარეშე ვალუტები არ იკრიბება.`, rules, 'settlement.fx');
        return comp(id, 'one-time-allowance', label, amountR, dr.currency, 'unconfirmed', `ნორმა × 60 × (1 + 10% × ${n}) — ${dr.currency}-ში (მისიის ვალუტაში არ არის გადაყვანილი).`, rules, iu);
      }
      return comp(id, 'one-time-allowance', label, mul(amountR, fx), cur, 'unconfirmed', `ნორმა × 60 × (1 + 10% × ${n}) × კურსი ${s.fx.rate} (${s.fx.date ?? '?'}, ${s.fx.source ?? '?'})`, rules, iu);
    }
    return comp(id, 'one-time-allowance', label, amountR, dr.currency, 'unconfirmed', `ნორმა × 60 × (1 + 10% × ${n}); მხარდაჭერის მიმღები და მეურვეობის/მზრუნველობის ქვეშ მყოფი არ ითვლება.`, rules, iu);
  }

  // ---------------------------------------------------------------- travel
  const ownCarSeen = new Set();
  // pts 12b/12c: the comparator caps the TOTAL of a person's vacation tickets in a year (LR-25)
  const vacGroups = new Map();
  sc.travel.forEach((t) => {
    if (!t || t.kind !== 'vacation') return;
    const key = `${t.personId}|${isValidDate(t.date) ? t.date.slice(0, 4) : '?'}`;
    const g = vacGroups.get(key) || { n: 0, comparable: null, remaining: null, comparables: new Set() };
    g.n++;
    const c = amt(t.comparableTicket);
    if (c != null) { g.comparables.add(toExactString(c)); if (g.comparable == null) { g.comparable = c; g.remaining = c; } }
    vacGroups.set(key, g);
  });
  const travel = sc.travel.filter((t) => t && typeof t === 'object').map((t, i) => {
    const id = `travel[${i}]`;
    const who = t.personId === 'EMP' ? 'მოსამსახურე' : famById.get(t.personId)?.label ?? t.personId;
    const label = `მგზავრობა — ${who} (${t.kind})`;
    const actual = amt(t.actualCost), comparable = amt(t.comparableTicket);
    const m = famById.get(t.personId);
    const iu = { kind: t.kind, personId: t.personId, actualCost: str(actual), comparableTicket: str(comparable), route: t.route ?? null, ownCar: !!t.ownCar };
    if (m?.reimbursedElsewhere?.travel) return comp(id, 'one-time-reimbursement', label, ZERO, cur, 'calculated', 'სხვა უწყება ანაზღაურებს (დ1 მ.4 პ.4).', ['R-FAM-OTHERAGENCY'], iu);
    if (t.kind === 'recall-5-1') {
      if (actual == null) ctx.missing(`${id}.actualCost`, 'მიუთითეთ ბილეთის ფაქტობრივი ღირებულება.');
      return comp(id, 'one-time-reimbursement', label, actual, cur, actual == null ? 'undetermined' : 'unconfirmed', 'გამოძახება მინისტრის ინდივიდუალური აქტით (პ.5¹) — ჩვეულებრივი ნორმებით; ამავე როტაციის გამოწვევისას ხელმეორედ არ ანაზღაურდება (პ.5²).', ['R-TRAVEL-CALLBACK', 'R-TRAVEL-001'], iu);
    }
    if (t.callbackAlreadyReimbursed && t.kind === 'recall') return comp(id, 'one-time-reimbursement', label, ZERO, cur, 'calculated', 'გამოძახებისას (პ.5¹) უკვე ანაზღაურდა (პ.5²).', ['R-TRAVEL-CALLBACK'], iu);
    if (t.ownCar && (t.kind === 'departure' || t.kind === 'recall')) {
      const key = t.kind;
      if (ownCarSeen.has(key)) {
        ctx.assume('TRAVEL_CAR_ONCE', 'საკუთარი ავტომანქანის კომპენსაცია ერთი ბილეთის ოდენობით ერთხელ გაიცემა და მგზავრთა რაოდენობაზე არ მრავლდება.', ['R-TRAVEL-CAR'], 'OQ-31');
        return comp(id, 'one-time-reimbursement', label, ZERO, cur, 'calculated', 'ავტომანქანის კომპენსაცია უკვე ჩათვლილია (ერთი ბილეთი).', ['R-TRAVEL-CAR'], iu);
      }
      ownCarSeen.add(key);
      if (comparable == null) ctx.missing(`${id}.comparableTicket`, 'მიუთითეთ ეკონომ კლასის ერთი მიმართულების ავიაბილეთის ღირებულება.');
      return comp(id, 'one-time-reimbursement', label, comparable, cur, comparable == null ? 'undetermined' : 'calculated', 'ერთი ეკონომ ავიაბილეთის 100% (პ.5).', ['R-TRAVEL-CAR'], iu);
    }
    if (actual == null) ctx.missing(`${id}.actualCost`, 'მიუთითეთ ბილეთის ფაქტობრივი ღირებულება.');
    const capped = (rules, reason) => {
      if (comparable == null) { ctx.missing(`${id}.comparableTicket`, 'მიუთითეთ შესადარებელი (საქართველოს მიმართულების) ეკონომ ბილეთის ღირებულება.'); return comp(id, 'one-time-reimbursement', label, null, cur, 'undetermined', reason, rules, iu); }
      return comp(id, 'one-time-reimbursement', label, actual == null ? null : min(actual, comparable), cur, actual == null ? 'undetermined' : 'calculated', reason, rules, iu);
    };
    if (t.kind === 'vacation') {
      const r = m ? rightsById.get(m.id).eligibility.vacationTravel : right(true, '', ['R-VAC-TICKETS']);
      if (r.value === false) return comp(id, 'one-time-reimbursement', label, ZERO, cur, 'calculated', r.reason_ka, r.ruleIds, iu);
      if (t.interruptedLeave && t.personId !== 'EMP') return comp(id, 'one-time-reimbursement', label, ZERO, cur, 'calculated', 'შეწყვეტილი შვებულების დარჩენილი ნაწილისას მგზავრობა უნაზღაურდება მხოლოდ მოსამსახურეს (პ.16).', ['R-VAC-OTHER'], iu);
      ctx.info('VAC_ONCE', 'შვებულების ბილეთები — წელიწადში ერთხელ; ზღვარი — საქართველოს ორმხრივი ეკონომ ბილეთი, ერთი მგზავრის ყველა ბილეთის ჯამზე (პ.12ბ–გ).', ['R-VAC-TICKETS'], id);
      const key = `${t.personId}|${isValidDate(t.date) ? t.date.slice(0, 4) : '?'}`;
      const g = vacGroups.get(key);
      if (g.comparables.size > 1) ctx.warn('VAC_COMPARATOR_DIFF', 'ერთი მგზავრის ბილეთებზე სხვადასხვა შესადარებელი ფასია მითითებული; გამოყენებულია პირველი.', ['R-VAC-TICKETS'], id);
      let st = 'calculated';
      if (g.n > 1) {
        st = 'scenario';
        ctx.assume('VAC_TOTAL_CAP', 'შვებულების ზღვარი ვრცელდება ერთი მგზავრის წლის ყველა ბილეთის ჯამზე (პ.12ბ–გ „მათი საერთო ღირებულება“).', ['R-VAC-TICKETS'], 'OQ-32');
        ctx.warn('VAC_MULTIPLE', 'ერთ პირზე/წელზე რამდენიმე შვებულების მგზავრობაა: ნაწილ-ნაწილ შვებულებისას მგზავრობა ანაზღაურდება მხოლოდ ერთხელ (პ.12დ), ოჯახის წევრებს — წელიწადში ერთხელ (პ.14). ზღვარი ჯამზეა; შედეგი სცენარია.', ['R-VAC-TICKETS'], id);
      }
      if (g.comparable == null) { ctx.missing(`${id}.comparableTicket`, 'მიუთითეთ საქართველოს ორმხრივი ეკონომ ბილეთის ღირებულება.'); return comp(id, 'one-time-reimbursement', label, null, cur, 'undetermined', 'შესადარებელი ბილეთი უცნობია.', ['R-VAC-TICKETS'], iu); }
      if (actual == null) return comp(id, 'one-time-reimbursement', label, null, cur, 'undetermined', 'ფაქტობრივი ღირებულება უცნობია.', ['R-VAC-TICKETS'], iu);
      const re = min(actual, g.remaining);
      g.remaining = sub(g.remaining, re);
      return comp(id, 'one-time-reimbursement', label, re, cur, st, 'Σ ფაქტობრივი (მგზავრზე, წელიწადში) ≤ საქართველოს ორმხრივი ეკონომ ბილეთი (პ.12ბ–გ)', ['R-VAC-TICKETS'], { ...iu, capRemainingAfter: str(g.remaining) });
    }
    if (t.kind === 'bereavement-17') {
      if (t.personId !== 'EMP') return comp(id, 'one-time-reimbursement', label, ZERO, cur, 'calculated', 'პ.17 ეხება მხოლოდ მოსამსახურეს.', ['R-VAC-OTHER'], iu);
      return comparable == null
        ? comp(id, 'one-time-reimbursement', label, actual, cur, actual == null ? 'undetermined' : 'calculated', 'საქართველოში ორმხრივი ეკონომ ბილეთი (პ.17).', ['R-VAC-OTHER'], iu)
        : capped(['R-VAC-OTHER'], 'საქართველოში ორმხრივი ეკონომ ბილეთი (პ.17).');
    }
    if (t.route === 'third-country') {
      if (t.kind === 'departure') ctx.assume('TRAVEL_THIRD_DEPARTURE', 'წარგზავნა მესამე ქვეყნიდან — ზღვრად გამოყენებულია საქართველოს მიმართულების ბილეთი.', ['R-TRAVEL-001'], 'OQ-33');
      return capped(['R-TRAVEL-001'], 'მესამე ქვეყანაში — არაუმეტეს საქართველოს ეკონომ ბილეთისა (პ.4ა).');
    }
    return comp(id, 'one-time-reimbursement', label, actual, cur, actual == null ? 'undetermined' : 'calculated', 'ეკონომ კლასის ბილეთის ფაქტობრივი ღირებულება (პ.4ა).', ['R-TRAVEL-001'], iu);
  });

  // ---------------------------------------------------------------- advances (pt 22–27)
  const rentAdvanceEnds = [];
  const advances = sc.advances.filter((a) => a && typeof a === 'object').map((a, i) => {
    const id = `advances[${i}]`;
    let overlap = false;
    if (a.kind === 'rent') {
      if (isValidDate(a.issueDate)) {
        overlap = rentAdvanceEnds.some((end) => compareDates(a.issueDate, end) < 0);
        if (Number.isInteger(a.months)) rentAdvanceEnds.push(addMonths(a.issueDate, a.months));
      } else if (rentAdvanceEnds.length) overlap = true;
      if (overlap) ctx.error('ADV_SECOND_BEFORE_REPAYMENT', 'ქირის ავანსი ხელმეორედ გაიცემა მხოლოდ წინა ავანსის სრულად დაბრუნების შემდეგ (პ.26).', ['R-ADV-RENT'], `${id}.issueDate`);
    }
    const amount = amt(a.amount);
    const months = Number.isInteger(a.months) ? a.months : null;
    const rules = a.kind === 'rent' ? ['R-ADV-RENT', 'R-ADV-027'] : ['R-ADV-027'];
    const g = a.kind === 'rent' ? (isValidDate(a.issueDate) ? rentAt(a.issueDate) : G0) : null;
    const limit = g == null ? null : mul(g, param('RENT-ADVANCE-MAX-MONTHS-RENT') ?? '6');
    const maxMonths = Number(param('RENT-ADVANCE-REPAY-MONTHS') ?? '6');
    let requiresMinisterOrder = null, status = 'calculated';
    const reasons = [];
    if (a.kind === 'rent') {
      if (amount != null && limit != null) requiresMinisterOrder = gt(amount, limit) || (months != null && months > maxMonths);
      else if (months != null && months > maxMonths) requiresMinisterOrder = true;
      if (requiresMinisterOrder) {
        status = 'unconfirmed';
        reasons.push(a.ministerOrder22 ? 'ზღვარს აღემატება — მინისტრის ბრძანებით (პ.22), დასადასტურებელია.' : 'ზღვარს აღემატება (6 თვის ქირა / 6 თვე) — საჭიროა მინისტრის ბრძანება (პ.22).');
        if (!a.ministerOrder22) ctx.warn('ADV_LIMIT', 'ქირის ავანსი აღემატება 6 თვის ქირას ან დაბრუნების 6-თვიან ვადას — საჭიროა მინისტრის ბრძანება (პ.22).', ['R-ADV-RENT'], id);
      } else if (requiresMinisterOrder === null) { status = 'undetermined'; reasons.push('ზღვრის შესამოწმებლად საჭიროა ქირა და თანხა.'); }
      else reasons.push('არაუმეტეს 6 თვის ქირისა; დაბრუნება ≤ 6 თვეში (პ.22).');
    } else { status = 'unconfirmed'; reasons.push('პ.27-ის შემთხვევა — ხელით, დასადასტურებელი.'); }
    if (overlap) { status = 'unconfirmed'; reasons.push('წინა ქირის ავანსი ჯერ დაბრუნებული არ არის (პ.26).'); }
    ctx.assume('ADV_EQUAL_REPAYMENT', 'ავანსი ბრუნდება თანაბარი ყოველთვიური ნაწილებით; ავანსი შემოსავალს ან ანაზღაურებათა ჯამს არ ზრდის.', ['R-ADV-RENT'], 'OQ-19');
    const sched = advanceSchedule(amount, months);
    return {
      id, kind: a.kind, issueDate: a.issueDate ?? null, months, requiresMinisterOrder, status: amount == null ? 'undetermined' : status, ruleIds: rules,
      amount: comp(`${id}.amount`, 'advance', 'ავანსი (დასაბრუნებელი)', amount, cur, amount == null ? 'undetermined' : status, reasons.join(' '), rules, { limit: str(limit), months }),
      limit: comp(`${id}.limit`, 'parameter', 'ავანსის ზღვარი (6 × ქირა)', limit, cur, limit == null ? (a.kind === 'rent' ? 'undetermined' : 'not_applicable') : gStatus, '', ['R-ADV-RENT']),
      monthlyRepayment: comp(`${id}.monthlyRepayment`, 'liability', 'ყოველთვიური დაბრუნება', sched?.monthlyRepayment ?? null, cur, sched ? 'calculated' : 'undetermined', 'ავანსი / თვეები', rules),
      schedule: sched ? sched.schedule.map((s) => ({ month: isValidDate(a.issueDate) ? monthKey(addMonths(a.issueDate, s.index)) : `+${s.index}`, repayment: toFixed2(s.repayment), outstanding: toFixed2(s.outstanding), repaymentExact: str(s.repayment), outstandingExact: str(s.outstanding) })) : [],
    };
  });

  // ---------------------------------------------------------------- extras
  const extras = sc.extras.filter((x) => x && typeof x === 'object').map((x, i) => {
    const id = `extras[${i}]`;
    const a = amt(x.amount);
    const rules = EXTRA_RULES[x.category] || [];
    const manual = x.ministerDecisionRequired || ['early-termination-28', 'other', 'covid-aid-6-2', 'head-residence-29'].includes(x.category) || !EXTRA_RULES[x.category];
    if (x.category === 'head-residence-29') ctx.assume('HEAD_RESIDENCE_29', 'ხელმძღვანელის რეზიდენციის ხარჯი (პ.29) და ქირის სუბსიდია F ერთდროულად — ორმაგი დაფინანსების რისკი; F ავტომატურად არ იცვლება.', ['R-HEADRES-029'], 'OQ-24');
    if (!x.justification) ctx.warn('EXTRA_JUSTIFICATION', 'ხარჯს დაურთეთ საფუძველი/დოკუმენტი.', rules, `${id}.justification`, 'info');
    if (a == null) ctx.missing(`${id}.amount`, 'მიუთითეთ ფაქტობრივი თანხა.');
    return comp(id, x.category === 'covid-aid-6-2' ? 'one-time-allowance' : 'one-time-reimbursement', EXTRA_CATEGORIES[x.category] ?? 'სხვა ხარჯი', a, cur, a == null ? 'undetermined' : manual ? 'unconfirmed' : 'calculated',
      manual ? 'მინისტრის გადაწყვეტილებით — ავტომატურად არ დასტურდება.' : 'ფაქტობრივი, დოკუმენტით დადასტურებული ხარჯი.', rules, { category: x.category, justification: x.justification ?? null });
  });

  // ---------------------------------------------------------------- pt 18/19 retention of the allowance
  const retention19 = (() => {
    const rt = raw.retention19;
    if (!rt || typeof rt !== 'object' || !rt.applies) return comp('retention19', 'monthly', 'თანხის შენარჩუნება შეჩერებისას (პ.19)', null, cur, 'not_applicable', 'არ არის მონიშნული.', ['R-RETAIN-019']);
    ctx.info('RETAIN_18', 'პ.18: შრომისუუნარობის, გარდაცვალების გამო შვებულებისა და საპატიო მგზავრობის დღეებში თანხა ჩვეულებრივ გრძელდება.', ['R-RETAIN-018'], 'retention19');
    if (!isValidDate(rt.from) || !isValidDate(rt.to) || compareDates(rt.to, rt.from) < 0) {
      ctx.missing('retention19.from', 'მიუთითეთ შენარჩუნების პერიოდი (დან/მდე).');
      return comp('retention19', 'monthly', 'თანხის შენარჩუნება შეჩერებისას (პ.19)', null, cur, 'undetermined', 'პერიოდი უცნობია.', ['R-RETAIN-019']);
    }
    const limitEnd = addDays(addMonths(rt.from, 1), -1);
    if (compareDates(rt.to, limitEnd) > 0) ctx.warn('RETAIN_LIMIT', 'პ.19: შენარჩუნება — არაუმეტეს ერთი თვისა (მინისტრის გადაწყვეტილებით).', ['R-RETAIN-019'], 'retention19.to');
    const to = compareDates(rt.to, limitEnd) > 0 ? limitEnd : rt.to;
    const S = rat(fm.S);
    let v = null;
    if (S != null) v = segmentPeriod(rt.from, to).reduce((acc, sg) => add(acc, prorate(S, sg.days, sg.daysInMonth)), ZERO);
    if (!rt.decisionRef) ctx.warn('RETAIN_DECISION', 'პ.19: საჭიროა მინისტრის გადაწყვეტილების რეკვიზიტი.', ['R-RETAIN-019'], 'retention19.decisionRef');
    return comp('retention19', 'monthly', 'თანხის შენარჩუნება შეჩერებისას (პ.19)', v, cur, v == null ? 'undetermined' : 'unconfirmed',
      'S × დღეები / თვის დღეები, ≤ 1 თვე; მინისტრის გადაწყვეტილებით — დასადასტურებელია.', ['R-RETAIN-019'], { from: rt.from, to, decisionRef: rt.decisionRef ?? null });
  })();

  // ---------------------------------------------------------------- vacation month (pt 12a) — never added automatically
  const vacationMonth = comp('vacationMonth', 'one-time-allowance', 'შვებულების ერთთვიანი თანხა (პ.12ა)', rat(fm.S), cur, fm.S.status === 'undetermined' ? 'undetermined' : 'scenario',
    'წელიწადში ერთხელ, სრული თვის S; წლიურ ჯამში ავტომატურად არ ემატება; რომელი თვის S — OQ-15.', ['R-VAC-MONTH']);

  // ---------------------------------------------------------------- fx forecast (pt 2)
  const usdRate = param('FX-FORECAST-GEL-PER-USD') ?? '2.8', eurRate = param('FX-FORECAST-GEL-PER-EUR') ?? '3.2';
  const fx = {
    forecast: {
      USD: usdRate, EUR: eurRate, purpose_ka: 'საპროგნოზო კურსი (პ.2) — არა საანგარიშსწორებო', ruleIds: ['R-FX-FORECAST'],
      usableForSettlement: false,
      illustrativeS_GEL: comp('fx.S_GEL', 'parameter', 'S ლარში — საილუსტრაციო (საპროგნოზო კურსით)', rat(fm.S) == null || !cur ? null : mul(rat(fm.S), cur === 'EUR' ? eurRate : usdRate), 'GEL',
        fm.S.status === 'undetermined' ? 'undetermined' : 'scenario', 'მხოლოდ საპროგნოზო; დაფინანსება — დაფინანსების დღის კურსით (R-FX-FUNDING).', ['R-FX-FORECAST', 'R-FX-FUNDING']),
    },
  };

  // ---------------------------------------------------------------- totals & completeness
  const oneTimeItems = [settlement, broker, baggage.reimbursable, ...travel, ...extras];
  const reimbItems = [...oneTimeItems, ...perPerson.filter((p) => p.entered).map((p) => p.reimbursable)];
  const entered = reimbItems.filter((c) => c.status !== 'not_applicable' && !(c === settlement && c.status === 'undetermined' && !sc.settlement.dailyRate && !sc.settlement.exclusion9));
  const inCur = (c) => c.currency === cur;
  const sumOf = (cs) => (cs.length ? sum(cs.map(rat)) : ZERO);
  const confirmed = entered.filter((c) => c.status === 'calculated' && inCur(c));
  const pending = entered.filter((c) => (c.status === 'scenario' || c.status === 'unconfirmed') && inCur(c));
  const totals = {
    oneTimeConfirmed: comp('totals.oneTimeConfirmed', 'one-time-reimbursement', 'ერთჯერადი ანაზღაურებები და დაზღვევა — დადასტურებული ნაწილი', sumOf(confirmed), cur, cur ? 'calculated' : 'undetermined',
      'მხოლოდ „გამოთვლილი“ სტატუსის თანხები დაწესებულების ვალუტაში. ავანსები, წლიური ზღვრები და შვებულების თვე არ შედის.', ['R-ROUND-001'], { ids: confirmed.map((c) => c.id) }),
    oneTimePending: comp('totals.oneTimePending', 'one-time-reimbursement', 'სცენარული / დაუდასტურებელი ნაწილი', sumOf(pending), cur, pending.length ? 'unconfirmed' : 'calculated',
      'ცალკე ჩანს; დადასტურებულ ჯამს არ ემატება.', ['R-ROUND-001'], { ids: pending.map((c) => c.id) }),
    undeterminedIds: entered.filter((c) => c.status === 'undetermined').map((c) => c.id),
    otherCurrencyIds: entered.filter((c) => c.status !== 'undetermined' && !inCur(c)).map((c) => c.id),
  };
  const essential = [datesMode ? periodTotal : fm.S, remainder.value, ...entered, retention19];
  let completeness = 'complete';
  if (rat(fm.D) == null && !(datesMode && periodSegments.some((s) => s.fullMonth.D.value != null))) completeness = 'incomplete';
  else if (ctx.missingInputs.length || essential.some((c) => c && (c.status === 'undetermined' || c.status === 'unconfirmed'))) completeness = 'partial';
  if (ctx.errors.length && completeness === 'complete') completeness = 'partial';

  const inputsUsed = {
    missionId: mission?.id ?? null, mission_ka: mission?.name_ka ?? null, countryId: mission?.countryId ?? null, locationId: mission?.locationId ?? null,
    currency: cur, coefficientId: kRow?.id ?? null, coefficientBasis: mission?.costCoefficientBasis ?? null,
    insuranceCapId: mission?.insuranceCapId ?? null, baggageCapId: mission?.baggageCapId ?? null,
    positionMode: mode, positionEntryId: pos0.entry?.id ?? null, positionPercent: A, rentHead: sc.status.rentHead, headBasis: sc.status.headBasis,
    rentBasis: sc.rent.basis, periodMode: datesMode ? 'dates' : 'full-month', period: datesMode ? { start: sc.period.start, end: sc.period.end } : null,
    familyCount: family.length,
  };
  ctx.assume('ROUNDING', 'გამოთვლა ზუსტია (რაციონალური რიცხვები); ეკრანზე და ბეჭდვაში მხოლოდ საბოლოო მნიშვნელობა მრგვალდება 2 ათწილადამდე (half-up, P-1). ჯამი ითვლება ზუსტი მნიშვნელობებიდან.', ['R-ROUND-001'], 'OQ-28');

  return {
    schemaVersion: 1, rulesVersion: data.rulesVersion, currency: cur, completeness, missingInputs: ctx.missingInputs, inputsUsed,
    monthly, family: familyOut, periodSegments, periodTotal, education, remainder,
    insurance: { perPerson },
    oneTimeAllowances: { settlement, vacationMonth, retention19 },
    oneTimeReimbursements: { broker, baggage, travel, extras },
    annualCaps: { insurance: annualCaps },
    advances, fx, totals,
    warnings: ctx.warnings, errors: ctx.errors, assumptions: ctx.assumptions,
  };
}

function fReason(c) {
  return {
    unknown: 'ქირა უცნობია — F დაუდგენელია.',
    zero: 'G = 0 ⇒ F = 0 (დ1 მ.3 დ.ა).',
    below: '0 < G < T ⇒ F = T (დ1 მ.3 დ.ბ).',
    equal: 'G = T ⇒ F = T (ინტერპრეტაცია, OQ-01).',
    head: 'F = T + min(80% × (G − T), 2T) (დ1 მ.3 დ.გ.ა).',
    other: 'F = T + min(50% × (G − T), T) (დ1 მ.3 დ.გ.ბ).',
    'needs-head': 'G > T: საჭიროა ხელმძღვანელის სტატუსი.',
  }[c];
}
