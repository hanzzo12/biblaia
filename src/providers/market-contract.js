// @ts-check
/**
 * MarketData v2 (ADR-003, contracts.md §8) — ბაზრის მონაცემების ნორმალიზებული კონტრაქტი.
 * წყარო: Numbeo.com, მოპოვებული Apify actor-ით `automation-lab/numbeo-scraper` (მხოლოდ Worker-იდან).
 *
 * სუფთა მოდული (DOM/ქსელი/საათი არ გამოიყენება): ბრაუზერი, Worker, node --test.
 * წესები: აკლია → null (არასოდეს "0"); თანხები/ინდექსები — ათწილადი სტრიქონები; 2-საძინებლიანი არ არსებობს
 * (ინტერპოლაცია აკრძალულია); ხელით შეყვანილი მონაცემი — `status: "manual"`, `provider: null`.
 */

export const MARKET_SCHEMA_VERSION = 2;

/** სტატუსები (ზედა დონე და თითო ბლოკი). `loading` და `manual` — კლიენტის/ხელით შეყვანის. */
export const DATA_STATUS = Object.freeze({
  LOADING: 'loading', FRESH: 'fresh', CACHED: 'cached', STALE: 'stale', PARTIAL: 'partial', MANUAL: 'manual',
  NOT_FOUND: 'not_found', NETWORK_ERROR: 'network_error', TIMEOUT: 'timeout', NOT_CONFIGURED: 'not_configured',
  UNAUTHORIZED: 'unauthorized', RATE_LIMITED: 'rate_limited', UPSTREAM_ERROR: 'upstream_error',
  INVALID_RESPONSE: 'invalid_response', WRONG_CITY: 'wrong_city', DISABLED: 'disabled',
});
const ALL_STATUSES = new Set(Object.values(DATA_STATUS));
/** მნიშვნელობის შემცველი სტატუსები. */
export const STATUSES_WITH_VALUE = Object.freeze(['fresh', 'cached', 'stale', 'partial', 'manual']);
/** სტატუსები, რომლებშიც ბლოკის ყველა მნიშვნელობა null-ია. */
export const STATUSES_WITHOUT_VALUE = Object.freeze([
  'loading', 'not_found', 'network_error', 'timeout', 'not_configured', 'unauthorized', 'rate_limited',
  'upstream_error', 'invalid_response', 'wrong_city', 'disabled',
]);
/** შეცდომის სტატუსები (ქეშში არ ინახება; ვადაგასული ასლის გამოყენების საფუძველია). */
export const ERROR_STATUSES = Object.freeze(['network_error', 'timeout', 'unauthorized', 'rate_limited', 'upstream_error', 'invalid_response', 'wrong_city']);

export const MATCH_STATUS = Object.freeze({ EXACT: 'exact', NEARBY_EXPLAINED: 'nearby-explained', NONE: 'none' });
export const CACHE_STATE = Object.freeze({ NONE: 'none', MISS: 'miss', HIT: 'hit', STALE: 'stale' });

/** ქირის მეტრიკები (საძინებლები, არა „ოთახები“). */
export const RENT_METRICS = Object.freeze({
  centre_1br: Object.freeze({ bedrooms: 1, area: 'centre' }),
  outside_1br: Object.freeze({ bedrooms: 1, area: 'outside' }),
  centre_3br: Object.freeze({ bedrooms: 3, area: 'centre' }),
  outside_3br: Object.freeze({ bedrooms: 3, area: 'outside' }),
});
export const DEFAULT_RENT_METRIC = 'centre_1br';

/** ინდექსის ველები (Numbeo, ნიუ-იორკი = 100). */
export const INDEX_FIELDS = Object.freeze(['costOfLiving', 'rent', 'groceries', 'restaurants', 'costOfLivingPlusRent']);
export const NUMBEO_BASELINE_KA = 'ნიუ-იორკი = 100';

