#!/usr/bin/env node
// Apify actor-ის ნედლი dataset-ებიდან (city_prices ბრტყელი სტრიქონები + rankings) → src/data/market-apify-snapshot.json.
// მხოლოდ აპისთვის საჭირო ბლოკები (არა ნედლი სტრიქონები), მისიის დაფინანსების ვალუტაში. ტოკენი არ სჭირდება.
//   node scripts/build-apify-snapshot.mjs --eur=EUR.json --usd=USD.json --usd=USD2.json --rank=RANK.json --fetched=2026-11-04 [--out=…]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { normalizeApify, cityMatches, pricesQueryFor } from '../src/providers/apify-numbeo-adapter.js';
import { mdHasValue } from '../src/providers/resolve.js';
import { snapshotEntryToMarketData } from '../src/providers/snapshot.js';
import { checkAgainstReference } from '../src/providers/plausibility.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {{ files: Record<'EUR'|'USD', any[][]>, rank: any[], names: any, normative: any, fetched: string, userSnapshot?: any }} p
 */
export function buildApifySnapshot(p) {
  /** @type {Record<string, string[]>} */
  const curOf = {};
  for (const m of p.normative.missions) if (m.locationId && m.fundingCurrency) (curOf[m.locationId] ??= []).includes(m.fundingCurrency) || curOf[m.locationId].push(m.fundingCurrency);
  /** @type {Record<string, any>} */
  const cities = {};
  const stats = { withPrices: 0, indicesOnly: 0, none: [] };
  for (const [loc, entry] of Object.entries(p.names.locations)) {
    if (!entry || entry.matchStatus !== 'exact') continue; // ვატიკანი და სხვა „ახლომდებარე“ — დედაქალაქის წესით
    for (const cur of curOf[loc] || []) {
      const rows = (p.files[cur] || []).flat().filter((r) => r && (cityMatches(r.city, entry.numbeoCity) || cityMatches(r.city, pricesQueryFor(entry))));
      const norm = (/** @type {any} */ prices) => normalizeApify({ locationId: loc, currency: cur, entry, prices, rankings: { status: 'ok', items: p.rank }, fetchedAt: `${p.fetched}T00:00:00Z` });
      let md = norm(rows.length ? { status: 'ok', items: rows } : { status: 'not_found' });
      // დამაჯერებლობა მომხმარებლის ასლთან (იმავე ვალუტაში): ქირა > 3× / < ⅓ ⇒ ფასები უარყოფილია (ინდექსები რჩება).
      const chk = checkAgainstReference(md, p.userSnapshot ? snapshotEntryToMarketData(p.userSnapshot, loc, cur) : null);
      if (chk.implausible) { stats.rejected = [...(stats.rejected || []), `${loc}:implausible_value:${chk.reason}`]; md = norm({ status: 'not_found' }); }
      if (!mdHasValue(md)) { stats.none.push(`${loc}:${cur}`); continue; }
      if (Object.values(md.rent.items).some(Boolean) || md.utilities.basic85m2 || md.restaurants.inexpensiveMeal) stats.withPrices++; else stats.indicesOnly++;
      if (rows.length && ['wrong_city', 'invalid_response'].includes(md.utilities.status)) stats.rejected = [...(stats.rejected || []), `${loc}:${md.utilities.status}`];
      cities[loc] = { currency: cur, numbeoCity: entry.numbeoCity, rent: md.rent, utilities: md.utilities, groceries: md.groceries, restaurants: md.restaurants, indices: { ...md.indices, baseline: undefined } };
      delete cities[loc].indices.baseline;
    }
  }
  return {
    kind: 'market-apify-snapshot', schemaVersion: 1,
    source: { actor: 'Apify automation-lab/numbeo-scraper', fetchedAt: p.fetched, rankingsRows: p.rank.length, note_ka: 'Numbeo.com-ის მონაცემი Apify actor-ის რეალური გაშვებიდან; თანხები მისიის დაფინანსების ვალუტაში. Krakow და Donetsk actor-მა ვერ იპოვა (ფასები — მომხმარებლის ასლიდან/დედაქალაქიდან).' },
    stats, cities,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k) => process.argv.slice(2).filter((a) => a.startsWith(`--${k}=`)).map((a) => a.slice(k.length + 3));
  const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
  const fetched = arg('fetched')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fetched || '')) { console.error('--fetched=YYYY-MM-DD is required'); process.exit(2); }
  const out = arg('out')[0] || path.join(root, 'src/data/market-apify-snapshot.json');
  const snap = buildApifySnapshot({
    files: { EUR: arg('eur').map(read), USD: arg('usd').map(read) }, rank: arg('rank').flatMap(read),
    names: read(path.join(root, 'src/providers/numbeo-city-names.json')), normative: read(path.join(root, 'src/data/normative-data.json')), fetched,
    userSnapshot: read(path.join(root, 'src/data/market-snapshot.json')),
  });
  writeFileSync(out, JSON.stringify(snap, null, 1) + '\n');
  console.log(`✓ ${path.relative(root, out)}: ${Object.keys(snap.cities).length} cities (prices: ${snap.stats.withPrices}, indices only: ${snap.stats.indicesOnly}); none: ${snap.stats.none.join(', ') || '—'}; rejected: ${(snap.stats.rejected || []).join(', ') || '—'}`);
}
