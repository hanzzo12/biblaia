// Order №01-407 (2026-11-17, in force 2027-01-01): independent data spot-checks.
// Annex 4: values read by the verifier from sources/extracted/order-01-407-annex4.raw.json (the workbook itself is
// never opened). Annexes 2/3: read from the supplied .docx files (word/document.xml table text). Base amounts: the
// order's text layer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const data = JSON.parse(fs.readFileSync(process.env.NORMATIVE_DATA || path.join(ROOT, 'src/data/normative-data.json'), 'utf8'));
const raw4 = JSON.parse(fs.readFileSync(path.join(ROOT, 'sources/extracted/order-01-407-annex4.raw.json'), 'utf8'));
const orderText = fs.readFileSync(path.join(ROOT, 'sources/extracted/order-01-407.layout.txt'), 'utf8').replace(/\s+/g, ' ');
const decEq = (a, b) => Number(a) === Number(b) && /^\d+(\.\d+)?$/.test(String(a)) && /^\d+(\.\d+)?$/.test(String(b));

// [row, name fragment, K, E] — 15 rows read from the extract
const A4 = [
  [1, 'ავსტრიის', '1.543', '20'], [2, 'ბელგიის', '1.489', '18'], [6, 'დიდი ბრიტანეთისა', '1.798', '31'],
  [10, 'ქ.რომი', '1.281', '22'], [11, 'ქ.ბარი', '1.281', '22'], [33, 'შვეიცარიის', '1.842', '23'],
  [35, 'ხორვატიის', '1.385', '9'], [40, 'ვაშინგტონი', '1.572', '29'], [41, 'ნიუ–იორკი', '1.787', '34'],
  [42, 'სან-ფრანცისკო', '1.828', '31'], [48, 'თურქმენეთი', '1.729', '9'], [49, 'იაპონია', '1.478', '22'],
  [53, 'ირანის', '1.291', '18'], [66, 'უკრაინა', '1.272', '17'], [69, 'ჩინეთის', '1.509', '27'],
];
const newK = (row) => data.costCoefficients.filter((k) => k.sourceRef === 'SRC-01407-A4' && k.annex4Row === row);

test('new Annex 4: 69 rows; 15 independently read K/E rows match the data and the extract', () => {
  assert.equal(data.costCoefficients.filter((k) => k.sourceRef === 'SRC-01407-A4').length, 69);
  for (const [row, frag, K, E] of A4) {
    const k = newK(row);
    assert.equal(k.length, 1, `K-A4N-R${row}`);
    assert.equal(k[0].id, `K-A4N-R${row}`);
    assert.ok(decEq(k[0].k, K), `row ${row} K ${k[0].k} vs ${K}`);
    assert.equal(k[0].ePercent, E, `row ${row} E`);
    const r = raw4.rows.find((x) => x.cells?.[0]?.value === row);
    assert.ok(r && String(r.cells[1].value).includes(frag), `row ${row} label "${frag}"`);
    assert.ok(decEq(String(r.cells[2].value), K) && String(r.cells[3].value) === E, `row ${row} extract values`);
  }
});

test('missions link to the new rows (city rows for Washington, New York, Rome, Bari, Milan)', () => {
  const kOf = (id) => data.costCoefficients.find((k) => k.id === data.missions.find((m) => m.id === id).costCoefficientId);
  const expect = { 'M-A5-R1': 1, 'M-A5-R2': 2, 'M-A5-R20': 2, 'M-A6-R4': 40, 'M-A6-R5': 41, 'M-A6-R28': 41, 'M-A6-R38': 42,
    'M-A5-R15': 10, 'M-A5-R39': 11, 'M-A5-R43': 12, 'M-A6-R26': 66, 'M-A6-R15': 53 };
  for (const [id, row] of Object.entries(expect)) {
    const k = kOf(id);
    assert.equal(k?.sourceRef, 'SRC-01407-A4', `${id} uses the new Annex 4`);
    assert.equal(k?.annex4Row, row, `${id} -> new row ${row}`);
  }
  assert.equal(kOf('M-A5-R15').scope, 'city', 'Rome now has its own city row');
});