export const WARNING_CODE = Object.freeze({
  NEARBY_CITY: 'nearby_city',
  LOW_DATA: 'low_data',
  RANGE_IS_NOT_CONFIDENCE_INTERVAL: 'range_is_not_confidence_interval',
  QUALITY_NOT_GUARANTEED: 'quality_not_guaranteed',
  INDEX_IS_NOT_MONEY: 'index_is_not_money',
  SOURCE_DATE_UNKNOWN: 'source_date_unknown',
  STALE_CACHE_USED: 'stale_cache_used',
  PARTIAL_DATA: 'partial_data',
  MANUAL_ENTRY: 'manual_entry',
  MIXED_SOURCES: 'mixed_sources',
  BASKET_INCOMPLETE: 'basket_incomplete',
  CURRENCY_UNCONFIRMED: 'currency_unconfirmed',
  CITY_NAME_UNVERIFIED: 'city_name_unverified',
  OUTPUT_SCHEMA_UNVERIFIED: 'output_schema_unverified',
  SCRAPED_SOURCE_TERMS: 'scraped_source_terms',
  PAYMENT_REQUIRED: 'payment_required',
  SYNTHETIC_TEST_DATA: 'synthetic_test_data',
});
const ALL_WARNING_CODES = new Set(Object.values(WARNING_CODE));

export const DEFAULT_ALLOWED_CURRENCIES = Object.freeze(['EUR', 'USD']);

/**
 * @typedef {string} Dec  დადებითი ათწილადი სტრიქონი ("1757.14").
 * @typedef {{ average: Dec, low: Dec|null, high: Dec|null }} Price
 * @typedef {{ id: string, name: string, via: string|null, sourceUrl: string|null, attribution_ka: string }} ProviderRef
 * @typedef {Object} MarketData
 * @property {2} schemaVersion
 * @property {string} requestedLocationId
 * @property {{ city: string|null, countryCode: string|null, providerCity: string|null, matchStatus: 'exact'|'nearby-explained'|'none', note?: string|null }} resolvedLocation
 * @property {ProviderRef|null} provider
 * @property {string|null} currency
 * @property {string} status
 * @property {{ status: string, items: Record<'centre_1br'|'outside_1br'|'centre_3br'|'outside_3br', Price|null>, rentIndex: Dec|null }} rent
 * @property {{ status: string, basic85m2: Price|null, internet: Price|null }} utilities
 * @property {{ status: string, basketItemsSum: Dec|null, itemsCounted: number, itemsMissing: number, groceriesIndex: Dec|null }} groceries
 * @property {{ status: string, inexpensiveMeal: Price|null, midRangeForTwo: Price|null, restaurantIndex: Dec|null }} restaurants
 * @property {{ costOfLiving: Dec|null, rent: Dec|null, groceries: Dec|null, restaurants: Dec|null, costOfLivingPlusRent: Dec|null, baseline: string, status: string, period: string|null }} indices
 * @property {string|null} fetchedAt
 * @property {string|null} sourceUpdatedAt
 * @property {{ state: 'none'|'miss'|'hit'|'stale', expiresAt: string|null }} cache
 * @property {{ code: string, message_ka?: string }[]} warnings
 */

/* ---------------------------------------------------------------- primitives */

const DECIMAL_RE = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/;
const ISO_DATETIME_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const PARTIAL_DATE_RE = /^(\d{4})(?:-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?)?$/;
const LOCATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT_RE = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩<>]/;

