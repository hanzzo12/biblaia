# ბაზრის მონაცემების წყარო (ADR-003)

განახლდა: 2026-10-30 (რეალური გაშვების შედეგებით). წინა ვერსიები (Numbeo-ს ოფიციალური API, Eurostat) — git-ის ისტორიაში; პროდუქტიდან ამოღებულია.

## 1. გადაწყვეტილება

| საკითხი | გადაწყვეტა |
| --- | --- |
| წყარო | Numbeo.com-ის გვერდები, მოპოვებული Apify actor-ით **`automation-lab/numbeo-scraper`** |
| სად სრულდება | მხოლოდ Cloudflare Worker-ში (`/api/market`). ბრაუზერი Apify-ს/Numbeo-ს პირდაპირ არ უკავშირდება |
| ავთენტიფიკაცია | `APIFY_TOKEN` — Cloudflare Secret (ლოკალურად `.dev.vars`), `Authorization: Bearer` სათაურით; არასოდეს URL-ში, ლოგში, git-ში, `dist/`-ში ან არქივში (ამოწმებს `tests/providers/no-secrets.test.js`) |
| ქეში | 30 დღე (`MARKET_CACHE_TTL_DAYS`), Workers KV `MARKET_CACHE`; ინდექსები (`rankings`) — ერთი გაშვებით ყველა ქალაქზე |
| გამორთვა | `MARKET_PROVIDER=off` → გვერდზე „ბაზრის მონაცემები გამორთულია“; გამოთვლები უცვლელად მუშაობს |
| ატრიბუცია | „წყარო: Numbeo.com (მოპოვებულია Apify-ის მეშვეობით)“ + ბმული ქალაქის გვერდზე |

## 2. რისკი, რომელიც მომხმარებელმა იცის

- Numbeo-ს გამოყენების პირობები (terms_of_use.jsp) **კრძალავს ავტომატურ მონაცემთა შეგროვებას (scraping) წერილობითი ნებართვის გარეშე** და მონაცემის ხელახალ გავრცელებას სხვა API-ით/საჯარო ნაკადით. მესამე მხარის actor (Apify) ამ პირობებს არ ცვლის და უფლებას არ ქმნის.
- გადაწყვეტილება მიიღო მომხმარებელმა (ADR-003). კოდი ამიტომ: აჩვენებს წყაროს, არ ქმნის საჯარო API-ს (მხოლოდ შიდა ID + EUR/USD), ზღუდავს მოთხოვნებს (rate limit, 30-დღიანი ქეში) და აქვს ერთი ცვლადით გამორთვა.
- Numbeo-ს ოფიციალური API (ფასიანი, Basic 260 USD/თვე 2026-10-29-ის მონაცემით) უფრო სუფთა სამართლებრივი გზაა, მაგრამ საჯარო საიტზე ხელახალი ჩვენებისთვისაც Numbeo-ს თანხმობას საჭიროებს.

## 3. Apify actor — დადასტურებულია რეალური გაშვებით (2026-10-30)

| საკითხი | ფაქტი |
| --- | --- |
| Endpoint | `POST https://api.apify.com/v2/acts/automation-lab~numbeo-scraper/run-sync-get-dataset-items?timeout=<წმ>`, `Authorization: Bearer`; წარმატება HTTP 201, ტანი = სტრიქონების მასივი |
| `city_prices` | შესავალი `{ mode: "city_prices", cities: ["Vienna"], currency: "EUR" }`. გამოსავალი — **ბრტყელი** სტრიქონები `{ city, country, category, item, price, currency, range: "12.00-26.00" \| "1,800.00-3,000.00" \| "", url, scrapedAt }` (ვენა: 55 სტრიქონი). `range` → low/high (ათასეულის მძიმე იშლება; ცარიელი → null). ამ რეჟიმში ინდექსები არ არის |
| ქალაქის სახელი შესავალში | actor სახელს URL slug-ად აქცევს: **„Washington, DC“ → HTTP 400**; „Washington“ → 201. ამიტომ შესავალში იგზავნება სახელი „, XX“ სუფიქსისა და ფრჩხილების გარეშე (`pricesQueryFor`), შედარებისთვის კი — სრული Numbeo სახელი |
| `rankings` | `{ mode: "rankings", maxCities: 0 }` → **ყველა 547 ქალაქი** (~6 წმ); სტრიქონი `{ rank, city, country, costOfLivingIndex, rentIndex, costOfLivingPlusRentIndex, groceriesIndex, restaurantPriceIndex, localPurchasingPowerIndex, url }`. ნაგულისხმევი `maxCities` = 50 (ამიტომ ვენა თავიდან არ ჩანდა). დამთხვევა: ზუსტი Numbeo სახელი + ქვეყანა |
| `comparison` | 1 და 2 ქალაქზე ჩავარდა — არ გამოიყენება |
| თარიღი | წყაროს განახლების თარიღი არ არის; `scrapedAt` = მიღების დრო → `sourceUpdatedAt = null` |

