// Worker tests: call the fetch handler directly with mocked env / upstream fetch. SYNTHETIC data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { createWorker, createMemoryCacheStore, marketCacheKey } from '../../worker/index.js';
import { validateMarketData } from '../../src/providers/market-contract.js';
import { SYNTHETIC_CITY_MAP, pricesBody, indicesBody, mockNumbeoFetch } from '../providers/fixtures/synthetic-numbeo.js';

const KEY = 'synthetic-test-key-DO-NOT-USE';
const req = (path, init) => new Request(`https://calc.example.internal${path}`, init);
const body = async (res) => JSON.parse(await res.text());

function setup({ fetchImpl = mockNumbeoFetch({ prices: pricesBody(), indices: indicesBody() }), env = {}, t0 = Date.parse('2026-10-29T10:00:00Z') } = {}) {
  const clock = { t: t0 };
  const logs = [];
  const w = createWorker({ cityMap: SYNTHETIC_CITY_MAP, fetchImpl, now: () => clock.t, cacheStore: createMemoryCacheStore(), log: (l) => logs.push(l) });
  const e = { NUMBEO_API_KEY: KEY, MARKET_CACHE_TTL_SECONDS: '0', MARKET_STALE_MAX_SECONDS: '0', MARKET_UPSTREAM_TIMEOUT_MS: '50', ...env };
  return { w, env: e, clock, logs, fetchImpl, get: (p) => w.fetch(req(p), e) };
}

test('default export is a Worker with fetch()', () => assert.equal(typeof worker.fetch, 'function'));

test('health: not_configured without key (real, empty city map)', async () => {
  const res = await worker.fetch(req('/api/market/health'), {});
  assert.equal(res.status, 200);
  const b = await body(res);
  assert.equal(b.status, 'not_configured');
  assert.equal(b.keyConfigured, false);
  assert.equal(b.cacheTtlSeconds, 0);
  assert.equal(res.headers.get('access-control-allow-origin'), null, 'no CORS headers');
  assert.match(res.headers.get('cache-control'), /no-store/);
});

test('health never leaks the key', async () => {
  const { get } = setup();
  const text = await (await get('/api/market/health')).text();
  assert.ok(!text.includes(KEY));
  assert.equal(JSON.parse(text).status, 'configured');
});

test('no key → MarketData not_configured, no upstream call', async () => {
  const { get, fetchImpl } = setup({ env: { NUMBEO_API_KEY: '' } });
  const res = await get('/api/market?location=AT-VIENNA&currency=EUR');
  const md = await body(res);
  assert.equal(res.status, 200);
  assert.ok(validateMarketData(md).ok);
  assert.equal(md.rent.status, 'not_configured');
  assert.equal(fetchImpl.calls.length, 0);
});

test('known normative location without mapping → not_configured', async () => {
  const { get, fetchImpl } = setup();
  const md = await body(await get('/api/market?location=DE-BERLIN&currency=EUR'));
  assert.equal(md.rent.status, 'not_configured');
  assert.equal(fetchImpl.calls.length, 0);
});

test('parameter validation: 400 for unknown location/currency/extra params, 404/405 elsewhere', async () => {
  const { get, w, env } = setup();
  for (const p of [
    '/api/market?location=XX-NOWHERE&currency=EUR', '/api/market?location=AT-VIENNA&currency=GBP',
    '/api/market?location=AT-VIENNA', '/api/market?location=AT-VIENNA&currency=EUR&url=https://evil.example',
    '/api/market?location=AT-VIENNA&location=FR-PARIS&currency=EUR', '/api/market?location=..%2F..&currency=EUR',
  ]) {
    const res = await get(p);
    assert.equal(res.status, 400, p);
    assert.ok((await body(res)).error.message_ka);
  }
  assert.equal((await get('/api/other')).status, 404);
  assert.equal((await w.fetch(req('/api/market?location=AT-VIENNA&currency=EUR', { method: 'POST' }), env)).status, 405);
});

