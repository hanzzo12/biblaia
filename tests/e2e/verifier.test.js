// Independent verifier's browser tests for the 4-step UI (round 2). Expected amounts are hand-derived from
// order №01-82 (tests/fixtures/golden-cases.json); market data is SYNTHETIC. Run: npm run build && npm run test:e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { openOffline, startServer, openServed, marketBodyV2, hasHorizontalScroll, ROOT } from './helpers.js';
import { calculate, emptyScenario, emptyFamilyMember } from '../../src/core/index.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/normative-data.json'), 'utf8'));
const TMP = path.join(ROOT, '.shots');
fs.mkdirSync(TMP, { recursive: true });
const UNAVAILABLE = 'ფასები ამჟამად მიუწვდომელია';

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
        case 'timeout': return undefined; // never answers
        case 'rate_limited': return json(429, { error: 'rate_limited' });
        case 'invalid_json': return json(200, '{"schemaVersion":2, "rent": ');
        default: return json(200, marketBodyV2(loc, { currency: cur, status: api.mode, ...api.opts }));
      }
    },
  });
});
after(async () => { await browser?.close(); await server?.close(); });

// ---------------------------------------------------------------- wizard driver
const dv = (page, sel) => page.locator(sel).first().getAttribute('data-value');
const cardVal = (page, id) => dv(page, `[data-testid="${id}"] [data-value]`);
const remainder = (page) => dv(page, '[data-testid="hero-remainder"]');
const RESULT_SEL = '[data-testid="S"], [data-testid="hero-remainder"], .rcard [data-value]';

async function stepMission(page, query = 'Vienna') {
  await page.getByTestId('mission').fill(query);
  await page.getByTestId('mission').press('Enter');
  await page.getByTestId('next').click();
}
/** step 2: Annex 2 position card (radio), head off, family [{role, age}], optional own age */
async function stepPosition(page, { entry = 'A2-R5', family = [['spouse', '38'], ['child', '8']], age = null } = {}) {
  await page.getByTestId(`pos-${entry}`).check({ force: true });
  if (age != null) await page.getByLabel('თქვენი ასაკი', { exact: true }).fill(age);
  if (await page.getByTestId('head').isChecked()) await page.getByTestId('head').uncheck();
  for (const [role, age] of family) {
    await page.getByTestId('add-family').click();
    const row = page.locator('.fam-row').last();
    await row.locator('select').selectOption(role);
    await row.locator('input').fill(age);
  }
  await page.getByTestId('next').click();
}
async function stepCosts(page, { rent = '1500', edu = '1000' } = {}) {
  if (rent !== null) await page.getByTestId('rent').fill(rent);
  if (edu !== null && await page.getByTestId('edu').count()) await page.getByTestId('edu').first().fill(edu);
  await page.getByTestId('next').click();
  await page.getByTestId('hero-remainder').waitFor();
}
/** Golden T-MON-VIE-01/02: Vienna, Annex 2 counsellor 65%, spouse + child, non-head, G 1500, school 1000 */
async function viennaGolden(page) {
  await stepMission(page); await stepPosition(page); await stepCosts(page);
}
/** Same, no family, no school: hand-derived S = 4465.0555 -> 4465.06 (D 4150.9, T 871.689, F 1185.8445) */
async function viennaMin(page, rent = '1500') {
  await stepMission(page); await stepPosition(page, { family: [] }); await stepCosts(page, { rent, edu: null });
}

// ---------------------------------------------------------------- offline
test('offline file://: golden Vienna S/F/edu/remainder, no external requests, no errors', async () => {
  const h = await openOffline();
  try {
    await viennaGolden(h.page);
    assert.equal(await dv(h.page, '[data-testid="S"]'), '4985.16');
    assert.equal(await cardVal(h.page, 'F'), '1246.86');
    assert.equal(await cardVal(h.page, 'edu'), '938.00');
    assert.equal(await remainder(h.page), '3423.16', 'hero shows the remainder first');
    assert.deepEqual(h.blockedRequests, [], 'no external request attempted');
    assert.deepEqual(h.unexpectedConsoleErrors(), []);
    assert.deepEqual(h.pageErrors, []);
  } finally { await h.close(); }
});

