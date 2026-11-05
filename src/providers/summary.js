// @ts-check
/**
 * „ქალაქების სიძვირე“ — ყველა მისიის ქალაქის კომპაქტური სია (ინდექსები + ცენტრის 1-საძინებლიანი ქირა).
 * სუფთა მოდული: Worker (`GET /api/market/summary`) და კლიენტი (file:// / API-ის ჩავარდნისას) ერთსა და იმავე ფუნქციას იყენებენ.
 *
 * თითო ველზე იგივე რიგი, რაც /api/market-ში: KV → Apify-ის ასლი → მომხმარებლის ასლი → დედაქალაქი (იგივე რიგით).
 * ინდექსები ერთი წყაროდან (თანმიმდევრულობისთვის); `source` = ქირის წყარო, ქირის არქონისას — ინდექსების წყარო.
 * თანხები მისიის დაფინანსების ვალუტაში. Apify არასოდეს გამოიძახება.
 */
import { snapshotEntryToMarketData } from './snapshot.js';
import { apifySnapshotEntryToMarketData } from './apify-snapshot.js';
import { capitalFor } from './resolve.js';
import { isPositiveDecimalString } from './market-contract.js';
import { estimateBudget } from './budget.js';

export const SUMMARY_SCHEMA_VERSION = 1;
export const SUMMARY_SOURCES = Object.freeze(['kv', 'apify-snapshot', 'user-snapshot', 'capital']);

/**
 * @typedef {{ costOfLivingPlusRent: string|null, costOfLiving: string|null, rent: string|null }} SummaryIndices
 * @typedef {{ locationId: string, city_ka: string, country_ka: string|null, currency: string|null, indices: SummaryIndices,
 *             rentCentre1br: string|null, source: string|null, sourceDate: string|null, fallbackFrom?: { locationId: string, city_ka: string },
 *             budget: { single: string|null, family4: string|null, basis: 'numbeo'|'estimated-from-index', fromCapital: boolean } | null }} SummaryRow
 * @typedef {{ schemaVersion: 1, generatedAt: string|null, rows: SummaryRow[] }} MarketSummary
 * @typedef {{ src: 'kv'|'apify-snapshot'|'user-snapshot', md: any, date: string|null }} Layer
 */

/** მისიის ლოკაციები, ქართული სახელები და დაფინანსების ვალუტა. @param {any} data normative-data.json */
export function missionLocations(data) {
  const countries = Object.fromEntries((data.countries || []).map((/** @type {any} */ c) => [c.id, c.name_ka]));
  /** @type {Record<string, string>} */
  const currency = {};
  for (const m of data.missions || []) if (m.locationId && m.fundingCurrency && !currency[m.locationId]) currency[m.locationId] = m.fundingCurrency;
  return (data.locations || []).filter((/** @type {any} */ l) => currency[l.id]).map((/** @type {any} */ l) => ({
    locationId: l.id, city_ka: l.name_ka, country_ka: countries[l.countryId] ?? null, currency: currency[l.id],
  }));
}

/** @param {any} md */
const indicesOf = (md) => {
  const i = md && md.indices;
  if (!i || !(i.costOfLivingPlusRent || i.costOfLiving || i.rent)) return null;
  return { costOfLivingPlusRent: i.costOfLivingPlusRent ?? null, costOfLiving: i.costOfLiving ?? null, rent: i.rent ?? null };
};
/** @param {any} md */
const rentOf = (md) => { const v = md?.rent?.items?.centre_1br?.average; return isPositiveDecimalString(v) ? v : null; };

/**
 * ერთი სტრიქონი წყაროების ფენებიდან. @param {{ locationId: string, city_ka: string, country_ka: string|null, currency: string|null }} loc
 * @param {(locationId: string) => Layer[]} layersFor ფენები რიგით (KV, Apify-ის ასლი, მომხმარებლის ასლი)
 * @param {{ estimate?: (indexDec: string, currency: 'EUR'|'USD') => any }} [opts] ბიუჯეტის შეფასება ინდექსიდან (budget.js)
 * @returns {SummaryRow}
 */
