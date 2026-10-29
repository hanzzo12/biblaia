// @ts-check
/**
 * Cloudflare Worker: Static Assets (dist/web) + `/api/market`.
 *
 *   GET /api/market?location=<შიდა ID>&currency=<EUR|USD>  → MarketData (JSON)
 *   GET /api/market/health                                 → კონფიგურაციის მდგომარეობა (საიდუმლოს გარეშე)
 *
 * უსაფრთხოება:
 *  - მხოლოდ ეს ორი მარშრუტი; სხვა `/api/*` → 404; სხვა მეთოდი → 405; უცნობი პარამეტრი → 400.
 *    upstream URL-ს, ქალაქის სახელს ან `query`-ს მომხმარებელი ვერ გადასცემს.
 *  - ავთენტიფიკაცია — Cloudflare Access (Worker-ის წინ). CORS/Origin ავთენტიფიკაცია არ არის; CORS სათაურები არ ემატება.
 *  - `NUMBEO_API_KEY` მხოლოდ Secret-შია. ლოგებში: ლოკაცია, ვალუტა, სტატუსები, HTTP კოდები, ხანგრძლივობა. არასოდეს: გასაღები,
 *    upstream URL, IP, Access-ის identity ან მომხმარებლის ფინანსური მონაცემები.
 *  - პროვაიდერი: `MARKET_PROVIDER` = "eurostat" (ნაგულისხმევი; გასაღები არ სჭირდება, ქეში 24 სთ)
 *    ან "numbeo" (მხოლოდ ლიცენზიით + `NUMBEO_API_KEY` Secret; ქეში ნაგულისხმევად 0). საჯარო გვერდზე Numbeo არ ირთვება (ADR-002).
 */

import { MARKET_SCHEMA_VERSION, createEmptyMarketData, validateMarketData } from '../src/providers/market-contract.js';
import { fetchNumbeoMarket, NUMBEO_PROVIDER, NUMBEO_ALLOWED_CURRENCIES, ERROR_STATUSES } from '../src/providers/numbeo-adapter.js';
import { fetchEurostatMarket, EUROSTAT_PROVIDER } from '../src/providers/eurostat-adapter.js';
import realCityMap from '../src/providers/numbeo-city-map.json' with { type: 'json' };
import realGeoMap from '../src/providers/eurostat-geo-map.json' with { type: 'json' };
import normative from '../src/data/normative-data.json' with { type: 'json' };

