// Shared helpers for core unit tests (not a test file itself).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { R, div, eq, toFixed2 } from '../../src/core/rational.js';
import { emptyScenario, emptyFamilyMember } from '../../src/core/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'normative-data.json'), 'utf8'));
export const GOLDEN = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'golden-cases.json'), 'utf8'));
export const golden = (id) => {
  const c = GOLDEN.cases.find((x) => x.id === id);
  if (!c) throw new Error(`golden case ${id} missing`);
  return c;
};
export const goldenOfKind = (...kinds) => GOLDEN.cases.filter((c) => kinds.includes(c.kind));

/** Parse golden "exact": "123.45", "15000/31" or "59821.95924/31". */
export function parseExact(s) {
  const [a, b] = String(s).split('/');
  return b === undefined ? R(a) : div(R(a), R(b));
}
/** Parse a Component's exact ("n/d" or decimal). */
export function compExact(c) {
  assert.ok(c, 'component missing');
  assert.notEqual(c.exact, null, `component ${c.id} has no value (status ${c.status})`);
  return parseExact(c.exact);
}
/** Assert a Component or Rational equals golden {exact, display} or a plain decimal string. */
export function assertGolden(actual, expected, msg = '') {
  const value = actual && typeof actual === 'object' && 'exact' in actual && 'status' in actual ? compExact(actual) : R(actual);
  if (typeof expected === 'string') {
    assert.ok(eq(value, parseExact(expected)), `${msg}: expected ${expected}, got ${toFixed2(value)}`);
    return;
  }
  assert.ok(eq(value, parseExact(expected.exact)), `${msg}: expected exact ${expected.exact}, got ${toFixed2(value)} (${actual?.exact ?? ''})`);
  if (expected.display) assert.equal(toFixed2(value), expected.display, `${msg}: display`);
  if (actual && actual.value !== undefined && actual.status) assert.equal(actual.value, expected.display, `${msg}: component value`);
}

/**
 * Minimal synthetic normative data: one institution with chosen currency/H/A/K/E and caps.
 */
export function synthData({ currency = 'EUR', H = currency === 'EUR' ? '3100' : '3495', A = '65', annex3A = null, K = '2.06', E = '21', bag = '1650', bands = null } = {}) {
  const b = bands || ['864', '1025', '1265', '1344', '1504', '1663', '1982', '2300', '2700', '3099', '4055', '5652'];
  const keys = ['0-18', '19-24', '25-29', '30-34', '35-39', '40-44', '45-49', '50-54', '55-59', '60-64', '65-69', '70+'];
  const annex = currency === 'EUR' ? 5 : 6;
  return {
    schemaVersion: 1, rulesVersion: 'synthetic-test',
    baseAmounts: [{ id: 'H-EUR', currency: 'EUR', amount: currency === 'EUR' ? H : '3100' }, { id: 'H-USD', currency: 'USD', amount: currency === 'USD' ? H : '3495' }],
    parameters: DATA.parameters,
    positionProfiles: [
      { id: 'annex2', entries: [
        { id: 'A2-R1', rowNo: 1, title_ka: 'ელჩი', positions_ka: [], percent: '100' },
        { id: 'A2-R2', rowNo: 2, title_ka: 'გენერალური კონსული', positions_ka: [], percent: '80' },
        { id: 'A2-R3', rowNo: 3, title_ka: 'დესპანი', positions_ka: [], percent: '75' },
        { id: 'A2-RX', rowNo: 9, title_ka: 'test', positions_ka: [], percent: A }] },
      { id: 'annex3', entries: [{ id: 'A3-RX', rowNo: 8, title_ka: 'test', positions_ka: [], percent: annex3A ?? A }] },
    ],
    countries: [{ id: 'ZZ', iso2: 'ZZ', name_ka: 'ტესტი', name_en: 'Test' }],
    locations: [{ id: 'ZZ-CITY', countryId: 'ZZ', name_ka: 'ქალაქი', name_en: 'City', altNames: [], region: null }],
    costCoefficients: [{ id: 'K-T', annex4Row: 1, rawLabel: 'test', countryId: 'ZZ', locationIds: null, scope: 'country', k: K, ePercent: E }],
    missions: [{ id: 'M-T', annex, rowNo: 1, rawLabel: 'test', name_ka: 'ტესტის საელჩო', name_en: 'Test embassy', type: 'embassy', countryId: 'ZZ', locationId: 'ZZ-CITY',
      locationBasis: 'inferred-capital', fundingCurrency: currency, costCoefficientId: 'K-T', costCoefficientBasis: 'country-row', insuranceCapId: 'INS-T', baggageCapId: 'BAG-T' }],
    insuranceCaps: [{ id: 'INS-T', annex: currency === 'EUR' ? 7 : 8, rowNo: 1, currency, bands: Object.fromEntries(keys.map((k, i) => [k, b[i]])) }],
    baggageCaps: [{ id: 'BAG-T', annex: currency === 'EUR' ? 9 : 10, rowNo: 1, currency, amount: bag }],
    dailyRates: [], sourceReferences: [], normalizations: [],
  };
}

/** Scenario for the synthetic institution. */
export function synthScenario({ C = 0, G = null, head = false, mode = 'annex2', entryId = null, family = null, ...rest } = {}) {
  const sc = emptyScenario();
  sc.missionId = 'M-T';
  sc.position = { mode, entryId: entryId ?? (mode === 'annex3' ? 'A3-RX' : 'A2-RX') };
  sc.status.rentHead = head === null ? null : head ? 'head' : 'not-head';
  sc.family = family ?? Array.from({ length: C }, (_, i) => ({ ...emptyFamilyMember(`F${i + 1}`, `წევრი ${i + 1}`), role: i === 0 ? 'spouse' : 'child', age: i === 0 ? 40 : 10 }));
  sc.rent = { ...sc.rent, amount: G };
  return Object.assign(sc, rest);
}
