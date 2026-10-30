// @ts-check
/**
 * ბაზრის მონაცემების საჯარო API ბრაუზერისთვის (MarketData v2, ADR-003). Worker-შიც უსაფრთხოა.
 * ქსელს მხოლოდ `createMarketClient().get()` იყენებს (`/api/market`); ტოკენი/upstream URL აქ არასოდეს ჩნდება.
 */

import {
  MARKET_SCHEMA_VERSION, DATA_STATUS, DEFAULT_ALLOWED_CURRENCIES, createEmptyMarketData, validateMarketData,
  validateManualRecord as validateManualRecordRaw, validateMarketImport,
} from './market-contract.js';

export * from './market-contract.js';

export const MARKET_STATUS_LABELS_KA = Object.freeze({
  loading: 'იტვირთება',
  fresh: 'განახლებულია',
  cached: 'შენახული მონაცემია',
  stale: 'მოძველებულია (ბოლო შენახული ასლი)',
  partial: 'ნაწილობრივ ხელმისაწვდომია',
  manual: 'ხელითაა შეყვანილი',
  not_found: 'ვერ მოიძებნა',
  network_error: 'კავშირი ვერ შედგა',
  timeout: 'პასუხის ლოდინის დრო ამოიწურა',
  not_configured: 'მონაცემთა წყარო არ არის კონფიგურირებული',
  unauthorized: 'წყაროსთან წვდომა უარყოფილია',
  rate_limited: 'მოთხოვნების ლიმიტი ამოიწურა — სცადეთ მოგვიანებით',
  upstream_error: 'მონაცემთა სერვისი დროებით მიუწვდომელია',
  invalid_response: 'წყაროს პასუხი არასწორია',
  wrong_city: 'პასუხი სხვა ქალაქს ან ვალუტას ეკუთვნის — უარყოფილია',
  disabled: 'ბაზრის მონაცემები გამორთულია',
});

export const MARKET_CATEGORY_LABELS_KA = Object.freeze({
  rent: 'ქირა',
  utilities: 'კომუნალური',
  groceries: 'სურსათი',
  restaurants: 'რესტორნები',
  indices: 'ცხოვრების ღირებულების ინდექსები',
  centre_1br: 'ცენტრი — 1 საძინებელი',
  outside_1br: 'გარეუბანი — 1 საძინებელი',
  centre_3br: 'ცენტრი — 3 საძინებელი',
  outside_3br: 'გარეუბანი — 3 საძინებელი',
  rentIndex: 'ქირის ინდექსი',
  basic85m2: 'ძირითადი კომუნალური (85 მ² ბინა: ელექტროენერგია, გათბობა/გაგრილება, წყალი, ნარჩენები)',
  internet: 'ინტერნეტი (60 Mbps ან მეტი)',
  basketItemsSum: 'ძირითადი სასურსათო ჩამონათვალი (ალკოჰოლისა და თამბაქოს გარეშე)',
  groceriesIndex: 'სურსათის ინდექსი',
  inexpensiveMeal: 'კვება იაფ რესტორანში (1 პირი)',
  midRangeForTwo: 'საშუალო რესტორანი, 2 პირი, სამი კერძი',
  restaurantIndex: 'რესტორნების ფასების ინდექსი',
  costOfLiving: 'ცხოვრების ღირებულების ინდექსი (ქირის გარეშე)',
  costOfLivingPlusRent: 'ცხოვრების ღირებულება + ქირა',
});

export const MARKET_WARNING_LABELS_KA = Object.freeze({
  nearby_city: 'ნაჩვენებია ახლომდებარე ქალაქის მონაცემი (ზუსტი დამთხვევა არ არის).',
  low_data: 'მონაცემთა წერტილები ცოტაა — შეფასება ნაკლებად სანდოა.',
  range_is_not_confidence_interval: 'დიაპაზონი წყაროს მინიმალური–მაქსიმალური მნიშვნელობებია და არა ნდობის ინტერვალი.',
  quality_not_guaranteed: 'ბინის ხარისხი, ფართობი, ავეჯი და უბანი განსხვავდება; საშუალო „საშუალო ხარისხს“ არ უზრუნველყოფს.',
  index_is_not_money: 'ინდექსი ფულადი თანხა არ არის (ნიუ-იორკი = 100).',
  source_date_unknown: 'წყაროში მონაცემის განახლების თარიღი უცნობია; ნაჩვენებია მიღების თარიღი.',
  stale_cache_used: 'ახალი მონაცემი ვერ მივიღეთ — ნაჩვენებია ბოლო შენახული ასლი.',
  partial_data: 'მონაცემი ნაწილობრივია.',
  manual_entry: 'მონაცემი ხელითაა შეყვანილი და ავტომატურად მოპოვებული არ არის.',
  mixed_sources: 'მაჩვენებლები სხვადასხვა წყაროდანაა.',
  basket_incomplete: 'სასურსათო ჩამონათვალში ზოგიერთი ერთეულის ფასი აკლია — ჯამში ისინი არ შედის (ალკოჰოლი და თამბაქო არასოდეს შედის).',
  currency_unconfirmed: 'წყარომ ვალუტა ცხადად არ მიუთითა.',
  city_name_unverified: 'ქალაქის დასახელება წყაროში ჯერ არ არის დადასტურებული.',
  output_schema_unverified: 'მონაცემთა ფორმატი რეალური გაშვებით ჯერ არ არის დადასტურებული.',
  scraped_source_terms: 'მონაცემი Numbeo.com-დან მესამე მხარის სერვისით (Apify) არის მოპოვებული; Numbeo-ს პირობები ავტომატურ შეგროვებას ზღუდავს.',
  payment_required: 'Apify-ის ანგარიშზე კრედიტი ამოიწურა ან გადახდაა საჭირო.',
  synthetic_test_data: 'სინთეზური სატესტო მონაცემი — რეალური ფასი არ არის.',
});

