// E2E harness (Playwright). Opens the single-file build via file:// with ALL network blocked,
// records every attempted non-file request and collects console/page errors.
// Usage (node:test):
//   import { openOffline } from './helpers.js';
//   const h = await openOffline();          // or openOffline({ file: 'dist/other.html' })
//   ... h.page ...
//   assert.deepEqual(h.blockedRequests, []); assert.deepEqual(h.consoleErrors, []);
//   await h.close();
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_FILE = path.join(ROOT, 'dist', 'rotation-calculator.html');

/**
 * @param {object} [opts]
 * @param {string} [opts.file]      HTML file to open (default dist/rotation-calculator.html)
 * @param {boolean} [opts.offline]  also set the context offline (default true)
 * @param {{width:number,height:number}} [opts.viewport]
 * @param {(route, request) => (Promise<boolean>|boolean)} [opts.onRequest]
 *        optional hook for mocked endpoints; return true if it handled (fulfilled) the route
 */
export async function openOffline(opts = {}) {
  const file = path.resolve(ROOT, opts.file || DEFAULT_FILE);
  if (!fs.existsSync(file)) throw new Error(`build output not found: ${file} (run npm run build)`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 900 } });
  if (opts.offline !== false) await context.setOffline(true);

  const blockedRequests = [];
  const consoleErrors = [];
  const pageErrors = [];
  const dialogs = [];

  await context.route('**/*', async (route, request) => {
    const url = request.url();
    if (url.startsWith('file:') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    if (opts.onRequest && (await opts.onRequest(route, request))) return undefined;
    blockedRequests.push({ url, method: request.method(), resourceType: request.resourceType() });
    return route.abort('blockedbyclient');
  });
  // WebSocket / EventSource attempts are recorded too
  context.on('request', (req) => {
    const u = req.url();
    if (/^wss?:/.test(u)) blockedRequests.push({ url: u, method: 'WS', resourceType: 'websocket' });
  });

  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err && err.stack ? err.stack : err)));
  page.on('dialog', async (d) => {
    dialogs.push({ type: d.type(), message: d.message() });
    await d.dismiss();
  });

  await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });

  return {
    browser, context, page, file,
    blockedRequests, consoleErrors, pageErrors, dialogs,
    /** console errors caused only by our own network blocking are expected noise; filter them */
    unexpectedConsoleErrors() {
      return consoleErrors.filter((t) => !/ERR_BLOCKED_BY_CLIENT|ERR_INTERNET_DISCONNECTED|net::ERR_FAILED/.test(t));
    },
    async close() {
      await context.close();
      await browser.close();
    },
  };
}

/** Text content of an element, trimmed; null if absent. */
export async function textOf(page, selector) {
  const el = await page.$(selector);
  return el ? (await el.textContent()).trim() : null;
}

/** Elements whose content overflows horizontally (clipped Georgian text detection). */
export async function overflowingElements(page, selector = 'body *') {
  return page.$$eval(selector, (els) => els
    .filter((e) => e.offsetParent !== null && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible')
    .map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${[...e.classList].join('.')}`));
}

/** True if the page scrolls horizontally. */
export async function hasHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

// ------------------------------------------------------------------ served (online) mode
import http from 'node:http';

/**
 * Tiny static server for dist/web + a mockable /api/market.
 * @param {{ api?: (url: URL, req: http.IncomingMessage, res: http.ServerResponse) => any }} [opts]
 * Every request is recorded in `requests` (method, url, headers, body) for privacy assertions.
 */
export async function startServer(opts = {}) {
  const webRoot = path.join(ROOT, 'dist', 'web');
  const requests = [];
  let api = opts.api || ((u, req, res) => { res.writeHead(503, { 'content-type': 'application/json' }); res.end('{}'); });
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      const u = new URL(req.url, 'http://localhost');
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (u.pathname.startsWith('/api/')) return api(u, req, res);
      const rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname.slice(1));
      const file = path.join(webRoot, rel);
      if (!file.startsWith(webRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream';
      res.writeHead(200, { 'content-type': type });
      fs.createReadStream(file).pipe(res);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, requests,
    setApi(fn) { api = fn; },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

/** Open the served build; every request outside `origin` is aborted and recorded. */
export async function openServed(browser, origin, { viewport } = {}) {
  const context = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 } });
  const blockedRequests = [], consoleErrors = [];
  await context.route('**/*', (route, request) => {
    const u = request.url();
    if (u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    blockedRequests.push(u);
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto(origin + '/', { waitUntil: 'load' });
  return { context, page, blockedRequests, consoleErrors, close: () => context.close() };
}

/** Synthetic MarketData body (contract src/providers/market-contract.js). SYNTHETIC values only. */
export function marketBody(loc, { currency = 'EUR', rentStatus = 'fresh', indexStatus = 'fresh', average = '1700', city = 'Synthetic', resolvedLoc = null, noRent = false, noIndex = false } = {}) {
  const withValue = ['fresh', 'cached', 'stale', 'manual', 'partial'];
  const rentItem = { metric: 'centre_1br', bedrooms: 1, area: 'centre', average: withValue.includes(rentStatus) ? average : null, low: null, high: null, dataPoints: withValue.includes(rentStatus) ? 20 : null, status: rentStatus, origin: 'provider', sourceUpdatedAt: '2026-09', fetchedAt: '2026-10-29T10:00:00Z' };
  const hasIdx = withValue.includes(indexStatus);
  return {
    schemaVersion: 1, requestedLocationId: loc,
    resolvedLocation: { city, countryCode: (resolvedLoc || loc).slice(0, 2), providerCityId: '900001', matchStatus: 'exact', ...(resolvedLoc ? { locationId: resolvedLoc } : {}) },
    provider: { id: 'synthetic', name: 'Synthetic test provider', sourceUrl: 'https://example.org/', attribution: 'synthetic' },
    currency,
    rent: noRent ? { status: 'not_found', items: {} } : { status: rentStatus, items: { centre_1br: rentItem } },
    indices: noIndex
      ? { costOfLivingExcludingRent: null, rentIndex: null, costOfLivingPlusRent: null, baseline: null, status: 'not_found', origin: 'provider', sourceUpdatedAt: null, fetchedAt: null }
      : { costOfLivingExcludingRent: hasIdx ? '61.2' : null, rentIndex: hasIdx ? '30.4' : null, costOfLivingPlusRent: hasIdx ? '47.0' : null, baseline: hasIdx ? { label: 'New York City', value: '100' } : null, status: indexStatus, origin: 'provider', sourceUpdatedAt: hasIdx ? '2026-09' : null, fetchedAt: hasIdx ? '2026-10-29T10:00:00Z' : null },
    cache: { state: rentStatus === 'cached' ? 'hit' : rentStatus === 'stale' ? 'stale' : 'miss', expiresAt: null },
    warnings: [{ code: 'synthetic_test_data' }],
  };
}
