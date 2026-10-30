# განთავსების სახელმძღვანელო (Cloudflare Workers)

შემოწმებულია 2026-10-30: Node 22, wrangler 4.155.0 — `npm test`, `npm run build`, `wrangler deploy --dry-run`. რეალურ Cloudflare ანგარიშზე განთავსება და Apify-ის რეალური გაშვება ამ გარემოდან **არ შესრულებულა** (ქსელი დაბლოკილია).

## 0. რა რისთვისაა

- **ძირითადი გზა — Cloudflare Worker**: გვერდი (`dist/web/index.html`) + `/api/market` (ბაზრის მონაცემები Apify-ით, 30-დღიანი ქეშით).
- **`dist/rotation-calculator.html`** — იგივე გამოთვლები ერთ ფაილში, ოფლაინ; ბაზრის მონაცემი მხოლოდ ხელით/JSON-ით.
- **სტატიკური ატვირთვა ≠ Worker-ის გამოქვეყნება.** HTML-ის უბრალო ატვირთვისას (მაგ. Pages drag-and-drop) `/api/market` არ იმუშავებს. Worker ქვეყნდება მხოლოდ `wrangler deploy`-ით (§5).

## 1. წინაპირობები

Node.js ≥ 20, npm, Cloudflare ანგარიში, Apify ანგარიში და API ტოკენი (Apify Console → Settings → API & Integrations). ტოკენის გარეშეც ყველაფერი მუშაობს — ბაზრის ბლოკი აჩვენებს „მონაცემთა წყარო არ არის კონფიგურირებული“.

## 2. ინსტალაცია, ტესტი, აწყობა

```sh
npm ci
npm test            # ერთეულის, მონაცემების, პროვაიდერის, Worker-ის და საიდუმლოების შემოწმების ტესტები
npm run build       # → dist/rotation-calculator.html და dist/web/index.html
```

## 3. ლოკალური გაშვება

```sh
cp .dev.vars.example .dev.vars      # ჩაწერეთ APIFY_TOKEN="..." (ფაილი .gitignore-შია; არასოდეს გააზიაროთ)
npm run dev                         # = build + wrangler dev → http://localhost:8787
curl http://localhost:8787/api/market/health
```

`health` აჩვენებს: `provider`, `tokenConfigured`, `cacheBackend` (`kv` / `cache-api` / `memory`), `mappedLocations`. ლოკალურად KV-ს wrangler ემულაციით ქმნის.

## 4. KV ქეშის შექმნა (ერთხელ)

```sh
npx wrangler login
npx wrangler kv namespace create MARKET_CACHE
```

ბრძანება დაბეჭდავს `id`-ს. ჩასვით `wrangler.jsonc`-ში `"id": "REPLACE_WITH_KV_NAMESPACE_ID"`-ის ნაცვლად. (KV-ის გარეშე: წაშალეთ `kv_namespaces` ბლოკი — Worker გამოიყენებს Cache API-ს, რომელიც მხოლოდ ერთ მონაცემთა ცენტრშია.)

## 5. ტოკენი და განთავსება

```sh
npx wrangler secret put APIFY_TOKEN     # ჩასვით ტოკენი მოთხოვნისას
npm run deploy:dry                      # შემოწმება ატვირთვის გარეშე
npm run deploy                          # → https://rotation-calculator.<subdomain>.workers.dev
```

შემოწმება: `https://…/api/market/health` → `"status":"configured"`, `"cacheBackend":"kv"`. პირველი მოთხოვნა ქალაქზე შეიძლება 30–90 წამი გაგრძელდეს (Apify-ის გაშვება); შემდეგ 30 დღე ქეშიდან.

## 6. პარამეტრები (`wrangler.jsonc` → `vars`)

| ცვლადი | ნაგულისხმევი | აზრი |
| --- | --- | --- |
| `MARKET_PROVIDER` | `apify` | `off` — ბაზრის მონაცემების სრული გამორთვა (Numbeo-ს პირობების რისკის შემთხვევაში) |
| `MARKET_CACHE_TTL_DAYS` | `30` | ქეშის ვადა |
| `MARKET_STALE_MAX_DAYS` | `365` | რამდენ ხანს ჩანს ძველი ასლი („მოძველებულია“), თუ ახალი ვერ მივიღეთ |
| `MARKET_UPSTREAM_TIMEOUT_MS` | `90000` | Apify-ის პასუხის ლოდინი; განმეორებითი ცდა არ არის |
| `ratelimits` | 20 მოთხ./წთ/IP | მიახლოებითი ლიმიტი |

ცვლილების შემდეგ: `npm run deploy`. ქეშის გასუფთავება: `npx wrangler kv key list --binding MARKET_CACHE` და `npx wrangler kv key delete --binding MARKET_CACHE "<key>"` (ან ახალი namespace).

## 7. პირველი რეალური გაშვების შემოწმება

`NODE_USE_ENV_PROXY=1 node scripts/live-check-apify.mjs AT-VIENNA US-NEW-YORK` — ბეჭდავს ნორმალიზებულ მონაცემს (ტოკენის გარეშე) და ინახავს პასუხის ფორმას `sources/extracted/apify-sample-shape.json`-ში. შემდეგი ნაბიჯები — `docs/providers.md` §4.

## 8. განახლება, დაბრუნება, ლოგები

```sh
npx wrangler deployments list
npx wrangler rollback
npx wrangler tail        # ლოგში მხოლოდ ლოკაცია, ვალუტა, სტატუსი, ქეში, HTTP კოდი; ტოკენი/IP — არასოდეს
```

## 9. პრობლემები

| სიმპტომი | მიზეზი |
| --- | --- |
| „წყარო არ არის კონფიგურირებული“ | `APIFY_TOKEN` არ არის (§5) |
| „წყაროსთან წვდომა უარყოფილია“ + „კრედიტი ამოიწურა“ | ტოკენი არასწორია (401/403) ან Apify-ის ბალანსი (402) |
| „პასუხის ლოდინის დრო ამოიწურა“ | Apify-ის გაშვება > 90 წმ ან 408; სცადეთ მოგვიანებით |
| „პასუხი სხვა ქალაქს ეკუთვნის“ | ქალაქის სახელი `numbeo-city-names.json`-ში Numbeo-ს დაწერილობას არ ემთხვევა |
| `wrangler deploy`: KV id შეცდომა | §4 არ შესრულდა |
