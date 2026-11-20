// UI-ის დეველოპერული smoke ტესტი: ერთფაილიანი HTML file://-ით, ქსელი დაბლოკილი.
// გაშვება: npm run build && node --test tests/e2e/ui-smoke.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

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

function pdfInfo(file) {
  try {
    const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [file], { encoding: 'utf8' }))?.[1]);
    const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
    return { pages, text };
  } catch { return null; } // poppler-utils არ არის — შემოწმება გამოტოვდება
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
  await page.getByTestId('pos-A2-R5').check();
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
  await page.getByTestId('rent').fill(rent ?? ''); // ქირა წინასწარ ივსება Numbeo-თი — ტესტი ცხადად წერს/ასუფთავებს
  await page.getByTestId('edu').first().fill('1000');
  if (shots) await shots('step3');
  await next(page);
  await page.getByTestId('hero-remainder').waitFor();
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
    fetchedAt: '2026-10-20T10:00:00Z', sourceUpdatedAt: null, cache: { state: 'hit', expiresAt: '2026-11-19T10:00:00Z' },
    warnings: loc === 'AT-VIENNA' ? [{ code: 'reference_fx', message_ka: '≈ გადაყვანილია USD-დან Numbeo-ს კურსით 1 EUR = 1.08 USD, 31.10.2026' }] : [],
    ...(loc === 'AT-VIENNA' ? { budget: { status: 'cached', single: p(800), family4: p(2500), sourceUpdatedAt: '2026-10-31', source: 'snapshot' } } : {}),
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
  assert.equal(await val(page, '[data-testid="hero-remainder"]'), '4333.13');
  assert.equal(await val(page, '[data-testid="S"]'), '5895.13');
  assert.equal(await val(page, '[data-testid="edu"] .rc-value'), '938.00');
  assert.equal(await val(page, '[data-testid="F-value"]'), '1321.68');
  // ჯაჭვი = ბირთვის r.remainder ზუსტად
  assert.equal(await val(page, '[data-testid="chain-remainder"]'), '4333.13');
  const rb = page.getByTestId('rent-breakdown');
  assert.match(await rb.innerText(), /ბინის ძირითადი წილი \(T\)\s+1 143\.36 EUR/);
  assert.match(await rb.innerText(), /თქვენ ამატებთ\s+178\.32 EUR/);
  // ოფლაინ: ჩაშენებული ასლი (შენახული მონაცემი), EUR-ში
  assert.match(await page.getByTestId('market-result').innerText(), /შენახული მონაცემი · \d{2}\.\d{2}\.\d{4}/);
  assert.match(await val(page, '[data-testid="remainder-living"]'), /^-?\d+\.\d{2}$/);
  await page.getByTestId('how').click();
  assert.equal(await val(page, 'tr[data-component="D"] td'), '5716.82');
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  const text = await page.locator('body').innerText();
  for (const b of BANNED) assert.ok(!text.includes(b), `აკრძალული ტერმინი: ${b}`);
  assert.ok(!/R-[A-Z]+-/.test(await page.locator('#app').innerText()), 'წესების ID მთავარ ხედზე არ ჩანს');
  if (SHOTS) await shots('step4');
  // PDF ჩამოტვირთვა: ერთი გვერდი, ტექსტი (არა სურათი)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('pdf-download').click()]);
  const pdfFile = await dl.path();
  assert.match(readFileSync(pdfFile, 'latin1').slice(0, 8), /^%PDF-/);
  const info = pdfInfo(pdfFile);
  if (info) { assert.equal(info.pages, 1); assert.match(info.text, /4 333\.13 EUR/); assert.match(info.text, /დარჩენილი თანხა/); assert.match(info.text, /01-407/); }
  // საბაზისო თანხის შენიშვნა (ბრძანება №01-407) — ციფრები და თარიღი მონაცემებიდან
  assert.match(await page.getByTestId('base-note').innerText(), /№01-407.*5 000 EUR \/ 5 600 USD.*2027 წლის 1 იანვრიდან/);
  if (SHOTS) await dl.saveAs(path.join(SHOTS, 'result.pdf'));
  // ბეჭდვა: ერთი A4 გვერდი
  await page.emulateMedia({ media: 'print' });
  const printPath = path.join(SHOTS || path.join(root, '.shots'), 'print.pdf');
  await page.pdf({ path: printPath, format: 'A4', preferCSSPageSize: true });
  const pinfo = pdfInfo(printPath);
  if (pinfo) assert.equal(pinfo.pages, 1, 'print = 1 page');
  await page.close();
});

