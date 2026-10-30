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
const fieldByLabel = (page, text) => page.getByLabel(text, { exact: true });
const search = (page) => page.getByRole('combobox', { name: 'ძიება (ქართულად ან ლათინურად)' });

async function vienna(page, { rent = '1500' } = {}) {
  await search(page).fill('Vienna');
  await page.keyboard.press('Enter');
  await page.getByLabel('თანამდებობა', { exact: true }).selectOption('A2-R5');
  for (let i = 0; i < 2; i++) await page.getByTestId('add-family').click();
  const rows = page.locator('#sec-family fieldset.member');
  await rows.nth(0).getByLabel('როლი').selectOption('spouse');
  await rows.nth(0).getByLabel('ასაკი', { exact: true }).fill('38');
  await rows.nth(1).getByLabel('როლი').selectOption('child');
  await rows.nth(1).getByLabel('ასაკი', { exact: true }).fill('8');
  if (rent !== null) await fieldByLabel(page, 'ბინის ყოველთვიური ქირა (G)').fill(rent);
  await page.getByRole('button', { name: '+ ბავშვის განათლების ხარჯი' }).click();
  await page.locator('[data-list="education"] fieldset').getByLabel('ბავშვი').selectOption({ index: 1 });
  await page.locator('[data-list="education"] fieldset').getByLabel('სწავლის საფასური (თვეში)').fill('1000');
  await page.waitForTimeout(100);
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

test('ოფლაინ file://: ვენის სცენარი, გარე მოთხოვნების გარეშე', async () => {
  const { page, external, errors } = await openPage();
  await vienna(page);
  assert.equal(await val(page, '[data-testid="S"]'), '4985.16');
  assert.equal(await val(page, '[data-component="education.total"] .row-value'), '938.00');
  assert.equal(await val(page, '.kcard[data-component="remainder"] .k-value'), '3423.16');
  assert.equal(await page.getByTestId('completeness').getAttribute('data-completeness'), 'complete');
  await page.getByTestId('offline-note').waitFor();
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  const text = await page.locator('body').innerText();
  for (const b of BANNED) assert.ok(!text.includes(b), `აკრძალული ტერმინი: ${b}`);
  if (SHOTS) {
    await page.screenshot({ path: path.join(SHOTS, 'offline-desktop.png'), fullPage: true });
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: path.join(SHOTS, 'print.pdf'), format: 'A4' });
  }
  await page.close();
});

test('ცარიელი ქირა = უცნობი; 0 = ქირა არ არის; არასწორი რიცხვი', async () => {
  const { page } = await openPage();
  await vienna(page);
  const rent = fieldByLabel(page, 'ბინის ყოველთვიური ქირა (G)');
  await rent.fill('');
  await page.waitForTimeout(50);
  assert.match(await page.getByTestId('rent-hint').innerText(), /უცნობია/);
  assert.equal(await page.getByTestId('completeness').getAttribute('data-completeness'), 'partial');
  await rent.fill('0');
  await page.waitForTimeout(50);
  assert.match(await page.getByTestId('rent-hint').innerText(), /G = 0/);
  assert.equal(await val(page, '.kcard[data-component="F"] .k-value'), '0.00');
  for (const bad of ['-5', '1.234,5', 'Infinity', '1e5', '99999999']) {
    await rent.fill(bad);
    await page.waitForTimeout(30);
    assert.equal(await rent.getAttribute('aria-invalid'), 'true', bad);
  }
  await rent.fill('1500,5');
  await page.waitForTimeout(50);
  assert.equal(await rent.getAttribute('aria-invalid'), null);
  await page.close();
});

test('XSS: შეყვანილი ტექსტი HTML-ად არ სრულდება (ეკრანი და ბეჭდვის ცხრილი)', async () => {
  const { page } = await openPage();
  await page.evaluate(() => { window.__xss = 0; });
  await vienna(page);
  await page.locator('#adv > summary').click();
  await page.getByLabel(/მოვალეობის შემსრულებელი \(პ\. 20¹\)/).check();
  await page.locator('#adv-status').getByLabel('აქტის რეკვიზიტები').first().fill('<img src=x onerror="window.__xss=1">');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#print-inputs img, #sec-results img').count(), 0);
  assert.match(await page.locator('#print-inputs').textContent(), /<img src=x/);
  assert.equal(await page.evaluate(() => window.__xss), 0);
  await page.close();
});

test('JSON ექსპორტი (შედარების არჩევანით) → გასუფთავება → იმპორტი; localStorage მხოლოდ ღილაკით', async () => {
  const { page } = await openPage();
  await vienna(page);
  await page.locator('[data-open-compare]').click();
  await page.getByTestId('compare-select').selectOption('M-A5-R1');
  await page.getByTestId('compare-add').click();
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()]);
  const file = await dl.path();
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(doc.kind, 'rotation-scenario');
  assert.equal(doc.schemaVersion, 1);
  assert.deepEqual(doc.compare, [{ missionId: 'M-A5-R1', rent: null }]);
  await page.getByTestId('save-local').click();
  assert.equal(await page.evaluate(() => localStorage.length), 1);
  await page.getByTestId('clear').click();
  await page.getByTestId('clear-confirm').click();
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  assert.equal(await val(page, '[data-testid="S"]'), '');
  await page.getByTestId('import-json').setInputFiles(file);
  await page.waitForTimeout(150);
  assert.equal(await val(page, '[data-testid="S"]'), '4985.16');
  assert.equal(await page.locator('[data-col="M-A5-R1"]').count(), 1);
  await page.getByTestId('import-json').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"kind":"rotation-scenario","schemaVersion":99}') });
  await page.waitForTimeout(100);
  assert.match(await page.locator('.export-msg').innerText(), /უარყოფილია/);
  assert.equal(await val(page, '[data-testid="S"]'), '4985.16');
  await page.close();
});

