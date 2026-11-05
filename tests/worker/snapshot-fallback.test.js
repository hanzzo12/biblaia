// Worker serving order (MARKET_ON_DEMAND=false): KV fresh → KV stale → snapshot → capital → pending_refresh. SYNTHETIC KV data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import snapshot from '../../src/data/market-snapshot.json' with { type: 'json' };
import { createWorker, cacheKey } from '../../worker/market-worker.js';
import { validateMarketData } from '../../src/providers/market-contract.js';
import { normalizeApify } from '../../src/providers/apify-numbeo-adapter.js';
import { SYNTHETIC_NAMES, flatPrices, rankingsRows } from '../providers/fixtures/apify-synthetic.js';

const DAY = 86400000;
const T0 = Date.parse('2026-11-04T10:00:00Z');
const body = async (r) => JSON.parse(await r.text());
function mkKv(clock) { const m = new Map(); return { m, async get(k, t) { const e = m.get(k); if (!e || clock.t > e.until) return null; return t === 'json' ? JSON.parse(e.v) : e.v; }, async put(k, v, o) { m.set(k, { v, until: clock.t + o.expirationTtl * 1000 }); } }; }
function setup({ snap = snapshot, apify = null, env = {} } = {}) {
  const clock = { t: T0 }; const kv = mkKv(clock); let calls = 0;
  const w = createWorker({ snapshot: snap, apifySnapshot: apify, fetchImpl: async () => { calls++; return new Response('[]', { status: 201 }); }, now: () => clock.t, log: () => {} });
  const e = { MARKET_CACHE: kv, APIFY_TOKEN: 'synthetic', ...env };
  return { w, kv, clock, env: e, calls: () => calls, get: async (loc, cur) => body(await w.fetch(new Request(`https://x/api/market?location=${loc}&currency=${cur}`), e)) };
}
const kvEntry = (loc, cur, storedAt, ttlDays = 30) => ({ storedAt, expiresAt: storedAt + ttlDays * DAY, data: normalizeApify({ locationId: loc, currency: cur, entry: SYNTHETIC_NAMES.locations['AT-VIENNA'], prices: { status: 'ok', items: flatPrices({ currency: cur }) }, rankings: { status: 'ok', items: rankingsRows() }, fetchedAt: new Date(storedAt).toISOString().replace(/\.\d{3}Z$/, 'Z') }) });

test('no KV entry → snapshot (EUR converted), no Apify call by default', async () => {
  const s = setup();
  const md = await s.get('AT-VIENNA', 'EUR');
  assert.ok(validateMarketData(md).ok);
  assert.deepEqual([md.status, md.cache.state, md.currency], ['cached', 'snapshot', 'EUR']);
  assert.equal(md.rent.items.centre_1br.average, '1182.88');
  assert.equal(s.calls(), 0);
});

test('KV fresh beats snapshot; budget merged from the snapshot', async () => {
  const s = setup();
  await s.kv.put(cacheKey('AT-VIENNA', 'EUR'), JSON.stringify(kvEntry('AT-VIENNA', 'EUR', T0 - DAY)), { expirationTtl: 400 * 86400 });
  const md = await s.get('AT-VIENNA', 'EUR');
  assert.ok(validateMarketData(md).ok, validateMarketData(md).errors.join());
  assert.equal(md.cache.state, 'hit');
  assert.equal(md.rent.items.centre_1br.average, '1234.56', 'synthetic KV value, not snapshot');
  assert.equal(md.budget.source, 'snapshot');
  assert.equal(md.budget.single.average, '1026.11');
  assert.ok(md.warnings.some((w) => w.code === 'snapshot_copy'));
});

test('KV expired (stale window) beats snapshot and is labelled stale', async () => {
  const s = setup();
  await s.kv.put(cacheKey('AT-VIENNA', 'EUR'), JSON.stringify(kvEntry('AT-VIENNA', 'EUR', T0 - 40 * DAY)), { expirationTtl: 400 * 86400 });
  const md = await s.get('AT-VIENNA', 'EUR');
  assert.ok(validateMarketData(md).ok, validateMarketData(md).errors.join());
  assert.deepEqual([md.status, md.cache.state], ['stale', 'stale']);
  assert.equal(md.rent.items.centre_1br.average, '1234.56');
});

test('city absent from snapshot and KV → capital fallback (Vatican → Rome)', async () => {
  const md = await setup().get('VA-VATICAN-CITY', 'EUR');
  assert.ok(validateMarketData(md).ok);
  assert.equal(md.resolvedLocation.matchStatus, 'capital-fallback');
  assert.equal(md.resolvedLocation.fallbackFrom.locationId, 'IT-ROME');
});

test('nothing anywhere → pending_refresh, no Apify call; on-demand=true would call Apify', async () => {
  const s = setup({ snap: null });
  const md = await s.get('AZ-GANJA', 'USD');
  assert.ok(validateMarketData(md).ok);
  assert.equal(md.status, 'pending_refresh');
  assert.equal(s.calls(), 0);
  const s2 = setup({ snap: null, env: { MARKET_ON_DEMAND: 'true', MARKET_UPSTREAM_TIMEOUT_MS: '50' } });
  await s2.get('AZ-GANJA', 'USD');
  assert.ok(s2.calls() > 0);
});

test('capital data from KV is used for fallback too', async () => {
  const s = setup({ snap: null });
  await s.kv.put(cacheKey('AZ-BAKU', 'USD'), JSON.stringify(kvEntry('AZ-BAKU', 'USD', T0)), { expirationTtl: 400 * 86400 });
  const md = await s.get('AZ-GANJA', 'USD');
  assert.ok(validateMarketData(md).ok, validateMarketData(md).errors.join());
  assert.equal(md.resolvedLocation.matchStatus, 'capital-fallback');
  assert.equal(md.rent.items.centre_1br.average, '1234.56');
});

test('KV beats the Apify snapshot, which beats the user snapshot', async () => {
  const apify = (await import('../../src/data/market-apify-snapshot.json', { with: { type: 'json' } })).default;
  const s = setup({ apify });
  let md = await s.get('AT-VIENNA', 'EUR');
  assert.equal(md.warnings.find((w) => w.code === 'snapshot_copy').message_ka, 'შენახული მონაცემი · 04.11.2026');
  assert.equal(md.budget.source, 'snapshot');
  await s.kv.put(cacheKey('AT-VIENNA', 'EUR'), JSON.stringify(kvEntry('AT-VIENNA', 'EUR', T0)), { expirationTtl: 400 * 86400 });
  md = await s.get('AT-VIENNA', 'EUR');
  assert.deepEqual([md.cache.state, md.rent.items.centre_1br.average], ['hit', '1234.56']);
});
