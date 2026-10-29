// @ts-check
/**
 * ბაზრის მონაცემების საჯარო API ბრაუზერისთვის (და Worker-ისთვის უსაფრთხო): კლიენტი `/api/market`-ისთვის,
 * „მხოლოდ ბოლო მოთხოვნა“ დამხმარე, ხელით შეყვანის/JSON იმპორტის ვალიდაცია და ქართული იარლიყები.
 * ქსელს მხოლოდ `createMarketClient().get()` იყენებს; დანარჩენი სუფთა ფუნქციებია.
 * Numbeo-ს გასაღები და upstream URL აქ არასოდეს ჩნდება.
 */

import {
  MARKET_SCHEMA_VERSION, DATA_STATUS, DEFAULT_ALLOWED_CURRENCIES, createEmptyMarketData,
  validateMarketData, validateManualRecord as validateManualRecordRaw, validateMarketImport,
  marketDataFromManualRecords,
} from './market-contract.js';

export * from './market-contract.js';

/** სტატუსების ქართული იარლიყები (UI). */
export const MARKET_STATUS_LABELS_KA = Object.freeze({
  loading: 'იტვირთება',
  fresh: 'განახლებულია',
  cached: 'შენახული მონაცემია',
  stale: 'მოძველებულია',
  manual: 'ხელითაა შეყვანილი',
  partial: 'ნაწილობრივ ხელმისაწვდომია',
  not_found: 'ვერ მოიძებნა',
  network_error: 'კავშირი ვერ შედგა',
  timeout: 'პასუხის ლოდინის დრო ამოიწურა',
  not_configured: 'პროვაიდერი არ არის კონფიგურირებული',
  unauthorized: 'პროვაიდერთან წვდომა უარყოფილია',
  rate_limited: 'მოთხოვნების ლიმიტი ამოიწურა — სცადეთ მოგვიანებით',
  upstream_error: 'პროვაიდერის სერვისი დროებით მიუწვდომელია',
  invalid_response: 'პროვაიდერის პასუხი არასწორია',
  wrong_city: 'პასუხი სხვა ქალაქს ან ვალუტას ეკუთვნის — უარყოფილია',
});

/** გაფრთხილებების ქართული ტექსტები (UI). */
export const MARKET_WARNING_LABELS_KA = Object.freeze({
  nearby_city: 'ნაჩვენებია ახლომდებარე ქალაქის მონაცემი (ზუსტი დამთხვევა არ არის).',
  country_level_only: 'ხელმისაწვდომია მხოლოდ ქვეყნის დონის მონაცემი; ქალაქის ცენტრის ქირად არ გამოიყენება.',
  low_data_points: 'მონაცემთა წერტილები ცოტაა — შეფასება ნაკლებად სანდოა.',
  range_is_not_confidence_interval: 'დიაპაზონი პროვაიდერის მინიმალური–მაქსიმალური მნიშვნელობებია და არა ნდობის ინტერვალი.',
  quality_not_guaranteed: 'ბინის ხარისხი, ფართობი, ავეჯი და უბანი განსხვავდება; საშუალო „საშუალო ხარისხს“ არ უზრუნველყოფს.',
  index_is_not_money: 'ინდექსი ფულადი თანხა არ არის და თვიურ ხარჯად არ გამოიყენება.',
  source_date_unknown: 'წყაროში მონაცემის განახლების თარიღი უცნობია.',
  stale_cache_used: 'ნაჩვენებია ადრე შენახული (მოძველებული) მონაცემი, რადგან პროვაიდერი ახლა მიუწვდომელია.',
  partial_data: 'მონაცემი ნაწილობრივია.',
  manual_entry: 'მონაცემი ხელითაა შეყვანილი და ავტომატურად მოპოვებული არ არის.',
  snapshot_not_live: 'ეს დათარიღებული ასლია და არა მიმდინარე ფასი.',
  mixed_sources: 'მაჩვენებლები სხვადასხვა წყაროდანაა.',
  license_unconfirmed: 'პროვაიდერის ლიცენზიის პირობები ჯერ არ არის დადასტურებული.',
  synthetic_test_data: 'სინთეზური სატესტო მონაცემი — რეალური ფასი არ არის.',
  item_mapping_unverified: 'პროვაიდერის მაჩვენებლის იდენტიფიკატორი ვერ დადასტურდა.',
});

