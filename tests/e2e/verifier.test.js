// Independent verifier's browser tests (Playwright). Expected amounts are hand-derived from order №01-82
// (see tests/fixtures/golden-cases.json); market data is SYNTHETIC. Run: npm run build && npm run test:e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { openOffline, startServer, openServed, marketBodyV2, hasHorizontalScroll, ROOT } from './helpers.js';
import { calculate } from '../../src/core/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/normative-data.json'), 'utf8'));
const XSS = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';

let browser, server;
const api = { mode: 'fresh', delayMs: 0, opts: {} };
before(async () => {
  browser = await chromium.launch();
  server = await startServer({
    api: async (u, req, res) => {
      if (u.pathname !== '/api/market') { res.writeHead(404); return res.end(); }
      const loc = u.searchParams.get('location'), cur = u.searchParams.get('currency');
      if (api.delayMs) await new Promise((r) => setTimeout(r, api.delayMs));
      const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
      switch (api.mode) {
        case 'network_error': return req.socket.destroy();
        case 'timeout': return undefined; // never answer
        case 'rate_limited': return json(429, { error: 'rate_limited' });
        case 'invalid_json': return json(200, '{"schemaVersion":2, "rent": ');
        default: return json(200, marketBodyV2(loc, { currency: cur, status: api.mode, ...api.opts }));
      }
    },
  });
});
after(async () => { await browser?.close(); await server?.close(); });

// ---------------------------------------------------------------- UI drivers
const search = (page) => page.getByRole('combobox', { name: 'ძიება (ქართულად ან ლათინურად)' });
const rentField = (page) => page.getByLabel('ბინის ყოველთვიური ქირა (G)', { exact: true });
const dv = (page, sel) => page.locator(sel).first().getAttribute('data-value');

/** Vienna, counsellor A2-R5 (65%), C = 0, rent G. Hand-derived: D 4150.9, T 871.689, F 1185.8445, S 4465.0555 -> 4465.06 */
async function viennaMin(page, rent = '1500') {
  await search(page).fill('Vienna');
  await page.keyboard.press('Enter');
  await page.getByLabel('თანამდებობა', { exact: true }).selectOption('A2-R5');
  if (rent !== null) await rentField(page).fill(rent);
  await page.waitForTimeout(100);
}
/** Golden T-MON-VIE-01/02: spouse + child, G 1500, education 1000 -> S 4985.16, remainder 3423.16 */
async function viennaFull(page) {
  await viennaMin(page, '1500');
  for (let i = 0; i < 2; i++) await page.getByTestId('add-family').click();
  const rows = page.locator('#sec-family fieldset.member');
  await rows.nth(0).getByLabel('როლი').selectOption('spouse');
  await rows.nth(0).getByLabel('ასაკი', { exact: true }).fill('38');
  await rows.nth(1).getByLabel('როლი').selectOption('child');
  await rows.nth(1).getByLabel('ასაკი', { exact: true }).fill('8');
  await page.getByRole('button', { name: '+ ბავშვის განათლების ხარჯი' }).click();
  await page.locator('[data-list="education"] fieldset').getByLabel('ბავშვი').selectOption({ index: 1 });
  await page.locator('[data-list="education"] fieldset').getByLabel('სწავლის საფასური (თვეში)').fill('1000');
  await page.waitForTimeout(150);
}
const results = async (page) => page.$$eval('#sec-results [data-value]', (els) => els.map((e) => `${e.closest('[data-component]')?.getAttribute('data-component') ?? e.getAttribute('data-testid') ?? '?'}=${e.getAttribute('data-value')}`));

// ---------------------------------------------------------------- offline
test('offline file:// with network blocked: golden Vienna amounts, no external requests, no errors', async () => {
  const h = await openOffline();
  try {
    await viennaFull(h.page);
    assert.equal(await dv(h.page, '[data-testid="S"]'), '4985.16');
    assert.equal(await dv(h.page, '.kcard[data-component="remainder"] .k-value'), '3423.16');
    assert.equal(await dv(h.page, '[data-component="education.total"] .row-value'), '938.00');
    await h.page.getByTestId('offline-note').waitFor();
    assert.deepEqual(h.blockedRequests, [], 'no external request attempted');
    assert.deepEqual(h.unexpectedConsoleErrors(), []);
    assert.deepEqual(h.pageErrors, []);
  } finally { await h.close(); }
});

