// აპის აწყობა: state → calculate(scenario, data) → render(result). ეკრანი და ბეჭდვა ერთ result-ს იყენებს.
import { h, replace, $ } from './dom.js';
import { createStore, clone } from './state.js';
import { mountLocation } from './sections/location.js';
import { mountMarket } from './sections/market.js';
import { mountPosition, currentMonth } from './sections/position.js';
import { mountFamily } from './sections/family.js';
import { mountExpenses, syncInsurance } from './sections/expenses.js';
import { mountResults } from './sections/results.js';
import { mountExport } from './sections/export.js';
import { mountCompare } from './sections/compare.js';
import { createMarketService } from './market-service.js';
import * as core from '../core/index.js';

export function startApp({ data, meta, online, client }) {
  void h;
  const fresh = () => { const sc = core.emptyScenario(); if (sc.period.mode === 'full-month' && !sc.period.month) sc.period.month = currentMonth(); return sc; };
  const store = createStore(data, fresh());
  store.meta = meta;
  syncInsurance(store.scenario);

  const fundingCurrency = () => (store.scenario.missionId ? core.resolveMission(data, store.scenario.missionId)?.fundingCurrency ?? null : null);
  const marketCurrency = () => fundingCurrency()
    ?? core.listMissions(data, { locationId: store.ui.locationId })[0]?.fundingCurrency
    ?? core.listMissions(data, { countryId: store.ui.countryId })[0]?.fundingCurrency ?? 'EUR';

  let lastLoc;
  const loc = mountLocation($('#sec-location-fields'), store, {
    onPlaceChange() {
      const cur = marketCurrency();
      if (store.ui.locationId !== lastLoc || cur !== store.market?.currency) { lastLoc = store.ui.locationId; market.load(store.ui.locationId, cur); }
      expenses.updateRentNotes();
    },
  });
  const service = createMarketService({ online, client });
  const market = mountMarket($('#sec-market'), store, {
    service, fundingCurrency,
    onUseRent({ amount, marketRef }) {
      const r = store.scenario.rent;
      r.amount = amount; r.basis = 'market-scenario'; r.marketRef = marketRef;
      store.raw['rent.amount'] = amount; delete store.errors['rent.amount'];
      store.ui.rentLocationId = store.ui.locationId;
      expenses.render(); store.schedule();
      document.getElementById(store.ids['rent.amount'])?.focus();
    },
  });
  const position = mountPosition($('#sec-position'), $('#adv-status'), store);
  const family = mountFamily($('#sec-family'), store, { onMembersChange: () => syncInsurance(store.scenario) });
  const expenses = mountExpenses($('#sec-expenses'), $('#adv-expenses'), store);
  const results = mountResults($('#sec-results'), store, {
    marketSummary() {
      const x = market.summary();
      if (!x) return null;
      const metric = `${x.area}_${x.bedrooms}br`;
      return { metric, rent: x.md.rent?.items?.[metric]?.average ?? null, currency: x.md.currency, rentStatus: x.md.rent?.status ?? x.md.status,
        index: x.md.indices?.costOfLiving ?? null, indexStatus: x.md.indices?.status ?? x.md.status, source: x.md.provider?.attribution_ka ?? x.md.provider?.name ?? null };
    },
  });
  const compareSec = $('#sec-compare');
  const compare = mountCompare($('#compare-body'), store, { service });
  const openCompare = (show = true) => {
    compareSec.hidden = !show;
    for (const b of document.querySelectorAll('[data-open-compare]')) b.setAttribute('aria-expanded', String(show));
    if (show) { compare.render(); compareSec.scrollIntoView({ behavior: 'smooth', block: 'start' }); compareSec.querySelector('select')?.focus({ preventScroll: true }); }
  };
  for (const b of document.querySelectorAll('[data-open-compare]')) b.addEventListener('click', () => openCompare(compareSec.hidden));
  $('#compare-close')?.addEventListener('click', () => { openCompare(false); document.querySelector('[data-open-compare]')?.focus(); });
  mountExport($('#sec-export'), store, {
    load(scenario, extra = {}) {
      store.scenario = clone(scenario);
      for (const k of ['raw', 'errors', 'ids']) store[k] = {};
      store.ui.rentHeadTouched = true;
      store.ui.rentLocationId = null;
      syncInsurance(store.scenario);
      compare.setColumns(Array.isArray(extra.compare) ? extra.compare : []);
      if (store.ui.compare.length) openCompare(true);
      rerenderAll();
    },
    reset() {
      store.scenario = fresh();
      for (const k of ['raw', 'errors', 'ids']) store[k] = {};
      Object.assign(store.ui, { countryId: null, locationId: null, rentLocationId: null, rentHeadTouched: false, notice: null });
      compare.setColumns([]);
      openCompare(false);
      syncInsurance(store.scenario);
      rerenderAll();
    },
  });

  function rerenderAll() {
    loc.sync(); position.render(); family.render(); expenses.render();
    lastLoc = undefined;
    const cur = marketCurrency();
    lastLoc = store.ui.locationId;
    market.load(store.ui.locationId, cur);
    store.schedule();
  }

  store.on('structure', (section) => {
    if (section === 'family') { syncInsurance(store.scenario); expenses.render(); market.render(); }
    if (section === 'period') { family.render(); expenses.render(); }
  });

  /** ბირთვისთვის: დაზღვევის ცარიელი სტრიქონები (UI-ის სამუშაო რიგები) არ გადაეცემა. */
  store.coreScenario = () => {
    const sc = clone(store.scenario);
    const map = [];
    sc.insurance = store.scenario.insurance.filter((x, i) => {
      const used = x.policyCost != null || x.alreadyReimbursed != null || x.policyStart != null;
      if (used) map.push(i);
      return used;
    }).map(clone);
    store.insMap = map;
    return sc;
  };
  /** ბირთვის გზა ("insurance[0].policyCost") → UI-ის ველის გზა ("insurance.2.policyCost") */
  store.resolvePath = (p) => {
    let q = String(p).replace(/\[(\d+)\]/g, '.$1');
    const m = /^insurance\.(\d+)(\..*)?$/.exec(q);
    if (m && store.insMap) q = `insurance.${store.insMap[Number(m[1])] ?? m[1]}${m[2] ?? ''}`;
    return q;
  };

  store.on('calc', () => {
    let result = null; let err = null;
    try { result = core.calculate(store.coreScenario(), data); } catch (e) { err = String(e?.message || e); }
    store.result = result;
    const cur = result?.currency ?? fundingCurrency();
    for (const u of document.querySelectorAll('.unit')) u.textContent = cur ?? '';
    try { results.render(result, err); } catch (e) { results.render(null, 'ჩვენების შეცდომა: ' + String(e?.message || e)); console.error(e); }
    family.updateEligibility(result);
    expenses.updateRentNotes();
    if (!compareSec.hidden && store.ui.compare.length) compare.render();
    clearTimeout(printTimer);
    printTimer = setTimeout(buildPrintInputs, 300);
  });

  // ბეჭდვა: ყველა <details> გაიხსნება, შეყვანის ცხრილი აიგება, შემდეგ აღდგება.
  let printTimer = null;
  let reopened = [];
  window.addEventListener('beforeprint', () => {
    reopened = [...document.querySelectorAll('details:not([open])')];
    reopened.forEach((d) => { d.open = true; });
    buildPrintInputs();
  });
  window.addEventListener('afterprint', () => { reopened.forEach((d) => { d.open = false; }); reopened = []; });

  function buildPrintInputs() {
    const rows = [];
    const lab = (el) => document.querySelector(`label[for="${el.id}"]`)?.textContent?.replace(/\s*\*$/, '') ?? '';
    for (const el of document.querySelectorAll('#form [data-path]')) {
      if (el.closest('.market-manual')) continue;
      const ctx = el.closest('fieldset.card')?.querySelector('legend')?.textContent;
      let label = ''; let value = '';
      if (el.matches('fieldset[data-kind=radio]')) {
        label = el.querySelector('legend')?.textContent ?? '';
        const c = el.querySelector('input:checked');
        value = c ? lab(c) : '';
      } else if (el.matches('select')) { label = lab(el); value = el.value === '' ? '' : el.selectedOptions[0]?.textContent ?? ''; }
      else if (el.matches('input[type=checkbox]')) { label = lab(el); value = el.checked ? 'კი' : ''; }
      else if (el.matches('input')) { label = lab(el); value = el.value.trim(); if (value) { const u = el.parentElement?.querySelector('.unit')?.textContent; if (u) value += ' ' + u; } }
      if (value) rows.push([ctx ? `${ctx} — ${label}` : label, value]);
    }
    const period = store.scenario.period.mode === 'dates' ? `${store.scenario.period.start ?? '?'} – ${store.scenario.period.end ?? '?'}` : 'სრული თვე';
    replace($('#print-inputs'),
      h('h2', null, 'შეყვანილი მონაცემები'),
      h('p', null, `პერიოდი: ${period} · დაბეჭდილია: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`),
      h('table', { class: 'print-table' }, h('tbody', null, rows.map(([k, v]) => h('tr', null, h('th', { scope: 'row' }, k), h('td', null, v))))));
  }

  store.schedule();
  return store;
}
