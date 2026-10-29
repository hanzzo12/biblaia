#!/usr/bin/env node
// Validates src/data/normative-data.json (schema: docs/data-schema.md).
// No dependencies. Exit code 0 = valid, 1 = invalid, 2 = cannot read input.
//
// Usage: node scripts/validate-data.mjs [path/to/normative-data.json]
//
// Checks: schema shape, unique IDs, every reference resolves, numeric strings
// are positive decimals, currency is EUR/USD, insurance caps have all 12 age
// bands, mission funding currency equals the currency (and annex) of its
// insurance/baggage rows, counts per annex (also against the raw extracts),
// removed rows are not selectable, every cap row belongs to exactly one
// institution, and the known corrections from the legacy audit.

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, 'src', 'data', 'normative-data.json');

const BANDS = ['0-18', '19-24', '25-29', '30-34', '35-39', '40-44', '45-49', '50-54', '55-59', '60-64', '65-69', '70+'];
const CURRENCIES = new Set(['EUR', 'USD']);
const MISSION_TYPES = new Set(['embassy', 'consulate-general', 'consulate', 'permanent-mission', 'mission-to-org', 'embassy-section', 'other']);
const LOCATION_BASIS = new Set(['source-explicit', 'inferred-capital', 'inferred-seat']);
const K_BASIS = new Set(['city-row', 'country-row', 'none']);
const DEC_RE = /^\d+(\.\d+)?$/;
// Expected counts as found in the supplied PDF (see docs/data-schema.md).
const EXPECTED = {
  annex2: 9, annex3: 8, annex4: 69,
  missionsA5: 44, missionsA6: 38,
  insA7: 44, insA8: 38, bagA9: 44, bagA10: 38,
};

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const check = (cond, m) => { if (!cond) err(m); return cond; };

let data;
try {
  data = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`cannot read ${file}: ${e.message}`);
  process.exit(2);
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isNullableStr = (v) => v === null || isStr(v);
const posDec = (v, where) => {
  if (!check(typeof v === 'string' && DEC_RE.test(v), `${where}: not a decimal string: ${JSON.stringify(v)}`)) return false;
  return check(/[1-9]/.test(v), `${where}: must be > 0 (got ${v}); missing values are null, never 0`);
};

// ---------------------------------------------------------------- shape
const TOP = {
  schemaVersion: 'number', rulesVersion: 'string', edition: 'object', sourceReferences: 'array',
  baseAmounts: 'array', parameters: 'array', positionProfiles: 'array', countries: 'array', locations: 'array',
  costCoefficients: 'array', missions: 'array', insuranceCaps: 'array', baggageCaps: 'array', dailyRates: 'array',
  dataGaps: 'array', removedEntries: 'array', normalizations: 'array',
};
for (const [k, t] of Object.entries(TOP)) {
  const v = data[k];
  const ok = t === 'array' ? Array.isArray(v) : t === 'object' ? isObj(v) : typeof v === t;
  check(ok, `top-level "${k}" must be ${t}`);
}
if (errors.length) finish();
check(data.schemaVersion === 1, 'schemaVersion must be 1');
check(isStr(data.rulesVersion), 'rulesVersion must be a non-empty string');
check(isStr(data.edition.latestAmendmentSeen) && isStr(data.edition.verification), 'edition.latestAmendmentSeen / verification required');