test('ქირის გარეშე: თანხა ქირის გარეშე და შენიშვნა; არასწორი თანხა', async () => {
  const { page } = await openPage();
  await vienna(page, { rent: null });
  assert.match(await page.locator('.hero').innerText(), /მიუთითეთ ქირა, რომ დარჩენილი თანხა გამოჩნდეს/);
  assert.match(await page.getByTestId('S-card').innerText(), /ქირის გარეშე/);
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
  await page.getByTestId('pos-A2-R1').check();
  assert.equal(await page.getByTestId('head').isChecked(), true);
  assert.equal(await page.locator('[data-testid="position"] input[type=radio]').count(), 7, 'დანართი №2 — 7 სტრიქონი (მონაცემებიდან)');
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
  await page.getByTestId('pos-A2-R5').check();
  await page.getByLabel('თქვენი ასაკი').fill('40');
  await next(page);
  await page.getByTestId('rent').fill('1500');
  for (const k of ['insurance', 'baggage', 'broker', 'settlement']) await page.getByTestId(`ex-${k}`).check();
  assert.match(await page.locator('.ins').innerText(), /წლიური ლიმიტი: 1 663\.00 EUR/);
  await page.locator('[data-person="EMP"] input').fill('1000');
  await page.getByLabel('ფაქტიური ხარჯი (არასავალდებულო)').fill('600');
  await page.getByLabel('მაკლერის საკომისიო').fill('300');
  assert.match(await page.getByTestId('settlement-auto').innerText(), /№211.*= 3 600\.00 EUR/);
  await next(page);
  const ot = await page.locator('.onetime').innerText();
  assert.match(ot, /600\.00 EUR/);
  assert.match(ot, /150\.00 EUR/);
  assert.match(ot, /3 600\.00 EUR/);
  assert.match(ot, /წლიური ლიმიტი/);
  assert.match(ot, /ანაზღაურდება: 1 000\.00 EUR/);
  await page.close();
});

test('„×“ გასუფთავება: მისია და ქირა', async () => {
  const { page } = await openPage();
  await pickMission(page, 'Vienna');
  assert.match(await page.getByTestId('mission-info').innerText(), /EUR/);
  await page.getByTestId('picker-clear').click();
  assert.equal(await page.getByTestId('mission').inputValue(), '');
  assert.equal(await page.getByTestId('mission-info').innerText(), '');
  await pickMission(page, 'Vienna');
  await next(page); await page.getByTestId('pos-A2-R5').check(); await next(page);
  await page.getByTestId('rent').fill('1500');
  await page.locator('.field:has([data-testid="rent"]) .clear-btn').click();
  assert.equal(await page.getByTestId('rent').inputValue(), '');
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

test('ონლაინ: ქირის წინასწარი შევსება, რბოლისგან დაცვა', async () => {
  const { page, seen, errors } = await openOnline({ delays: { 'AT-VIENNA': 700 } });
  // ნაბიჯ 1-ზე ფასების ბარათი აღარ ჩანს; რბოლისგან დაცვა — ქირის წინასწარ შევსებით
  await pickMission(page, 'Vienna');
  await pickMission(page, 'Ljubljana');
  assert.equal(await page.locator('.mcard').count(), 0, 'ნაბიჯ 1-ზე ფასები არ ჩანს');
  await next(page); await page.getByTestId('pos-A2-R5').check(); await next(page);
  await page.waitForTimeout(1200);
  assert.equal(await page.getByTestId('rent').inputValue(), '1000.00', 'ლიუბლიანა (1 საძ.), არა ვენა');
  await page.locator('.pill').nth(0).click();
  await pickMission(page, 'Vienna');
  await page.waitForTimeout(900);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'd-step1-online.png'), fullPage: true });
  await next(page);
  await page.getByTestId('pos-A2-R5').check();
  await page.getByTestId('add-family').click(); await page.getByTestId('add-family').click();
  await page.locator('.fam-row').nth(1).locator('select').selectOption('child');
  await next(page);
  // ქირა ავტომატურად ივსება Numbeo-ს საშუალოთი (3 საძინებელი, 2 ოჯახის წევრი, ვენა ×1.5)
  assert.equal(await page.getByTestId('rent').inputValue(), '3000.00');
  await page.getByTestId('rent-prefill-note').waitFor();
  await page.getByTestId('rent').fill('2000');
  await page.getByTestId('use-market-rent').click();
  assert.equal(await page.getByTestId('rent').inputValue(), '3000.00', 'Numbeo-ს ფასის დაბრუნება');
  // ქალაქის შეცვლისას ხელუხლებელი ფასი ახლდება
  await page.locator('.pill').nth(0).click();
  await pickMission(page, 'Ljubljana');
  await page.waitForTimeout(400);
  await page.locator('.pill').nth(2).click();
  assert.equal(await page.getByTestId('rent').inputValue(), '2000.00', 'ლიუბლიანა, 3 საძინებელი');
  for (const q of seen) assert.match(q, /^\?location=[A-Z0-9-]+&currency=(EUR|USD)$/);
  assert.deepEqual(errors, []);
  await page.close();
});

