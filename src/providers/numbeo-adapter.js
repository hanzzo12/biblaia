// @ts-check
/**
 * Numbeo-ს ადაპტერი — მხოლოდ სერვერზე (Cloudflare Worker). ბრაუზერის bundle-ში არ შედის.
 *
 * - მოთხოვნა იგება მხოლოდ შიდა ლოკაციის ID → `numbeo-city-map.json` ჩანაწერიდან; რუკაში არარსებული
 *   ლოკაცია → `not_configured` (არასოდეს ვცდილობთ სახელით „გამოცნობას“).
 * - ვალუტა მხოლოდ EUR/USD; Numbeo-ს ვთხოვთ ამ ვალუტაში (`currency`), თვითონ არასოდეს ვაკონვერტირებთ.
 * - `city_prices`: `city_id`, `currency`, `strict_matching=true`, `use_estimated=false`.
 *   `indices`: `city_id`, `strict_matching=true` (`use_estimated` indices-ზე დაუდასტურებელია — არ იგზავნება).
 * - გასაღები იგზავნება `X-Api-Key` სათაურით (დოკუმენტირებულია), არა URL-ში — URL-ები ლოგებში საიდუმლოს არ შეიცავს.
 * - განმეორებითი ცდა არ არის. ლოგირება აქ არ ხდება; Worker ლოგავს მხოლოდ `diagnostics`-ს (HTTP კოდი, ხანგრძლივობა).
 *
 * რეალურ Numbeo API-სთან კავშირი არ შემოწმებულა (გასაღები არ გვაქვს). ველების სახელები — `docs/providers.md` §2.
 */

import {
  MARKET_SCHEMA_VERSION, NUMBEO_BASELINE, RENT_METRICS, createEmptyMarketData, validateMarketData,
} from './market-contract.js';

export const NUMBEO_API_BASE = 'https://www.numbeo.com/api';
export const NUMBEO_ALLOWED_CURRENCIES = Object.freeze(['EUR', 'USD']);

/** @type {import('./market-contract.js').SourceRef} */
export const NUMBEO_PROVIDER = Object.freeze({
  id: 'numbeo',
  name: 'Numbeo',
  sourceUrl: 'https://www.numbeo.com/cost-of-living/',
  attribution: 'წყარო: Numbeo.com',
});

/** სტატუსები, რომლებიც შეცდომას ნიშნავს (ქეშში არ ინახება; ვადაგასული ქეშის გამოყენების საფუძველია). */
export const ERROR_STATUSES = Object.freeze(['network_error', 'timeout', 'unauthorized', 'rate_limited', 'upstream_error', 'invalid_response']);

const LOW_DATA_POINTS_THRESHOLD = 5;

/**
 * @typedef {Object} CityMapEntry
 * @property {string} numbeoCityId
 * @property {string} numbeoCity
 * @property {string|null} [numbeoCountry]
 * @property {string|null} countryCode
 * @property {'exact'|'nearby-explained'} matchStatus
 * @property {string|null} [note]
 * @property {string} [verifiedAt]
 *
 * @typedef {Object} ItemDef
 * @property {number|null} itemId
 * @property {string[]} expectedNameIncludes
 *
 * @typedef {Object} CityMap
 * @property {Record<string, ItemDef>} items
 * @property {Record<string, CityMapEntry>} cities
 */

/**
 * რუკის ჩანაწერის მოძიება და შემოწმება.
 * @param {CityMap} cityMap @param {string} locationId
 * @returns {{ ok: true, entry: CityMapEntry } | { ok: false, reason: 'unmapped' | 'invalid_entry' }}
 */
export function resolveMapping(cityMap, locationId) {
  const cities = cityMap && cityMap.cities;
  if (!cities || !Object.prototype.hasOwnProperty.call(cities, locationId)) return { ok: false, reason: 'unmapped' };
  const e = cities[locationId];
  const valid = e && typeof e === 'object' &&
    typeof e.numbeoCityId === 'string' && /^[0-9]{1,12}$/.test(e.numbeoCityId) &&
    typeof e.numbeoCity === 'string' && e.numbeoCity.trim() !== '' &&
    (e.matchStatus === 'exact' || (e.matchStatus === 'nearby-explained' && typeof e.note === 'string' && e.note.trim() !== '')) &&
    (e.countryCode === null || (typeof e.countryCode === 'string' && /^[A-Z]{2}$/.test(e.countryCode)));
  return valid ? { ok: true, entry: e } : { ok: false, reason: 'invalid_entry' };
}

/**
 * upstream მოთხოვნების URL-ები (გასაღების გარეშე).
 * @param {CityMapEntry} entry @param {string} currency
 */
