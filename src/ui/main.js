// esbuild-ის შესასვლელი წერტილი (scripts/build.mjs). ნორმატიული მონაცემები ჩაშენდება build-ისას.
import data from '../data/normative-data.json';
import { createMarketClient } from '../providers/index.js';
import { startApp } from './app.js';

/* global __APP_VERSION__, __RULES_VERSION__, __DATA_SHA256__, __BUILD_DATE__ */
const meta = {
  appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev',
  rulesVersion: typeof __RULES_VERSION__ !== 'undefined' ? __RULES_VERSION__ : data.rulesVersion,
  dataSha: typeof __DATA_SHA256__ !== 'undefined' ? __DATA_SHA256__ : 'unknown',
  buildDate: typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'dev',
};

// ონლაინ რეჟიმი მხოლოდ http/https-დან (Cloudflare Worker, same-origin /api/market). file:// — ქსელის მოთხოვნა არ იგზავნება.
const online = location.protocol === 'http:' || location.protocol === 'https:';
const client = online ? createMarketClient({ endpoint: '/api/market', timeoutMs: 15000 }) : null;

function boot() {
  for (const el of document.querySelectorAll('[data-meta]')) el.textContent = meta[el.getAttribute('data-meta')] ?? '';
  const mode = document.getElementById('run-mode');
  if (mode) mode.textContent = online ? 'ფასები: Numbeo.com' : 'ოფლაინ ვერსია';
  window.__rotationApp = startApp({ data, meta, online, client });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
