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