// ---------------------------------------------------------------- market states (served over http)
for (const mode of ['fresh', 'cached', 'stale', 'partial']) {
  test(`served: market ${mode} shows values, missing items as "—" (never 0), S unaffected`, async () => {
    Object.assign(api, { mode, delayMs: 0, opts: mode === 'partial' ? { missing: ['rent.centre_1br', 'utilities.internet', 'restaurants.midRangeForTwo'] } : {} });
    const s = await openServed(browser, server.origin);
    try {
      await s.page.getByTestId('mission').fill('Vienna');
      await s.page.getByTestId('mission').press('Enter');
      await s.page.locator('.mlist .mrow').first().waitFor({ timeout: 5000 });
      const mtext = await s.page.locator('.mcard').innerText();
      if (mode === 'partial') {
        assert.equal(await dv(s.page, '[data-testid="market-rent"]'), '', 'missing rent has no value');
        assert.match(mtext, /—/);
      } else assert.equal(await dv(s.page, '[data-testid="market-rent"]'), '1700');
      const zeros = await s.page.$$eval('.mcard [data-value]', (els) => els.map((e) => e.getAttribute('data-value')).filter((v) => /^0+(\.0+)?$/.test(v)));
      assert.deepEqual(zeros, [], 'missing market values must never be 0');
      assert.doesNotMatch(mtext, /(^|\s)0(\.00)?\s(EUR|USD)/, 'no "0 EUR" shown for missing values');
      await s.page.getByTestId('next').click();
      await stepPosition(s.page, { family: [] });
      await stepCosts(s.page, { rent: '1500', edu: null });
      assert.equal(await dv(s.page, '[data-testid="S"]'), '4465.06');
      assert.deepEqual(s.blockedRequests, []);
    } finally { await s.close(); }
  });
}

for (const mode of ['not_found', 'network_error', 'disabled', 'rate_limited', 'invalid_json', 'timeout']) {
  test(`served: market ${mode} -> one grey "${UNAVAILABLE}" line, calculator works`, { timeout: 40000 }, async () => {
    Object.assign(api, { mode, delayMs: 0, opts: {} });
    const s = await openServed(browser, server.origin, { fakeClock: mode === 'timeout' });
    try {
      await s.page.getByTestId('mission').fill('Vienna');
      await s.page.getByTestId('mission').press('Enter');
      if (mode === 'timeout') await s.page.clock.runFor(130000); // past the client's 100 s / service 120 s limits
      const line = s.page.getByTestId('market-unavailable');
      await line.waitFor({ timeout: 10000 });
      assert.equal(await line.count(), 1);
      assert.equal((await line.innerText()).trim(), UNAVAILABLE);
      assert.match(await line.getAttribute('class'), /muted/);
      assert.equal(await s.page.locator('.mcard .mlist').count(), 0, 'no partial price list');
      await s.page.getByTestId('next').click();
      await stepPosition(s.page, { family: [] });
      await stepCosts(s.page, { rent: '1500', edu: null });
      assert.equal(await dv(s.page, '[data-testid="S"]'), '4465.06');
      assert.equal(await s.page.getByTestId('use-market-rent').count(), 0, 'no market button without data');
    } finally { await s.close(); }
  });
}

test('served: market data never changes S; rent enters G only via use-market-rent', async () => {
  Object.assign(api, { mode: 'fresh', delayMs: 0, opts: {} });
  const s = await openServed(browser, server.origin);
  try {
    await stepMission(s.page);
    await stepPosition(s.page, { family: [] });
    await s.page.getByTestId('rent').fill('1500');
    await s.page.getByTestId('use-market-rent').waitFor({ timeout: 5000 });
    assert.equal(await s.page.getByTestId('rent').inputValue(), '1500', 'market arrival kept typed rent');
    await s.page.getByTestId('next').click();
    assert.equal(await dv(s.page, '[data-testid="S"]'), '4465.06', 'S from typed rent');
    // back to step 3 and use the market price (C = 0 -> 1 bedroom -> 1700)
    await s.page.getByRole('button', { name: '← უკან' }).click();
    assert.equal(await s.page.getByTestId('rent').inputValue(), '1500');
    await s.page.getByTestId('use-market-rent').click();
    assert.equal(await s.page.getByTestId('rent').inputValue(), '1700');
    await s.page.getByTestId('next').click();
    // G 1700: F = 871.689 + 0.5 x 828.311 = 1285.8445; S = 4150.9 - 871.689 + 1285.8445 = 4565.0555
    assert.equal(await dv(s.page, '[data-testid="S"]'), '4565.06');
  } finally { await s.close(); }
});

