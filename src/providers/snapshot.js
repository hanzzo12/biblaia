// @ts-check
/**
 * ბაზრის მონაცემების ჩაშენებული ასლი (`src/data/market-snapshot.json`, contracts.md §9) → MarketData v2.
 * სუფთა მოდული — ბრაუზერშიც (ოფლაინ HTML / file://) და Worker-შიც.
 *
 * ასლის სქემა: { schemaVersion, source: { retrievedAt, … }, currency: "USD", usdPerEur: { value, derivedFrom, date, purpose },
 *   cities: { <locationId>: { numbeoName, retrieval: "direct"|"archive", sourceUpdatedAt, sourceUrl,
 *     rent: { centre_1br, outside_1br, centre_3br, outside_3br: {average,low,high}|null },
 *     utilities: { basic85m2, internet }, groceries: { basketItemsSum, itemsCounted, itemsMissing },
 *     restaurants: { inexpensiveMeal, midRangeForTwo }, indices: { costOfLiving, rent, groceries, restaurants, costOfLivingPlusRent },
 *     budget: { single: {average}|null, family4: {average}|null } } } }
 * მნიშვნელობები შეიძლება იყოს რიცხვი ან ათწილადი სტრიქონი. აკლია → null (არასოდეს 0).
 *
 * ვალუტა: ასლი USD-შია. EUR მოთხოვნისას თანხები გადაიყვანება `usdPerEur`-ით ზუსტი რაციონალური გაყოფით
 * (BigInt), დამრგვალებით 2 ათწილადამდე (half-up), გაფრთხილებით `reference_fx`. ინდექსები არ იცვლება.
 */

import {
  MARKET_SCHEMA_VERSION, NUMBEO_BASELINE_KA, toDecimalString, overallStatus, isIsoDateTime, isPartialDate, isSafeUrl,
  isSafeText, compareDecimalStrings, validateMarketData, NUMBEO_ATTRIBUTION_KA,
} from './market-contract.js';

