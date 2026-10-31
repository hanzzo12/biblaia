// UI-ის დეველოპერული smoke ტესტი: ერთფაილიანი HTML file://-ით, ქსელი დაბლოკილი.
// გაშვება: npm run build && node --test tests/e2e/ui-smoke.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HTML = path.join(root, 'dist/rotation-calculator.html');
const SHOTS = process.env.UI_SHOTS_DIR || null;
const BANNED = ['ხელფასი', 'ხელზე ასაღები', 'ყველა ხარჯის', 'გარანტირებულად', 'სულ დარიცხვა', 'ერთოთახიანი'];

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

async function openPage(viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage({ viewport });
  const external = []; const errors = [];
  await page.route('**/*', (r) => { const u = r.request().url(); if (u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:')) return r.continue(); external.push(u); return r.abort(); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(pathToFileURL(HTML).href);
  return { page, external, errors };
}

const val = (page, sel) => page.locator(sel).first().getAttribute('data-value');
const next = (page) => page.getByTestId('next').click();

async function pickMission(page, q, testid = 'mission') {
  const inp = page.getByTestId(testid);
  await inp.click();
  await inp.fill(q);
  await page.keyboard.press('Enter');
}

/** ვენა: №2 „მრჩეველი“ 65%, მეუღლე + შვილი, არახელმძღვანელი, ქირა 1500, სკოლა 1000 */
async function vienna(page, { rent = '1500', shots = null } = {}) {
  await pickMission(page, 'Vienna');
  if (shots) await shots('step1');
  await next(page);
  await page.getByTestId('position').selectOption('A2-R5');
  assert.equal(await page.getByTestId('head').isChecked(), false);
  await page.getByTestId('add-family').click();
  await page.getByTestId('add-family').click();
  const rows = page.locator('.fam-row');
  await rows.nth(0).locator('select').selectOption('spouse');
  await rows.nth(0).locator('input').fill('38');
  await rows.nth(1).locator('select').selectOption('child');
  await rows.nth(1).locator('input').fill('8');
  if (shots) await shots('step2');
  await next(page);
  if (rent !== null) await page.getByTestId('rent').fill(rent);
  await page.getByTestId('edu').first().fill('1000');
  if (shots) await shots('step3');
  await next(page);
  await page.getByTestId('S').waitFor();
}

/** სინთეზური MarketData v2 (contracts §8) — რეალური ფასი არ არის. */
function marketV2(loc, currency, k = 1) {
  const p = (a) => ({ average: (Number(a) * k).toFixed(2), low: null, high: null });
  return {
    schemaVersion: 2, requestedLocationId: loc,
    resolvedLocation: { city: 'Synthetic', countryCode: loc.slice(0, 2), providerCity: 'Synthetic', matchStatus: 'exact' },
    provider: { id: 'numbeo-apify', name: 'Numbeo', via: 'Apify automation-lab/numbeo-scraper', sourceUrl: 'https://www.numbeo.com/cost-of-living/', attribution_ka: 'წყარო: Numbeo.com (მოპოვებულია Apify-ის მეშვეობით)' },
    currency, status: 'cached',
    rent: { status: 'cached', items: { centre_1br: p(1000), outside_1br: p(800), centre_3br: p(2000), outside_3br: p(1500) }, rentIndex: '40.1' },
    utilities: { status: 'cached', basic85m2: p(250), internet: p(35) },
    groceries: { status: 'cached', basketItemsSum: (60 * k).toFixed(2), itemsCounted: 20, itemsMissing: 0, groceriesIndex: '55.0' },
    restaurants: { status: 'cached', inexpensiveMeal: p(15), midRangeForTwo: p(70), restaurantIndex: '60.2' },
    indices: { costOfLiving: '65.3', rent: '40.1', groceries: '55.0', restaurants: '60.2', costOfLivingPlusRent: '53.0', baseline: 'ნიუ-იორკი = 100', status: 'cached', period: '2026' },
    fetchedAt: '2026-10-20T10:00:00Z', sourceUpdatedAt: null, cache: { state: 'hit', expiresAt: '2026-11-19T10:00:00Z' }, warnings: [],
  };
}

async function openOnline({ delays = {}, viewport } = {}) {
  const page = await browser.newPage({ viewport: viewport || { width: 1280, height: 900 } });
  const html = readFileSync(path.join(root, 'dist/web/index.html'));
  const seen = []; const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== 'http://ui.test') return r.abort();
    if (u.pathname === '/') return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    if (u.pathname === '/api/market') {
      seen.push(u.search);
      const loc = u.searchParams.get('location'); const cur = u.searchParams.get('currency');
      if (delays[loc]) await new Promise((res) => setTimeout(res, delays[loc]));
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(marketV2(loc, cur, loc === 'AT-VIENNA' ? 1.5 : 1)) });
    }
    return r.abort();
  });
  await page.goto('http://ui.test/');
  return { page, seen, errors };
}