// ---------------------------------------------------------------- market states (served over http)
const STATE_CASES = [
  ['fresh', 'fresh'], ['cached', 'cached'], ['stale', 'stale'], ['partial', 'partial'], ['not_found', 'not_found'],
  ['disabled', 'disabled'], ['network_error', 'network_error'], ['rate_limited', 'rate_limited'], ['invalid_json', 'invalid_response'],
];
for (const [mode, expected] of STATE_CASES) {
  test(`served: /api/market ${mode} -> state "${expected}", calculator keeps working`, async () => {
    Object.assign(api, { mode, delayMs: 0, opts: mode === 'partial' ? { missing: ['rent.centre_3br', 'utilities.internet', 'restaurants.midRangeForTwo'] } : {} });
    const s = await openServed(browser, server.origin);
    try {
      await viennaMin(s.page);
      await s.page.waitForTimeout(400);
      const statuses = await s.page.$$eval('.market [data-status]', (els) => els.map((e) => e.getAttribute('data-status')));
      assert.ok(statuses.includes(expected), `${mode}: statuses ${JSON.stringify(statuses)}`);
      const text = await s.page.locator('.market').innerText();
      assert.ok(text.trim().length > 0 && /[ა-ჰ]/.test(text), 'Georgian state text shown');
      const zeros = await s.page.$$eval('.market [data-value]', (els) => els.map((e) => e.getAttribute('data-value')).filter((v) => /^0+(\.0+)?$/.test(v)));
      assert.deepEqual(zeros, [], 'missing market values must be null/—, never 0');
      assert.equal(await dv(s.page, '[data-testid="S"]'), '4465.06', 'S independent of market state');
      assert.deepEqual(s.blockedRequests, []);
    } finally { await s.close(); }
  });
}

test('served: /api/market timeout -> "timeout" state after the client limit, calculator works meanwhile', { timeout: 40000 }, async () => {
  Object.assign(api, { mode: 'timeout', delayMs: 0, opts: {} });
  const s = await openServed(browser, server.origin, { fakeClock: true });
  try {
    await viennaMin(s.page);
    assert.equal(await dv(s.page, '[data-testid="S"]'), '4465.06', 'usable while waiting');
    await s.page.clock.runFor(130000); // past the client's 100 s / service 120 s limits
    await s.page.locator('.market [data-status="timeout"]').first().waitFor({ timeout: 10000 });
    assert.equal(await dv(s.page, '[data-testid="S"]'), '4465.06');
  } finally { await s.close(); }
});

test('served: market refresh never changes H/K/E/S or a typed rent; G changes only via the button', async () => {
  Object.assign(api, { mode: 'fresh', delayMs: 700, opts: { centre1: '1800.00' } });
  const s = await openServed(browser, server.origin);
  try {
    await viennaMin(s.page, '1500');
    const snap = async () => Promise.all(['H', 'K', 'E', 'D', 'T', 'F'].map((k) => dv(s.page, `.kcard[data-component="${k}"] .k-value, [data-component="${k}"] .row-value`))
      .concat([dv(s.page, '[data-testid="S"]'), rentField(s.page).inputValue()]));
    const before_ = await snap();
    await s.page.locator('.market [data-status="fresh"]').first().waitFor({ timeout: 5000 });
    assert.equal(await s.page.getByTestId('market-rent-average').getAttribute('data-value'), '1800.00');
    assert.deepEqual(await snap(), before_, 'market arrival changed nothing in the calculation');
    assert.equal(await rentField(s.page).inputValue(), '1500');
    await s.page.getByTestId('use-market-rent').click();
    await s.page.getByRole('button', { name: 'გაუქმება' }).click().catch(() => {});
    assert.equal(await rentField(s.page).inputValue(), '1500', 'cancel keeps the typed rent');
    await s.page.getByTestId('use-market-rent').click();
    await s.page.getByRole('button', { name: 'დიახ, ჩავანაცვლო' }).click();
    await s.page.waitForTimeout(150);
    assert.match(await rentField(s.page).inputValue(), /^1800(\.00)?$/);
    // G = 1800: F = 871.689 + 0.5 x 928.311 = 1335.8445; S = 4150.9 - 871.689 + 1335.8445 = 4615.0555
    assert.equal(await dv(s.page, '[data-testid="S"]'), '4615.06');
    assert.equal(await s.page.locator('[data-testid="market-scenario-note"]').count(), 1);
  } finally { await s.close(); }
});

test('privacy: /api/market requests carry only location & currency (no family/financial data)', async () => {
  Object.assign(api, { mode: 'fresh', delayMs: 0, opts: {} });
  const start = server.requests.length;
  const s = await openServed(browser, server.origin);
  try {
    await viennaFull(s.page);
    await s.page.waitForTimeout(300);
  } finally { await s.close(); }
  const reqs = server.requests.slice(start);
  const apiReqs = reqs.filter((r) => r.url.startsWith('/api/'));
  assert.ok(apiReqs.length >= 1, 'market requested');
  for (const r of apiReqs) {
    assert.equal(r.method, 'GET');
    assert.equal(r.body, '');
    const u = new URL(r.url, 'http://x');
    assert.deepEqual([...u.searchParams.keys()].sort(), ['currency', 'location'], r.url);
    assert.match(u.searchParams.get('location'), /^[A-Z]{2}-[A-Z0-9-]+$/);
    assert.ok(['EUR', 'USD'].includes(u.searchParams.get('currency')));
    for (const v of Object.values(r.headers)) assert.doesNotMatch(String(v), /1500|1000|\b38\b|ოჯახ/, 'header leak');
  }
  for (const r of reqs.filter((x) => !x.url.startsWith('/api/'))) assert.equal(r.method, 'GET');
});