function docxRows(file) {
  const xml = execFileSync('unzip', ['-p', path.join(ROOT, 'sources/original', file), 'word/document.xml'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return [...xml.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((tr) => [...tr[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)]
    .map((tc) => [...tc[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('').trim()))
    .filter((c) => /^\d+$/.test(c[0]) && /^\d+$/.test(c[2] ?? '') && c[1] !== '2');
}

test('new Annex 2 (docx): 7 rows 100/80/75/70/65/60/55, referent and driver removed; data agrees', () => {
  const rows = docxRows('order-01-407-annex2.docx');
  assert.deepEqual(rows.map((r) => r[2]), ['100', '80', '75', '70', '65', '60', '55']);
  assert.ok(!rows.some((r) => /რეფერენტ|მძღოლ/.test(r[1])));
  assert.match(rows[2][1], /ადმინისტრაციული მენეჯერი, რომელიც დროებით\/მუდმივად ასრულებს/);
  const e = data.positionProfiles.find((p) => p.id === 'annex2').entries;
  assert.deepEqual(e.map((x) => [x.id, x.percent]), rows.map((r, i) => [`A2-R${i + 1}`, r[2]]));
  assert.ok(!e.some((x) => x.positions_ka.some((t) => /რეფერენტ|მძღოლ/.test(t))));
});

test('new Annex 3 (docx): 7 rows 100/75/70/65/60/55/50; row 7 without referent; data agrees', () => {
  const rows = docxRows('order-01-407-annex3.docx');
  assert.deepEqual(rows.map((r) => r[2]), ['100', '75', '70', '65', '60', '55', '50']);
  assert.equal(rows[6][1], 'მესამე მდივანი, ატაშე, უსაფრთხოების ოფიცერი');
  const e = data.positionProfiles.find((p) => p.id === 'annex3').entries;
  assert.deepEqual(e.map((x) => [x.id, x.percent]), rows.map((r, i) => [`A3-R${i + 1}`, r[2]]));
  assert.deepEqual(e[6].positions_ka, ['მესამე მდივანი', 'ატაშე', 'უსაფრთხოების ოფიცერი']);
  assert.ok(!data.positionProfiles.some((p) => p.entries.some((x) => x.id === 'A3-R8')));
});

test('base amounts 5000 EUR / 5600 USD from 2027-01-01 (order text), previous 3100 / 3495 kept', () => {
  assert.match(orderText, /საბაზისო თანხა განისაზღვროს შესაბამისად 5000 ევროსა და 5600 აშშ დოლარის ოდენობით/);
  assert.match(orderText, /ბრძანება ამოქმედდეს 2027 წლის 1 იანვრიდან/);
  const h = Object.fromEntries(data.baseAmounts.map((b) => [b.id, b]));
  assert.equal(h['H-EUR'].amount, '5000'); assert.equal(h['H-USD'].amount, '5600');
  for (const b of Object.values(h)) assert.equal(b.effectiveFrom, '2027-01-01');
  assert.equal(h['H-EUR'].previous?.amount, '3100'); assert.equal(h['H-USD'].previous?.amount, '3495');
});

test('previous edition kept under history: old Annex 2 (9 rows) and old Annex 4 (69 rows, Iran 1.89)', () => {
  const h = data.history;
  assert.equal(h.positionProfiles.find((p) => p.id === 'annex2').entries.length, 9);
  assert.equal(h.positionProfiles.find((p) => p.id === 'annex3').entries.length, 8);
  assert.equal(h.costCoefficients.length, 69);
  assert.equal(h.costCoefficients.find((k) => k.annex4Row === 22).k, '1.89');
});
