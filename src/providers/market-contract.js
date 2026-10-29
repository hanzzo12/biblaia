// @ts-check
/**
 * MarketData — ბაზრის (ქირა / ცხოვრების ღირებულების ინდექსი) ნორმალიზებული კონტრაქტი.
 *
 * სტატუსი: პირველი ეტაპის წინადადება (PROPOSAL, phase 1). საბოლოო ფორმას ამტკიცებს
 * ხელმძღვანელი `docs/contracts.md`-ში. მფლობელი: გარე მონაცემებისა და Cloudflare-ის ინჟინერი.
 *
 * ეს მოდული სუფთაა: DOM, ქსელი, საათი (Date.now) და გლობალური მდგომარეობა არ გამოიყენება.
 * ერთნაირად მუშაობს ბრაუზერში (ოფლაინ HTML), Worker-ში და `node --test`-ში.
 *
 * ძირითადი წესები (დავალება §7, §8, §11):
 *  - არარსებული მნიშვნელობა = `null` + შესაბამისი სტატუსი; არასოდეს `0`.
 *  - ფულადი თანხები და ინდექსები — ათწილადი სტრიქონები ("1757.14"), რათა ბირთვმა
 *    (BigInt წილადები) ზუსტად წაიკითხოს, თუ მომხმარებელი „გამოვიყენო დაგეგმილ ქირად“ დააჭერს.
 *  - `sourceUpdatedAt` (მონაცემის განახლება წყაროში) ≠ `fetchedAt` (ჩვენ მიერ მიღება).
 *    `sourceUpdatedAt` შეიძლება იყოს ნაწილობრივი თარიღი "YYYY" / "YYYY-MM" — დღე არ გამოიგონება.
 *  - ხელით/JSON-ით შეყვანილი მონაცემი მოინიშნება `origin: "manual" | "json-import"` და
 *    `status: "manual"`; ასეთი მონაცემი პროვაიდერის ავტომატურ მონაცემად ვერ გაივლის ვალიდაციას.
 *  - 2-საძინებლიანი კატეგორია არ არსებობს — ინტერპოლაცია აკრძალულია; უცნობი მეტრიკა უარყოფილია.
 *  - ქვეყნის დონის (`country-level`) დამთხვევისას ქირის მნიშვნელობები დაუშვებელია
 *    (ქვეყნის საშუალო ქალაქის ცენტრის ქირად არ ჩანს).
 */

/** სქემის ვერსია. იზრდება ნებისმიერი შეუთავსებელი ცვლილებისას; შედის Worker-ის ქეშის გასაღებში. */
export const MARKET_SCHEMA_VERSION = 1;

/**
 * მონაცემის მდგომარეობები (ქირასა და ინდექსს — თითოეულს თავისი).
 * ქართული იარლიყები UI-ს ეკუთვნის; აქ მხოლოდ სტაბილური კოდებია.
 * @readonly
 * @enum {string}
 */
export const DATA_STATUS = Object.freeze({
  /** იტვირთება (მხოლოდ კლიენტის დროებითი მდგომარეობა; Worker ამას არ აბრუნებს). */
  LOADING: 'loading',
  /** განახლებულია — ახლახან მიღებული პროვაიდერისგან (ქეშის გარეშე). */
  FRESH: 'fresh',
  /** შენახული მონაცემია — ნებადართული ქეშიდან, TTL-ის ფარგლებში. */
  CACHED: 'cached',
  /** მოძველებულია — ქეში TTL-ს გადაცდა და გამოყენებულია მხოლოდ კონფიგურირებული ზღვრის ფარგლებში. */
  STALE: 'stale',
  /** ხელითაა შეყვანილი ან JSON-იდან იმპორტირებული. */
  MANUAL: 'manual',
  /** ნაწილობრივ ხელმისაწვდომია (მაგ. საშუალო არის, დიაპაზონი — არა). */
  PARTIAL: 'partial',
  /** ვერ მოიძებნა — პროვაიდერს ამ ქალაქისთვის/მეტრიკისთვის მონაცემი არ აქვს. */
  NOT_FOUND: 'not_found',
  /** კავშირი ვერ შედგა (ქსელი/DNS/Worker მიუწვდომელია). */
  NETWORK_ERROR: 'network_error',
  /** მოთხოვნის დრო ამოიწურა (upstream timeout). */
  TIMEOUT: 'timeout',
  /** პროვაიდერი არ არის კონფიგურირებული (გასაღები/ლიცენზია/ქალაქის შესაბამისობა არ არის). */
  NOT_CONFIGURED: 'not_configured',
  /** პროვაიდერმა უარყო გასაღები (401/403). */
  UNAUTHORIZED: 'unauthorized',
  /** კვოტა/სიჩქარის ლიმიტი (ჩვენი ან პროვაიდერის 429). */
  RATE_LIMITED: 'rate_limited',
  /** პროვაიდერის 5xx. */
  UPSTREAM_ERROR: 'upstream_error',
  /** არასწორი/არასრული JSON ან სქემასთან შეუსაბამო პასუხი. */
  INVALID_RESPONSE: 'invalid_response',
  /** პასუხი სხვა ქალაქს ან ვალუტას ეკუთვნის — უარყოფილია. */
  WRONG_CITY: 'wrong_city',
});

/** @type {ReadonlySet<string>} */
const ALL_STATUSES = new Set(Object.values(DATA_STATUS));

