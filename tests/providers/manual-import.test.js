// Manual entry / JSON import tests and core contract rules. SYNTHETIC values only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseManualMarketJson, validateManualRecord, marketDataFromManualRecords, validateMarketData, createEmptyMarketData,
} from '../../src/providers/index.js';

const rec = (o = {}) => ({
  kind: 'manual-market-record', schemaVersion: 1, origin: 'json-import', locationId: 'AT-VIENNA', city: 'Vienna', countryCode: 'AT',
  metricType: 'rent', metric: 'centre_1br', value: '1200', currency: 'EUR',
  source: { name: 'Synthetic agency', url: 'https://example.org/x' }, sourceDate: '2026-09', enteredAt: '2026-10-29T09:00:00Z', ...o,
});
const idx = (o = {}) => rec({ metricType: 'index', metric: 'costOfLivingExcludingRent', value: '61', currency: null, baseline: { label: 'New York City', value: '100' }, ...o });
const file = (records) => JSON.stringify({ kind: 'market-import', schemaVersion: 1, records });

test('valid import → MarketData marked manual, never provider/fresh', () => {
  const r = parseManualMarketJson(file([rec(), idx()]), { allowedCurrencies: ['EUR', 'USD'] });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const md = marketDataFromManualRecords('AT-VIENNA', r.data.records);
  assert.ok(validateMarketData(md).ok);
  assert.equal(md.rent.items.centre_1br.status, 'manual');
  assert.equal(md.rent.items.centre_1br.origin, 'json-import');
  assert.equal(md.indices.status, 'manual');
  assert.equal(md.provider, null);
  assert.ok(md.warnings.some((w) => w.code === 'manual_entry'));
  const forged = structuredClone(md); forged.rent.items.centre_1br.status = 'fresh';
  assert.equal(validateMarketData(forged).ok, false);
});

test('errors are structured { path, code, message_ka }', () => {
  const r = parseManualMarketJson(file([rec({ value: 'abc' })]));
  assert.equal(r.ok, false);
  assert.equal(r.data, null);
  const e = r.errors.find((x) => x.path === 'records[0].value');
  assert.ok(e && e.code === 'not_positive_decimal' && /[ა-ჰ]/.test(e.message_ka));
});

test('rejects invalid JSON, wrong schema, unknown fields, too large', () => {
  assert.equal(parseManualMarketJson('{not json').errors[0].code, 'invalid_json');
  assert.equal(parseManualMarketJson(null).ok, false);
  assert.ok(parseManualMarketJson(JSON.stringify({ kind: 'market-import', schemaVersion: 2, records: [rec()] })).errors.some((e) => e.code === 'unsupported'));
  assert.ok(parseManualMarketJson(JSON.stringify({ kind: 'x', schemaVersion: 1, records: [] })).errors.some((e) => e.path === 'kind'));
  assert.ok(parseManualMarketJson(file([{ ...rec(), extra: 1 }])).errors.some((e) => e.code === 'unknown_field'));
  assert.ok(parseManualMarketJson(file([{ ...rec(), __proto__polluted: 1 }])).errors.some((e) => e.code === 'unknown_field'));
  assert.ok(parseManualMarketJson('{"__proto__": {"x": 1}, "kind": "market-import", "schemaVersion": 1, "records": []}').errors.some((e) => e.code === 'unknown_field'));
  assert.equal(parseManualMarketJson(' '.repeat(300 * 1024)).errors[0].code, 'too_large');
});

test('rejects unknown / disallowed currency', () => {
  assert.ok(parseManualMarketJson(file([rec({ currency: 'eur' })])).errors.some((e) => e.code === 'required_iso4217'));
  assert.ok(parseManualMarketJson(file([rec({ currency: 'XYZ' })]), { allowedCurrencies: ['EUR', 'USD'] }).errors.some((e) => e.code === 'not_allowed'));
  assert.ok(parseManualMarketJson(file([idx({ currency: 'EUR' })])).errors.some((e) => e.code === 'must_be_null_for_index'));
});

test('rejects script / markup text and javascript: URLs', () => {
  const r = parseManualMarketJson(file([rec({ city: '<script>alert(1)</script>', source: { name: 'x" onerror="y', url: 'javascript:alert(1)' }, note: '<img src=x>' })]));
  assert.equal(r.ok, false);
  const paths = r.errors.map((e) => e.path);
  for (const p of ['records[0].city', 'records[0].source.url', 'records[0].note']) assert.ok(paths.includes(p), p);
  assert.ok(!parseManualMarketJson(file([rec({ city: 'Vi‮enna' })])).ok, 'bidi override rejected');
});

test('rejects 2-bedroom metric, zero value, bad dates, duplicates, provider origin', () => {
  const codes = (r) => parseManualMarketJson(file(r)).errors.map((e) => e.code);
  assert.ok(codes([rec({ metric: 'centre_2br' })]).includes('unknown_rent_metric'));
  assert.ok(codes([rec({ value: '0' })]).includes('not_positive_decimal'));
  assert.ok(codes([rec({ value: 1200 })]).includes('not_positive_decimal'));
  assert.ok(codes([rec({ sourceDate: '2026-13' })]).includes('not_partial_date_or_null'));
  assert.ok(codes([rec({ enteredAt: 'yesterday' })]).includes('not_iso_datetime'));
  assert.ok(codes([rec(), rec()]).includes('duplicate_location_metric'));
  assert.ok(codes([rec({ origin: 'provider' })]).includes('must_be_manual_or_json_import'));
  assert.ok(codes([rec({ low: '2000', high: '1000' })]).includes('greater_than_high'));
});

test('manual form record (origin manual) validates; source date may be unknown', () => {
  const r = validateManualRecord(rec({ origin: 'manual', sourceDate: null, source: { name: 'Realtor', url: null } }), { allowedCurrencies: ['EUR'] });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('contract: country-level rent and values with matchStatus none are rejected', () => {
  const md = marketDataFromManualRecords('AT-VIENNA', [rec()]);
  const c = structuredClone(md); c.resolvedLocation.matchStatus = 'country-level';
  assert.ok(validateMarketData(c).errors.includes('rent: country_level_rent_not_allowed_as_city_rent'));
  const n = structuredClone(md); n.resolvedLocation.matchStatus = 'none';
  assert.ok(validateMarketData(n).errors.includes('resolvedLocation.matchStatus: none_but_values_present'));
  assert.ok(validateMarketData(createEmptyMarketData('AT-VIENNA', 'not_configured')).ok);
  assert.throws(() => createEmptyMarketData('AT-VIENNA', 'fresh'));
});