/** @param {unknown} v @returns {v is Record<string, any>} */
function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v) &&
    (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
}
/** @param {unknown} v */ export const isDecimalString = (v) => typeof v === 'string' && DECIMAL_RE.test(v);
/** @param {unknown} v */ export const isPositiveDecimalString = (v) => isDecimalString(v) && /[1-9]/.test(/** @type {string} */ (v));
/** @param {unknown} v */ export const isIsoDateTime = (v) => typeof v === 'string' && ISO_DATETIME_RE.test(v) && !Number.isNaN(Date.parse(v));
/** @param {unknown} v */
export function isPartialDate(v) {
  if (typeof v !== 'string') return false;
  const m = PARTIAL_DATE_RE.exec(v);
  if (!m) return false;
  if (m[3]) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDate() === +m[3];
  return true;
}
/** @param {unknown} v @param {number} max */
export const isSafeText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !UNSAFE_TEXT_RE.test(v);
/** @param {unknown} v */
export function isSafeUrl(v) {
  if (typeof v !== 'string' || v.length > 500 || UNSAFE_TEXT_RE.test(v)) return false;
  try { const u = new URL(v); return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password; } catch { return false; }
}
/** @param {string} a @param {string} b */
export function compareDecimalStrings(a, b) {
  const [ai, af = ''] = a.split('.'); const [bi, bf = ''] = b.split('.');
  if (ai.length !== bi.length) return ai.length < bi.length ? -1 : 1;
  if (ai !== bi) return ai < bi ? -1 : 1;
  const n = Math.max(af.length, bf.length); const x = af.padEnd(n, '0'); const y = bf.padEnd(n, '0');
  return x === y ? 0 : x < y ? -1 : 1;
}
/**
 * რიცხვი ან რიცხვითი სტრიქონი → ათწილადი სტრიქონი (≤ 8 ათწილადი). 0/უარყოფითი/არარიცხვი → null.
 * სტრიქონიდან იღებს „1,234.56“-ს და „€ 1 234.56“-ს მსგავს ფორმებს.
 * @param {unknown} n @returns {string|null}
 */
export function toDecimalString(n) {
  let x = n;
  if (typeof x === 'string') {
    const t = x.replace(/[\s ]/g, '').replace(/[^0-9.,-]/g, '').replace(/,(?=\d{3}(?:\D|$))/g, '');
    if (!/^-?\d+(?:\.\d+)?$/.test(t)) return null;
    x = Number(t);
  }
  if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0 || x >= 1e12) return null;
  let s = String(x);
  if (/e/i.test(s) || (s.split('.')[1] || '').length > 8) s = x.toFixed(8).replace(/\.?0+$/, '');
  return DECIMAL_RE.test(s) && /[1-9]/.test(s) ? s : null;
}
const SCALE = 100000000n;
/** ზუსტი ჯამი (BigInt, 8 ათწილადი). @param {string[]} decs @returns {string|null} */
export function sumDecimalStrings(decs) {
  if (!decs.length) return null;
  let acc = 0n;
  for (const d of decs) {
    const [i, f = ''] = d.split('.');
    acc += BigInt(i) * SCALE + BigInt((f + '00000000').slice(0, 8));
  }
  const ip = acc / SCALE; const fp = (acc % SCALE).toString().padStart(8, '0').replace(/0+$/, '');
  return fp ? `${ip}.${fp}` : `${ip}`;
}

/* ---------------------------------------------------------------- validation */