// ---------------------------------------------------------------- ids
const allIds = new Map();
function index(coll, name) {
  const m = new Map();
  for (const [i, x] of coll.entries()) {
    if (!check(isObj(x) && isStr(x.id), `${name}[${i}] must be an object with an id`)) continue;
    check(!m.has(x.id), `${name}: duplicate id ${x.id}`);
    check(!allIds.has(x.id) || allIds.get(x.id) === name, `id ${x.id} used in both ${allIds.get(x.id)} and ${name}`);
    allIds.set(x.id, name);
    m.set(x.id, x);
  }
  return m;
}
const src = index(data.sourceReferences, 'sourceReferences');
const base = index(data.baseAmounts, 'baseAmounts');
const params = index(data.parameters, 'parameters');
const profiles = index(data.positionProfiles, 'positionProfiles');
const countries = index(data.countries, 'countries');
const locations = index(data.locations, 'locations');
const kcoef = index(data.costCoefficients, 'costCoefficients');
const missions = index(data.missions, 'missions');
const ins = index(data.insuranceCaps, 'insuranceCaps');
const bag = index(data.baggageCaps, 'baggageCaps');
index(data.dailyRates, 'dailyRates');
index(data.dataGaps, 'dataGaps');
index(data.normalizations, 'normalizations');
const posEntries = new Map();
for (const p of data.positionProfiles) {
  check(Array.isArray(p.entries) && p.entries.length > 0, `positionProfiles ${p.id}: entries required`);
  for (const e of p.entries || []) {
    check(isStr(e.id) && !posEntries.has(e.id) && !allIds.has(e.id), `position entry id ${e.id} missing or duplicate`);
    posEntries.set(e.id, e);
  }
}

const ref = (coll, id, where, nullable = false) => {
  if (id === null && nullable) return true;
  return check(isStr(id) && coll.has(id), `${where}: unresolved reference ${JSON.stringify(id)}`);
};

// ---------------------------------------------------------------- sources
const pdfPath = join(ROOT, 'sources', 'original', 'rotation_sources.pdf');
const pdfSha = existsSync(pdfPath) ? createHash('sha256').update(readFileSync(pdfPath)).digest('hex') : null;
for (const s of data.sourceReferences) {
  check(isStr(s.title) && isStr(s.file), `sourceReferences ${s.id}: title/file required`);
  check(Array.isArray(s.pages) && s.pages.length === 2 && s.pages[0] <= s.pages[1], `sourceReferences ${s.id}: pages [from,to]`);
  check(/^[0-9a-f]{64}$/.test(s.sha256 || ''), `sourceReferences ${s.id}: sha256`);
  if (pdfSha && s.file === 'sources/original/rotation_sources.pdf') check(s.sha256 === pdfSha, `sourceReferences ${s.id}: sha256 does not match the PDF`);
}

// ---------------------------------------------------------------- base amounts / parameters
for (const b of data.baseAmounts) {
  check(CURRENCIES.has(b.currency), `baseAmounts ${b.id}: currency`);
  posDec(b.amount, `baseAmounts ${b.id}.amount`);
  ref(src, b.sourceRef, `baseAmounts ${b.id}.sourceRef`);
}
check(new Set(data.baseAmounts.map((b) => b.currency)).size === 2, 'baseAmounts: one per currency (EUR, USD)');
for (const p of data.parameters) {
  posDec(p.value, `parameters ${p.id}.value`);
  ref(src, p.sourceRef, `parameters ${p.id}.sourceRef`);
  check(isStr(p.citation), `parameters ${p.id}: citation required`);
}

// ---------------------------------------------------------------- positions
for (const p of data.positionProfiles) {
  ref(src, p.sourceRef, `positionProfiles ${p.id}.sourceRef`);
  const rows = new Set();
  for (const e of p.entries) {
    check(Number.isInteger(e.rowNo) && !rows.has(e.rowNo), `${e.id}: rowNo`);
    rows.add(e.rowNo);
    check(isStr(e.title_ka), `${e.id}: title_ka`);
    check(Array.isArray(e.positions_ka) && e.positions_ka.every(isStr), `${e.id}: positions_ka`);
    if (posDec(e.percent, `${e.id}.percent`)) check(Number(e.percent) <= 100, `${e.id}: percent > 100`);
    ref(src, e.sourceRef, `${e.id}.sourceRef`);
  }
}

// ---------------------------------------------------------------- geography
for (const c of data.countries) {
  check(/^[A-Z]{2}$/.test(c.iso2 || '') && c.id === c.iso2, `countries ${c.id}: iso2`);
  check(isStr(c.name_ka) && isStr(c.name_en), `countries ${c.id}: names`);
}
for (const l of data.locations) {
  ref(countries, l.countryId, `locations ${l.id}.countryId`);
  check(isStr(l.name_ka) && isStr(l.name_en) && Array.isArray(l.altNames), `locations ${l.id}: names/altNames`);
  check(!/საელჩო|საკონსულო|წარმომადგენლობა|Embassy|Consulate|Mission/.test(l.name_ka + l.name_en), `locations ${l.id}: must be a city, not an institution name`);
  if ('marketFallbackLocationId' in l) {
    ref(locations, l.marketFallbackLocationId, `locations ${l.id}.marketFallbackLocationId`);
    check(isStr(l.marketFallbackNote), `locations ${l.id}: fallback needs an explanatory note`);
  }
}

