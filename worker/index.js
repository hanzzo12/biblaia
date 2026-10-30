// @ts-check
/**
 * Cloudflare Worker: Static Assets (dist/web) + ბაზრის მონაცემები (ADR-003).
 *
 *   GET /api/market?location=<შიდა ID>&currency=<EUR|USD>  → MarketData v2
 *   GET /api/market/health                                 → პროვაიდერი, ტოკენი კონფიგურირებულია თუ არა, ქეშის backend, რუკის ზომა
 *
 *  - წყარო: Apify actor automation-lab/numbeo-scraper (`MARKET_PROVIDER=apify`, ნაგულისხმევი); `off` — გამორთვა (status `disabled`).
 *  - `APIFY_TOKEN` მხოლოდ Secret-ში; იგზავნება `Authorization: Bearer`-ით; არასოდეს URL-ში, ლოგში ან პასუხში.
 *  - ქეში: Workers KV `MARKET_CACHE` → (არარსებობისას) Cache API → მეხსიერება. TTL `MARKET_CACHE_TTL_DAYS` (30).
 *    შეცდომა არ ქეშირდება; upstream-ის ჩავარდნისას ბრუნდება ვადაგასული ასლი (`stale`) `MARKET_STALE_MAX_DAYS`-ის ფარგლებში.
 *    rankings (ინდექსები ყველა ქალაქისთვის, maxCities: 0) ქეშირდება ცალკე, ერთი გამოძახებით (≈ $2.745);
 *    `MARKET_RANKINGS_ENABLED=false` — ინდექსები გამორთულია (კრედიტის დაზოგვა), indices.status = "disabled".
 *  - მხოლოდ location/currency პარამეტრები; უცნობი → 400. CORS სათაურები არ ემატება. Rate limit — IP-ზე (IP არ ილოგება).
 */

import { MARKET_SCHEMA_VERSION, createEmptyMarketData, validateMarketData, ERROR_STATUSES, DEFAULT_ALLOWED_CURRENCIES } from '../src/providers/market-contract.js';
import { fetchApifyMarket, runActor, GENERIC_PROVIDER, DEFAULT_TIMEOUT_MS, RANKINGS_INPUT } from '../src/providers/apify-numbeo-adapter.js';
import realNames from '../src/providers/numbeo-city-names.json' with { type: 'json' };
import normative from '../src/data/normative-data.json' with { type: 'json' };

const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
});
const LOCATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DAY = 86400;

