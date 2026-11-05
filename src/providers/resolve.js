// @ts-check
/**
 * MarketData-ს აწყობა წყაროების რიგით და „დედაქალაქის წესით“ (contracts.md §9). სუფთა — ბრაუზერი + Worker.
 *
 * თითო კატეგორიაზე (rent, utilities, groceries, restaurants, indices, budget) პირველი, რომელსაც მნიშვნელობა აქვს:
 *   1) ქალაქის ძირითადი წყარო (KV/live Apify), 2) ქალაქის ასლი (snapshot), 3) დედაქალაქის მონაცემი (იგივე რიგით).
 * თუ ქალაქს საერთოდ არაფერი აქვს → მთელი MarketData დედაქალაქისაა, `matchStatus: "capital-fallback"`.
 * თუ მხოლოდ ზოგი კატეგორია აკლია → ის კატეგორია დედაქალაქიდანაა, `fallback: true`, `resolvedLocation.fallbackFrom`.
 * დედაქალაქი = ქვეყანაში საქართველოს საელჩოს ქალაქი (`capitals.json`, scripts/gen-capitals.mjs); თავად დედაქალაქზე წესი არ მოქმედებს.
 * ცრუ მონაცემი არასოდეს იქმნება — მხოლოდ არსებული ბლოკები გადაიტანება, მკაფიო ნიშნით.
 */

import { STATUSES_WITH_VALUE, overallStatus, validateMarketData } from './market-contract.js';
import { snapshotEntryToMarketData } from './snapshot.js';
import capitalsFile from './capitals.json' with { type: 'json' };

export const CAPITALS = capitalsFile.capitals;
const BLOCKS = /** @type {const} */ (['rent', 'utilities', 'groceries', 'restaurants', 'indices', 'budget']);

/** @param {any} b */
const hasValue = (b) => !!b && STATUSES_WITH_VALUE.includes(b.status);
/** @param {any} md */
export const mdHasValue = (md) => !!md && BLOCKS.some((k) => hasValue(md[k]));

/**
 * ლოკაციის ქვეყნის დედაქალაქი, თუ ის თავად ეს ლოკაცია არ არის.
 * @param {string} locationId @param {Record<string, { locationId: string, city_ka: string }>} [capitals]
 * @returns {{ locationId: string, city_ka: string } | null}
 */
export function capitalFor(locationId, capitals = CAPITALS) {
  const m = /^([A-Z]{2})-/.exec(locationId);
  const cap = m ? capitals[m[1]] : null;
  return cap && cap.locationId !== locationId ? { locationId: cap.locationId, city_ka: cap.city_ka } : null;
}

/**
 * შერეული წყაროების ზედა სტატუსი: ყველა ბლოკს აქვს მნიშვნელობა → ყველაზე „ძველი“ (stale > cached > manual > fresh);
 * ზოგს არა → partial. @param {string[]} statuses
 */
export function combinedStatus(statuses) {
  const considered = statuses.filter((s) => s !== 'disabled');
  if (!considered.length) return 'disabled';
  if (!considered.every((s) => STATUSES_WITH_VALUE.includes(s))) return overallStatus(considered);
  for (const s of ['partial', 'stale', 'cached', 'manual']) if (considered.includes(s)) return s;
  return 'fresh';
}

/** @param {any[]} list @param {any} w */
function addWarning(list, w) {
  const i = list.findIndex((x) => x.code === w.code);
  if (i === -1) list.push(w); else if (w.message_ka && !list[i].message_ka) list[i] = w;
}

/**
 * @param {{ locationId: string, primary?: any, ownSnapshot?: any, capital?: { locationId: string, city_ka: string, md: any } | null }} p
 * @returns {import('./market-contract.js').MarketData | null}
 */
export function composeMarketData(p) {
  const primary = mdHasValue(p.primary) ? p.primary : null;
  const own = mdHasValue(p.ownSnapshot) ? p.ownSnapshot : null;
  const cap = p.capital && mdHasValue(p.capital.md) ? p.capital : null;
  const fbMsg = cap ? `ქალაქის მონაცემი არ მოიძებნა — ნაჩვენებია დედაქალაქის (${cap.city_ka}) მონაცემი` : '';

  const base = primary || own;
  if (!base) {
    if (!cap) return null;
    const md = structuredClone(cap.md);
    md.requestedLocationId = p.locationId;
    md.resolvedLocation = { ...md.resolvedLocation, matchStatus: 'capital-fallback', fallbackFrom: { locationId: cap.locationId, city_ka: cap.city_ka } };
    delete md.resolvedLocation.note;
    addWarning(md.warnings, { code: 'capital_fallback', message_ka: fbMsg });
    md.warnings = md.warnings.filter((/** @type {any} */ w) => w.code !== 'nearby_city');
    return validateMarketData(md).ok ? md : null;
  }

  const md = structuredClone(base);
  let usedCapital = false;
  for (const k of BLOCKS) {
    if (hasValue(md[k])) continue;
    if (base === primary && own && hasValue(own[k])) {
      md[k] = structuredClone(own[k]);
      for (const w of own.warnings) if (['snapshot_copy', 'reference_fx'].includes(w.code)) addWarning(md.warnings, w);
    } else if (cap && hasValue(cap.md[k])) {
      md[k] = { ...structuredClone(cap.md[k]), fallback: true };
      usedCapital = true;
      for (const w of cap.md.warnings) if (['snapshot_copy', 'reference_fx'].includes(w.code)) addWarning(md.warnings, w);
    }
  }
  if (usedCapital) {
    md.resolvedLocation = { ...md.resolvedLocation, fallbackFrom: { locationId: /** @type {any} */ (cap).locationId, city_ka: /** @type {any} */ (cap).city_ka } };
    addWarning(md.warnings, { code: 'capital_fallback', message_ka: `ზოგიერთი კატეგორია ქალაქისთვის არ მოიძებნა — ნაჩვენებია დედაქალაქის (${/** @type {any} */ (cap).city_ka}) მონაცემი` });
  }
  md.status = combinedStatus(BLOCKS.filter((k) => md[k]).map((k) => md[k].status));
  if (md.cache && md.cache.state === 'stale' && md.status !== 'stale') md.cache = { ...md.cache, state: 'stale' };
  if (md.status !== 'stale' && md.cache && md.cache.state === 'stale') md.status = 'stale';
  return validateMarketData(md).ok ? md : null;
}

/**
 * ასლიდან (კლიენტი/ოფლაინ): ქალაქის ასლი + დედაქალაქის წესი. → MarketData | null.
 * @param {any} snapshot @param {string} locationId @param {'EUR'|'USD'} currency
 * @param {{ capitals?: Record<string, { locationId: string, city_ka: string }> }} [opts]
 */
export function marketDataFromSnapshot(snapshot, locationId, currency, opts = {}) {
  const own = snapshotEntryToMarketData(snapshot, locationId, currency);
  const capInfo = capitalFor(locationId, opts.capitals);
  const capital = capInfo ? { ...capInfo, md: snapshotEntryToMarketData(snapshot, capInfo.locationId, currency) } : null;
  return composeMarketData({ locationId, ownSnapshot: own, capital });
}
