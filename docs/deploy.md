# განთავსების სახელმძღვანელო (Cloudflare Workers)

ეს ინსტრუქცია აღწერს, როგორ გაუშვათ კალკულატორი ლოკალურად და როგორ განათავსოთ Cloudflare-ზე სუფთა კომპიუტერიდან.
შემოწმებულია 2026-10-29: Node 22, wrangler 4.155.0. რეალურ Cloudflare ანგარიშზე განთავსება და Numbeo-ს გასაღებით მოთხოვნა **არ შესრულებულა** — შემოწმდა ლოკალური გაშვება (`wrangler dev`) და `--dry-run`.

## 0. რა რისთვისაა

| ვარიანტი | რა არის | ბაზრის მონაცემები |
| --- | --- | --- |
| `dist/rotation-calculator.html` | ერთი ფაილი, ორმაგი დაწკაპუნებით იხსნება, ინტერნეტი არ სჭირდება | მხოლოდ ხელით შეყვანა ან JSON იმპორტი |
| Cloudflare Worker (`dist/web/index.html` + `worker/index.js`) | იგივე გვერდი ინტერნეტში + მცირე სერვერული ნაწილი `/api/market` | Numbeo-დან ავტომატურად — **მხოლოდ** გასაღებისა და ლიცენზიის არსებობისას |

ფინანსური გაანგარიშება ორივე ვარიანტში ბრაუზერში სრულდება და შედეგი ერთნაირია. Worker-ს ეგზავნება მხოლოდ ქალაქის შიდა ID და ვალუტა.

**სტატიკური ატვირთვა ≠ Worker-ის გამოქვეყნება.** თუ HTML-ს უბრალოდ ატვირთავთ რომელიმე ჰოსტინგზე (ან Cloudflare dashboard-ში drag-and-drop-ით Pages-ზე), იმუშავებს მხოლოდ გვერდი, `/api/market` — არა. Cloudflare-ის დოკუმენტაციის მიხედვით dashboard-ის drag-and-drop სერვერულ ფუნქციებს არ აქვეყნებს. ამ პროექტში სერვერული ნაწილი ქვეყნდება **მხოლოდ** `wrangler deploy` ბრძანებით (§5).

## 1. წინაპირობები

1. Node.js 20 ან უფრო ახალი (შემოწმდა 22.22) და npm.
2. Cloudflare-ის ანგარიში. Access-ისთვის (§6) ჩართული უნდა იყოს Zero Trust (უფასო გეგმაც საკმარისია მცირე გუნდისთვის — დააზუსტეთ მიმდინარე პირობები).
3. ავტომატური ბაზრის მონაცემებისთვის: Numbeo API-ის ფასიანი გამოწერა და **ლიცენზიის წერილობითი დადასტურება** სამინისტროს შიდა გამოყენებისთვის (იხ. `docs/providers.md` §6). გასაღების გარეშეც ყველაფერი მუშაობს — ბაზრის ბლოკი აჩვენებს „პროვაიდერი არ არის კონფიგურირებული“ და ხელით შეყვანის ფორმას.

## 2. ინსტალაცია, ტესტები, აწყობა

```sh
cd rotation-calculator        # გახსნილი არქივის ან რეპოზიტორიის საქაღალდე
npm ci                        # დამოკიდებულებები lockfile-დან
npm test                      # ერთეულის, მონაცემების, პროვაიდერისა და Worker-ის ტესტები
npm run build                 # → dist/rotation-calculator.html და dist/web/index.html
```

`dist/web/`-ში მხოლოდ საჯარო გვერდი ხვდება; საიდუმლოებები და სამუშაო დოკუმენტები იქ არ უნდა მოხვდეს.

## 3. ლოკალური გაშვება

```sh
cp .dev.vars.example .dev.vars     # ცარიელი NUMBEO_API_KEY = პროვაიდერი გამორთულია
npm run dev                        # = npm run build && wrangler dev
```

გახსენით `http://localhost:8787`. შემოწმება:

```sh
curl http://localhost:8787/api/market/health
# {"schemaVersion":1,"status":"not_configured","keyConfigured":false,"mappedLocations":0,...}
```

თუ ლიცენზირებული გასაღები გაქვთ, ჩაწერეთ ის `.dev.vars`-ში (`NUMBEO_API_KEY="..."`). **`.dev.vars` არასოდეს ატვირთოთ git-ში ან არქივში** — ის `.gitignore`-შია.

## 4. შემოწმება განთავსების გარეშე

```sh
npm run deploy:dry       # = npm run build && wrangler deploy --dry-run --outdir .wrangler-dry
```

მოსალოდნელი შედეგი: ჩამოთვლილია `env.MARKET_RATE_LIMITER (60 requests/60s)`, `env.ASSETS`, `MARKET_*` ცვლადები და ბოლოს `--dry-run: exiting now.` ანგარიში ამისთვის არ არის საჭირო.

## 5. განთავსება Cloudflare-ზე