export function buildNumbeoRequests(entry, currency) {
  if (!NUMBEO_ALLOWED_CURRENCIES.includes(currency)) throw new RangeError('currency not allowed');
  const prices = new URL(`${NUMBEO_API_BASE}/city_prices`);
  prices.searchParams.set('city_id', entry.numbeoCityId);
  prices.searchParams.set('currency', currency);
  prices.searchParams.set('strict_matching', 'true');
  prices.searchParams.set('use_estimated', 'false');
  const indices = new URL(`${NUMBEO_API_BASE}/indices`);
  indices.searchParams.set('city_id', entry.numbeoCityId);
  indices.searchParams.set('strict_matching', 'true');
  return { prices: prices.toString(), indices: indices.toString() };
}

/** HTTP კოდი → სტატუსი. @param {number} code */
export function httpStatusToDataStatus(code) {
  if (code === 401 || code === 403) return 'unauthorized';
  if (code === 429) return 'rate_limited';
  if (code >= 500) return 'upstream_error';
  if (code === 404) return 'not_found';
  return 'invalid_response';
}

/**
 * რიცხვი → ათწილადი სტრიქონი (≤ 8 ათწილადი, ექსპონენტის გარეშე). 0, უარყოფითი, NaN → null (არასოდეს 0).
 * @param {unknown} n @returns {string|null}
 */
export function toDecimalString(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n >= 1e12) return null;
  let s = String(n);
  if (/e/i.test(s) || (s.split('.')[1] || '').length > 8) s = n.toFixed(8).replace(/\.?0+$/, '');
  return /^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/.test(s) && /[1-9]/.test(s) ? s : null;
}

/** @param {string} s */
function normName(s) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * პასუხი ეკუთვნის თუ არა მოთხოვნილ ქალაქს. `city_id` ან `name` სავალდებულოა — სხვაგვარად ვერ დავადასტურებთ.
 * @param {Record<string, unknown>} json @param {CityMapEntry} entry
 * @returns {'ok'|'wrong_city'|'invalid_response'}
 */
export function checkCityIdentity(json, entry) {
  const hasId = json.city_id !== undefined && json.city_id !== null;
  const hasName = typeof json.name === 'string' && json.name.trim() !== '';
  if (!hasId && !hasName) return 'invalid_response';
  if (hasId && String(json.city_id) !== entry.numbeoCityId) return 'wrong_city';
  if (hasName) {
    const got = normName(/** @type {string} */ (json.name));
    const want = normName(entry.numbeoCity);
    if (!(got === want || got.startsWith(want + ','))) return 'wrong_city';
  }
  if (typeof json.country === 'string' && entry.numbeoCountry && normName(json.country) !== normName(entry.numbeoCountry)) return 'wrong_city';
  return 'ok';
}

/** @param {Record<string, unknown>} json @returns {string|null} */
function sourceMonth(json) {
  const y = json.yearLastUpdate;
  const m = json.monthLastUpdate;
  if (!(Number.isInteger(y) && /** @type {number} */ (y) >= 2000 && /** @type {number} */ (y) <= 2100)) return null;
  if (Number.isInteger(m) && /** @type {number} */ (m) >= 1 && /** @type {number} */ (m) <= 12) return `${y}-${String(m).padStart(2, '0')}`;
  return String(y);
}

/** Numbeo ზოგჯერ შეცდომას HTTP 200-ით და `{error}` ველით აბრუნებს (დაუდასტურებელი) — ევრისტიკა. @param {unknown} msg */
function errorBodyStatus(msg) {
  const s = typeof msg === 'string' ? msg : '';
  if (/api[_ ]?key|unauthori[sz]ed|forbidden|not allowed/i.test(s)) return 'unauthorized';
  if (/limit|quota|exceed/i.test(s)) return 'rate_limited';
  return 'invalid_response';
}

/**
 * `city_prices` პასუხის ნორმალიზება.
 * @param {unknown} json
 * @param {{ entry: CityMapEntry, currency: string, items: Record<string, ItemDef>, fetchedAt: string }} ctx
 * @returns {{ status: string, items: Record<string, any>, warnings: string[] }}
 */
