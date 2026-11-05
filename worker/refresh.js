// @ts-check
/**
 * ყოველთვიური ფონური განახლება (Cron Trigger, ყოველ 15 წუთში ერთი „იაფი“ ნაბიჯი) — KV-ში შენახული მდგომარეობის მანქანა.
 *
 *  idle ──(now ≥ nextRefreshAt)──▶ start: ასინქრონული Apify გაშვებები (EUR ქალაქები, USD ქალაქები, rankings)
 *  running ──▶ თითო ნაბიჯზე: გაშვებების სტატუსი (GET) + მაქსიმუმ ერთი dataset-ის გვერდი (≈ 2 ქალაქი / 200 rankings სტრიქონი)
 *          ──▶ ქალაქის KV ჩანაწერი (იგივე გასაღები/ფორმატი, რასაც /api/market კითხულობს); ცარიელი ქალაქი არ იწერება
 *  ყველა დასრულდა ──▶ idle, nextRefreshAt = now + MARKET_REFRESH_DAYS, შეჯამება (რაოდენობები, შეცდომები, ღირებულების შეფასება)
 *  გაშვების შეცდომა (401/402/403/429/5xx/ქსელი) ──▶ backoff 1 დღე. ერთდროულად მხოლოდ ერთი სამუშაო; ბლოკი (lock) გადაფარვისგან.
 *
 * CPU: ერთ ნაბიჯზე მცირე რაოდენობის სტრიქონი; ლოდინი (fetch) CPU-ში არ ითვლება. ტოკენი მხოლოდ Authorization სათაურშია.
 */

import { APIFY_ACTOR_ID, RANKINGS_INPUT, normalizeApify, pricesQueryFor, cityMatches } from '../src/providers/apify-numbeo-adapter.js';
import { mdHasValue } from '../src/providers/resolve.js';

export const REFRESH_STATE_KEY = 'refresh:state';
const API = 'https://api.apify.com/v2';
const DAY_MS = 86400000;
const LOCK_MS = 10 * 60 * 1000;
const JOB_MAX_MS = 2 * DAY_MS;
const RANKINGS_PAGE = 200;
const STATE_TTL_S = 3650 * 86400;

/** @returns {any} */
export function emptyState() {
  return { v: 1, phase: 'idle', nextRefreshAt: 0, lastRefreshAt: null, backoffUntil: 0, lockUntil: 0, lastError: null, populated: [], job: null, summary: null };
}

/** @param {{ get(k: string): Promise<any> }} store */
export async function readRefreshState(store) {
  const s = await store.get(REFRESH_STATE_KEY);
  return s && s.v === 1 ? s : emptyState();
}

/**
 * Apify REST მოთხოვნა (ერთი ცდა, timeout, redirect: manual).
 * @param {typeof fetch} fetchFn @param {string} url @param {string} token @param {{ method?: string, body?: unknown, timeoutMs?: number }} [o]
 * @returns {Promise<{ ok: true, json: any, http: number } | { ok: false, code: string, http: number|null }>}
 */
