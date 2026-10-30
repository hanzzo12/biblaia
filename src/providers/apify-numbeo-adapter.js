// @ts-check
/**
 * Numbeo-ს მონაცემები Apify actor-ით `automation-lab/numbeo-scraper` — მხოლოდ სერვერზე (Worker / ლოკალური სკრიპტი).
 *
 *  POST https://api.apify.com/v2/acts/automation-lab~numbeo-scraper/run-sync-get-dataset-items?timeout=<წმ>
 *  Authorization: Bearer <APIFY_TOKEN>   ← ტოკენი არასოდეს URL-ში, ლოგში, პასუხში ან შეცდომის ტექსტში.
 *  body: { mode: "city_prices", cities: ["Vienna"], currency: "EUR" }  |  { mode: "rankings" }
 *
 * რეალური გაშვებით დადასტურებული (2026-10-30): city_prices → ბრტყელი სტრიქონები
 * { city, country, category, item, price, currency, range: "12.00-26.00" | "1,800.00-3,000.00" | "", url, scrapedAt };
 * rankings ({ mode, maxCities: 0 }) → { rank, city, country, costOfLivingIndex, rentIndex, costOfLivingPlusRentIndex,
 * groceriesIndex, restaurantPriceIndex, localPurchasingPowerIndex, url }. `comparison` რეჟიმი არ მუშაობს — არ გამოიყენება.
 * მდგრადობისთვის მაინც:
 *  - გასაღებები ნორმალიზდება (lowercase, მხოლოდ a–z0–9): "Cost of Living" = "costOfLiving" = "cost_of_living";
 *  - მიიღება ორივე ფორმა: (ა) [{ city, country, currency, prices:[{ category, item, average|price|avgPrice, lowest|low, highest|high }] }]
 *    და (ბ) ბრტყელი [{ city, country, category, item, price|average, currency }];
 *  - პირველი რეალური გაშვების შემდეგ სქემა უნდა დადასტურდეს (`scripts/live-check-apify.mjs`).
 * ნიუანსი: Numbeo-ს პირობები კრძალავს ავტომატურ scraping-ს ნებართვის გარეშე — გადაწყვეტილება მომხმარებლისაა (ADR-003).
 */

import {
  MARKET_SCHEMA_VERSION, NUMBEO_BASELINE_KA, createEmptyMarketData, validateMarketData, toDecimalString,
  sumDecimalStrings, compareDecimalStrings, overallStatus, DEFAULT_ALLOWED_CURRENCIES,
} from './market-contract.js';

export const APIFY_ACTOR_ID = 'automation-lab~numbeo-scraper';
export const APIFY_SYNC_URL = `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/run-sync-get-dataset-items`;
export const ATTRIBUTION_KA = 'წყარო: Numbeo.com (მოპოვებულია Apify-ის მეშვეობით)';
export const DEFAULT_TIMEOUT_MS = 90000;
/** maxCities: 0 = ყველა ქალაქი (ნაგულისხმევი 50 — ამიტომ ვენა ადრე არ ჩანდა). ~547 ქალაქი, ≈ $2.745 ერთ გაშვებაზე. */
export const RANKINGS_INPUT = Object.freeze({ mode: 'rankings', maxCities: 0 });

/** @param {string} providerCity */
export function providerRef(providerCity) {
  const slug = providerCity.split(',')[0].replace(/\(.*?\)/g, '').trim().split(/\s+/).map(encodeURIComponent).join('-');
  return {
    id: 'numbeo-apify', name: 'Numbeo', via: 'Apify automation-lab/numbeo-scraper',
    sourceUrl: slug ? `https://www.numbeo.com/cost-of-living/in/${slug}` : 'https://www.numbeo.com/cost-of-living/',
    attribution_ka: ATTRIBUTION_KA,
  };
}
export const GENERIC_PROVIDER = Object.freeze({ id: 'numbeo-apify', name: 'Numbeo', via: 'Apify automation-lab/numbeo-scraper', sourceUrl: 'https://www.numbeo.com/cost-of-living/', attribution_ka: ATTRIBUTION_KA });

