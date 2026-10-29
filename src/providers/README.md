# `src/providers/` — ბაზრის მონაცემების ადაპტერები (დიზაინის მონახაზი, ეტაპი 1)

სტატუსი: **მონახაზი, არა საბოლოო**. საერთო კონტრაქტს ამტკიცებს ხელმძღვანელი (`docs/contracts.md`).
რეალურ Numbeo API-სთან კავშირი **არ შემოწმებულა** — გასაღები არ გვაქვს, ფასიანი სერვისი არ შეძენილა.

| ფაილი | დანიშნულება |
| --- | --- |
| `market-contract.js` | `MarketData`-ს და ხელით/JSON ჩანაწერის სქემა (JSDoc), სტატუსების enum-ები, სუფთა ვალიდატორები. გამოიყენება ბრაუზერშიც და Worker-შიც. |
| `numbeo-city-map.json` | შიდა ქალაქის ID → Numbeo `city_id`. **ცარიელია და დაუდასტურებელი** — ივსება მხოლოდ `/api/cities`-ის რეალური პასუხით. |
| `numbeo-adapter.js` (ეტაპი 3) | სუფთა ფუნქციები: მოთხოვნის URL-ის აგება და Numbeo-ს პასუხის → `MarketData` ნორმალიზება. `fetch` გადაეცემა გარედან (ტესტებში — სინთეზური პასუხები). |

## 1. ნაკადი

```
ბრაუზერი ──GET /api/market?location=<შიდა ID>&currency=EUR|USD──▶ Worker (worker/index.js)
   │                                                              │ 1) location ∈ numbeo-city-map.cities, currency ∈ allowlist (სხვა → 400)
   │                                                              │ 2) rate limit binding
   │                                                              │ 3) ქეში (თუ ლიცენზიით ნებადართულია და TTL > 0)
   │                                                              │ 4) numbeo-adapter: 2 upstream მოთხოვნა (city_prices + indices), timeout
   │◀──────────────── MarketData (validateMarketData-ით შემოწმებული) ◀┘
```

ბრაუზერი Worker-ს უგზავნის **მხოლოდ** შიდა ID-სა და ვალუტას. თვითნებური upstream URL, ქალაქის სახელი ან `query` მომხმარებლისგან არ მიიღება — ეს გამორიცხავს „უნივერსალურ Numbeo proxy“-ს.

## 2. ქალაქების შესაბამისობა

- გასაღები = შიდა **ქალაქის** ID (არა დაწესებულების). დაწესებულების გრძელი სახელი API-ში არასოდეს იგზავნება.
- ჩანაწერის ფორმა (`cities[<locationId>]`):
  ```json
  { "numbeoCityId": "<string, /api/cities-დან>", "numbeoCity": "<name ზუსტად /api/cities-დან>",
    "numbeoCountry": "<country /api/cities-დან>", "countryCode": "AT",
    "matchStatus": "exact | nearby-explained | country-level",
    "note": "სავალდებულოა nearby-explained-ისთვის (მაგ. ვატიკანი → რომი)",
    "verifiedAt": "YYYY-MM-DD" }
  ```
- შევსების პროცედურა (გასაღების მიღების შემდეგ, ერთჯერადი, დეველოპერის მანქანაზე ან Worker-ის დროებითი admin ბრძანებით — **არა** საჯარო endpoint-ით): `GET /api/cities?api_key=…&country=<ISO>` თითო ქვეყანაზე; ადამიანი ირჩევს სწორ ჩანაწერს; ცხრილი რეპოზიტორიაში ინახება მხოლოდ ID/სახელებით (ფასების გარეშე). ID-ის შენახვა Numbeo-ს „მონაცემის“ შენახვად შეიძლება ჩაითვალოს — ესეც ლიცენზიის კითხვაა (იხ. `docs/providers.md`).
- პარიზი/სტრასბურგი, ვაშინგტონი/ნიუ-იორკი, ბერნი/ჟენევა — ცალკე ქალაქის ID-ები; NATO/EU/UN მისია მიება ფაქტობრივ ქალაქს.
- რუკაში არარსებული ID → Worker აბრუნებს `not_configured` (არა `not_found`), რადგან პრობლემა ჩვენს კონფიგურაციაშია.