test('ონლაინ შედეგი: ცხოვრების ღირებულების ბლოკი და ნაშთი საცხოვრებელი ხარჯების შემდეგ', async () => {
  const { page, errors } = await openOnline();
  await vienna(page);
  await page.getByTestId('market-result').locator('.irow').first().waitFor();
  const mr = await page.getByTestId('market-result').innerText();
  assert.equal(await val(page, '[data-testid="market-result"] [data-testid="market-rent"]'), '3000.00');
  assert.match(mr, /გარეუბანი 2 250\.00/);
  assert.equal(await val(page, '[data-testid="market-result"] [data-testid="market-budget"]'), '3750.00');
  for (const k of ['rent', 'utilities', 'internet', 'groceries', 'restaurants', 'budget', 'index']) assert.equal(await page.locator(`[data-testid="market-result"] [data-tile="${k}"] svg`).count(), 1, k);
  assert.match(mr, /1 EUR = 1\.08 USD/);
  // ოჯახით → ოთხსულიანი ოჯახის შეფასება: 4333.13 − 3750.00
  assert.equal(await val(page, '[data-testid="remainder-living"]'), '583.13');
  assert.match(await page.getByTestId('chain').innerText(), /ოთხსულიანი ოჯახის/);
  assert.match(await page.getByTestId('chain').innerText(), /ქირა ზემოთ ერთხელ აკლდება/);
  assert.equal(await val(page, '[data-testid="hero-remainder"]'), '4333.13', 'ოფიციალური ნაწილი არ იცვლება');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('pdf-download').click()]);
  const info = pdfInfo(await dl.path());
  if (info) { assert.equal(info.pages, 1); assert.match(info.text, /583\.13 EUR/); assert.match(info.text, /ცხოვრების ღირებულება/); }
  if (SHOTS) { await page.screenshot({ path: path.join(SHOTS, 'd-step4-online.png'), fullPage: true }); await dl.saveAs(path.join(SHOTS, 'result-online.pdf')); }
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
  assert.equal(await cards.nth(0).getByTestId('compare-S').getAttribute('data-value'), '5895.13');
  assert.equal(await cards.nth(0).getByTestId('compare-remainder-living').getAttribute('data-value'), '583.13');
  assert.match(await cards.nth(1).getByTestId('compare-remainder-living').getAttribute('data-value'), /^-?\d+\.\d{2}$/);
  assert.match(await cards.nth(1).innerText(), /გამოკლებულია კომუნალური/);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('compare-pdf').click()]);
  const cinfo = pdfInfo(await dl.path());
  if (cinfo) { assert.equal(cinfo.pages, 1); assert.match(cinfo.text, /ვაშინგტონი/); assert.match(cinfo.text, /4 333\.13 EUR/); }
  if (SHOTS) await dl.saveAs(path.join(SHOTS, 'compare.pdf'));
  assert.match(await cards.nth(1).innerText(), /USD/);
  assert.match(await cards.nth(1).getByTestId('compare-S').getAttribute('data-value'), /^\d+\.\d{2}$/);
  assert.match(await cards.nth(1).innerText(), /Numbeo, ცენტრი, 3 საძინებელი/);
  assert.match(await cards.nth(0).innerText(), /დარჩება ქირისა და სწავლის შემდეგ/);
  assert.equal(await cards.nth(0).getByTestId('compare-remainder').getAttribute('data-value'), '4333.13');
  // სწავლა ითვლება ყველა ქალაქში: USD ბარათზე — გადაყვანილი Numbeo-ს კურსით
  assert.match(await cards.nth(1).innerText(), /დარჩება ქირისა და სწავლის შემდეგ/);
  assert.equal(await cards.nth(1).getByTestId('edu-converted').count(), 1);
  // ოჯახის დანამატი (C) ყველა ბარათზე იგივეა, რაც შედეგის გვერდზე
  for (const k of [0, 1]) assert.equal(await cards.nth(k).getAttribute('data-c'), '2');
  assert.deepEqual(errors, []);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'd-compare.png') });
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(100);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 0, `page overflow ${over}px`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'm-compare.png') });
  await page.close();
});