test('ოფლაინ file://: ვენის სცენარი ოთხ საფეხურად, გარე მოთხოვნების გარეშე', async () => {
  const { page, external, errors } = await openPage();
  const shots = SHOTS ? (n) => page.screenshot({ path: path.join(SHOTS, `d-${n}.png`), fullPage: true }) : null;
  await vienna(page, { shots });
  assert.equal(await val(page, '[data-testid="S"]'), '4985.16');
  assert.equal(await val(page, '[data-testid="edu"] .rc-value'), '938.00');
  assert.equal(await val(page, '[data-testid="remainder"] .rc-value'), '3423.16');
  assert.equal(await val(page, '[data-testid="F"] .rc-value'), '1246.86');
  await page.getByTestId('how').click();
  assert.equal(await val(page, 'tr[data-component="D"] td'), '4732.03');
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  const text = await page.locator('body').innerText();
  for (const b of BANNED) assert.ok(!text.includes(b), `აკრძალული ტერმინი: ${b}`);
  assert.ok(!/R-[A-Z]+-/.test(await page.locator('#app').innerText()), 'წესების ID მთავარ ხედზე არ ჩანს');
  if (SHOTS) {
    await shots('step4');
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: path.join(SHOTS, 'print.pdf'), format: 'A4' });
  }
  await page.close();
});

test('ქირის გარეშე: თანხა ქირის გარეშე და შენიშვნა; არასწორი თანხა', async () => {
  const { page } = await openPage();
  await vienna(page, { rent: null });
  assert.match(await page.locator('.hero').innerText(), /ქირის გარეშე/);
  assert.match(await val(page, '[data-testid="S"]'), /^\d+\.\d{2}$/);
  await page.locator('.pill').nth(2).click();
  const rent = page.getByTestId('rent');
  for (const bad of ['-5', '1.234,5', 'Infinity', '1e5', '99999999']) {
    await rent.fill(bad);
    assert.equal(await rent.getAttribute('aria-invalid'), 'true', bad);
  }
  await rent.fill('1500,5');
  assert.equal(await rent.getAttribute('aria-invalid'), null);
  await page.close();
});

