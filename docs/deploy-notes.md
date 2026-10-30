# Cloudflare deployment notes (technical input for the Georgian `docs/deploy.md`)

Prepared 2026-10-29 by the External Data & Cloudflare engineer (phase 1). Nothing has been deployed; no Cloudflare account or API token was used.

## 0. How this was verified

- `developers.cloudflare.com` is **blocked** by this session's network policy, so the docs were read from their official source repository **`github.com/cloudflare/cloudflare-docs`**, commit `5019759c06518fc7270c662cacd32bc29d16ab43` (2026-10-28 23:43 UTC), sparse checkout on 2026-10-29. Each section lists the published URL that corresponds to the source file.
- **wrangler 4.155.0** (npm, published 2026-10-28; bundled `workerd` 1.20261023.1) was installed in a scratch directory. Its `config-schema.json` was inspected, and a prototype with the proposed config was run through:
  - `npx wrangler deploy --dry-run --outdir .out` → **passed**: it listed the bindings `MARKET_RATE_LIMITER (30 requests/60s)`, `ASSETS` and the `vars`, then printed "--dry-run: exiting now."
  - `npx wrangler dev --ip 127.0.0.1 --port 8799` → `/` served the asset (200), `/api/market` reached the Worker, the rate-limit binding returned `success: true` locally, and `/api/x` and `/nope` returned 404. Without `.dev.vars` the secret was absent (`configured:false`). With `.dev.vars` containing a dummy `NUMBEO_API_KEY`, Wrangler logged "Using secrets defined in .dev.vars" and the Worker saw it (`configured:true`).
  - The harmless dev warning "Unable to fetch the `Request.cf` object" appears because `workers.cloudflare.com` is blocked here.

## 1. Workers (Static Assets) vs Pages Functions — why Workers

| | Workers + Static Assets (chosen) | Pages + Functions |
| --- | --- | --- |
| One deploy path for HTML + `/api/market` | `wrangler deploy` (or Git CI) | `wrangler pages deploy` or Git integration |
| Dashboard drag-and-drop | n/a | **Does not compile/deploy `functions/`**: "Drag and drop deployments made from the Cloudflare dashboard do not currently support compiling a `functions` folder … you must use Wrangler." (pages/get-started/direct-upload) and "Direct Upload from the Cloudflare dashboard is currently not supported with Functions." (pages/functions/get-started) |
| Rate Limiting binding, Workers Caching, observability | yes | partial (see compatibility matrix in the migration guide) |
| Cloudflare's own guidance | the migration guide says Workers has "a distinctly broader set of features" and documents moving Pages projects to Workers | — |
| Pricing | static asset requests free and unlimited; Worker invocations billed as Workers | same model |

URLs: https://developers.cloudflare.com/workers/static-assets/ · https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/ · https://developers.cloudflare.com/pages/get-started/direct-upload/ · https://developers.cloudflare.com/pages/functions/get-started/