/**
 * Numbeo-ს ერთეულები. ჯერ ზუსტი დამთხვევა — მიმდინარე სახელები (რეალური გაშვება, ვენა, 2026-10-30), შემდეგ ძველი
 * დაწერილობა; ბოლოს მხოლოდ მითითებული პრეფიქსები. შედარება ასო-ციფრულია (ჰარები/პუნქტუაცია/„m²“ ≠ შეცდომა).
 */
export const ITEM_DEFS = Object.freeze({
  centre_1br: { exact: ['1 Bedroom Apartment in City Centre', 'Apartment (1 bedroom) in City Centre'], prefix: [] },
  outside_1br: { exact: ['1 Bedroom Apartment Outside of City Centre', 'Apartment (1 bedroom) Outside of Centre'], prefix: [] },
  centre_3br: { exact: ['3 Bedroom Apartment in City Centre', 'Apartment (3 bedrooms) in City Centre'], prefix: [] },
  outside_3br: { exact: ['3 Bedroom Apartment Outside of City Centre', 'Apartment (3 bedrooms) Outside of Centre'], prefix: [] },
  basic85m2: { exact: ['Basic Utilities for 85 m2 Apartment (Electricity, Heating, Cooling, Water, Garbage)', 'Basic (Electricity, Heating, Cooling, Water, Garbage) for 85m2 Apartment'], prefix: ['Basic Utilities for 85', 'Basic (Electricity'] },
  internet: { exact: ['Broadband Internet (Unlimited Data, 60 Mbps or Higher)', 'Internet (60 Mbps or More, Unlimited Data, Cable/ADSL)'], prefix: ['Broadband Internet', 'Internet ('] },
  inexpensiveMeal: { exact: ['Meal at an Inexpensive Restaurant', 'Meal, Inexpensive Restaurant'], prefix: [] },
  midRangeForTwo: { exact: ['Meal for Two at a Mid-Range Restaurant (Three Courses, Without Drinks)', 'Meal for 2 People, Mid-range Restaurant, Three-course'], prefix: [] },
});
/** სურსათის კალათიდან გამორიცხული (ალკოჰოლი, თამბაქო) — ზუსტი სახელები + საკვანძო სიტყვები. */
export const GROCERY_EXCLUDED_NAMES = Object.freeze(['Bottle of Wine (Mid-Range)', 'Domestic Beer (0.5 Liter Bottle)', 'Imported Beer (0.33 Liter Bottle)', 'Cigarettes (Pack of 20, Marlboro)']);
const EXCLUDED_RE = /\b(wine|beer|cigarette|cigarettes|tobacco|vodka|whisky|whiskey|spirits)\b/i;
const GROCERY_CATEGORIES = new Set(['markets', 'groceries', 'supermarket', 'supermarkets']);

/* ---------------------------------------------------------------- helpers */

/** @param {string} k */ const nk = (k) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
/** @param {unknown} o @returns {Record<string, any>} */
function normKeys(o) {
  /** @type {Record<string, any>} */
  const r = {};
  if (o && typeof o === 'object' && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) { const n = nk(k); if (!(n in r)) r[n] = v; }
  return r;
}
/** @param {Record<string, any>} o @param {string[]} names */
function pick(o, names) {
  for (const n of names) if (o[n] !== undefined && o[n] !== null && o[n] !== '') return o[n];
  return undefined;
}
/** @param {unknown} s */
const normText = (s) => (typeof s === 'string' ? s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\s+/g, ' ').replace(/[,\s]*\(?rent per month\)?$/, '').trim() : '');
/** ასო-ციფრული გასაღები ერთეულის სახელისთვის. @param {unknown} s */
const itemKey = (s) => normText(s).replace(/[^a-z0-9]/g, '');
/** @param {unknown} s */
const normCity = (s) => normText(s).replace(/\s*\([^)]*\)/g, '').replace(/\s*,\s*/g, ',').trim();

/** დაბრუნებული ქალაქი ემთხვევა თუ არა მოთხოვნილს ("Vienna" ↔ "Vienna, Austria"; "New York, NY" ↔ "New York"). */
export function cityMatches(/** @type {unknown} */ got, /** @type {string} */ want) {
  const a = normCity(got); const b = normCity(want);
  if (!a || !b) return false;
  return a === b || a.startsWith(b + ',') || b.startsWith(a + ',');
}
/** @param {unknown} c */
function normCurrency(c) {
  if (typeof c !== 'string') return null;
  const t = c.trim();
  if (/^[A-Za-z]{3}$/.test(t)) return t.toUpperCase();
  if (t === '€') return 'EUR';
  if (t === '$' || t === 'US$') return 'USD';
  return 'UNKNOWN';
}

