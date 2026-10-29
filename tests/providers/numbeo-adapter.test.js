// Contract tests for the server-side Numbeo adapter. SYNTHETIC, documentation-shaped responses only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchNumbeoMarket, buildNumbeoRequests, resolveMapping, toDecimalString, checkCityIdentity, httpStatusToDataStatus,
} from '../../src/providers/numbeo-adapter.js';
import { validateMarketData } from '../../src/providers/market-contract.js';
import realMap from '../../src/providers/numbeo-city-map.json' with { type: 'json' };
import { SYNTHETIC_CITY_MAP, pricesBody, indicesBody, mockNumbeoFetch } from './fixtures/synthetic-numbeo.js';

const KEY = 'synthetic-test-key-DO-NOT-USE';
const NOW = () => Date.parse('2026-10-29T10:00:00Z');
const run = (fetchImpl, extra = {}) => fetchNumbeoMarket({
  locationId: 'AT-VIENNA', currency: 'EUR', cityMap: SYNTHETIC_CITY_MAP, apiKey: KEY, fetchImpl, timeoutMs: 50, now: NOW, ...extra,
});
const ok = (d) => assert.ok(validateMarketData(d).ok, validateMarketData(d).errors.join('\n'));

test('real city map is empty and unverified (no invented IDs)', () => {
  assert.deepEqual(realMap.cities, {});
  assert.equal(realMap._meta.status, 'unverified-empty');
  assert.equal(realMap.items.centre_1br.itemId, 26);
  assert.equal(realMap.items.centre_3br.itemId, 28);
  assert.equal(realMap.items.outside_1br.itemId, 27);
  assert.equal(realMap.items.outside_3br.itemId, null);
});

test('request URLs: city_id, currency, strict_matching=true, use_estimated=false; no key in URL', () => {
  const { prices, indices } = buildNumbeoRequests(SYNTHETIC_CITY_MAP.cities['AT-VIENNA'], 'USD');
  const p = new URL(prices);
  assert.equal(p.origin + p.pathname, 'https://www.numbeo.com/api/city_prices');
  assert.equal(p.searchParams.get('city_id'), '900001');
  assert.equal(p.searchParams.get('currency'), 'USD');
  assert.equal(p.searchParams.get('strict_matching'), 'true');
  assert.equal(p.searchParams.get('use_estimated'), 'false');
  assert.ok(!p.searchParams.has('api_key') && !p.searchParams.has('query'));
  const i = new URL(indices);
  assert.equal(i.pathname, '/api/indices');
  assert.equal(i.searchParams.get('city_id'), '900001');
  assert.throws(() => buildNumbeoRequests(SYNTHETIC_CITY_MAP.cities['AT-VIENNA'], 'GBP'));
});

test('success: normalized MarketData, decimal strings, key only in X-Api-Key header', async () => {
  const f = mockNumbeoFetch({ prices: pricesBody(), indices: indicesBody() });
  const { data } = await run(f);
  ok(data);
  assert.equal(f.calls.length, 2);
  for (const c of f.calls) { assert.equal(c.headers['X-Api-Key'], KEY); assert.ok(!c.url.includes(KEY)); }
  assert.equal(data.currency, 'EUR');
  assert.equal(data.resolvedLocation.providerCityId, '900001');
  assert.equal(data.resolvedLocation.matchStatus, 'exact');
  const c1 = data.rent.items.centre_1br;
  assert.deepEqual([c1.average, c1.low, c1.high, c1.dataPoints, c1.status], ['1234.56', '900', '1800', 40, 'fresh']);
  assert.equal(c1.sourceUpdatedAt, '2026-09');
  assert.equal(c1.fetchedAt, '2026-10-29T10:00:00Z');
  assert.equal(data.rent.items.centre_3br.average, '2500');
  assert.equal(data.rent.items.outside_1br.average, '850.1');
  assert.ok(!('outside_3br' in data.rent.items), 'unconfirmed item 29 must not be requested/shown');
  assert.ok(!('centre_2br' in data.rent.items));
  assert.equal(data.rent.status, 'fresh');
  assert.deepEqual([data.indices.costOfLivingExcludingRent, data.indices.rentIndex, data.indices.costOfLivingPlusRent], ['61.25', '30.5', '46.75']);
  assert.deepEqual(data.indices.baseline, { label: 'New York City', value: '100' });
  assert.equal(data.indices.sourceUpdatedAt, null);
  const codes = data.warnings.map((w) => w.code);
  for (const c of ['low_data_points', 'range_is_not_confidence_interval', 'quality_not_guaranteed', 'index_is_not_money', 'license_unconfirmed']) assert.ok(codes.includes(c), c);
});

