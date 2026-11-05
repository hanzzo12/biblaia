// Apify snapshot (2026-11-04): build from raw actor rows (SYNTHETIC numbers, real flat-row structure), units, precedence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApifySnapshot } from '../../scripts/build-apify-snapshot.mjs';
import { apifySnapshotEntryToMarketData, marketDataFromSnapshot, validateMarketData } from '../../src/providers/index.js';
import { mulDecimal2, selectItems, extractPriceRows } from '../../src/providers/apify-numbeo-adapter.js';
import userSnapshot from '../../src/data/market-snapshot.json' with { type: 'json' };
import realApify from '../../src/data/market-apify-snapshot.json' with { type: 'json' };
import { flatPrices, rankingsRows } from './fixtures/apify-synthetic.js';

const NAMES = { locations: {
  'AT-VIENNA': { numbeoCity: 'Vienna', numbeoCountry: 'Austria', countryCode: 'AT', matchStatus: 'exact', verified: true, apifyVerified: '2026-11-04' },
  'AZ-GANJA': { numbeoCity: 'Ganja', numbeoCountry: null, countryCode: 'AZ', matchStatus: 'exact', verified: false, pricesQuery: 'Gence', apifyVerified: '2026-11-04' },
  'UA-DONETSK': { numbeoCity: 'Donetsk', numbeoCountry: null, countryCode: 'UA', matchStatus: 'exact', verified: false, apifyExclude: 'x' },
  'US-NEW-YORK': { numbeoCity: 'New York, NY', numbeoCountry: 'United States', countryCode: 'US', matchStatus: 'exact', verified: true, apifyVerified: '2026-11-04' },
} };
const NORMATIVE = { missions: [
  { locationId: 'AT-VIENNA', fundingCurrency: 'EUR' }, { locationId: 'AZ-GANJA', fundingCurrency: 'USD' },
  { locationId: 'UA-DONETSK', fundingCurrency: 'USD' }, { locationId: 'US-NEW-YORK', fundingCurrency: 'USD' },
] };
// imperial grocery rows, as returned by the real 2026-11-04 run (synthetic prices)
const IMPERIAL = [
  { city: 'Vienna', country: 'Austria', category: 'Markets', item: 'Chicken Fillets (1 lb)', price: 5, currency: 'EUR', range: '' },
  { city: 'Vienna', country: 'Austria', category: 'Markets', item: 'Fresh White Bread (1 lb Loaf)', price: 2, currency: 'EUR', range: '' },
  { city: 'Vienna', country: 'Austria', category: 'Markets', item: 'Bottled Water (50 oz)', price: 1, currency: 'EUR', range: '' },
  { city: 'Vienna', country: 'Austria', category: 'Markets', item: 'Mystery Item (3 oz)', price: 9, currency: 'EUR', range: '' },
  { city: 'Vienna', country: 'Austria', category: 'Markets', item: 'Milk (Regular, 1 Liter)', price: 1.5, currency: 'EUR', range: '' },
];

test('imperial grocery units are converted to the metric basket exactly; unknown imperial items are not summed', () => {
  const s = selectItems(extractPriceRows(IMPERIAL));
  // 5×2.20462262=11.0231131→11.02; 2×1.10231131=2.20462262→2.20; 1×1.01442058→1.01; milk 1.5
  assert.equal(s.basket.sum, '15.73');
  assert.deepEqual([s.basket.counted, s.basket.missing], [4, 1]);
  assert.equal(mulDecimal2('0.004', '1'), null);
});

test('build: mission-currency entries, Ganja via actor name "Gence", indices-only city, excluded/missing city absent', () => {
  const snap = buildApifySnapshot({
    files: { EUR: [[...flatPrices(), ...IMPERIAL]], USD: [[...flatPrices({ city: 'Gence', country: 'Azerbaijan', currency: 'USD' })]] },
    rank: [...rankingsRows()], names: NAMES, normative: NORMATIVE, fetched: '2026-11-04',
  });
  assert.equal(snap.kind, 'market-apify-snapshot');
  assert.equal(snap.cities['AT-VIENNA'].currency, 'EUR');
  assert.equal(snap.cities['AZ-GANJA'].currency, 'USD');
  assert.equal(snap.cities['AZ-GANJA'].rent.items.centre_1br.average, '1234.56');
  assert.ok(Object.values(snap.cities['US-NEW-YORK'].rent.items).every((x) => x === null), 'no price rows → indices only');
  assert.equal(snap.cities['US-NEW-YORK'].indices.costOfLiving, '100');
  assert.ok(!snap.cities['UA-DONETSK']);
  assert.ok(!JSON.stringify(snap).includes('scrapedAt'), 'raw rows are not stored');
  const md = apifySnapshotEntryToMarketData(snap, 'AT-VIENNA', 'EUR');
  assert.ok(validateMarketData(md).ok, validateMarketData(md).errors.join());
  assert.equal(md.warnings[0].message_ka, 'შენახული მონაცემი · 04.11.2026');
  assert.equal(md.cache.state, 'snapshot');
  assert.equal(apifySnapshotEntryToMarketData(snap, 'AT-VIENNA', 'USD'), null, 'never served in another currency');
});

test('real Apify snapshot: all entries valid in their mission currency; Donetsk absent; Krakow indices only', () => {
  assert.equal(realApify.source.fetchedAt, '2026-11-04');
  for (const [id, c] of Object.entries(realApify.cities)) {
    const md = apifySnapshotEntryToMarketData(realApify, id, c.currency);
    assert.ok(md && validateMarketData(md).ok, id);
  }
  assert.ok(!realApify.cities['UA-DONETSK']);
  assert.ok(Object.values(realApify.cities['PL-KRAKOW'].rent.items).every((x) => x === null));
  assert.ok(realApify.cities['PL-KRAKOW'].indices.costOfLiving);
});

test('precedence per category: Apify snapshot (04.11) → user snapshot (31.10, budget) → capital', () => {
  const md = marketDataFromSnapshot(userSnapshot, 'AT-VIENNA', 'EUR', { apifySnapshot: realApify });
  assert.ok(validateMarketData(md).ok);
  const ap = apifySnapshotEntryToMarketData(realApify, 'AT-VIENNA', 'EUR');
  assert.deepEqual(md.rent, ap.rent, 'rent from the newer Apify copy');
  assert.equal(md.budget.source, 'snapshot', 'budget from the user snapshot');
  assert.equal(md.warnings.find((w) => w.code === 'snapshot_copy').message_ka, 'შენახული მონაცემი · 04.11.2026');
  const krakow = marketDataFromSnapshot(userSnapshot, 'PL-KRAKOW', 'EUR', { apifySnapshot: realApify });
  assert.ok(validateMarketData(krakow).ok);
  assert.equal(krakow.resolvedLocation.matchStatus, 'exact');
  assert.ok(krakow.rent.items.centre_1br, 'Krakow rent from the user snapshot');
  const donetsk = marketDataFromSnapshot(userSnapshot, 'UA-DONETSK', 'USD', { apifySnapshot: realApify });
  assert.equal(donetsk.resolvedLocation.matchStatus, 'capital-fallback');
  assert.equal(donetsk.resolvedLocation.fallbackFrom.locationId, 'UA-KYIV');
});