/**
 * ორივე გამოსავლის ფორმიდან ფასის სტრიქონები.
 * @param {unknown[]} items
 * @returns {{ city: unknown, country: unknown, currency: string|null, category: string, item: string, average: unknown, low: unknown, high: unknown }[]}
 */
export function extractPriceRows(items) {
  const rows = [];
  for (const it of items) {
    const o = normKeys(it);
    const city = pick(o, ['city', 'cityname', 'name', 'location']);
    const country = pick(o, ['country', 'countryname']);
    const topCur = pick(o, ['currency', 'displaycurrency']);
    const nested = Array.isArray(o.prices) ? o.prices : Array.isArray(o.items) ? o.items : null;
    const list = nested ? nested.map((p) => ({ p: normKeys(p), city, country, cur: topCur })) : [{ p: o, city, country, cur: topCur }];
    for (const { p, cur } of list) {
      const item = pick(p, ['item', 'itemname', 'name', 'title']);
      if (typeof item !== 'string' || (!nested && item === city)) continue;
      let low = pick(p, ['lowest', 'low', 'min', 'lowestprice', 'rangelow', 'minprice']);
      let high = pick(p, ['highest', 'high', 'max', 'highestprice', 'rangehigh', 'maxprice']);
      const range = pick(p, ['range', 'pricerange']);
      if (low === undefined && high === undefined && typeof range === 'string') {
        const m = /^\s*([\d.,\s]+)\s*[-–]\s*([\d.,\s]+)\s*$/.exec(range.replace(/[^\d.,\s\-–]/g, ''));
        if (m) { low = m[1]; high = m[2]; }
      }
      rows.push({
        city: pick(p, ['city']) ?? city, country: pick(p, ['country']) ?? country,
        currency: normCurrency(pick(p, ['currency']) ?? cur),
        category: String(pick(p, ['category', 'categoryname', 'section']) ?? ''),
        item, average: pick(p, ['average', 'price', 'avgprice', 'averageprice', 'avg', 'value']), low, high,
      });
    }
  }
  return rows;
}

/** @param {{ average: unknown, low: unknown, high: unknown }} r */
function toPrice(r) {
  const average = toDecimalString(r.average);
  if (average === null) return null;
  let low = toDecimalString(r.low); let high = toDecimalString(r.high);
  if ((low && compareDecimalStrings(low, average) > 0) || (high && compareDecimalStrings(average, high) > 0)) { low = null; high = null; }
  return { average, low, high };
}

/**
 * საჭირო ერთეულების შერჩევა (ზუსტი → პრეფიქსი) და სურსათის კალათის ჯამი.
 * @param {ReturnType<typeof extractPriceRows>} rows
 */
export function selectItems(rows) {
  /** @type {Record<string, {average:string, low:string|null, high:string|null}|null>} */
  const out = {};
  for (const [key, def] of Object.entries(ITEM_DEFS)) {
    let row = null;
    for (const name of def.exact) { row = rows.find((r) => itemKey(r.item) === itemKey(name)); if (row) break; }
    if (!row) for (const pre of def.prefix) { row = rows.find((r) => itemKey(r.item).startsWith(itemKey(pre))); if (row) break; }
    out[key] = row ? toPrice(row) : null;
  }
  const excludedKeys = new Set(GROCERY_EXCLUDED_NAMES.map(itemKey));
  const market = rows.filter((r) => GROCERY_CATEGORIES.has(nk(r.category)) && !excludedKeys.has(itemKey(r.item)) && !EXCLUDED_RE.test(String(r.item)));
  const vals = market.map((r) => toDecimalString(r.average));
  const counted = /** @type {string[]} */ (vals.filter((v) => v !== null));
  return { items: out, basket: { sum: sumDecimalStrings(counted), counted: counted.length, missing: vals.length - counted.length } };
}