export function normalizeCityPrices(json, ctx) {
  /** @type {string[]} */
  const warnings = [];
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { status: 'invalid_response', items: {}, warnings };
  const j = /** @type {Record<string, unknown>} */ (json);
  if ('error' in j) return { status: errorBodyStatus(j.error), items: {}, warnings };
  const identity = checkCityIdentity(j, ctx.entry);
  if (identity !== 'ok') return { status: identity, items: {}, warnings };
  if (typeof j.currency !== 'string') return { status: 'invalid_response', items: {}, warnings };
  if (j.currency !== ctx.currency) return { status: 'wrong_city', items: {}, warnings };
  if (!Array.isArray(j.prices)) return { status: 'invalid_response', items: {}, warnings };

  const sourceUpdatedAt = sourceMonth(j);
  if (sourceUpdatedAt === null) warnings.push('source_date_unknown');
  /** @type {Record<string, any>} */
  const items = {};
  let withValue = 0, full = 0;
  for (const [metric, def] of Object.entries(ctx.items || {})) {
    const m = /** @type {Record<string, {bedrooms:1|3, area:'centre'|'outside'}>} */ (RENT_METRICS)[metric];
    if (!m || !def || !Number.isInteger(def.itemId)) continue; // დაუდასტურებელი item (მაგ. outside_3br) — არ მოითხოვება
    const base = { metric, bedrooms: m.bedrooms, area: m.area, average: null, low: null, high: null, dataPoints: null,
      status: 'not_found', origin: 'provider', sourceUpdatedAt: null, fetchedAt: ctx.fetchedAt };
    const p = j.prices.find((x) => x && typeof x === 'object' && x.item_id === def.itemId);
    if (!p) { items[metric] = base; continue; }
    if (typeof p.item_name === 'string' && Array.isArray(def.expectedNameIncludes) &&
        !def.expectedNameIncludes.every((frag) => p.item_name.toLowerCase().includes(String(frag).toLowerCase()))) {
      items[metric] = { ...base, status: 'invalid_response' };
      warnings.push('item_mapping_unverified');
      continue;
    }
    if (typeof p.currency === 'string' && p.currency !== ctx.currency) { items[metric] = { ...base, status: 'wrong_city' }; continue; }
    const average = toDecimalString(p.average_price);
    if (average === null) { items[metric] = base; continue; }
    let low = toDecimalString(p.lowest_price);
    let high = toDecimalString(p.highest_price);
    if ((low !== null && Number(low) > Number(average)) || (high !== null && Number(high) < Number(average))) { low = null; high = null; }
    const dp = Number.isSafeInteger(p.data_points) && p.data_points >= 0 ? p.data_points : null;
    const isFull = low !== null && high !== null && dp !== null;
    items[metric] = { ...base, average, low, high, dataPoints: dp, status: isFull ? 'fresh' : 'partial', sourceUpdatedAt };
    withValue++;
    if (isFull) full++;
    if (dp !== null && dp < LOW_DATA_POINTS_THRESHOLD) warnings.push('low_data_points');
  }
  const requested = Object.keys(items).length;
  const status = withValue === 0 ? 'not_found' : full === requested ? 'fresh' : 'partial';
  if (status === 'partial') warnings.push('partial_data');
  return { status, items, warnings };
}

/**
 * `indices` პასუხის ნორმალიზება.
 * @param {unknown} json @param {{ entry: CityMapEntry, fetchedAt: string }} ctx
 */
export function normalizeIndices(json, ctx) {
  /** @type {string[]} */
  const warnings = [];
  const empty = { costOfLivingExcludingRent: null, rentIndex: null, costOfLivingPlusRent: null, baseline: null,
    origin: 'provider', sourceUpdatedAt: null, fetchedAt: ctx.fetchedAt };
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { block: { ...empty, status: 'invalid_response' }, warnings };
  const j = /** @type {Record<string, unknown>} */ (json);
  if ('error' in j) return { block: { ...empty, status: errorBodyStatus(j.error) }, warnings };
  const identity = checkCityIdentity(j, ctx.entry);
  if (identity !== 'ok') return { block: { ...empty, status: identity }, warnings };
  const col = toDecimalString(j.cpi_index);
  const rent = toDecimalString(j.rent_index);
  const plus = toDecimalString(j.cpi_and_rent_index);
  const n = [col, rent, plus].filter((v) => v !== null).length;
  if (n === 0) return { block: { ...empty, status: 'not_found' }, warnings };
  const status = n === 3 ? 'fresh' : 'partial';
  if (status === 'partial') warnings.push('partial_data');
  const sourceUpdatedAt = sourceMonth(j);
  if (sourceUpdatedAt === null) warnings.push('source_date_unknown');
  return {
    block: { ...empty, costOfLivingExcludingRent: col, rentIndex: rent, costOfLivingPlusRent: plus,
      baseline: { ...NUMBEO_BASELINE }, status, sourceUpdatedAt },
    warnings,
  };
}

/**
 * ერთი upstream GET, timeout-ით, განმეორების გარეშე.
 * @param {typeof fetch} fetchImpl @param {string} url @param {string} apiKey @param {number} timeoutMs
 * @returns {Promise<{ status: 'ok', json: unknown, http: number, ms: number } | { status: string, http: number|null, ms: number }>}
 */