test('privacy: /api/market requests carry only location & currency', async () => {
  Object.assign(api, { mode: 'fresh', delayMs: 0, opts: {} });
  const start = server.requests.length;
  const s = await openServed(browser, server.origin);
  try {
    await viennaGolden(s.page);
    await s.page.getByTestId('compare-open').click();
    await s.page.getByTestId('compare-add').fill('Washington');
    await s.page.getByTestId('compare-add').press('Enter');
    await s.page.waitForTimeout(300);
  } finally { await s.close(); }
  const apiReqs = server.requests.slice(start).filter((r) => r.url.startsWith('/api/'));
  assert.ok(apiReqs.length >= 2, 'market requested for main + comparison');
  for (const r of apiReqs) {
    assert.equal(r.method, 'GET');
    assert.equal(r.body, '');
    const u = new URL(r.url, 'http://x');
    assert.equal(u.pathname, '/api/market');
    assert.deepEqual([...u.searchParams.keys()].sort(), ['currency', 'location'], r.url);
    assert.match(u.searchParams.get('location'), /^[A-Z]{2}-[A-Z0-9-]+$/);
    assert.ok(['EUR', 'USD'].includes(u.searchParams.get('currency')));
    for (const v of Object.values(r.headers)) assert.doesNotMatch(String(v), /1500|1000|\b38\b/, 'header leak');
  }
});

// ---------------------------------------------------------------- comparison
function expectedCard(missionId, rent, withEdu) {
  const sc = emptyScenario();
  sc.missionId = missionId;
  sc.position = { mode: 'annex2', entryId: 'A2-R5' };
  sc.status.rentHead = 'not-head';
  sc.family = [{ ...emptyFamilyMember('F1'), role: 'spouse', age: 38 }, { ...emptyFamilyMember('F2'), role: 'child', age: 8 }];
  sc.rent = { amount: rent, basis: 'actual', marketRef: null, changes: [] };
  if (withEdu) sc.education = [{ memberId: 'F2', tuition: '1000' }];
  return calculate(sc, DATA);
}

