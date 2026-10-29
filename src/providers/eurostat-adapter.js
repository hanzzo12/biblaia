// @ts-check
/**
 * Eurostat-ის ადაპტერი — ოფიციალური კორექტირების კოეფიციენტები (ევროკავშირის მოსამსახურეები, ბრიუსელი = 100).
 *
 * წყარო: Eurostat Statistics API (dissemination), JSON-stat 2.0:
 *   https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/{dataset}?format=JSON&lang=en&<DIM>=<CODE>...
 * მონაცემთა ნაკრებები: `prc_colc_tot` (ევროკავშირში, ნახევარწლიური), `prc_colc_extm` (ევროკავშირის გარეთ, თვიური),
 * `prc_colc_ext` (ევროკავშირის გარეთ, წლიური ცხრილი). ზომები: freq · unit (INX) · coicop (TOTAL) · geo · time.
 * `prc_colc_nat` (Belgium = 100) პენსიონერების ქვეყნის კოეფიციენტია — განზრახ არ გამოიყენება.
 *
 * ⚠️ ამ სამუშაო გარემოდან ec.europa.eu დაბლოკილია — მოთხოვნის ფორმა, ზომების კოდები და geo კოდები აწყობილია
 * საჯარო დოკუმენტაციის/სერიების სახელების მიხედვით და ცოცხლად დაუდასტურებელია (`docs/providers.md`).
 *
 * ეს არ არის ქირა და არ არის ბრძანების K; ფულად თანხად არ გადაიყვანება.
 * მოდული სუფთაა (fetch გარედან გადაეცემა) — გამოიყენება Worker-შიც და snapshot სკრიპტშიც.
 */

import {
  MARKET_SCHEMA_VERSION, createEmptyMarketData, validateMarketData, toDecimalString, emptyCorrectionCoefficient,
} from './market-contract.js';

export const EUROSTAT_API_BASE = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data';
export const EUROSTAT_DATASETS = Object.freeze({
  prc_colc_tot: Object.freeze({ freq: 'S', scope: 'eu' }),
  prc_colc_extm: Object.freeze({ freq: 'M', scope: 'extra-eu' }),
  prc_colc_ext: Object.freeze({ freq: null, scope: 'extra-eu' }),
});
export const EUROSTAT_BASELINE = Object.freeze({ label: 'Brussels', value: '100' });

export const EUROSTAT_ATTRIBUTION_KA = 'წყარო: Eurostat — ევროკავშირის მოსამსახურეთა ცხოვრების ღირებულების კორექტირების კოეფიციენტი (ბრიუსელი = 100), © European Union.';
export const EUROSTAT_DISCLAIMER_KA = 'მნიშვნელობა ნაჩვენებია უცვლელად; ქართულად თარგმნილია მხოლოდ წარწერები. Eurostat არ არის პასუხისმგებელი ამ გამოყენებაზე და მასზე დაფუძნებულ დასკვნებზე.';
export const EUROSTAT_MEANING_KA = 'ეს არის ევროკავშირის მოსამსახურეებისთვის გამოთვლილი ცხოვრების ღირებულების კორექტირების კოეფიციენტი (ბრიუსელი = 100). ის არ არის ქირის თანხა და არ ცვლის ბრძანების K კოეფიციენტს.';
export const EUROSTAT_LICENCE_NOTE = 'Eurostat data: reuse authorised, provided the source is acknowledged (Commission Decision 2011/833/EU; CC BY 4.0). Modifications must be indicated; Eurostat bears no responsibility. https://ec.europa.eu/eurostat/help/copyright-notice';

/** @type {import('./market-contract.js').SourceRef} */
export const EUROSTAT_PROVIDER = Object.freeze({
  id: 'eurostat',
  name: 'Eurostat',
  sourceUrl: 'https://ec.europa.eu/eurostat/web/civil-servants-remuneration',
  attribution: EUROSTAT_ATTRIBUTION_KA,
});

