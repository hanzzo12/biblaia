// Monthly refresh (Cron Trigger) state machine — mocked Apify REST + KV + scheduled controller. SYNTHETIC data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../worker/index.js';
import { createWorker, cacheKey, RANKINGS_KEY } from '../../worker/market-worker.js';
import { REFRESH_STATE_KEY, buildBatches } from '../../worker/refresh.js';
import { validateMarketData } from '../../src/providers/market-contract.js';
import { SYNTHETIC_NAMES, flatPrices, rankingsRows, FAKE_TOKEN } from '../providers/fixtures/apify-synthetic.js';

const T0 = Date.parse('2026-11-04T10:00:00Z');
const MIN15 = 15 * 60000; const DAY = 86400000;
const LOC_CUR = { 'AT-VIENNA': ['EUR'], 'VA-VATICAN-CITY': ['EUR'], 'US-NEW-YORK': ['USD'], 'TR-TRABZON': ['USD'] };
const DATASETS = {
  'ds-city_prices-USD-unv': [],
  'ds-city_prices-EUR': [...flatPrices({ city: 'Vienna' }), ...flatPrices({ city: 'Rome', country: 'Italy' })],
  'ds-city_prices-USD': flatPrices({ city: 'New York', country: 'United States', currency: 'USD' }), // Trabzon: no rows
  'ds-rankings-': rankingsRows(),
};

function mkKv(clock) {
  const m = new Map(); const writes = [];
  return { m, writes, async get(k, t) { const e = m.get(k); if (!e || clock.t > e.until) return null; return t === 'json' ? JSON.parse(e.v) : e.v; }, async put(k, v, o) { writes.push(k); m.set(k, { v, until: clock.t + o.expirationTtl * 1000 }); } };
}
function mockApifyRest({ startStatus = 201, pollsUntilDone = 1, finalStatus = {} } = {}) {
  const calls = []; const polls = {};
  const fn = async (url, init = {}) => {
    const u = new URL(url); calls.push({ method: init.method || 'GET', path: u.pathname, auth: init.headers?.Authorization, url: String(url), body: init.body ? JSON.parse(init.body) : null });
    const res = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
    if (u.pathname.endsWith('/runs') && init.method === 'POST') {
      if (startStatus !== 201) return res({ error: { type: 'x' } }, startStatus);
      const input = JSON.parse(init.body); const id = `${input.mode}-${input.currency ?? ''}`;
      return res({ data: { id: `run-${id}`, defaultDatasetId: `ds-${id}`, status: 'READY' } }, 201);
    }
    const run = /\/actor-runs\/(.+)$/.exec(u.pathname);
    if (run) { polls[run[1]] = (polls[run[1]] || 0) + 1; return res({ data: { status: polls[run[1]] > pollsUntilDone ? (finalStatus[run[1]] || 'SUCCEEDED') : 'RUNNING' } }); }
    const ds = /\/datasets\/(.+)\/items$/.exec(u.pathname);
    if (ds) { const all = DATASETS[decodeURIComponent(ds[1])] || []; const o = +u.searchParams.get('offset'); const l = +u.searchParams.get('limit'); return res(all.slice(o, o + l)); }
    return res({}, 404);
  };
  fn.calls = calls;
  return fn;
}
function setup(opts = {}, env = {}) {
  const clock = { t: T0 }; const kv = mkKv(clock); const f = mockApifyRest(opts);
  const w = createWorker({ names: SYNTHETIC_NAMES, snapshot: null, apifySnapshot: null, locationCurrencies: LOC_CUR, fetchImpl: f, now: () => clock.t, log: () => {} });
  const e = { MARKET_CACHE: kv, APIFY_TOKEN: FAKE_TOKEN, MARKET_PROVIDER: 'apify', MARKET_REFRESH_PAGE_ROWS: '10', MARKET_FIRST_REFRESH_AFTER: '2026-01-01', ...env };
  const tick = () => w.scheduled({ cron: '*/15 * * * *', scheduledTime: clock.t }, e, { waitUntil() {} });
  const state = async () => JSON.parse(kv.m.get(REFRESH_STATE_KEY)?.v || 'null');
  return { w, kv, clock, f, env: e, tick, state };
}