/** @param {Record<string, unknown>} o @param {string[]} req @param {string[]} opt @param {string} p @param {string[]} e */
function keys(o, req, opt, p, e) {
  for (const k of req) if (!(k in o)) e.push(`${p}${k}: missing`);
  const ok = new Set([...req, ...opt]);
  for (const k of Object.keys(o)) if (!ok.has(k)) e.push(`${p}${k}: unknown_field`);
}
/** @param {unknown} v @param {string} p @param {string[]} e @returns {boolean} has value */
function checkPrice(v, p, e) {
  if (v === null) return false;
  if (!isPlainObject(v)) { e.push(`${p}: not_object`); return false; }
  keys(v, ['average', 'low', 'high'], [], `${p}.`, e);
  if (!isPositiveDecimalString(v.average)) e.push(`${p}.average: not_positive_decimal`);
  for (const f of ['low', 'high']) if (v[f] !== null && !isPositiveDecimalString(v[f])) e.push(`${p}.${f}: not_positive_decimal_or_null`);
  if (isPositiveDecimalString(v.average)) {
    if (isPositiveDecimalString(v.low) && compareDecimalStrings(v.low, v.average) > 0) e.push(`${p}.average: below_low`);
    if (isPositiveDecimalString(v.high) && compareDecimalStrings(v.average, v.high) > 0) e.push(`${p}.average: above_high`);
  }
  return true;
}
/** @param {unknown} v @param {string} p @param {string[]} e */
function checkDec(v, p, e) {
  if (v === null) return false;
  if (!isPositiveDecimalString(v)) e.push(`${p}: not_positive_decimal_or_null`);
  return true;
}
/** @param {unknown} status @param {boolean} hasValue @param {string} p @param {string[]} e */
function checkStatus(status, hasValue, p, e) {
  if (typeof status !== 'string' || !ALL_STATUSES.has(status)) { e.push(`${p}.status: unknown`); return; }
  if (STATUSES_WITHOUT_VALUE.includes(status) && hasValue) e.push(`${p}.status: values_must_be_null_for_${status}`);
  if (STATUSES_WITH_VALUE.includes(status) && !hasValue) e.push(`${p}.status: value_required_for_${status}`);
}