test('comparison: ≤5 cards, EUR/USD never summed, each card S = calculate() for that mission', async () => {
  Object.assign(api, { mode: 'fresh', delayMs: 0, opts: {} });
  const s = await openServed(browser, server.origin);
  try {
    await viennaGolden(s.page);
    await s.page.getByTestId('compare-open').click();
    const add = async (q) => { await s.page.getByTestId('compare-add').fill(q); await s.page.getByTestId('compare-add').press('Enter'); await s.page.waitForTimeout(150); };
    for (const q of ['Washington', 'Kyiv', 'Lyon', 'Beijing']) await add(q);
    const cards = s.page.locator('.ccard');
    assert.equal(await cards.count(), 5);
    assert.equal(await s.page.getByTestId('compare-add').count(), 0, '6th add not offered');
    assert.match(await s.page.locator('.cadd').innerText(), /მაქსიმუმ 5/);
    const ids = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-col')));
    // own rents per card (USD cards in USD)
    const rents = { 'M-A5-R1': '1500' };
    for (const id of ids.slice(1)) rents[id] = '2500';
    for (const id of ids.slice(1)) {
      const inp = s.page.locator(`[data-col="${id}"] [data-testid="compare-rent"]`);
      await inp.fill(rents[id]); await inp.press('Tab'); await s.page.waitForTimeout(100);
    }
    const currencies = new Set();
    const sValues = [];
    for (const id of ids) {
      const cur = DATA.missions.find((m) => m.id === id).fundingCurrency;
      currencies.add(cur);
      const r = expectedCard(id, rents[id], cur === 'EUR');
      const card = s.page.locator(`[data-col="${id}"]`);
      assert.equal(await card.getByTestId('compare-S').getAttribute('data-value'), r.monthly.S.value, `${id} S`);
      assert.equal(await card.getByTestId('compare-remainder').getAttribute('data-value'), r.remainder.value.value, `${id} remainder`);
      const text = await card.innerText();
      assert.ok(text.includes(cur), `${id} shows ${cur}`);
      assert.match(text, cur === 'EUR' ? /დარჩება ქირისა და სწავლის შემდეგ/ : /დარჩება ქირის შემდეგ/, `${id} remainder label`);
      assert.equal(await card.getByTestId('edu-not-applied').count(), cur === 'EUR' ? 0 : 1, `${id} edu-not-applied note`);
      sValues.push(Number(r.monthly.S.exact.includes('/') ? eval(r.monthly.S.exact) : r.monthly.S.exact)); // eslint-disable-line no-eval
    }
    assert.equal(await dv(s.page, '[data-col="M-A5-R1"] [data-testid="compare-S"]'), '4985.16', 'Vienna card = golden');
    assert.equal(currencies.size, 2, 'mixed EUR/USD present');
    const flat = (await s.page.locator('.cpanel').innerText()).replace(/\s/g, '');
    const total = sValues.reduce((a, b) => a + b, 0).toFixed(2);
    assert.ok(!flat.includes(total), 'no cross-currency total');
    assert.equal(await s.page.locator('.cpanel').getByText(/^(სულ|ჯამი)/).count(), 0, 'no total row');
    // 375px comparison
    await s.page.setViewportSize({ width: 375, height: 800 });
    await s.page.waitForTimeout(100);
    assert.equal(await hasHorizontalScroll(s.page), false, 'comparison 375px horizontal scroll');
  } finally { await s.close(); }
});

// ---------------------------------------------------------------- XSS, print, layout
test('XSS in family age and rent fields is harmless and shown as text', async () => {
  const h = await openOffline();
  try {
    await h.page.evaluate(() => { window.__xss = 0; });
    const payload = '<img src=x onerror="window.__xss=1">';
    await stepMission(h.page);
    await stepPosition(h.page, { family: [['spouse', payload], ['child', '"><svg onload=window.__xss=2>']] });
    await h.page.locator('[data-testid="rent"]').fill(payload);
    assert.equal(await h.page.getByTestId('rent').getAttribute('aria-invalid'), 'true', 'rent payload rejected as a number');
    await h.page.locator('[data-testid="rent"]').fill('1500');
    await h.page.getByTestId('next').click();
    await h.page.getByTestId('hero-remainder').waitFor();
    await h.page.emulateMedia({ media: 'print' });
    assert.equal(await h.page.evaluate(() => window.__xss), 0, 'payload executed');
    assert.equal(await h.page.locator('img[src="x"], svg[onload]').count(), 0, 'no injected elements');
    assert.ok((await h.page.locator('body').textContent()).includes('<img src=x onerror'), 'payload kept as plain text');
  } finally { await h.close(); }
});