## 3. მოთხოვნები Numbeo-სთან (დოკუმენტაციით, ცოცხლად შეუმოწმებელი)

ბაზა: `https://www.numbeo.com/api`. გასაღები: `X-Api-Key` სათაურით (დოკუმენტაცია ასევე უშვებს `api_key` query-ს; სათაური სჯობს, რომ გასაღები URL-ში/ლოგებში არ მოხვდეს — დასადასტურებელია ცოცხლად).

```
GET /api/city_prices?city_id=<numbeoCityId>&currency=<EUR|USD>&use_estimated=false
GET /api/indices?city_id=<numbeoCityId>
```

- `city_id` ამჯობინებს `query`-ს: სახელის geolocation-ით გადაწყვეტა გამოირიცხება. `strict_matching` მხოლოდ `query`-ის დროს მოქმედებს (ნაგულისხმევი `true`); თუ რომელიმე ქალაქისთვის `city_id` არ გვაქვს და `query` გამოიყენება — გაიგზავნოს `strict_matching=true` ცხადად.
- `use_estimated=false` — რათა მცირე მონაცემის მქონე ქალაქისთვის მეზობელი ქალაქებიდან შეფასება არ დაბრუნდეს (დოკუმენტირებულია `city_prices`-ისთვის; `indices`-ზე მხარდაჭერა **დაუდასტურებელია** — არ გავაგზავნოთ, სანამ ცოცხლად არ შემოწმდება).
- ვალუტა: `currency` მხოლოდ `city_prices`-ზე (ინდექსი უერთეულოა). Worker **არასოდეს** აკონვერტირებს თანხას; თუ პასუხის `currency` ≠ მოთხოვნილს → `wrong_city`-ის მსგავსად უარყოფა (`invalid_response`, warning არა — მონაცემი არ ჩანს).
- ერთი (ქალაქი, ვალუტა) = 2 upstream მოთხოვნა. ერთდროული იდენტური მოთხოვნები ერთიანდება (in-isolate `Map<key, Promise>`).

## 4. ნორმალიზება

| Numbeo | MarketData |
| --- | --- |
| `prices[]` სადაც `item_id` = 26 / 28 / 27 / (? 3br outside) | `rent.items.centre_1br / centre_3br / outside_1br / outside_3br` |
| `average_price` / `lowest_price` / `highest_price` | `average` / `low` / `high` (ათწილადი სტრიქონი; `String(number)`, დამრგვალების გარეშე) |
| `data_points` | `dataPoints` |
| ტოპ-დონის `currency` | `currency` (უნდა = მოთხოვნილი) |
| `monthLastUpdate` + `yearLastUpdate` (თუ არის) | `rent.items.*.sourceUpdatedAt = "YYYY-MM"`; თუ არ არის → `null` + `source_date_unknown` |
| `name`, `city_id` | `resolvedLocation.city`, `providerCityId` (შემოწმება რუკასთან) |
| `cpi_index` | `indices.costOfLivingExcludingRent` |
| `rent_index` | `indices.rentIndex` |
| `cpi_and_rent_index` | `indices.costOfLivingPlusRent` |
| — | `indices.baseline = { label: "New York City", value: "100" }` |
| ჩვენი დრო | `fetchedAt` (ISO UTC) — **არა** `sourceUpdatedAt` |

- `item_id`-ს გარდა მოწმდება `item_name`-ის შემცველობა (`expectedNameIncludes`) — თუ Numbeo ნომრებს შეცვლის, ჩანაწერი უარყოფილია (`invalid_response` ამ item-ზე + `item_mapping_unverified`), არასწორი ბინის ტიპი არ გამოჩნდება.
- არარსებული item → ამ მეტრიკაზე `status: "not_found"`, მნიშვნელობები `null`. 0 ან უარყოფითი ფასი → `null` (არასოდეს 0).
- `average` არის, `low/high` — არა → `partial`. მცირე `data_points` (ზღვარი კონფიგურირებადი, მაგ. < 5) → `low_data_points`.
- ყოველთვის: `range_is_not_confidence_interval`, `quality_not_guaranteed` (ქირა), `index_is_not_money` (ინდექსი).
- 2-საძინებლიანი არასოდეს გამოითვლება.