## 2. Proposed `wrangler.jsonc` (validated with `--dry-run` on 4.155.0)

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "rotation-calculator",
  "main": "worker/index.js",
  // Use a date the bundled workerd supports. wrangler 4.155.0 bundles workerd 1.20261023.1;
  // 2026-10-28 passed the dry run. Pin it and bump it deliberately.
  "compatibility_date": "2026-10-23",
  "assets": {
    "directory": "./dist/web/",
    "binding": "ASSETS",
    "not_found_handling": "none",          // enum: "single-page-application" | "404-page" | "none"
    "run_worker_first": ["/api/*"]          // array of globs, "!"-negation allowed, max 100 entries
  },
  "vars": {                                 // non-secret only
    "MARKET_PROVIDER": "numbeo",
    "MARKET_CACHE_TTL_SECONDS": "0",        // 0 = no server cache until Numbeo confirms in writing; then 86400
    "MARKET_STALE_MAX_SECONDS": "0",        // stale fallback disabled by default
    "MARKET_UPSTREAM_TIMEOUT_MS": "8000",
    "MARKET_ALLOWED_CURRENCIES": "EUR,USD",
    "MARKET_LICENSE_CONFIRMED": "false"
  },
  "ratelimits": [
    { "name": "MARKET_RATE_LIMITER", "namespace_id": "4201", "simple": { "limit": 60, "period": 60 } }
  ],
  "observability": { "enabled": true },
  "workers_dev": true,                      // set to false once a custom domain + Access is in place
  "preview_urls": false                     // schema default false; keep previews off (or protect them with Access)
}
```

Notes:
- **Do not** put `NUMBEO_API_KEY` in `vars`. The docs say: "Do not use `vars` to store sensitive information … Use secrets instead."
- `secrets.required` (for example `{"secrets": {"required": ["NUMBEO_API_KEY"]}}`) exists and makes `wrangler deploy` **fail** when the secret is missing. It also makes `.dev.vars` load only the listed keys. **Do not use it at top level**: we want the Worker to deploy without a key and report `not_configured`. If wanted, add it only under a `production` environment. Note that `secrets` is **not inherited** into named environments (schema note).
- `.assetsignore` in `dist/web/` uses `.gitignore` syntax. Use it if anything besides `index.html` and fonts could land there. The build should copy only the release HTML into `dist/web/` anyway.
- Upload limits: 20,000 asset files per version on the Free plan (100,000 on paid), 25 MiB per file (`workers/platform/limits`). The single HTML file with an embedded font is far below this.

URLs: https://developers.cloudflare.com/workers/static-assets/binding/ · https://developers.cloudflare.com/workers/wrangler/configuration/ · https://developers.cloudflare.com/workers/platform/limits/

## 3. Routing

- Default behaviour is **asset first**: "if a requested URL matches a file in the static assets directory, that file will be served — without invoking Worker code. If no matching asset is found and a Worker script is present, the request will be processed by the Worker."
- `/api/market` never matches an asset, so the default already works. We still set `"run_worker_first": ["/api/*"]` so that an accidentally emitted `dist/web/api/...` file can never shadow the API.
- Free plan caveat (static-assets/billing-and-limitations): requests matching `run_worker_first` always invoke the Worker. Over the free request limit they get **429** instead of falling back to assets. Assets themselves stay free.
- The Worker must handle `/api/market`, return a JSON 404 for other `/api/*` paths, and pass everything else to `env.ASSETS.fetch(request)`. The prototype did exactly this.

URL: https://developers.cloudflare.com/workers/static-assets/routing/worker-script/

## 4. Secrets and local dev

- Production: `npx wrangler secret put NUMBEO_API_KEY`. It prompts for the value, **creates a new version and deploys it immediately**. With gradual deployments, use `npx wrangler versions secret put NUMBEO_API_KEY` followed by `wrangler versions deploy`.
- Alternative: `npx wrangler deploy --secrets-file <file>` (JSON or .env). It adds to existing secrets, and omitted secrets are kept. Do not document this for end users, because it puts the key in a file.
- Dashboard: Workers & Pages → Worker → Settings → Variables and Secrets → Add → type **Secret**.
- Local: put secrets in **either** `.dev.vars` **or** `.env` next to `wrangler.jsonc`, in dotenv syntax. Do not use both: if `.dev.vars` exists, `.env` is ignored. Both must be git-ignored (`.dev.vars*`, `.env*`). Ship `.dev.vars.example` with `NUMBEO_API_KEY=""`.
- Inside the Worker the key is read as `env.NUMBEO_API_KEY`.

URL: https://developers.cloudflare.com/workers/configuration/secrets/

## 5. Caching — **architecture risk**

1. **Cache API** (`caches.default` / `await caches.open('market')`, `cache.put(req, res)`, `cache.match(req)`):
   - The cache is data-centre local and not replicated. TTL comes from `Cache-Control` / `Expires` on the stored response. `stale-while-revalidate` and `stale-if-error` are **not** supported with put/match. Only GET keys work.
   - Works on custom domains. Operations in the dashboard editor and Playground do nothing.
   - **"For Workers fronted by Cloudflare Access, the Cache API is not currently available."** (workers/runtime-apis/cache). We plan to put the app behind Access, so **the Cache API cannot be relied on** in production.
2. **Workers Caching** (new; `"cache": { "enabled": true }`, requires Wrangler ≥ 4.69.0):
   - Cloudflare checks the cache *before* running the Worker, driven by the response's `Cache-Control`. The cache key is path + query + entrypoint (host is not included) and, by default, the Worker version. Purging is done with `ctx.cache.purge()`.
   - It bypasses the cache when the request has `Authorization` or the response has `Set-Cookie`.
   - **How it interacts with Access and Static Assets is not documented in the pages read → unverified.** It also caches the whole `/api/market` response, so `cache.state` and `expiresAt` inside the body would be frozen.
3. **In-isolate memory** (`Map`): use it only to coalesce concurrent identical requests. It is not a persistent cache.

**Recommendation:** keep server caching **off** by default (`MARKET_CACHE_TTL_SECONDS="0"`). Licensing for caching is unconfirmed (see `docs/providers.md` §3), and the Basic quota (200k requests/month, 2 per city lookup) is ample for internal staff. If Numbeo approves caching later, either validate Workers Caching behind Access on a staging Worker, or add KV. KV is a new dependency and a persistent copy of the data, so the licence must allow it explicitly. Cache key: `v{schema}/{provider}/{locationId}/{currency}`.

URLs: https://developers.cloudflare.com/workers/runtime-apis/cache/ · https://developers.cloudflare.com/workers/cache/ · https://developers.cloudflare.com/workers/cache/configuration/

## 6. Rate limiting (Workers Rate Limiting binding)

Current syntax (verified in docs and in the 4.155.0 schema; requires Wrangler ≥ 4.36.0):

```jsonc
"ratelimits": [
  { "name": "MARKET_RATE_LIMITER", "namespace_id": "4201", "simple": { "limit": 30, "period": 60 } }
]
```

- `namespace_id` is a **string containing a positive integer**, unique per account. Bindings with the same id share counters.
- `period` must be **10 or 60**. `simple` is the only supported type.
- Use it as `const { success } = await env.MARKET_RATE_LIMITER.limit({ key })` and return 429 when `success` is false.
- Limits are **approximate and per Cloudflare location** (eventually consistent). The docs say a strict global limit needs a **Durable Object**; that is not needed for our volume.
- Choice of key: the docs advise against IP keys. `ctx.access` identity is not available to a Worker that has Static Assets (see §7). Use `market:<locationId>` plus a global key `market:all`, or the email from a validated Access JWT if that gets implemented.
- Rate limit bindings are not shown in the dashboard. Monitor 429s via Workers Logs.
- Also honour upstream 429 (map it to `rate_limited`, never retry automatically).

URL: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/

## 7. Cloudflare Access (authentication)

- Prerequisites: Zero Trust enabled on the account and permission to manage Workers and Access apps.
- Option "Protect one Worker" (dashboard: Workers & Pages → Worker → **Access** → *Protect this Worker behind Access* → *All traffic* → policy). It "automatically protects every domain associated with the Worker, including its routes, Custom Domains, `workers.dev` hostname, and previews." API: a self-hosted Access app with destination `{"type":"worker", …}`.
- Alternative: a hostname-based (self-hosted) Access application for a custom domain or path.
- **Limitations relevant to us:**
  - "Workers with Static Assets execute behind an internal router Worker. Access still protects the application and its assets. However, the router does not pass `ctx.access` to the user Worker." So our Worker **cannot read user identity via `ctx.access`**. Access enforcement at the edge still applies.
  - The Cache API is unavailable behind Access (§5).
- CORS or Origin checks are **not** authentication. The Worker should add no CORS headers (same-origin only).
- Defence in depth (optional, **unverified in this session**): validate the `Cf-Access-Jwt-Assertion` header against the team's JWKS (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`) and the application AUD. This needs the Access docs that were not read here.
- The offline `file://` HTML cannot use the Worker (no Access cookie, null origin). By design it uses manual entry or JSON import.

URLs: https://developers.cloudflare.com/workers/configuration/cloudflare-access/ · https://developers.cloudflare.com/workers/configuration/routing/workers-dev/

## 8. Hostname

- The docs recommend running production on a **custom domain or route**, not `workers.dev` ("treated as a Free website … for personal or hobby projects"). A ministry domain needs a Cloudflare zone, which is an organisational decision.
- If `workers.dev` is used, protect it with Access (it is public by default).

## 9. Command list (for the Georgian guide; ✓ = run successfully here)

```sh
npm ci                                              # from lockfile (lead's package.json)
npm run build                                       # produces dist/rotation-calculator.html + dist/web/index.html
npx wrangler dev                                    # ✓ local http://localhost:8787 (uses .dev.vars if present)
npx wrangler deploy --dry-run --outdir .wrangler-dry # ✓ no account needed
npx wrangler login                                  # requires a Cloudflare account (not done)
npx wrangler deploy                                 # not done (no account)
npx wrangler secret put NUMBEO_API_KEY              # not done (no account / no key)
```

The upstream fetch should use `AbortSignal.timeout(ms)` or an `AbortController` timer. Runtime support for `AbortSignal.timeout` is assumed and must be confirmed in the phase-3 `wrangler dev` test. No retries.

## 10. Risks for the lead

1. **Cache API is unavailable behind Access.** Cache is off by default; caching later needs a validated alternative (Workers Caching or KV) and licence approval.
2. **`ctx.access` is unavailable with Static Assets.** There is no per-user identity in the Worker unless the Access JWT is validated manually. This affects per-user rate limits and audit logs.
3. **The licence is unconfirmed.** Live integration can ship as code, but must stay `not_configured` until Numbeo confirms the audience, caching and print/export terms.
4. Production on a custom domain needs a Cloudflare zone for a ministry domain. With `workers.dev`, Access is mandatory.
5. The Free plan plus `run_worker_first` returns 429 on `/api/*` beyond the free request limit. That is acceptable, because the UI shows `rate_limited` and the calculator keeps working.
6. Package scope: `package.json` needs `"type": "module"` (or `.mjs` names) for `src/providers/market-contract.js` under `node --test`. Node 22 auto-detected ESM in my check, but the setting should be explicit.

## 11. Phase 3 — implementation verification (2026-10-29)

The real `wrangler.jsonc` in the repo root matches §2 (rate limit 60/60 s, `MARKET_LICENSE_CONFIRMED="false"`).

Files: `worker/index.js`, `src/providers/{index.js,numbeo-adapter.js,market-contract.js,numbeo-city-map.json}`, `wrangler.jsonc`, `.dev.vars.example`, `tests/providers/*.test.js`, `tests/worker/*.test.js`, `docs/deploy.md`.

| Command | Result |
| --- | --- |
| `node --test "tests/providers/**/*.test.js" "tests/worker/**/*.test.js"` | `# pass 61`, `# fail 0` |
| `npm run build` | **failed**: `Could not resolve "src/ui/main.js"`, because the UI was not finished yet. For the dry run only, a placeholder `dist/web/index.html` was written in `dist/` (never in `src/ui`) and then deleted. |
| `npx wrangler deploy --dry-run --outdir .wrangler-dry` | OK: "Total Upload: 353.09 KiB / gzip: 40.91 KiB". Bindings: `MARKET_RATE_LIMITER (60 requests/60s)`, `ASSETS`, the 6 `MARKET_*` vars. Ended with "--dry-run: exiting now." The bundle includes `normative-data.json` (≈227 KB), which is used to recognise location IDs. |
| `npx wrangler dev --ip 127.0.0.1 --port 8787`, no `.dev.vars` | `GET /api/market/health` → 200, `{"status":"not_configured","keyConfigured":false,"mappedLocations":0,"cacheTtlSeconds":0,"rateLimiter":true,...}`, `Cache-Control: private, no-store`, no CORS headers. `GET /api/market?location=AT-VIENNA&currency=EUR` → MarketData, `rent.status = not_configured`. `currency=GBP` → 400 `invalid_currency`. `/` → 200 (asset). `/api/x` → 404. Log line: `{"evt":"market","loc":"AT-VIENNA","cur":"EUR","rent":"not_configured","idx":"not_configured","cache":"none","reason":"no_key","ms":0}` |
| Same with a dummy `.dev.vars` key | "Using secrets defined in .dev.vars", `env.NUMBEO_API_KEY ("(hidden)")`. Health: `keyConfigured:true`, `status:not_configured` (city map is empty). The dummy key never appeared in the log. |

