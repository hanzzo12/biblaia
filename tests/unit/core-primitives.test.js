// Developer unit tests: rational, decimal input, calendar, rule catalog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Q from '../../src/core/rational.js';
import { parseDecimalInput, formatAmount } from '../../src/core/decimal.js';
import * as cal from '../../src/core/calendar.js';
import { ruleCatalog, RULE_IDS } from '../../src/core/rule-catalog.js';
import { golden, parseExact } from './_core-helpers.mjs';

test('rational: exact arithmetic and normalisation', () => {
  const a = Q.fromDecimal('0.1'), b = Q.fromDecimal('0.2');
  assert.ok(Q.eq(Q.add(a, b), Q.fromDecimal('0.3')));
  assert.equal(Q.toExactString(Q.div(1, 3)), '1/3');
  assert.equal(Q.toExactString(Q.rat(6, -4)), '-3/2');
  assert.ok(Q.eq(Q.mul('2.06', '3100'), '6386'));
  assert.equal(Q.cmp('1.5', '1.50'), 0);
  assert.ok(Q.eq(Q.min('2', '3'), '2') && Q.eq(Q.max('2', '3'), '3'));
  assert.throws(() => Q.div(1, 0), RangeError);
  assert.throws(() => Q.fromDecimal('1,5'), TypeError);
  assert.throws(() => Q.fromDecimal(0.1), TypeError, 'floats rejected');
  assert.equal(Q.toDecimalString(Q.fromDecimal('993.725460')), '993.72546');
  assert.equal(Q.toDecimalString(Q.div(1, 3)), null);
  assert.ok(Q.eq(Q.fromExactString('15000/31'), Q.div(15000, 31)));
});

test('T-ROUND-01: half-up display rounding', () => {
  const c = golden('T-ROUND-01');
  assert.deepEqual(c.inputs.values.map((v) => Q.toFixed2(v)), c.expected.displayHalfUp);
  assert.equal(Q.toFixed2('-0.005'), '-0.01');
  assert.equal(Q.toFixed2('-0.004'), '0.00');
  assert.equal(Q.toFixed2(Q.div(15000, 31)), '483.87');
});

test('parseDecimalInput: accepted and rejected inputs', () => {
  const ok = (s, exp) => { const r = parseDecimalInput(s); assert.ok(r.ok, s); assert.ok(Q.eq(r.value, exp), s); };
  ok('1500', '1500'); ok('1500.5', '1500.5'); ok('1500,5', '1500.5'); ok(' 0 ', '0'); ok('0,01', '0.01'); ok('10000000', '10000000');
  for (const s of ['', '   ', null, undefined]) { const r = parseDecimalInput(s); assert.ok(r.ok); assert.equal(r.value, null, `empty ${s} → null, never 0`); }
  for (const s of ['1,500.00', '1.234,5', '1 500', '-5', '+5', 'Infinity', 'NaN', '1e9', 'abc', '10000000.01', '1.', '.5', '12a']) {
    const r = parseDecimalInput(s);
    assert.equal(r.ok, false, `should reject ${s}`);
    assert.equal(typeof r.error_ka, 'string');
  }
  assert.equal(parseDecimalInput(Number.NaN).ok, false);
});

test('formatAmount groups thousands and rounds half-up', () => {
  assert.equal(formatAmount('1234.567'), '1 234.57');
  assert.equal(formatAmount(Q.fromDecimal('4985.16327')), '4 985.16');
  assert.equal(formatAmount('-12.5'), '−12.50');
  assert.equal(formatAmount(null), '—');
});

test('T-DAY-01: inclusive day counts without time zones', () => {
  const c = golden('T-DAY-01');
  assert.deepEqual(c.inputs.ranges.map(([a, b]) => cal.daysInclusive(a, b)), c.expected.days);
});

test('calendar: leap years, month lengths, validation, months arithmetic', () => {
  assert.equal(cal.daysInMonth(2028, 2), 29);
  assert.equal(cal.daysInMonth(2100, 2), 28);
  assert.equal(cal.daysInMonth(2000, 2), 29);
  assert.equal(cal.isValidDate('2027-02-29'), false);
  assert.equal(cal.isValidDate('2028-02-29'), true);
  assert.equal(cal.isValidDate('2027-13-01'), false);
  assert.equal(cal.addMonths('2027-08-31', 6), '2028-02-29');
  assert.equal(cal.addMonths('2027-01-15', 6), '2027-07-15');
  assert.equal(cal.addDays('2027-12-31', 1), '2028-01-01');
  assert.equal(cal.addDays('2027-03-28', 3), '2027-03-31', 'DST weekend does not lose a day');
  assert.equal(cal.ageOn('2009-05-10', '2027-05-09'), 17);
  assert.equal(cal.ageOn('2009-05-10', '2027-05-10'), 18);
  for (let n = 700000; n < 700800; n += 37) assert.equal(cal.toOrdinal(cal.fromOrdinal(n)), n);
});

test('calendar: segmentation at month boundaries and change dates', () => {
  const s = cal.segmentPeriod('2027-01-20', '2027-03-10', ['2027-02-16', '2027-05-01', '2027-01-20']);
  assert.deepEqual(s.map((x) => [x.from, x.to, x.days, x.daysInMonth]), [
    ['2027-01-20', '2027-01-31', 12, 31], ['2027-02-01', '2027-02-15', 15, 28], ['2027-02-16', '2027-02-28', 13, 28], ['2027-03-01', '2027-03-10', 10, 31],
  ]);
  assert.equal(cal.overlapDays('2027-04-01', '2027-04-30', [{ from: '2027-03-25', to: '2027-04-10' }]), 10);
});

test('T-PRO-*: proration exact values', async () => {
  const { prorate } = await import('../../src/core/formulas.js');
  for (const id of ['T-PRO-01', 'T-PRO-02', 'T-PRO-03', 'T-PRO-04', 'T-PRO-05']) {
    const c = golden(id);
    const r = prorate(c.inputs.fullRate, c.inputs.days, c.inputs.monthDays);
    assert.ok(Q.eq(r, parseExact(c.expected.amount.exact)), id);
    assert.equal(Q.toFixed2(r), c.expected.amount.display, id);
    if (c.inputs.month) assert.equal(cal.daysInMonth(+c.inputs.month.slice(0, 4), +c.inputs.month.slice(5)), c.inputs.monthDays);
  }
});

test('rule catalog covers every rule ID in docs/rules.md and is in sync', () => {
  assert.equal(RULE_IDS.length, 75);
  const md = readFileSync(new URL('../../docs/rules.md', import.meta.url), 'utf8');
  for (const id of RULE_IDS) assert.ok(md.includes(id), id);
  for (const r of Object.values(ruleCatalog)) { assert.ok(r.title_ka); assert.ok(r.status.length); }
});

test('rule catalog is in sync with docs/rules.md (generator --check)', async () => {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath, [new URL('../../scripts/gen-rule-catalog.mjs', import.meta.url).pathname, '--check'], { encoding: 'utf8' });
  assert.match(out, /up to date \(75 rules\)/);
});