```sh
npx wrangler login       # ბრაუზერში შედით Cloudflare-ის ანგარიშით
npm run deploy           # = npm run build && wrangler deploy
```

ბრძანება დაბეჭდავს მისამართს, მაგ. `https://rotation-calculator.<თქვენი-subdomain>.workers.dev`.
**ამ მისამართს არავის გაუზიაროთ, სანამ §6 (Access) არ დასრულდება** — `workers.dev` ნაგულისხმევად საჯაროა. უსაფრთხო გზაა წინასწარ ჩართოთ „Protect all Workers“ (§6, ვარიანტი ბ).

## 6. წვდომის კონტროლი — Cloudflare Access (სავალდებულო)

ლიცენზია აპის გამოყენებას მხოლოდ სამინისტროს ავტორიზებულ თანამშრომლებს უშვებს. CORS ან Origin-ის შემოწმება ავთენტიფიკაცია **არ არის**.

ა) ერთი Worker: Cloudflare dashboard → **Workers & Pages** → `rotation-calculator` → **Access** → *Protect this Worker behind Access* → *All traffic* → Authentication policy (მაგ. სამინისტროს ელფოსტის დომენი ან IdP ჯგუფი) → *Apply Access*. ეს იცავს `workers.dev`-ს, საკუთარ დომენებს და preview-ებს.

ბ) ყველა Worker: **Workers & Pages** → ბარათი *Protect all Workers* → *Enable Access* → *All traffic* → პოლიტიკა → *Apply Access*.

შემოწმება: ინკოგნიტო ფანჯარაში მისამართის გახსნისას უნდა გამოჩნდეს Access-ის შესვლის გვერდი.

რეკომენდაცია: წარმოებისთვის გამოიყენეთ სამინისტროს საკუთარი დომენი (Cloudflare zone) და შემდეგ `wrangler.jsonc`-ში დააყენეთ `"workers_dev": false`.

შენიშვნები: Access-ის უკან Worker-ს მომხმარებლის ვინაობა (`ctx.access`) Static Assets-ის გამო არ გადაეცემა, და Cloudflare Cache API მიუწვდომელია (იხ. §9).

## 7. Numbeo-ს გასაღების ჩასმა (მხოლოდ ლიცენზიის შემდეგ)

```sh
npx wrangler secret put NUMBEO_API_KEY    # ჩასვით მნიშვნელობა მოთხოვნისას; ახალი ვერსია მაშინვე ქვეყნდება
```

ან dashboard: Workers & Pages → Worker → Settings → Variables and Secrets → Add → ტიპი **Secret**.
გასაღები **არასოდეს** ჩაწეროთ `wrangler.jsonc`-ში, HTML-ში, URL-ში ან რეპოზიტორიაში.
ამის შემდეგ `/api/market/health` აჩვენებს `keyConfigured: true`; `status` იქნება `configured` მხოლოდ §8-ის შემდეგ.

## 8. ქალაქების რუკის შევსება (`src/providers/numbeo-city-map.json`)

Numbeo-ს ქალაქის ID-ები **არ უნდა გამოიგონოთ** — ისინი აიღეთ Numbeo-ს `/api/cities`-დან. ეს ერთჯერადი სამუშაოა დეველოპერის კომპიუტერზე:

```sh
export NUMBEO_API_KEY='...'      # მხოლოდ ამ ტერმინალის სესიაში
curl -s -H "X-Api-Key: $NUMBEO_API_KEY" "https://www.numbeo.com/api/cities?country=AT" > /tmp/cities-AT.json
curl -s -H "X-Api-Key: $NUMBEO_API_KEY" "https://www.numbeo.com/api/items" > /tmp/items.json
```

1. `/tmp/cities-AT.json`-ში იპოვეთ ქალაქი (`city`, `country`, `city_id`) და დაამატეთ ჩანაწერი შიდა ID-ით (`src/data/normative-data.json` → `locations[].id`):
   ```json
   "cities": {
     "AT-VIENNA": { "numbeoCityId": "<city_id>", "numbeoCity": "<city ზუსტად როგორც პასუხშია>",
                    "numbeoCountry": "<country>", "countryCode": "AT", "matchStatus": "exact",
                    "note": null, "verifiedAt": "YYYY-MM-DD" }
   }
   ```
   - ერთი ქვეყნის სხვადასხვა ქალაქი ცალ-ცალკე (პარიზი/სტრასბურგი, ვაშინგტონი/ნიუ-იორკი, ბერნი/ჟენევა).
   - თუ ქალაქი Numbeo-ში არ არის და იყენებთ ახლომდებარეს (მაგ. ვატიკანი → რომი): `"matchStatus": "nearby-explained"` და `note`-ში ქართული ახსნა. „exact“ ასეთ შემთხვევაში დაუშვებელია.
   - ქალაქი, რომელიც ვერ იპოვეთ — **არ დაამატოთ** (აპი აჩვენებს „პროვაიდერი არ არის კონფიგურირებული“).