export function buildSummaryRow(loc, layersFor, opts = {}) {
  /** @param {Layer[]} ls @param {(md: any) => any} get */
  const pick = (ls, get) => { for (const l of ls) { const v = get(l.md); if (v) return { v, l }; } return null; };
  const own = layersFor(loc.locationId);
  let rent = pick(own, rentOf);
  let idx = pick(own, indicesOf);
  /** @type {SummaryRow['fallbackFrom']} */
  let fallbackFrom;
  const cap = capitalFor(loc.locationId);
  let rentFromCap = false; let idxFromCap = false;
  if (cap && (!rent || !idx)) {
    const capLayers = layersFor(cap.locationId);
    if (!rent) { rent = pick(capLayers, rentOf); rentFromCap = !!rent; }
    if (!idx) { idx = pick(capLayers, indicesOf); idxFromCap = !!idx; }
    if (rentFromCap || idxFromCap) fallbackFrom = { locationId: cap.locationId, city_ka: cap.city_ka };
  }
  // ბიუჯეტი: საკუთარი Numbeo ბიუჯეტი → შეფასება ქალაქის ინდექსით → დედაქალაქის Numbeo ბიუჯეტი.
  const budgetOf = (/** @type {any} */ md) => { const b = md?.budget; return b && (b.single || b.family4) ? b : null; };
  const ownBudget = pick(own, budgetOf);
  /** @type {SummaryRow['budget']} */
  let budget = null;
  if (ownBudget) budget = { single: ownBudget.v.single?.average ?? null, family4: ownBudget.v.family4?.average ?? null, basis: 'numbeo', fromCapital: false };
  else if (idx && idx.v.costOfLiving && opts.estimate && loc.currency) {
    const est = opts.estimate(idx.v.costOfLiving, /** @type {'EUR'|'USD'} */ (loc.currency));
    if (est) budget = { single: est.single?.average ?? null, family4: est.family4?.average ?? null, basis: 'estimated-from-index', fromCapital: idxFromCap };
  }
  const main = rent || idx;
  const fromCap = rent ? rentFromCap : idxFromCap;
  return {
    locationId: loc.locationId, city_ka: loc.city_ka, country_ka: loc.country_ka, currency: loc.currency,
    indices: idx ? idx.v : { costOfLivingPlusRent: null, costOfLiving: null, rent: null },
    rentCentre1br: rent ? rent.v : null,
    source: main ? (fromCap ? 'capital' : main.l.src) : null,
    sourceDate: main ? main.l.date : null,
    budget,
    ...(fallbackFrom ? { fallbackFrom } : {}),
  };
}

/** @param {unknown} v */
const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/**
 * ასლების ფენები (KV-ის გარეშე) — კლიენტისთვის და Worker-ისთვის.
 * @param {any} userSnapshot @param {any} apifySnapshot @param {string} locationId @param {'EUR'|'USD'} currency
 * @returns {Layer[]}
 */
export function snapshotLayers(userSnapshot, apifySnapshot, locationId, currency) {
  /** @type {Layer[]} */
  const out = [];
  const a = apifySnapshot ? apifySnapshotEntryToMarketData(apifySnapshot, locationId, currency) : null;
  if (a) out.push({ src: 'apify-snapshot', md: a, date: day(apifySnapshot.source?.fetchedAt) });
  const u = userSnapshot ? snapshotEntryToMarketData(userSnapshot, locationId, currency) : null;
  if (u) out.push({ src: 'user-snapshot', md: u, date: day(userSnapshot.source?.retrievedAt) });
  return out;
}

/**
 * კლიენტისთვის (file:// ან API-ის ჩავარდნისას): სია ასლებიდან.
 * @param {any} userSnapshot src/data/market-snapshot.json @param {any} apifySnapshot src/data/market-apify-snapshot.json
 * @param {any} data src/data/normative-data.json
 * @returns {MarketSummary}
 */
export function marketSummaryFromSnapshots(userSnapshot, apifySnapshot, data) {
  const locs = missionLocations(data);
  const curOf = Object.fromEntries(locs.map((l) => [l.locationId, l.currency]));
  return {
    schemaVersion: SUMMARY_SCHEMA_VERSION, generatedAt: null,
    rows: locs.map((loc) => buildSummaryRow(loc, (id) => snapshotLayers(userSnapshot, apifySnapshot, id, curOf[loc.locationId] || loc.currency), { estimate: (i, c) => estimateBudget(userSnapshot, i, c) })),
  };
}

/** სიის მარტივი ვალიდაცია (კლიენტი API-ის პასუხისთვის). @param {unknown} s */
export function validateMarketSummary(s) {
  const o = /** @type {any} */ (s);
  if (!o || o.schemaVersion !== SUMMARY_SCHEMA_VERSION || !Array.isArray(o.rows) || o.rows.length > 500) return false;
  const dec = (/** @type {unknown} */ v) => v === null || isPositiveDecimalString(v);
  return o.rows.every((/** @type {any} */ r) => r && typeof r.locationId === 'string' && typeof r.city_ka === 'string'
    && (r.currency === null || r.currency === 'EUR' || r.currency === 'USD')
    && r.indices && dec(r.indices.costOfLivingPlusRent) && dec(r.indices.costOfLiving) && dec(r.indices.rent)
    && dec(r.rentCentre1br) && (r.source === null || SUMMARY_SOURCES.includes(r.source))
    && (r.sourceDate === null || /^\d{4}-\d{2}-\d{2}$/.test(r.sourceDate))
    && (r.budget == null || (dec(r.budget.single) && dec(r.budget.family4) && ['numbeo', 'estimated-from-index'].includes(r.budget.basis))));
}
