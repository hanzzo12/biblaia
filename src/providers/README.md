# `src/providers/` — ბაზრის მონაცემები (ADR-003, MarketData v2)

| ფაილი | გარემო | დანიშნულება |
| --- | --- | --- |
| `market-contract.js` | ბრაუზერი + Worker | MarketData v2 სქემა (contracts.md §8), სტატუსები, `validateMarketData`, `createEmptyMarketData`, ხელით/JSON ჩანაწერების ვალიდაცია, ზუსტი ათწილადი ჯამი |
| `index.js` | ბრაუზერი | `createMarketClient` (არასოდეს ისვრის), `createLatestOnly`, `suggestBedrooms`, `parseManualMarketJson`, `validateManualRecord` (`{path, code, message_ka}`), ქართული იარლიყები: `MARKET_STATUS_LABELS_KA`, `MARKET_CATEGORY_LABELS_KA`, `MARKET_WARNING_LABELS_KA` |
| `apify-numbeo-adapter.js` | მხოლოდ სერვერი | Apify actor `automation-lab/numbeo-scraper`: `runActor`, `normalizeApify`, `fetchApifyMarket` |
| `numbeo-city-names.json` | სერვერი | შიდა ლოკაციის ID → Numbeo-ს ქალაქის სახელი (ყველა `verified:false`; ვატიკანი → რომი `nearby-explained`) |

ნაკადი: ბრაუზერი → `GET /api/market?location=<ID>&currency=EUR|USD` → Worker (`worker/index.js`): პარამეტრების შემოწმება → KV ქეში (30 დღე) → rate limit (IP) → Apify (`city_prices` ქალაქზე + `rankings` ერთხელ ყველაზე) → ნორმალიზება/ვალიდაცია → MarketData v2.

ბლოკები: `rent` (4 ქირა + `rentIndex`), `utilities` (85 მ² + ინტერნეტი), `groceries` („Markets“ კატეგორიის ფასების ჯამი, `itemsCounted/itemsMissing` + ინდექსი), `restaurants` (2 კერძი + ინდექსი), `indices` (ნიუ-იორკი = 100). თითო ბლოკს საკუთარი `status` აქვს; ზედა დონის `status` — `overallStatus()`.

ტოკენი: მხოლოდ `APIFY_TOKEN` Secret / `.dev.vars`; `Authorization: Bearer` სათაურით. ლოგებში არასოდეს. რეალური გაშვების სქემის დადასტურება: `scripts/live-check-apify.mjs` (იხ. `docs/providers.md` §4).