test('no key → not_configured, no upstream call', async () => {
  const f = mockNumbeoFetch({});
  for (const apiKey of [undefined, '', '   ']) {
    const { data } = await run(f, { apiKey });
    ok(data);
    assert.equal(data.rent.status, 'not_configured');
    assert.equal(data.indices.status, 'not_configured');
  }
  assert.equal(f.calls.length, 0);
});

test('unmapped location → not_configured, never guesses by name', async () => {
  const f = mockNumbeoFetch({ prices: pricesBody(), indices: indicesBody() });
  const { data, diagnostics } = await run(f, { locationId: 'DE-BERLIN' });
  assert.equal(data.rent.status, 'not_configured');
  assert.equal(diagnostics.reason, 'unmapped');
  assert.equal(f.calls.length, 0);
  assert.equal(resolveMapping({ cities: { X: { numbeoCityId: 'abc', numbeoCity: 'X', countryCode: null, matchStatus: 'exact' } } }, 'X').ok, false);
});

test('timeout → timeout status for both blocks', async () => {
  const { data } = await run(mockNumbeoFetch({ prices: 'hang', indices: 'hang' }));
  ok(data);
  assert.equal(data.rent.status, 'timeout');
  assert.equal(data.indices.status, 'timeout');
});

test('network error → network_error', async () => {
  const { data } = await run(mockNumbeoFetch({ prices: 'neterr', indices: 'neterr' }));
  assert.equal(data.rent.status, 'network_error');
});

for (const [code, status] of [[401, 'unauthorized'], [403, 'unauthorized'], [429, 'rate_limited'], [500, 'upstream_error'], [503, 'upstream_error']]) {
  test(`HTTP ${code} → ${status}`, async () => {
    const { data } = await run(mockNumbeoFetch({ prices: { status: code, body: { error: 'x' } }, indices: { status: code, body: 'oops' } }));
    ok(data);
    assert.equal(data.rent.status, status);
    assert.equal(data.indices.status, status);
    assert.equal(httpStatusToDataStatus(code), status);
  });
}

test('invalid JSON → invalid_response', async () => {
  const { data } = await run(mockNumbeoFetch({ prices: '{"name": "Synth', indices: '<html>' }));
  ok(data);
  assert.equal(data.rent.status, 'invalid_response');
  assert.equal(data.indices.status, 'invalid_response');
});

test('HTTP 200 with {error} body is not treated as data', async () => {
  const { data } = await run(mockNumbeoFetch({ prices: { error: 'Invalid api_key' }, indices: { error: 'something else' } }));
  assert.equal(data.rent.status, 'unauthorized');
  assert.equal(data.indices.status, 'invalid_response');
});

test('missing rent items → rent not_found, indices still shown', async () => {
  const body = pricesBody({ items: [{ item_id: 1, item_name: 'Meal', average_price: 10, lowest_price: 5, highest_price: 20, data_points: 9 }] });
  const { data } = await run(mockNumbeoFetch({ prices: body, indices: indicesBody() }));
  ok(data);
  assert.equal(data.rent.status, 'not_found');
  assert.equal(data.rent.items.centre_1br.average, null);
  assert.equal(data.rent.items.centre_1br.status, 'not_found');
  assert.equal(data.indices.status, 'fresh');
});

test('zero/negative prices become null, never 0; missing range → partial', async () => {
  const body = pricesBody({ items: [
    { item_id: 26, item_name: 'Apartment (1 bedroom) in City Centre', average_price: 0, lowest_price: 0, highest_price: 0, data_points: 0 },
    { item_id: 28, item_name: 'Apartment (3 bedrooms) in City Centre', average_price: 2000, data_points: 12 },
  ] });
  const { data } = await run(mockNumbeoFetch({ prices: body, indices: indicesBody() }));
  ok(data);
  assert.equal(data.rent.items.centre_1br.average, null);
  assert.equal(data.rent.items.centre_1br.status, 'not_found');
  assert.equal(data.rent.items.centre_3br.status, 'partial');
  assert.equal(data.rent.items.centre_3br.low, null);
  assert.equal(data.rent.status, 'partial');
  assert.equal(toDecimalString(0), null);
  assert.equal(toDecimalString(-3), null);
  assert.equal(toDecimalString(1e-9), null);
  assert.equal(toDecimalString(1757.142857142857), '1757.14285714');
});

