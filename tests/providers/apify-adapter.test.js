// Apify/Numbeo adapter contract tests — SYNTHETIC fixtures only (both documented output shapes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchApifyMarket, extractPriceRows, selectItems, findRanking, cityMatches, APIFY_SYNC_URL, normalizeApify } from '../../src/providers/apify-numbeo-adapter.js';
import { validateMarketData, sumDecimalStrings, toDecimalString } from '../../src/providers/market-contract.js';
import names from '../../src/providers/numbeo-city-names.json' with { type: 'json' };
import normative from '../../src/data/normative-data.json' with { type: 'json' };
import { SYNTHETIC_NAMES, flatPrices, nestedLegacyPrices, rankingsRows, mockApify, FAKE_TOKEN } from './fixtures/apify-synthetic.js';
const nestedPrices = flatPrices;

const NOW = () => Date.parse('2026-10-30T10:00:00Z');
const run = (fetchImpl, extra = {}) => fetchApifyMarket({ locationId: 'AT-VIENNA', currency: 'EUR', names: SYNTHETIC_NAMES, token: FAKE_TOKEN, fetchImpl, timeoutMs: 50, now: NOW, ...extra });
const valid = (d) => assert.ok(validateMarketData(d).ok, validateMarketData(d).errors.join('\n'));

test('city-name map: every location; 76 verified against rankings; 5 not in rankings', () => {
  const ids = normative.locations.map((l) => l.id).sort();
  assert.deepEqual(Object.keys(names.locations).sort(), ids);
  const unv = Object.entries(names.locations).filter(([, e]) => !e.verified).map(([id]) => id).sort();
  assert.deepEqual(unv, ['AZ-GANJA', 'CU-HAVANA', 'TM-ASHGABAT', 'TR-TRABZON', 'UA-DONETSK']);
  for (const [id, n] of [['UA-KYIV', 'Kiev (Kyiv)'], ['IN-NEW-DELHI', 'Delhi'], ['DE-FRANKFURT', 'Frankfurt'], ['KZ-ASTANA', 'Astana (Nur-Sultan)']]) assert.equal(names.locations[id].numbeoCity, n);
  assert.equal(names.locations['VA-VATICAN-CITY'].matchStatus, 'nearby-explained');
  assert.equal(names.locations['US-WASHINGTON'].numbeoCity, 'Washington, DC');
});

test('request: POST to sync endpoint, token only in Authorization header, inputs per mode', async () => {
  const f = mockApify({ city_prices: nestedPrices(), rankings: rankingsRows() });
  await run(f);
  assert.equal(f.calls.length, 2);
  for (const c of f.calls) {
    assert.ok(c.url.startsWith(APIFY_SYNC_URL + '?timeout='));
    assert.ok(!c.url.includes(FAKE_TOKEN));
    assert.equal(c.headers.Authorization, `Bearer ${FAKE_TOKEN}`);
  }
  const prices = f.calls.find((c) => c.input.mode === 'city_prices');
  assert.deepEqual(prices.input, { mode: 'city_prices', cities: ['Vienna'], currency: 'EUR' });
  assert.deepEqual(f.calls.find((c) => c.input.mode === 'rankings').input, { mode: 'rankings', maxCities: 0 });
});

for (const [shape, prices, rk] of [['real flat', flatPrices(), rankingsRows()]]) {
  test(`success (${shape} shape) → full MarketData v2`, async () => {
    const { data } = await run(mockApify({ city_prices: prices, rankings: rk }));
    valid(data);
    assert.equal(data.status, 'fresh');
    assert.deepEqual(data.rent.items.centre_1br, { average: '1234.56', low: '900', high: '1800' });
    assert.equal(data.rent.items.outside_3br.average, '1700');
    assert.equal(data.rent.rentIndex, '30.2');
    assert.equal(data.utilities.basic85m2.average, '210.5');
    assert.equal(data.utilities.internet.average, '35');
    assert.equal(data.groceries.basketItemsSum, '6.7', 'wine, beers, cigarettes excluded');
    assert.deepEqual([data.groceries.itemsCounted, data.groceries.itemsMissing], [3, 0]);
    assert.deepEqual(data.rent.items.centre_3br, { average: '2500', low: '1900', high: '3500' }, 'thousands commas in range');
    assert.deepEqual(data.rent.items.outside_3br, { average: '1700', low: null, high: null }, 'empty range → null');
    assert.equal(data.groceries.groceriesIndex, '58.9');
    assert.equal(data.restaurants.inexpensiveMeal.average, '15');
    assert.equal(data.restaurants.midRangeForTwo.average, '80');
    assert.deepEqual([data.indices.costOfLiving, data.indices.costOfLivingPlusRent, data.indices.baseline], ['65.4', '48.8', 'ნიუ-იორკი = 100']);
    assert.equal(data.fetchedAt, '2026-10-30T10:00:00Z');
    assert.equal(data.sourceUpdatedAt, null);
    assert.equal(data.provider.attribution_ka, 'წყარო: Numbeo.com (მოპოვებულია Apify-ის მეშვეობით)');
    const codes = data.warnings.map((w) => w.code);
    for (const c of ['scraped_source_terms', 'index_is_not_money', 'range_is_not_confidence_interval']) assert.ok(codes.includes(c), c);
    assert.equal(data.indices.costOfLiving, '65.4', 'country check picks Vienna, Austria');
  });
}

