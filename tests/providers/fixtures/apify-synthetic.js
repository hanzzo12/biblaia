// SYNTHETIC TEST DATA — სინთეზური რიცხვები (რეალური Numbeo ფასები არ არის). სტრუქტურა და ერთეულების სახელები
// შეესაბამება actor-ის რეალურ გამოსავალს (2026-10-30). აპში არასოდეს ჩანს როგორც live მონაცემი.

export const SYNTHETIC_NAMES = {
  _meta: { status: 'SYNTHETIC' },
  locations: {
    'AT-VIENNA': { numbeoCity: 'Vienna', numbeoCountry: 'Austria', countryCode: 'AT', matchStatus: 'exact', verified: true },
    'US-NEW-YORK': { numbeoCity: 'New York, NY', numbeoCountry: 'United States', countryCode: 'US', matchStatus: 'exact', verified: true },
    'VA-VATICAN-CITY': { numbeoCity: 'Rome', numbeoCountry: 'Italy', countryCode: 'IT', matchStatus: 'nearby-explained', note: 'სინთეზური: ვატიკანი → რომი', verified: true },
    'TR-TRABZON': { numbeoCity: 'Trabzon', numbeoCountry: null, countryCode: 'TR', matchStatus: 'exact', verified: false },
  },
};

// [category, item, price, range]
export const ITEMS = [
  ['Restaurants', 'Meal at an Inexpensive Restaurant', 15, '10.00-25.00'],
  ['Restaurants', 'Meal for Two at a Mid-Range Restaurant (Three Courses, Without Drinks)', 80, '60.00-120.00'],
  ['Restaurants', 'Domestic Draft Beer (0.5 Liter)', 5, '4.00-7.00'],
  ['Markets', 'Milk (Regular, 1 Liter)', 1.25, '0.90-1.60'],
  ['Markets', 'Fresh White Bread (500 g Loaf)', 2.1, '1.50-3.00'],
  ['Markets', 'Eggs (12, Large Size)', 3.35, '2.50-4.50'],
  ['Markets', 'Bottle of Wine (Mid-Range)', 9, '6.00-15.00'],
  ['Markets', 'Domestic Beer (0.5 Liter Bottle)', 1.5, '1.00-2.00'],
  ['Markets', 'Imported Beer (0.33 Liter Bottle)', 2, '1.50-3.00'],
  ['Markets', 'Cigarettes (Pack of 20, Marlboro)', 7, ''],
  ['Utilities (Monthly)', 'Basic Utilities for 85 m2 Apartment (Electricity, Heating, Cooling, Water, Garbage)', 210.5, '150.00-300.00'],
  ['Utilities (Monthly)', 'Broadband Internet (Unlimited Data, 60 Mbps or Higher)', 35, '25.00-50.00'],
  ['Rent Per Month', '1 Bedroom Apartment in City Centre', 1234.56, '900.00-1,800.00'],
  ['Rent Per Month', '1 Bedroom Apartment Outside of City Centre', 850.1, '600.00-1,100.00'],
  ['Rent Per Month', '3 Bedroom Apartment in City Centre', 2500, '1,900.00-3,500.00'],
  ['Rent Per Month', '3 Bedroom Apartment Outside of City Centre', 1700, ''],
];

/** რეალური ფორმა: ბრტყელი სტრიქონები. */
export function flatPrices({ city = 'Vienna', country = 'Austria', currency = 'EUR', drop = [], override = {} } = {}) {
  return ITEMS.filter(([, n]) => !drop.includes(n)).map(([category, item, price, range]) => ({
    city, country, category, item, price: override[item] ?? price, currency, range,
    url: `https://www.numbeo.com/cost-of-living/in/${city}?displayCurrency=${currency}`, scrapedAt: '2026-10-30T10:00:00.000Z',
  }));
}
/** მდგრადობის ფორმა (ჩადგმული, ძველი სახელებით) — ძველი დაწერილობის fallback-ის შესამოწმებლად. */
export function nestedLegacyPrices({ city = 'Vienna', currency = 'EUR' } = {}) {
  return [{ city, country: 'Austria', currency, prices: [
    { category: 'Rent Per Month', item: 'Apartment (1 bedroom) in City Centre', average: 1000, lowest: 800, highest: 1200 },
    { category: 'Utilities (Monthly)', item: 'Basic (Electricity, Heating, Cooling, Water, Garbage) for 85m2 Apartment', average: 200 },
    { category: 'Restaurants', item: 'Meal, Inexpensive Restaurant', average: 12 },
  ] }];
}
export function rankingsRows() {
  const row = (rank, city, country, col, rent, plus, gro, rest) => ({ rank, city, country, costOfLivingIndex: col, rentIndex: rent, costOfLivingPlusRentIndex: plus, groceriesIndex: gro, restaurantPriceIndex: rest, localPurchasingPowerIndex: 90, url: `https://www.numbeo.com/cost-of-living/in/${city}` });
  return [
    row(1, 'Zurich', 'Switzerland', 110, 60, 90, 100, 105),
    row(40, 'Vienna', 'Austria', 65.4, 30.2, 48.8, 58.9, 61.3),
    row(41, 'Vienna', 'United States', 99, 99, 99, 99, 99), // იგივე სახელი, სხვა ქვეყანა — არ უნდა აირჩეს
    row(5, 'New York, NY', 'United States', 100, 100, 100, 100, 100),
  ];
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