/**
 * MarketData v2-ის სრული ვალიდაცია. @param {unknown} obj
 * @param {{ allowedCurrencies?: readonly string[] }} [options]
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateMarketData(obj, options = {}) {
  /** @type {string[]} */
  const e = [];
  if (!isPlainObject(obj)) return { ok: false, errors: ['$: not_object'] };
  keys(obj, ['schemaVersion', 'requestedLocationId', 'resolvedLocation', 'provider', 'currency', 'status', 'rent', 'utilities', 'groceries', 'restaurants', 'indices', 'fetchedAt', 'sourceUpdatedAt', 'cache', 'warnings'], [], '', e);
  if (obj.schemaVersion !== MARKET_SCHEMA_VERSION) e.push('schemaVersion: unsupported');
  if (!(typeof obj.requestedLocationId === 'string' && LOCATION_ID_RE.test(obj.requestedLocationId))) e.push('requestedLocationId: invalid');

  const loc = obj.resolvedLocation;
  let match = 'none';
  if (!isPlainObject(loc)) e.push('resolvedLocation: not_object');
  else {
    keys(loc, ['city', 'countryCode', 'providerCity', 'matchStatus'], ['note'], 'resolvedLocation.', e);
    if (!Object.values(MATCH_STATUS).includes(loc.matchStatus)) e.push('resolvedLocation.matchStatus: unknown'); else match = loc.matchStatus;
    for (const f of ['city', 'providerCity']) if (loc[f] !== null && !isSafeText(loc[f], 120)) e.push(`resolvedLocation.${f}: invalid_text`);
    if (loc.countryCode !== null && !(typeof loc.countryCode === 'string' && /^[A-Z]{2}$/.test(loc.countryCode))) e.push('resolvedLocation.countryCode: invalid');
    if ('note' in loc && loc.note !== null && !isSafeText(loc.note, 300)) e.push('resolvedLocation.note: invalid_text');
    if (match === 'nearby-explained' && !isSafeText(loc.note, 300)) e.push('resolvedLocation.note: required_for_nearby_explained');
  }

  const pr = obj.provider;
  if (pr !== null) {
    if (!isPlainObject(pr)) e.push('provider: not_object');
    else {
      keys(pr, ['id', 'name', 'via', 'sourceUrl', 'attribution_ka'], [], 'provider.', e);
      if (!(typeof pr.id === 'string' && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(pr.id))) e.push('provider.id: invalid');
      if (!isSafeText(pr.name, 120)) e.push('provider.name: invalid_text');
      if (pr.via !== null && !isSafeText(pr.via, 200)) e.push('provider.via: invalid_text');
      if (pr.sourceUrl !== null && !isSafeUrl(pr.sourceUrl)) e.push('provider.sourceUrl: invalid_url');
      if (!isSafeText(pr.attribution_ka, 300)) e.push('provider.attribution_ka: invalid_text');
    }
  }
  const cur = obj.currency;
  if (cur !== null) {
    if (!(typeof cur === 'string' && /^[A-Z]{3}$/.test(cur))) e.push('currency: invalid');
    else if (options.allowedCurrencies && !options.allowedCurrencies.includes(cur)) e.push('currency: not_allowed');
  }

  let money = false; let any = false;
  const r = obj.rent;
  if (!isPlainObject(r)) e.push('rent: not_object');
  else {
    keys(r, ['status', 'items', 'rentIndex'], [], 'rent.', e);
    let v = false;
    if (!isPlainObject(r.items)) e.push('rent.items: not_object');
    else {
      keys(r.items, Object.keys(RENT_METRICS), [], 'rent.items.', e);
      for (const k of Object.keys(RENT_METRICS)) if (k in r.items && checkPrice(r.items[k], `rent.items.${k}`, e)) { v = true; money = true; }
    }
    if (checkDec(r.rentIndex, 'rent.rentIndex', e)) v = true;
    checkStatus(r.status, v, 'rent', e); any ||= v;
  }
  const u = obj.utilities;
  if (!isPlainObject(u)) e.push('utilities: not_object');
  else {
    keys(u, ['status', 'basic85m2', 'internet'], [], 'utilities.', e);
    const v = [checkPrice(u.basic85m2, 'utilities.basic85m2', e), checkPrice(u.internet, 'utilities.internet', e)].some(Boolean);
    money ||= v; any ||= v; checkStatus(u.status, v, 'utilities', e);
  }
  const g = obj.groceries;
  if (!isPlainObject(g)) e.push('groceries: not_object');
  else {
    keys(g, ['status', 'basketItemsSum', 'itemsCounted', 'itemsMissing', 'groceriesIndex'], [], 'groceries.', e);
    const sum = checkDec(g.basketItemsSum, 'groceries.basketItemsSum', e);
    for (const f of ['itemsCounted', 'itemsMissing']) if (!(Number.isSafeInteger(g[f]) && g[f] >= 0)) e.push(`groceries.${f}: not_non_negative_integer`);
    if (sum !== (g.itemsCounted > 0)) e.push('groceries.basketItemsSum: inconsistent_with_itemsCounted');
    const v = sum || checkDec(g.groceriesIndex, 'groceries.groceriesIndex', e);
    money ||= sum; any ||= v; checkStatus(g.status, v, 'groceries', e);
  }
  const rs = obj.restaurants;
  if (!isPlainObject(rs)) e.push('restaurants: not_object');
  else {
    keys(rs, ['status', 'inexpensiveMeal', 'midRangeForTwo', 'restaurantIndex'], [], 'restaurants.', e);
    const m = [checkPrice(rs.inexpensiveMeal, 'restaurants.inexpensiveMeal', e), checkPrice(rs.midRangeForTwo, 'restaurants.midRangeForTwo', e)].some(Boolean);
    const v = checkDec(rs.restaurantIndex, 'restaurants.restaurantIndex', e) || m;
    money ||= m; any ||= v; checkStatus(rs.status, v, 'restaurants', e);
  }
  const ix = obj.indices;
  if (!isPlainObject(ix)) e.push('indices: not_object');
  else {
    keys(ix, [...INDEX_FIELDS, 'baseline', 'status', 'period'], [], 'indices.', e);
    const v = INDEX_FIELDS.map((f) => checkDec(ix[f], `indices.${f}`, e)).some(Boolean);
    if (!isSafeText(ix.baseline, 60)) e.push('indices.baseline: invalid_text');
    if (ix.period !== null && !(typeof ix.period === 'string' && /^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(ix.period))) e.push('indices.period: invalid');
    any ||= v; checkStatus(ix.status, v, 'indices', e);
  }
  checkStatus(obj.status, any, '$', e);
  if (match === 'none' && any) e.push('resolvedLocation.matchStatus: none_but_values_present');
  if (money && cur === null) e.push('currency: required_when_money_present');
  if (obj.fetchedAt !== null && !isIsoDateTime(obj.fetchedAt)) e.push('fetchedAt: not_iso_datetime_or_null');
  if (obj.sourceUpdatedAt !== null && !isPartialDate(obj.sourceUpdatedAt)) e.push('sourceUpdatedAt: not_partial_date_or_null');
  if (any && obj.status !== 'manual' && obj.fetchedAt === null) e.push('fetchedAt: required_when_values_present');

  const c = obj.cache;
  if (!isPlainObject(c)) e.push('cache: not_object');
  else {
    keys(c, ['state', 'expiresAt'], [], 'cache.', e);
    if (!Object.values(CACHE_STATE).includes(c.state)) e.push('cache.state: unknown');
    if (c.expiresAt !== null && !isIsoDateTime(c.expiresAt)) e.push('cache.expiresAt: not_iso_datetime_or_null');
    if (c.state === 'stale' && obj.status !== 'stale') e.push('status: must_be_stale_when_cache_stale');
  }
  if (!Array.isArray(obj.warnings)) e.push('warnings: not_array');
  else {
    if (obj.warnings.length > 25) e.push('warnings: too_many');
    obj.warnings.forEach((w, i) => {
      if (!isPlainObject(w)) { e.push(`warnings[${i}]: not_object`); return; }
      keys(w, ['code'], ['message_ka'], `warnings[${i}].`, e);
      if (!ALL_WARNING_CODES.has(w.code)) e.push(`warnings[${i}].code: unknown`);
      if ('message_ka' in w && !isSafeText(w.message_ka, 300)) e.push(`warnings[${i}].message_ka: invalid_text`);
    });
  }
  return { ok: e.length === 0, errors: e };
}

