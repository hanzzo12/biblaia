// Pure normative formulas on exact rationals (no scenario/data plumbing).
// Each function returns plain values; `calculate.js` wraps them into Components.
import { R, ZERO, add, sub, mul, div, pct, min, max, cmp, isZero, gt, lt, le, sum } from './rational.js';
import { addMonths, compareDates, isValidDate } from './calendar.js';

export const Q_DEFAULT = '7';
export const BANDS = ['0-18', '19-24', '25-29', '30-34', '35-39', '40-44', '45-49', '50-54', '55-59', '60-64', '65-69', '70+'];

/** D = H × A% × K × (100 + C·Q)%  (R-D-001). Any null → null. */
export function personalRate(H, A, K, C, Q = Q_DEFAULT) {
  if (H == null || A == null || K == null || C == null) return null;
  return mul(mul(mul(R(H), pct(A)), R(K)), pct(add(100, mul(C, Q))));
}

/** T = D × E%  (R-T-001). */
export const rentShare = (D, E) => (D == null || E == null ? null : mul(R(D), pct(E)));

/**
 * F per Annex 1 art. 3(d). head: true | false | null (null only matters when G > T).
 * @returns {{ F: import('./rational.js').Rational|null, case: 'unknown'|'zero'|'below'|'equal'|'head'|'other'|'needs-head', ruleIds: string[] }}
 */
export function rentSubsidy(T, G, head) {
  if (T == null || G == null) return { F: null, case: 'unknown', ruleIds: ['R-RENT-UNKNOWN'] };
  T = R(T); G = R(G);
  if (isZero(G)) return { F: ZERO, case: 'zero', ruleIds: ['R-RENT-F-ZERO'] };
  const c = cmp(G, T);
  if (c < 0) return { F: T, case: 'below', ruleIds: ['R-RENT-F-BELOW'] };
  if (c === 0) return { F: T, case: 'equal', ruleIds: ['R-RENT-F-EQUAL'] };
  if (head == null) return { F: null, case: 'needs-head', ruleIds: ['R-HEAD-RENT'] };
  const excess = sub(G, T);
  if (head) return { F: add(T, min(mul(excess, pct(80)), mul(T, 2))), case: 'head', ruleIds: ['R-RENT-F-HEAD'] };
  return { F: add(T, min(mul(excess, pct(50)), T)), case: 'other', ruleIds: ['R-RENT-F-OTHER'] };
}

/** Full-month block: D, T, F, S, uncoveredRent, rentSurplus. */
export function monthlyRate({ H, A, K, E, C, G, head, Q = Q_DEFAULT }) {
  const D = personalRate(H, A, K, C, Q);
  const T = rentShare(D, E);
  const f = rentSubsidy(T, G, head);
  const S = D != null && T != null && f.F != null ? add(sub(D, T), f.F) : null;
  const g = G == null ? null : R(G);
  return {
    D, T, F: f.F, S, fCase: f.case, fRuleIds: f.ruleIds,
    DminusT: D != null && T != null ? sub(D, T) : null,
    uncoveredRent: g != null && f.F != null ? max(sub(g, f.F), ZERO) : null,
    rentSurplus: g != null && f.F != null ? max(sub(f.F, g), ZERO) : null,
  };
}

/** Segment amount = full-month rate × days / days in month (R-PRORATE-001, P-2). */
export const prorate = (rate, days, monthDays) => (rate == null ? null : div(mul(R(rate), days), monthDays));

/** Education: reimb = min(P, L) + 80% × max(P − L, 0)  (R-EDU-LIMIT, R-EDU-EXCESS). */
export function educationReimbursement(P, L, excessPct = '80') {
  if (P == null || L == null) return { reimbursement: null, personalCost: null };
  P = R(P); L = R(L);
  const reimbursement = add(min(P, L), mul(max(sub(P, L), ZERO), pct(excessPct)));
  return { reimbursement, personalCost: sub(P, reimbursement) };
}