/** სტატუსები, რომლებშიც მნიშვნელობა (საშუალო/ინდექსი) სავალდებულოა. */
export const STATUSES_WITH_VALUE = Object.freeze(['fresh', 'cached', 'stale', 'manual']);
/** სტატუსი, რომელშიც ნაწილი მნიშვნელობებისა შეიძლება იყოს null. */
export const STATUSES_PARTIAL = Object.freeze(['partial']);
/** სტატუსები, რომლებშიც ყველა მნიშვნელობა სავალდებულოდ null-ია. */
export const STATUSES_WITHOUT_VALUE = Object.freeze([
  'loading', 'not_found', 'network_error', 'timeout', 'not_configured',
  'unauthorized', 'rate_limited', 'upstream_error', 'invalid_response', 'wrong_city',
]);

/**
 * ქალაქის დამთხვევის სტატუსი.
 * @readonly
 * @enum {string}
 */
export const MATCH_STATUS = Object.freeze({
  /** პროვაიდერის ქალაქი ზუსტად ის ქალაქია, სადაც დაწესებულებაა. */
  EXACT: 'exact',
  /** ახლომდებარე ქალაქი, მკაფიო ახსნით (მაგ. ვატიკანი → რომი). არასოდეს „ზუსტი“. */
  NEARBY_EXPLAINED: 'nearby-explained',
  /** მხოლოდ ქვეყნის დონის მონაცემი — ქირა არ ჩანს, ინდექსი ცალკე ნიშნით. */
  COUNTRY_LEVEL: 'country-level',
  /** შესაბამისობა არ არის. */
  NONE: 'none',
});

/**
 * ქეშის მდგომარეობა (Worker-ის პასუხის დონეზე).
 * @readonly
 * @enum {string}
 */
export const CACHE_STATE = Object.freeze({
  /** ქეში არ გამოყენებულა (ხელით შეყვანა, ქეში გამორთულია ლიცენზიის გამო, ან მონაცემი არ არის). */
  NONE: 'none',
  /** ქეშში არ იყო — პროვაიდერისგან ახლა მოვიდა. */
  MISS: 'miss',
  /** ქეშიდან, TTL-ის ფარგლებში. */
  HIT: 'hit',
  /** ვადაგასული ქეში, გამოყენებული upstream შეცდომისას `MARKET_STALE_MAX_SECONDS` ფარგლებში. */
  STALE: 'stale',
});

/**
 * მონაცემის წარმომავლობა — თითოეულ ქირის ჩანაწერსა და ინდექსის ბლოკზე.
 * @readonly
 * @enum {string}
 */
export const ORIGIN = Object.freeze({
  /** პროვაიდერის ოფიციალური API (Worker-ის გავლით). */
  PROVIDER: 'provider',
  /** მომხმარებელმა ხელით შეიყვანა. */
  MANUAL: 'manual',
  /** ვალიდირებული JSON ფაილიდან. */
  JSON_IMPORT: 'json-import',
  /** ჩაშენებული დათარიღებული ასლი (მხოლოდ ლიცენზიით ნებადართულისას). */
  SNAPSHOT: 'snapshot',
});

/**
 * ქირის მეტრიკები. გასაღები სტაბილურია; 2-საძინებლიანი შეგნებულად არ არსებობს.
 * `bedrooms` — საძინებლების რაოდენობა (არა „ოთახები“).
 */
export const RENT_METRICS = Object.freeze({
  centre_1br: Object.freeze({ bedrooms: 1, area: 'centre' }),
  centre_3br: Object.freeze({ bedrooms: 3, area: 'centre' }),
  outside_1br: Object.freeze({ bedrooms: 1, area: 'outside' }),
  outside_3br: Object.freeze({ bedrooms: 3, area: 'outside' }),
});

/** ნაგულისხმევი ქირის მეტრიკა UI-ში (დავალება §7). */
export const DEFAULT_RENT_METRIC = 'centre_1br';

/** ინდექსის მეტრიკები (ხელით შეყვანისთვისაც). */
export const INDEX_METRICS = Object.freeze({
  costOfLivingExcludingRent: 'costOfLivingExcludingRent',
  rentIndex: 'rentIndex',
  costOfLivingPlusRent: 'costOfLivingPlusRent',
});

/**
 * გაფრთხილების კოდები. ტექსტს UI თარგმნის; პროვაიდერის ტექსტი HTML-ად არასოდეს ჩაისმება.
 * @readonly
 * @enum {string}
 */
export const WARNING_CODE = Object.freeze({
  NEARBY_CITY: 'nearby_city',
  COUNTRY_LEVEL_ONLY: 'country_level_only',
  LOW_DATA_POINTS: 'low_data_points',
  RANGE_IS_NOT_CONFIDENCE_INTERVAL: 'range_is_not_confidence_interval',
  QUALITY_NOT_GUARANTEED: 'quality_not_guaranteed',
  INDEX_IS_NOT_MONEY: 'index_is_not_money',
  SOURCE_DATE_UNKNOWN: 'source_date_unknown',
  STALE_CACHE_USED: 'stale_cache_used',
  PARTIAL_DATA: 'partial_data',
  MANUAL_ENTRY: 'manual_entry',
  SNAPSHOT_NOT_LIVE: 'snapshot_not_live',
  MIXED_SOURCES: 'mixed_sources',
  LICENSE_UNCONFIRMED: 'license_unconfirmed',
  SYNTHETIC_TEST_DATA: 'synthetic_test_data',
  ITEM_MAPPING_UNVERIFIED: 'item_mapping_unverified',
});

/** @type {ReadonlySet<string>} */
const ALL_WARNING_CODES = new Set(Object.values(WARNING_CODE));

/** Worker-ის ნაგულისხმევი ნებადართული ვალუტები (`/api/market?currency=`). */
export const DEFAULT_ALLOWED_CURRENCIES = Object.freeze(['EUR', 'USD']);

/** Numbeo-ს ინდექსების ბაზა (cpi_explained.jsp): ნიუ-იორკი = 100. */
export const NUMBEO_BASELINE = Object.freeze({ label: 'New York City', value: '100' });