/* ---------------------------------------------------------------- constructors */

/**
 * ცარიელი MarketData მოცემული (უმნიშვნელო) სტატუსით.
 * @param {string} locationId @param {string} status
 * @param {{ currency?: string|null, provider?: ProviderRef|null, warnings?: {code:string}[] }} [extra]
 * @returns {MarketData}
 */
export function createEmptyMarketData(locationId, status, extra = {}) {
  if (!STATUSES_WITHOUT_VALUE.includes(status)) throw new RangeError(`status without value expected, got ${status}`);
  return {
    schemaVersion: MARKET_SCHEMA_VERSION,
    requestedLocationId: locationId,
    resolvedLocation: { city: null, countryCode: null, providerCity: null, matchStatus: 'none' },
    provider: extra.provider ?? null,
    currency: extra.currency ?? null,
    status,
    rent: { status, items: { centre_1br: null, outside_1br: null, centre_3br: null, outside_3br: null }, rentIndex: null },
    utilities: { status, basic85m2: null, internet: null },
    groceries: { status, basketItemsSum: null, itemsCounted: 0, itemsMissing: 0, groceriesIndex: null },
    restaurants: { status, inexpensiveMeal: null, midRangeForTwo: null, restaurantIndex: null },
    indices: { costOfLiving: null, rent: null, groceries: null, restaurants: null, costOfLivingPlusRent: null, baseline: NUMBEO_BASELINE_KA, status, period: null },
    fetchedAt: null, sourceUpdatedAt: null,
    cache: { state: 'none', expiresAt: null },
    warnings: extra.warnings ?? [],
  };
}

/**
 * ბლოკების სტატუსებიდან ზედა დონის სტატუსი.
 * @param {string[]} blockStatuses
 */
export function overallStatus(blockStatuses) {
  const withVal = blockStatuses.filter((s) => STATUSES_WITH_VALUE.includes(s));
  if (withVal.length === 0) {
    const err = blockStatuses.find((s) => ERROR_STATUSES.includes(s));
    return err || blockStatuses[0] || 'not_found';
  }
  if (withVal.length === blockStatuses.length) {
    for (const s of ['manual', 'stale', 'cached', 'fresh']) if (withVal.every((x) => x === s)) return s;
  }
  return 'partial';
}

