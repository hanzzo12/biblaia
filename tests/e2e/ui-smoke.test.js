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

async function vienna(page) {
  await page.getByRole('combobox', { name: 'ძიება (ქართულად ან ლათინურად)' }).fill('Vienna');
  await page.keyboard.press('Enter');
  await page.getByLabel('თანამდებობა', { exact: true }).selectOption('A2-R5');
  await page.locator('[data-path="status.rentHead"]').getByLabel(/^არა/).check();
  for (let i = 0; i < 2; i++) await page.getByTestId('add-family').click();
  const cards = page.locator('#sec-family fieldset.card');
  await cards.nth(0).getByLabel('როლი').selectOption('spouse');
  await cards.nth(0).getByLabel('ასაკი (სრული წლები)').fill('38');
  await cards.nth(1).getByLabel('როლი').selectOption('child');
  await cards.nth(1).getByLabel('ასაკი (სრული წლები)').fill('8');
  await fieldByLabel(page, 'ბინის ყოველთვიური ქირა (G)').fill('1500');
  await page.getByRole('button', { name: '+ ბავშვის განათლების ხარჯი' }).click();
  await page.locator('[data-list="education"] fieldset').getByLabel('ბავშვი').selectOption({ index: 1 });
  await page.locator('[data-list="education"] fieldset').getByLabel('სწავლის საფასური (თვეში)').fill('1000');
  await page.waitForTimeout(100);
}

test('ოფლაინ file://: ვენის სცენარი, გარე მოთხოვნების გარეშე', async () => {
  const { page, external, errors } = await openPage();
  await vienna(page);
  assert.equal(await val(page, '[data-testid="S"]'), '4985.16');
  assert.equal(await val(page, '[data-component="education.total"] .row-value'), '938.00');
  assert.equal(await val(page, '[data-component="remainder"] .row-value'), '3423.16');
  assert.equal(await page.getByTestId('completeness').getAttribute('data-completeness'), 'complete');
  await page.getByTestId('offline-note').waitFor();
  assert.equal(await page.locator('.market-rent [data-status]').first().getAttribute('data-status'), 'not_configured');
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  const text = await page.locator('body').innerText();
  for (const b of BANNED) assert.ok(!text.includes(b), `აკრძალული ტერმინი: ${b}`);
  if (SHOTS) {
    await page.screenshot({ path: path.join(SHOTS, 'desktop.png'), fullPage: true });
    await page.emulateMedia({ media: 'print' });
    await page.screenshot({ path: path.join(SHOTS, 'print.png'), fullPage: true });
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
  assert.equal(await val(page, '[data-component="F"] .row-value'), '0.00');
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

test('XSS: შეყვანილი და იმპორტირებული ტექსტი HTML-ად არ სრულდება', async () => {
  const { page } = await openPage();
  await page.evaluate(() => { window.__xss = 0; });
  await vienna(page);
  const payload = '<img src=x onerror="window.__xss=1">';
  await page.locator('summary', { hasText: 'ხელით შეყვანა / JSON იმპორტი' }).click();
  await page.getByLabel('საშუალო თვიური თანხა').fill('1700');
  await page.getByLabel('წყაროს დასახელება *').fill(payload);
  await page.getByRole('button', { name: 'ჩანაწერის დამატება' }).click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#sec-market img, #sec-results img').count(), 0);
  assert.equal(await page.evaluate(() => window.__xss), 0);
  await page.close();
});

test('ბაზრის ქირა G-ში მხოლოდ ღილაკით და დადასტურებით', async () => {
  const { page } = await openPage();
  await vienna(page);
  await page.locator('summary', { hasText: 'ხელით შეყვანა / JSON იმპორტი' }).click();
  await page.getByLabel('საშუალო თვიური თანხა').fill('1700');
  await page.getByLabel('წყაროს დასახელება *').fill('სატესტო წყარო');
  await page.getByRole('button', { name: 'ჩანაწერის დამატება' }).click();
  const rent = fieldByLabel(page, 'ბინის ყოველთვიური ქირა (G)');
  assert.equal(await rent.inputValue(), '1500');
  await page.getByTestId('use-market-rent').click();
  assert.equal(await rent.inputValue(), '1500', 'დადასტურების გარეშე არ იცვლება');
  await page.getByRole('button', { name: 'დიახ, ჩავანაცვლო' }).click();
  assert.equal(await rent.inputValue(), '1700');
  await page.getByTestId('market-scenario-note').waitFor();
  await page.close();
});

test('JSON ექსპორტი → გასუფთავება → იმპორტი; localStorage მხოლოდ ღილაკით', async () => {
  const { page } = await openPage();
  await vienna(page);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()]);
  const file = await dl.path();
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(doc.kind, 'rotation-scenario');
  assert.equal(doc.schemaVersion, 1);
  await page.getByTestId('save-local').click();
  assert.equal(await page.evaluate(() => localStorage.length), 1);
  await page.getByTestId('clear').click();
  await page.getByTestId('clear-confirm').click();
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  assert.equal(await val(page, '[data-testid="S"]'), '');
  await page.getByTestId('import-json').setInputFiles(file);
  await page.waitForTimeout(100);
  assert.equal(await val(page, '[data-testid="S"]'), '4985.16');
  await page.getByTestId('import-json').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"kind":"rotation-scenario","schemaVersion":99}') });
  await page.waitForTimeout(100);
  assert.match(await page.locator('.export-msg').innerText(), /უარყოფილია/);
  assert.equal(await val(page, '[data-testid="S"]'), '4985.16');
  await page.close();
});

test('მობილური 375px: ჰორიზონტალური გადახვევა არ არის', async () => {
  const { page } = await openPage({ width: 375, height: 800 });
  await vienna(page);
  await page.locator('summary', { hasText: 'დამატებითი ხარჯები' }).click();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 0, `scrollWidth overflow ${over}px`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'mobile.png'), fullPage: true });
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
