// Worker v2 tests: fetch handler called directly with mocked env, KV and Apify. SYNTHETIC data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../worker/index.js';
import * as entry from '../../worker/index.js';
import { createWorker, cacheKey, RANKINGS_KEY } from '../../worker/market-worker.js';

test('worker/index.js has only a default export (workerd treats named exports as entrypoints)', () => {
  assert.deepEqual(Object.keys(entry), ['default']);
});
import { validateMarketData } from '../../src/providers/market-contract.js';
import { SYNTHETIC_NAMES, flatPrices as nestedPrices, rankingsRows, mockApify, FAKE_TOKEN } from '../providers/fixtures/apify-synthetic.js';

const req = (p, init) => new Request(`https://calc.example${p}`, init);
const body = async (r) => JSON.parse(await r.text());
const DAY = 86400000;

function mockKv(clock) {
  const m = new Map(); const ops = [];
  return {
    m, ops,
    async get(k, type) { ops.push(['get', k]); const e = m.get(k); if (!e || clock.t > e.until) return null; return type === 'json' ? JSON.parse(e.v) : e.v; },
    async put(k, v, o) { ops.push(['put', k, o]); m.set(k, { v, until: clock.t + o.expirationTtl * 1000 }); },
  };
}
function setup({ fetchImpl = mockApify({ city_prices: nestedPrices(), rankings: rankingsRows() }), env = {} } = {}) {
  const clock = { t: Date.parse('2026-10-30T10:00:00Z') };
  const logs = [];
  const kv = mockKv(clock);
  const w = createWorker({ names: SYNTHETIC_NAMES, fetchImpl, now: () => clock.t, log: (l) => logs.push(l) });
  const e = { APIFY_TOKEN: FAKE_TOKEN, MARKET_PROVIDER: 'apify', MARKET_CACHE: kv, MARKET_UPSTREAM_TIMEOUT_MS: '50', ...env };
  return { w, env: e, clock, logs, kv, fetchImpl, get: (p, h) => w.fetch(req(p, h ? { headers: h } : undefined), e) };
}
const URL_OK = '/api/market?location=AT-VIENNA&currency=EUR';

test('health (real default worker, no env): not_configured, no token, provider apify', async () => {
  const b = await body(await worker.fetch(req('/api/market/health'), {}));
  assert.equal(b.status, 'not_configured');
  assert.equal(b.provider, 'apify');
  assert.equal(b.tokenConfigured, false);
  assert.equal(b.mappedLocations, 81);
  assert.equal(b.cacheTtlDays, 30);
});

test('health with token + KV: configured, cacheBackend kv, never leaks token', async () => {
  const s = setup();
  const t = await (await s.get('/api/market/health')).text();
  assert.ok(!t.includes(FAKE_TOKEN));
  const b = JSON.parse(t);
  assert.deepEqual([b.status, b.cacheBackend, b.tokenConfigured], ['configured', 'kv', true]);
});

test('kill switch MARKET_PROVIDER=off → disabled, no upstream', async () => {
  const s = setup({ env: { MARKET_PROVIDER: 'off' } });
  const md = await body(await s.get(URL_OK));
  assert.ok(validateMarketData(md).ok);
  assert.equal(md.status, 'disabled');
  assert.equal(s.fetchImpl.calls.length, 0);
  assert.equal((await body(await s.get('/api/market/health'))).status, 'disabled');
});

test('no token → not_configured, no upstream', async () => {
  const s = setup({ env: { APIFY_TOKEN: '' } });
  assert.equal((await body(await s.get(URL_OK))).status, 'not_configured');
  assert.equal(s.fetchImpl.calls.length, 0);
});

test('params: 400 for unknown location/currency/extra params; 404/405', async () => {
  const s = setup();
  for (const p of ['/api/market?location=XX-NO&currency=EUR', '/api/market?location=AT-VIENNA&currency=GBP', '/api/market?location=AT-VIENNA',
    '/api/market?location=AT-VIENNA&currency=EUR&city=Paris', '/api/market?location=AT-VIENNA&location=US-NEW-YORK&currency=EUR']) {
    assert.equal((await s.get(p)).status, 400, p);
  }
  assert.equal((await s.get('/api/x')).status, 404);
  assert.equal((await s.w.fetch(req(URL_OK, { method: 'POST' }), s.env)).status, 405);
});

test('miss → fetch + KV put; hit → cached without upstream; rankings cached separately', async () => {
  const s = setup();
  let md = await body(await s.get(URL_OK));
  assert.ok(validateMarketData(md).ok, validateMarketData(md).errors.join());
  assert.equal(md.status, 'fresh');
  assert.equal(md.cache.state, 'miss');
  assert.equal(md.cache.expiresAt, '2026-11-29T10:00:00Z');
  assert.equal(s.fetchImpl.calls.length, 2);
  assert.ok(s.kv.m.has(cacheKey('AT-VIENNA', 'EUR')) && s.kv.m.has(RANKINGS_KEY));
  md = await body(await s.get(URL_OK));
  assert.equal(md.cache.state, 'hit');
  assert.equal(md.status, 'cached');
  assert.equal(md.rent.status, 'cached');
  assert.equal(md.fetchedAt, '2026-10-30T10:00:00Z');
  assert.equal(s.fetchImpl.calls.length, 2);
  await s.get('/api/market?location=US-NEW-YORK&currency=USD');
  assert.equal(s.fetchImpl.calls.filter((c) => c.input.mode === 'rankings').length, 1, 'rankings reused for another city');
});