// ---------------------------------------------------------------- K / E
for (const k of data.costCoefficients) {
  check(Number.isInteger(k.annex4Row), `${k.id}: annex4Row`);
  ref(countries, k.countryId, `${k.id}.countryId`);
  check(k.locationIds === null || (Array.isArray(k.locationIds) && k.locationIds.length > 0), `${k.id}: locationIds null or non-empty`);
  for (const l of k.locationIds || []) {
    if (ref(locations, l, `${k.id}.locationIds`)) check(locations.get(l).countryId === k.countryId, `${k.id}: location ${l} in another country`);
  }
  check(k.scope === (k.locationIds ? 'city' : 'country'), `${k.id}: scope must match locationIds`);
  if (posDec(k.k, `${k.id}.k`)) check(Number(k.k) > 0.5 && Number(k.k) < 5, `${k.id}: implausible K ${k.k}`);
  if (posDec(k.ePercent, `${k.id}.ePercent`)) check(Number(k.ePercent) < 100, `${k.id}: E must be < 100`);
  ref(src, k.sourceRef, `${k.id}.sourceRef`);
}
check(new Set(data.costCoefficients.map((k) => k.annex4Row)).size === data.costCoefficients.length, 'costCoefficients: duplicate annex4Row');

// ---------------------------------------------------------------- caps
for (const c of data.insuranceCaps) {
  check(CURRENCIES.has(c.currency), `${c.id}: currency`);
  check(c.annex === (c.currency === 'EUR' ? 7 : 8), `${c.id}: currency ${c.currency} does not match annex ${c.annex}`);
  check(isObj(c.bands), `${c.id}: bands`);
  const keys = Object.keys(c.bands || {});
  check(keys.length === 12 && BANDS.every((b) => keys.includes(b)), `${c.id}: must have exactly the 12 bands ${BANDS.join(',')}`);
  for (const b of BANDS) if (c.bands && b in c.bands) posDec(c.bands[b], `${c.id}.bands[${b}]`);
  ref(src, c.sourceRef, `${c.id}.sourceRef`);
}
for (const c of data.baggageCaps) {
  check(CURRENCIES.has(c.currency), `${c.id}: currency`);
  check(c.annex === (c.currency === 'EUR' ? 9 : 10), `${c.id}: currency ${c.currency} does not match annex ${c.annex}`);
  posDec(c.amount, `${c.id}.amount`);
  ref(src, c.sourceRef, `${c.id}.sourceRef`);
}

