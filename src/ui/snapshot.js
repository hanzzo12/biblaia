// ჩაშენებული Eurostat-ის დათარიღებული ასლი (src/data/market-snapshot.eurostat.json), თუ build-ისას არსებობს.
// ფაილი შეიძლება არ არსებობდეს — მაშინ null (esbuild-ის glob require; ცარიელი glob → გაფრთხილება, არა შეცდომა).
import * as P from '../providers/index.js';

let raw = null;
try {
  const name = 'eurostat';
  // eslint-disable-next-line no-undef
  raw = require(`../data/market-snapshot.${name}.json`);
} catch { raw = null; }

export const snapshotFile = raw;

/** ერთი ლოკაციის MarketData ასლიდან (ან null). ასლი არასოდეს ჩანს live მონაცემად. */
export function snapshotFor(locationId) {
  if (!raw || !locationId) return null;
  let md = null;
  try {
    if (typeof P.marketDataFromSnapshot === 'function') md = P.marketDataFromSnapshot(raw, locationId);
    else md = raw.locations?.[locationId] ?? raw.byLocation?.[locationId] ?? null;
  } catch { md = null; }
  if (!md || typeof P.validateMarketData !== 'function' || !P.validateMarketData(md).ok) return null;
  if (md.indices?.status === 'fresh' || md.rent?.status === 'fresh') return null; // ასლი „განახლებულად“ არ ჩაითვლება
  return { md, date: raw.snapshotDate ?? raw.createdAt ?? md.indices?.fetchedAt ?? null };
}