/** @param {unknown} body @param {number} [status] @param {Record<string,string>} [extra] */
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
/** @param {number} status @param {string} code @param {string} message_ka @param {Record<string,string>} [extra] */
const apiError = (status, code, message_ka, extra = {}) => json({ schemaVersion: MARKET_SCHEMA_VERSION, error: { code, message_ka } }, status, extra);
/** @param {unknown} v @param {number} dflt @param {number} max */
function intVar(v, dflt, max) {
  const n = typeof v === 'string' && /^\d{1,9}$/.test(v.trim()) ? Number(v.trim()) : typeof v === 'number' ? v : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? Math.min(n, max) : dflt;
}
const iso = (/** @type {number} */ ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * @typedef {{ name: string, get(key: string): Promise<any>, put(key: string, value: any, ttlSeconds: number): Promise<void> }} CacheStore
 */

/** @returns {CacheStore} */
export function createMemoryStore(maxEntries = 500, now = Date.now) {
  /** @type {Map<string, { v: any, until: number }>} */
  const m = new Map();
  return {
    name: 'memory',
    async get(k) { const e = m.get(k); if (!e) return null; if (now() > e.until) { m.delete(k); return null; } return e.v; },
    async put(k, v, ttl) { if (m.size >= maxEntries) m.delete(/** @type {string} */ (m.keys().next().value)); m.set(k, { v, until: now() + ttl * 1000 }); },
  };
}
/** Workers KV. @param {any} kv @returns {CacheStore} */
export function createKvStore(kv) {
  return {
    name: 'kv',
    async get(k) { try { return await kv.get(k, 'json'); } catch { return null; } },
    async put(k, v, ttl) { try { await kv.put(k, JSON.stringify(v), { expirationTtl: Math.max(60, ttl) }); } catch { /* ignore */ } },
  };
}
/** Cache API (data-centre local). @param {CacheStore} fallback @returns {CacheStore} */
function createCacheApiStore(fallback) {
  if (typeof caches === 'undefined' || !caches || typeof caches.open !== 'function') return fallback;
  const url = (/** @type {string} */ k) => `https://market-cache.internal/${encodeURIComponent(k)}`;
  return {
    name: 'cache-api',
    async get(k) {
      try { const r = await (await caches.open('market')).match(url(k)); if (r) return await r.json(); } catch { /* ignore */ }
      return fallback.get(k);
    },
    async put(k, v, ttl) {
      await fallback.put(k, v, ttl);
      try { await (await caches.open('market')).put(url(k), new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttl}` } })); } catch { /* ignore */ }
    },
  };
}

export const cacheKey = (/** @type {string} */ loc, /** @type {string} */ cur) => `v${MARKET_SCHEMA_VERSION}:numbeo-apify:${loc}:${cur}`;
export const RANKINGS_KEY = `v${MARKET_SCHEMA_VERSION}:numbeo-apify:rankings`;

/** @param {any} md */
const hasError = (md) => [md.rent, md.utilities, md.groceries, md.restaurants, md.indices].some((b) => ERROR_STATUSES.includes(b.status));

/** @param {any} md @param {'cached'|'stale'} to */
function relabel(md, to) {
  const c = structuredClone(md);
  const conv = (/** @type {string} */ s) => (s === 'fresh' || s === 'cached' || (to === 'stale' && s === 'partial') ? to : s);
  for (const b of [c.rent, c.utilities, c.groceries, c.restaurants, c.indices]) b.status = conv(b.status);
  c.status = to === 'stale' ? 'stale' : conv(c.status);
  return c;
}

/**
 * @param {{ names?: any, locationIds?: Iterable<string>, fetchImpl?: typeof fetch, now?: () => number,
 *           cacheStore?: CacheStore, log?: (line: string) => void }} [deps]
 */
export function createWorker(deps = {}) {
  const names = deps.names || realNames;
  const known = new Set([...(deps.locationIds || (normative.locations || []).map((/** @type {any} */ l) => l.id)), ...Object.keys(names.locations || {})]);
  const now = deps.now || Date.now;
  const log = deps.log || ((/** @type {string} */ l) => console.log(l));
  const memory = createMemoryStore(500, now);
  /** @type {Map<string, Promise<any>>} */
  const inflight = new Map();

  /** @param {any} env @returns {CacheStore} */
  const storeFor = (env) => deps.cacheStore || (env.MARKET_CACHE && typeof env.MARKET_CACHE.get === 'function' ? createKvStore(env.MARKET_CACHE) : createCacheApiStore(memory));

  /** @param {any} env */
  function config(env) {
    const allowed = String(env.MARKET_ALLOWED_CURRENCIES || 'EUR,USD').split(',').map((s) => s.trim()).filter((c) => DEFAULT_ALLOWED_CURRENCIES.includes(c));
    return {
      provider: String(env.MARKET_PROVIDER || 'apify').trim().toLowerCase(),
      tokenConfigured: typeof env.APIFY_TOKEN === 'string' && env.APIFY_TOKEN.trim() !== '',
      ttl: intVar(env.MARKET_CACHE_TTL_DAYS, 30, 365) * DAY,
      staleMax: intVar(env.MARKET_STALE_MAX_DAYS, 365, 3650) * DAY,
      timeoutMs: intVar(env.MARKET_UPSTREAM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 290000) || DEFAULT_TIMEOUT_MS,
      allowed: allowed.length ? allowed : ['EUR', 'USD'],
      rankingsEnabled: String(env.MARKET_RANKINGS_ENABLED ?? 'true').trim().toLowerCase() !== 'false',
    };
  }
  /** @param {Record<string, unknown>} o */
  const logLine = (o) => { try { log(JSON.stringify({ evt: 'market', ...o })); } catch { /* ignore */ } };

  /** @template T @param {string} key @param {() => Promise<T>} fn @returns {Promise<T>} */
  function coalesce(key, fn) {
    let p = inflight.get(key);
    if (!p) { p = fn().finally(() => inflight.delete(key)); inflight.set(key, p); }
    return p;
  }

  /** rankings — 30 დღიანი ქეშით, ყველა ქალაქისთვის ერთი გაშვება. @param {any} env @param {CacheStore} store @param {ReturnType<typeof config>} cfg */
  function getRankings(env, store, cfg) {
    return async () => {
      if (!cfg.rankingsEnabled) return { status: 'disabled' };
      const c = await store.get(RANKINGS_KEY);
      if (c && now() < c.expiresAt) return { status: 'ok', items: c.items };
      const r = await coalesce(RANKINGS_KEY, () => runActor({ input: RANKINGS_INPUT, token: env.APIFY_TOKEN.trim(), fetchImpl: deps.fetchImpl || fetch, timeoutMs: cfg.timeoutMs }));
      if (r.status === 'ok' && 'items' in r) {
        await store.put(RANKINGS_KEY, { storedAt: now(), expiresAt: now() + cfg.ttl * 1000, items: r.items }, cfg.ttl + cfg.staleMax);
        return r;
      }
      if (c && now() <= c.expiresAt + cfg.staleMax * 1000) return { status: 'ok', items: c.items };
      return r;
    };
  }

  /** @param {Request} request @param {URL} url @param {any} env */
  async function handleMarket(request, url, env) {
    const t0 = now();
    const cfg = config(env);
    for (const k of url.searchParams.keys()) if (k !== 'location' && k !== 'currency') return apiError(400, 'unknown_parameter', 'დაშვებულია მხოლოდ location და currency პარამეტრები.');
    if (url.searchParams.getAll('location').length !== 1 || url.searchParams.getAll('currency').length !== 1) return apiError(400, 'invalid_parameters', 'location და currency თითო ერთხელ უნდა იყოს მითითებული.');
    const loc = /** @type {string} */ (url.searchParams.get('location'));
    const cur = /** @type {string} */ (url.searchParams.get('currency'));
    if (!LOCATION_ID_RE.test(loc) || !known.has(loc)) return apiError(400, 'invalid_location', 'უცნობი ლოკაცია.');
    if (!cfg.allowed.includes(cur)) return apiError(400, 'invalid_currency', 'ვალუტა დაშვებული არ არის.');

    if (cfg.provider === 'off' || cfg.provider === 'disabled' || cfg.provider === 'none') {
      logLine({ loc, cur, status: 'disabled' });
      return json(createEmptyMarketData(loc, 'disabled', { currency: cur }));
    }
    if (cfg.provider !== 'apify' || !cfg.tokenConfigured) {
      logLine({ loc, cur, status: 'not_configured', reason: cfg.provider !== 'apify' ? 'provider' : 'no_token' });
      return json(createEmptyMarketData(loc, 'not_configured', { currency: cur, provider: { ...GENERIC_PROVIDER } }));
    }

    const store = storeFor(env);
    const key = cacheKey(loc, cur);
    const cached = await store.get(key);
    if (cached && now() < cached.expiresAt) {
      const md = relabel(cached.data, 'cached');
      md.cache = { state: 'hit', expiresAt: iso(cached.expiresAt) };
      logLine({ loc, cur, status: md.status, cache: 'hit', ms: now() - t0 });
      return json(md);
    }

    if (env.MARKET_RATE_LIMITER && typeof env.MARKET_RATE_LIMITER.limit === 'function') {
      let ok = true;
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      try { ok = (await env.MARKET_RATE_LIMITER.limit({ key: `market:${ip}` })).success !== false; } catch { ok = true; }
      if (!ok) {
        logLine({ loc, cur, status: 'rate_limited', reason: 'local_limiter' });
        if (cached && now() <= cached.expiresAt + cfg.staleMax * 1000) return json(staleOf(cached));
        return json(createEmptyMarketData(loc, 'rate_limited', { currency: cur, provider: { ...GENERIC_PROVIDER } }), 429, { 'Retry-After': '60' });
      }
    }

    const { data, diagnostics } = await coalesce(key, () => fetchApifyMarket({
      locationId: loc, currency: cur, names, token: env.APIFY_TOKEN, fetchImpl: deps.fetchImpl || fetch,
      timeoutMs: cfg.timeoutMs, now, getRankings: getRankings(env, store, cfg),
    }));
    /** @type {any} */
    let md = structuredClone(data);
    if (hasError(md) && cached && now() <= cached.expiresAt + cfg.staleMax * 1000) {
      md = staleOf(cached);
    } else if (!hasError(md) && md.status !== 'not_configured' && md.status !== 'not_found') {
      const expiresAt = now() + cfg.ttl * 1000;
      md.cache = { state: 'miss', expiresAt: iso(expiresAt) };
      await store.put(key, { storedAt: now(), expiresAt, data }, cfg.ttl + cfg.staleMax);
    } else {
      md.cache = { state: 'miss', expiresAt: null };
    }
    if (!validateMarketData(md, { allowedCurrencies: cfg.allowed }).ok) md = createEmptyMarketData(loc, 'invalid_response', { currency: cur, provider: { ...GENERIC_PROVIDER } });
    logLine({ loc, cur, status: md.status, cache: md.cache.state, upstream: diagnostics, ms: now() - t0 });
    return json(md);
  }

  /** @param {any} cached */
  function staleOf(cached) {
    const md = relabel(cached.data, 'stale');
    md.cache = { state: 'stale', expiresAt: iso(cached.expiresAt) };
    if (!md.warnings.some((/** @type {any} */ w) => w.code === 'stale_cache_used')) md.warnings.push({ code: 'stale_cache_used' });
    return md;
  }

  /** @param {any} env */
  function health(env) {
    const cfg = config(env);
    const mapped = Object.keys(names.locations || {}).length;
    const status = cfg.provider === 'off' || cfg.provider === 'disabled' || cfg.provider === 'none' ? 'disabled'
      : cfg.provider === 'apify' && cfg.tokenConfigured && mapped > 0 ? 'configured' : 'not_configured';
    return json({
      schemaVersion: MARKET_SCHEMA_VERSION, status, provider: cfg.provider, tokenConfigured: cfg.tokenConfigured,
      cacheBackend: storeFor(env).name, cacheTtlDays: cfg.ttl / DAY, staleMaxDays: cfg.staleMax / DAY,
      mappedLocations: mapped, mappingVerified: names._meta?.status === 'verified',
      rateLimiter: Boolean(env.MARKET_RATE_LIMITER), allowedCurrencies: cfg.allowed, rankingsEnabled: cfg.rankingsEnabled,
    });
  }

  return {
    /** @param {Request} request @param {any} [env] */
    async fetch(request, env = {}) {
      let url;
      try { url = new URL(request.url); } catch { return apiError(400, 'bad_request', 'არასწორი მოთხოვნა.'); }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        if (request.method !== 'GET' && request.method !== 'HEAD') return apiError(405, 'method_not_allowed', 'დაშვებულია მხოლოდ GET.', { Allow: 'GET, HEAD' });
        try {
          if (url.pathname === '/api/market/health') return health(env);
          if (url.pathname === '/api/market') return await handleMarket(request, url, env);
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