test('missing items → null (never 0); missing basket item not counted; partial status', async () => {
  const prices = flatPrices({ drop: ['3 Bedroom Apartment Outside of City Centre', 'Broadband Internet (Unlimited Data, 60 Mbps or Higher)'], override: { 'Eggs (12, Large Size)': 0 } });
  const { data } = await run(mockApify({ city_prices: prices, rankings: rankingsRows() }));
  valid(data);
  assert.equal(data.rent.items.outside_3br, null);
  assert.equal(data.rent.status, 'partial');
  assert.equal(data.utilities.internet, null);
  assert.equal(data.utilities.status, 'partial');
  assert.equal(data.groceries.basketItemsSum, '3.35');
  assert.deepEqual([data.groceries.itemsCounted, data.groceries.itemsMissing], [2, 1]);
  assert.equal(data.groceries.status, 'partial');
  assert.equal(data.status, 'partial');
  assert.ok(data.warnings.some((w) => w.code === 'basket_incomplete'));
});

test('legacy (nested, old names) shape still parsed', async () => {
  const { data } = await run(mockApify({ city_prices: nestedLegacyPrices(), rankings: rankingsRows() }));
  valid(data);
  assert.equal(data.rent.items.centre_1br.average, '1000');
  assert.equal(data.utilities.basic85m2.average, '200');
  assert.equal(data.restaurants.inexpensiveMeal.average, '12');
});

test('basic85m2 matches regardless of spacing / m² spelling', () => {
  for (const n of ['Basic Utilities for 85 m2 Apartment (Electricity, Heating, Cooling, Water, Garbage)', 'Basic Utilities for 85m2 Apartment (Electricity, Heating, Cooling, Water, Garbage)', 'Basic Utilities for 85 m² Apartment (Electricity, Heating, Cooling, Water, Garbage)']) {
    assert.equal(selectItems(extractPriceRows([{ city: 'Vienna', category: 'Utilities (Monthly)', item: n, price: 100, currency: 'EUR', range: '' }])).items.basic85m2.average, '100', n);
  }
});

test('exact item names win over prefixes; new Numbeo spellings accepted', () => {
  const rows = extractPriceRows([{ city: 'Vienna', prices: [
    { category: 'Utilities', item: 'Internet (something else)', price: 99 },
    { category: 'Utilities', item: 'Internet (60 Mbps or More, Unlimited Data, Cable/ADSL)', price: 30 },
    { category: 'Rent', item: '1 Bedroom Apartment in City Centre (Rent Per Month)', price: 1000 },
    { category: 'Restaurants', item: 'Meal for 2 People, Mid-range Restaurant, Three-course extra', price: 1 },
  ] }]);
  const s = selectItems(rows);
  assert.equal(s.items.internet.average, '30');
  assert.equal(s.items.centre_1br.average, '1000');
  assert.equal(s.items.midRangeForTwo, null, 'no prefix rule for meals');
});

test('wrong city and wrong currency → wrong_city; values rejected', async () => {
  let r = await run(mockApify({ city_prices: nestedPrices({ city: 'Paris' }), rankings: rankingsRows() }));
  valid(r.data);
  assert.equal(r.data.rent.items.centre_1br, null);
  assert.equal(r.data.utilities.status, 'wrong_city');
  r = await run(mockApify({ city_prices: nestedPrices({ currency: 'USD' }), rankings: rankingsRows() }));
  assert.equal(r.data.utilities.status, 'wrong_city');
  assert.equal(r.data.currency, 'EUR');
  assert.equal(r.data.rent.items.centre_1br, null);
  assert.ok(cityMatches('New York, NY, United States', 'New York, NY'));
  assert.ok(cityMatches('New York', 'New York, NY'));
  assert.ok(cityMatches('Kyiv (Kiev)', 'Kyiv'));
  assert.ok(!cityMatches('Vienna, VA', 'Vienna, Austria'));
});