/* ------------------------------------------------------------------------------------------ */
/* JSDoc ტიპები                                                                                */
/* ------------------------------------------------------------------------------------------ */

/**
 * @typedef {string} DecimalString  არაუარყოფითი ათწილადი სტრიქონი, მაგ. "1757.14". ექსპონენტა აკრძალულია.
 * @typedef {string} PartialDate     "YYYY" | "YYYY-MM" | "YYYY-MM-DD" — დღე/თვე არ გამოიგონება.
 * @typedef {string} IsoDateTime     ISO 8601 UTC, მაგ. "2026-10-29T08:15:00Z".
 *
 * @typedef {Object} SourceRef
 * @property {string} id            პროვაიდერის/წყაროს სტაბილური id ("numbeo", "manual", ...).
 * @property {string} name          ჩვენებადი სახელი.
 * @property {string|null} sourceUrl  https/http URL ან null.
 * @property {string|null} attribution  ატრიბუციის ტექსტი (უბრალო ტექსტი, არა HTML).
 *
 * @typedef {Object} ResolvedLocation
 * @property {string|null} city              პროვაიდერის ქალაქის სახელი (უბრალო ტექსტი).
 * @property {string|null} countryCode       ISO 3166-1 alpha-2.
 * @property {string|null} providerCityId    პროვაიდერის რეალური ID (Numbeo `city_id`, სტრიქონად). არასოდეს გამოგონილი.
 * @property {'exact'|'nearby-explained'|'country-level'|'none'} matchStatus
 * @property {string|null} [note]            ახსნა (სავალდებულოა nearby-explained-ისთვის).
 *
 * @typedef {Object} RentItem
 * @property {'centre_1br'|'centre_3br'|'outside_1br'|'outside_3br'} metric
 * @property {1|3} bedrooms
 * @property {'centre'|'outside'} area
 * @property {DecimalString|null} average   თვიური საშუალო (Numbeo `average_price`).
 * @property {DecimalString|null} low       პროვაიდერის დიაპაზონის ქვედა ზღვარი (არა ნდობის ინტერვალი).
 * @property {DecimalString|null} high      პროვაიდერის დიაპაზონის ზედა ზღვარი.
 * @property {number|null} dataPoints       მონაცემთა წერტილების რაოდენობა (მთელი ≥ 0).
 * @property {string} status                DATA_STATUS.
 * @property {string} origin                ORIGIN.
 * @property {PartialDate|null} sourceUpdatedAt
 * @property {IsoDateTime|null} fetchedAt
 * @property {SourceRef|null} [source]      თუ განსხვავდება ზედა დონის `provider`-ისგან.
 *
 * @typedef {Object} RentBlock
 * @property {string} status                ბლოკის შემაჯამებელი სტატუსი.
 * @property {Partial<Record<'centre_1br'|'centre_3br'|'outside_1br'|'outside_3br', RentItem>>} items
 *   გასაღები = მეტრიკა. გასაღების არარსებობა = ეს კატეგორია არ მოთხოვნილა/არ არსებობს.
 *
 * @typedef {Object} IndicesBlock
 * @property {DecimalString|null} costOfLivingExcludingRent  Numbeo `cpi_index`.
 * @property {DecimalString|null} rentIndex                  Numbeo `rent_index`.
 * @property {DecimalString|null} costOfLivingPlusRent       Numbeo `cpi_and_rent_index`.
 * @property {{label: string, value: DecimalString}|null} baseline  მაგ. {label:"New York City", value:"100"}.
 * @property {string} status
 * @property {string} origin
 * @property {PartialDate|null} sourceUpdatedAt
 * @property {IsoDateTime|null} fetchedAt
 * @property {SourceRef|null} [source]
 *
 * @typedef {Object} CacheInfo
 * @property {'none'|'miss'|'hit'|'stale'} state
 * @property {IsoDateTime|null} expiresAt
 *
 * @typedef {Object} MarketWarning
 * @property {string} code                 WARNING_CODE.
 * @property {string} [message]            სურვილისამებრ, უბრალო ტექსტი (≤ 300).
 *
 * @typedef {Object} MarketData
 * @property {number} schemaVersion        === MARKET_SCHEMA_VERSION
 * @property {string} requestedLocationId  შიდა ქალაქის ID (არა დაწესებულების სახელი).
 * @property {ResolvedLocation} resolvedLocation
 * @property {SourceRef|null} provider     ზედა დონის წყარო; ხელით შეყვანისას შეიძლება null იყოს.
 * @property {string|null} currency        ISO 4217; null მხოლოდ მაშინ, როცა ფულადი მნიშვნელობა არ არის.
 * @property {RentBlock} rent
 * @property {IndicesBlock} indices
 * @property {CacheInfo} cache
 * @property {MarketWarning[]} warnings
 */

