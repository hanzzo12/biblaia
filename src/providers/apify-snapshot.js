// @ts-check
/**
 * Apify-ის რეალური გაშვების ასლი (`src/data/market-apify-snapshot.json`, 2026-11-04) → MarketData v2.
 * ფაილს ქმნის `scripts/build-apify-snapshot.mjs` actor-ის ნედლი dataset-ებიდან; შიგნით ინახება მხოლოდ აპისთვის
 * საჭირო ბლოკები, **მისიის დაფინანსების ვალუტაში** (გადაყვანა არ სჭირდება). სუფთა — ბრაუზერი + Worker.
 * სხვა ვალუტის მოთხოვნისას → null (მაშინ მომხმარებლის ასლი/დედაქალაქი გამოიყენება).
 */
import { MARKET_SCHEMA_VERSION, NUMBEO_BASELINE_KA, NUMBEO_ATTRIBUTION_KA, overallStatus, validateMarketData, isPartialDate } from './market-contract.js';
import { formatDateKa } from './snapshot.js';

const BLOCKS = ['rent', 'utilities', 'groceries', 'restaurants', 'indices'];
const relabel = (/** @type {string} */ s) => (s === 'fresh' ? 'cached' : s);

/**
 * @param {any} apifySnapshot @param {string} locationId @param {'EUR'|'USD'} currency
 * @returns {import('./market-contract.js').MarketData|null}
 */
export function apifySnapshotEntryToMarketData(apifySnapshot, locationId, currency) {
  if (!apifySnapshot || apifySnapshot.kind !== 'market-apify-snapshot' || !apifySnapshot.cities) return null;
  const c = Object.prototype.hasOwnProperty.call(apifySnapshot.cities, locationId) ? apifySnapshot.cities[locationId] : null;
  if (!c || c.currency !== currency) return null;
  const fetched = String(apifySnapshot.source?.fetchedAt || '');
  if (!isPartialDate(fetched.slice(0, 10))) return null;
  const blocks = Object.fromEntries(BLOCKS.map((k) => [k, { ...structuredClone(c[k]), status: relabel(c[k]?.status) }]));
  blocks.indices.baseline = NUMBEO_BASELINE_KA;
  const statuses = BLOCKS.map((k) => blocks[k].status);
  const dateKa = formatDateKa(fetched);
  const warnings = [
    { code: 'snapshot_copy', ...(dateKa ? { message_ka: `შენახული მონაცემი · ${dateKa}` } : {}) },
    { code: 'scraped_source_terms' }, { code: 'source_date_unknown' },
  ];
  if (Object.values(blocks.rent.items || {}).some(Boolean)) { warnings.push({ code: 'range_is_not_confidence_interval' }); warnings.push({ code: 'quality_not_guaranteed' }); }
  if (['cached', 'partial'].includes(blocks.indices.status)) warnings.push({ code: 'index_is_not_money' });
  if (blocks.groceries.itemsMissing > 0 && blocks.groceries.basketItemsSum) warnings.push({ code: 'basket_incomplete' });
  const slug = String(c.numbeoCity).split(',')[0].replace(/\(.*?\)/g, '').trim().split(/\s+/).map(encodeURIComponent).join('-');
  const cc = /^([A-Z]{2})-/.exec(locationId);
  /** @type {any} */
  const md = {
    schemaVersion: MARKET_SCHEMA_VERSION, requestedLocationId: locationId,
    resolvedLocation: { city: c.numbeoCity, countryCode: cc ? cc[1] : null, providerCity: c.numbeoCity, matchStatus: 'exact' },
    provider: { id: 'numbeo-apify', name: 'Numbeo', via: 'Apify automation-lab/numbeo-scraper (შენახული ასლი)', sourceUrl: `https://www.numbeo.com/cost-of-living/in/${slug}`, attribution_ka: NUMBEO_ATTRIBUTION_KA },
    currency, status: overallStatus(statuses), ...blocks,
    fetchedAt: `${fetched.slice(0, 10)}T00:00:00Z`, sourceUpdatedAt: null,
    cache: { state: 'snapshot', expiresAt: null }, warnings,
  };
  return validateMarketData(md).ok ? md : null;
}