test('success → validated MarketData, cache state none when TTL=0', async () => {
  const { get, fetchImpl, logs } = setup();
  const res = await get('/api/market?location=AT-VIENNA&currency=EUR');
  const md = await body(res);
  assert.equal(res.status, 200);
  assert.ok(validateMarketData(md, { allowedCurrencies: ['EUR', 'USD'] }).ok);
  assert.equal(md.rent.items.centre_1br.average, '1234.56');
  assert.equal(md.cache.state, 'none');
  assert.equal(fetchImpl.calls.length, 2);
  await get('/api/market?location=AT-VIENNA&currency=EUR');
  assert.equal(fetchImpl.calls.length, 4, 'TTL=0 → no caching');
  const all = logs.join('\n');
  assert.ok(!all.includes(KEY) && !all.includes('numbeo.com/api'), 'logs contain no key or upstream URL');
});

for (const [name, handlers, status] of [
  ['timeout', { prices: 'hang', indices: 'hang' }, 'timeout'],
  ['401', { prices: { status: 401, body: {} }, indices: { status: 401, body: {} } }, 'unauthorized'],
  ['403', { prices: { status: 403, body: {} }, indices: { status: 403, body: {} } }, 'unauthorized'],
  ['429', { prices: { status: 429, body: {} }, indices: { status: 429, body: {} } }, 'rate_limited'],
  ['5xx', { prices: { status: 502, body: 'x' }, indices: { status: 500, body: 'x' } }, 'upstream_error'],
  ['invalid JSON', { prices: 'not json{', indices: '[' }, 'invalid_response'],
  ['wrong city', { prices: pricesBody({ cityId: 1 }), indices: indicesBody({ cityId: 1 }) }, 'wrong_city'],
]) {
  test(`upstream ${name} → ${status} (HTTP 200, valid body)`, async () => {
    const { get } = setup({ fetchImpl: mockNumbeoFetch(handlers) });
    const res = await get('/api/market?location=AT-VIENNA&currency=EUR');
    const md = await body(res);
    assert.equal(res.status, 200);
    assert.ok(validateMarketData(md).ok, validateMarketData(md).errors.join());
    assert.equal(md.rent.status, status);
    assert.equal(md.indices.status, status);
  });
}

test('wrong currency from upstream → rent rejected', async () => {
  const { get } = setup({ fetchImpl: mockNumbeoFetch({ prices: pricesBody({ currency: 'EUR' }), indices: indicesBody() }) });
  const md = await body(await get('/api/market?location=AT-VIENNA&currency=USD'));
  assert.equal(md.rent.status, 'wrong_city');
  assert.equal(md.currency, 'USD');
});

test('missing rent / missing index handled independently', async () => {
  let s = setup({ fetchImpl: mockNumbeoFetch({ prices: pricesBody({ items: [] }), indices: indicesBody() }) });
  let md = await body(await s.get('/api/market?location=AT-VIENNA&currency=EUR'));
  assert.equal(md.rent.status, 'not_found');
  assert.equal(md.indices.status, 'fresh');
  s = setup({ fetchImpl: mockNumbeoFetch({ prices: pricesBody(), indices: { status: 500, body: '' } }) });
  md = await body(await s.get('/api/market?location=AT-VIENNA&currency=EUR'));
  assert.equal(md.rent.status, 'fresh');
  assert.equal(md.indices.status, 'upstream_error');
});

test('rate limiter binding: 429 + rate_limited; absent binding is skipped; throwing binding fails open', async () => {
  const s = setup({ env: { MARKET_RATE_LIMITER: { limit: async ({ key }) => ({ success: key !== 'market:all' }) } } });
  const res = await s.get('/api/market?location=AT-VIENNA&currency=EUR');
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '60');
  assert.equal((await body(res)).rent.status, 'rate_limited');
  assert.equal(s.fetchImpl.calls.length, 0);
  const s2 = setup({ env: { MARKET_RATE_LIMITER: { limit: async () => { throw new Error('x'); } } } });
  assert.equal((await s2.get('/api/market?location=AT-VIENNA&currency=EUR')).status, 200);
});