test('print values equal screen values; PDF text contains the golden amounts', async () => {
  const h = await openOffline();
  try {
    await viennaGolden(h.page);
    const grab = () => h.page.$$eval(RESULT_SEL, (els) => els.map((e) => e.getAttribute('data-value')));
    const screen = await grab();
    await h.page.emulateMedia({ media: 'print' });
    assert.deepEqual(await grab(), screen);
    const visible = await h.page.$$eval(RESULT_SEL, (els) => els.filter((e) => e.offsetParent !== null || e.getClientRects().length).map((e) => e.getAttribute('data-value')));
    for (const v of ['4985.16', '1246.86', '938.00', '3423.16']) assert.ok(visible.includes(v), `${v} visible in print`);
    const pdf = path.join(TMP, `verifier-print-${process.pid}.pdf`);
    await h.page.pdf({ path: pdf, format: 'A4' });
    let text = '';
    try {
      text = execFileSync('python3', ['-I', '-c', 'import sys,pypdfium2 as p\nd=p.PdfDocument(sys.argv[1])\nprint("".join(d[i].get_textpage().get_text_range() for i in range(len(d))))', pdf], { encoding: 'utf8' });
    } catch { /* pypdfium2 unavailable: DOM check above still applies */ }
    if (text) {
      const flat = text.replace(/\s/g, '');
      for (const v of ['4985.16', '1246.86', '938.00', '3423.16']) assert.ok(flat.includes(v), `PDF contains ${v}`);
      assert.match(text, /[ა-ჰ]{4,}/, 'Georgian text extractable from PDF');
    }
    fs.rmSync(pdf, { force: true });
  } finally { await h.close(); }
});

test('375px: no horizontal scroll on every step (long mission name, 7 family members)', async () => {
  const h = await openOffline({ viewport: { width: 375, height: 800 } });
  try {
    const noScroll = async (where) => assert.equal(await hasHorizontalScroll(h.page), false, `horizontal scroll at ${where}`);
    await noScroll('step 1 (empty)');
    await h.page.getByTestId('mission').fill('ESCAP');
    await h.page.getByTestId('mission').press('Enter');
    await noScroll('step 1 (long mission)');
    await h.page.getByTestId('next').click();
    await noScroll('step 2');
    await stepPosition(h.page, { entry: 'A2-R6', family: [['spouse', '40'], ...Array.from({ length: 6 }, () => ['child', '9'])] });
    await noScroll('step 3');
    await stepCosts(h.page, { rent: '2000', edu: '500' });
    await noScroll('step 4');
    await h.page.getByTestId('how').click();
    await noScroll('step 4 details');
    assert.match(await dv(h.page, '[data-testid="S"]'), /^\d+\.\d{2}$/);
  } finally { await h.close(); }
});

test('offline (file://) and served (http) give identical results', async () => {
  Object.assign(api, { mode: 'fresh', delayMs: 0, opts: {} });
  const h = await openOffline();
  const s = await openServed(browser, server.origin);
  try {
    await viennaGolden(h.page); await viennaGolden(s.page);
    const grab = (p) => p.$$eval(RESULT_SEL, (els) => els.map((e) => e.getAttribute('data-value')));
    assert.deepEqual(await grab(s.page), await grab(h.page));
  } finally { await h.close(); await s.close(); }
});

// ---------------------------------------------------------------- round 3: texts, PDF, settlement, insurance
const FOOTER = 'საინფორმაციო გაანგარიშება — არ წარმოადგენს ოფიციალურ ფინანსურ დოკუმენტს.';
const pdfPages = (file) => Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [file], { encoding: 'utf8' }))?.[1]);
const pdfText = (file) => execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });

test('texts: exact footer, no "ბრძანება №01-82" subtitle, family heading', async () => {
  const h = await openOffline();
  try {
    assert.equal((await h.page.locator('footer').innerText()).trim(), FOOTER);
    assert.doesNotMatch(await h.page.locator('header').innerText(), /ბრძანება\s*№\s*01-82/);
    await stepMission(h.page);
    assert.match(await h.page.locator('#app').innerText(), /ოჯახის წევრები, რომლებიც თან მიგყვებათ/);
  } finally { await h.close(); }
});

