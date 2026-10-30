// SYNTHETIC TEST DATA — სინთეზური მონაცემები, რეალური ფასები არ არის; აპში არასოდეს ჩანს როგორც live.
// ფორმები მიჰყვება actor-ის საჯარო აღწერას (Category/Item/Price/Currency; Rank/City/Country/Cost of Living/...), დაუდასტურებელია.

export const SYNTHETIC_NAMES = {
  _meta: { status: 'SYNTHETIC' },
  locations: {
    'AT-VIENNA': { numbeoCity: 'Vienna', countryCode: 'AT', matchStatus: 'exact', verified: true },
    'US-NEW-YORK': { numbeoCity: 'New York, NY', countryCode: 'US', matchStatus: 'exact', verified: false },
    'VA-VATICAN-CITY': { numbeoCity: 'Rome', countryCode: 'IT', matchStatus: 'nearby-explained', note: 'სინთეზური: ვატიკანი → რომი', verified: false },
  },
};

const ITEMS = [
  ['Restaurants', 'Meal, Inexpensive Restaurant', 15, 10, 25],
  ['Restaurants', 'Meal for 2 People, Mid-range Restaurant, Three-course', 80, 60, 120],
  ['Markets', 'Milk (regular), (1 liter)', 1.25, 0.9, 1.6],
  ['Markets', 'Loaf of Fresh White Bread (500g)', 2.1, 1.5, 3],
  ['Markets', 'Eggs (regular) (12)', 3.35, 2.5, 4.5],
  ['Utilities (Monthly)', 'Basic (Electricity, Heating, Cooling, Water, Garbage) for 85m2 Apartment', 210.5, 150, 300],
  ['Utilities (Monthly)', 'Internet (60 Mbps or More, Unlimited Data, Cable/ADSL)', 35, 25, 50],
  ['Rent Per Month', 'Apartment (1 bedroom) in City Centre', 1234.56, 900, 1800],
  ['Rent Per Month', 'Apartment (1 bedroom) Outside of Centre', 850.1, 600, 1100],
  ['Rent Per Month', 'Apartment (3 bedrooms) in City Centre', 2500, 1900, 3500],
  ['Rent Per Month', 'Apartment (3 bedrooms) Outside of Centre', 1700, 1300, 2300],
];

/** (ა) ჩადგმული ფორმა. */
export function nestedPrices({ city = 'Vienna', country = 'Austria', currency = 'EUR', drop = [], override = {} } = {}) {
  return [{
    city, country, currency,
    prices: ITEMS.filter(([, n]) => !drop.includes(n)).map(([category, item, average, lowest, highest]) => ({ category, item, average: override[item] ?? average, lowest, highest })),
  }];
}
/** (ბ) ბრტყელი ფორმა, სხვა გასაღებების დაწერილობით (Category/Item/Price/Currency). */
export function flatPrices({ city = 'Vienna', currency = 'EUR' } = {}) {
  return ITEMS.map(([category, item, price, low, high]) => ({ City: city, Country: 'Austria', Category: category, Item: item, Price: String(price), Range: `${low}-${high}`, Currency: currency }));
}
export function rankingsRows(style = 'camel') {
  if (style === 'camel') {
    return [
      { rank: 1, city: 'Zurich, Switzerland', country: 'Switzerland', costOfLivingIndex: 110, rentIndex: 60, groceriesIndex: 100, restaurantPriceIndex: 105, costOfLivingPlusRentIndex: 90 },
      { rank: 40, city: 'Vienna, Austria', country: 'Austria', costOfLivingIndex: 65.4, rentIndex: 30.2, groceriesIndex: 58.9, restaurantPriceIndex: 61.3, costOfLivingPlusRentIndex: 48.8, period: '2026' },
      { rank: 5, city: 'New York, NY, United States', country: 'United States', costOfLivingIndex: 100, rentIndex: 100, groceriesIndex: 100, restaurantPriceIndex: 100, costOfLivingPlusRentIndex: 100 },
    ];
  }
  return [{ Rank: 40, City: 'Vienna, Austria', Country: 'Austria', 'Cost of Living': '65.4', 'Rent Index': '30.2', Groceries: '58.9', Restaurants: '61.3', 'Cost of Living Plus Rent': '48.8' }];
}

const res = (body, status = 201) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Mock Apify: handlers.city_prices / handlers.rankings → array | string | { status, body } | 'hang' | 'neterr'. */
export function mockApify(handlers = {}) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const input = JSON.parse(init.body || '{}');
    calls.push({ url: String(url), headers: { ...(init.headers || {}) }, input });
    const h = handlers[input.mode];
    const spec = typeof h === 'function' ? h(input) : h;
    if (spec === undefined) return res({ error: { type: 'unexpected' } }, 400);
    if (spec === 'hang') return new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
    if (spec === 'neterr') throw new TypeError('fetch failed');
    if (spec && !Array.isArray(spec) && typeof spec === 'object' && 'status' in spec && 'body' in spec) return res(spec.body, spec.status);
    return res(spec);
  };
  fn.calls = calls;
  return fn;
}

export const FAKE_TOKEN = ['synthetic', 'token', 'NOT', 'REAL'].join('-');