test('request coalescing: concurrent identical requests share upstream calls', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const inner = mockNumbeoFetch({ prices: pricesBody(), indices: indicesBody() });
  const slow = async (u, i) => { await gate; return inner(u, i); };
  const { get } = setup({ fetchImpl: slow, env: { MARKET_UPSTREAM_TIMEOUT_MS: '5000' } });
  const ps = [get('/api/market?location=AT-VIENNA&currency=EUR'), get('/api/market?location=AT-VIENNA&currency=EUR'), get('/api/market?location=AT-VIENNA&currency=USD')];
  release();
  const res = await Promise.all(ps);
  assert.equal(inner.calls.length, 4, '2 for EUR (shared) + 2 for USD');
  for (const r of res) assert.equal(r.status, 200);
});

test('cache (TTL>0): hit → cached; key separates currency; stale used on upstream error within threshold', async () => {
  let mode = 'ok';
  const okF = mockNumbeoFetch({ prices: pricesBody(), indices: indicesBody() });
  const errF = mockNumbeoFetch({ prices: { status: 503, body: '' }, indices: { status: 503, body: '' } });
  const s = setup({ fetchImpl: (u, i) => (mode === 'ok' ? okF(u, i) : errF(u, i)), env: { MARKET_CACHE_TTL_SECONDS: '3600', MARKET_STALE_MAX_SECONDS: '600' } });
  let md = await body(await s.get('/api/market?location=AT-VIENNA&currency=EUR'));
  assert.equal(md.cache.state, 'miss');
  assert.equal(md.cache.expiresAt, '2026-10-29T11:00:00Z');
  md = await body(await s.get('/api/market?location=AT-VIENNA&currency=EUR'));
  assert.equal(md.cache.state, 'hit');
  assert.equal(md.rent.items.centre_1br.status, 'cached');
  assert.equal(md.rent.items.centre_1br.fetchedAt, '2026-10-29T10:00:00Z', 'fetchedAt keeps original time');
  assert.equal(okF.calls.length, 2);
  const usd = await body(await s.get('/api/market?location=AT-VIENNA&currency=USD'));
  assert.equal(usd.currency, 'USD');
  assert.notEqual(marketCacheKey('numbeo', 'AT-VIENNA', 'EUR'), marketCacheKey('numbeo', 'AT-VIENNA', 'USD'));
  assert.match(marketCacheKey('numbeo', 'AT-VIENNA', 'EUR'), /\/v1\/numbeo\/AT-VIENNA\/EUR$/);

  mode = 'err';
  s.clock.t += 3600_000 + 60_000; // expired, inside stale window
  md = await body(await s.get('/api/market?location=AT-VIENNA&currency=EUR'));
  assert.ok(validateMarketData(md).ok, validateMarketData(md).errors.join());
  assert.equal(md.cache.state, 'stale');
  assert.equal(md.rent.status, 'stale');
  assert.equal(md.indices.status, 'stale');
  assert.ok(md.warnings.some((w) => w.code === 'stale_cache_used'));

  s.clock.t += 3600_000; // beyond stale threshold
  md = await body(await s.get('/api/market?location=AT-VIENNA&currency=EUR'));
  assert.equal(md.rent.status, 'upstream_error');
});

test('errors are not cached', async () => {
  const f = mockNumbeoFetch({ prices: { status: 500, body: '' }, indices: { status: 500, body: '' } });
  const s = setup({ fetchImpl: f, env: { MARKET_CACHE_TTL_SECONDS: '3600' } });
  await s.get('/api/market?location=AT-VIENNA&currency=EUR');
  await s.get('/api/market?location=AT-VIENNA&currency=EUR');
  assert.equal(f.calls.length, 4);
});

test('non-API paths go to static assets', async () => {
  const w = createWorker({ cityMap: SYNTHETIC_CITY_MAP });
  const res = await w.fetch(req('/'), { ASSETS: { fetch: async () => new Response('<!doctype html>', { status: 200 }) } });
  assert.equal(await res.text(), '<!doctype html>');
  assert.equal((await w.fetch(req('/'), {})).status, 404);
});
