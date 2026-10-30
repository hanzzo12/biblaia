#!/usr/bin/env node
// რეალური Apify გაშვების შემოწმება (ერთჯერადი, ხელით). ტოკენს კითხულობს მხოლოდ `.dev.vars`-დან (ან APIFY_TOKEN გარემოდან);
// ტოკენს/სრულ URL-ს არასოდეს ბეჭდავს. ბეჭდავს ნორმალიზებულ MarketData-ს და ინახავს პასუხის *ფორმას*
// (გასაღებები + პირველი ჩანაწერის შემოკლებული ასლი) ფაილში sources/extracted/apify-sample-shape.json — სქემის დასადასტურებლად.
//
//   node scripts/live-check-apify.mjs [AT-VIENNA US-NEW-YORK] [--currency=EUR]
//   პროქსის უკან: NODE_USE_ENV_PROXY=1 node scripts/live-check-apify.mjs
// შენიშვნა: თითო გაშვება ხარჯავს Apify-ის კრედიტს (3 actor run: 2 ქალაქი + rankings).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runActor, normalizeApify } from '../src/providers/apify-numbeo-adapter.js';
import { validateMarketData } from '../src/providers/market-contract.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = JSON.parse(readFileSync(path.join(root, 'src/providers/numbeo-city-names.json'), 'utf8'));

function readToken() {
  if (process.env.APIFY_TOKEN && process.env.APIFY_TOKEN.trim()) return process.env.APIFY_TOKEN.trim();
  const f = path.join(root, '.dev.vars');
  if (!existsSync(f)) return null;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^\s*APIFY_TOKEN\s*=\s*(.*)\s*$/.exec(line);
    if (m) { const v = m[1].replace(/^(['"])(.*)\1$/, '$2').trim(); return v || null; }
  }
  return null;
}
const token = readToken();
const scrub = (/** @type {string} */ s) => (token ? s.split(token).join('[REDACTED]') : s).replace(new RegExp(['apify', '_api_'].join('') + '[A-Za-z0-9]+', 'g'), '[REDACTED]');

/** ფორმა: გასაღებები და შემოკლებული მნიშვნელობები. @param {unknown} v @param {number} depth */
function shape(v, depth = 0) {
  if (Array.isArray(v)) return depth > 3 ? `[array(${v.length})]` : { _array: v.length, first: shape(v[0], depth + 1) };
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).slice(0, 40).map(([k, x]) => [k, shape(x, depth + 1)]));
  if (typeof v === 'string') return scrub(v.slice(0, 80));
  return v;
}

const args = process.argv.slice(2);
const currency = (args.find((a) => a.startsWith('--currency=')) || '--currency=EUR').split('=')[1];
const locs = args.filter((a) => !a.startsWith('--'));
const targets = locs.length ? locs : ['AT-VIENNA', 'US-NEW-YORK'];

if (!token) { console.error('APIFY_TOKEN არ არის (.dev.vars ან გარემო). შეწყდა.'); process.exit(2); }
console.log(`Apify live check — ${new Date().toISOString()} — locations: ${targets.join(', ')}, currency: ${currency}`);

const out = { checkedAt: new Date().toISOString(), actor: 'automation-lab/numbeo-scraper', note: 'Shape only (keys + first item truncated). No token, no full data.', runs: {} };
let anyOk = false;
const rankings = await runActor({ input: { mode: 'rankings' }, token, fetchImpl: fetch, timeoutMs: 120000 });
console.log(`rankings: status=${rankings.status} http=${rankings.http} ms=${rankings.ms}${'items' in rankings ? ` items=${rankings.items.length}` : ''}`);
if ('items' in rankings) { anyOk = true; out.runs.rankings = shape(rankings.items); }

for (const loc of targets) {
  const entry = names.locations[loc];
  if (!entry) { console.log(`${loc}: რუკაში არ არის`); continue; }
  const prices = await runActor({ input: { mode: 'city_prices', cities: [entry.numbeoCity], currency }, token, fetchImpl: fetch, timeoutMs: 120000 });
  console.log(`${loc} (${entry.numbeoCity}): status=${prices.status} http=${prices.http} ms=${prices.ms}${'items' in prices ? ` items=${prices.items.length}` : ''}`);
  if ('items' in prices) { anyOk = true; out.runs[`city_prices:${loc}`] = shape(prices.items); }
  const md = normalizeApify({ locationId: loc, currency, entry, prices, rankings, fetchedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') });
  const v = validateMarketData(md);
  console.log(scrub(JSON.stringify({ valid: v.ok, errors: v.errors.slice(0, 5), md }, null, 1)));
}

if (anyOk) {
  const dir = path.join(root, 'sources/extracted');
  mkdirSync(dir, { recursive: true });
  const text = scrub(JSON.stringify(out, null, 1));
  if (text.includes(token)) throw new Error('token leak guard');
  writeFileSync(path.join(dir, 'apify-sample-shape.json'), text + '\n');
  console.log('→ sources/extracted/apify-sample-shape.json');
} else {
  console.log('წარმატებული პასუხი არ მივიღეთ — ფორმის ფაილი არ შეიქმნა.');
  process.exitCode = 1;
}