/* ---------------------------------------------------------------- manual entry */

/**
 * ხელით/JSON ჩანაწერი (ერთი მაჩვენებელი):
 * { kind:'manual-market-record', schemaVersion:2, origin:'manual'|'json-import', locationId, city, countryCode|null,
 *   metricType:'rent'|'index', metric, value:Dec, low?, high?, currency (rent: ISO; index: null),
 *   source:{ name, url|null }, sourceDate: "YYYY[-MM[-DD]]"|null, enteredAt: ISO, note?: string|null }
 * index metric ∈ INDEX_FIELDS და ბაზა ყოველთვის „ნიუ-იორკი = 100“ (სხვა ბაზის ინდექსი არ მიიღება).
 * @param {unknown} rec @param {{ allowedCurrencies?: readonly string[] }} [options]
 */
export function validateManualRecord(rec, options = {}) {
  /** @type {string[]} */
  const e = [];
  if (!isPlainObject(rec)) return { ok: false, errors: ['$: not_object'] };
  keys(rec, ['kind', 'schemaVersion', 'origin', 'locationId', 'city', 'countryCode', 'metricType', 'metric', 'value', 'currency', 'source', 'sourceDate', 'enteredAt'], ['low', 'high', 'note'], '', e);
  if (rec.kind !== 'manual-market-record') e.push('kind: invalid');
  if (rec.schemaVersion !== MARKET_SCHEMA_VERSION) e.push('schemaVersion: unsupported');
  if (rec.origin !== 'manual' && rec.origin !== 'json-import') e.push('origin: must_be_manual_or_json_import');
  if (!(typeof rec.locationId === 'string' && LOCATION_ID_RE.test(rec.locationId))) e.push('locationId: invalid');
  if (!isSafeText(rec.city, 120)) e.push('city: invalid_text');
  if (rec.countryCode !== null && !(typeof rec.countryCode === 'string' && /^[A-Z]{2}$/.test(rec.countryCode))) e.push('countryCode: invalid');
  if (!isPositiveDecimalString(rec.value)) e.push('value: not_positive_decimal');
  if (rec.metricType === 'rent') {
    if (!Object.prototype.hasOwnProperty.call(RENT_METRICS, rec.metric)) e.push('metric: unknown_rent_metric');
    if (!(typeof rec.currency === 'string' && /^[A-Z]{3}$/.test(rec.currency))) e.push('currency: required_iso4217');
    else if (options.allowedCurrencies && !options.allowedCurrencies.includes(rec.currency)) e.push('currency: not_allowed');
    for (const f of ['low', 'high']) if (f in rec && rec[f] !== null && !isPositiveDecimalString(rec[f])) e.push(`${f}: not_positive_decimal_or_null`);
    if (isPositiveDecimalString(rec.low) && isPositiveDecimalString(rec.high) && compareDecimalStrings(rec.low, rec.high) > 0) e.push('low: greater_than_high');
    if (isPositiveDecimalString(rec.value) && isPositiveDecimalString(rec.low) && compareDecimalStrings(rec.low, rec.value) > 0) e.push('value: below_low');
    if (isPositiveDecimalString(rec.value) && isPositiveDecimalString(rec.high) && compareDecimalStrings(rec.value, rec.high) > 0) e.push('value: above_high');
  } else if (rec.metricType === 'index') {
    if (!INDEX_FIELDS.includes(rec.metric)) e.push('metric: unknown_index_metric');
    if (rec.currency !== null) e.push('currency: must_be_null_for_index');
    if ((rec.low ?? null) !== null || (rec.high ?? null) !== null) e.push('low/high: not_allowed_for_index');
  } else e.push('metricType: must_be_rent_or_index');
  const s = rec.source;
  if (!isPlainObject(s)) e.push('source: not_object');
  else {
    keys(s, ['name', 'url'], [], 'source.', e);
    if (!isSafeText(s.name, 120)) e.push('source.name: invalid_text');
    if (s.url !== null && !isSafeUrl(s.url)) e.push('source.url: invalid_url');
  }
  if (rec.sourceDate !== null && !isPartialDate(rec.sourceDate)) e.push('sourceDate: not_partial_date_or_null');
  if (!isIsoDateTime(rec.enteredAt)) e.push('enteredAt: not_iso_datetime');
  if ('note' in rec && rec.note !== null && !isSafeText(rec.note, 300)) e.push('note: invalid_text');
  return { ok: e.length === 0, errors: e };
}

