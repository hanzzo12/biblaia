// @ts-check
/**
 * საორიენტაციო თვიური ხარჯი (ქირის გარეშე) ყველა ქალაქისთვის ერთნაირად (მომხმარებლის მოთხოვნა, რაუნდი 5).
 * Numbeo-ს რეალური ბიუჯეტი (`basis: "numbeo"`) მხოლოდ ~41 ქალაქს აქვს. დანარჩენისთვის:
 *   budget_city = budget_NYC × costOfLivingIndex_city / 100     (Numbeo-ს განმარტებით ინდექსი = ქალაქის ხარჯი / NYC × 100, ქირის გარეშე)
 * `basis: "estimated-from-index"`, `estimated: true`, გაფრთხილება `budget_estimated`.
 * NYC-ის ბიუჯეტი: მომხმარებლის ასლის US-NEW-YORK ჩანაწერიდან; თუ იქ არ არის (31.10.2026-ის ასლში null) —
 * ყველა რეალური ბიუჯეტის „ნაგულისხმევი NYC ბიუჯეტის“ (budget × 100 / index) მედიანა (41 ქალაქი, გაბნევა ±8%).
 * ყველაფერი ზუსტი რაციონალებით (BigInt), დამრგვალება ბოლოს — 2 ათწილადი, half-up; EUR — usdPerEur.exact.
 */
import { STATUSES_WITH_VALUE, toDecimalString } from './market-contract.js';
import { parseRate } from './snapshot.js';

export const BUDGET_ESTIMATE_MESSAGE_KA = '≈ შეფასებულია Numbeo-ს ინდექსით: ნიუ-იორკის ხარჯი × ინდექსი / 100';

/** @param {string} d @returns {[bigint, bigint]} */
function rat(d) { const [i, f = ''] = d.split('.'); return [BigInt(i + f), 10n ** BigInt(f.length)]; }
/** @param {[bigint, bigint]} a @param {[bigint, bigint]} b */
const cmp = (a, b) => { const x = a[0] * b[1]; const y = b[0] * a[1]; return x < y ? -1 : x > y ? 1 : 0; };
/** @param {[bigint, bigint]} r @returns {string|null} */
function round2(r) {
  const [num0, den] = r; const num = num0 * 100n;
  let n = num / den;
  if ((num % den) * 2n >= den) n += 1n;
  return n === 0n ? null : `${n / 100n}.${(n % 100n).toString().padStart(2, '0')}`;
}

/** @type {WeakMap<object, any>} */
const refCache = new WeakMap();

/**
 * NYC-ის საცნობარო ბიუჯეტი USD-ში (რაციონალი) თითო ტიპზე.
 * @param {any} userSnapshot
 * @returns {{ single: [bigint, bigint]|null, family4: [bigint, bigint]|null, basis: 'nyc-entry'|'median-implied', n: { single: number, family4: number } } | null}
 */
export function nycBudgetReference(userSnapshot) {
  if (!userSnapshot || !userSnapshot.cities) return null;
  if (refCache.has(userSnapshot)) return refCache.get(userSnapshot);
  const nyc = userSnapshot.cities['US-NEW-YORK'];
  /** @type {any} */
  const out = { single: null, family4: null, basis: 'median-implied', n: { single: 0, family4: 0 } };
  for (const kind of /** @type {const} */ (['single', 'family4'])) {
    const own = toDecimalString(nyc?.budget?.[kind]?.average);
    if (own) { out[kind] = rat(own); out.basis = 'nyc-entry'; out.n[kind] = 1; continue; }
    /** @type {[bigint, bigint][]} */
    const implied = [];
    for (const c of Object.values(userSnapshot.cities)) {
      const b = toDecimalString(/** @type {any} */ (c)?.budget?.[kind]?.average);
      const i = toDecimalString(/** @type {any} */ (c)?.indices?.costOfLiving);
      if (!b || !i) continue;
      const [bn, bd] = rat(b); const [in_, id] = rat(i);
      implied.push([bn * 100n * id, bd * in_]); // b × 100 / i
    }
    if (!implied.length) continue;
    implied.sort(cmp);
    const m = implied.length;
    out[kind] = m % 2 ? implied[(m - 1) / 2] : (() => { const a = implied[m / 2 - 1]; const b2 = implied[m / 2]; return /** @type {[bigint, bigint]} */ ([a[0] * b2[1] + b2[0] * a[1], 2n * a[1] * b2[1]]); })();
    out.n[kind] = m;
  }
  refCache.set(userSnapshot, out);
  return out;
}

/**
 * შეფასება ინდექსიდან, მისიის ვალუტაში. @param {any} userSnapshot @param {string} indexDec costOfLiving @param {'EUR'|'USD'} currency
 * @returns {{ single: { average: string, low: null, high: null }|null, family4: { average: string, low: null, high: null }|null } | null}
 */
export function estimateBudget(userSnapshot, indexDec, currency) {
  const ref = nycBudgetReference(userSnapshot);
  const idx = toDecimalString(indexDec);
  if (!ref || !idx) return null;
  const rate = currency === 'EUR' ? (parseRate(userSnapshot.usdPerEur?.exact) || parseRate(userSnapshot.usdPerEur?.value)) : null;
  if (currency === 'EUR' && !rate) return null;
  const [in_, id] = rat(idx);
  /** @param {[bigint, bigint]|null} r */
  const one = (r) => {
    if (!r) return null;
    let num = r[0] * in_; let den = r[1] * id * 100n; // × index / 100
    if (rate) { num *= rate[1]; den *= rate[0]; } // USD → EUR: ÷ (p/q)
    const average = round2([num, den]);
    return average ? { average, low: null, high: null } : null;
  };
  const single = one(ref.single); const family4 = one(ref.family4);
  return single || family4 ? { single, family4 } : null;
}

/**
 * MarketData-ს ბიუჯეტის შევსება: საკუთარი რეალური ბიუჯეტი რჩება (`basis: "numbeo"`); წინააღმდეგ შემთხვევაში —
 * შეფასება ქალაქის costOfLiving ინდექსით (ინდექსი დედაქალაქიდანაა → `fallback: true`). ცვლის ასლს, არა ორიგინალს.
 * @param {any} md @param {any} userSnapshot @returns {any}
 */
export function applyEstimatedBudget(md, userSnapshot) {
  if (!md) return md;
  const b = md.budget;
  const real = b && STATUSES_WITH_VALUE.includes(b.status) && (b.single || b.family4);
  if (real && !b.fallback && b.basis !== 'estimated-from-index') {
    if (!b.basis) return { ...md, budget: { ...b, basis: 'numbeo', estimated: false } };
    return md;
  }
  if (md.resolvedLocation?.matchStatus === 'capital-fallback' && real) return md; // მთლიანად დედაქალაქის მონაცემი — მისი რეალური ბიუჯეტი
  const ix = md.indices;
  if (!ix || !STATUSES_WITH_VALUE.includes(ix.status) || !ix.costOfLiving || !md.currency) return md;
  const est = estimateBudget(userSnapshot, ix.costOfLiving, md.currency);
  if (!est) return md;
  const out = structuredClone(md);
  out.budget = {
    status: ix.status === 'partial' ? 'cached' : ix.status, ...est, sourceUpdatedAt: null, source: 'snapshot',
    basis: 'estimated-from-index', estimated: true, ...(ix.fallback ? { fallback: true } : {}),
  };
  if (!out.warnings.some((/** @type {any} */ w) => w.code === 'budget_estimated')) out.warnings.push({ code: 'budget_estimated', message_ka: BUDGET_ESTIMATE_MESSAGE_KA });
  return out;
}