/**
 * @typedef {{ dataset: keyof typeof EUROSTAT_DATASETS, geo: string, label: string, matchStatus: 'exact'|'nearby-explained', note?: string }} GeoEntry
 * @typedef {{ _meta?: { status?: string }, locations: Record<string, GeoEntry> }} GeoMap
 */

/** @param {GeoMap} geoMap @param {string} locationId @returns {GeoEntry|null} */
export function resolveGeo(geoMap, locationId) {
  const locs = geoMap && geoMap.locations;
  if (!locs || !Object.prototype.hasOwnProperty.call(locs, locationId)) return null;
  const e = locs[locationId];
  const ok = e && Object.prototype.hasOwnProperty.call(EUROSTAT_DATASETS, e.dataset) &&
    typeof e.geo === 'string' && /^[A-Z]{2}_[A-Z0-9]{2,8}$/.test(e.geo) &&
    typeof e.label === 'string' && e.label.trim() !== '' &&
    (e.matchStatus === 'exact' || (e.matchStatus === 'nearby-explained' && typeof e.note === 'string' && e.note.trim() !== ''));
  return ok ? e : null;
}

/** მოთხოვნის URL (ერთი დროის პარამეტრი — `lastTimePeriod`). @param {GeoEntry} entry @param {number} [lastPeriods] */
export function buildEurostatUrl(entry, lastPeriods = 1) {
  const u = new URL(`${EUROSTAT_API_BASE}/${entry.dataset}`);
  u.searchParams.set('format', 'JSON');
  u.searchParams.set('lang', 'en');
  const f = EUROSTAT_DATASETS[entry.dataset].freq;
  if (f) u.searchParams.set('freq', f);
  u.searchParams.set('unit', 'INX');
  u.searchParams.set('coicop', 'TOTAL');
  u.searchParams.set('geo', entry.geo);
  u.searchParams.set('lastTimePeriod', String(lastPeriods));
  return u.toString();
}

/** JSON-stat category index → { code: position }. @param {any} cat */
function categoryIndex(cat) {
  if (!cat) return null;
  if (Array.isArray(cat.index)) return Object.fromEntries(cat.index.map((c, i) => [c, i]));
  if (cat.index && typeof cat.index === 'object') return cat.index;
  if (cat.label && typeof cat.label === 'object') { const ks = Object.keys(cat.label); if (ks.length === 1) return { [ks[0]]: 0 }; }
  return null;
}

/**
 * JSON-stat 2.0 (Eurostat) პასუხიდან ერთი geo-ს ბოლო არანულოვანი მნიშვნელობის ამოღება.
 * @param {unknown} json
 * @param {{ geo: string, expect?: Record<string, string> }} q
 * @returns {{ status: 'ok', value: string, period: string, flag: string|null, updated: string|null, geoLabel: string|null } | { status: string }}
 */