/** Adult child note after pt 43: in general school, host-state consent, < 1 year after majority. */
export function adultChildEligible({ inSchool, hostConsent, monthsSinceMajority }) {
  if (inSchool == null || hostConsent == null || monthsSinceMajority == null) return null;
  return !!inSchool && !!hostConsent && monthsSinceMajority < 12;
}

/** Age band key of Annexes 7/8; null age → null (undetermined, never "0-18"). */
export function insuranceBand(age) {
  if (age === null || age === undefined || age === '') return null;
  const a = Number(age);
  if (!Number.isInteger(a) || a < 0 || a > 130) return null;
  if (a <= 18) return '0-18';
  if (a >= 70) return '70+';
  const lo = a <= 24 ? 19 : a - ((a - 25) % 5);
  return lo === 19 ? '19-24' : `${lo}-${lo + 4}`;
}

/** Insurance: reimbursable = min(policy, cap − already) (R-INS-001). */
export function insuranceReimbursement(cap, policyCost, alreadyReimbursed) {
  if (cap == null || policyCost == null || alreadyReimbursed == null) {
    return { reimbursable: null, personalCost: null, remainingCap: null };
  }
  const room = max(sub(cap, alreadyReimbursed), ZERO);
  const reimbursable = min(R(policyCost), room);
  return { reimbursable, personalCost: sub(policyCost, reimbursable), remainingCap: sub(room, reimbursable) };
}

/**
 * Broker window (pt 8): eligible when serviceDate is before rotationStart + 6 months; the
 * day exactly 6 months later and dates before the posting are undetermined (OQ-18).
 * @returns {true|false|null}
 */
export function brokerWindow(rotationStartDate, serviceDate, months = 6) {
  if (!isValidDate(rotationStartDate) || !isValidDate(serviceDate)) return null;
  if (compareDates(serviceDate, rotationStartDate) < 0) return null;
  const end = addMonths(rotationStartDate, months);
  const c = compareDates(serviceDate, end);
  return c < 0 ? true : c === 0 ? null : false;
}

/** Broker amount = min(fee × rate, one month's rent) (R-BROKER-001). */
export function brokerAmount(fee, monthlyRent, head) {
  if (fee == null || monthlyRent == null || head == null) return null;
  return min(mul(fee, pct(head ? 80 : 50)), R(monthlyRent));
}

/** Baggage: one combined cap, claims reimbursed in order (R-BAG-001). Null claim → stops (undetermined). */
export function baggageReimbursement(cap, previouslyUsed, claims) {
  if (cap == null || previouslyUsed == null) return null;
  let remaining = max(sub(cap, previouslyUsed), ZERO);
  const reimbursements = [];
  let claimed = ZERO, total = ZERO, undetermined = false;
  for (const c of claims) {
    if (c == null || undetermined) { undetermined = true; reimbursements.push(null); continue; }
    const r = min(R(c), remaining);
    reimbursements.push(r);
    remaining = sub(remaining, r);
    claimed = add(claimed, c);
    total = add(total, r);
  }
  if (undetermined) return { reimbursements, claimed: null, reimbursable: null, remainingCap: null, personalCost: null };
  return { reimbursements, claimed, reimbursable: total, remainingCap: remaining, personalCost: sub(claimed, total) };
}

/** Settlement = dailyRate × 60 × (1 + 10% × n) (R-SETTLE-001). */
export function settlementAmount(dailyRate, n, multiplier = '60', familyPct = '10') {
  if (dailyRate == null || n == null) return null;
  return mul(mul(R(dailyRate), multiplier), add(1, mul(n, pct(familyPct))));
}

/** Advance repayment schedule: equal monthly parts (OQ-19). */
export function advanceSchedule(amount, months) {
  if (amount == null || !Number.isInteger(months) || months < 1) return null;
  const monthly = div(amount, months);
  const schedule = [];
  let outstanding = R(amount);
  for (let i = 1; i <= months; i++) {
    const repayment = i === months ? outstanding : monthly;
    outstanding = sub(outstanding, repayment);
    schedule.push({ index: i, repayment, outstanding });
  }
  return { monthlyRepayment: monthly, schedule };
}

export const totalOf = (xs) => (xs.some((x) => x == null) ? null : sum(xs));
export { gt, lt, le };