Implementation decisions:
- **Cache:** both the Cache API (`caches.open('market')`) and an in-isolate `Map` are written. Reads try the Cache API first and fall back to the Map, which matters because the Cache API is unavailable behind Access. Only responses without error statuses are stored. Stale data is served only when TTL > 0, the upstream call fails, and the entry is within `MARKET_STALE_MAX_SECONDS` of expiry.
- **Rate limiter:** applied only before an upstream call (cache hits don't count), with key `market:all`. An absent binding is skipped; a throwing binding fails open, so the calculator is never blocked. Our own limiter returns HTTP 429 with a MarketData body (`rate_limited`) and `Retry-After: 60`.
- **Upstream:** two parallel GETs with `X-Api-Key`, `redirect: "error"`, a timeout via `AbortController`, and **no retries**. A 200 response carrying `{error}` is mapped heuristically (key-related text → `unauthorized`, quota text → `rate_limited`, otherwise `invalid_response`).
- **Request validation:** only `location` and `currency`, each exactly once. The location must be in `normative-data.locations` or the city map, and the currency in `MARKET_ALLOWED_CURRENCIES` ∩ {EUR, USD}. Anything else → 400. Non-GET → 405. Unknown `/api/*` → 404.

## 12. ADR-003 (Apify/Numbeo) — verification, 2026-10-30

Superseded: §§5–7 caching/Access recommendations apply to the old Numbeo-API design. Eurostat and the official-API adapter were removed from the product.

| Check | Result |
| --- | --- |
| `node --test "tests/providers/**/*.test.js" "tests/worker/**/*.test.js"` | 53 pass, 0 fail (synthetic fixtures for both actor output shapes; mocked KV; token never in URL/logs/KV) |
| `npm run build` | ✓ `dist/rotation-calculator.html (666.1 KB)`, `dist/web/index.html` |
| `npx wrangler deploy --dry-run --outdir .wrangler-dry` | ✓ "Total Upload: 362.34 KiB / gzip: 43.09 KiB"; bindings `MARKET_CACHE (REPLACE_WITH_KV_NAMESPACE_ID) KV Namespace`, `MARKET_RATE_LIMITER (20 requests/60s)`, `ASSETS`, 5 `MARKET_*` vars; "--dry-run: exiting now." (the placeholder KV id is accepted by dry-run; a real deploy needs the id from `wrangler kv namespace create MARKET_CACHE`) |
| KV commands (wrangler 4.155.0 `--help`) | `wrangler kv namespace create <namespace>`, `wrangler kv key list --binding`, `wrangler kv key delete <key>` exist |
| Live Apify run: `NODE_USE_ENV_PROXY=1 node scripts/live-check-apify.mjs AT-VIENNA` (token from `.dev.vars`, not printed) | **Blocked**: `rankings: status=network_error`, `AT-VIENNA (Vienna): status=network_error`. The agent proxy reports `connect_rejected` for `api.apify.com:443` (and `apify.com:443`). No shape file was written. Re-run once the domain is allowed. |

Design notes:
- Cache: KV `MARKET_CACHE` (`expirationTtl = TTL + stale window`) → Cache API → in-isolate memory. Keys: `v2:numbeo-apify:<loc>:<cur>` and `v2:numbeo-apify:rankings` (one actor run for all cities). Values carry `expiresAt`; past TTL but within `MARKET_STALE_MAX_DAYS` they are served only when upstream fails (`status: stale`). Error results are never stored.
- Rate limit: key `market:<cf-connecting-ip>`; only applied on cache miss; the IP is never logged. Over the limit with a stale copy available → the stale copy is returned instead of 429.
- Upstream: `POST …/run-sync-get-dataset-items?timeout=<s>`, `Authorization: Bearer`, `redirect: "error"`, 90 s abort, no retries. 401/402/403 → `unauthorized` (402 adds `payment_required`), 408 → `timeout`, 429 → `rate_limited`, 5xx/404 → `upstream_error`, non-JSON/non-array → `invalid_response`, `[]` → `not_found`.
- Secret hygiene: `tests/providers/no-secrets.test.js` scans `src`, `worker`, `scripts`, `docs`, `tests`, `dist`, `release` (including zip entries) and `sources/extracted` for the Apify token prefix.

## 13. Live results with the real Apify token, 2026-10-30 (api.apify.com allowed; token only in `.dev.vars`, never printed)

| Run | Result |
| --- | --- |
| `node scripts/live-check-apify.mjs AT-VIENNA --currency=EUR --rankings-file=<547 names>` (Node, via proxy; no new rankings run) | HTTP 201, 55 rows, 15.8 s. Valid MarketData. All 4 rents present with ranges; basic85m2 and internet present; groceries basket 15 counted / 0 missing (alcohol and tobacco excluded); both meals present. `status: partial` only because the names-only rankings file has no index values (`indices: not_found`). |
| `US-WASHINGTON --currency=USD`, first try with input "Washington, DC" | **HTTP 400** after 42 s. The actor turns the name into a URL slug. Fix: the input name now drops ", XX" and parentheses (`pricesQueryFor` → "Washington"). |
| `US-WASHINGTON --currency=USD`, retry | HTTP 201, 55 rows, 7.8 s. Valid, USD. 4 rents, internet, basket 15/0 and meals present. basic85m2 was null because the US item is named "Basic Utilities for 915 Square Feet Apartment (…)". That spelling was added (915 sq ft ≈ 85 m²) and is covered by a test. |
| `wrangler dev` + `.dev.vars`, rankings seeded into local KV (`wrangler kv key put --local …`) | Health: `configured`, `cacheBackend: kv`, `tokenConfigured: true`. The seeded rankings were read from local KV (no rankings run). Two real bugs were found and fixed: (1) a named export in the main module (`export const RANKINGS_KEY`) stops workerd from starting ("Incorrect type for map entry"), so `worker/index.js` now has only a default export and the logic lives in `worker/market-worker.js`, with a test; (2) `redirect: "error"` throws `TypeError` in Workers, and calling the global fetch as an object method gives "Illegal invocation"; now `redirect: "manual"` (3xx → invalid_response) and a bound fetch wrapper, with tests. After the fixes, the upstream call from workerd fails with `Error: internal error` within a few ms. workerd in this sandbox does not use the HTTPS egress proxy (Node does), so the miss → hit sequence could not be shown live here. Cache miss/hit/stale are covered by Worker tests with a mocked KV. |

Approximate spend in these checks: 4 × city_prices ≈ $0.06 (no new rankings run).

## 14. Cloudflare Pages + Git (primary path from round 2), verified 2026-10-30 against developers.cloudflare.com

Doc facts (fetched as `…/index.md`):
- Git setup: Workers & Pages → **Create application** → **Pages** → **Connect to Git** → Install & Authorize → **Begin setup**. Fields: Production branch, Framework preset, Build command, Build output directory, Root directory (advanced), Environment variables. Then **Save and Deploy**.
- **Direct Upload projects cannot switch to Git integration**; a new project is required. Drag-and-drop does not compile `functions/`.
- Build image: Node default 22.23.4; override with `NODE_VERSION` or `.nvmrc`/`.node-version` (the repo has `.node-version` = `22`).
- Secrets: Settings → **Variables and Secrets** → Add → **Encrypt**. KV: Settings → **Bindings** → Add → **KV namespace**; redeploy needed. Create KV: **Workers KV** → **Create instance**.
- A Wrangler file is used for Pages only when it contains `pages_build_output_dir`; Workers keys like `main` don't apply. To avoid confusing Pages builds and `wrangler pages dev`, the Workers config was renamed to **`wrangler.worker.jsonc`** and the npm scripts pass `--config`.
- Routing: `functions/api/market/index.js` → `/api/market`; `functions/api/market/health.js` → `/api/market/health`; `functions/api/[[path]].js` → other `/api/*` return a JSON 404 (without it, Pages serves `index.html` with status 200). Pages CI auto-generates `_routes.json` when `functions/` exists.
- Button names "Retry deployment" and "Delete project" are not spelled out in the docs; the guide marks them as such.

Local verification (wrangler 4.155.0):
- `npx wrangler pages functions build --outdir …` → "Compiled Worker successfully".
- `npx wrangler pages dev dist/web --kv MARKET_CACHE` with `.dev.vars` → "Using secrets defined in .dev.vars". `/api/market/health` 200 `{"status":"configured","tokenConfigured":true,"cacheBackend":"kv","rateLimiter":false,…}`; `/` 200 text/html; `?currency=GBP` 400; POST 405; `/api/x` JSON 404. No paid Apify call was made.
- Workers path still works: `npx wrangler deploy --config wrangler.worker.jsonc --dry-run` → "Total Upload: 371.54 KiB / gzip: 44.33 KiB".
- `npm run build` currently fails only because `src/ui` is mid-rewrite (missing `./result.js`/`./compare.js`/`state.js` imports at the time of the checks); the Pages checks used the previous `dist/web`.