export function parseJsonStat(json, q) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { status: 'invalid_response' };
  const j = /** @type {any} */ (json);
  if (j.error) return { status: 'invalid_response' };
  if (!Array.isArray(j.id) || !Array.isArray(j.size) || j.id.length !== j.size.length || !j.dimension || typeof j.dimension !== 'object') return { status: 'invalid_response' };
  if (!j.id.includes('geo') || !j.id.includes('time')) return { status: 'invalid_response' };
  const expect = { unit: 'INX', coicop: 'TOTAL', ...(q.expect || {}) };
  /** @type {number[]} */
  const strides = new Array(j.id.length);
  let acc = 1;
  for (let k = j.id.length - 1; k >= 0; k--) {
    if (!Number.isSafeInteger(j.size[k]) || j.size[k] < 0) return { status: 'invalid_response' };
    strides[k] = acc; acc *= j.size[k];
  }
  let base = 0;
  /** @type {[string, number][]} */
  let times = [];
  let timeStride = 0;
  for (let k = 0; k < j.id.length; k++) {
    const dim = j.id[k];
    const idx = categoryIndex(j.dimension[dim] && j.dimension[dim].category);
    if (!idx) return { status: 'invalid_response' };
    if (dim === 'time') {
      times = Object.entries(idx).sort((a, b) => /** @type {number} */ (a[1]) - /** @type {number} */ (b[1]));
      timeStride = strides[k];
      continue;
    }
    let pos;
    if (dim === 'geo') {
      if (!(q.geo in idx)) return { status: 'wrong_city' };
      pos = idx[q.geo];
    } else if (expect[dim] && expect[dim] in idx) {
      pos = idx[expect[dim]];
    } else if (j.size[k] === 1) {
      pos = 0;
    } else {
      return { status: 'invalid_response' };
    }
    if (!Number.isSafeInteger(pos) || pos < 0 || pos >= j.size[k]) return { status: 'invalid_response' };
    base += pos * strides[k];
  }
  const values = j.value;
  if (!values || typeof values !== 'object') return { status: 'invalid_response' };
  const at = (/** @type {number} */ i) => (Array.isArray(values) ? values[i] : values[String(i)]);
  const flagAt = (/** @type {number} */ i) => {
    const s = j.status;
    const v = s && typeof s === 'object' ? (Array.isArray(s) ? s[i] : s[String(i)]) : null;
    return typeof v === 'string' && /^[a-z:]{1,3}$/.test(v) ? v : null;
  };
  for (let t = times.length - 1; t >= 0; t--) {
    const [period, tpos] = times[t];
    const flat = base + /** @type {number} */ (tpos) * timeStride;
    const v = toDecimalString(at(flat));
    if (v !== null && /^\d{4}(?:-(?:0[1-9]|1[0-2]|S[12]|Q[1-4]))?$/.test(period)) {
      const updated = typeof j.updated === 'string' && /^\d{4}-\d{2}-\d{2}/.test(j.updated) ? j.updated.slice(0, 10) : null;
      const lbl = j.dimension.geo.category && j.dimension.geo.category.label && j.dimension.geo.category.label[q.geo];
      return { status: 'ok', value: v, period, flag: flagAt(flat), updated, geoLabel: typeof lbl === 'string' ? lbl : null };
    }
  }
  return { status: 'not_found' };
}

/** @param {number} code */
function httpStatus(code) {
  if (code === 401 || code === 403) return 'unauthorized';
  if (code === 429) return 'rate_limited';
  if (code >= 500) return 'upstream_error';
  if (code === 404) return 'not_found';
  return 'invalid_response';
}

/**
 * @param {{ locationId: string, currency?: string|null, geoMap: GeoMap, fetchImpl: typeof fetch, timeoutMs?: number, now?: () => number }} p
 * @returns {Promise<{ data: import('./market-contract.js').MarketData, diagnostics: Record<string, unknown> }>}
 */