async function upstreamGet(fetchImpl, url, apiKey, timeoutMs) {
  const started = Date.now();
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ac.abort(); }, timeoutMs);
  try {
    const res = await fetchImpl(url, { method: 'GET', headers: { 'X-Api-Key': apiKey, Accept: 'application/json' }, signal: ac.signal, redirect: 'error' });
    if (!res.ok) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      return { status: httpStatusToDataStatus(res.status), http: res.status, ms: Date.now() - started };
    }
    const text = await res.text();
    if (text.length > 2_000_000) return { status: 'invalid_response', http: res.status, ms: Date.now() - started };
    let json;
    try { json = JSON.parse(text); } catch { return { status: 'invalid_response', http: res.status, ms: Date.now() - started }; }
    return { status: 'ok', json, http: res.status, ms: Date.now() - started };
  } catch {
    return { status: timedOut ? 'timeout' : 'network_error', http: null, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * სრული მოთხოვნა: city_prices + indices პარალელურად → MarketData.
 * @param {{ locationId: string, currency: string, cityMap: CityMap, apiKey: string|undefined|null,
 *           fetchImpl: typeof fetch, timeoutMs?: number, now?: () => number, licenseConfirmed?: boolean }} p
 * @returns {Promise<{ data: import('./market-contract.js').MarketData, diagnostics: Record<string, unknown> }>}
 */
export async function fetchNumbeoMarket(p) {
  const { locationId, currency, cityMap, apiKey, fetchImpl } = p;
  const now = p.now || Date.now;
  const timeoutMs = p.timeoutMs && p.timeoutMs > 0 ? p.timeoutMs : 8000;
  const notConfigured = (/** @type {string} */ why) => ({
    data: createEmptyMarketData(locationId, 'not_configured', { currency, provider: NUMBEO_PROVIDER }),
    diagnostics: { reason: why },
  });
  if (!NUMBEO_ALLOWED_CURRENCIES.includes(currency)) return notConfigured('currency');
  if (typeof apiKey !== 'string' || apiKey.trim() === '') return notConfigured('no_key');
  const mapping = resolveMapping(cityMap, locationId);
  if (!mapping.ok) return notConfigured(mapping.reason);
  const entry = mapping.entry;
  const urls = buildNumbeoRequests(entry, currency);

  const [pr, ir] = await Promise.all([
    upstreamGet(fetchImpl, urls.prices, apiKey, timeoutMs),
    upstreamGet(fetchImpl, urls.indices, apiKey, timeoutMs),
  ]);
  const fetchedAt = new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z');

  const rentN = pr.status === 'ok' && 'json' in pr
    ? normalizeCityPrices(pr.json, { entry, currency, items: cityMap.items, fetchedAt })
    : { status: pr.status, items: {}, warnings: [] };
  const indN = ir.status === 'ok' && 'json' in ir
    ? normalizeIndices(ir.json, { entry, fetchedAt })
    : { block: { costOfLivingExcludingRent: null, rentIndex: null, costOfLivingPlusRent: null, baseline: null,
        status: ir.status, origin: 'provider', sourceUpdatedAt: null, fetchedAt }, warnings: [] };

  /** @type {Set<string>} */
  const w = new Set([...rentN.warnings, ...indN.warnings]);
  const rentHasValue = Object.values(rentN.items).some((i) => i.average !== null);
  if (rentHasValue) { w.add('range_is_not_confidence_interval'); w.add('quality_not_guaranteed'); }
  if (indN.block.status === 'fresh' || indN.block.status === 'partial') w.add('index_is_not_money');
  if (entry.matchStatus === 'nearby-explained') w.add('nearby_city');
  if (!p.licenseConfirmed) w.add('license_unconfirmed');

  /** @type {import('./market-contract.js').MarketData} */
  const data = {
    schemaVersion: MARKET_SCHEMA_VERSION,
    requestedLocationId: locationId,
    resolvedLocation: {
      city: entry.numbeoCity, countryCode: entry.countryCode ?? null, providerCityId: entry.numbeoCityId,
      matchStatus: entry.matchStatus, ...(entry.matchStatus === 'nearby-explained' ? { note: entry.note } : {}),
    },
    provider: { ...NUMBEO_PROVIDER },
    currency,
    rent: { status: rentN.status, items: rentN.items },
    indices: /** @type {any} */ (indN.block),
    cache: { state: 'none', expiresAt: null },
    warnings: [...w].slice(0, 20).map((code) => ({ code })),
  };
  const v = validateMarketData(data, { allowedCurrencies: NUMBEO_ALLOWED_CURRENCIES });
  const diagnostics = { prices: { http: pr.http, ms: pr.ms, status: rentN.status }, indices: { http: ir.http, ms: ir.ms, status: indN.block.status } };
  if (!v.ok) {
    return {
      data: createEmptyMarketData(locationId, 'invalid_response', { currency, provider: NUMBEO_PROVIDER }),
      diagnostics: { ...diagnostics, validationErrors: v.errors.length },
    };
  }
  return { data, diagnostics };
}