/** JSON იმპორტის ფაილი: { kind:'market-import', schemaVersion:2, records:[1..200] }. @param {unknown} file @param {{ allowedCurrencies?: readonly string[] }} [options] */
export function validateMarketImport(file, options = {}) {
  /** @type {string[]} */
  const e = [];
  if (!isPlainObject(file)) return { ok: false, errors: ['$: not_object'] };
  keys(file, ['kind', 'schemaVersion', 'records'], [], '', e);
  if (file.kind !== 'market-import') e.push('kind: invalid');
  if (file.schemaVersion !== MARKET_SCHEMA_VERSION) e.push('schemaVersion: unsupported');
  if (!Array.isArray(file.records) || file.records.length === 0 || file.records.length > 200) return { ok: false, errors: [...e, 'records: must_be_array_1_to_200'] };
  const seen = new Set();
  file.records.forEach((r, i) => {
    for (const x of validateManualRecord(r, options).errors) e.push(`records[${i}].${x}`);
    if (isPlainObject(r)) {
      if (r.origin !== 'json-import') e.push(`records[${i}].origin: must_be_json_import_in_file`);
      const k = `${r.locationId}|${r.metricType}|${r.metric}`;
      if (seen.has(k)) e.push(`records[${i}]: duplicate_location_metric`);
      seen.add(k);
    }
  });
  return { ok: e.length === 0, errors: e };
}

/**
 * ვალიდირებული ჩანაწერებიდან MarketData (status "manual", provider null). ვალუტების შერევა აკრძალულია.
 * @param {string} locationId @param {any[]} records @returns {MarketData}
 */
export function marketDataFromManualRecords(locationId, records) {
  const own = records.filter((r) => r.locationId === locationId);
  if (!own.length) return createEmptyMarketData(locationId, 'not_found');
  const curs = new Set(own.filter((r) => r.metricType === 'rent').map((r) => r.currency));
  if (curs.size > 1) throw new RangeError('mixed currencies for one location');
  const md = createEmptyMarketData(locationId, 'not_found', { currency: curs.size ? /** @type {string} */ ([...curs][0]) : null });
  md.resolvedLocation = { city: own[0].city, countryCode: own[0].countryCode, providerCity: null, matchStatus: 'exact' };
  md.warnings = [{ code: 'manual_entry' }];
  let latest = null;
  for (const r of own) {
    if (r.metricType === 'rent') {
      md.rent.items[/** @type {'centre_1br'} */ (r.metric)] = { average: r.value, low: r.low ?? null, high: r.high ?? null };
      md.rent.status = 'manual';
    } else {
      /** @type {any} */ (md.indices)[r.metric] = r.value;
      md.indices.status = 'manual';
    }
    if (r.sourceDate && (!latest || r.sourceDate > latest)) latest = r.sourceDate;
  }
  if (new Set(own.map((r) => `${r.source.name}|${r.source.url}`)).size > 1) md.warnings.push({ code: 'mixed_sources' });
  md.sourceUpdatedAt = latest && /^\d{4}(-\d{2})?$/.test(latest) ? latest : latest ? latest.slice(0, 7) : null;
  md.status = 'manual';
  // ბლოკები ხელით შეუვსებელი რჩება not_found — ზედა დონე „manual“, რადგან მხოლოდ ხელით შეყვანილი მონაცემია.
  return md;
}
