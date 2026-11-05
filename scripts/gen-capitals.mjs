#!/usr/bin/env node
// დედაქალაქების ცხრილი ბაზრის „დედაქალაქის წესისთვის“ (contracts.md §9): ქვეყნის დედაქალაქად ითვლება
// ამ ქვეყანაში საქართველოს **საელჩოს** ადგილმდებარეობა (normative-data.json → missions[type=embassy].locationId).
// გამონაკლისები (OVERRIDES) ხელით არის მითითებული და დასაბუთებული. გაშვება: node scripts/gen-capitals.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'src/providers/capitals.json');

/** ხელით დადგენილი გამონაკლისები. */
export const OVERRIDES = {
  VA: { locationId: 'IT-ROME', basis: 'override', note: 'წმინდა საყდარი (ვატიკანი): ბაზრის მონაცემისთვის დედაქალაქად ითვლება რომი (მომხმარებლის წესი).' },
  RU: { basis: 'embassy-section', note: 'რუსეთში საელჩო არ არის — გამოყენებულია ინტერესების სექციის ადგილმდებარეობა (მოსკოვი).' },
  RS: { basis: 'only-location', note: 'სერბეთში მისია ნორმატიულ მონაცემებში არ არის — ქვეყნის ერთადერთი ლოკაცია (ბელგრადი).' },
};
/** ქვეყნები, სადაც საელჩო ოფიციალურ დედაქალაქში არ არის — წესით მაინც საელჩოს ქალაქი გამოიყენება (საინფორმაციო). */
export const EMBASSY_NOT_IN_CAPITAL = {
  NL: 'საელჩო ჰააგაშია; კონსტიტუციური დედაქალაქია ამსტერდამი.',
  IL: 'საელჩო თელ-ავივშია; დედაქალაქის სტატუსი (იერუსალიმი) საერთაშორისოდ სადავოა.',
};

export function deriveCapitals(data) {
  const loc = Object.fromEntries(data.locations.map((l) => [l.id, l]));
  const out = {};
  for (const c of data.countries) {
    const missions = data.missions.filter((m) => m.countryId === c.id);
    const embassies = [...new Set(missions.filter((m) => m.type === 'embassy').map((m) => m.locationId))];
    const ov = OVERRIDES[c.id];
    let locationId = null; let basis = 'embassy';
    if (ov && ov.locationId) { locationId = ov.locationId; basis = ov.basis; }
    else if (embassies.length === 1) locationId = embassies[0];
    else if (ov && ov.basis === 'embassy-section') { locationId = missions.find((m) => m.type === 'embassy-section')?.locationId ?? null; basis = ov.basis; }
    else if (ov && ov.basis === 'only-location') { const ls = data.locations.filter((l) => l.countryId === c.id); locationId = ls.length === 1 ? ls[0].id : null; basis = ov.basis; }
    if (!locationId || !loc[locationId]) throw new Error(`capital not derivable for ${c.id} (embassies: ${embassies.join(',') || 'none'})`);
    out[c.id] = {
      locationId, city_ka: loc[locationId].name_ka, basis,
      ...(ov?.note ? { note: ov.note } : {}),
      ...(EMBASSY_NOT_IN_CAPITAL[c.id] ? { embassyNotInCapital: EMBASSY_NOT_IN_CAPITAL[c.id] } : {}),
    };
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const data = JSON.parse(readFileSync(path.join(root, 'src/data/normative-data.json'), 'utf8'));
  const json = JSON.stringify({ _meta: { generatedBy: 'scripts/gen-capitals.mjs', rule: 'capital = location of the embassy mission (normative-data); overrides listed in OVERRIDES' }, capitals: deriveCapitals(data) }, null, 1) + '\n';
  if (process.argv.includes('--check')) {
    const cur = readFileSync(OUT, 'utf8');
    if (cur !== json) { console.error('✗ capitals.json is out of date — run node scripts/gen-capitals.mjs'); process.exit(1); }
    console.log('✓ capitals.json up to date');
  } else { writeFileSync(OUT, json); console.log(`✓ ${path.relative(root, OUT)} (${Object.keys(JSON.parse(json).capitals).length} countries)`); }
}