const ERROR_MESSAGES_KA = Object.freeze({
  missing: 'სავალდებულო ველი აკლია.',
  unknown_field: 'უცნობი ველი — დაშვებული არ არის.',
  not_object: 'მოსალოდნელია ობიექტი.',
  invalid: 'მნიშვნელობა არასწორია.',
  invalid_text: 'ტექსტი ცარიელია, ძალიან გრძელია ან შეიცავს დაუშვებელ სიმბოლოებს (მაგ. < >).',
  invalid_url: 'URL უნდა იყოს http(s) მისამართი.',
  invalid_json: 'ფაილი არ არის სწორი JSON.',
  too_large: 'ფაილი ძალიან დიდია.',
  unsupported: 'სქემის ვერსია მხარდაჭერილი არ არის.',
  not_allowed: 'ვალუტა დაშვებული არ არის.',
  required_iso4217: 'ვალუტა უნდა იყოს ISO 4217 კოდი (მაგ. EUR).',
  not_positive_decimal: 'მოსალოდნელია დადებითი ათწილადი რიცხვი სტრიქონად (მაგ. "1500.50").',
  not_positive_decimal_or_null: 'მოსალოდნელია დადებითი ათწილადი რიცხვი ან null.',
  greater_than_high: 'მინიმუმი მაქსიმუმზე მეტია.',
  below_low: 'მნიშვნელობა მინიმუმზე ნაკლებია.',
  above_high: 'მნიშვნელობა მაქსიმუმზე მეტია.',
  unknown_rent_metric: 'ქირის უცნობი ტიპი (დაშვებულია: centre_1br, outside_1br, centre_3br, outside_3br).',
  unknown_index_metric: 'ინდექსის უცნობი ტიპი.',
  must_be_null_for_index: 'ინდექსს ვალუტა არ აქვს — უნდა იყოს null.',
  not_allowed_for_index: 'ინდექსს დიაპაზონი არ აქვს.',
  must_be_rent_or_index: 'metricType უნდა იყოს "rent" ან "index".',
  not_partial_date_or_null: 'თარიღი: YYYY, YYYY-MM ან YYYY-MM-DD, ან null თუ უცნობია.',
  not_iso_datetime: 'მოსალოდნელია ISO 8601 დრო (მაგ. 2026-10-29T10:00:00Z).',
  must_be_manual_or_json_import: 'წარმომავლობა უნდა იყოს "manual" ან "json-import".',
  must_be_json_import_in_file: 'ფაილის ჩანაწერებში origin უნდა იყოს "json-import".',
  duplicate_location_metric: 'ერთი ქალაქისა და მაჩვენებლისთვის ჩანაწერი მეორდება.',
  must_be_array_1_to_200: 'records უნდა იყოს 1–200 ჩანაწერის მასივი.',
});

/** "<path>: <code>" → [{ path, code, message_ka }] (contracts.md §5). @param {string[]} errors */
export function toStructuredErrors(errors) {
  return errors.map((e) => {
    const i = e.lastIndexOf(': ');
    const path = i >= 0 ? e.slice(0, i) : '$';
    const code = i >= 0 ? e.slice(i + 2) : e;
    return { path, code, message_ka: /** @type {Record<string,string>} */ (ERROR_MESSAGES_KA)[code] || 'მნიშვნელობა არასწორია.' };
  });
}

/** ხელით შეყვანილი ერთი ჩანაწერი → { ok, errors:[{path, code, message_ka}] }. @param {unknown} record @param {{ allowedCurrencies?: readonly string[] }} [options] */
export function validateManualRecord(record, options = {}) {
  const r = validateManualRecordRaw(record, options);
  return { ok: r.ok, errors: toStructuredErrors(r.errors) };
}

export const MAX_IMPORT_BYTES = 256 * 1024;