test('ელჩი → ხელმძღვანელი ავტომატურად; ნიუ-იორკის გენ. საკონსულო A2-R1 შეცდომის გარეშე', async () => {
  const { page, errors } = await openPage();
  await pickMission(page, 'გენერალური საკონსულო ნიუ-იორკ');
  await next(page);
  await page.getByTestId('position').selectOption('A2-R1');
  assert.equal(await page.getByTestId('head').isChecked(), true);
  await next(page);
  await page.getByTestId('rent').fill('3000');
  await next(page);
  assert.match(await val(page, '[data-testid="S"]'), /^\d+\.\d{2}$/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('დამატებითი ხარჯები: დაზღვევის ლიმიტი, ბარგი, მაკლერი, მოწყობა', async () => {
  const { page } = await openPage();
  await pickMission(page, 'Vienna'); await next(page);
  await page.getByTestId('position').selectOption('A2-R5');
  await page.getByLabel('თქვენი ასაკი').fill('40');
  await next(page);
  await page.getByTestId('rent').fill('1500');
  for (const k of ['insurance', 'baggage', 'broker', 'settlement']) await page.getByTestId(`ex-${k}`).check();
  assert.match(await page.locator('.ex').first().innerText(), /1 663\.00 EUR/);
  await page.getByLabel('ფაქტიური ხარჯი (არასავალდებულო)').fill('600');
  await page.getByLabel('მაკლერის საკომისიო').fill('300');
  await page.getByLabel('დღიური ნორმა').fill('60');
  await next(page);
  const ot = await page.locator('.onetime').innerText();
  assert.match(ot, /600\.00 EUR/);
  assert.match(ot, /150\.00 EUR/);
  assert.match(ot, /3 600\.00 EUR/);
  assert.match(ot, /დაზღვევის წლიური ლიმიტი/);
  await page.close();
});

test('XSS: ტექსტი HTML-ად არ სრულდება', async () => {
  const { page } = await openPage();
  await page.evaluate(() => { window.__xss = 0; });
  await page.getByTestId('mission').fill('<img src=x onerror="window.__xss=1">');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#app img').count(), 0);
  assert.equal(await page.evaluate(() => window.__xss), 0);
  await page.close();
});

test('ონლაინ: ბაზრის ბარათი, ქირის ჩიპი, რბოლისგან დაცვა', async () => {
  const { page, seen, errors } = await openOnline({ delays: { 'AT-VIENNA': 700 } });
  await pickMission(page, 'Vienna');
  await page.locator('.market-load').waitFor();
  await pickMission(page, 'Ljubljana');
  await page.waitForTimeout(1200);
  assert.equal(await val(page, '[data-testid="market-rent"]'), '1000.00', 'ლიუბლიანა, არა ვენა');
  assert.match(await page.locator('.mcard').innerText(), /ნიუ-იორკი = 100/);
  await pickMission(page, 'Vienna');
  await page.waitForTimeout(900);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'd-step1-online.png'), fullPage: true });
  await next(page);
  await page.getByTestId('position').selectOption('A2-R5');
  await page.getByTestId('add-family').click(); await page.getByTestId('add-family').click();
  await page.locator('.fam-row').nth(1).locator('select').selectOption('child');
  await next(page);
  await page.getByTestId('use-market-rent').click();
  assert.equal(await page.getByTestId('rent').inputValue(), '3000.00', '3 საძინებელი (2 ოჯახის წევრი), ვენა ×1.5');
  for (const q of seen) assert.match(q, /^\?location=[A-Z0-9-]+&currency=(EUR|USD)$/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('შედარება: EUR + USD ბარათები გვერდიგვერდ, Numbeo-ს ქირით; მობილურზე გვერდი არ იშლება', async () => {
  const { page, errors } = await openOnline({ delays: { 'US-WASHINGTON': 300 } });
  await vienna(page);
  await page.getByTestId('compare-open').click();
  await page.locator('.ccard').first().waitFor();
  await pickMission(page, 'ვაშინგტონ საელჩო', 'compare-add');
  await page.waitForTimeout(800);
  const cards = page.locator('.ccard');
  assert.equal(await cards.count(), 2);
  assert.equal(await cards.nth(0).getByTestId('compare-S').getAttribute('data-value'), '4985.16');
  assert.match(await cards.nth(1).innerText(), /USD/);
  assert.match(await cards.nth(1).getByTestId('compare-S').getAttribute('data-value'), /^\d+\.\d{2}$/);
  assert.match(await cards.nth(1).innerText(), /Numbeo-ს საშუალო, ცენტრი, 3 საძინებელი/);
  assert.match(await cards.nth(0).innerText(), /დარჩება ქირისა და სწავლის შემდეგ/);
  assert.equal(await cards.nth(0).getByTestId('compare-remainder').getAttribute('data-value'), '3423.16');
  assert.match(await cards.nth(1).innerText(), /დარჩება ქირის შემდეგ/);
  assert.equal(await cards.nth(1).getByTestId('edu-not-applied').count(), 1);
  assert.deepEqual(errors, []);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'd-compare.png') });
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(100);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 0, `page overflow ${over}px`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'm-compare.png') });
  await page.close();
});

test('მობილური 375px: ყველა საფეხური, ჰორიზონტალური გადახვევის გარეშე', async () => {
  const { page } = await openPage({ width: 375, height: 800 });
  const shots = async (n) => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, `${n}: overflow ${over}px`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `m-${n}.png`), fullPage: true });
  };
  await vienna(page, { shots });
  await shots('step4');
  await page.close();
});

test('src/ui-ში innerHTML/outerHTML/insertAdjacentHTML/document.write არ გამოიყენება', () => {
  const dir = path.join(root, 'src/ui');
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
  walk(dir);
  for (const f of files) {
    const src = readFileSync(f, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.ok(!/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function\(/.test(src), f);
  }
});
