// Pages Functions wrappers (functions/api/...) — called with a mocked Pages EventContext. SYNTHETIC data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as market from '../../functions/api/market/index.js';
import * as health from '../../functions/api/market/health.js';
import * as catchAll from '../../functions/api/[[path]].js';
import { validateMarketData } from '../../src/providers/market-contract.js';
import { createMarketClient } from '../../src/providers/index.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const ctx = (path, env = {}, init) => ({ request: new Request(`https://calc.pages.dev${path}`, init), env, params: {}, waitUntil() {}, next() {}, data: {} });
const json = async (r) => JSON.parse(await r.text());

test('health wrapper: Pages env without token → not_configured; rate limiter absent is fine', async () => {
  const r = await health.onRequest(ctx('/api/market/health', {}));
  assert.equal(r.status, 200);
  const b = await json(r);
  assert.deepEqual([b.status, b.tokenConfigured, b.rateLimiter, b.provider, b.cacheTtlDays], ['not_configured', false, false, 'apify', 30]);
});

test('health wrapper with secret + KV binding: configured, kv backend, token not echoed', async () => {
  const kv = { get: async () => null, put: async () => {} };
  const t = await (await health.onRequest(ctx('/api/market/health', { APIFY_TOKEN: 'synthetic-pages-secret', MARKET_CACHE: kv }))).text();
  assert.ok(!t.includes('synthetic-pages-secret'));
  assert.deepEqual([JSON.parse(t).status, JSON.parse(t).cacheBackend], ['configured', 'kv']);
});

test('market wrapper: no token → valid MarketData not_configured; bad params 400; POST 405; off → disabled', async () => {
  const md = await json(await market.onRequest(ctx('/api/market?location=AT-VIENNA&currency=EUR')));
  assert.ok(validateMarketData(md).ok);
  assert.equal(md.status, 'not_configured');
  assert.equal((await market.onRequest(ctx('/api/market?location=AT-VIENNA&currency=GBP'))).status, 400);
  assert.equal((await market.onRequest(ctx('/api/market?location=AT-VIENNA&currency=EUR', {}, { method: 'POST' }))).status, 405);
  const off = await json(await market.onRequest(ctx('/api/market?location=AT-VIENNA&currency=EUR', { MARKET_PROVIDER: 'off', APIFY_TOKEN: 'x' })));
  assert.equal(off.status, 'disabled');
});

test('catch-all: unknown /api/* → JSON 404 (not index.html)', async () => {
  const r = await catchAll.onRequest(ctx('/api/whatever'));
  assert.equal(r.status, 404);
  assert.equal((await json(r)).error.code, 'not_found');
});

test('static-only deploy (no Functions): client maps HTML 404 to not_configured', async () => {
  const c = createMarketClient({ fetchImpl: async () => new Response('<!doctype html>Not found', { status: 404 }) });
  assert.equal((await c.get('AT-VIENNA', 'EUR')).status, 'not_configured');
});

test('Pages build config: .node-version = 22; no root wrangler.jsonc (Workers config lives in wrangler.worker.jsonc)', () => {
  assert.equal(readFileSync(`${ROOT}.node-version`, 'utf8').trim(), '22');
  assert.ok(!existsSync(`${ROOT}wrangler.jsonc`) && !existsSync(`${ROOT}wrangler.toml`) && !existsSync(`${ROOT}wrangler.json`));
  assert.ok(existsSync(`${ROOT}wrangler.worker.jsonc`));
  const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8'));
  assert.match(pkg.scripts.deploy, /--config wrangler\.worker\.jsonc/);
});
