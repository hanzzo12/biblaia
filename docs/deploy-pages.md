# როგორ ავტვირთო საიტი — Cloudflare Pages + GitHub (ბრძანებების გარეშე)

ეს არის **ძირითადი, უმარტივესი გზა**. ყველაფერი კეთდება ბრაუზერში, Cloudflare-ის პანელში (dashboard). ტერმინალი და ბრძანებები არ გჭირდებათ.
Cloudflare-ის დოკუმენტაციით გადამოწმებულია 2026-10-30. პანელში ღილაკების სახელები ინგლისურად წერია — ქვემოთ ზუსტად ისეა, როგორც ეკრანზე ჩანს.

> **რატომ არ იმუშავა ZIP-ის ჩაგდებამ (drag-and-drop)?**
> 1. არქივში `index.html` საქაღალდეების სიღრმეში იდო (`rotation-calculator/dist/web/`), ამიტომ მთავარ მისამართზე 404 ჩანდა.
> 2. ჩაგდებული ფაილებით Cloudflare **სერვერულ ნაწილს (Functions) არ უშვებს** — ბაზრის ფასები ასე ვერ იმუშავებს.
> 3. ჩაგდებით შექმნილ პროექტს (Direct Upload) GitHub-ს **მოგვიანებით ვერ მიაბამთ** — Cloudflare-ის დოკუმენტაციით საჭიროა **ახალი პროექტის შექმნა**. ამიტომ ქვემოთ ვქმნით ახალ პროექტს.

---

## ნაბიჯი 1 — ძველი პროექტის წაშლა (სურვილისამებრ)

ძველი `calculator-f1t` (ჩაგდებით შექმნილი) GitHub-ზე ვერ გადაერთვება. თუ აღარ გჭირდებათ:

1. გახსენით https://dash.cloudflare.com → მარცხნივ **Workers & Pages**.
2. აირჩიეთ პროექტი `calculator`.
3. **Settings** → გვერდის ბოლოში **Delete project** → დაადასტურეთ პროექტის სახელის ჩაწერით.
   *(ამ ღილაკის ზუსტი სახელი Cloudflare-ის დოკუმენტაციაში არ არის აღწერილი — პანელში შეიძლება ოდნავ განსხვავდებოდეს.)*

> მისამართს `calculator-f1t.pages.dev` ახალი პროექტი ავტომატურად ვერ მიიღებს. ახალ პროექტს ექნება ახალი მისამართი `<პროექტის-სახელი>.pages.dev` (სახელი §3-ში აირჩიეთ).

## ნაბიჯი 2 — KV „საცავის“ შექმნა (ფასების 30-დღიანი ქეშისთვის)