test('stale: after TTL, upstream failure returns last copy with status stale', async () => {
  let fail = false;
  const ok = mockApify({ city_prices: nestedPrices(), rankings: rankingsRows() });
  const bad = mockApify({ city_prices: { status: 503, body: '' }, rankings: { status: 503, body: '' } });
  const s = setup({ fetchImpl: (u, i) => (fail ? bad(u, i) : ok(u, i)) });
  await s.get(URL_OK);
  fail = true;
  s.clock.t += 31 * DAY;
  const md = await body(await s.get(URL_OK));
  assert.ok(validateMarketData(md).ok, validateMarketData(md).errors.join());
  assert.deepEqual([md.status, md.cache.state, md.rent.status], ['stale', 'stale', 'stale']);
  assert.ok(md.warnings.some((w) => w.code === 'stale_cache_used'));
});

test('errors are not cached; error statuses pass through', async () => {
  for (const [spec, status] of [[{ status: 401, body: {} }, 'unauthorized'], [{ status: 402, body: {} }, 'unauthorized'], [{ status: 429, body: {} }, 'rate_limited'], [{ status: 500, body: '' }, 'upstream_error'], ['{bad', 'invalid_response'], [[], 'not_found'], ['hang', 'timeout']]) {
    const s = setup({ fetchImpl: mockApify({ city_prices: spec, rankings: spec }) });
    const md = await body(await s.get(URL_OK));
    assert.ok(validateMarketData(md).ok);
    assert.equal(md.status, status);
    assert.ok(!s.kv.m.has(cacheKey('AT-VIENNA', 'EUR')), `${status} not cached`);
  }
});

test('wrong city from upstream → wrong_city, not cached', async () => {
  const s = setup({ fetchImpl: mockApify({ city_prices: nestedPrices({ city: 'Paris' }), rankings: rankingsRows() }) });
  const md = await body(await s.get(URL_OK));
  assert.equal(md.utilities.status, 'wrong_city');
  assert.ok(!s.kv.m.has(cacheKey('AT-VIENNA', 'EUR')));
});

test('coalescing: concurrent identical requests share upstream calls', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const inner = mockApify({ city_prices: nestedPrices(), rankings: rankingsRows() });
  const s = setup({ fetchImpl: async (u, i) => { await gate; return inner(u, i); }, env: { MARKET_UPSTREAM_TIMEOUT_MS: '5000' } });
  const ps = [s.get(URL_OK), s.get(URL_OK), s.get(URL_OK)];
  release();
  for (const r of await Promise.all(ps)) assert.equal(r.status, 200);
  assert.equal(inner.calls.length, 2);
});

test('per-IP rate limit → 429 (or stale copy); IP never logged', async () => {
  const keys = [];
  const s = setup({ env: { MARKET_RATE_LIMITER: { limit: async ({ key }) => { keys.push(key); return { success: false }; } } } });
  const r = await s.get(URL_OK, { 'cf-connecting-ip': '203.0.113.7' });
  assert.equal(r.status, 429);
  assert.equal((await body(r)).status, 'rate_limited');
  assert.deepEqual(keys, ['market:203.0.113.7']);
  assert.ok(!s.logs.join('\n').includes('203.0.113.7'));
});

test('token never appears in logs, responses or KV', async () => {
  const s = setup();
  const t = await (await s.get(URL_OK)).text();
  assert.ok(!t.includes(FAKE_TOKEN));
  assert.ok(!s.logs.join('\n').includes(FAKE_TOKEN));
  assert.ok(![...s.kv.m.values()].some((e) => e.v.includes(FAKE_TOKEN)));
  assert.ok(!s.logs.join('\n').includes('api.apify.com'));
});

test('without KV binding falls back (memory/Cache API) and still caches', async () => {
  const s = setup({ env: { MARKET_CACHE: undefined } });
  await s.get(URL_OK);
  const md = await body(await s.get(URL_OK));
  assert.equal(md.cache.state, 'hit');
  assert.equal((await body(await s.get('/api/market/health'))).cacheBackend, 'memory');
});

test('non-API paths go to static assets', async () => {
  const w = createWorker({ names: SYNTHETIC_NAMES });
  const r = await w.fetch(req('/'), { ASSETS: { fetch: async () => new Response('<!doctype html>') } });
  assert.equal(await r.text(), '<!doctype html>');
});

test('upstream fetch is never invoked as a method (workerd "Illegal invocation")', async () => {
  const inner = mockApify({ city_prices: nestedPrices(), rankings: rankingsRows() });
  const strict = function (u, i) { if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation'); return inner(u, i); };
  const s = setup({ fetchImpl: strict });
  assert.equal((await body(await s.get(URL_OK))).status, 'fresh');
});