for (const [name, spec, status] of [
  ['401', { status: 401, body: {} }, 'unauthorized'], ['403', { status: 403, body: {} }, 'unauthorized'],
  ['402', { status: 402, body: {} }, 'unauthorized'], ['408 run timeout', { status: 408, body: {} }, 'timeout'],
  ['429', { status: 429, body: {} }, 'rate_limited'], ['500', { status: 500, body: '' }, 'upstream_error'],
  ['invalid JSON', '{"x":', 'invalid_response'], ['non-array body', { status: 201, body: { error: 'x' } }, 'invalid_response'],
  ['empty dataset', [], 'not_found'], ['network', 'neterr', 'network_error'], ['client timeout', 'hang', 'timeout'],
]) {
  test(`upstream ${name} → ${status}`, async () => {
    const { data } = await run(mockApify({ city_prices: spec, rankings: spec }));
    valid(data);
    assert.equal(data.status, status);
    assert.equal(data.rent.status, status);
    if (name === '402') assert.ok(data.warnings.some((w) => w.code === 'payment_required'));
  });
}

test('rankings fail, prices ok → partial with index nulls; and vice versa', async () => {
  let { data } = await run(mockApify({ city_prices: nestedPrices(), rankings: { status: 500, body: '' } }));
  valid(data);
  assert.equal(data.indices.status, 'upstream_error');
  assert.equal(data.rent.rentIndex, null);
  assert.equal(data.status, 'partial');
  ({ data } = await run(mockApify({ city_prices: { status: 500, body: '' }, rankings: rankingsRows() })));
  valid(data);
  assert.equal(data.utilities.status, 'upstream_error');
  assert.equal(data.indices.status, 'fresh');
  assert.equal(data.rent.status, 'partial');
});

test('no token / unmapped / bad currency → not_configured without calls', async () => {
  const f = mockApify({});
  for (const extra of [{ token: '' }, { token: undefined }, { locationId: 'DE-BERLIN' }, { currency: 'GBP' }]) {
    const { data } = await run(f, extra);
    valid(data);
    assert.equal(data.status, 'not_configured');
  }
  assert.equal(f.calls.length, 0);
});

test('nearby-explained mapping keeps note and warning', async () => {
  const { data } = await run(mockApify({ city_prices: nestedPrices({ city: 'Rome', country: 'Italy' }), rankings: rankingsRows() }), { locationId: 'VA-VATICAN-CITY' });
  valid(data);
  assert.equal(data.resolvedLocation.matchStatus, 'nearby-explained');
  assert.ok(data.resolvedLocation.note);
  assert.ok(data.warnings.some((w) => w.code === 'nearby_city'));
  assert.equal(data.indices.status, 'not_found', 'Rome not in rankings fixture');
});

test('city missing from rankings (Trabzon): prices shown, indices not_found', async () => {
  const { data } = await run(mockApify({ city_prices: flatPrices({ city: 'Trabzon', country: 'Turkey' }), rankings: rankingsRows() }), { locationId: 'TR-TRABZON' });
  valid(data);
  assert.equal(data.indices.status, 'not_found');
  assert.equal(data.rent.items.centre_1br.average, '1234.56');
  assert.ok(data.warnings.some((w) => w.code === 'city_name_unverified'));
});

test('decimal helpers: exact sums, strings with separators, no zeros', () => {
  assert.equal(sumDecimalStrings(['0.1', '0.2']), '0.3');
  assert.equal(sumDecimalStrings([]), null);
  assert.equal(toDecimalString('1,234.50'), '1234.5');
  assert.equal(toDecimalString('€ 12.30'), '12.3');
  assert.equal(toDecimalString('0'), null);
  assert.equal(toDecimalString('n/a'), null);
  assert.equal(findRanking([{ City: 'Vienna', 'Cost of Living': 'abc' }], 'Vienna').costOfLiving, null);
  assert.equal(findRanking(rankingsRows(), 'Vienna', 'United States').costOfLiving, '99');
  assert.equal(findRanking(rankingsRows(), 'Vienna, Austria'), null, 'exact Numbeo name only');
});

test('normalizeApify output never contains the token', () => {
  const d = normalizeApify({ locationId: 'AT-VIENNA', currency: 'EUR', entry: SYNTHETIC_NAMES.locations['AT-VIENNA'], prices: { status: 'ok', items: nestedPrices() }, rankings: { status: 'ok', items: rankingsRows() }, fetchedAt: '2026-10-30T10:00:00Z' });
  assert.ok(!JSON.stringify(d).includes(FAKE_TOKEN));
});