test('ონლაინ: 4 ბარათი, საძინებლები ოჯახით, რბოლისგან დაცვა, ქირა G-ში მხოლოდ ღილაკით', async () => {
  const { page, seen, errors } = await openOnline({ delays: { 'AT-VIENNA': 700 } });
  await search(page).fill('Vienna'); await page.keyboard.press('Enter');
  await page.locator('.mcard.skeleton').first().waitFor();
  await search(page).fill('Ljubljana'); await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  assert.equal(await page.getByTestId('market-rent-average').getAttribute('data-value'), '1000.00', 'ლიუბლიანა, არა ვენა');
  for (const k of ['rent', 'utilities', 'groceries', 'restaurants']) assert.equal(await page.locator(`.market [data-card="${k}"]`).count(), 1, k);
  assert.match(await page.locator('.market').innerText(), /ნიუ-იორკი = 100/);
  assert.match(await page.locator('.market').innerText(), /არა თვიური ხარჯი/);
  assert.match(await page.locator('.market').innerText(), /Numbeo\.com \(მოპოვებულია Apify-ის მეშვეობით\)/);
  // ვენა + 2 ოჯახის წევრი → 3 საძინებელი
  await vienna(page, { rent: '1500' });
  await page.waitForTimeout(900);
  assert.equal(await page.locator('[data-seg="beds"] input:checked').getAttribute('value'), '3');
  assert.equal(await page.getByTestId('market-rent-average').getAttribute('data-value'), '3000.00');
  const rent = fieldByLabel(page, 'ბინის ყოველთვიური ქირა (G)');
  await page.getByTestId('use-market-rent').click();
  assert.equal(await rent.inputValue(), '1500', 'დადასტურების გარეშე არ იცვლება');
  await page.getByRole('button', { name: 'დიახ, ჩავანაცვლო' }).click();
  assert.equal(await rent.inputValue(), '3000.00');
  for (const q of seen) assert.match(q, /^\?location=[A-Z0-9-]+&currency=(EUR|USD)$/);
  assert.deepEqual(errors, []);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'desktop.png'), fullPage: true });
  await page.close();
});

test('შედარება: სხვადასხვა ვალუტა სვეტებად, ქირა თითო ქალაქზე, ბაზარი პარალელურად', async () => {
  const { page, errors } = await openOnline({ delays: { 'US-WASHINGTON': 400 } });
  await vienna(page);
  await page.locator('[data-open-compare]').click();
  await page.getByRole('button', { name: 'მიმდინარე დაწესებულების დამატება' }).click();
  const wash = await page.evaluate(() => [...document.querySelectorAll('[data-testid="compare-select"] option')].find((o) => /ვაშინგტონ/.test(o.textContent) && /საელჩო/.test(o.textContent))?.value);
  await page.getByTestId('compare-select').selectOption(wash);
  await page.getByTestId('compare-add').click();
  const cols = page.locator('.ccol');
  assert.equal(await cols.count(), 2);
  assert.equal(await cols.nth(0).getByTestId('compare-S').getAttribute('data-value'), '4985.16');
  assert.match(await cols.nth(1).innerText(), /USD/);
  assert.equal(await cols.nth(1).getByTestId('compare-S').getAttribute('data-value'), '', 'ქირის გარეშე S დაუდგენელია');
  await cols.nth(1).getByTestId('compare-rent').fill('2500');
  await cols.nth(1).getByTestId('compare-rent').press('Tab');
  await page.waitForTimeout(800);
  assert.match(await cols.nth(1).getByTestId('compare-S').getAttribute('data-value'), /^\d+\.\d{2}$/);
  assert.equal(await cols.nth(1).locator('.mcard').count() >= 4, true);
  assert.deepEqual(errors, []);
  if (SHOTS) await page.locator('#sec-compare').screenshot({ path: path.join(SHOTS, 'compare.png') });
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(100);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 0, `page overflow ${over}px`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'compare-mobile.png') });
  await page.close();
});

test('ნიუ-იორკის გენ. საკონსულო, A2-R1: გაანგარიშება შეცდომის გარეშე', async () => {
  const { page, errors } = await openPage();
  await search(page).fill('გენერალური საკონსულო ნიუ-იორკ');
  await page.keyboard.press('Enter');
  assert.equal(await page.getByLabel('დაწესებულება', { exact: true }).inputValue(), 'M-A6-R28');
  await page.getByLabel('თანამდებობა', { exact: true }).selectOption('A2-R1');
  await fieldByLabel(page, 'ბინის ყოველთვიური ქირა (G)').fill('3000');
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.error-box').count(), 0);
  assert.match(await val(page, '[data-testid="S"]'), /^\d+\.\d{2}$/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('მობილური 375px: ჰორიზონტალური გადახვევა არ არის', async () => {
  const { page } = await openPage({ width: 375, height: 800 });
  await vienna(page);
  await page.locator('#adv > summary').click();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 0, `scrollWidth overflow ${over}px`);
  if (SHOTS) { await page.screenshot({ path: path.join(SHOTS, 'mobile-top.png') }); await page.screenshot({ path: path.join(SHOTS, 'mobile.png'), fullPage: true }); }
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