async function apify(fetchFn, url, token, o = {}) {
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ac.abort(); }, o.timeoutMs || 25000);
  try {
    const res = await fetchFn(url, {
      method: o.method || 'GET', signal: ac.signal, redirect: 'manual',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(o.body ? { 'Content-Type': 'application/json' } : {}) },
      ...(o.body ? { body: JSON.stringify(o.body) } : {}),
    });
    if (!res.ok) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      const s = res.status;
      const code = s === 402 ? 'payment_required' : s === 401 || s === 403 ? 'unauthorized' : s === 429 ? 'rate_limited' : s >= 500 ? 'upstream_error' : 'invalid_response';
      return { ok: false, code, http: s };
    }
    const text = await res.text();
    try { return { ok: true, json: JSON.parse(text), http: res.status }; } catch { return { ok: false, code: 'invalid_response', http: res.status }; }
  } catch {
    return { ok: false, code: timedOut ? 'timeout' : 'network_error', http: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ბათჩები მისიის დაფინანსების ვალუტის მიხედვით. actor-ი მთელ გაშვებას აჩერებს პირველივე ვერნაპოვნ ქალაქზე
 * (რეალური გაშვება 2026-11-04: Donetsk → USD ბათჩი FAILED), ამიტომ:
 *  - ძირითად ბათჩში მხოლოდ `apifyVerified` ქალაქები;
 *  - `apifyExclude` ქალაქები საერთოდ არ იგზავნება (ჩვენებისას ასლი/დედაქალაქი);
 *  - დანარჩენი (დაუდასტურებელი) — ცალკე, პატარა, ბოლო გაშვებაში (`unverified`).
 * @param {{ locations: Record<string, any> }} names @param {Record<string, string[]>} locationCurrencies @param {string[]} allowed
 */
export function buildBatches(names, locationCurrencies, allowed) {
  /** @type {Record<string, { locs: string[], cities: string[] }>} */
  const out = {};
  /** @type {Record<string, { locs: string[], cities: string[] }>} */
  const unverified = {};
  for (const [loc, entry] of Object.entries(names.locations || {})) {
    if (!entry || typeof entry.numbeoCity !== 'string' || entry.apifyExclude) continue;
    for (const cur of locationCurrencies[loc] || []) {
      if (!allowed.includes(cur)) continue;
      const target = entry.apifyVerified ? out : unverified;
      const b = (target[cur] ??= { locs: [], cities: [] });
      b.locs.push(loc);
      const q = pricesQueryFor(entry);
      if (!b.cities.includes(q)) b.cities.push(q);
    }
  }
  return Object.defineProperty(out, 'unverified', { value: unverified, enumerable: false });
}

/** rankings სტრიქონი ეკუთვნის თუ არა რომელიმე ჩვენს ქალაქს (ზუსტი Numbeo სახელი + ქვეყანა). */
function rankingRelevant(/** @type {any} */ row, /** @type {any[]} */ entries) {
  const city = typeof row?.city === 'string' ? row.city.trim().toLowerCase() : '';
  const country = typeof row?.country === 'string' ? row.country.trim().toLowerCase() : '';
  return entries.some((e) => e.numbeoCity.trim().toLowerCase() === city && (!e.numbeoCountry || e.numbeoCountry.trim().toLowerCase() === country));
}

/**
 * ერთი cron ნაბიჯი. აბრუნებს ქმედების აღწერას (ლოგისა და ტესტებისთვის; საიდუმლოს გარეშე).
 * @param {{ env: any, store: { get(k: string): Promise<any>, put(k: string, v: any, ttl: number): Promise<void> }, names: any,
 *           locationCurrencies: Record<string, string[]>, fetchFn: typeof fetch, now: () => number,
 *           cfg: { provider: string, tokenConfigured: boolean, rankingsEnabled: boolean, firstRefreshAfter?: number, ttl: number, staleMax: number, refreshDays: number, allowed: string[], pageRows: number },
 *           cacheKey: (loc: string, cur: string) => string, rankingsKey: string }} p
 */
export async function runRefreshTick(p) {
  const { store, cfg } = p;
  const t = p.now();
  const st = await readRefreshState(store);
  if (st.lockUntil > t) return { action: 'locked' };
  if (st.phase === 'idle' && (t < st.nextRefreshAt || t < st.backoffUntil || t < (p.cfg.firstRefreshAfter || 0))) return { action: 'wait' }; // KV-ში არაფერს წერს
  if (cfg.provider !== 'apify' || !cfg.tokenConfigured) {
    if (st.lastError?.code === 'not_configured' && t < st.backoffUntil) return { action: 'wait' };
    st.lastError = { code: 'not_configured', at: t };
    st.backoffUntil = t + DAY_MS;
    await store.put(REFRESH_STATE_KEY, st, STATE_TTL_S);
    return { action: 'not_configured' };
  }
  st.lockUntil = t + LOCK_MS;
  await store.put(REFRESH_STATE_KEY, st, STATE_TTL_S);
  const token = String(p.env.APIFY_TOKEN).trim();
  /** @type {{ action: string, [k: string]: unknown }} */
  let result = { action: 'noop' };
  try {
    if (st.phase === 'idle') result = await startJob(p, st, token, t);
    else result = await advanceJob(p, st, token, t);
  } finally {
    st.lockUntil = 0;
    await store.put(REFRESH_STATE_KEY, st, STATE_TTL_S);
  }
  return result;
}

/** @param {any} p @param {any} st @param {string} token @param {number} t */
async function startJob(p, st, token, t) {
  const batches = buildBatches(p.names, p.locationCurrencies, p.cfg.allowed);
  const city = (/** @type {Record<string, any>} */ set, /** @type {boolean} */ unv) => Object.entries(set).filter(([, b]) => b.cities.length)
    .map(([cur, b]) => ({ kind: 'city_prices', currency: cur, unverified: unv, locs: b.locs, input: { mode: 'city_prices', cities: b.cities, currency: cur } }));
  const specs = [
    ...city(batches, false),
    ...(p.cfg.rankingsEnabled ? [{ kind: 'rankings', currency: null, unverified: false, locs: [], input: { ...RANKINGS_INPUT } }] : []),
    ...city(/** @type {any} */ (batches).unverified || {}, true), // დაუდასტურებელი — ბოლოს, ცალკე
  ];
  const runs = [];
  for (const s of specs) {
    const r = await apify(p.fetchFn, `${API}/acts/${APIFY_ACTOR_ID}/runs`, token, { method: 'POST', body: s.input });
    const data = r.ok ? r.json && r.json.data : null;
    if (!r.ok || !data || typeof data.id !== 'string' || typeof data.defaultDatasetId !== 'string') {
      const code = r.ok ? 'invalid_response' : r.code;
      if (runs.length === 0) {
        st.lastError = { code, http: r.ok ? r.http : r.http, at: t, step: 'start' };
        st.backoffUntil = t + DAY_MS;
        return { action: 'start_failed', code };
      }
      st.lastError = { code, at: t, step: `start:${s.kind}:${s.currency ?? ''}` };
      continue;
    }
    runs.push({ kind: s.kind, currency: s.currency, unverified: s.unverified, partial: false, locs: s.locs, cities: s.kind === 'city_prices' ? s.input.cities.length : 0, runId: data.id, datasetId: data.defaultDatasetId, state: 'running', offset: 0, carry: [] });
  }
  st.phase = 'running';
  st.job = { startedAt: t, runs, written: [], empty: [], failedRuns: [], rankingsRows: [], rankingsTotal: 0 };
  return { action: 'started', runs: runs.map((r) => `${r.kind}:${r.currency ?? ''}`) };
}

/** @param {any} p @param {any} st @param {string} token @param {number} t */
async function advanceJob(p, st, token, t) {
  const job = st.job;
  if (!job || !Array.isArray(job.runs)) { Object.assign(st, { phase: 'idle', job: null }); return { action: 'reset' }; }
  if (t - job.startedAt > JOB_MAX_MS) return finish(p, st, t, 'job_timeout');

  // 1) გაშვებების სტატუსი (მხოლოდ ჯერ დაუსრულებელი).
  for (const run of job.runs) {
    if (run.state !== 'running') continue;
    const r = await apify(p.fetchFn, `${API}/actor-runs/${encodeURIComponent(run.runId)}`, token);
    if (!r.ok) continue; // დროებითი შეცდომა — შემდეგ ნაბიჯზე
    const status = r.json?.data?.status;
    if (status === 'SUCCEEDED') run.state = 'ready';
    else if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
      // ვერნაპოვნი ქალაქი გაშვებას აჩერებს, მაგრამ მანამდე მიღებული სტრიქონები dataset-შია — მათ მაინც ვამუშავებთ.
      run.state = 'ready';
      run.partial = true;
      job.failedRuns.push(`${run.kind}:${run.currency ?? ''}:${status}`);
    }
  }
  // 2) ერთი გვერდის დამუშავება: rankings ჯერ (ინდექსები ქალაქებს სჭირდება), შემდეგ ქალაქები.
  const rankingsRun = job.runs.find((r) => r.kind === 'rankings');
  const rankingsSettled = !rankingsRun || rankingsRun.state === 'done' || rankingsRun.state === 'failed';
  const next = (rankingsRun && rankingsRun.state === 'ready') ? rankingsRun
    : rankingsSettled ? job.runs.find((r) => r.kind === 'city_prices' && r.state === 'ready') : null;
  let action = 'polled';
  if (next) action = next.kind === 'rankings' ? await ingestRankingsPage(p, job, next, token) : await ingestCityPage(p, st, job, next, token, t, rankingsRun);
  if (job.runs.every((r) => r.state === 'done' || r.state === 'failed')) return finish(p, st, t, null);
  return { action };
}

/** @param {any} p @param {any} job @param {any} run @param {string} token */
async function ingestRankingsPage(p, job, run, token) {
  const r = await apify(p.fetchFn, `${API}/datasets/${encodeURIComponent(run.datasetId)}/items?clean=true&format=json&offset=${run.offset}&limit=${RANKINGS_PAGE}`, token);
  if (!r.ok || !Array.isArray(r.json)) return 'rankings_page_retry';
  const entries = Object.values(p.names.locations || {});
  for (const row of r.json) {
    if (!rankingRelevant(row, entries)) continue;
    const { url, ...rest } = row || {}; void url;
    job.rankingsRows.push(rest);
  }
  run.offset += r.json.length;
  job.rankingsTotal = run.offset;
  if (r.json.length < RANKINGS_PAGE) {
    run.state = 'done';
    const expiresAt = p.now() + p.cfg.ttl * 1000;
    await p.store.put(p.rankingsKey, { storedAt: p.now(), expiresAt, items: job.rankingsRows }, p.cfg.ttl + p.cfg.staleMax);
  }
  return 'rankings_page';
}

/** @param {any} p @param {any} st @param {any} job @param {any} run @param {string} token @param {number} t @param {any} rankingsRun */
async function ingestCityPage(p, st, job, run, token, t, rankingsRun) {
  const limit = p.cfg.pageRows;
  const r = await apify(p.fetchFn, `${API}/datasets/${encodeURIComponent(run.datasetId)}/items?clean=true&format=json&offset=${run.offset}&limit=${limit}`, token);
  if (!r.ok || !Array.isArray(r.json)) return 'city_page_retry';
  const page = r.json;
  const rows = [...run.carry, ...page];
  const final = page.length < limit;
  /** @type {{ city: string, rows: any[] }[]} */
  const groups = [];
  for (const row of rows) {
    const c = typeof row?.city === 'string' ? row.city : '';
    if (!groups.length || groups[groups.length - 1].city !== c) groups.push({ city: c, rows: [] });
    groups[groups.length - 1].rows.push(row);
  }
  run.carry = !final && groups.length ? /** @type {any} */ (groups.pop()).rows : [];
  run.offset += page.length;
  const rankings = !p.cfg.rankingsEnabled ? { status: 'disabled' }
    : rankingsRun && rankingsRun.state === 'done' ? { status: 'ok', items: job.rankingsRows } : { status: 'upstream_error' };
  const fetchedAt = new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
  for (const g of groups) {
    for (const loc of run.locs) {
      const entry = p.names.locations[loc];
      if (!entry || !(cityMatches(g.city, entry.numbeoCity) || cityMatches(g.city, pricesQueryFor(entry))) || job.written.includes(`${loc}:${run.currency}`)) continue;
      const md = normalizeApify({ locationId: loc, currency: run.currency, entry, prices: { status: 'ok', items: g.rows }, rankings, fetchedAt });
      if (mdHasValue(md) && !['wrong_city', 'invalid_response'].includes(md.utilities.status)) {
        const expiresAt = t + p.cfg.ttl * 1000;
        await p.store.put(p.cacheKey(loc, run.currency), { storedAt: t, expiresAt, data: md }, p.cfg.ttl + p.cfg.staleMax);
        job.written.push(`${loc}:${run.currency}`);
        if (!st.populated.includes(loc)) st.populated.push(loc);
      }
    }
  }
  if (final) {
    run.state = 'done';
    for (const loc of run.locs) if (!job.written.includes(`${loc}:${run.currency}`)) job.empty.push(`${loc}:${run.currency}`);
  }
  return 'city_page';
}

/** @param {any} p @param {any} st @param {number} t @param {string|null} errorCode */
function finish(p, st, t, errorCode) {
  const job = st.job || { runs: [], written: [], empty: [], failedRuns: [], rankingsTotal: 0 };
  const cities = job.runs.filter((/** @type {any} */ r) => r.kind === 'city_prices').reduce((/** @type {number} */ a, /** @type {any} */ r) => a + r.cities, 0);
  const costEstimateUsd = Math.round((job.runs.length * 0.01 + (cities + (job.rankingsTotal || 0)) * 0.005) * 1000) / 1000;
  const nothing = job.written.length === 0;
  st.summary = { finishedAt: t, citiesWritten: job.written.length, citiesEmpty: job.empty.slice(0, 100), failedRuns: job.failedRuns, rankingsRows: (job.rankingsRows || []).length, costEstimateUsd, error: errorCode };
  st.phase = 'idle';
  st.job = null;
  st.lastRefreshAt = t;
  st.nextRefreshAt = nothing ? t + DAY_MS : t + p.cfg.refreshDays * DAY_MS;
  if (errorCode || nothing) st.lastError = { code: errorCode || 'no_data', at: t, step: 'finish' };
  else st.lastError = null;
  return { action: 'finished', citiesWritten: job.written.length, costEstimateUsd };
}
