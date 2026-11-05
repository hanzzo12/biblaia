// Market snapshot sanity (round 5): no implausible rents (e.g. KZT labelled USD), Odesa is the Ukrainian city
// (not Odessa, Texas). Checks the raw snapshot files AND the effective rows the offline page shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marketSummaryFromSnapshots, marketDataFromSnapshot } from '../../src/providers/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const data = read('src/data/normative-data.json');
const user = read('src/data/market-snapshot.json');
const apify = read('src/data/market-apify-snapshot.json');
const MAX_RENT = 20000;
const avg = (p) => (p && typeof p === 'object' ? p.average ?? null : p ?? null);

test(`no snapshot city has a centre 1-bedroom rent above ${MAX_RENT}`, () => {
  const bad = [];
  for (const [k, v] of Object.entries({ ...user.cities, ...(user.extraCities || {}) })) {
    const x = avg(v.rent?.centre_1br);
    if (x != null && Number(x) > MAX_RENT) bad.push(`user ${k}=${x}`);
  }
  for (const [k, v] of Object.entries(apify.cities)) {
    const x = avg(v.rent?.items?.centre_1br);
    if (x != null && Number(x) > MAX_RENT) bad.push(`apify ${k}=${x} ${v.currency}`);
  }
  assert.deepEqual(bad, []);
});

test(`effective (offline summary) rows: every centre 1br rent ≤ ${MAX_RENT}, 80 rows`, () => {
  const sum = marketSummaryFromSnapshots(user, apify, data);
  const rows = sum.rows || [];
  assert.equal(rows.length, 80, `rows: ${rows.length}`);
  const bad = rows.filter((r) => r.rentCentre1br != null && Number(r.rentCentre1br) > MAX_RENT).map((r) => `${r.locationId}=${r.rentCentre1br} ${r.currency}`);
  assert.deepEqual(bad, []);
});

test('Odesa is in Ukraine (not Odessa, Texas); bad Apify rows rejected in favour of the user snapshot', () => {
  const loc = data.locations.find((l) => l.id === 'UA-ODESA');
  assert.equal(loc?.countryId, 'UA');
  assert.doesNotMatch(JSON.stringify(apify.cities['UA-ODESA'] ?? {}), /Texas|, TX|United States/i);
  const sum = marketSummaryFromSnapshots(user, apify, data);
  const od = sum.rows.find((r) => r.locationId === 'UA-ODESA');
  assert.ok(od, 'Odesa row present');
  assert.match(od.country_ka ?? '', /უკრაინა/);
  assert.equal(od.rentCentre1br, '331.27');
  assert.equal(od.currency, 'USD');
  const as = sum.rows.find((r) => r.locationId === 'KZ-ASTANA');
  assert.equal(as?.rentCentre1br, '591.58');
  assert.equal(as?.currency, 'USD');
  // the page's offline market block for Odesa/Astana (USD missions)
  for (const [locId, rent] of [['UA-ODESA', '331.27'], ['KZ-ASTANA', '591.58']]) {
    const md = marketDataFromSnapshot(user, locId, 'USD', { apifySnapshot: apify });
    assert.equal(avg(md?.rent?.items?.centre_1br), rent, `${locId} offline rent`);
    assert.equal(md?.currency, 'USD');
  }
});