// ---------------------------------------------------------------- comparison
test('comparison: 5 institutions max, EUR/USD never summed, each column equals calculate()', async () => {
  Object.assign(api, { mode: 'fresh', delayMs: 0, opts: {} });
  const s = await openServed(browser, server.origin);
  try {
    await viennaMin(s.page, '1500');
    await s.page.locator('[data-open-compare]').click();
    await s.page.getByRole('button', { name: 'მიმდინარე დაწესებულების დამატება' }).click();
    const others = [['M-A6-R4', '4000'], ['M-A6-R26', '2500'], ['M-A5-R44', '1800'], ['M-A6-R33', '3000']];
    for (const [id] of others) {
      await s.page.getByTestId('compare-select').selectOption(id);
      await s.page.getByTestId('compare-add').click();
    }
    const cols = s.page.locator('.ccol');
    assert.equal(await cols.count(), 5);
    assert.equal(await s.page.getByTestId('compare-add').isDisabled(), true, '6th add refused');
    await s.page.getByTestId('compare-select').selectOption('M-A5-R2').catch(() => {});
    await s.page.getByTestId('compare-add').click({ force: true }).catch(() => {});
    assert.equal(await cols.count(), 5, 'still 5 after forced 6th add');
    for (const [id, rent] of others) {
      const inp = s.page.locator(`[data-col="${id}"]`).getByTestId('compare-rent');
      await inp.fill(rent); await inp.press('Tab');
    }
    await s.page.waitForTimeout(300);
    // scenario actually used by the page, via JSON export
    const [dl] = await Promise.all([s.page.waitForEvent('download'), s.page.getByTestId('export-json').click()]);
    const doc = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    const expectFor = (missionId, rent) => calculate({ ...doc.scenario, missionId, rent: { ...doc.scenario.rent, amount: rent, changes: [] } }, DATA);
    const all = [['M-A5-R1', '1500'], ...others];
    const shown = [];
    for (const [id, rent] of all) {
      const col = s.page.locator(`[data-col="${id}"]`);
      const r = expectFor(id, rent);
      assert.equal(await col.getByTestId('compare-S').getAttribute('data-value'), r.monthly.S.value ?? '', `${id} S`);
      assert.ok((await col.innerText()).includes(r.currency), `${id} shows ${r.currency}`);
      if (r.monthly.S.exact) shown.push([r.currency, Number(r.monthly.S.exact)]);
    }
    assert.equal(await dv(s.page, '[data-col="M-A5-R1"] [data-testid="compare-S"]'), '4465.06', 'Vienna column = hand-derived value');
    assert.ok(new Set(shown.map((x) => x[0])).size === 2, 'mixed currencies present');
    const sumAll = shown.reduce((a, x) => a + x[1], 0).toFixed(2);
    const txt = (await s.page.locator('#sec-compare').innerText()).replace(/\s/g, '');
    assert.ok(!txt.includes(sumAll) && !txt.includes(sumAll.replace(/\B(?=(\d{3})+(?!\d))/g, ' ').replace(/\s/g, '')), 'no cross-currency total');
  } finally { await s.close(); }
});

