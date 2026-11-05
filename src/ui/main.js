// esbuild-ის შესასვლელი წერტილი (scripts/build.mjs). ნორმატიული მონაცემები ჩაშენდება build-ისას.
import './polyfill.js';
import data from '../data/normative-data.json';
import * as P from '../providers/index.js';
import marketSnapshot from '../data/market-snapshot.json';
import apifySnapshot from '../data/market-apify-snapshot.json';
import { startApp } from './app.js';
import { mountCities } from './cities.js';

/* global __APP_VERSION__, __RULES_VERSION__, __DATA_SHA256__, __BUILD_DATE__ */
const meta = {
  appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev',
  rulesVersion: typeof __RULES_VERSION__ !== 'undefined' ? __RULES_VERSION__ : data.rulesVersion,
  dataSha: typeof __DATA_SHA256__ !== 'undefined' ? __DATA_SHA256__ : 'unknown',
  buildDate: typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'dev',
};
// ბაზრის ფასები მხოლოდ http/https-დან (Cloudflare Worker, same-origin /api/market). file:// — ქსელის მოთხოვნა არ იგზავნება.
const online = location.protocol === 'http:' || location.protocol === 'https:';
const client = online ? P.createMarketClient({ endpoint: '/api/market', timeoutMs: 100000 }) : null;
// ოფლაინ (file://): პროვაიდერის ჩაშენებული ასლი, თუ ხელმისაწვდომია (contracts §9)
const offline = (loc, cur) => {
  const md = P.marketDataFromSnapshot(marketSnapshot, loc, cur, { apifySnapshot });
  return md && P.validateMarketData(md).ok ? md : null;
};

function boot() {
  for (const el of document.querySelectorAll('[data-meta]')) el.textContent = meta[el.getAttribute('data-meta')] ?? '';
  window.__rotationApp = startApp({ data, meta, online, client, offline: online ? null : offline, usdPerEur: marketSnapshot.usdPerEur?.exact ?? null });
  const cities = mountCities(document.getElementById('cities-body'), {
    data,
    async loadSummary() {
      const live = online && client?.summary ? await client.summary() : null;
      return live ?? P.marketSummaryFromSnapshots(marketSnapshot, apifySnapshot, data);
    },
  });
  setupTabs(() => cities.load());
}
/** ჩანართები „კალკულატორი“ | „ქალაქების სიძვირე“ (ARIA tabs, ← → კლავიშები) */
function setupTabs(onCities) {
  const tabs = [document.getElementById('tab-calc'), document.getElementById('tab-cities')];
  const panels = [document.getElementById('app'), document.getElementById('cities')];
  const select = (i, focus = true) => {
    tabs.forEach((t, k) => { t.setAttribute('aria-selected', String(k === i)); t.tabIndex = k === i ? 0 : -1; panels[k].hidden = k !== i; });
    document.body.classList.toggle('tab-cities', i === 1);
    if (i === 1) onCities();
    if (focus) tabs[i].focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(i));
    t.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); select(i === 0 ? 1 : 0); } });
  });
  window.addEventListener('afterprint', () => document.body.classList.remove('print-cities'));
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