/**
 * ხელით შეყვანის / JSON იმპორტის ერთი ჩანაწერი. ერთი ჩანაწერი = ერთი მაჩვენებელი.
 *
 * @typedef {Object} ManualMarketRecord
 * @property {'manual-market-record'} kind
 * @property {number} schemaVersion           === MARKET_SCHEMA_VERSION
 * @property {'manual'|'json-import'} origin  არასოდეს "provider".
 * @property {string} locationId              შიდა ქალაქის ID.
 * @property {string} city                    ქალაქის სახელი, როგორც წყაროშია.
 * @property {string|null} countryCode        ISO 3166-1 alpha-2 ან null.
 * @property {'rent'|'index'} metricType
 * @property {string} metric                  rent → RENT_METRICS გასაღები; index → INDEX_METRICS გასაღები.
 * @property {DecimalString} value            > 0.
 * @property {DecimalString|null} [low]       მხოლოდ rent.
 * @property {DecimalString|null} [high]      მხოლოდ rent.
 * @property {string|null} currency           rent → სავალდებულო ISO 4217; index → null.
 * @property {{label: string, value: DecimalString}|null} [baseline]  index → სავალდებულო.
 * @property {{name: string, url: string|null}} source
 * @property {PartialDate|null} sourceDate    წყაროს თარიღი, თუ ცნობილია; სხვა შემთხვევაში null.
 * @property {IsoDateTime} enteredAt          შეყვანის დრო.
 * @property {string|null} [note]
 *
 * @typedef {Object} MarketImportFile
 * @property {'market-import'} kind
 * @property {number} schemaVersion
 * @property {ManualMarketRecord[]} records   1..200
 *
 * @typedef {Object} ValidationResult
 * @property {boolean} ok
 * @property {string[]} errors   "<path>: <code>" ფორმით, მაგ. "rent.items.centre_1br.average: not_decimal".
 */

/* ------------------------------------------------------------------------------------------ */
/* პრიმიტიული შემმოწმებლები                                                                  */
/* ------------------------------------------------------------------------------------------ */

const DECIMAL_RE = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/;
const PARTIAL_DATE_RE = /^(\d{4})(?:-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?)?$/;
const ISO_DATETIME_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const LOCATION_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PROVIDER_CITY_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
// C0/C1 მართვის სიმბოლოები და bidi override-ები; `<`/`>` — HTML ინექციის პრევენციისთვის (UI მაინც textContent-ს იყენებს).
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT_RE = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩<>]/;

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v) &&
    (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
}

/** @param {unknown} v */
export function isDecimalString(v) {
  return typeof v === 'string' && DECIMAL_RE.test(v);
}

/** @param {unknown} v */
export function isPositiveDecimalString(v) {
  return isDecimalString(v) && /[1-9]/.test(/** @type {string} */ (v));
}

/** @param {unknown} v */
export function isPartialDate(v) {
  if (typeof v !== 'string') return false;
  const m = PARTIAL_DATE_RE.exec(v);
  if (!m) return false;
  if (m[3]) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return d.getUTCDate() === Number(m[3]);
  }
  return true;
}

/** @param {unknown} v */
export function isIsoDateTime(v) {
  return typeof v === 'string' && ISO_DATETIME_RE.test(v) && !Number.isNaN(Date.parse(v));
}

/** @param {unknown} v @param {number} max */
export function isSafeText(v, max) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max && !UNSAFE_TEXT_RE.test(v);
}

