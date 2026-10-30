// Browser client v2 tests — SYNTHETIC data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMarketClient, createLatestOnly, suggestBedrooms, MARKET_STATUS_LABELS_KA, MARKET_CATEGORY_LABELS_KA, DATA_STATUS, validateMarketData, createEmptyMarketData } from '../../src/providers/index.js';
import { normalizeApify } from '../../src/providers/apify-numbeo-adapter.js';
import { SYNTHETIC_NAMES, nestedPrices, rankingsRows } from './fixtures/apify-synthetic.js';

const good = (loc = 'AT-VIENNA', currency = 'EUR') => normalizeApify({ locationId: loc, currency, entry: SYNTHETIC_NAMES.locations['AT-VIENNA'], prices: { status: 'ok', items: nestedPrices({ currency }) }, rankings: { status: 'ok', items: rankingsRows() }, fetchedAt: '2026-10-30T10:00:00Z' });
const resp = (b, status = 200) => new Response(typeof b === 'string' ? b : JSON.stringify(b), { status });
const client = (f, timeoutMs = 50) => createMarketClient({ fetchImpl: f, timeoutMs });

test('labels: every status and category has Georgian text', () => {
  for (const s of Object.values(DATA_STATUS)) assert.ok(MARKET_STATUS_LABELS_KA[s], s);
  for (const k of ['rent', 'utilities', 'groceries', 'restaurants', 'indices', 'centre_1br', 'outside_3br', 'basic85m2', 'internet', 'basketItemsSum', 'inexpensiveMeal', 'midRangeForTwo']) assert.ok(MARKET_CATEGORY_LABELS_KA[k], k);
});

test('suggestBedrooms: alone/+1 → 1; +2 or more → 3', () => {
  assert.deepEqual([0, 1, 2, 3, 6].map(suggestBedrooms), [1, 1, 3, 3, 3]);
  assert.equal(suggestBedrooms(undefined), 1);
  assert.equal(suggestBedrooms('2'), 3);
});

test('success: only location + currency sent; body validated', async () => {
  let seen;
  const md = await client(async (url, init) => { seen = { url, init }; return resp(good()); }).get('AT-VIENNA', 'EUR');
  assert.equal(seen.url, '/api/market?location=AT-VIENNA&currency=EUR');
  assert.ok(validateMarketData(md).ok);
  assert.equal(md.rent.items.centre_1br.average, '1234.56');
});

test('wrong city / currency in response rejected', async () => {
  assert.equal((await client(async () => resp(good('FR-PARIS'))).get('AT-VIENNA', 'EUR')).status, 'wrong_city');
  assert.equal((await client(async () => resp(good('AT-VIENNA', 'USD'))).get('AT-VIENNA', 'EUR')).status, 'wrong_city');
});

test('invalid bodies and HTTP errors map to statuses; never throws', async () => {
  const bad = good(); bad.rent.items.centre_1br.average = '0';
  assert.equal((await client(async () => resp(bad)).get('AT-VIENNA', 'EUR')).status, 'invalid_response');
  assert.equal((await client(async () => resp('<html>')).get('AT-VIENNA', 'EUR')).status, 'invalid_response');
  assert.equal((await client(async () => resp('x', 403)).get('AT-VIENNA', 'EUR')).status, 'unauthorized');
  assert.equal((await client(async () => resp('x', 429)).get('AT-VIENNA', 'EUR')).status, 'rate_limited');
  assert.equal((await client(async () => resp('x', 502)).get('AT-VIENNA', 'EUR')).status, 'upstream_error');
  assert.equal((await client(async () => resp(createEmptyMarketData('AT-VIENNA', 'rate_limited', { currency: 'EUR' }), 429)).get('AT-VIENNA', 'EUR')).status, 'rate_limited');
  assert.equal((await client(async () => { throw new TypeError('x'); }).get('AT-VIENNA', 'EUR')).status, 'network_error');
  const hang = (u, i) => new Promise((_, rej) => i.signal.addEventListener('abort', () => rej(new DOMException('a', 'AbortError'))));
  assert.equal((await client(hang, 20).get('AT-VIENNA', 'EUR')).status, 'timeout');
  let called = 0;
  const c = client(async () => { called++; return resp(good()); });
  assert.equal((await c.get('../x', 'EUR')).status, 'not_configured');
  assert.equal((await c.get('AT-VIENNA', 'GBP')).status, 'not_configured');
  assert.equal(called, 0);
});

test('race: late response for a previous city is discarded', async () => {
  const latest = createLatestOnly();
  const resolvers = {};
  const f = (url, init) => new Promise((resolve, reject) => {
    const loc = new URL(url, 'http://x').searchParams.get('location');
    resolvers[loc] = () => resolve(resp(good(loc)));
    init.signal.addEventListener('abort', () => reject(new DOMException('a', 'AbortError')));
  });
  const c = client(f, 5000);
  const first = latest.run((signal) => c.get('AT-VIENNA', 'EUR', { signal }));
  const second = latest.run((signal) => c.get('FR-PARIS', 'EUR', { signal }));
  resolvers['FR-PARIS']();
  const [r1, r2] = await Promise.all([first, second]);
  assert.equal(r1.superseded, true);
  assert.equal(r2.value.requestedLocationId, 'FR-PARIS');
});
