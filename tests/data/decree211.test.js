// Independent spot-check of Government Decree №211 Annex 1, column 3 (daily rate for a short-term trip abroad,
// used by Order №01-82 pt 7) against src/data/normative-data.json `dailyRates`.
// Expected values read by the verifier from sources/original/decree211-matsne-3649787-28.pdf
// (page 10 checked visually: Japan 9100 JPY, UK 60 GBP, Spain 60 EUR, Turkey 45 EUR) and the text layer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const data = JSON.parse(fs.readFileSync(process.env.NORMATIVE_DATA || path.join(ROOT, 'src/data/normative-data.json'), 'utf8'));
const layout = fs.readFileSync(path.join(ROOT, 'sources/extracted/decree211.layout.txt'), 'utf8')
  .split('\n').map((l) => l.replace(/\s+/g, ' ').trim());

// [ISO country, name fragment in the decree, currency word in the decree, ISO currency, column 3, column 4, column 5]
const EXPECTED = [
  ['AT', 'ავსტრიის რესპუბლიკა', 'ევრო', 'EUR', '60', '40', '150'],
  ['US', 'ამერიკის შეერთებული', 'აშშ დოლარი', 'USD', '75', '50', '240'],
  ['AU', 'ავსტრალიის', 'ავსტრალიური', 'AUD', '80', '50', '210'],
  ['JP', 'იაპონია', 'იაპონური იენა', 'JPY', '9100', '5685', '27300'],
  ['CH', 'შვეიცარიის კონფედერაცია', 'შვეიცარული', 'CHF', '74', '46', '220'],
  ['GB', 'დიდი ბრიტანეთისა და', 'ინგლისური', 'GBP', '60', '38', '180'],
  ['UA', 'უკრაინა', 'აშშ დოლარი', 'USD', '45', '30', '180'],
  ['IR', 'ირანის ისლამური', 'აშშ დოლარი', 'USD', '45', '30', '100'],
  ['CN', 'ჩინეთის სახალხო', 'აშშ დოლარი', 'USD', '45', '30', '150'],
  ['CZ', 'ჩეხეთის რესპუბლიკა', 'ევრო', 'EUR', '45', '30', '180'],
  ['ES', 'ესპანეთის სამეფო', 'ევრო', 'EUR', '60', '40', '180'],
  ['TR', 'თურქეთის რესპუბლიკა', 'ევრო', 'EUR', '45', '30', '100'],
];

const rateFor = (iso) => data.dailyRates.filter((r) => r.countryId === iso && !r.locationId);

test('dailyRates exist and use column 3 of Decree 211 Annex 1', () => {
  assert.ok(Array.isArray(data.dailyRates) && data.dailyRates.length >= 50, `dailyRates: ${data.dailyRates?.length}`);
  for (const r of data.dailyRates) {
    assert.match(String(r.amount), /^\d+(\.\d+)?$/, `${r.id} amount is a decimal string`);
    assert.doesNotMatch(String(r.amount), /^0+(\.0+)?$/, `${r.id} amount is not 0`);
    assert.match(String(r.currency), /^[A-Z]{3}$/, `${r.id} ISO currency`);
  }
});

test('12 independently read column-3 rates match the data (incl. AT 60 EUR, US 75 USD, AU 80 AUD, JP JPY, CH CHF)', () => {
  for (const [iso, , , cur, c3, c4, c5] of EXPECTED) {
    const rows = rateFor(iso);
    assert.equal(rows.length, 1, `${iso}: exactly one country-level rate (got ${rows.length})`);
    const r = rows[0];
    assert.equal(r.amount, c3, `${iso} column 3`);
    assert.equal(r.currency, cur, `${iso} currency`);
    if (r.otherColumns) {
      assert.equal(r.otherColumns.c4_staffInHostState, c4, `${iso} column 4 (reference only)`);
      assert.equal(r.otherColumns.c5_accommodation, c5, `${iso} column 5 (reference only)`);
    }
  }
});

test('the expected values are present in the Decree 211 text layer next to the country name', () => {
  for (const [iso, name, curWord, , c3, c4, c5] of EXPECTED) {
    const i = layout.findIndex((l) => l.includes(name));
    assert.ok(i >= 0, `${iso}: "${name}" not found in decree211.layout.txt`);
    const win = layout.slice(Math.max(0, i - 2), i + 3).join(' ');
    assert.ok(win.includes(curWord), `${iso}: currency "${curWord}" near the name`);
    const nums = win.match(/\b\d+\b/g) || [];
    const at = nums.findIndex((n, k) => n === c3 && nums[k + 1] === c4 && nums[k + 2] === c5);
    assert.ok(at >= 0, `${iso}: "${c3} ${c4} ${c5}" not in order near the name (${nums.join(' ')})`);
  }
});

test('non-EUR/USD rates are kept in their own currency (no silent conversion)', () => {
  for (const iso of ['AU', 'JP', 'CH', 'GB']) {
    const r = rateFor(iso)[0];
    assert.ok(!['EUR', 'USD'].includes(r.currency), `${iso} kept as ${r.currency}`);
  }
});

test('Holy See has no daily rate (settlement undetermined), not a guessed value', () => {
  assert.equal(data.dailyRates.filter((r) => r.countryId === 'VA').length, 0);
});