test('შედარება: 7 ქალაქი, დალაგება ინდექსით, ← → და გადათრევა, PDF 2 გვერდი', async () => {
  const { page, errors } = await openPage();
  await vienna(page);
  await page.getByTestId('compare-open').click();
  await page.locator('.ccard').first().waitFor();
  for (const q of ['ვაშინგტონ საელჩო', 'ბერლინ', 'პარიზ საელჩო', 'ტოკიო', 'ბაქო', 'ანკარა']) await pickMission(page, q, 'compare-add');
  await page.waitForTimeout(300);
  const cards = page.locator('.ccard');
  assert.equal(await cards.count(), 7, 'ლიმიტი აღარ არის');
  const cities = async () => page.locator('.ccard h3').allInnerTexts();
  const before = await cities();
  await page.getByTestId('compare-sort').selectOption('asc');
  const asc = await cities();
  await page.getByTestId('compare-sort').selectOption('desc');
  const desc = await cities();
  assert.equal(desc[0], asc[asc.length - 1]);
  assert.notDeepEqual(asc, before);
  await page.getByTestId('compare-sort').selectOption('mine');
  assert.deepEqual(await cities(), before);
  await cards.nth(0).getByTestId('compare-move-right').click();
  const moved = await cities();
  assert.equal(moved[1], before[0]); assert.equal(moved[0], before[1]);
  await cards.nth(3).dragTo(cards.nth(0));
  assert.equal((await cities())[0], moved[3]);
  assert.equal(await page.getByTestId('compare-sort').inputValue(), 'mine');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('compare-pdf').click()]);
  const info = pdfInfo(await dl.path());
  if (info) assert.equal(info.pages, 2, '6 ქალაქი გვერდზე');
  if (SHOTS) { await dl.saveAs(path.join(SHOTS, 'compare7.pdf')); await page.screenshot({ path: path.join(SHOTS, 'd-compare7.png') }); }
  assert.deepEqual(errors, []);
  await page.close();
});

test('ქალაქების სიძვირე: დარჩება ხელზე (K, E + Numbeo), პროფილი, დალაგება, მონიშვნა, PDF', async () => {
  const { page, errors, external } = await openPage();
  // პროფილი კალკულატორიდან: ვენა, პირველი/მეორე მდივანი 60%, მარტო — შედეგის გვერდის ციფრებთან შესადარებლად
  await pickMission(page, 'Vienna'); await next(page);
  await page.getByTestId('pos-A2-R6').check(); await next(page); await next(page);
  await page.getByTestId('hero-remainder').waitFor();
  const resAfterRent = await val(page, '[data-testid="hero-remainder"]');
  const resLeft = await val(page, '[data-testid="remainder-living"]');
  await page.getByTestId('cities-tab').click();
  const rows = page.locator('[data-testid="cities-table"] tbody tr');
  await rows.first().waitFor();
  assert.ok(await rows.count() >= 70, `rows ${await rows.count()}`);
  assert.equal(await page.getByTestId('cities-profile-position').inputValue(), 'A2-R6');
  assert.equal(await page.getByTestId('cities-profile-family').inputValue(), '0');
  const vie = page.locator('tr[data-location="AT-VIENNA"]');
  assert.equal(await vie.getByTestId('cities-col-left').getAttribute('data-value'), resLeft, 'იგივე, რაც შედეგის გვერდზე');
  assert.match(await vie.innerText(), new RegExp(resAfterRent.replace(/\B(?=(\d{3})+(?!\d))/g, ' ').replace('.', '\\.')));
  // ნაგულისხმევი: მეტი რჩება ხელზე → ნაკლები (EUR საფუძველზე), უცნობი — ბოლოში
  // რიგი: სრული შეფასება → მხოლოდ კომუნალური (data-partial) → მონაცემის გარეშე; თითოეულ ჯგუფში data-eur-ით
  const cells = async () => page.locator('[data-testid="cities-col-left"]').evaluateAll((els) => els.map((e) => ({ eur: e.getAttribute('data-eur') === '' ? null : Number(e.getAttribute('data-eur')), partial: e.getAttribute('data-partial') === '1' })));
  const tier = (c) => (c.eur == null ? 2 : c.partial ? 1 : 0);
  const checkOrder = (cs, dir) => {
    for (let i = 1; i < cs.length; i++) {
      assert.ok(tier(cs[i - 1]) <= tier(cs[i]), 'ჯგუფების რიგი');
      if (tier(cs[i - 1]) === tier(cs[i]) && tier(cs[i]) < 2) assert.ok(dir === 'desc' ? cs[i - 1].eur >= cs[i].eur : cs[i - 1].eur <= cs[i].eur, dir);
    }
  };
  const first = await cells();
  checkOrder(first, 'desc');
  assert.ok(!first[0].partial, 'ნაწილობრივი მონაცემის ქალაქი პირველი არ არის');
  await page.getByTestId('cities-sort').selectOption('left-asc');
  checkOrder(await cells(), 'asc');
  // პროფილის შეცვლა გადაითვლის
  await page.getByTestId('cities-profile-family').selectOption('2');
  assert.notEqual(await vie.getByTestId('cities-col-left').getAttribute('data-value'), resLeft);
  await rows.nth(0).locator('input[type=checkbox]').check();
  await rows.nth(2).locator('input[type=checkbox]').check();
  await page.getByTestId('cities-only-selected').check();
  assert.equal(await rows.count(), 2);
  await page.getByTestId('cities-only-selected').uncheck();
  await page.getByTestId('cities-sort').selectOption('left-desc');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'd-cities.png') });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('cities-pdf').click()]);
  const info = pdfInfo(await dl.path());
  if (info) { assert.ok(info.pages >= 3); assert.match(info.text, /ქალაქების სიძვირე/); assert.match(info.text, /დარჩება ხელზე/); }
  if (SHOTS) await dl.saveAs(path.join(SHOTS, 'cities.pdf'));
  await page.setViewportSize({ width: 375, height: 800 });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 0, `page overflow ${over}`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'm-cities.png') });
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
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