export async function fetchEurostatMarket(p) {
  const now = p.now || Date.now;
  const timeoutMs = p.timeoutMs && p.timeoutMs > 0 ? p.timeoutMs : 8000;
  const entry = resolveGeo(p.geoMap, p.locationId);
  if (!entry) {
    const d = createEmptyMarketData(p.locationId, 'not_configured', { provider: { ...EUROSTAT_PROVIDER }, warnings: [{ code: 'rent_manual_only' }] });
    d.rent.status = 'not_provided';
    return { data: d, diagnostics: { reason: 'unmapped' } };
  }
  const url = buildEurostatUrl(entry);
  const started = Date.now();
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ac.abort(); }, timeoutMs);
  /** @type {{status: string, value?: string, period?: string, flag?: string|null, updated?: string|null, geoLabel?: string|null}} */
  let r;
  let http = null;
  try {
    const res = await p.fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: ac.signal, redirect: 'follow' });
    http = res.status;
    if (!res.ok) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      r = { status: httpStatus(res.status) };
    } else {
      const text = await res.text();
      let json = null;
      try { json = text.length <= 5_000_000 ? JSON.parse(text) : null; } catch { json = null; }
      r = json === null ? { status: 'invalid_response' } : parseJsonStat(json, { geo: entry.geo });
    }
  } catch {
    r = { status: timedOut ? 'timeout' : 'network_error' };
  } finally {
    clearTimeout(timer);
  }
  const fetchedAt = new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const ok = r.status === 'ok';
  const occ = {
    ...emptyCorrectionCoefficient(ok ? 'fresh' : r.status),
    ...(ok ? { value: r.value, baseline: { ...EUROSTAT_BASELINE }, period: r.period, sourceUpdatedAt: r.updated ?? null } : {}),
    dataset: entry.dataset, geo: entry.geo, label: entry.label, fetchedAt,
  };
  const warnings = ['correction_coefficient_not_rent_not_k', 'index_is_not_money', 'provider_disclaimer', 'rent_manual_only'];
  if (!p.geoMap._meta || p.geoMap._meta.status !== 'verified') warnings.push('geo_code_unverified');
  if (ok && (r.flag === 'p' || r.flag === 'e')) warnings.push('provisional_value');
  if (ok && !r.updated) warnings.push('source_date_unknown');
  if (entry.matchStatus === 'nearby-explained') warnings.push('nearby_city');
  const cc = /^([A-Z]{2})-/.exec(p.locationId);
  /** @type {import('./market-contract.js').MarketData} */
  const data = {
    schemaVersion: MARKET_SCHEMA_VERSION,
    requestedLocationId: p.locationId,
    resolvedLocation: {
      city: entry.label, countryCode: cc ? cc[1] : null, providerCityId: entry.geo, matchStatus: entry.matchStatus,
      ...(entry.matchStatus === 'nearby-explained' ? { note: entry.note } : {}),
    },
    provider: { ...EUROSTAT_PROVIDER },
    currency: null,
    rent: { status: 'not_provided', items: {} },
    indices: /** @type {any} */ ({
      costOfLivingExcludingRent: null, rentIndex: null, costOfLivingPlusRent: null, baseline: null,
      status: occ.status, origin: 'provider', sourceUpdatedAt: occ.sourceUpdatedAt, fetchedAt,
      officialCorrectionCoefficient: occ,
    }),
    cache: { state: 'none', expiresAt: null },
    warnings: warnings.map((code) => ({ code })),
  };
  const diagnostics = { http, ms: Date.now() - started, status: occ.status, dataset: entry.dataset };
  const v = validateMarketData(data);
  if (!v.ok) {
    const d = createEmptyMarketData(p.locationId, 'invalid_response', { provider: { ...EUROSTAT_PROVIDER } });
    d.rent.status = 'not_provided';
    return { data: d, diagnostics: { ...diagnostics, validationErrors: v.errors.length } };
  }
  return { data, diagnostics };
}

/**
 * Live MarketData → ოფლაინ ასლის ჩანაწერი (origin snapshot, status cached, „არა live“).
 * @param {import('./market-contract.js').MarketData} md
 */
export function toSnapshotEntry(md) {
  const c = structuredClone(md);
  const conv = (/** @type {string} */ s) => (s === 'fresh' || s === 'cached' || s === 'partial' ? 'cached' : s);
  const ind = /** @type {any} */ (c.indices);
  ind.origin = 'snapshot';
  ind.status = conv(ind.status);
  if (ind.officialCorrectionCoefficient) {
    ind.officialCorrectionCoefficient.origin = 'snapshot';
    ind.officialCorrectionCoefficient.status = conv(ind.officialCorrectionCoefficient.status);
  }
  c.cache = { state: 'none', expiresAt: null };
  if (!c.warnings.some((w) => w.code === 'snapshot_not_live')) c.warnings.push({ code: 'snapshot_not_live' });
  return c;
}