1. მარცხნივ **Storage & Databases** → **Workers KV** (პირდაპირი ბმული: https://dash.cloudflare.com/?to=/:account/workers/kv/namespaces).
2. **Create instance**.
3. სახელი: `MARKET_CACHE` → **Create**.

(KV-ის გარეშეც იმუშავებს, მაგრამ ქეში მხოლოდ დროებითი იქნება და Apify-ზე ხარჯი გაიზრდება.)

## ნაბიჯი 3 — Pages პროექტის შექმნა GitHub-იდან

1. **Workers & Pages** → **Create application** → ჩანართი **Pages** → **Connect to Git**.
2. აირჩიეთ **GitHub**. თუ გკითხავთ, დაუშვით Cloudflare-ს წვდომა თქვენს GitHub ანგარიშზე (**Install & Authorize**) — საკმარისია მხოლოდ რეპოზიტორია `hanzzo12/biblaia`.
3. სიიდან აირჩიეთ **`hanzzo12/biblaia`** → **Begin setup**.
4. **Set up builds and deployments** გვერდზე შეავსეთ:

| ველი | მნიშვნელობა |
| --- | --- |
| **Project name** | მაგ. `rotation-calculator` (ეს იქნება მისამართი: `rotation-calculator.pages.dev`) |
| **Production branch** | `ccr-733af0f1-rqqflu` (თუ კოდი `main`-ში გადავიდა — `main`) |
| **Framework preset** | `None` |
| **Build command** | `npm run build` |
| **Build output directory** | `dist/web` |
| **Root directory (advanced)** | ცარიელი (რეპოზიტორიის ფესვი) |

5. **Environment variables (advanced)** → **Add variable**:
   - `NODE_VERSION` = `22` (რეპოზიტორიაში `.node-version` ფაილიც არის — ეს დამატებითი გარანტიაა).
   - `APIFY_TOKEN` = თქვენი Apify ტოკენი → აუცილებლად დააჭირეთ **Encrypt** (ტოკენი დაიმალება და აღარავინ დაინახავს).
6. **Save and Deploy**. დაელოდეთ, სანამ ჟურნალში (build log) ბოლოს გამოჩნდება **Success** (რამდენიმე წუთი).

> თუ **Encrypt** ამ ეტაპზე არ ჩანს: ჯერ დააყენეთ მხოლოდ `NODE_VERSION`, დაასრულეთ, შემდეგ ნაბიჯი 4-ის მე-2 პუნქტით დაამატეთ `APIFY_TOKEN` როგორც Secret.

## ნაბიჯი 4 — KV-ის მიბმა და ტოკენის შემოწმება

1. **Workers & Pages** → აირჩიეთ ახალი პროექტი → **Settings** → **Bindings** → **Add** → **KV namespace**.
   - **Variable name**: `MARKET_CACHE` (ზუსტად ასე, დიდი ასოებით)
   - **KV namespace**: აირჩიეთ `MARKET_CACHE` → **Save**.
2. იქვე **Settings** → **Variables and Secrets**: დარწმუნდით, რომ `APIFY_TOKEN` არის ტიპით **Secret** (თუ არ არის — **Add** → სახელი `APIFY_TOKEN`, მნიშვნელობა ტოკენი, **Encrypt** → **Save**).
3. **ხელახალი განთავსება (Redeploy)** — Cloudflare-ის დოკუმენტაციით მიბმა/ცვლადი ძალაში მხოლოდ ახალ განთავსებაზე შედის: **Deployments** ჩანართი → ბოლო განთავსების მარჯვნივ **⋯** → **Retry deployment** *(ღილაკის სახელი დოკუმენტაციაში არ არის აღწერილი)*. უტყუარი ალტერნატივა: ნებისმიერი ახალი commit არჩეულ ფილიალში — Cloudflare თავად ააწყობს და განათავსებს.

## ნაბიჯი 5 — შემოწმება

გახსენით ბრაუზერში:

- `https://<პროექტის-სახელი>.pages.dev/` — კალკულატორი უნდა გამოჩნდეს.
- `https://<პროექტის-სახელი>.pages.dev/api/market/health` — უნდა ჩანდეს დაახლოებით:
  ```json
  {"status":"configured","provider":"apify","tokenConfigured":true,"cacheBackend":"kv", ...}
  ```
  - `"tokenConfigured": false` → ტოკენი არ არის ან არ არის **Secret**/გადატვირთვა არ მომხდარა (ნაბიჯი 4).
  - `"cacheBackend": "cache-api"` ან `"memory"` → KV არ არის მიბმული (ნაბიჯი 4.1) ან არ გადატვირთულა.
- კალკულატორში აირჩიეთ ქალაქი (მაგ. ვენა) — **პირველ ჯერზე ფასებს შეიძლება 30–90 წამი დასჭირდეს** (Apify აგროვებს); შემდეგ 30 დღე ჩაიტვირთება მყისიერად ქეშიდან.

## პარამეტრები (სურვილისამებრ, Settings → Variables and Secrets)

| სახელი | ნაგულისხმევი (თუ არ დაამატებთ) | რას აკეთებს |
| --- | --- | --- |
| `MARKET_PROVIDER` | `apify` | `off` — ბაზრის ფასების სრული გამორთვა |
| `MARKET_CACHE_TTL_DAYS` | `30` | ქეშის ვადა დღეებში |
| `MARKET_RANKINGS_ENABLED` | `true` | `false` — ინდექსები გამორთულია (დაზოგავს ≈ $2.75/თვე Apify-ზე) |
| `MARKET_STALE_MAX_DAYS` | `365` | რამდენ ხანს ჩანს ძველი ასლი, თუ ახალი ვერ მივიღეთ |

ყოველი ცვლილების შემდეგ — **Retry deployment** (ნაბიჯი 4.3).
ღირებულება (Apify): ≈ $0.015 ერთ ქალაქზე და ≈ $2.745 ინდექსების სრულ სიაზე, 30-დღიანი ქეშით ≈ $2.75/თვე + ქალაქები. დეტალები — `docs/providers.md` §4.

## განახლება

კოდის ყოველი ახალი ვერსია GitHub-ის არჩეულ ფილიალში (branch) **ავტომატურად** აეწყობა და განთავსდება. სხვა ფილიალები იქმნება როგორც „Preview“ მისამართები.

## სარეზერვო ვარიანტი — ZIP-ის ჩაგდება (მხოლოდ კალკულატორი, ფასების გარეშე)

თუ GitHub-ის მიბმა არ გინდათ: **Workers & Pages** → **Create application** → **Get started** → **Drag and drop your files** → პროექტის სახელი → ჩააგდეთ **`release/pages-upload.zip`** (მის ფესვში არის `index.html`) → **Save and Deploy**.
ამ რეჟიმში **ბაზრის ფასები არ მუშაობს** (Functions არ ეშვება) — ფასების ბლოკში ჩანს „ფასები ამჟამად მიუწვდომელია“; ყველა ოფიციალური გამოთვლა მუშაობს. ასეთ პროექტს GitHub-ს მოგვიანებით ვერ მიაბამთ.

## დანართი — ბრძანების ხაზის (CLI) გზები დეველოპერებისთვის

- **ლოკალური შემოწმება Pages-ის რეჟიმში:** `.dev.vars.example` → `.dev.vars` (ჩაწერეთ `APIFY_TOKEN`), შემდეგ `npm run pages:dev` → http://localhost:8788 (Functions საქაღალდე `functions/` ავტომატურად აიტვირთება; KV ლოკალურად ემულირდება).
- **Cloudflare Workers (CLI) გზა:** `docs/deploy.md` (`wrangler.jsonc`, `npm run deploy`).
- ტექნიკური დეტალები: `functions/api/market/index.js`, `functions/api/market/health.js`, `functions/api/[[path]].js` — თხელი შეფუთვები `worker/market-worker.js`-ზე (იგივე ლოგიკა ორივე გზაზე).