/** ვალიდაციის კოდების ქართული ახსნა. */
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
  unknown_rent_metric: 'ქირის უცნობი ტიპი (დაშვებულია: centre_1br, centre_3br, outside_1br, outside_3br).',
  unknown_index_metric: 'ინდექსის უცნობი ტიპი.',
  must_be_null_for_index: 'ინდექსს ვალუტა არ აქვს — უნდა იყოს null.',
  not_allowed_for_index: 'ინდექსს დიაპაზონი არ აქვს.',
  not_allowed_for_rent: 'ქირისთვის საბაზო მნიშვნელობა არ გამოიყენება.',
  required_for_index: 'ინდექსისთვის საბაზო შედარება (baseline) სავალდებულოა.',
  must_be_rent_or_index: 'metricType უნდა იყოს "rent" ან "index".',
  not_partial_date_or_null: 'თარიღი: YYYY, YYYY-MM ან YYYY-MM-DD, ან null თუ უცნობია.',
  not_iso_datetime: 'მოსალოდნელია ISO 8601 დრო (მაგ. 2026-10-29T10:00:00Z).',
  must_be_manual_or_json_import: 'წარმომავლობა უნდა იყოს "manual" ან "json-import".',
  must_be_json_import_in_file: 'ფაილის ჩანაწერებში origin უნდა იყოს "json-import".',
  duplicate_location_metric: 'ერთი ქალაქისა და მაჩვენებლისთვის ჩანაწერი მეორდება.',
  must_be_array_1_to_200: 'records უნდა იყოს 1–200 ჩანაწერის მასივი.',
});

/**
 * "<path>: <code>" სტრიქონები → [{ path, code, message_ka }] (contracts.md §5).
 * @param {string[]} errors
 * @returns {{ path: string, code: string, message_ka: string }[]}
 */
export function toStructuredErrors(errors) {
  return errors.map((e) => {
    const i = e.lastIndexOf(': ');
    const path = i >= 0 ? e.slice(0, i) : '$';
    const code = i >= 0 ? e.slice(i + 2) : e;
    return { path, code, message_ka: /** @type {Record<string,string>} */ (ERROR_MESSAGES_KA)[code] || 'მნიშვნელობა არასწორია.' };
  });
}

/**
 * ხელით შეყვანილი ერთი ჩანაწერის ვალიდაცია სტრუქტურირებული შეცდომებით.
 * @param {unknown} record
 * @param {{ allowedCurrencies?: readonly string[] }} [options]
 */
export function validateManualRecord(record, options = {}) {
  const r = validateManualRecordRaw(record, options);
  return { ok: r.ok, errors: toStructuredErrors(r.errors) };
}

export const MAX_IMPORT_BYTES = 256 * 1024;

/**
 * JSON იმპორტის ტექსტის გარჩევა და ვალიდაცია. არასოდეს ისვრის.
 * @param {unknown} text
 * @param {{ allowedCurrencies?: readonly string[] }} [options]
 * @returns {{ ok: boolean, data: import('./market-contract.js').MarketImportFile | null, errors: { path: string, code: string, message_ka: string }[] }}
 */
export function parseManualMarketJson(text, options = {}) {
  if (typeof text !== 'string') return { ok: false, data: null, errors: toStructuredErrors(['$: invalid_json']) };
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, data: null, errors: toStructuredErrors(['$: too_large']) };
  let parsed;
  try { parsed = JSON.parse(text.replace(/^﻿/, '')); } catch {
    return { ok: false, data: null, errors: toStructuredErrors(['$: invalid_json']) };
  }
  const v = validateMarketImport(parsed, options);
  return v.ok ? { ok: true, data: parsed, errors: [] } : { ok: false, data: null, errors: toStructuredErrors(v.errors) };
}

/** იმპორტირებული ჩანაწერებიდან MarketData ერთი ლოკაციისთვის (ვალიდაციის შემდეგ). */
export { marketDataFromManualRecords };