test('default export exposes scheduled() (cron) and fetch()', () => {
  assert.equal(typeof worker.scheduled, 'function');
  assert.equal(typeof worker.fetch, 'function');
});

test('batches follow mission funding currency and use actor-input city names', () => {
  const b = buildBatches(SYNTHETIC_NAMES, LOC_CUR, ['EUR', 'USD']);
  assert.deepEqual(b.EUR.cities, ['Vienna', 'Rome']);
  assert.deepEqual(b.USD.cities, ['New York'], 'only apifyVerified cities in the main batch');
  assert.deepEqual(b.unverified.USD.cities, ['Trabzon'], 'unverified city goes to a separate small run');
  const names = { locations: { ...SYNTHETIC_NAMES.locations, 'US-NEW-YORK': { ...SYNTHETIC_NAMES.locations['US-NEW-YORK'], apifyExclude: 'x' } } };
  const b2 = buildBatches(names, LOC_CUR, ['EUR', 'USD']);
  assert.equal(b2.USD, undefined, 'apifyExclude never sent');
});

test('real name map: 77 verified, Donetsk/Krakow/Vatican excluded, Ganja → "Gence"', async () => {
  const real = (await import('../../src/providers/numbeo-city-names.json', { with: { type: 'json' } })).default;
  const v = Object.values(real.locations).filter((e) => e.apifyVerified).length;
  assert.equal(v, 77);
  for (const id of ['UA-DONETSK', 'PL-KRAKOW', 'VA-VATICAN-CITY']) assert.ok(real.locations[id].apifyExclude, id);
  assert.equal(real.locations['AZ-GANJA'].pricesQuery, 'Gence');
});

test('full cycle: start → poll → rankings page → city pages (with carry) → KV entries → idle with summary', async () => {
  const s = setup();
  let r = await s.tick();
  assert.equal(r.action, 'started');
  const starts = s.f.calls.filter((c) => c.method === 'POST');
  assert.equal(starts.length, 4);
  assert.deepEqual(starts.map((c) => c.body.mode), ['city_prices', 'city_prices', 'rankings', 'city_prices'], 'unverified run last');
  assert.deepEqual(starts[3].body.cities, ['Trabzon']);
  assert.deepEqual(starts.find((c) => c.body.mode === 'rankings').body, { mode: 'rankings', maxCities: 0 });
  for (const c of s.f.calls) { assert.equal(c.auth, `Bearer ${FAKE_TOKEN}`); assert.ok(!c.url.includes(FAKE_TOKEN)); }
  let n = 0;
  do { s.clock.t += MIN15; r = await s.tick(); n++; } while (r.action !== 'finished' && n < 40);
  assert.equal(r.action, 'finished');
  const st = await s.state();
  assert.equal(st.phase, 'idle');
  assert.equal(st.nextRefreshAt, s.clock.t + 30 * DAY);
  assert.deepEqual(st.summary.citiesEmpty, ['TR-TRABZON:USD'], 'empty city not written (no fake data)');
  assert.equal(st.summary.citiesWritten, 3);
  assert.ok(st.summary.costEstimateUsd > 0);
  assert.ok(!s.kv.m.has(cacheKey('TR-TRABZON', 'USD')));
  for (const [loc, cur] of [['AT-VIENNA', 'EUR'], ['VA-VATICAN-CITY', 'EUR'], ['US-NEW-YORK', 'USD']]) {
    const e = JSON.parse(s.kv.m.get(cacheKey(loc, cur)).v);
    assert.ok(validateMarketData(e.data).ok, `${loc}: ${validateMarketData(e.data).errors.join()}`);
    assert.ok(e.expiresAt > s.clock.t);
  }
  assert.equal(JSON.parse(s.kv.m.get(cacheKey('AT-VIENNA', 'EUR')).v).data.indices.costOfLiving, '65.4', 'indices from rankings run');
  assert.ok(JSON.parse(s.kv.m.get(RANKINGS_KEY).v).items.length <= 4, 'only relevant rankings rows kept');
  // fetch path serves the cron-written entry (cache hit), no Apify call from user traffic
  const before = s.f.calls.length;
  const md = JSON.parse(await (await s.w.fetch(new Request('https://x/api/market?location=AT-VIENNA&currency=EUR'), s.env)).text());
  assert.deepEqual([md.cache.state, md.rent.items.centre_1br.average], ['hit', '1234.56']);
  assert.equal(s.f.calls.length, before);
  const h = JSON.parse(await (await s.w.fetch(new Request('https://x/api/market/health'), s.env)).text());
  assert.equal(h.refresh.state, 'idle');
  assert.equal(h.refresh.populatedCities, 3);
  assert.equal(h.refresh.lastErrorCode, null);
  assert.equal(h.onDemand, false);
  assert.ok(!JSON.stringify(h).includes(FAKE_TOKEN));
  // next tick: nothing due → no KV writes
  const w0 = s.kv.writes.length; s.clock.t += MIN15;
  assert.equal((await s.tick()).action, 'wait');
  assert.equal(s.kv.writes.length, w0);
});

