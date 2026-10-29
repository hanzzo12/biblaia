// SYNTHETIC TEST DATA — სინთეზური მონაცემები. რეალური ფასები/ID-ები არ არის; აპის ჩვეულებრივ რეჟიმში არასოდეს გამოიყენება.
// ფორმა მიჰყვება Numbeo-ს დოკუმენტაციის ნიმუშებს (docs/providers.md §2); ციფრები და city_id გამოგონილია ტესტისთვის.
import realMap from '../../../src/providers/numbeo-city-map.json' with { type: 'json' };

export const SYNTHETIC = true;

export const SYNTHETIC_CITY_MAP = {
  _meta: { status: 'SYNTHETIC — tests only' },
  items: realMap.items,
  cities: {
    'AT-VIENNA': { numbeoCityId: '900001', numbeoCity: 'Synthetic Vienna', numbeoCountry: 'Austria', countryCode: 'AT', matchStatus: 'exact', note: null, verifiedAt: '2026-10-29' },
    'VA-VATICAN-CITY': { numbeoCityId: '900002', numbeoCity: 'Synthetic Rome', numbeoCountry: 'Italy', countryCode: 'IT', matchStatus: 'nearby-explained', note: 'სინთეზური: ვატიკანი → რომი', verifiedAt: '2026-10-29' },
  },
};

export function pricesBody({ currency = 'EUR', cityId = 900001, name = 'Synthetic Vienna, Austria', items = null } = {}) {
  return {
    name, city_id: cityId, currency, contributors: 120, contributors12months: 80, monthLastUpdate: 9, yearLastUpdate: 2026,
    prices: items ?? [
      { item_id: 1, item_name: 'Meal, Inexpensive Restaurant, Restaurants', average_price: 15, lowest_price: 10, highest_price: 25, data_points: 50 },
      { item_id: 26, item_name: 'Apartment (1 bedroom) in City Centre, Rent Per Month', average_price: 1234.56, lowest_price: 900, highest_price: 1800, data_points: 40 },
      { item_id: 27, item_name: 'Apartment (1 bedroom) Outside of Centre, Rent Per Month', average_price: 850.1, lowest_price: 600, highest_price: 1100, data_points: 30 },
      { item_id: 28, item_name: 'Apartment (3 bedrooms) in City Centre, Rent Per Month', average_price: 2500, lowest_price: 1900, highest_price: 3500, data_points: 3 },
    ],
  };
}

export function indicesBody({ cityId = 900001, name = 'Synthetic Vienna, Austria', omit = [] } = {}) {
  const b = { name, city_id: cityId, cpi_index: 61.25, rent_index: 30.5, cpi_and_rent_index: 46.75, groceries_index: 55.1 };
  for (const k of omit) delete b[k];
  return b;
}

const jsonRes = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Mock fetch: handlers.prices / handlers.indices → body object | string | { status, body } | 'hang' | 'neterr'.
 * Records calls (url + headers) in `calls`.
 */
export function mockNumbeoFetch(handlers = {}) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), headers: { ...(init.headers || {}) } });
    const path = new URL(url).pathname;
    const h = path.endsWith('/city_prices') ? handlers.prices : path.endsWith('/indices') ? handlers.indices : undefined;
    const spec = typeof h === 'function' ? h(url, init) : h;
    if (spec === undefined) return jsonRes({ error: 'unexpected endpoint' }, 404);
    if (spec === 'hang') {
      return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    }
    if (spec === 'neterr') throw new TypeError('fetch failed');
    if (spec && typeof spec === 'object' && 'status' in spec && 'body' in spec) return jsonRes(spec.body, spec.status);
    return jsonRes(spec);
  };
  fn.calls = calls;
  return fn;
}