/** "2026-10-31…" → "31.10.2026". @param {unknown} iso */
export function formatDateKa(iso) {
  const m = typeof iso === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

/**
 * კურსი რაციონალურად: "p/q" (ზუსტი წილადი, `usdPerEur.exact`) ან ათწილადი ("1.119954"). → [p, q] (USD ერთ EUR-ზე = p/q).
 * @param {unknown} v @returns {[bigint, bigint]|null}
 */
export function parseRate(v) {
  if (typeof v === 'string' && /^\d{1,30}\/\d{1,30}$/.test(v)) {
    const [p, q] = v.split('/').map((x) => BigInt(x));
    return p > 0n && q > 0n ? [p, q] : null;
  }
  const d = toDecimalString(v);
  if (!d) return null;
  const [i, f = ''] = d.split('.');
  return [BigInt(i + f), 10n ** BigInt(f.length)];
}

/**
 * USD → EUR ზუსტად: eur = usd ÷ (p/q) = usd · q / p, დამრგვალება 2 ათწილადამდე (half-up). შედეგი 0 → null.
 * @param {string} usdDec დადებითი ათწილადი სტრიქონი @param {[bigint, bigint]|string} rate
 * @returns {string|null}
 */
export function usdToEur(usdDec, rate) {
  const r = typeof rate === 'string' ? parseRate(rate) : rate;
  if (!r) return null;
  const [p, q] = r;
  const [ui, uf = ''] = usdDec.split('.');
  const num = BigInt(ui + uf) * q * 100n;
  const den = 10n ** BigInt(uf.length) * p;
  let n = num / den;
  if ((num % den) * 2n >= den) n += 1n;
  if (n === 0n) return null;
  return `${n / 100n}.${(n % 100n).toString().padStart(2, '0')}`;
}

/** @param {unknown} snap @returns {{ ok: boolean, errors: string[] }} */
export function validateMarketSnapshot(snap) {
  const e = [];
  const s = /** @type {any} */ (snap);
  if (!s || typeof s !== 'object' || Array.isArray(s)) return { ok: false, errors: ['$: not_object'] };
  if (s.currency !== 'USD') e.push('currency: must_be_USD');
  if (!s.cities || typeof s.cities !== 'object' || Array.isArray(s.cities)) e.push('cities: not_object');
  if (!s.source || !(isIsoDateTime(s.source.retrievedAt) || isPartialDate(s.source.retrievedAt))) e.push('source.retrievedAt: invalid');
  if (s.usdPerEur != null && toDecimalString(s.usdPerEur.value) === null) e.push('usdPerEur.value: not_positive_decimal');
  return { ok: e.length === 0, errors: e };
}

/** @param {unknown} v */
const blockHasValue = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * ასლის ერთი ქალაქის ჩანაწერი → MarketData v2 (მხოლოდ ამ ქალაქის საკუთარი მონაცემი, დედაქალაქის წესის გარეშე).
 * EUR-ისთვის კურსის არქონისას → null (არასწორი ვალუტის თანხა არასოდეს ჩანს).
 * @param {any} snapshot @param {string} locationId @param {'EUR'|'USD'} currency
 * @returns {import('./market-contract.js').MarketData|null}
 */
export function snapshotEntryToMarketData(snapshot, locationId, currency) {
  if (!snapshot || !validateMarketSnapshot(snapshot).ok) return null;
  const c = Object.prototype.hasOwnProperty.call(snapshot.cities, locationId) ? snapshot.cities[locationId] : null;
  if (!c || typeof c !== 'object') return null;
  if (currency !== 'USD' && currency !== 'EUR') return null;
  const fx = snapshot.usdPerEur || {};
  const rate = currency === 'EUR' ? (parseRate(fx.exact) || parseRate(fx.value)) : null;
  const rateShown = toDecimalString(fx.value);
  if (currency === 'EUR' && (!rate || !rateShown)) return null;
  /** @param {unknown} v */
  const money = (v) => { const d = toDecimalString(v); return d === null ? null : currency === 'USD' ? d : usdToEur(d, /** @type {[bigint, bigint]} */ (rate)); };
  /** @param {any} p */
  const price = (p) => {
    if (!p || typeof p !== 'object') return null;
    const average = money(p.average);
    if (average === null) return null;
    let low = money(p.low); let high = money(p.high);
    if ((low && compareDecimalStrings(low, average) > 0) || (high && compareDecimalStrings(average, high) > 0)) { low = null; high = null; }
    return { average, low, high };
  };
  const st = (/** @type {boolean} */ has) => (has ? 'cached' : 'not_found');
  const rent0 = blockHasValue(c.rent) ? c.rent : {};
  const items = { centre_1br: price(rent0.centre_1br), outside_1br: price(rent0.outside_1br), centre_3br: price(rent0.centre_3br), outside_3br: price(rent0.outside_3br) };
  const ix0 = blockHasValue(c.indices) ? c.indices : {};
  const ix = { costOfLiving: toDecimalString(ix0.costOfLiving), rent: toDecimalString(ix0.rent), groceries: toDecimalString(ix0.groceries), restaurants: toDecimalString(ix0.restaurants), costOfLivingPlusRent: toDecimalString(ix0.costOfLivingPlusRent) };
  const rentIndex = ix.rent;
  const rent = { status: st(Object.values(items).some(Boolean) || !!rentIndex), items, rentIndex };
  const u0 = blockHasValue(c.utilities) ? c.utilities : {};
  const utilities = { status: 'not_found', basic85m2: price(u0.basic85m2), internet: price(u0.internet) };
  utilities.status = st(!!(utilities.basic85m2 || utilities.internet));
  const g0 = blockHasValue(c.groceries) ? c.groceries : {};
  const counted = Number.isSafeInteger(g0.itemsCounted) && g0.itemsCounted >= 0 ? g0.itemsCounted : 0;
  const sum = counted > 0 ? money(g0.basketItemsSum) : null;
  const groceries = {
    status: 'not_found', basketItemsSum: sum, itemsCounted: sum ? counted : 0,
    itemsMissing: Number.isSafeInteger(g0.itemsMissing) && g0.itemsMissing >= 0 ? g0.itemsMissing : 0, groceriesIndex: ix.groceries,
  };
  groceries.status = st(!!(groceries.basketItemsSum || groceries.groceriesIndex));
  const r0 = blockHasValue(c.restaurants) ? c.restaurants : {};
  const restaurants = { status: 'not_found', inexpensiveMeal: price(r0.inexpensiveMeal), midRangeForTwo: price(r0.midRangeForTwo), restaurantIndex: ix.restaurants };
  restaurants.status = st(!!(restaurants.inexpensiveMeal || restaurants.midRangeForTwo || restaurants.restaurantIndex));
  const sourceUpdatedAt = isPartialDate(c.sourceUpdatedAt) ? c.sourceUpdatedAt : null;
  const indices = {
    ...ix, baseline: NUMBEO_BASELINE_KA, status: st(Object.values(ix).some(Boolean)),
    period: Object.values(ix).some(Boolean) && sourceUpdatedAt ? sourceUpdatedAt.slice(0, 7).replace(/^(\d{4})-(\d{2})-.*/, '$1-$2') : null,
  };
  const b0 = blockHasValue(c.budget) ? c.budget : {};
  const budget = { status: 'not_found', single: price(b0.single), family4: price(b0.family4), sourceUpdatedAt, source: /** @type {'snapshot'} */ ('snapshot') };
  budget.status = st(!!(budget.single || budget.family4));

  const blocks = [rent.status, utilities.status, groceries.status, restaurants.status, indices.status, budget.status];
  if (blocks.every((s) => s === 'not_found')) return null;
  const dateKa = formatDateKa(snapshot.source.retrievedAt);
  const warnings = [
    { code: 'snapshot_copy', ...(dateKa ? { message_ka: `შენახული მონაცემი, ${dateKa}` } : {}) },
    { code: 'scraped_source_terms' },
  ];
  if (currency === 'EUR') {
    const fxDate = formatDateKa(snapshot.usdPerEur.date) || dateKa;
    warnings.push({ code: 'reference_fx', message_ka: `≈ გადაყვანილია Numbeo-ს კურსით 1 EUR = ${rateShown} USD${fxDate ? `, ${fxDate}` : ''} — საორიენტაციოდ` });
  }
  if (!sourceUpdatedAt) warnings.push({ code: 'source_date_unknown' });
  if (Object.values(items).some(Boolean)) { warnings.push({ code: 'range_is_not_confidence_interval' }); warnings.push({ code: 'quality_not_guaranteed' }); }
  if (indices.status === 'cached') warnings.push({ code: 'index_is_not_money' });
  if (groceries.itemsMissing > 0 && groceries.basketItemsSum) warnings.push({ code: 'basket_incomplete' });
  const name = isSafeText(c.numbeoName, 120) ? c.numbeoName : null;
  const cc = /^([A-Z]{2})-/.exec(locationId);
  const retrievedAt = isIsoDateTime(snapshot.source.retrievedAt) ? snapshot.source.retrievedAt : `${String(snapshot.source.retrievedAt).slice(0, 10)}T00:00:00Z`;
  /** @type {import('./market-contract.js').MarketData} */
  const md = {
    schemaVersion: MARKET_SCHEMA_VERSION,
    requestedLocationId: locationId,
    resolvedLocation: { city: name, countryCode: cc ? cc[1] : null, providerCity: name, matchStatus: 'exact' },
    provider: {
      id: 'numbeo-apify', name: 'Numbeo', via: c.retrieval === 'archive' ? 'შენახული ასლი (არქივი)' : 'შენახული ასლი',
      sourceUrl: isSafeUrl(c.sourceUrl) ? c.sourceUrl : 'https://www.numbeo.com/cost-of-living/', attribution_ka: NUMBEO_ATTRIBUTION_KA,
    },
    currency, status: overallStatus(blocks), rent, utilities, groceries, restaurants, indices, budget,
    fetchedAt: retrievedAt, sourceUpdatedAt,
    cache: { state: 'snapshot', expiresAt: null },
    warnings,
  };
  return validateMarketData(md).ok ? md : null;
}
