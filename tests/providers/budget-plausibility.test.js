// Estimated living-cost budget (NYC × index / 100) and Apify plausibility guards. Exact rational checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import userSnapshot from '../../src/data/market-snapshot.json' with { type: 'json' };
import apifySnapshot from '../../src/data/market-apify-snapshot.json' with { type: 'json' };
import normative from '../../src/data/normative-data.json' with { type: 'json' };
import { estimateBudget, nycBudgetReference, marketDataFromSnapshot, marketSummaryFromSnapshots, validateMarketData, validateMarketSummary, MARKET_WARNING_LABELS_KA } from '../../src/providers/index.js';
import { checkAgainstReference } from '../../src/providers/plausibility.js';
import { normalizeApify } from '../../src/providers/apify-numbeo-adapter.js';
import { flatPrices } from './fixtures/apify-synthetic.js';

const R = (d) => { const [i, f = ''] = d.split('.'); return [BigInt(i + f), 10n ** BigInt(f.length)]; };
const round2 = (num, den) => { num *= 100n; let n = num / den; if ((num % den) * 2n >= den) n += 1n; return `${n / 100n}.${(n % 100n).toString().padStart(2, '0')}`; };

test('NYC reference: user snapshot NYC budget is null → exact median of budget×100/index over all real budgets', () => {
  assert.equal(userSnapshot.cities['US-NEW-YORK'].budget.single, null);
  const ref = nycBudgetReference(userSnapshot);
  assert.equal(ref.basis, 'median-implied');
  const implied = Object.values(userSnapshot.cities).filter((c) => c.budget?.single && c.indices?.costOfLiving)
    .map((c) => { const [bn, bd] = R(c.budget.single.average); const [i, id] = R(c.indices.costOfLiving); return [bn * 100n * id, bd * i]; })
    .sort((a, b) => (a[0] * b[1] < b[0] * a[1] ? -1 : a[0] * b[1] > b[0] * a[1] ? 1 : 0));
  assert.equal(implied.length, 41);
  const med = implied[20];
  assert.equal(ref.single[0] * med[1], med[0] * ref.single[1], 'exact rational median');
});

test('estimate is exact: Tokyo (USD) and an EUR city (×q/p), rounded half-up once', () => {
  const ref = nycBudgetReference(userSnapshot);
  const [p, q] = userSnapshot.usdPerEur.exact.split('/').map(BigInt);
  const est = estimateBudget(userSnapshot, '54.3', 'USD');
  const [i, id] = R('54.3');
  assert.equal(est.single.average, round2(ref.single[0] * i, ref.single[1] * id * 100n));
  const eur = estimateBudget(userSnapshot, '54.3', 'EUR');
  assert.equal(eur.family4.average, round2(ref.family4[0] * i * q, ref.family4[1] * id * 100n * p));
  assert.equal(estimateBudget(userSnapshot, '100', 'USD').single.average, round2(ref.single[0], ref.single[1]), 'index 100 = NYC');
});

test('MarketData: real Numbeo budgets keep basis "numbeo"; others get an estimate with budget_estimated', () => {
  const vienna = marketDataFromSnapshot(userSnapshot, 'AT-VIENNA', 'EUR', { apifySnapshot });
  assert.deepEqual([vienna.budget.basis, vienna.budget.estimated], ['numbeo', false]);
  const tokyo = marketDataFromSnapshot(userSnapshot, 'JP-TOKYO', 'USD', { apifySnapshot });
  assert.ok(validateMarketData(tokyo).ok, validateMarketData(tokyo).errors.join());
  assert.deepEqual([tokyo.budget.basis, tokyo.budget.estimated], ['estimated-from-index', true]);
  assert.equal(tokyo.budget.single.average, estimateBudget(userSnapshot, tokyo.indices.costOfLiving, 'USD').single.average);
  const w = tokyo.warnings.find((x) => x.code === 'budget_estimated');
  assert.equal(w.message_ka, '≈ შეფასებულია Numbeo-ს ინდექსით: ნიუ-იორკის ხარჯი × ინდექსი / 100');
  assert.ok(MARKET_WARNING_LABELS_KA.budget_estimated && MARKET_WARNING_LABELS_KA.implausible_value);
  const ganja = marketDataFromSnapshot(userSnapshot, 'AZ-GANJA', 'USD', { apifySnapshot });
  assert.deepEqual([ganja.budget.basis, ganja.budget.fallback], ['estimated-from-index', true], 'index came from the capital');
});

test('summary rows carry budget { single, family4, basis, fromCapital } for (almost) every city', () => {
  const s = marketSummaryFromSnapshots(userSnapshot, apifySnapshot, normative);
  assert.ok(validateMarketSummary(s));
  assert.equal(s.rows.filter((r) => r.budget?.basis === 'numbeo').length, 41);
  assert.ok(s.rows.filter((r) => r.budget).length >= 79);
  assert.equal(s.rows.find((r) => r.locationId === 'JP-TOKYO').budget.basis, 'estimated-from-index');
});

test('plausibility: >3× / <⅓ vs reference or rent > 20 000 → implausible; normal → ok', () => {
  const md = (v) => ({ rent: { items: { centre_1br: { average: v } } } });
  assert.equal(checkAgainstReference(md('1000'), md('900')).implausible, false);
  assert.equal(checkAgainstReference(md('3100'), md('1000')).implausible, true);
  assert.equal(checkAgainstReference(md('300'), md('1000')).implausible, true);
  assert.equal(checkAgainstReference(md('25000'), null).implausible, true);
  assert.equal(checkAgainstReference(md('1000'), null).implausible, false);
  const entry = { numbeoCity: 'Astana (Nur-Sultan)', numbeoCountry: 'Kazakhstan', countryCode: 'KZ', matchStatus: 'exact', verified: true };
  const kzt = normalizeApify({ locationId: 'KZ-ASTANA', currency: 'USD', entry, prices: { status: 'ok', items: flatPrices({ city: 'Astana', country: 'Kazakhstan', currency: 'USD', override: { '1 Bedroom Apartment in City Centre': 257586.25 } }) }, rankings: { status: 'not_found' }, fetchedAt: '2026-11-04T00:00:00Z' });
  assert.equal(kzt.utilities.status, 'invalid_response');
  assert.ok(kzt.warnings.some((w) => w.code === 'implausible_value'));
});