## 5. შეცდომების ასახვა (rent და indices ცალ-ცალკე)

| შემთხვევა | სტატუსი | შენიშვნა |
| --- | --- | --- |
| Secret `NUMBEO_API_KEY` არ არის / ლოკაცია რუკაში არ არის | `not_configured` | upstream არ გამოიძახება |
| fetch timeout (`MARKET_UPSTREAM_TIMEOUT_MS`, `AbortSignal.timeout`) | `timeout` | ერთი ცდა, განმეორება არა |
| DNS/TLS/კავშირის შეცდომა | `network_error` | |
| HTTP 401 / 403 | `unauthorized` | გასაღები არასოდეს ილოგება |
| HTTP 429 ან ჩვენი rate limiter | `rate_limited` | `Retry-After` გადაეცემა კლიენტს, ავტომატური retry არა |
| HTTP 5xx | `upstream_error` | ვადაგასული ქეში მხოლოდ `MARKET_STALE_MAX_SECONDS`-ის ფარგლებში → `stale` |
| არა-JSON / სქემა არ ემთხვევა / HTTP 200 + `{"error": …}` | `invalid_response` | Numbeo-ს შეცდომის ტექსტი UI-ში არ ჩანს |
| `city_id`/`name` ≠ რუკის, ან `currency` ≠ მოთხოვნილი | `wrong_city` | მთელი ბლოკი უარყოფილია |
| ქალაქი რუკაშია, მაგრამ prices ცარიელია | `not_found` | |
| ერთი endpoint წარმატებული, მეორე — არა | თითოეულს საკუთარი სტატუსი | ერთი მეორეს არ მალავს |

საბოლოოდ Worker პასუხს გაატარებს `validateMarketData`-ში; თუ ჩავარდა → ორივე ბლოკი `invalid_response` (არასწორი მონაცემი კლიენტამდე არ მიდის).

### Worker-ის HTTP ფორმა (წინადადება)
- `200` + `MarketData` — ყველა დამუშავებულ შემთხვევაში (სტატუსები სხეულშია), გარდა:
- `400` + `{ "schemaVersion": 1, "error": { "code": "invalid_location" | "invalid_currency" } }` — უცნობი ID/ვალუტა.
- `429` + `MarketData`(`rate_limited`) — ჩვენი ლიმიტერი.
- `Cache-Control: private, no-store` ბრაუზერისთვის (ქეში სერვერზეა და ლიცენზიით იმართება).
- CORS სათაურები **არ** ემატება (same-origin); `file://`-დან Worker-ზე მიმართვა არ იგეგმება — ოფლაინ რეჟიმი იყენებს ხელით შეყვანას/JSON იმპორტს.

## 6. ქეშის გასაღები

`https://market-cache.internal/v{MARKET_SCHEMA_VERSION}/{provider}/{locationId}/{currency}` — შეიცავს პროვაიდერს, ქალაქს, ვალუტას და სქემის ვერსიას. ქეშირება ნაგულისხმევად **გამორთულია** (`MARKET_CACHE_TTL_SECONDS="0"`), სანამ Numbeo წერილობით არ დაადასტურებს; Cloudflare Access-ის უკან Cache API მიუწვდომელია — იხ. `docs/deploy-notes.md` §5.

## 7. ლოგირება
მხოლოდ: დრო, `locationId`, ვალუტა, სტატუსები, upstream HTTP კოდი, ხანგრძლივობა. **არასოდეს**: გასაღები, სრული upstream URL (`api_key`-ით), მომხმარებლის ფინანსური/ოჯახის მონაცემები, Access-ის identity.