/**
 * rankings სტრიქონიდან ინდექსები: ქალაქის ზუსტი Numbeo სახელი (+ ქვეყანა, თუ ცნობილია).
 * @param {unknown[]} items @param {string} providerCity @param {string|null} [country]
 */
export function findRanking(items, providerCity, country = null) {
  for (const it of items) {
    const o = normKeys(it);
    if (normText(pick(o, ['city', 'cityname', 'name'])) !== normText(providerCity)) continue;
    const rc = pick(o, ['country', 'countryname']);
    if (country && typeof rc === 'string' && normText(rc) !== normText(country)) continue;
    const d = (/** @type {string[]} */ names) => toDecimalString(pick(o, names));
    const periodRaw = pick(o, ['period', 'year', 'title']);
    const pm = typeof periodRaw === 'string' || typeof periodRaw === 'number' ? /(\d{4})/.exec(String(periodRaw)) : null;
    return {
      costOfLiving: d(['costoflivingindex', 'costofliving', 'cpiindex', 'costoflivingexcludingrent']),
      rent: d(['rentindex', 'rent']),
      groceries: d(['groceriesindex', 'groceries']),
      restaurants: d(['restaurantpriceindex', 'restaurantsindex', 'restaurantindex', 'restaurants']),
      costOfLivingPlusRent: d(['costoflivingplusrentindex', 'costoflivingplusrent', 'cpiandrentindex']),
      period: pm ? pm[1] : null,
    };
  }
  return null;
}

/* ---------------------------------------------------------------- upstream */

/**
 * ერთი სინქრონული actor გაშვება. განმეორებითი ცდა არ არის.
 * @param {{ input: object, token: string, fetchImpl: typeof fetch, timeoutMs?: number }} p
 * @returns {Promise<{ status: 'ok', items: unknown[], http: number, ms: number } | { status: string, http: number|null, ms: number, paymentRequired?: boolean }>}
 */
