// შედარება: 5-მდე დაწესებულება/ქალაქი იმავე სცენარით. ვალუტები არასოდეს იკრიბება/კონვერტირდება.
import { h, replace, uid } from '../dom.js';
import * as core from '../../core/index.js';
import { marketCards, skeletonCards, suggestBedrooms } from './market.js';
import { MARKET_FRIENDLY } from '../labels.js';

export const MAX_COMPARE = 5;
const WITH_DATA = new Set(['fresh', 'cached', 'stale', 'partial']);

export function mountCompare(root, store, { service }) {
  store.ui.compare = store.ui.compare || [];
  const state = new Map(); // missionId → { token, md, loading }
  const panel = h('div', { class: 'compare-panel' });
  root.append(panel);

  const missionsByCountry = () => {
    const groups = new Map();
    for (const m of core.listMissions(store.data, {})) {
      const k = m.country_ka ?? '—';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(m);
    }
    return groups;
  };

  function scenarioFor(col) {
    const base = store.coreScenario ? store.coreScenario() : JSON.parse(JSON.stringify(store.scenario));
    const curNow = store.result?.currency ?? null;
    const target = core.resolveMission(store.data, col.missionId);
    const sc = { ...base, missionId: col.missionId,
      rent: { amount: col.rent ?? null, basis: 'planned', marketRef: null, changes: [] },
      education: target?.fundingCurrency && target.fundingCurrency === curNow ? base.education : [],
      insurance: [], broker: null, baggage: null, travel: [], advances: [], extras: [],
      settlement: { ...base.settlement, dailyRate: null, fx: null } };
    return { sc, target, eduDropped: (base.education || []).length > 0 && sc.education.length === 0 };
  }

  function fetchMarket(col) {
    const target = core.resolveMission(store.data, col.missionId);
    if (!target) return;
    const st = { token: (state.get(col.missionId)?.token ?? 0) + 1, md: null, loading: true };
    state.set(col.missionId, st);
    service.get(target.locationId, target.fundingCurrency).then((md) => {
      const cur = state.get(col.missionId);
      if (!cur || cur.token !== st.token || !store.ui.compare.some((c) => c.missionId === col.missionId)) return; // წაშლილი/შეცვლილი სვეტი
      cur.md = md; cur.loading = false;
      render();
    });
  }

  function add(missionId) {
    if (!missionId || store.ui.compare.length >= MAX_COMPARE || store.ui.compare.some((c) => c.missionId === missionId)) return;
    const col = { missionId, rent: null };
    store.ui.compare.push(col);
    fetchMarket(col);
    render();
  }

  function setColumns(cols) {
    store.ui.compare = cols.filter((c) => core.resolveMission(store.data, c.missionId)).slice(0, MAX_COMPARE).map((c) => ({ missionId: c.missionId, rent: c.rent ?? null }));
    state.clear();
    store.ui.compare.forEach(fetchMarket);
    render();
  }

  const row = (label, c, cur) => {
    const v = c?.value ?? null;
    return h('div', { class: 'crow', 'data-component': c?.id ?? null },
      h('span', { class: 'crow-label' }, label),
      h('span', { class: 'crow-value' + (v != null && v.startsWith('-') ? ' neg' : ''), 'data-value': v ?? '' }, v == null ? '—' : `${core.formatAmount(v)} ${c.currency ?? cur ?? ''}`));
  };

  function column(col, i) {
    const { sc, target, eduDropped } = scenarioFor(col);
    let r = null;
    try { r = core.calculate(sc, store.data); } catch { r = null; }
    const cur = r?.currency ?? target?.fundingCurrency;
    const m = r?.monthly || {};
    const rentId = uid('f');
    const rentInp = h('input', { id: rentId, type: 'text', inputmode: 'decimal', autocomplete: 'off', value: col.rentRaw ?? col.rent ?? '', 'data-testid': 'compare-rent' });
    const err = h('p', { class: 'field-error' });
    rentInp.addEventListener('change', () => {
      const res = core.parseDecimalInput(rentInp.value);
      col.rentRaw = rentInp.value;
      if (!res.ok) { err.textContent = res.error_ka; rentInp.setAttribute('aria-invalid', 'true'); return; }
      col.rent = res.normalized; render();
      panel.querySelector(`[data-col="${col.missionId}"] input`)?.focus();
    });
    const del = h('button', { type: 'button', class: 'icon-btn', 'aria-label': `შედარებიდან ამოღება: ${target?.name_ka ?? col.missionId}`, title: 'ამოღება' }, '×');
    del.addEventListener('click', () => {
      store.ui.compare.splice(i, 1); state.delete(col.missionId); render();
      (panel.querySelector('.ccol .icon-btn') || panel.querySelector('select'))?.focus();
    });
    const st = state.get(col.missionId);
    const md = st?.md;
    const area = store.market?.area ?? 'centre';
    const beds = store.market?.bedroomsTouched && store.market?.bedrooms ? store.market.bedrooms : suggestBedrooms(store.scenario.family.length);
    return h('article', { class: 'ccol', 'data-col': col.missionId, 'aria-label': target?.name_ka ?? col.missionId },
      h('header', { class: 'ccol-head' },
        h('div', null, h('h3', null, target?.location_ka ?? '—'), h('p', { class: 'hint' }, `${target?.country_ka ?? ''} · ${target?.type_ka ?? ''}`), h('p', { class: 'cname' }, target?.name_ka ?? '')),
        del),
      h('p', { class: 'ccur' }, 'ვალუტა: ', h('strong', null, cur ?? '—')),
      h('div', { class: 'field' }, h('label', { for: rentId }, `დაგეგმილი ქირა (${cur ?? ''})`), rentInp, err),
      h('div', { class: 'cfigs' },
        h('div', { class: 'cS' }, h('span', { class: 'crow-label' }, 'S / თვე'), h('span', { class: 'cS-value', 'data-value': m.S?.value ?? '', 'data-testid': 'compare-S' }, m.S?.value != null ? `${core.formatAmount(m.S.value)} ${cur}` : '—')),
        row('D', m.D, cur), row('T (ბინის წილი)', m.T, cur), row('F (ქირის ანაზღ.)', m.F, cur),
        row('ქირისა და განათლების შემდეგ', r?.remainder?.value, cur),
        m.S?.value == null ? h('p', { class: 'hint' }, col.rent == null ? 'S-სთვის შეიყვანეთ ქირა (0 = ქირა არ არის).' : (m.S?.reason_ka ?? '')) : null,
        eduDropped ? h('p', { class: 'hint' }, 'განათლების თანხა სხვა ვალუტაშია შეყვანილი — აქ არ ითვლება.') : null),
      h('div', { class: 'cmarket' },
        !service.online ? h('p', { class: 'hint' }, MARKET_FRIENDLY.offline)
          : st?.loading || !st ? skeletonCards(4)
            : md && WITH_DATA.has(md.status) ? marketCards(md, { area, bedrooms: beds, compact: true })
              : h('p', { class: 'hint', 'data-status': md?.status }, MARKET_FRIENDLY[md?.status] ?? md?.status ?? '')));
  }

  function render() {
    const cols = store.ui.compare;
    const selId = uid('f');
    const sel = h('select', { id: selId, 'data-testid': 'compare-select' }, h('option', { value: '' }, '— აირჩიეთ დაწესებულება —'),
      [...missionsByCountry()].map(([country, ms]) => h('optgroup', { label: country },
        ms.map((m) => h('option', { value: m.id, disabled: cols.some((c) => c.missionId === m.id) }, `${m.location_ka ?? ''} — ${m.name_ka}`)))));
    const addBtn = h('button', { type: 'button', class: 'btn', disabled: cols.length >= MAX_COMPARE, 'data-testid': 'compare-add' }, 'დამატება');
    addBtn.addEventListener('click', () => { add(sel.value); panel.querySelector('select')?.focus(); });
    const addCur = h('button', { type: 'button', class: 'btn ghost', disabled: !store.scenario.missionId || cols.length >= MAX_COMPARE || cols.some((c) => c.missionId === store.scenario.missionId) }, 'მიმდინარე დაწესებულების დამატება');
    addCur.addEventListener('click', () => {
      add(store.scenario.missionId);
      const last = store.ui.compare[store.ui.compare.length - 1];
      if (last && last.missionId === store.scenario.missionId && store.scenario.rent.amount != null && last.rent == null) { last.rent = store.scenario.rent.amount; render(); }
    });
    replace(panel,
      h('div', { class: 'compare-picker' },
        h('div', { class: 'field' }, h('label', { for: selId }, `დაამატეთ შესადარებლად (მაქს. ${MAX_COMPARE})`), sel),
        addBtn, addCur),
      h('p', { class: 'hint' }, 'ყველა სვეტი იყენებს თქვენს თანამდებობას, ოჯახსა და განათლებას; ქირა თითო ქალაქზე ცალკე შეიყვანეთ. ვალუტები არ იკრიბება და არ კონვერტირდება.'),
      cols.length ? h('div', { class: 'cgrid', role: 'region', 'aria-label': 'შედარების ცხრილი', tabindex: '0', 'data-testid': 'compare-grid' }, cols.map(column))
        : h('p', { class: 'empty-state' }, 'ჯერ არაფერია არჩეული.'));
  }

  render();
  return { render, setColumns };
}
