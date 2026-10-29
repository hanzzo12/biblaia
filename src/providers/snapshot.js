// @ts-check
/**
 * ოფლაინ ასლი (`src/data/market-snapshot.eurostat.json`) — ვალიდაცია და ერთი ლოკაციის ამოღება.
 * ფაილს ქმნის `scripts/fetch-eurostat-snapshot.mjs` (საჭიროებს ქსელურ წვდომას ec.europa.eu-ზე).
 * ფაილის არარსებობა ნორმალური მდგომარეობაა: `marketDataFromSnapshot(null, …)` → null და UI აჩვენებს ხელით შეყვანას.
 * ასლი ყოველთვის „შენახული ასლია, თარიღით“ — არასოდეს live (status `cached`, origin `snapshot`, warning `snapshot_not_live`).
 */
import { MARKET_SCHEMA_VERSION, validateMarketData, isIsoDateTime } from './market-contract.js';

/**
 * @typedef {{ kind: 'market-snapshot', schemaVersion: number, provider: 'eurostat', retrievedAt: string,
 *             licence: string, datasets: string[], entries: Record<string, import('./market-contract.js').MarketData> }} MarketSnapshot
 */

/** @param {unknown} s @returns {{ ok: boolean, errors: string[] }} */
export function validateMarketSnapshot(s) {
  const errors = [];
  if (!s || typeof s !== 'object' || Array.isArray(s)) return { ok: false, errors: ['$: not_object'] };
  const o = /** @type {any} */ (s);
  if (o.kind !== 'market-snapshot') errors.push('kind: invalid');
  if (o.schemaVersion !== MARKET_SCHEMA_VERSION) errors.push('schemaVersion: unsupported');
  if (o.provider !== 'eurostat') errors.push('provider: invalid');
  if (!isIsoDateTime(o.retrievedAt)) errors.push('retrievedAt: not_iso_datetime');
  if (typeof o.licence !== 'string' || !o.licence.includes('2011/833/EU')) errors.push('licence: missing');
  if (!Array.isArray(o.datasets)) errors.push('datasets: not_array');
  if (!o.entries || typeof o.entries !== 'object') errors.push('entries: not_object');
  else {
    for (const [loc, md] of Object.entries(o.entries)) {
      const v = validateMarketData(md);
      if (!v.ok) errors.push(...v.errors.map((e) => `entries.${loc}.${e}`));
      else if (md.requestedLocationId !== loc) errors.push(`entries.${loc}: location_mismatch`);
      else if (md.indices.origin !== 'snapshot' || !md.warnings.some((w) => w.code === 'snapshot_not_live')) errors.push(`entries.${loc}: not_marked_as_snapshot`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * @param {MarketSnapshot|null|undefined} snapshot @param {string} locationId
 * @returns {import('./market-contract.js').MarketData|null}
 */
export function marketDataFromSnapshot(snapshot, locationId) {
  if (!snapshot || !validateMarketSnapshot(snapshot).ok) return null;
  const md = snapshot.entries[locationId];
  return md ? structuredClone(md) : null;
}
