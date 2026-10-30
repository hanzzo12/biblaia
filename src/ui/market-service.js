// ბაზრის მონაცემების საერთო სერვისი (მთავარი ბლოკი + შედარება). ერთი (ქალაქი, ვალუტა) — ერთი მოთხოვნა.
// რბოლისგან დაცვა: მომხმარებელი პასუხს იყენებს მხოლოდ მაშინ, თუ ის ჯერ კიდევ იმავე ქალაქს ეკუთვნის (იხ. market.js / compare.js).

export const TRANSIENT = new Set(['network_error', 'timeout', 'rate_limited', 'upstream_error', 'invalid_response', 'wrong_city']);

/** ცარიელი MarketData v2 მოცემული სტატუსით (contracts §8). */
export function emptyMarket(locationId, status, currency = null) {
  return {
    schemaVersion: 2, requestedLocationId: locationId,
    resolvedLocation: { city: null, countryCode: null, providerCity: null, matchStatus: 'none' },
    provider: null, currency, status,
    rent: { status, items: {}, rentIndex: null },
    utilities: { status, basic85m2: null, internet: null },
    groceries: { status, basketItemsSum: null, itemsCounted: 0, itemsMissing: 0, groceriesIndex: null },
    restaurants: { status, inexpensiveMeal: null, midRangeForTwo: null, restaurantIndex: null },
    indices: { costOfLiving: null, rent: null, groceries: null, restaurants: null, costOfLivingPlusRent: null, baseline: 'ნიუ-იორკი = 100', status, period: null },
    fetchedAt: null, sourceUpdatedAt: null, cache: { state: 'miss', expiresAt: null }, warnings: [],
  };
}

export function createMarketService({ online, client, timeoutMs = 120000 }) {
  const cache = new Map();
  return {
    online,
    /** @returns {Promise<any>} არასოდეს ისვრის */
    get(locationId, currency, { force = false } = {}) {
      if (!online || !client) return Promise.resolve(emptyMarket(locationId, 'not_configured', currency));
      const key = `${locationId}|${currency}`;
      if (!force && cache.has(key)) return cache.get(key);
      const p = Promise.resolve()
        .then(() => client.get(locationId, currency, { signal: AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined }))
        .catch(() => emptyMarket(locationId, 'network_error', currency))
        .then((md) => {
          if (!md || typeof md !== 'object' || md.schemaVersion !== 2) return emptyMarket(locationId, 'invalid_response', currency);
          if (md.requestedLocationId !== locationId || (md.currency && md.currency !== currency)) return emptyMarket(locationId, 'wrong_city', currency);
          return md;
        });
      cache.set(key, p);
      p.then((md) => { if (TRANSIENT.has(md.status)) cache.delete(key); });
      return p;
    },
  };
}