/** @param {unknown} v */
export function isSafeUrl(v) {
  if (typeof v !== 'string' || v.length > 500 || UNSAFE_TEXT_RE.test(v)) return false;
  try {
    const u = new URL(v);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** ათწილადი სტრიქონების შედარება (მხოლოდ DECIMAL_RE-ს შესაბამისისთვის). @param {string} a @param {string} b */
export function compareDecimalStrings(a, b) {
  const [ai, af = ''] = a.split('.');
  const [bi, bf = ''] = b.split('.');
  if (ai.length !== bi.length) return ai.length < bi.length ? -1 : 1;
  if (ai !== bi) return ai < bi ? -1 : 1;
  const len = Math.max(af.length, bf.length);
  const ap = af.padEnd(len, '0');
  const bp = bf.padEnd(len, '0');
  return ap === bp ? 0 : ap < bp ? -1 : 1;
}

/* ------------------------------------------------------------------------------------------ */
/* ვალიდატორები                                                                               */
/* ------------------------------------------------------------------------------------------ */

/**
 * @param {Record<string, unknown>} obj
 * @param {readonly string[]} required
 * @param {readonly string[]} optional
 * @param {string} path
 * @param {string[]} errors
 */
function checkKeys(obj, required, optional, path, errors) {
  for (const k of required) if (!(k in obj)) errors.push(`${path}${k}: missing`);
  const allowed = new Set([...required, ...optional]);
  for (const k of Object.keys(obj)) if (!allowed.has(k)) errors.push(`${path}${k}: unknown_field`);
}

/** @param {unknown} v @param {string} path @param {string[]} errors */
function checkSourceRef(v, path, errors) {
  if (v === null) return;
  if (!isPlainObject(v)) { errors.push(`${path}: not_object`); return; }
  checkKeys(v, ['id', 'name', 'sourceUrl', 'attribution'], [], `${path}.`, errors);
  if (!(typeof v.id === 'string' && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(v.id))) errors.push(`${path}.id: invalid`);
  if (!isSafeText(v.name, 120)) errors.push(`${path}.name: invalid_text`);
  if (v.sourceUrl !== null && !isSafeUrl(v.sourceUrl)) errors.push(`${path}.sourceUrl: invalid_url`);
  if (v.attribution !== null && !isSafeText(v.attribution, 300)) errors.push(`${path}.attribution: invalid_text`);
}

/**
 * საერთო წესები სტატუსისა და მნიშვნელობების თანხვედრაზე.
 * @param {string} status
 * @param {string} origin
 * @param {unknown[]} values  ბლოკის ძირითადი მნიშვნელობები (საშუალო ან სამი ინდექსი)
 * @param {boolean} primaryPresent  არის თუ არა მთავარი მნიშვნელობა
 * @param {string} path
 * @param {string[]} errors
 */
function checkStatusValueConsistency(status, origin, values, primaryPresent, path, errors) {
  const anyValue = values.some((x) => x !== null);
  if (STATUSES_WITHOUT_VALUE.includes(status) && anyValue) errors.push(`${path}.status: values_must_be_null_for_${status}`);
  if (STATUSES_WITH_VALUE.includes(status) && !primaryPresent) errors.push(`${path}.status: value_required_for_${status}`);
  if (status === 'partial' && !anyValue) errors.push(`${path}.status: partial_without_any_value`);
  const manualOrigin = origin === 'manual' || origin === 'json-import';
  if (status === 'manual' && !manualOrigin) errors.push(`${path}.origin: manual_status_requires_manual_origin`);
  if (manualOrigin && status !== 'manual') errors.push(`${path}.status: manual_origin_requires_manual_status`);
  if (origin === 'snapshot' && (status === 'fresh' || status === 'manual')) errors.push(`${path}.status: snapshot_cannot_be_${status}`);
}

/**
 * @param {unknown} item @param {string} key @param {string} path @param {string[]} errors
 * @returns {boolean} შეიცავს თუ არა მნიშვნელობას
 */
function checkRentItem(item, key, path, errors) {
  if (!isPlainObject(item)) { errors.push(`${path}: not_object`); return false; }
  checkKeys(item, ['metric', 'bedrooms', 'area', 'average', 'low', 'high', 'dataPoints', 'status', 'origin', 'sourceUpdatedAt', 'fetchedAt'], ['source'], `${path}.`, errors);
  const def = /** @type {Record<string, {bedrooms:number, area:string}>} */ (RENT_METRICS)[key];
  if (item.metric !== key) errors.push(`${path}.metric: must_equal_key`);
  if (def && item.bedrooms !== def.bedrooms) errors.push(`${path}.bedrooms: inconsistent_with_metric`);
  if (def && item.area !== def.area) errors.push(`${path}.area: inconsistent_with_metric`);
  for (const f of ['average', 'low', 'high']) {
    const v = item[f];
    if (v !== null && !isPositiveDecimalString(v)) errors.push(`${path}.${f}: not_positive_decimal_or_null`);
  }
  if (isPositiveDecimalString(item.low) && isPositiveDecimalString(item.high) &&
      compareDecimalStrings(/** @type {string} */ (item.low), /** @type {string} */ (item.high)) > 0) {
    errors.push(`${path}.low: greater_than_high`);
  }
  if (isPositiveDecimalString(item.average)) {
    if (isPositiveDecimalString(item.low) && compareDecimalStrings(/** @type {string} */ (item.low), /** @type {string} */ (item.average)) > 0) errors.push(`${path}.average: below_low`);
    if (isPositiveDecimalString(item.high) && compareDecimalStrings(/** @type {string} */ (item.average), /** @type {string} */ (item.high)) > 0) errors.push(`${path}.average: above_high`);
  }
  if (item.dataPoints !== null && !(Number.isSafeInteger(item.dataPoints) && /** @type {number} */ (item.dataPoints) >= 0)) errors.push(`${path}.dataPoints: not_non_negative_integer_or_null`);
  if (typeof item.status !== 'string' || !ALL_STATUSES.has(item.status)) errors.push(`${path}.status: unknown`);
  if (typeof item.origin !== 'string' || !Object.values(ORIGIN).includes(item.origin)) errors.push(`${path}.origin: unknown`);
  if (item.sourceUpdatedAt !== null && !isPartialDate(item.sourceUpdatedAt)) errors.push(`${path}.sourceUpdatedAt: not_partial_date_or_null`);
  if (item.fetchedAt !== null && !isIsoDateTime(item.fetchedAt)) errors.push(`${path}.fetchedAt: not_iso_datetime_or_null`);
  if ('source' in item) checkSourceRef(item.source, `${path}.source`, errors);
  if (typeof item.status === 'string' && typeof item.origin === 'string') {
    checkStatusValueConsistency(item.status, item.origin, [item.average, item.low, item.high, item.dataPoints], item.average !== null, path, errors);
  }
  return item.average !== null || item.low !== null || item.high !== null;
}

/**
 * MarketData-ს სრული ვალიდაცია. სუფთა ფუნქციაა: არ ცვლის შესასვლელს, არ კითხულობს საათს.
 *
 * @param {unknown} obj
 * @param {{ allowedCurrencies?: readonly string[] }} [options]
 *   `allowedCurrencies` — თუ მითითებულია, ვალუტა ამ სიაში უნდა იყოს (Worker: EUR/USD).
 * @returns {ValidationResult}
 */
export function validateMarketData(obj, options = {}) {
  /** @type {string[]} */
  const errors = [];
  if (!isPlainObject(obj)) return { ok: false, errors: ['$: not_object'] };

  checkKeys(obj, ['schemaVersion', 'requestedLocationId', 'resolvedLocation', 'provider', 'currency', 'rent', 'indices', 'cache', 'warnings'], [], '', errors);

  if (obj.schemaVersion !== MARKET_SCHEMA_VERSION) errors.push('schemaVersion: unsupported');
  if (!(typeof obj.requestedLocationId === 'string' && LOCATION_ID_RE.test(obj.requestedLocationId))) errors.push('requestedLocationId: invalid');

  // resolvedLocation
  const loc = obj.resolvedLocation;
  let matchStatus = 'none';
  if (!isPlainObject(loc)) {
    errors.push('resolvedLocation: not_object');
  } else {
    checkKeys(loc, ['city', 'countryCode', 'providerCityId', 'matchStatus'], ['note'], 'resolvedLocation.', errors);
    if (typeof loc.matchStatus !== 'string' || !Object.values(MATCH_STATUS).includes(loc.matchStatus)) errors.push('resolvedLocation.matchStatus: unknown');
    else matchStatus = loc.matchStatus;
    if (loc.city !== null && !isSafeText(loc.city, 120)) errors.push('resolvedLocation.city: invalid_text');
    if (loc.countryCode !== null && !(typeof loc.countryCode === 'string' && COUNTRY_RE.test(loc.countryCode))) errors.push('resolvedLocation.countryCode: invalid');
    if (loc.providerCityId !== null && !(typeof loc.providerCityId === 'string' && PROVIDER_CITY_ID_RE.test(loc.providerCityId))) errors.push('resolvedLocation.providerCityId: invalid');
    if ('note' in loc && loc.note !== null && !isSafeText(loc.note, 300)) errors.push('resolvedLocation.note: invalid_text');
    if ((matchStatus === 'exact' || matchStatus === 'nearby-explained') && loc.city === null) errors.push('resolvedLocation.city: required_for_city_match');
    if (matchStatus === 'nearby-explained' && !(typeof loc.note === 'string' && loc.note.trim())) errors.push('resolvedLocation.note: required_for_nearby_explained');
    if (matchStatus === 'country-level' && loc.countryCode === null) errors.push('resolvedLocation.countryCode: required_for_country_level');
  }

  checkSourceRef(obj.provider, 'provider', errors);

  // currency
  const cur = obj.currency;
  if (cur !== null) {
    if (!(typeof cur === 'string' && CURRENCY_RE.test(cur))) errors.push('currency: invalid');
    else if (options.allowedCurrencies && !options.allowedCurrencies.includes(cur)) errors.push('currency: not_allowed');
  }

  // rent
  let anyRentValue = false;
  const rent = obj.rent;
  if (!isPlainObject(rent)) {
    errors.push('rent: not_object');
  } else {
    checkKeys(rent, ['status', 'items'], [], 'rent.', errors);
    if (typeof rent.status !== 'string' || !ALL_STATUSES.has(rent.status)) errors.push('rent.status: unknown');
    if (!isPlainObject(rent.items)) {
      errors.push('rent.items: not_object');
    } else {
      for (const [key, item] of Object.entries(rent.items)) {
        if (!Object.prototype.hasOwnProperty.call(RENT_METRICS, key)) { errors.push(`rent.items.${key}: unknown_metric`); continue; }
        if (checkRentItem(item, key, `rent.items.${key}`, errors)) anyRentValue = true;
      }
      if (STATUSES_WITHOUT_VALUE.includes(/** @type {string} */ (rent.status)) && anyRentValue) errors.push('rent.status: values_present_but_block_status_has_no_value');
    }
  }

  // indices
  let anyIndexValue = false;
  const ind = obj.indices;
  if (!isPlainObject(ind)) {
    errors.push('indices: not_object');
  } else {
    checkKeys(ind, ['costOfLivingExcludingRent', 'rentIndex', 'costOfLivingPlusRent', 'baseline', 'status', 'origin', 'sourceUpdatedAt', 'fetchedAt'], ['source'], 'indices.', errors);
    const vals = [ind.costOfLivingExcludingRent, ind.rentIndex, ind.costOfLivingPlusRent];
    ['costOfLivingExcludingRent', 'rentIndex', 'costOfLivingPlusRent'].forEach((f, i) => {
      if (vals[i] !== null && !isPositiveDecimalString(vals[i])) errors.push(`indices.${f}: not_positive_decimal_or_null`);
    });
    anyIndexValue = vals.some((v) => v !== null);
    if (ind.baseline !== null) {
      if (!isPlainObject(ind.baseline)) errors.push('indices.baseline: not_object');
      else {
        checkKeys(ind.baseline, ['label', 'value'], [], 'indices.baseline.', errors);
        if (!isSafeText(ind.baseline.label, 120)) errors.push('indices.baseline.label: invalid_text');
        if (!isPositiveDecimalString(ind.baseline.value)) errors.push('indices.baseline.value: not_positive_decimal');
      }
    } else if (anyIndexValue) {
      errors.push('indices.baseline: required_when_index_present');
    }
    if (typeof ind.status !== 'string' || !ALL_STATUSES.has(ind.status)) errors.push('indices.status: unknown');
    if (typeof ind.origin !== 'string' || !Object.values(ORIGIN).includes(ind.origin)) errors.push('indices.origin: unknown');
    if (ind.sourceUpdatedAt !== null && !isPartialDate(ind.sourceUpdatedAt)) errors.push('indices.sourceUpdatedAt: not_partial_date_or_null');
    if (ind.fetchedAt !== null && !isIsoDateTime(ind.fetchedAt)) errors.push('indices.fetchedAt: not_iso_datetime_or_null');
    if ('source' in ind) checkSourceRef(ind.source, 'indices.source', errors);
    if (typeof ind.status === 'string' && typeof ind.origin === 'string') {
      checkStatusValueConsistency(ind.status, ind.origin, vals, ind.costOfLivingExcludingRent !== null || ind.rentIndex !== null || ind.costOfLivingPlusRent !== null, 'indices', errors);
    }
  }

  // ქალაქის დამთხვევა ↔ მნიშვნელობები
  if (matchStatus === 'none' && (anyRentValue || anyIndexValue)) errors.push('resolvedLocation.matchStatus: none_but_values_present');
  if (matchStatus === 'country-level' && anyRentValue) errors.push('rent: country_level_rent_not_allowed_as_city_rent');
  if (anyRentValue && cur === null) errors.push('currency: required_when_rent_present');

  // cache
  const cache = obj.cache;
  if (!isPlainObject(cache)) {
    errors.push('cache: not_object');
  } else {
    checkKeys(cache, ['state', 'expiresAt'], [], 'cache.', errors);
    if (typeof cache.state !== 'string' || !Object.values(CACHE_STATE).includes(cache.state)) errors.push('cache.state: unknown');
    if (cache.expiresAt !== null && !isIsoDateTime(cache.expiresAt)) errors.push('cache.expiresAt: not_iso_datetime_or_null');
    if ((cache.state === 'hit' || cache.state === 'stale') && cache.expiresAt === null) errors.push('cache.expiresAt: required_for_cached_state');
  }

  // warnings
  if (!Array.isArray(obj.warnings)) {
    errors.push('warnings: not_array');
  } else {
    if (obj.warnings.length > 20) errors.push('warnings: too_many');
    obj.warnings.forEach((w, i) => {
      if (!isPlainObject(w)) { errors.push(`warnings[${i}]: not_object`); return; }
      checkKeys(w, ['code'], ['message'], `warnings[${i}].`, errors);
      if (typeof w.code !== 'string' || !ALL_WARNING_CODES.has(w.code)) errors.push(`warnings[${i}].code: unknown`);
      if ('message' in w && !isSafeText(w.message, 300)) errors.push(`warnings[${i}].message: invalid_text`);
    });
  }

  return { ok: errors.length === 0, errors };
}

/**
 * ერთი ხელით/იმპორტის ჩანაწერის ვალიდაცია.
 * @param {unknown} rec
 * @param {{ allowedCurrencies?: readonly string[] }} [options]
 * @returns {ValidationResult}
 */
export function validateManualRecord(rec, options = {}) {
  /** @type {string[]} */
  const errors = [];
  if (!isPlainObject(rec)) return { ok: false, errors: ['$: not_object'] };
  checkKeys(rec, ['kind', 'schemaVersion', 'origin', 'locationId', 'city', 'countryCode', 'metricType', 'metric', 'value', 'currency', 'source', 'sourceDate', 'enteredAt'], ['low', 'high', 'baseline', 'note'], '', errors);
  if (rec.kind !== 'manual-market-record') errors.push('kind: invalid');
  if (rec.schemaVersion !== MARKET_SCHEMA_VERSION) errors.push('schemaVersion: unsupported');
  if (rec.origin !== 'manual' && rec.origin !== 'json-import') errors.push('origin: must_be_manual_or_json_import');
  if (!(typeof rec.locationId === 'string' && LOCATION_ID_RE.test(rec.locationId))) errors.push('locationId: invalid');
  if (!isSafeText(rec.city, 120)) errors.push('city: invalid_text');
  if (rec.countryCode !== null && !(typeof rec.countryCode === 'string' && COUNTRY_RE.test(rec.countryCode))) errors.push('countryCode: invalid');
  if (!isPositiveDecimalString(rec.value)) errors.push('value: not_positive_decimal');

  if (rec.metricType === 'rent') {
    if (typeof rec.metric !== 'string' || !Object.prototype.hasOwnProperty.call(RENT_METRICS, rec.metric)) errors.push('metric: unknown_rent_metric');
    if (!(typeof rec.currency === 'string' && CURRENCY_RE.test(rec.currency))) errors.push('currency: required_iso4217');
    else if (options.allowedCurrencies && !options.allowedCurrencies.includes(rec.currency)) errors.push('currency: not_allowed');
    for (const f of ['low', 'high']) {
      if (f in rec && rec[f] !== null && !isPositiveDecimalString(rec[f])) errors.push(`${f}: not_positive_decimal_or_null`);
    }
    if (isPositiveDecimalString(rec.low) && isPositiveDecimalString(rec.high) && compareDecimalStrings(/** @type {string} */ (rec.low), /** @type {string} */ (rec.high)) > 0) errors.push('low: greater_than_high');
    if (isPositiveDecimalString(rec.value) && isPositiveDecimalString(rec.low) && compareDecimalStrings(/** @type {string} */ (rec.low), /** @type {string} */ (rec.value)) > 0) errors.push('value: below_low');
    if (isPositiveDecimalString(rec.value) && isPositiveDecimalString(rec.high) && compareDecimalStrings(/** @type {string} */ (rec.value), /** @type {string} */ (rec.high)) > 0) errors.push('value: above_high');
    if ('baseline' in rec && rec.baseline !== null) errors.push('baseline: not_allowed_for_rent');
  } else if (rec.metricType === 'index') {
    if (typeof rec.metric !== 'string' || !Object.prototype.hasOwnProperty.call(INDEX_METRICS, rec.metric)) errors.push('metric: unknown_index_metric');
    if (rec.currency !== null) errors.push('currency: must_be_null_for_index');
    if (('low' in rec && rec.low !== null) || ('high' in rec && rec.high !== null)) errors.push('low/high: not_allowed_for_index');
    const b = rec.baseline;
    if (!isPlainObject(b)) errors.push('baseline: required_for_index');
    else {
      checkKeys(b, ['label', 'value'], [], 'baseline.', errors);
      if (!isSafeText(b.label, 120)) errors.push('baseline.label: invalid_text');
      if (!isPositiveDecimalString(b.value)) errors.push('baseline.value: not_positive_decimal');
    }
  } else {
    errors.push('metricType: must_be_rent_or_index');
  }

  const src = rec.source;
  if (!isPlainObject(src)) errors.push('source: not_object');
  else {
    checkKeys(src, ['name', 'url'], [], 'source.', errors);
    if (!isSafeText(src.name, 120)) errors.push('source.name: invalid_text');
    if (src.url !== null && !isSafeUrl(src.url)) errors.push('source.url: invalid_url');
  }
  if (rec.sourceDate !== null && !isPartialDate(rec.sourceDate)) errors.push('sourceDate: not_partial_date_or_null');
  if (!isIsoDateTime(rec.enteredAt)) errors.push('enteredAt: not_iso_datetime');
  if ('note' in rec && rec.note !== null && !isSafeText(rec.note, 300)) errors.push('note: invalid_text');
  return { ok: errors.length === 0, errors };
}

/**
 * JSON იმპორტის ფაილის ვალიდაცია (კონტეინერი + ყველა ჩანაწერი + დუბლიკატები).
 * @param {unknown} file
 * @param {{ allowedCurrencies?: readonly string[] }} [options]
 * @returns {ValidationResult}
 */
export function validateMarketImport(file, options = {}) {
  /** @type {string[]} */
  const errors = [];
  if (!isPlainObject(file)) return { ok: false, errors: ['$: not_object'] };
  checkKeys(file, ['kind', 'schemaVersion', 'records'], [], '', errors);
  if (file.kind !== 'market-import') errors.push('kind: invalid');
  if (file.schemaVersion !== MARKET_SCHEMA_VERSION) errors.push('schemaVersion: unsupported');
  if (!Array.isArray(file.records) || file.records.length === 0 || file.records.length > 200) {
    errors.push('records: must_be_array_1_to_200');
    return { ok: false, errors };
  }
  const seen = new Set();
  file.records.forEach((r, i) => {
    const res = validateManualRecord(r, options);
    for (const e of res.errors) errors.push(`records[${i}].${e}`);
    if (isPlainObject(r)) {
      if (r.origin !== 'json-import') errors.push(`records[${i}].origin: must_be_json_import_in_file`);
      const k = `${r.locationId}|${r.metricType}|${r.metric}`;
      if (seen.has(k)) errors.push(`records[${i}]: duplicate_location_metric`);
      seen.add(k);
    }
  });
  return { ok: errors.length === 0, errors };
}

/* ------------------------------------------------------------------------------------------ */
/* დამხმარე კონსტრუქტორები (სუფთა)                                                            */
/* ------------------------------------------------------------------------------------------ */

/**
 * ცარიელი MarketData მოცემული სტატუსით (loading / not_configured / network_error / ...).
 * @param {string} requestedLocationId
 * @param {string} status  STATUSES_WITHOUT_VALUE-დან
 * @param {{ currency?: string|null, provider?: SourceRef|null, warnings?: MarketWarning[] }} [extra]
 * @returns {MarketData}
 */
export function createEmptyMarketData(requestedLocationId, status, extra = {}) {
  if (!STATUSES_WITHOUT_VALUE.includes(status)) throw new RangeError(`status without value expected, got ${status}`);
  return {
    schemaVersion: MARKET_SCHEMA_VERSION,
    requestedLocationId,
    resolvedLocation: { city: null, countryCode: null, providerCityId: null, matchStatus: 'none' },
    provider: extra.provider ?? null,
    currency: extra.currency ?? null,
    rent: { status, items: {} },
    indices: {
      costOfLivingExcludingRent: null, rentIndex: null, costOfLivingPlusRent: null,
      baseline: null, status, origin: 'provider', sourceUpdatedAt: null, fetchedAt: null,
    },
    cache: { state: 'none', expiresAt: null },
    warnings: extra.warnings ?? [],
  };
}

/**
 * ვალიდირებული ხელით/იმპორტის ჩანაწერებიდან MarketData-ს აწყობა ერთი ლოკაციისთვის.
 * ჩანაწერები წინასწარ უნდა გაიაროს `validateManualRecord`-ში. ვალუტების შერევა აკრძალულია.
 * `fetchedAt` = `enteredAt` (როდის მოხვდა მონაცემი აპში); `sourceUpdatedAt` = `sourceDate`.
 *
 * @param {string} locationId
 * @param {ManualMarketRecord[]} records
 * @returns {MarketData}
 */
export function marketDataFromManualRecords(locationId, records) {
  const own = records.filter((r) => r.locationId === locationId);
  if (own.length === 0) return createEmptyMarketData(locationId, 'not_found', { warnings: [] });
  const currencies = new Set(own.filter((r) => r.metricType === 'rent').map((r) => r.currency));
  if (currencies.size > 1) throw new RangeError('mixed currencies for one location');
  const first = own[0];
  /** @type {MarketData} */
  const md = createEmptyMarketData(locationId, 'not_found');
  md.resolvedLocation = { city: first.city, countryCode: first.countryCode, providerCityId: null, matchStatus: 'exact' };
  md.currency = currencies.size === 1 ? /** @type {string} */ ([...currencies][0]) : null;
  md.warnings = [{ code: 'manual_entry' }];
  const sourceIds = new Set();
  /** @param {ManualMarketRecord} r @returns {SourceRef} */
  const src = (r) => ({ id: 'manual', name: r.source.name, sourceUrl: r.source.url, attribution: null });
  for (const r of own) {
    sourceIds.add(`${r.source.name}|${r.source.url}`);
    if (r.metricType === 'rent') {
      const def = /** @type {Record<string, {bedrooms:1|3, area:'centre'|'outside'}>} */ (RENT_METRICS)[r.metric];
      /** @type {any} */ (md.rent.items)[r.metric] = {
        metric: r.metric, bedrooms: def.bedrooms, area: def.area,
        average: r.value, low: r.low ?? null, high: r.high ?? null, dataPoints: null,
        status: 'manual', origin: r.origin, sourceUpdatedAt: r.sourceDate, fetchedAt: r.enteredAt, source: src(r),
      };
      md.rent.status = 'manual';
    } else {
      const ind = md.indices;
      if (ind.baseline && (ind.baseline.label !== r.baseline?.label || ind.baseline.value !== r.baseline?.value)) {
        throw new RangeError('index records for one location must share the same baseline');
      }
      /** @type {any} */ (ind)[r.metric] = r.value;
      ind.baseline = r.baseline ? { label: r.baseline.label, value: r.baseline.value } : null;
      ind.status = 'manual'; ind.origin = r.origin; ind.sourceUpdatedAt = r.sourceDate; ind.fetchedAt = r.enteredAt; ind.source = src(r);
    }
  }
  if (sourceIds.size > 1) md.warnings.push({ code: 'mixed_sources' });
  return md;
}