const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
});
const LOCATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** @param {unknown} body @param {number} [status] @param {Record<string,string>} [extra] */
function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}
/** @param {number} status @param {string} code @param {string} message_ka */
function apiError(status, code, message_ka, extra = {}) {
  return json({ schemaVersion: MARKET_SCHEMA_VERSION, error: { code, message_ka } }, status, extra);
}
/** @param {unknown} v @param {number} dflt @param {number} max */
function intVar(v, dflt, max) {
  const n = typeof v === 'string' && /^\d{1,9}$/.test(v.trim()) ? Number(v.trim()) : typeof v === 'number' ? v : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? Math.min(n, max) : dflt;
}
/** @param {string} iso */
const isoSec = (/** @type {number} */ ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** in-isolate მეხსიერების ქეში (fallback, როცა Cache API მიუწვდომელია — მაგ. Access-ის უკან ან Node ტესტებში). */
export function createMemoryCacheStore(maxEntries = 500) {
  /** @type {Map<string, { entry: any, until: number }>} */
  const m = new Map();
  return {
    /** @param {string} key @param {number} nowMs */
    async get(key, nowMs) {
      const e = m.get(key);
      if (!e) return null;
      if (nowMs > e.until) { m.delete(key); return null; }
      return e.entry;
    },
    /** @param {string} key @param {any} entry @param {number} keepSeconds @param {number} nowMs */
    async put(key, entry, keepSeconds, nowMs) {
      if (m.size >= maxEntries) m.delete(/** @type {string} */ (m.keys().next().value));
      m.set(key, { entry, until: nowMs + keepSeconds * 1000 });
    },
  };
}

/** Workers Cache API store (data-centre local). შეცდომისას — fallback მეხსიერებაზე. */
function createCacheApiStore(fallback) {
  const hasCaches = typeof caches !== 'undefined' && caches && typeof caches.open === 'function';
  if (!hasCaches) return fallback;
  return {
    /** @param {string} key @param {number} nowMs */
    async get(key, nowMs) {
      try {
        const c = await caches.open('market');
        const res = await c.match(key);
        if (res) return await res.json();
      } catch { /* Cache API მიუწვდომელია */ }
      return fallback.get(key, nowMs);
    },
    /** @param {string} key @param {any} entry @param {number} keepSeconds @param {number} nowMs */
    async put(key, entry, keepSeconds, nowMs) {
      await fallback.put(key, entry, keepSeconds, nowMs);
      try {
        const c = await caches.open('market');
        await c.put(key, new Response(JSON.stringify(entry), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${keepSeconds}` } }));
      } catch { /* ignore */ }
    },
  };
}

/** ქეშის გასაღები: პროვაიდერი + ლოკაცია + ვალუტა + სქემის ვერსია. */
export function marketCacheKey(provider, locationId, currency) {
  return `https://market-cache.internal/v${MARKET_SCHEMA_VERSION}/${provider}/${encodeURIComponent(locationId)}/${currency}`;
}

/** @param {any} md */
function hasErrorStatus(md) {
  return ERROR_STATUSES.includes(md.rent.status) || ERROR_STATUSES.includes(md.indices.status);
}

/** fresh → cached/stale, ინდექსის და ქირის ყველა ჩანაწერზე. @param {any} md @param {'cached'|'stale'} to */
function markFromCache(md, to) {
  const c = structuredClone(md);
  const conv = (/** @type {string} */ s) => (s === 'fresh' || s === 'cached' || (to === 'stale' && s === 'partial')) ? to : s;
  for (const it of Object.values(c.rent.items)) {
    // ვადაგასულ partial ჩანაწერში საშუალო აუცილებლად არის (ადაპტერის წესი), ამიტომ stale დასაშვებია.
    /** @type {any} */ (it).status = conv(/** @type {any} */ (it).status);
  }
  c.rent.status = conv(c.rent.status);
  c.indices.status = conv(c.indices.status);
  if (c.indices.officialCorrectionCoefficient) c.indices.officialCorrectionCoefficient.status = conv(c.indices.officialCorrectionCoefficient.status);
  return c;
}

/**
 * Worker-ის ქარხანა (ტესტებისთვის დამოკიდებულებების ჩანაცვლებით).
 * @param {{ cityMap?: any, geoMap?: any, locationIds?: Iterable<string>, fetchImpl?: typeof fetch, now?: () => number,
 *           cacheStore?: ReturnType<typeof createMemoryCacheStore>, log?: (line: string) => void }} [deps]
 */
export function createWorker(deps = {}) {
  const cityMap = deps.cityMap || realCityMap;
  const geoMap = deps.geoMap || realGeoMap;
  const known = new Set([...(deps.locationIds || (normative.locations || []).map((/** @type {any} */ l) => l.id)), ...Object.keys(cityMap.cities || {}), ...Object.keys(geoMap.locations || {})]);
  const now = deps.now || Date.now;
  const log = deps.log || ((/** @type {string} */ line) => console.log(line));
  const memory = createMemoryCacheStore();
  const store = deps.cacheStore || createCacheApiStore(memory);
  /** @type {Map<string, Promise<any>>} */
  const inflight = new Map();

  /** @param {any} env */
  function config(env) {
    const allowed = String(env.MARKET_ALLOWED_CURRENCIES || 'EUR,USD').split(',').map((s) => s.trim()).filter((c) => NUMBEO_ALLOWED_CURRENCIES.includes(c));
    const provider = env.MARKET_PROVIDER || 'eurostat';
    return {
      keyConfigured: typeof env.NUMBEO_API_KEY === 'string' && env.NUMBEO_API_KEY.trim() !== '',
      ttl: intVar(env.MARKET_CACHE_TTL_SECONDS, provider === 'eurostat' ? 86400 : 0, 7 * 86400),
      staleMax: intVar(env.MARKET_STALE_MAX_SECONDS, 0, 30 * 86400),
      timeoutMs: intVar(env.MARKET_UPSTREAM_TIMEOUT_MS, 8000, 30000) || 8000,
      allowed: allowed.length ? allowed : ['EUR', 'USD'],
      licenseConfirmed: env.MARKET_LICENSE_CONFIRMED === 'true',
      provider,
    };
  }

  /** @param {URL} url @param {any} env */
  async function handleMarket(url, env) {
    const started = now();
    const cfg = config(env);
    for (const k of url.searchParams.keys()) {
      if (k !== 'location' && k !== 'currency') return apiError(400, 'unknown_parameter', 'დაშვებულია მხოლოდ location და currency პარამეტრები.');
    }
    if (url.searchParams.getAll('location').length !== 1 || url.searchParams.getAll('currency').length !== 1) {
      return apiError(400, 'invalid_parameters', 'location და currency თითო ერთხელ უნდა იყოს მითითებული.');
    }
    const loc = /** @type {string} */ (url.searchParams.get('location'));
    const cur = /** @type {string} */ (url.searchParams.get('currency'));
    if (!LOCATION_ID_RE.test(loc) || !known.has(loc)) return apiError(400, 'invalid_location', 'უცნობი ლოკაცია.');
    if (!cfg.allowed.includes(cur)) return apiError(400, 'invalid_currency', 'ვალუტა დაშვებული არ არის.');
    if (cfg.provider !== 'numbeo' && cfg.provider !== 'eurostat') {
      return json(createEmptyMarketData(loc, 'not_configured', { currency: cur }));
    }
    const providerRef = cfg.provider === 'eurostat' ? EUROSTAT_PROVIDER : NUMBEO_PROVIDER;
    if (cfg.provider === 'numbeo' && !cfg.keyConfigured) {
      logLine({ loc, cur, rent: 'not_configured', idx: 'not_configured', cache: 'none', reason: 'no_key', ms: now() - started });
      return json(createEmptyMarketData(loc, 'not_configured', { currency: cur, provider: { ...NUMBEO_PROVIDER } }));
    }

    const key = marketCacheKey(cfg.provider, loc, cur);
    /** @type {{ storedAt: number, expiresAt: number, data: any } | null} */
    let cached = null;
    if (cfg.ttl > 0) {
      cached = await store.get(key, now());
      if (cached && now() < cached.expiresAt) {
        const md = markFromCache(cached.data, 'cached');
        md.cache = { state: 'hit', expiresAt: isoSec(cached.expiresAt) };
        logLine({ loc, cur, rent: md.rent.status, idx: md.indices.status, cache: 'hit', ms: now() - started });
        return json(md);
      }
    }

    // სიჩქარის ლიმიტი მხოლოდ upstream-მდე მისვლისას (ქეშის hit-ი კვოტას არ ხარჯავს). binding-ის არქონა (ლოკალური ტესტი) — გამოტოვება.
    if (env.MARKET_RATE_LIMITER && typeof env.MARKET_RATE_LIMITER.limit === 'function') {
      let ok = true;
      try { ok = (await env.MARKET_RATE_LIMITER.limit({ key: 'market:all' })).success !== false; } catch { ok = true; }
      if (!ok) {
        logLine({ loc, cur, rent: 'rate_limited', idx: 'rate_limited', cache: 'none', reason: 'local_limiter', ms: now() - started });
        return json(createEmptyMarketData(loc, 'rate_limited', { currency: cur, provider: { ...providerRef } }), 429, { 'Retry-After': '60' });
      }
    }

    // ერთნაირი პარალელური მოთხოვნების გაერთიანება.
    let p = inflight.get(key);
    if (!p) {
      const fetchImpl = deps.fetchImpl || fetch;
      p = (cfg.provider === 'eurostat'
        ? fetchEurostatMarket({ locationId: loc, currency: cur, geoMap, fetchImpl, timeoutMs: cfg.timeoutMs, now })
        : fetchNumbeoMarket({
          locationId: loc, currency: cur, cityMap, apiKey: env.NUMBEO_API_KEY,
          fetchImpl, timeoutMs: cfg.timeoutMs, now, licenseConfirmed: cfg.licenseConfirmed,
        })).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    const { data, diagnostics } = await p;
    /** @type {any} */
    let md = structuredClone(data);

    if (hasErrorStatus(md) && cached && cfg.staleMax > 0 && now() <= cached.expiresAt + cfg.staleMax * 1000) {
      md = markFromCache(cached.data, 'stale');
      md.cache = { state: 'stale', expiresAt: isoSec(cached.expiresAt) };
      if (!md.warnings.some((/** @type {any} */ w) => w.code === 'stale_cache_used')) md.warnings.push({ code: 'stale_cache_used' });
    } else if (cfg.ttl > 0) {
      md.cache = { state: 'miss', expiresAt: null };
      if (!hasErrorStatus(md) && md.rent.status !== 'not_configured' && md.indices.status !== 'not_configured') {
        const t = now();
        const expiresAt = t + cfg.ttl * 1000;
        md.cache.expiresAt = isoSec(expiresAt);
        await store.put(key, { storedAt: t, expiresAt, data }, cfg.ttl + cfg.staleMax, t);
      }
    } else {
      md.cache = { state: 'none', expiresAt: null };
    }

    if (!validateMarketData(md, { allowedCurrencies: cfg.allowed }).ok) {
      md = createEmptyMarketData(loc, 'invalid_response', { currency: cur, provider: { ...providerRef } });
    }
    logLine({ loc, cur, rent: md.rent.status, idx: md.indices.status, cache: md.cache.state, upstream: diagnostics, ms: now() - started });
    return json(md);
  }

  /** @param {Record<string, unknown>} o */
  function logLine(o) {
    try { log(JSON.stringify({ evt: 'market', ...o })); } catch { /* ignore */ }
  }

  /** @param {any} env */
  function health(env) {
    const cfg = config(env);
    const mapped = cfg.provider === 'eurostat' ? Object.keys(geoMap.locations || {}).length
      : cfg.provider === 'numbeo' ? Object.keys(cityMap.cities || {}).length : 0;
    const status = (cfg.provider === 'eurostat' && mapped > 0) || (cfg.provider === 'numbeo' && cfg.keyConfigured && mapped > 0) ? 'configured' : 'not_configured';
    return json({
      schemaVersion: MARKET_SCHEMA_VERSION, status, provider: cfg.provider,
      keyConfigured: cfg.keyConfigured, mappedLocations: mapped,
      cacheTtlSeconds: cfg.ttl, staleMaxSeconds: cfg.staleMax, licenseConfirmed: cfg.licenseConfirmed,
      rateLimiter: Boolean(env.MARKET_RATE_LIMITER), allowedCurrencies: cfg.allowed,
    });
  }

  return {
    /** @param {Request} request @param {any} env @param {any} [ctx] */
    async fetch(request, env = {}, ctx) {
      void ctx;
      let url;
      try { url = new URL(request.url); } catch { return apiError(400, 'bad_request', 'არასწორი მოთხოვნა.'); }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        if (request.method !== 'GET' && request.method !== 'HEAD') return apiError(405, 'method_not_allowed', 'დაშვებულია მხოლოდ GET.', { Allow: 'GET, HEAD' });
        try {
          if (url.pathname === '/api/market/health') return health(env);
          if (url.pathname === '/api/market') return await handleMarket(url, env);
        } catch {
          logLine({ reason: 'internal_error' });
          return apiError(500, 'internal_error', 'შიდა შეცდომა.');
        }
        return apiError(404, 'not_found', 'მარშრუტი არ არსებობს.');
      }
      if (env.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(request);
      return new Response('Not found', { status: 404 });
    },
  };
}

export default createWorker();