ერთეულების ზუსტი სახელები (მიმდინარე; ძველი დაწერილობა რჩება fallback-ად):
- ქირა (Rent Per Month): „1 Bedroom Apartment in City Centre“, „1 Bedroom Apartment Outside of City Centre“, „3 Bedroom Apartment in City Centre“, „3 Bedroom Apartment Outside of City Centre“.
- კომუნალური (Utilities (Monthly)): „Basic Utilities for 85 m2 Apartment (Electricity, Heating, Cooling, Water, Garbage)“ — **აშშ-ში: „Basic Utilities for 915 Square Feet Apartment (…)“** (915 sq ft ≈ 85 მ²; დადასტურდა ვაშინგტონზე); „Broadband Internet (Unlimited Data, 60 Mbps or Higher)“.
- რესტორნები: „Meal at an Inexpensive Restaurant“, „Meal for Two at a Mid-Range Restaurant (Three Courses, Without Drinks)“.
- **სურსათი — „ძირითადი სასურსათო ჩამონათვალი (ალკოჰოლისა და თამბაქოს გარეშე)“**: „Markets“ კატეგორიის (19 ერთეული) საშუალო ფასების ზუსტი ჯამი, **გარდა**: „Bottle of Wine (Mid-Range)“, „Domestic Beer (0.5 Liter Bottle)“, „Imported Beer (0.33 Liter Bottle)“, „Cigarettes (Pack of 20, Marlboro)“ (+ დამცავი საკვანძო სიტყვები wine/beer/cigarette/tobacco). ფასის არმქონე ერთეული → `itemsMissing`, ჯამში არ შედის (არასოდეს 0).

ქალაქების სახელები (`numbeo-city-names.json`): 81-დან **76 დადასტურდა** Numbeo-ს რეალური rankings სიით (547 ქალაქი; `verifiedBy: "rankings 2026-10-30"`), მათ შორის შესწორებული: Frankfurt, Krakow (Cracow), Chisinau, Brasilia, Delhi, Kiev (Kyiv), Odessa (Odesa), Astana (Nur-Sultan). rankings-ში **არ არის** (ინდექსები → not_found, ფასები შეიძლება იყოს): Trabzon, Ganja, Ashgabat, Donetsk, Havana — `verified:false`. ვატიკანი → რომი (`nearby-explained`).

## 4. ღირებულება (Apify, actor pay-per-event, უფასო ტარიფზე; გადამოწმდა 2026-10-30)

| მოქმედება | ფასი |
| --- | --- |
| გაშვების დაწყება | $0.01 |
| თითო დამუშავებული ქალაქი | $0.005 |
| ერთი ქალაქის `city_prices` | ≈ $0.015 |
| სრული `rankings` (547 ქალაქი) | ≈ $2.745 |

30-დღიანი ქეშით: rankings ≈ **$2.75/თვე** + ≈ $0.015 თითო ქალაქზე და ვალუტაზე 30 დღეში (81 ქალაქი × 1 ვალუტა ≤ $1.22). ინდექსების გამორთვა კრედიტის დასაზოგად: `MARKET_RANKINGS_ENABLED="false"` (ფასები რჩება, `indices.status = "disabled"`). ფასები Apify-ის/actor-ის ტარიფია და შეიძლება შეიცვალოს — გადაამოწმეთ Apify Console-ში.

ხელახალი შემოწმება (იაფად, rankings-ის გარეშე): `NODE_USE_ENV_PROXY=1 node scripts/live-check-apify.mjs AT-VIENNA --currency=EUR --rankings-file=<rankings.json>` (ან `--skip-rankings`).

## 5. ხელით შეყვანა

რჩება ოფლაინ ფაილისთვის და წყაროს არქონისას: ხელით ფორმა და ვალიდირებული JSON იმპორტი (`kind: "market-import"`, `schemaVersion: 2`), status „ხელითაა შეყვანილი“. შეყვანილი ქირა `G`-ში მხოლოდ მომხმარებლის ღილაკით გადადის.