// ---------------------------------------------------------------- XSS & import
test('XSS: payload in family label and imported scenario JSON is rendered as text only', async () => {
  const h = await openOffline();
  try {
    await h.page.evaluate(() => { window.__xss = 0; });
    await viennaFull(h.page);
    const [dl] = await Promise.all([h.page.waitForEvent('download'), h.page.getByTestId('export-json').click()]);
    const doc = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    doc.scenario.family[0].label = XSS;
    doc.scenario.family[1].label = `"><svg onload=window.__xss=3>`;
    if (doc.scenario.status?.actingHead201) doc.scenario.status.actingHead201.actRef = XSS;
    const f = path.join(os.tmpdir(), `xss-${process.pid}.json`);
    fs.writeFileSync(f, JSON.stringify(doc));
    await h.page.getByTestId('import-json').setInputFiles(f);
    await h.page.waitForTimeout(300);
    assert.equal(await h.page.evaluate(() => window.__xss), 0, 'payload executed');
    assert.ok((await h.page.locator('body').textContent()).includes('<img src=x onerror'), 'payload imported and shown as plain text');
    assert.equal(await h.page.locator('img[src="x"], svg[onload], script:not([type])').count() <= await h.page.locator('script:not([type])').count(), true);
    assert.equal(await h.page.locator('img[src="x"], svg[onload]').count(), 0, 'no injected elements');
    // wrong schema / unknown currency rejected, state kept
    for (const bad of [{ kind: 'rotation-scenario', schemaVersion: 99 }, { kind: 'other' }, { ...doc, scenario: { ...doc.scenario, missionId: 'M-XX-R1' } }]) {
      fs.writeFileSync(f, JSON.stringify(bad));
      await h.page.getByTestId('import-json').setInputFiles(f);
      await h.page.waitForTimeout(150);
      assert.match(await h.page.locator('.export-msg').innerText(), /უარყოფილია|შეცდომ|არ არის/, JSON.stringify(bad).slice(0, 60));
    }
    fs.writeFileSync(f, '{not json');
    await h.page.getByTestId('import-json').setInputFiles(f);
    await h.page.waitForTimeout(150);
    assert.equal(await h.page.evaluate(() => window.__xss), 0);
    fs.rmSync(f, { force: true });
  } finally { await h.close(); }
});

// ---------------------------------------------------------------- print and layout
test('screen vs print: same amounts (data-value) and the PDF text contains them', async () => {
  const h = await openOffline();
  try {
    await viennaFull(h.page);
    const screen = await results(h.page);
    await h.page.emulateMedia({ media: 'print' });
    await h.page.waitForTimeout(100);
    assert.deepEqual(await results(h.page), screen, 'print DOM uses same values');
    const visibleInPrint = await h.page.$$eval('#sec-results [data-value]', (els) => els.filter((e) => e.offsetParent !== null).map((e) => e.getAttribute('data-value')));
    for (const v of ['4985.16', '3423.16', '938.00']) assert.ok(visibleInPrint.includes(v), `${v} visible in print`);
    const pdf = path.join(os.tmpdir(), `print-${process.pid}.pdf`);
    await h.page.pdf({ path: pdf, format: 'A4' });
    let text = '';
    try {
      text = execFileSync('python3', ['-I', '-c', 'import sys,pypdfium2 as p\nd=p.PdfDocument(sys.argv[1])\nprint("".join(d[i].get_textpage().get_text_range() for i in range(len(d))))', pdf], { encoding: 'utf8' });
    } catch { /* pypdfium2 missing: DOM check above still applies */ }
    if (text) {
      const flat = text.replace(/\s/g, '');
      for (const v of ['4985.16', '3423.16', '938.00']) assert.ok(flat.includes(v), `PDF text contains ${v}`);
      assert.match(text, /[ა-ჰ]{4,}/, 'Georgian text extractable from PDF');
    }
    fs.rmSync(pdf, { force: true });
  } finally { await h.close(); }
});

test('375px: long mission name + 6 children, no horizontal scroll, mission name not clipped', async () => {
  const h = await openOffline({ viewport: { width: 375, height: 800 } });
  try {
    await search(h.page).fill('ESCAP');
    await h.page.keyboard.press('Enter');
    await h.page.getByLabel('თანამდებობა', { exact: true }).selectOption('A2-R6');
    for (let i = 0; i < 7; i++) await h.page.getByTestId('add-family').click();
    await rentField(h.page).fill('2000');
    await h.page.waitForTimeout(200);
    assert.equal(await h.page.locator('#sec-family fieldset.member').count(), 7);
    assert.equal(await hasHorizontalScroll(h.page), false, 'horizontal scroll at 375px');
    const clipped = await h.page.$$eval('body *', (els) => els.filter((e) => /ESCAP|ინდოეთ/.test(e.textContent || '') && e.children.length === 0
      && e.offsetParent !== null && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible').map((e) => e.tagName + '.' + e.className));
    assert.deepEqual(clipped, [], 'long name clipped');
    assert.match(await dv(h.page, '[data-testid="S"]'), /^\d+\.\d{2}$/);
  } finally { await h.close(); }
});

test('offline (file://) and served (http) give identical financial results', async () => {
  Object.assign(api, { mode: 'fresh', delayMs: 0, opts: {} });
  const h = await openOffline();
  const s = await openServed(browser, server.origin);
  try {
    await viennaFull(h.page); await viennaFull(s.page);
    const exact = (p) => p.$$eval('#sec-results [data-exact]', (els) => els.map((e) => e.getAttribute('data-exact')));
    assert.deepEqual(await results(s.page), await results(h.page));
    assert.deepEqual(await exact(s.page), await exact(h.page));
  } finally { await h.close(); await s.close(); }
});