/** JSON იმპორტის ტექსტი → { ok, data, errors }. არასოდეს ისვრის. @param {unknown} text @param {{ allowedCurrencies?: readonly string[] }} [options] */
export function parseManualMarketJson(text, options = {}) {
  if (typeof text !== 'string') return { ok: false, data: null, errors: toStructuredErrors(['$: invalid_json']) };
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, data: null, errors: toStructuredErrors(['$: too_large']) };
  let parsed;
  try { parsed = JSON.parse(text.replace(/^﻿/, '')); } catch { return { ok: false, data: null, errors: toStructuredErrors(['$: invalid_json']) }; }
  const v = validateMarketImport(parsed, options);
  return v.ok ? { ok: true, data: parsed, errors: [] } : { ok: false, data: null, errors: toStructuredErrors(v.errors) };
}

/**
 * საძინებლების ნაგულისხმევი შერჩევა ოჯახის მიხედვით (ADR-003 §5): მოსამსახურე მარტო ან +1 → 1; +2 და მეტი → 3.
 * Numbeo-ს 2-საძინებლიანი არ აქვს; ინტერპოლაცია აკრძალულია. მომხმარებელს შეუძლია შეცვალოს.
 * @param {unknown} familyCount თანმხლები ოჯახის წევრების რაოდენობა (მოსამსახურის გარეშე)
 * @returns {1|3}
 */
export function suggestBedrooms(familyCount) {
  const n = typeof familyCount === 'number' ? familyCount : Number(familyCount);
  return Number.isFinite(n) && n >= 2 ? 3 : 1;
}

/**
 * „მხოლოდ ბოლო მოთხოვნა“ — წინას აუქმებს და მის გვიან პასუხს უგულებელყოფს.
 * `const r = await latest.run((signal) => client.get(id, cur, { signal })); if (r.superseded) return;`
 * @template T
 */
export function createLatestOnly() {
  let seq = 0;
  /** @type {AbortController|null} */
  let current = null;
  return {
    /** @param {(signal: AbortSignal) => Promise<T>} fn @returns {Promise<{ superseded: true } | { superseded: false, value: T }>} */
    async run(fn) {
      const id = ++seq;
      if (current) current.abort();
      const ac = new AbortController();
      current = ac;
      let value;
      try { value = await fn(ac.signal); } catch (e) { if (id !== seq) return { superseded: true }; throw e; } finally { if (current === ac && id === seq) current = null; }
      return id === seq ? { superseded: false, value } : { superseded: true };
    },
    cancel() { seq++; if (current) current.abort(); current = null; },
  };
}

const LOCATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * `/api/market` კლიენტი. `get` არასოდეს ისვრის. ნაგულისხმევი timeout 100 წმ (Apify-ის სინქრონული გაშვება ≤ 90 წმ).
 * @param {{ endpoint?: string, fetchImpl?: typeof fetch, timeoutMs?: number, allowedCurrencies?: readonly string[] }} [opts]
 */
export function createMarketClient(opts = {}) {
  const endpoint = opts.endpoint || '/api/market';
  const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 100000;
  const allowed = opts.allowedCurrencies || DEFAULT_ALLOWED_CURRENCIES;

  /** @param {string} locationId @param {string} currency @param {{ signal?: AbortSignal }} [o] @returns {Promise<import('./market-contract.js').MarketData>} */
  async function get(locationId, currency, o = {}) {
    const loc = typeof locationId === 'string' && LOCATION_ID_RE.test(locationId) ? locationId : 'invalid';
    const empty = (/** @type {string} */ s) => createEmptyMarketData(loc, s, { currency: allowed.includes(currency) ? currency : null });
    if (loc === 'invalid' || !allowed.includes(currency)) return empty(DATA_STATUS.NOT_CONFIGURED);
    if (!fetchImpl) return empty(DATA_STATUS.NETWORK_ERROR);
    const ac = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ac.abort(); }, timeoutMs);
    const onAbort = () => ac.abort();
    if (o.signal) { if (o.signal.aborted) ac.abort(); else o.signal.addEventListener('abort', onAbort, { once: true }); }
    try {
      const sep = endpoint.includes('?') ? '&' : '?';
      const res = await fetchImpl(`${endpoint}${sep}location=${encodeURIComponent(loc)}&currency=${encodeURIComponent(currency)}`,
        { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store', signal: ac.signal });
      let body = null;
      try { body = JSON.parse(await res.text()); } catch { body = null; }
      const byHttp = () => (res.status === 401 || res.status === 403 ? 'unauthorized' : res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'upstream_error' : 'invalid_response');
      if (body === null || !validateMarketData(body, { allowedCurrencies: allowed }).ok) return empty(byHttp());
      if (body.requestedLocationId !== loc || (body.currency !== null && body.currency !== currency)) return empty(DATA_STATUS.WRONG_CITY);
      return body;
    } catch {
      return empty(timedOut ? DATA_STATUS.TIMEOUT : DATA_STATUS.NETWORK_ERROR);
    } finally {
      clearTimeout(timer);
      if (o.signal) o.signal.removeEventListener('abort', onAbort);
    }
  }
  return { get, schemaVersion: MARKET_SCHEMA_VERSION };
}