test('missing index values → not_found / partial; rent unaffected', async () => {
  let r = await run(mockNumbeoFetch({ prices: pricesBody(), indices: indicesBody({ omit: ['cpi_index', 'rent_index', 'cpi_and_rent_index'] }) }));
  ok(r.data);
  assert.equal(r.data.indices.status, 'not_found');
  assert.equal(r.data.indices.baseline, null);
  assert.equal(r.data.rent.status, 'fresh');
  r = await run(mockNumbeoFetch({ prices: pricesBody(), indices: indicesBody({ omit: ['rent_index'] }) }));
  ok(r.data);
  assert.equal(r.data.indices.status, 'partial');
  assert.equal(r.data.indices.rentIndex, null);
});

test('wrong city (city_id or name) → wrong_city, values rejected', async () => {
  let r = await run(mockNumbeoFetch({ prices: pricesBody({ cityId: 123 }), indices: indicesBody({ name: 'Paris, France' }) }));
  ok(r.data);
  assert.equal(r.data.rent.status, 'wrong_city');
  assert.equal(r.data.indices.status, 'wrong_city');
  assert.deepEqual(r.data.rent.items, {});
  assert.equal(r.data.indices.costOfLivingExcludingRent, null);
  const entry = SYNTHETIC_CITY_MAP.cities['AT-VIENNA'];
  assert.equal(checkCityIdentity({ name: 'Synthetic Vienna, Austria', city_id: 900001 }, entry), 'ok');
  assert.equal(checkCityIdentity({ name: 'Synthetic Vienna Outskirts', city_id: 900001 }, entry), 'wrong_city');
  assert.equal(checkCityIdentity({ name: 'Synthetic Vienna', country: 'Germany' }, entry), 'wrong_city');
  assert.equal(checkCityIdentity({}, entry), 'invalid_response');
});

test('wrong currency in response → rejected (no conversion)', async () => {
  const { data } = await run(mockNumbeoFetch({ prices: pricesBody({ currency: 'USD' }), indices: indicesBody() }));
  ok(data);
  assert.equal(data.rent.status, 'wrong_city');
  assert.equal(data.currency, 'EUR');
  assert.deepEqual(data.rent.items, {});
});

test('item_id renumbered (name mismatch) → item rejected', async () => {
  const body = pricesBody({ items: [{ item_id: 26, item_name: 'Cappuccino (regular)', average_price: 3, lowest_price: 2, highest_price: 4, data_points: 50 }] });
  const { data } = await run(mockNumbeoFetch({ prices: body, indices: indicesBody() }));
  ok(data);
  assert.equal(data.rent.items.centre_1br.status, 'invalid_response');
  assert.equal(data.rent.items.centre_1br.average, null);
  assert.ok(data.warnings.some((w) => w.code === 'item_mapping_unverified'));
});

test('nearby-explained mapping keeps explanation and is never "exact"', async () => {
  const body = pricesBody({ cityId: 900002, name: 'Synthetic Rome, Italy' });
  const { data } = await run(mockNumbeoFetch({ prices: body, indices: indicesBody({ cityId: 900002, name: 'Synthetic Rome' }) }), { locationId: 'VA-VATICAN-CITY' });
  ok(data);
  assert.equal(data.resolvedLocation.matchStatus, 'nearby-explained');
  assert.ok(data.resolvedLocation.note);
  assert.ok(data.warnings.some((w) => w.code === 'nearby_city'));
});

test('licenseConfirmed suppresses license_unconfirmed warning', async () => {
  const { data } = await run(mockNumbeoFetch({ prices: pricesBody(), indices: indicesBody() }), { licenseConfirmed: true });
  assert.ok(!data.warnings.some((w) => w.code === 'license_unconfirmed'));
});