test('PDF download: 1 page, text contains the remainder; print emulation = 1 page', async () => {
  const h = await openOffline();
  try {
    await viennaGolden(h.page);
    const [dl] = await Promise.all([h.page.waitForEvent('download'), h.page.getByTestId('pdf-download').click()]);
    const file = path.join(TMP, `verifier-dl-${process.pid}.pdf`);
    await dl.saveAs(file);
    assert.equal(fs.readFileSync(file).subarray(0, 5).toString(), '%PDF-');
    assert.equal(pdfPages(file), 1, 'downloaded PDF must be one page');
    const flat = pdfText(file).replace(/\s/g, '');
    assert.ok(flat.includes('3423.16'), 'downloaded PDF contains the remainder 3423.16');
    assert.ok(flat.includes('4985.16'), 'downloaded PDF contains S 4985.16');
    await h.page.emulateMedia({ media: 'print' });
    const printed = path.join(TMP, `verifier-print1-${process.pid}.pdf`);
    await h.page.pdf({ path: printed, format: 'A4', preferCSSPageSize: true });
    assert.equal(pdfPages(printed), 1, 'browser print must fit on one page');
    assert.ok(pdfText(printed).replace(/\s/g, '').includes('3423.16'));
    for (const f of [file, printed]) fs.rmSync(f, { force: true });
  } finally { await h.close(); }
});

async function settlementLine(page, query, family) {
  await stepMission(page, query);
  await stepPosition(page, { family });
  await page.getByTestId('rent').fill('1500');
  await page.getByTestId('ex-settlement').check();
  const auto = page.getByTestId('settlement-auto');
  const text = (await auto.count()) ? await auto.innerText() : null;
  await page.getByTestId('next').click();
  await page.getByTestId('hero-remainder').waitFor();
  const ot = await page.locator('.olist').first().innerText().catch(() => '');
  const raws = await page.$$eval('.olist [data-value]', (els) => els.map((e) => e.getAttribute('data-value')));
  return { text, ot, raws };
}

test('settlement (pt 7 + Decree 211): Vienna 4320.00 EUR; Canberra 5760 AUD not converted; Holy See undetermined', async () => {
  const fam = [['spouse', '38'], ['child', '8']];
  let h = await openOffline();
  try {
    const v = await settlementLine(h.page, 'Vienna', fam);
    assert.match(v.text, /60(\.00)?\s*EUR/, 'Vienna daily rate 60 EUR shown');
    assert.ok(v.raws.includes('4320.00'), `Vienna settlement 4320.00 in ${JSON.stringify(v.raws)}`); // 60 x 60 x 1.2
  } finally { await h.close(); }
  h = await openOffline();
  try {
    const c = await settlementLine(h.page, 'Canberra', fam);
    assert.match(c.text, /80(\.00)?\s*AUD/, 'Canberra daily rate 80 AUD');
    assert.ok(c.raws.includes('5760.00') || /5\s?760(\.00)?\s*AUD/.test(c.ot), `5760 AUD shown: ${c.ot}`); // 80 x 60 x 1.2
    assert.doesNotMatch(c.ot, /5\s?760(\.00)?\s*USD/, 'AUD amount not relabelled/converted to USD');
  } finally { await h.close(); }
  h = await openOffline();
  try {
    await stepMission(h.page, 'ვატიკან');
    await stepPosition(h.page, { family: fam });
    await h.page.getByTestId('ex-settlement').check();
    assert.equal(await h.page.getByTestId('settlement-auto').count(), 0, 'no automatic rate for the Holy See');
  } finally { await h.close(); }
});

test('insurance rows per person with golden annual caps (Vienna: you 40 -> 1663, spouse 38 -> 1504, child 8 -> 864)', async () => {
  const h = await openOffline();
  try {
    await stepMission(h.page);
    await stepPosition(h.page, { age: '40' });
    await h.page.getByTestId('ex-insurance').check();
    const rows = h.page.locator('.ins-row');
    assert.deepEqual(await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-person'))), ['EMP', 'F1', 'F2']);
    const cap = async (p) => (await h.page.locator(`.ins-row[data-person="${p}"]`).innerText()).replace(/\s/g, '');
    assert.match(await cap('EMP'), /1663\.00EUR/);
    assert.match(await cap('F1'), /1504\.00EUR/);
    assert.match(await cap('F2'), /864\.00EUR/);
    assert.equal(await h.page.locator('.ins-row input').count(), 3, 'a policy input per person');
    assert.match((await h.page.locator('.ins-total').innerText()).replace(/\s/g, ''), /4031\.00EUR/); // 1663 + 1504 + 864
  } finally { await h.close(); }
});