/**
 * „მხოლოდ ბოლო“ — წინა მოთხოვნას აუქმებს და მის გვიან პასუხს უგულებელყოფს.
 * გამოყენება: `const r = await latest.run((signal) => client.get(id, cur, { signal })); if (r.superseded) return;`
 * @template T
 */
export function createLatestOnly() {
  let seq = 0;
  /** @type {AbortController|null} */
  let current = null;
  return {
    /**
     * @param {(signal: AbortSignal) => Promise<T>} fn
     * @returns {Promise<{ superseded: true } | { superseded: false, value: T }>}
     */
    async run(fn) {
      const id = ++seq;
      if (current) current.abort();
      const ac = new AbortController();
      current = ac;
      let value;
      try { value = await fn(ac.signal); } catch (e) {
        if (id !== seq) return { superseded: true };
        throw e;
      } finally {
        if (current === ac && id === seq) current = null;
      }
      return id === seq ? { superseded: false, value } : { superseded: true };
    },
    /** მიმდინარე მოთხოვნის გაუქმება (მაგ. ქალაქის გასუფთავებისას). */
    cancel() { seq++; if (current) current.abort(); current = null; },
  };
}

const LOCATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * `/api/market` კლიენტი. `get` არასოდეს ისვრის: ყველა შეცდომა MarketData-ს სტატუსად ბრუნდება.
 * @param {{ endpoint?: string, fetchImpl?: typeof fetch, timeoutMs?: number, allowedCurrencies?: readonly string[] }} [opts]
 */
export function createMarketClient(opts = {}) {
  const endpoint = opts.endpoint || '/api/market';
  const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 15000;
  const allowed = opts.allowedCurrencies || DEFAULT_ALLOWED_CURRENCIES;

  /**
   * @param {string} locationId @param {string} currency
   * @param {{ signal?: AbortSignal }} [o]
   * @returns {Promise<import('./market-contract.js').MarketData>}
   */
  async function get(locationId, currency, o = {}) {
    const safeLoc = typeof locationId === 'string' && LOCATION_ID_RE.test(locationId) ? locationId : 'invalid';
    const empty = (/** @type {string} */ status) => createEmptyMarketData(safeLoc, status, { currency: allowed.includes(currency) ? currency : null });
    if (safeLoc === 'invalid' || !allowed.includes(currency)) return empty(DATA_STATUS.NOT_CONFIGURED);
    if (!fetchImpl) return empty(DATA_STATUS.NETWORK_ERROR);

    const ac = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ac.abort(); }, timeoutMs);
    const onAbort = () => ac.abort();
    if (o.signal) { if (o.signal.aborted) ac.abort(); else o.signal.addEventListener('abort', onAbort, { once: true }); }
    try {
      const sep = endpoint.includes('?') ? '&' : '?';
      const url = `${endpoint}${sep}location=${encodeURIComponent(safeLoc)}&currency=${encodeURIComponent(currency)}`;
      const res = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store', signal: ac.signal });
      let body = null;
      try { body = JSON.parse(await res.text()); } catch { body = null; }
      if (body === null) {
        if (res.status === 401 || res.status === 403) return empty(DATA_STATUS.UNAUTHORIZED);
        if (res.status === 429) return empty(DATA_STATUS.RATE_LIMITED);
        if (res.status >= 500) return empty(DATA_STATUS.UPSTREAM_ERROR);
        return empty(DATA_STATUS.INVALID_RESPONSE);
      }
      const v = validateMarketData(body, { allowedCurrencies: allowed });
      if (!v.ok) {
        if (res.status === 401 || res.status === 403) return empty(DATA_STATUS.UNAUTHORIZED);
        if (res.status === 429) return empty(DATA_STATUS.RATE_LIMITED);
        if (res.status >= 500) return empty(DATA_STATUS.UPSTREAM_ERROR);
        return empty(DATA_STATUS.INVALID_RESPONSE);
      }
      if (body.requestedLocationId !== safeLoc || (body.currency !== null && body.currency !== currency)) {
        return empty(DATA_STATUS.WRONG_CITY);
      }
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