test('402 on start → backoff 1 day, no retries until then', async () => {
  const s = setup({ startStatus: 402 });
  assert.equal((await s.tick()).action, 'start_failed');
  let st = await s.state();
  assert.equal(st.lastError.code, 'payment_required');
  assert.equal(st.phase, 'idle');
  const posts = () => s.f.calls.filter((c) => c.method === 'POST').length;
  assert.equal(posts(), 1);
  for (let i = 0; i < 10; i++) { s.clock.t += MIN15; assert.equal((await s.tick()).action, 'wait'); }
  assert.equal(posts(), 1);
  s.clock.t = T0 + DAY + 1;
  await s.tick();
  assert.equal(posts(), 2);
  st = await s.state();
  const h = JSON.parse(await (await s.w.fetch(new Request('https://x/api/market/health'), s.env)).text());
  assert.equal(h.refresh.lastErrorCode, 'payment_required');
});

test('overlapping ticks: a held lock makes the second tick a no-op', async () => {
  const s = setup();
  await s.tick();
  const st = await s.state();
  st.lockUntil = s.clock.t + 5 * 60000;
  await s.kv.put(REFRESH_STATE_KEY, JSON.stringify(st), { expirationTtl: 86400 });
  const calls = s.f.calls.length;
  assert.equal((await s.tick()).action, 'locked');
  assert.equal(s.f.calls.length, calls);
});

test('no token → not_configured recorded once per day, no Apify calls', async () => {
  const s = setup({}, { APIFY_TOKEN: '' });
  assert.equal((await s.tick()).action, 'not_configured');
  s.clock.t += MIN15;
  assert.equal((await s.tick()).action, 'wait');
  assert.equal(s.f.calls.length, 0);
});

test('MARKET_FIRST_REFRESH_AFTER (default 2026-12-01): no Apify call before that date', async () => {
  const s = setup({}, { MARKET_FIRST_REFRESH_AFTER: undefined });
  delete s.env.MARKET_FIRST_REFRESH_AFTER;
  assert.equal((await s.tick()).action, 'wait');
  assert.equal(s.f.calls.length, 0);
  s.clock.t = Date.parse('2026-12-01T00:15:00Z');
  assert.equal((await s.tick()).action, 'started');
  const h = JSON.parse(await (await s.w.fetch(new Request('https://x/api/market/health'), s.env)).text());
  assert.equal(h.refresh.firstRefreshAfter, '2026-12-01T00:00:00Z');
});

test('a FAILED batch (actor stops at a missing city) still ingests the rows it returned', async () => {
  const s = setup({ finalStatus: { 'run-city_prices-EUR': 'FAILED' } });
  await s.tick();
  let r; let n = 0;
  do { s.clock.t += MIN15; r = await s.tick(); n++; } while (r.action !== 'finished' && n < 40);
  const st = await s.state();
  assert.ok(st.summary.failedRuns.some((x) => x.startsWith('city_prices:EUR:FAILED')));
  assert.ok(s.kv.m.has(cacheKey('AT-VIENNA', 'EUR')), 'rows returned before the failure are kept');
});