2. `/tmp/items.json`-ში შეამოწმეთ: 26 = „Apartment (1 bedroom) in City Centre“, 27 = „… Outside of Centre“, 28 = „Apartment (3 bedrooms) in City Centre“. იპოვეთ „3 bedrooms Outside of Centre“-ის `item_id` და ჩაწერეთ `items.outside_3br.itemId`-ში (ახლა `null`).
3. `_meta.status` → `"verified"`, `verifiedAt`, `verifiedBy`.
4. `npm test`, შემდეგ `npm run deploy`.
5. ფასები ფაილში **არ** ინახება — მხოლოდ ID-ები და სახელები. `/tmp/*.json` წაშალეთ.

## 9. ქეშის ჩართვა — მხოლოდ ლიცენზიის დადასტურების შემდეგ

ნაგულისხმევად სერვერული ქეში გამორთულია (`MARKET_CACHE_TTL_SECONDS="0"`): ყოველი ქალაქის ჩატვირთვა = 2 მოთხოვნა Numbeo-ზე (Basic გეგმის 200 000/თვე შიდა გამოყენებას ჰყოფნის).
როცა Numbeo **წერილობით** დაადასტურებს ქეშირებას, `wrangler.jsonc`-ში:

```jsonc
"MARKET_CACHE_TTL_SECONDS": "86400",   // 24 სთ (ან ლიცენზიით დაშვებული ვადა)
"MARKET_STALE_MAX_SECONDS": "86400",   // რამდენ ხანს შეიძლება ძველი ასლის ჩვენება შეცდომისას (0 = არასოდეს)
"MARKET_LICENSE_CONFIRMED": "true"     // ქრება გაფრთხილება „ლიცენზია დაუდასტურებელია“
```

შემდეგ `npm run deploy`. ქეშის გასაღები შეიცავს პროვაიდერს, ქალაქს, ვალუტას და სქემის ვერსიას.
შეზღუდვა: Cloudflare-ის დოკუმენტაციით Access-ის უკან Cache API მიუწვდომელია; ასეთ დროს Worker იყენებს მხოლოდ დროებით მეხსიერებას (თითო ინსტანციაში), ამიტომ ქეში „საუკეთესო მცდელობის“ პრინციპით მუშაობს. მუდმივი ქეში (KV) ცალკე ლიცენზიურ დადასტურებას და კოდის ცვლილებას საჭიროებს.

## 10. სხვა პარამეტრები (`wrangler.jsonc` → `vars`)

| ცვლადი | ნაგულისხმევი | აზრი |
| --- | --- | --- |
| `MARKET_PROVIDER` | `numbeo` | სხვა მნიშვნელობა = პროვაიდერი გამორთულია |
| `MARKET_UPSTREAM_TIMEOUT_MS` | `8000` | Numbeo-ს პასუხის ლოდინი; განმეორებითი ცდა არ ხდება |
| `MARKET_ALLOWED_CURRENCIES` | `EUR,USD` | დაშვებული ვალუტები |
| `ratelimits[0].simple.limit` | `60` / 60 წმ | მიახლოებითი ლიმიტი თითო Cloudflare ლოკაციაზე; გადაჭარბებისას — „მოთხოვნების ლიმიტი ამოიწურა“ |

## 11. განახლება და დაბრუნება

```sh
npm run deploy                       # ახალი ვერსია
npx wrangler deployments list        # ისტორია
npx wrangler rollback                # წინა ვერსიაზე დაბრუნება
npx wrangler tail                    # ცოცხალი ლოგები (შეიცავს მხოლოდ ქალაქს, ვალუტას, სტატუსებს)
```

## 12. პრობლემების მოგვარება

| სიმპტომი | მიზეზი / გადაწყვეტა |
| --- | --- |
| ბაზრის ბლოკი: „პროვაიდერი არ არის კონფიგურირებული“ | არ არის `NUMBEO_API_KEY` (§7) ან ქალაქი რუკაში (§8). `/api/market/health` აჩვენებს რომელი. |
| „პროვაიდერთან წვდომა უარყოფილია“ | Numbeo-მ გასაღები უარყო (401/403) — შეამოწმეთ გამოწერა/გასაღები. |
| „მოთხოვნების ლიმიტი ამოიწურა“ | ჩვენი ლიმიტერი ან Numbeo-ს კვოტა; შეამოწმეთ `https://www.numbeo.com/api/check_usage.html`. |
| `/api/market` აბრუნებს HTML-ს | Access-ის სესია ამოიწურა — გადატვირთეთ გვერდი და შედით თავიდან. |
| `wrangler dev`: „Unable to fetch the Request.cf object“ | უვნებელია (ქსელის შეზღუდვა); ლოკალური მუშაობა გრძელდება. |

## 13. რა არ შემოწმებულა

- რეალური Cloudflare ანგარიშზე `wrangler deploy`, `wrangler secret put` და Access-ის დაყენება.
- Numbeo-ს ნამდვილი პასუხები (ტესტები იყენებს დოკუმენტაციის ფორმის **სინთეზურ** მაგალითებს).
- Cache API-ის ქცევა Access-ის უკან.