// ---------------------------------------------------------------- missions
const capUse = new Map();
for (const m of data.missions) {
  const w = `missions ${m.id}`;
  check(m.annex === 5 || m.annex === 6, `${w}: annex must be 5 or 6`);
  check(Number.isInteger(m.rowNo), `${w}: rowNo`);
  check(m.id === `M-A${m.annex}-R${m.rowNo}`, `${w}: id must be M-A<annex>-R<row>`);
  check(isStr(m.rawLabel) && isStr(m.name_ka) && isStr(m.name_en), `${w}: rawLabel/name_ka/name_en`);
  check(MISSION_TYPES.has(m.type), `${w}: type ${m.type}`);
  check(LOCATION_BASIS.has(m.locationBasis), `${w}: locationBasis`);
  check(K_BASIS.has(m.costCoefficientBasis), `${w}: costCoefficientBasis`);
  check(CURRENCIES.has(m.fundingCurrency), `${w}: fundingCurrency`);
  check(m.fundingCurrency === (m.annex === 5 ? 'EUR' : 'USD'), `${w}: Annex ${m.annex} institutions are funded in ${m.annex === 5 ? 'EUR' : 'USD'}`);
  ref(countries, m.countryId, `${w}.countryId`);
  if (ref(locations, m.locationId, `${w}.locationId`)) check(locations.get(m.locationId).countryId === m.countryId, `${w}: location in another country`);
  ref(src, m.sourceRef, `${w}.sourceRef`);
  // K: null allowed only with basis "none" and an explanation
  if (m.costCoefficientId === null) {
    check(m.costCoefficientBasis === 'none' && isStr(m.notes), `${w}: null K needs basis "none" and a note`);
  } else if (ref(kcoef, m.costCoefficientId, `${w}.costCoefficientId`)) {
    const k = kcoef.get(m.costCoefficientId);
    check(k.countryId === m.countryId, `${w}: K row ${k.id} is for another country`);
    check(m.costCoefficientBasis === (k.scope === 'city' ? 'city-row' : 'country-row'), `${w}: costCoefficientBasis does not match ${k.id}.scope`);
    if (k.locationIds) check(k.locationIds.includes(m.locationId), `${w}: city row ${k.id} is for another city`);
    // a city-specific row for this mission's city must take priority over the country row
    const cityRow = data.costCoefficients.find((x) => x.locationIds && x.locationIds.includes(m.locationId));
    if (cityRow) check(cityRow.id === k.id, `${w}: city-specific row ${cityRow.id} must take priority over ${k.id}`);
  }
  for (const [coll, key] of [[ins, 'insuranceCapId'], [bag, 'baggageCapId']]) {
    if (m[key] === null) { warnings.push(`${w}: ${key} is null (undetermined)`); continue; }
    if (!ref(coll, m[key], `${w}.${key}`)) continue;
    const c = coll.get(m[key]);
    check(c.currency === m.fundingCurrency, `${w}: ${key} currency ${c.currency} != funding currency ${m.fundingCurrency}`);
    capUse.set(m[key], (capUse.get(m[key]) || []).concat(m.id));
  }
}
for (const id of [...ins.keys(), ...bag.keys()]) {
  const users = capUse.get(id) || [];
  check(users.length === 1, `${id}: must belong to exactly one institution (used by ${users.length}: ${users.join(', ')})`);
}

// ---------------------------------------------------------------- counts
const count = (arr, f) => arr.filter(f).length;
const counts = {
  annex2: profiles.get('annex2')?.entries.length, annex3: profiles.get('annex3')?.entries.length,
  annex4: data.costCoefficients.length,
  missionsA5: count(data.missions, (m) => m.annex === 5), missionsA6: count(data.missions, (m) => m.annex === 6),
  insA7: count(data.insuranceCaps, (c) => c.annex === 7), insA8: count(data.insuranceCaps, (c) => c.annex === 8),
  bagA9: count(data.baggageCaps, (c) => c.annex === 9), bagA10: count(data.baggageCaps, (c) => c.annex === 10),
};
for (const [k, v] of Object.entries(EXPECTED)) check(counts[k] === v, `count ${k}: expected ${v}, got ${counts[k]}`);
// cross-check with the raw extracts when present
const rawMap = { 2: 'annex2', 3: 'annex3', 4: 'annex4', 5: 'missionsA5', 6: 'missionsA6', 7: 'insA7', 8: 'insA8', 9: 'bagA9', 10: 'bagA10' };
const removedRaw = [];
for (const [n, key] of Object.entries(rawMap)) {
  const p = join(ROOT, 'sources', 'extracted', `annex${String(n).padStart(2, '0')}.raw.json`);
  if (!existsSync(p)) { warnings.push(`raw extract ${p} not found; raw count check skipped`); continue; }
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  check(raw.counts.effectiveEntries === counts[key], `annex ${n}: normalized count ${counts[key]} != raw effective entries ${raw.counts.effectiveEntries}`);
  for (const r of raw.rows) if (r.flags.includes('removed')) removedRaw.push(`${n}:${r.rowNo}`);
}

