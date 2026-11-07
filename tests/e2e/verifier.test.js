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
/** deterministic synthetic 'cost of living + rent' index per location (sorting tests only) */
const synthIndex = (loc) => (30 + ([...loc].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 997, 7) % 60)).toFixed(1);
const synthRent = (loc) => (1000 + Number(synthIndex(loc)) * 10).toFixed(2);
const USD_PER_EUR = '1.119954'; // snapshot reference rate used by the UI to convert the school fee (interpretation, not a norm)

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
        default: {
          const body = marketBodyV2(loc, { currency: cur, status: api.mode, ...api.opts, ...(api.rentByLoc ? { centre1: synthRent(loc) } : {}) });
          if (body.indices.costOfLivingPlusRent != null) body.indices.costOfLivingPlusRent = synthIndex(loc);
          return json(200, body);
        }
      }
    },
  });
});
after(async () => { await browser?.close(); await server?.close(); });

// ---------------------------------------------------------------- wizard driver
const dv = (page, sel) => page.locator(sel).first().getAttribute('data-value');
const cardVal = (page, id) => dv(page, `[data-testid="${id}"] [data-value]`);
const remainder = (page) => dv(page, '[data-testid="hero-remainder"]');
const OFFICIAL_SEL = '[data-testid="S"], [data-testid="hero-remainder"], [data-testid="chain-remainder"], .rcard [data-value]';
const RESULT_SEL = '[data-testid="S"], [data-testid="hero-remainder"], [data-testid="chain"] [data-value], .rcard [data-value]';

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
test('offline file://: golden Vienna S, rent breakdown, chain, living remainder; no external requests', async () => {
  const h = await openOffline();
  try {
    await viennaGolden(h.page);
    const p = h.page;
    assert.equal(await dv(p, '[data-testid="S"]'), '4985.16');
    assert.equal(await remainder(p), '3423.16', 'hero shows the remainder first');
    assert.equal(await dv(p, '[data-testid="F-value"]'), '1246.86');
    assert.equal(await cardVal(p, 'edu'), '938.00');
    // rent breakdown, hand-derived: G 1500, T 993.72546, F - T = 253.13727, F 1246.86273, own share 1500 - F = 253.13727
    const rb = await p.$$eval('[data-testid="rent-breakdown"] [data-value]', (els) => els.map((e) => e.getAttribute('data-value')));
    assert.deepEqual(rb, ['1500.00', '993.73', '253.14', '1246.86', '253.14']);
    // chain: S - G - school + reimbursement = remainder; last row = living remainder
    const chain = await p.$$eval('[data-testid="chain"] .chain-v', (els) => els.map((e) => [e.getAttribute('data-testid'), e.getAttribute('data-value')]));
    assert.deepEqual(chain.slice(0, 5).map((x) => x[1]), ['4985.16', '1500.00', '1000.00', '938.00', '3423.16']);
    assert.equal(chain[4][0], 'chain-remainder');
    assert.equal(chain.at(-1)[0], 'remainder-living', 'living remainder is the last chain row');
    // living deduction = family-of-4 budget shown in the page's own market block (spouse + child -> not alone)
    const budget = p.locator('[data-testid="market-result"] .irow[data-tile="budget"]');
    assert.match(await budget.innerText(), /ოჯახი \(4\)/, 'family budget tile (spouse + child -> not alone)');
    const fam4 = await budget.getByTestId('market-budget').getAttribute('data-value');
    assert.match(fam4 ?? '', /^\d+(\.\d+)?$/, `family-4 budget shown: ${fam4}`);
    for (const t of ['rent', 'utilities', 'internet', 'groceries', 'restaurants', 'budget', 'index']) {
      assert.equal(await p.locator(`[data-testid="market-result"] .irow[data-tile="${t}"]`).count(), 1, `tile ${t}`);
    }
    const exp = (Math.round((3423.16327 - Number(fam4)) * 100) / 100).toFixed(2);
    assert.equal(chain.at(-2)[1], fam4, 'deduction row = family-of-4 budget');
    assert.equal(chain.at(-1)[1], exp, `living remainder = 3423.16327 - ${fam4}`);
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
      await s.page.locator('.mcard .irow[data-tile="rent"]').first().waitFor({ timeout: 5000 });
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
      assert.equal(await s.page.locator('.mcard .irow').count(), 0, 'no partial price tiles');
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
const half2 = (x) => { // exact decimal string -> 2-dp half-up (positive values)
  const [i, f = ''] = String(x).split('.'); const n = BigInt(i + (f + '000').slice(0, 3));
  const r = (n + 5n) / 10n; return `${r / 100n}.${String(r % 100n).padStart(2, '0')}`;
};
/** independent expectation for a comparison card: same position/family; school fee converted at the reference rate for USD cities */
function expectedCard(missionId, rent, eduEur = '1000') {
  const cur = DATA.missions.find((m) => m.id === missionId).fundingCurrency;
  const sc = emptyScenario();
  sc.missionId = missionId;
  sc.position = { mode: 'annex2', entryId: 'A2-R5' };
  sc.status.rentHead = 'not-head';
  sc.family = [{ ...emptyFamilyMember('F1'), role: 'spouse', age: 38 }, { ...emptyFamilyMember('F2'), role: 'child', age: 8 }];
  sc.rent = { amount: rent, basis: 'actual', marketRef: null, changes: [] };
  const fee = cur === 'EUR' ? eduEur : half2((Number(eduEur) * 1e6 * Number(USD_PER_EUR) * 1e6 / 1e12).toFixed(6));
  sc.education = [{ memberId: 'F2', tuition: fee }];
  return { cur, fee, r: calculate(sc, DATA) };
}

test('Washington card, hand-derived: rent 5049.17 USD, school 1000 EUR -> S 7243.14, F 3168.87, remainder 2119.98 USD', () => {
  // D = 3495 x 0.65 x 2.185 x 1.14 = 5658.702075; T = 1584.436581; 0.5 x (5049.17 - T) > T -> F = 2T = 3168.873162
  // S = D + T = 7243.138656; fee 1000 x 1.119954 = 1119.95 USD; edu = 750 + 0.8 x 369.95 = 1045.96
  // remainder = 7243.138656 + 1045.96 - 5049.17 - 1119.95 = 2119.978656
  const { cur, fee, r } = expectedCard('M-A6-R4', '5049.17');
  assert.equal(cur, 'USD'); assert.equal(fee, '1119.95');
  assert.equal(r.monthly.S.value, '7243.14'); assert.equal(r.monthly.F.value, '3168.87');
  assert.equal(r.education.total.value, '1045.96'); assert.equal(r.remainder.value.value, '2119.98');
});

test('comparison: 8 cities accepted, EUR/USD never summed, cards = calculate(); sort, arrows, 2-page PDF for 7', { timeout: 90000 }, async () => {
  Object.assign(api, { mode: 'fresh', delayMs: 0, opts: {} });
  const s = await openServed(browser, server.origin);
  try {
    const p = s.page;
    await viennaGolden(p);
    await p.getByTestId('compare-open').click();
    const add = async (q) => { await p.getByTestId('compare-add').fill(q); await p.getByTestId('compare-add').press('Enter'); await p.waitForTimeout(150); };
    for (const q of ['Washington', 'Kyiv', 'Lyon', 'Beijing', 'Tokyo', 'Ottawa', 'Madrid']) await add(q);
    const cards = p.locator('.ccard');
    assert.equal(await cards.count(), 8, '8 cities accepted (no limit)');
    assert.equal(await p.getByTestId('compare-add').count(), 1, 'still possible to add more');
    const ids = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-col')));
    const rents = Object.fromEntries(ids.map((id) => [id, id === 'M-A5-R1' ? '1500' : DATA.missions.find((m) => m.id === id).fundingCurrency === 'USD' ? '5049.17' : '1800']));
    for (const id of ids.slice(1)) {
      const inp = p.locator(`[data-col="${id}"] [data-testid="compare-rent"]`);
      await inp.fill(rents[id]); await inp.press('Tab'); await p.waitForTimeout(80);
    }
    const curs = new Set(); const sValues = [];
    for (const id of ids) {
      const { cur, r } = expectedCard(id, rents[id]);
      curs.add(cur);
      const card = p.locator(`[data-col="${id}"]`);
      assert.equal(await card.getByTestId('compare-S').getAttribute('data-value'), r.monthly.S.value, `${id} S`);
      assert.equal(await card.getByTestId('compare-remainder').getAttribute('data-value'), r.remainder.value.value, `${id} remainder`);
      // living remainder: synthetic market has no budget -> deduction = utilities 250.00 + internet 35.00
      const liv = r.remainder.value.exact.includes('/') ? null : half2((Number(r.remainder.value.exact) - 285).toFixed(6));
      if (liv) assert.equal(await card.getByTestId('compare-remainder-living').getAttribute('data-value'), liv, `${id} living remainder`);
      assert.equal(await card.getAttribute('data-c'), '2', `${id} C`);
      const text = await card.innerText();
      assert.match(text, /დარჩება ქირისა და სწავლის შემდეგ/, `${id}: education counted for every card`);
      assert.equal(await card.getByTestId('edu-converted').count(), cur === 'USD' ? 1 : 0, `${id} edu-converted note`);
      assert.equal(await card.getByTestId('compare-chain').count(), 1);
      sValues.push(Number(r.monthly.S.value));
    }
    assert.equal(await p.locator('[data-col="M-A5-R1"] [data-testid="compare-remainder"]').getAttribute('data-value'), '3423.16', 'Vienna card = golden');
    assert.equal(await p.locator('[data-col="M-A6-R4"] [data-testid="compare-remainder"]').getAttribute('data-value'), '2119.98', 'Washington card = hand-derived');
    assert.equal(curs.size, 2, 'mixed EUR/USD present');
    const flat = (await p.locator('.cpanel').innerText()).replace(/\s/g, '');
    assert.ok(!flat.includes(sValues.reduce((a, b) => a + b, 0).toFixed(2)), 'no cross-currency total');
    assert.equal(await p.locator('.cpanel').getByText(/^(სულ|ჯამი)/).count(), 0, 'no total row');
    // sort by the 'cost of living + rent' index
    const order = () => p.locator('.ccard').evaluateAll((els) => els.map((e) => e.getAttribute('data-col')));
    const locOf = (id) => DATA.missions.find((m) => m.id === id).locationId;
    for (const dir of ['asc', 'desc']) {
      await p.getByTestId('compare-sort').selectOption(dir);
      const idx = (await order()).map((id) => Number(synthIndex(locOf(id))));
      const sorted = idx.slice().sort((a, b) => (dir === 'asc' ? a - b : b - a));
      assert.deepEqual(idx, sorted, `sorted ${dir}`);
    }
    // arrow reorder (keyboard-accessible alternative to drag)
    const before_ = await order();
    await p.locator(`[data-col="${before_[0]}"] [data-testid="compare-move-right"]`).click();
    const after1 = await order();
    assert.deepEqual(after1.slice(0, 2), [before_[1], before_[0]]);
    await p.locator(`[data-col="${before_[0]}"] [data-testid="compare-move-left"]`).click();
    assert.deepEqual(await order(), before_);
    assert.equal(await p.locator('.ccard').first().getByTestId('compare-move-left').isDisabled(), true);
    // 375px
    await p.setViewportSize({ width: 375, height: 800 });
    await p.waitForTimeout(100);
    assert.equal(await hasHorizontalScroll(p), false, 'comparison 375px horizontal scroll');
    await p.setViewportSize({ width: 1280, height: 900 });
    // remove one -> 7 cities -> PDF: 6 per landscape page -> 2 pages
    await p.locator('.ccard').last().locator('header .x').click();
    assert.equal(await p.locator('.ccard').count(), 7);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.getByTestId('compare-pdf').click()]);
    const file = path.join(TMP, `verifier-cmp-${process.pid}.pdf`);
    await dl.saveAs(file);
    assert.equal(pdfPages(file), 2, '7 cities -> 2 pages');
    const size = /Page size:\s+([\d.]+) x ([\d.]+)/.exec(execFileSync('pdfinfo', [file], { encoding: 'utf8' }));
    assert.ok(Number(size[1]) > Number(size[2]), 'landscape pages');
    fs.rmSync(file, { force: true });
  } finally { await s.close(); }
});

// ---------------------------------------------------------------- cities tab
test('cities tab: 80 rows, alphabetical default, sort by index, only-selected filter, PDF header on every page', { timeout: 60000 }, async () => {
  const h = await openOffline();
  try {
    const p = h.page;
    await p.getByTestId('cities-tab').click();
    const table = p.getByTestId('cities-table');
    await table.waitFor();
    const names = () => table.locator('tbody th').allInnerTexts();
    const all = await names();
    assert.equal(all.length, 80, `rows: ${all.length}`);
    assert.deepEqual(all, all.slice().sort((a, b) => a.localeCompare(b, 'ka')), 'alphabetical (Georgian) by default');
    const idxVals = () => table.locator('tbody td.num.strong').evaluateAll((els) => els.map((e) => e.getAttribute('data-value')));
    for (const dir of ['asc', 'desc']) {
      await p.getByTestId('cities-sort').selectOption(dir);
      const v = (await idxVals()).filter((x) => x !== '').map(Number);
      const sorted = v.slice().sort((a, b) => (dir === 'asc' ? a - b : b - a));
      assert.deepEqual(v, sorted, `index ${dir}`);
      const raw = await idxVals(); const firstEmpty = raw.indexOf('');
      if (firstEmpty >= 0) assert.ok(raw.slice(firstEmpty).every((x) => x === ''), 'unknown index last');
    }
    await p.getByTestId('cities-sort').selectOption('alpha');
    for (const i of [0, 5, 9]) await table.locator('tbody tr').nth(i).locator('input[type=checkbox]').check();
    await p.getByTestId('cities-only-selected').check();
    assert.equal(await table.locator('tbody tr').count(), 3, 'only selected rows');
    await p.getByTestId('cities-only-selected').uncheck();
    assert.equal(await table.locator('tbody tr').count(), 80);
    const [dl] = await Promise.all([p.waitForEvent('download'), p.getByTestId('cities-pdf').click()]);
    const file = path.join(TMP, `verifier-cities-${process.pid}.pdf`);
    await dl.saveAs(file);
    const pages = pdfPages(file);
    assert.ok(pages >= 2, `80 rows span pages (${pages})`);
    for (let i = 1; i <= pages; i++) {
      const t = execFileSync('pdftotext', ['-f', String(i), '-l', String(i), '-layout', file, '-'], { encoding: 'utf8' });
      assert.match(t, /ქალაქი/, `page ${i} repeats the table header`);
      assert.match(t, /ქვეყანა/, `page ${i} repeats the table header`);
    }
    fs.rmSync(file, { force: true });
    await p.setViewportSize({ width: 375, height: 800 });
    assert.equal(await hasHorizontalScroll(p), false, 'cities tab 375px (table scrolls inside its own region)');
    assert.deepEqual(h.blockedRequests, []);
  } finally { await h.close(); }
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
    const visible = await h.page.$$eval(RESULT_SEL, (els) => els.filter((e) => e.getClientRects().length).map((e) => e.getAttribute('data-value')));
    for (const v of ['4985.16', '1246.86', '938.00', '3423.16']) assert.ok(visible.includes(v), `${v} visible in print`);
    const pdf = path.join(TMP, `verifier-print-${process.pid}.pdf`);
    await h.page.pdf({ path: pdf, format: 'A4' });
    const flat = pdfText(pdf).replace(/\s/g, '');
    for (const v of ['4985.16', '1246.86', '938.00', '3423.16']) assert.ok(flat.includes(v), `PDF contains ${v}`);
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

test('offline (file://) and served (http) give identical official results (market-based living rows may differ)', async () => {
  Object.assign(api, { mode: 'fresh', delayMs: 0, opts: {} });
  const h = await openOffline();
  const s = await openServed(browser, server.origin);
  try {
    await viennaGolden(h.page); await viennaGolden(s.page);
    const grab = (p) => p.$$eval(OFFICIAL_SEL, (els) => els.map((e) => e.getAttribute('data-value')));
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

// ---------------------------------------------------------------- round 6: rent prefill, PDF layout
test('rent prefill: Numbeo centre rent prefilled while untouched, refreshes on city change, never overwrites a typed value', async () => {
  Object.assign(api, { mode: 'fresh', delayMs: 0, opts: {}, rentByLoc: true });
  const s = await openServed(browser, server.origin);
  try {
    const p = s.page;
    const toCosts = async (city) => {
      await p.getByTestId('mission').fill(city); await p.getByTestId('mission').press('Enter');
      await p.locator('.mcard').first().waitFor(); await p.waitForTimeout(200);
      await p.getByTestId('next').click();
      if (!(await p.getByTestId('pos-A2-R5').isChecked())) await p.getByTestId('pos-A2-R5').check({ force: true });
      await p.getByTestId('next').click();
    };
    const back = async (n) => { for (let i = 0; i < n; i++) await p.getByRole('button', { name: '← უკან' }).click(); };
    await toCosts('Vienna');
    assert.equal(await p.getByTestId('rent').inputValue(), synthRent('AT-VIENNA'), 'prefilled with Vienna centre 1br (no family)');
    assert.equal(await p.getByTestId('rent-prefill-note').count(), 1);
    assert.equal(await p.getByTestId('use-market-rent').count(), 0, 'restore link hidden while untouched');
    // untouched -> city change refreshes the prefill
    await back(2); await p.getByTestId('mission').fill('Lyon'); await p.getByTestId('mission').press('Enter'); await p.waitForTimeout(300);
    await p.getByTestId('next').click(); await p.getByTestId('next').click();
    assert.equal(await p.getByTestId('rent').inputValue(), synthRent('FR-LYON'), 'prefill follows the new city');
    // typed value is kept across city changes
    await p.getByTestId('rent').fill('1500');
    assert.equal(await p.getByTestId('use-market-rent').count(), 1, 'restore link after editing');
    assert.equal(await p.getByTestId('rent-prefill-note').count(), 0);
    await back(2); await p.getByTestId('mission').fill('Vienna'); await p.getByTestId('mission').press('Enter'); await p.waitForTimeout(300);
    await p.getByTestId('next').click(); await p.getByTestId('next').click();
    assert.equal(await p.getByTestId('rent').inputValue(), '1500', 'typed rent not overwritten by market data');
    await p.getByTestId('next').click();
    assert.equal(await dv(p, '[data-testid="S"]'), '4465.06', 'S from typed rent (hand-derived), market ignored');
    // restore link puts the market value back
    await p.getByRole('button', { name: '← უკან' }).click();
    await p.getByTestId('use-market-rent').click();
    assert.equal(await p.getByTestId('rent').inputValue(), synthRent('AT-VIENNA'));
  } finally { api.rentByLoc = false; await s.close(); }
});

test('result PDF: 1 page, no overlapping label/value text (pdftotext -layout)', async () => {
  const h = await openOffline();
  try {
    await viennaGolden(h.page);
    const [dl] = await Promise.all([h.page.waitForEvent('download'), h.page.getByTestId('pdf-download').click()]);
    const file = path.join(TMP, `verifier-layout-${process.pid}.pdf`);
    await dl.saveAs(file);
    assert.equal(pdfPages(file), 1);
    const lines = pdfText(file).replace(/ | /g, ' ').split('\n');
    const pairs = [
      ['ქირა თვეში', '1 500.00 EUR'], ['სკოლა/ბაღი თვეში', '1 000.00 EUR'],
      ['ყოველთვიური სამივლინებო თანხა', '4 985.16 EUR'], ['ბინის ქირა (სრული)', '1 500.00 EUR'],
      ['სწავლის ანაზღაურება', '938.00 EUR'], ['= დარჩენილი თანხა ქირისა და სწავლის შემდეგ', '3 423.16 EUR'],
      ['H საბაზისო თანხა', '3 100.00 EUR'], ['K ქვეყნის კოეფიციენტი', '2.06'], ['D პერსონალური თანხა', '4 732.03 EUR'],
      ['T ბინის წილი თანხაში', '993.73 EUR'], ['F ქირის ანაზღაურება', '1 246.86 EUR'], ['S ყოველთვიური თანხა (D − T + F)', '4 985.16 EUR'],
    ];
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const [label, value] of pairs) {
      const re = new RegExp(`${esc(label)}\\s{2,}${esc(value)}\\s*$`);
      assert.ok(lines.some((l) => re.test(l)), `"${label}" and "${value}" on one line, separated by whitespace`);
    }
    const collided = lines.filter((l) => /[ა-ჰ]\d|\d[ა-ჰ]/.test(l));
    assert.deepEqual(collided, [], 'Georgian letters glued to digits (overlap)');
    fs.rmSync(file, { force: true });
  } finally { await h.close(); }
});
