// „ქალაქების სიძვირე“: GET /api/market/summary + marketSummaryFromSnapshots + client.summary(). SYNTHETIC KV data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import userSnapshot from '../../src/data/market-snapshot.json' with { type: 'json' };
import apifySnapshot from '../../src/data/market-apify-snapshot.json' with { type: 'json' };
import normative from '../../src/data/normative-data.json' with { type: 'json' };
import { createWorker, cacheKey, SUMMARY_KEY } from '../../worker/market-worker.js';
import { marketSummaryFromSnapshots, validateMarketSummary, createMarketClient } from '../../src/providers/index.js';
import { normalizeApify } from '../../src/providers/apify-numbeo-adapter.js';
import { SYNTHETIC_NAMES, flatPrices, rankingsRows } from '../providers/fixtures/apify-synthetic.js';

const T0 = Date.parse('2026-11-05T10:00:00Z');
function mkKv(clock) { const m = new Map(); let gets = 0; return { m, gets: () => gets, async get(k, t) { gets++; const e = m.get(k); if (!e || clock.t > e.until) return null; return t === 'json' ? JSON.parse(e.v) : e.v; }, async put(k, v, o) { m.set(k, { v, until: clock.t + o.expirationTtl * 1000 }); } }; }
function setup() {
  const clock = { t: T0 }; const kv = mkKv(clock); let apify = 0;
  const w = createWorker({ fetchImpl: async () => { apify++; return new Response('[]', { status: 201 }); }, now: () => clock.t, log: () => {} });
  const env = { MARKET_CACHE: kv, APIFY_TOKEN: 'synthetic' };
  return { w, kv, clock, env, apify: () => apify, get: async (q = '?v=1') => { const r = await w.fetch(new Request(`https://x/api/market/summary${q}`), env); return { status: r.status, body: JSON.parse(await r.text()) }; } };
}
const row = (s, id) => s.rows.find((r) => r.locationId === id);

test('client-side summary from both snapshots: all 80 mission cities, mission currency, source + date + fallback', () => {
  const s = marketSummaryFromSnapshots(userSnapshot, apifySnapshot, normative);
  assert.ok(validateMarketSummary(s));
  assert.equal(s.rows.length, new Set(normative.missions.map((m) => m.locationId)).size);
  assert.deepEqual(row(s, 'AT-VIENNA'), { locationId: 'AT-VIENNA', city_ka: 'ვენა', country_ka: 'ავსტრია', currency: 'EUR', indices: row(s, 'AT-VIENNA').indices, rentCentre1br: '1182.88', source: 'apify-snapshot', sourceDate: '2026-11-04' });
  assert.equal(row(s, 'PL-KRAKOW').source, 'user-snapshot');
  assert.equal(row(s, 'PL-KRAKOW').sourceDate, '2026-10-31');
  assert.equal(row(s, 'UA-DONETSK').source, 'capital');
  assert.equal(row(s, 'UA-DONETSK').fallbackFrom.locationId, 'UA-KYIV');
  assert.equal(row(s, 'VA-VATICAN-CITY').fallbackFrom.locationId, 'IT-ROME');
  assert.ok(s.rows.every((r) => r.source !== null), 'every mission city has data');
  const noApify = marketSummaryFromSnapshots(userSnapshot, null, normative);
  assert.equal(row(noApify, 'AT-VIENNA').source, 'user-snapshot');
  assert.equal(row(noApify, 'AT-VIENNA').currency, 'EUR');
});

test('Worker summary: KV beats snapshots, cached 12 h in KV, no Apify call, only ?v=1 accepted', async () => {
  const s = setup();
  const e = { storedAt: T0 - 86400000, expiresAt: T0 + 29 * 86400000, data: normalizeApify({ locationId: 'AT-VIENNA', currency: 'EUR', entry: SYNTHETIC_NAMES.locations['AT-VIENNA'], prices: { status: 'ok', items: flatPrices() }, rankings: { status: 'ok', items: rankingsRows() }, fetchedAt: '2026-11-04T10:00:00Z' }) };
  await s.kv.put(cacheKey('AT-VIENNA', 'EUR'), JSON.stringify(e), { expirationTtl: 400 * 86400 });
  let r = await s.get();
  assert.equal(r.status, 200);
  assert.ok(validateMarketSummary(r.body));
  assert.deepEqual([row(r.body, 'AT-VIENNA').source, row(r.body, 'AT-VIENNA').rentCentre1br, row(r.body, 'AT-VIENNA').sourceDate], ['kv', '1234.56', '2026-11-04']);
  assert.equal(row(r.body, 'DE-BERLIN').source, 'apify-snapshot');
  assert.ok(s.kv.m.has(SUMMARY_KEY));
  const gets = s.kv.gets();
  r = await s.get('');
  assert.equal(s.kv.gets(), gets + 1, 'second request served from summary:v1 (one KV read)');
  assert.equal(s.apify(), 0);
  assert.equal((await s.get('?v=2')).status, 400);
  assert.equal((await s.get('?v=1&x=1')).status, 400);
  s.clock.t += 13 * 3600000;
  await s.get();
  assert.ok(s.kv.gets() > gets + 2, 'rebuilt after 12 h');
});

test('cron finish invalidates the summary cache', async () => {
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../../worker/market-worker.js', import.meta.url), 'utf8'));
  assert.match(src, /r\.action === 'finished'\) await storeFor\(env\)\.put\(SUMMARY_KEY, \{ storedAt: now\(\), expiresAt: 0/);
});

test('client.summary(): valid body → object; HTTP error / bad body / network → null (never throws)', async () => {
  const good = marketSummaryFromSnapshots(userSnapshot, apifySnapshot, normative);
  let seen;
  const ok = createMarketClient({ fetchImpl: async (u) => { seen = u; return new Response(JSON.stringify(good)); } });
  assert.equal((await ok.summary()).rows.length, good.rows.length);
  assert.equal(seen, '/api/market/summary?v=1');
  assert.equal(await createMarketClient({ fetchImpl: async () => new Response('x', { status: 500 }) }).summary(), null);
  assert.equal(await createMarketClient({ fetchImpl: async () => new Response('{"schemaVersion":1,"rows":[{"locationId":"A"}]}') }).summary(), null);
  assert.equal(await createMarketClient({ fetchImpl: async () => { throw new TypeError('x'); } }).summary(), null);
});
