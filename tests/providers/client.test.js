// Browser client tests (createMarketClient, createLatestOnly). SYNTHETIC data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMarketClient, createLatestOnly, createEmptyMarketData, MARKET_STATUS_LABELS_KA, DATA_STATUS, validateMarketData } from '../../src/providers/index.js';

const goodBody = (loc = 'AT-VIENNA', currency = 'EUR') => ({
  schemaVersion: 1, requestedLocationId: loc,
  resolvedLocation: { city: 'Synthetic Vienna', countryCode: 'AT', providerCityId: '900001', matchStatus: 'exact' },
  provider: { id: 'numbeo', name: 'Numbeo', sourceUrl: 'https://www.numbeo.com/cost-of-living/', attribution: 'წყარო: Numbeo.com' },
  currency,
  rent: { status: 'fresh', items: { centre_1br: { metric: 'centre_1br', bedrooms: 1, area: 'centre', average: '1000', low: '800', high: '1200', dataPoints: 20, status: 'fresh', origin: 'provider', sourceUpdatedAt: '2026-09', fetchedAt: '2026-10-29T10:00:00Z' } } },
  indices: { costOfLivingExcludingRent: '60', rentIndex: '30', costOfLivingPlusRent: '45', baseline: { label: 'New York City', value: '100' }, status: 'fresh', origin: 'provider', sourceUpdatedAt: null, fetchedAt: '2026-10-29T10:00:00Z' },
  cache: { state: 'none', expiresAt: null }, warnings: [{ code: 'synthetic_test_data' }],
});
const resp = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const client = (fetchImpl, timeoutMs = 50) => createMarketClient({ fetchImpl, timeoutMs });

test('labels exist for every status', () => {
  for (const s of Object.values(DATA_STATUS)) assert.ok(MARKET_STATUS_LABELS_KA[s], s);
});

test('success: requests only location + currency to /api/market', async () => {
  let seen;
  const md = await client(async (url, init) => { seen = { url, init }; return resp(goodBody()); }).get('AT-VIENNA', 'EUR');
  assert.equal(seen.url, '/api/market?location=AT-VIENNA&currency=EUR');
  assert.equal(seen.init.credentials, 'same-origin');
  assert.equal(md.rent.items.centre_1br.average, '1000');
});

test('rejects response for another city or currency', async () => {
  let md = await client(async () => resp(goodBody('FR-PARIS'))).get('AT-VIENNA', 'EUR');
  assert.equal(md.rent.status, 'wrong_city');
  assert.equal(md.requestedLocationId, 'AT-VIENNA');
  md = await client(async () => resp(goodBody('AT-VIENNA', 'USD'))).get('AT-VIENNA', 'EUR');
  assert.equal(md.rent.status, 'wrong_city');
  assert.equal(md.indices.costOfLivingExcludingRent, null);
});

test('invalid / schema-violating body → invalid_response (never throws)', async () => {
  const bad = goodBody(); bad.rent.items.centre_1br.average = 0;
  assert.equal((await client(async () => resp(bad)).get('AT-VIENNA', 'EUR')).rent.status, 'invalid_response');
  assert.equal((await client(async () => resp('<html>login</html>')).get('AT-VIENNA', 'EUR')).rent.status, 'invalid_response');
  assert.equal((await client(async () => resp('{"a":', 200)).get('AT-VIENNA', 'EUR')).indices.status, 'invalid_response');
});

test('HTTP errors without MarketData body map to statuses', async () => {
  assert.equal((await client(async () => resp('denied', 403)).get('AT-VIENNA', 'EUR')).rent.status, 'unauthorized');
  assert.equal((await client(async () => resp('denied', 401)).get('AT-VIENNA', 'EUR')).rent.status, 'unauthorized');
  assert.equal((await client(async () => resp('slow down', 429)).get('AT-VIENNA', 'EUR')).rent.status, 'rate_limited');
  assert.equal((await client(async () => resp('boom', 502)).get('AT-VIENNA', 'EUR')).rent.status, 'upstream_error');
});

test('429 with valid MarketData body is passed through', async () => {
  const body = createEmptyMarketData('AT-VIENNA', 'rate_limited', { currency: 'EUR' });
  const md = await client(async () => resp(body, 429)).get('AT-VIENNA', 'EUR');
  assert.equal(md.rent.status, 'rate_limited');
});

test('network error, timeout and abort never throw', async () => {
  assert.equal((await client(async () => { throw new TypeError('fetch failed'); }).get('AT-VIENNA', 'EUR')).rent.status, 'network_error');
  const hang = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('a', 'AbortError'))));
  assert.equal((await client(hang, 20).get('AT-VIENNA', 'EUR')).rent.status, 'timeout');
  const ac = new AbortController();
  const p = client(hang, 5000).get('AT-VIENNA', 'EUR', { signal: ac.signal });
  ac.abort();
  assert.equal((await p).rent.status, 'network_error');
});

test('bad inputs are not sent to the network', async () => {
  let called = 0;
  const c = client(async () => { called++; return resp(goodBody()); });
  assert.equal((await c.get('../../etc', 'EUR')).rent.status, 'not_configured');
  assert.equal((await c.get('AT-VIENNA', 'GBP')).rent.status, 'not_configured');
  assert.equal(called, 0);
});

test('race: late response for a previous city is discarded', async () => {
  const latest = createLatestOnly();
  const resolvers = {};
  const fetchImpl = (url, init) => new Promise((resolve, reject) => {
    const loc = new URL(url, 'http://x').searchParams.get('location');
    resolvers[loc] = () => resolve(resp(goodBody(loc)));
    init.signal.addEventListener('abort', () => reject(new DOMException('a', 'AbortError')));
  });
  const c = client(fetchImpl, 5000);
  const first = latest.run((signal) => c.get('AT-VIENNA', 'EUR', { signal }));
  const second = latest.run((signal) => c.get('FR-PARIS', 'EUR', { signal }));
  resolvers['FR-PARIS']();
  resolvers['AT-VIENNA']?.(); // late — already aborted
  const [r1, r2] = await Promise.all([first, second]);
  assert.equal(r1.superseded, true);
  assert.equal(r2.superseded, false);
  assert.equal(r2.value.requestedLocationId, 'FR-PARIS');
  assert.ok(validateMarketData(r2.value).ok);
});

test('race without abort support: stale result still ignored', async () => {
  const latest = createLatestOnly();
  let releaseFirst;
  const first = latest.run(() => new Promise((r) => { releaseFirst = () => r('A'); }));
  const second = latest.run(async () => 'B');
  releaseFirst();
  assert.deepEqual(await first, { superseded: true });
  assert.deepEqual(await second, { superseded: false, value: 'B' });
});