// ---------------------------------------------------------------- removed rows not selectable
const removed = new Set(data.removedEntries.map((r) => `${r.annex}:${r.rowNo}`));
for (const r of removedRaw) check(removed.has(r), `removed raw row ${r} not listed in removedEntries`);
for (const m of data.missions) check(!removed.has(`${m.annex}:${m.rowNo}`), `${m.id}: refers to a removed row`);
for (const c of [...data.insuranceCaps, ...data.baggageCaps]) check(!removed.has(`${c.annex}:${c.rowNo}`), `${c.id}: refers to a removed row`);

// ---------------------------------------------------------------- normalizations
for (const n of data.normalizations) {
  check(Number.isInteger(n.annex) && isStr(n.reason) && 'raw' in n && 'normalized' in n, `${n.id}: annex/raw/normalized/reason required`);
}
check(data.dailyRates.length > 0 || data.dataGaps.some((g) => (g.affects || []).includes('dailyRates')), 'dailyRates empty without a dataGaps entry');

// ---------------------------------------------------------------- known corrections (legacy audit)
const mission = (id) => missions.get(id);
const kOf = (id) => kcoef.get(mission(id)?.costCoefficientId)?.k;
const insOf = (id, band) => ins.get(mission(id)?.insuranceCapId)?.bands?.[band];
const bagOf = (id) => bag.get(mission(id)?.baggageCapId)?.amount;
const known = [
  ['T-DATA-IRAN-K', kOf('M-A6-R15') === '1.89', 'Iran K = 1.89 (Annex 4 row 22)'],
  ['T-DATA-ODESA-INS', insOf('M-A6-R29', '40-44') === '734', 'Odesa insurance 40-44 = 734 USD (Annex 8 row 25)'],
  ['T-DATA-KYIV-INS', insOf('M-A6-R26', '40-44') === '1137', 'Kyiv insurance 40-44 = 1137 USD (Annex 8 row 22)'],
  ['T-DATA-LYON-BAG', bagOf('M-A5-R44') === '1950', 'Lyon baggage = 1950 EUR (Annex 9 row 43)'],
  ['T-DATA-STUTTGART', !!mission('M-A5-R41') && mission('M-A5-R41').locationId === 'DE-STUTTGART', 'Stuttgart CG present (Annex 5 row 41)'],
  ['T-DATA-COE', !!mission('M-A5-R7') && mission('M-A5-R7').locationId === 'FR-STRASBOURG', 'Council of Europe mission present, in Strasbourg (Annex 5 row 7)'],
  ['T-DATA-NATO-SEPARATE', !!mission('M-A5-R20') && mission('M-A5-R20').id !== mission('M-A5-R2')?.id, 'NATO mission separate from embassy in Belgium'],
  ['T-DATA-NY-SEPARATE', !!mission('M-A6-R5') && !!mission('M-A6-R28') && mission('M-A6-R5').insuranceCapId !== mission('M-A6-R28').insuranceCapId, 'UN mission and NY CG are separate institutions with own rows'],
  ['T-DATA-VATICAN-K-NULL', mission('M-A5-R37')?.costCoefficientId === null, 'Holy See K undetermined (no Annex 4 row)'],
  ['T-DATA-NO-SERBIA-MISSION', !data.missions.some((m) => ['RS', 'ME'].includes(m.countryId)), 'no Serbia/Montenegro mission'],
  ['T-DATA-NO-MUNICH', !data.locations.some((l) => /Munich|München/.test(l.name_en)), 'no Munich location'],
  ['T-DATA-COUNTS', data.missions.length === 82, '82 institutions (44 EUR + 38 USD)'],
];
for (const [id, ok, msg] of known) check(ok, `${id}: ${msg}`);

finish();

function finish() {
  for (const w of warnings) console.warn(`warning: ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`error: ${e}`);
    console.error(`\n${errors.length} error(s) in ${file}`);
    process.exit(1);
  }
  console.log(`OK ${file}`);
  console.log(`  missions ${data.missions.length} (A5 ${counts.missionsA5}, A6 ${counts.missionsA6}); K rows ${counts.annex4}; insurance ${data.insuranceCaps.length}; baggage ${data.baggageCaps.length}; positions A2 ${counts.annex2}, A3 ${counts.annex3}; normalizations ${data.normalizations.length}`);
  process.exit(0);
}