export async function runActor(p) {
  const timeoutMs = p.timeoutMs && p.timeoutMs > 0 ? p.timeoutMs : DEFAULT_TIMEOUT_MS;
  const started = Date.now();
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ac.abort(); }, timeoutMs);
  const url = `${APIFY_SYNC_URL}?timeout=${Math.max(10, Math.min(300, Math.floor(timeoutMs / 1000) - 5))}`;
  try {
    const res = await p.fetchImpl(url, {
      method: 'POST', signal: ac.signal, redirect: 'error',
      headers: { Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(p.input),
    });
    const ms = () => Date.now() - started;
    if (!res.ok) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      const s = res.status;
      const status = s === 401 || s === 403 || s === 402 ? 'unauthorized' : s === 408 ? 'timeout' : s === 429 ? 'rate_limited'
        : s >= 500 ? 'upstream_error' : s === 404 ? 'upstream_error' : 'invalid_response';
      return { status, http: s, ms: ms(), paymentRequired: s === 402 };
    }
    const text = await res.text();
    if (text.length > 10_000_000) return { status: 'invalid_response', http: res.status, ms: ms() };
    let body;
    try { body = JSON.parse(text); } catch { return { status: 'invalid_response', http: res.status, ms: ms() }; }
    if (!Array.isArray(body)) return { status: 'invalid_response', http: res.status, ms: ms() };
    if (body.length === 0) return { status: 'not_found', http: res.status, ms: ms() };
    return { status: 'ok', items: body, http: res.status, ms: ms() };
  } catch {
    return { status: timedOut ? 'timeout' : 'network_error', http: null, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------- normalize */

/**
 * @param {string} status @param {number} have @param {number} total @param {boolean} [complete]
 */
function blockStatus(status, have, total, complete = have === total) {
  if (have === 0) return status === 'ok' ? 'not_found' : status;
  return complete ? 'fresh' : 'partial';
}

/**
 * ქალაქის ფასები + rankings → MarketData v2 (სუფთა ფუნქცია; ტესტირებადი).
 * @param {{ locationId: string, currency: string, entry: { numbeoCity: string, countryCode: string|null, matchStatus: 'exact'|'nearby-explained', note?: string, verified?: boolean },
 *           prices: { status: string, items?: unknown[], paymentRequired?: boolean }, rankings: { status: string, items?: unknown[] }, fetchedAt: string }} p
 */
export function normalizeApify(p) {
  const { entry, currency } = p;
  const warnings = new Set(['scraped_source_terms', 'source_date_unknown']);
  if (!entry.verified) warnings.add('city_name_unverified');
  if (entry.matchStatus === 'nearby-explained') warnings.add('nearby_city');
  if (p.prices.paymentRequired) warnings.add('payment_required');

  let pStatus = p.prices.status;
  /** @type {ReturnType<typeof selectItems>|null} */
  let sel = null;
  if (pStatus === 'ok') {
    const rows = extractPriceRows(p.prices.items || []);
    if (rows.length === 0) pStatus = 'invalid_response';
    else {
      const withCity = rows.filter((r) => typeof r.city === 'string' && r.city.trim());
      const own = withCity.length ? withCity.filter((r) => cityMatches(r.city, entry.numbeoCity)) : rows;
      if (!withCity.length) warnings.add('city_name_unverified');
      if (withCity.length && own.length === 0) pStatus = 'wrong_city';
      else {
        const curs = new Set(own.map((r) => r.currency).filter(Boolean));
        if ([...curs].some((c) => c !== currency)) pStatus = 'wrong_city';
        else {
          if (curs.size === 0) warnings.add('currency_unconfirmed');
          sel = selectItems(own);
        }
      }
    }
  }
  let rStatus = p.rankings.status;
  const rank = rStatus === 'ok' ? findRanking(p.rankings.items || [], entry.numbeoCity, entry.numbeoCountry ?? null) : null;
  const idxOn = rStatus !== 'disabled';
  if (rStatus === 'ok' && !rank) rStatus = 'not_found';
  const ix = rank || { costOfLiving: null, rent: null, groceries: null, restaurants: null, costOfLivingPlusRent: null, period: null };

  const it = sel ? sel.items : {};
  const rentItems = { centre_1br: it.centre_1br ?? null, outside_1br: it.outside_1br ?? null, centre_3br: it.centre_3br ?? null, outside_3br: it.outside_3br ?? null };
  const rentHave = Object.values(rentItems).filter(Boolean).length;
  const errOf = (/** @type {string} */ a, /** @type {string} */ b) => (a !== 'ok' && a !== 'not_found' ? a : b !== 'ok' && b !== 'not_found' ? b : 'not_found');

  const rent = {
    status: rentHave + (ix.rent ? 1 : 0) === 0 ? errOf(pStatus, rStatus) : blockStatus('ok', rentHave + (ix.rent ? 1 : 0), idxOn ? 5 : 4),
    items: rentItems, rentIndex: ix.rent,
  };
  const uHave = [it.basic85m2, it.internet].filter(Boolean).length;
  const utilities = { status: uHave === 0 ? (pStatus === 'ok' ? 'not_found' : pStatus) : blockStatus('ok', uHave, 2), basic85m2: it.basic85m2 ?? null, internet: it.internet ?? null };
  const b = sel ? sel.basket : { sum: null, counted: 0, missing: 0 };
  if (b.missing > 0) warnings.add('basket_incomplete');
  const gHave = (b.sum ? 1 : 0) + (ix.groceries ? 1 : 0);
  const groceries = {
    status: gHave === 0 ? errOf(pStatus, rStatus) : blockStatus('ok', gHave, idxOn ? 2 : 1, gHave === (idxOn ? 2 : 1) && b.missing === 0),
    basketItemsSum: b.sum, itemsCounted: b.counted, itemsMissing: b.missing, groceriesIndex: ix.groceries,
  };
  const mHave = [it.inexpensiveMeal, it.midRangeForTwo].filter(Boolean).length + (ix.restaurants ? 1 : 0);
  const restaurants = {
    status: mHave === 0 ? errOf(pStatus, rStatus) : blockStatus('ok', mHave, idxOn ? 3 : 2),
    inexpensiveMeal: it.inexpensiveMeal ?? null, midRangeForTwo: it.midRangeForTwo ?? null, restaurantIndex: ix.restaurants,
  };
  const iHave = [ix.costOfLiving, ix.rent, ix.groceries, ix.restaurants, ix.costOfLivingPlusRent].filter(Boolean).length;
  const indices = {
    costOfLiving: ix.costOfLiving, rent: ix.rent, groceries: ix.groceries, restaurants: ix.restaurants, costOfLivingPlusRent: ix.costOfLivingPlusRent,
    baseline: NUMBEO_BASELINE_KA, status: iHave === 0 ? (rStatus === 'ok' ? 'not_found' : rStatus) : blockStatus('ok', iHave, 5), period: iHave ? ix.period : null,
  };
  if (rentHave) { warnings.add('range_is_not_confidence_interval'); warnings.add('quality_not_guaranteed'); }
  if (iHave) warnings.add('index_is_not_money');
  const status = overallStatus([rent.status, utilities.status, groceries.status, restaurants.status, indices.status]);
  if (status === 'partial') warnings.add('partial_data');

  /** @type {import('./market-contract.js').MarketData} */
  const data = {
    schemaVersion: MARKET_SCHEMA_VERSION,
    requestedLocationId: p.locationId,
    resolvedLocation: {
      city: entry.numbeoCity, countryCode: entry.countryCode, providerCity: entry.numbeoCity, matchStatus: entry.matchStatus,
      ...(entry.matchStatus === 'nearby-explained' ? { note: entry.note ?? null } : {}),
    },
    provider: providerRef(entry.numbeoCity),
    currency, status, rent, utilities, groceries, restaurants, indices,
    fetchedAt: p.fetchedAt, sourceUpdatedAt: null,
    cache: { state: 'miss', expiresAt: null },
    warnings: [...warnings].map((code) => ({ code })),
  };
  return data;
}

/**
 * სრული მოთხოვნა ერთი ლოკაციისთვის. `getRankings` — გარედან (Worker ქეშირებს 30 დღით, ერთი გამოძახება ყველა ქალაქზე).
 * @param {{ locationId: string, currency: string, names: { locations: Record<string, any> }, token: string|undefined|null,
 *           fetchImpl: typeof fetch, timeoutMs?: number, now?: () => number,
 *           getRankings?: () => Promise<{ status: string, items?: unknown[] }> }} p
 * @returns {Promise<{ data: import('./market-contract.js').MarketData, diagnostics: Record<string, unknown> }>}
 */
export async function fetchApifyMarket(p) {
  const now = p.now || Date.now;
  const entry = p.names && p.names.locations && Object.prototype.hasOwnProperty.call(p.names.locations, p.locationId) ? p.names.locations[p.locationId] : null;
  const nc = (/** @type {string} */ reason) => ({ data: createEmptyMarketData(p.locationId, 'not_configured', { currency: p.currency, provider: { ...GENERIC_PROVIDER } }), diagnostics: { reason } });
  if (!DEFAULT_ALLOWED_CURRENCIES.includes(p.currency)) return nc('currency');
  if (typeof p.token !== 'string' || p.token.trim() === '') return nc('no_token');
  if (!entry || typeof entry.numbeoCity !== 'string' || !entry.numbeoCity.trim()) return nc('unmapped');
  const token = p.token.trim();
  const getRankings = p.getRankings || (() => runActor({ input: RANKINGS_INPUT, token, fetchImpl: p.fetchImpl, timeoutMs: p.timeoutMs }));
  const [prices, rankings] = await Promise.all([
    runActor({ input: { mode: 'city_prices', cities: [entry.numbeoCity], currency: p.currency }, token, fetchImpl: p.fetchImpl, timeoutMs: p.timeoutMs }),
    getRankings(),
  ]);
  const fetchedAt = new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const data = normalizeApify({ locationId: p.locationId, currency: p.currency, entry, prices, rankings, fetchedAt });
  const diagnostics = { prices: { http: prices.http ?? null, ms: prices.ms ?? null, status: prices.status }, rankings: { status: rankings.status } };
  const v = validateMarketData(data, { allowedCurrencies: DEFAULT_ALLOWED_CURRENCIES });
  if (!v.ok) {
    return { data: createEmptyMarketData(p.locationId, 'invalid_response', { currency: p.currency, provider: providerRef(entry.numbeoCity) }), diagnostics: { ...diagnostics, validationErrors: v.errors.slice(0, 5) } };
  }
  return { data, diagnostics };
}