/** სტატიკური ჰოსტი (მაგ. Google Sites): /api არ არსებობს — ყველა სხვა მისამართი 404. */
async function openStaticHost(file) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const html = readFileSync(path.join(root, file));
  const api = []; const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== 'https://static.test') return r.abort();
    if (u.pathname === '/') return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    if (u.pathname.startsWith('/api/')) api.push(u.pathname + u.search);
    return r.fulfill({ status: 404, contentType: 'text/html', body: '<!doctype html>Not found' });
  });
  await page.goto('https://static.test/');
  return { page, api, pageErrors };
}
async function viennaAlone(page) {
  await pickMission(page, 'Vienna');
  await next(page);
  await page.getByTestId('pos-A2-R6').check();
  await next(page);
  const rent = await page.getByTestId('rent').inputValue();
  await next(page);
  await page.getByTestId('hero-remainder').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="remainder-living"]')?.getAttribute('data-value'));
  return rent;
}

test('გადმოსაწერი ფაილი (data-standalone) სტატიკურ ჰოსტზე: /api-ს არ მიმართავს, Numbeo-ს ჩაშენებული ასლით სრულად მუშაობს', async () => {
  assert.match(readFileSync(path.join(root, 'dist/rotation-calculator.html'), 'utf8').slice(0, 200), /<html lang="ka" data-standalone="1">/);
  assert.doesNotMatch(readFileSync(path.join(root, 'dist/web/index.html'), 'utf8').slice(0, 200), /data-standalone/);
  const { page, api, pageErrors } = await openStaticHost('dist/rotation-calculator.html');
  assert.equal(await viennaAlone(page), '1182.88', 'ქირა ივსება ჩაშენებული Numbeo-თი');
  assert.equal(await page.getByTestId('remainder-living').getAttribute('data-value'), '2548.55');
  assert.equal(await page.getByTestId('S').getAttribute('data-value'), '4757.54');
  await page.getByTestId('cities-tab').click();
  assert.equal(await page.locator('[data-testid="cities-col-left"]').count(), 80);
  assert.deepEqual(api, [], 'ქსელის მოთხოვნა /api-ზე არ უნდა გაიგზავნოს');
  assert.deepEqual(pageErrors, []);
  await page.close();
});

test('ონლაინ ვერსია სტატიკურ ჰოსტზე (/api → 404): ჩაშენებულ ასლზე გადადის', async () => {
  const { page, api, pageErrors } = await openStaticHost('dist/web/index.html');
  assert.equal(await viennaAlone(page), '1182.88');
  assert.equal(await page.getByTestId('remainder-living').getAttribute('data-value'), '2548.55');
  assert.ok(api.some((u) => u.startsWith('/api/market')), 'ონლაინ ვერსია ჯერ სერვერს მიმართავს');
  assert.deepEqual(pageErrors, []);
  await page.close();
});
