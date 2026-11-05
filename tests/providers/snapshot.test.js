// Snapshot (src/data/market-snapshot.json) → MarketData v2, exact USD→EUR, capital fallback (contracts.md §9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import snapshot from '../../src/data/market-snapshot.json' with { type: 'json' };
import capitalsFile from '../../src/providers/capitals.json' with { type: 'json' };
import { marketDataFromSnapshot, snapshotEntryToMarketData, usdToEur, parseRate, capitalFor, validateMarketData, MARKET_STATUS_LABELS_KA, MARKET_WARNING_LABELS_KA, composeMarketData } from '../../src/providers/index.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const BLOCKS = ['rent', 'utilities', 'groceries', 'restaurants', 'indices', 'budget'];

test('every snapshot city converts to valid MarketData in USD and EUR', () => {
  for (const id of Object.keys(snapshot.cities)) for (const cur of ['USD', 'EUR']) {
    const md = snapshotEntryToMarketData(snapshot, id, cur);
    assert.ok(md, `${id} ${cur}`);
    assert.ok(validateMarketData(md).ok, `${id} ${cur}: ${validateMarketData(md).errors.join(';')}`);
    assert.equal(md.cache.state, 'snapshot');
    assert.equal(md.currency, cur);
  }
});

test('EUR conversion is exact (BigInt, usdPerEur.exact) and rounded half-up to 2 dp', () => {
  const [p, q] = snapshot.usdPerEur.exact.split('/').map(BigInt);
  const ref = (usd) => { const [i, f = ''] = usd.split('.'); const num = BigInt(i + f) * q * 100n; const den = 10n ** BigInt(f.length) * p; let n = num / den; if ((num % den) * 2n >= den) n += 1n; return `${n / 100n}.${(n % 100n).toString().padStart(2, '0')}`; };
  const v = snapshot.cities['AT-VIENNA'];
  const eur = snapshotEntryToMarketData(snapshot, 'AT-VIENNA', 'EUR');
  assert.equal(eur.rent.items.centre_1br.average, ref(v.rent.centre_1br.average));
  assert.equal(eur.rent.items.centre_1br.average, '1182.88');
  assert.equal(eur.budget.single.average, ref(v.budget.single.average));
  assert.equal(eur.indices.costOfLiving, v.indices.costOfLiving, 'indices are not converted');
  assert.equal(usdToEur('1.12', '1.12'), '1.00');
  assert.equal(usdToEur('0.005', '1'), '0.01', 'half-up');
  assert.equal(usdToEur('0.004', '1'), null, 'rounds to 0 → null, never "0"');
  assert.deepEqual(parseRate('3/2'), [3n, 2n]);
  assert.equal(parseRate('0/2'), null);
  const usd = snapshotEntryToMarketData(snapshot, 'AT-VIENNA', 'USD');
  assert.equal(usd.rent.items.centre_1br.average, v.rent.centre_1br.average);
  assert.ok(!usd.warnings.some((w) => w.code === 'reference_fx'));
});

test('labels: snapshot copy date and reference FX message', () => {
  const md = snapshotEntryToMarketData(snapshot, 'AT-VIENNA', 'EUR');
  const msg = (c) => md.warnings.find((w) => w.code === c)?.message_ka;
  assert.equal(msg('snapshot_copy'), 'შენახული მონაცემი, 31.10.2026');
  assert.equal(msg('reference_fx'), `≈ გადაყვანილია Numbeo-ს კურსით 1 EUR = ${snapshot.usdPerEur.value} USD, 31.10.2026 — საორიენტაციოდ`);
  assert.equal(MARKET_STATUS_LABELS_KA.pending_refresh, 'ფასები მალე განახლდება');
  for (const c of ['snapshot_copy', 'reference_fx', 'capital_fallback']) assert.ok(MARKET_WARNING_LABELS_KA[c], c);
  assert.equal(md.provider.attribution_ka, 'წყარო: Numbeo.com (მოპოვებულია Apify-ის მეშვეობით)');
});

test('capitals: derived from embassy missions; overrides; file is up to date', () => {
  const c = capitalsFile.capitals;
  assert.equal(c.AZ.locationId, 'AZ-BAKU');
  assert.equal(c.TR.locationId, 'TR-ANKARA');
  assert.equal(c.VA.locationId, 'IT-ROME');
  assert.equal(c.RU.basis, 'embassy-section');
  assert.ok(c.NL.embassyNotInCapital && c.IL.embassyNotInCapital);
  assert.equal(capitalFor('AT-VIENNA'), null, 'a capital has no fallback');
  assert.deepEqual(capitalFor('AZ-GANJA'), { locationId: 'AZ-BAKU', city_ka: 'ბაქო' });
  execFileSync('node', ['scripts/gen-capitals.mjs', '--check'], { cwd: ROOT });
});

test('whole-city capital fallback: Vatican → Rome, Strasbourg → Paris (never exact)', () => {
  for (const [id, cap, ka] of [['VA-VATICAN-CITY', 'IT-ROME', 'რომი'], ['FR-STRASBOURG', 'FR-PARIS', 'პარიზი']]) {
    assert.ok(!snapshot.cities[id], `${id} absent from snapshot`);
    const md = marketDataFromSnapshot(snapshot, id, 'EUR');
    assert.ok(validateMarketData(md).ok);
    assert.equal(md.requestedLocationId, id);
    assert.equal(md.resolvedLocation.matchStatus, 'capital-fallback');
    assert.deepEqual(md.resolvedLocation.fallbackFrom, { locationId: cap, city_ka: ka });
    assert.equal(md.warnings.find((w) => w.code === 'capital_fallback').message_ka, `ქალაქის მონაცემი არ მოიძებნა — ნაჩვენებია დედაქალაქის (${ka}) მონაცემი`);
    assert.equal(md.rent.items.centre_1br.average, snapshotEntryToMarketData(snapshot, cap, 'EUR').rent.items.centre_1br.average);
  }
});

test('per-category capital fallback: Ganja keeps own rent, takes missing categories from Baku with fallback:true', () => {
  const own = snapshotEntryToMarketData(snapshot, 'AZ-GANJA', 'USD');
  const md = marketDataFromSnapshot(snapshot, 'AZ-GANJA', 'USD');
  assert.ok(validateMarketData(md).ok);
  assert.equal(md.resolvedLocation.matchStatus, 'exact');
  assert.deepEqual(md.rent, own.rent, 'own data is never replaced');
  const filled = BLOCKS.filter((k) => md[k]?.fallback);
  assert.ok(filled.length > 0);
  for (const k of filled) assert.ok(!['cached', 'fresh', 'stale', 'partial'].includes(own[k].status), `${k} was missing in Ganja`);
  assert.equal(md.resolvedLocation.fallbackFrom.locationId, 'AZ-BAKU');
});

test('a location without own data, snapshot or capital data → null (caller shows pending_refresh)', () => {
  assert.equal(composeMarketData({ locationId: 'XX-NOWHERE' }), null);
  assert.equal(marketDataFromSnapshot({ ...snapshot, cities: {} }, 'AZ-GANJA', 'EUR'), null);
  assert.equal(snapshotEntryToMarketData({ ...snapshot, usdPerEur: null }, 'AT-VIENNA', 'EUR'), null, 'no FX rate → no EUR amounts');
});
