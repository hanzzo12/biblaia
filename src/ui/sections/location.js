// სექცია 1: ქვეყანა → ქალაქი → დაწესებულება + ძიება (ARIA combobox).
import { h, replace, uid } from '../dom.js';
import { L } from '../labels.js';
import * as core from '../../core/index.js';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[‐-―\-–—'’".,()«»„“]/g, ' ').replace(/\s+/g, ' ').trim();

function buildIndex(data) {
  const out = [];
  for (const m of core.listMissions(data, {})) {
    out.push({ kind: 'mission', id: m.id, countryId: m.countryId, locationId: m.locationId,
      title: m.name_ka, sub: `${m.location_ka ?? '—'}, ${m.country_ka ?? '—'}`,
      hay: norm([m.name_ka, m.name_en, m.rawLabel, m.country_ka, m.country_en, m.countryId, m.location_ka, m.location_en, ...(m.locationAltNames || [])].join(' | ')) });
  }
  const countries = new Map((data.countries || []).map((c) => [c.id, c]));
  for (const l of core.listLocations(data)) {
    if (l.missionIds.length) continue;
    const c = countries.get(l.countryId);
    out.push({ kind: 'location', id: l.id, countryId: l.countryId, locationId: l.id, title: `${l.name_ka} (ქალაქი, დაწესებულების გარეშე)`,
      sub: c?.name_ka ?? '', hay: norm([l.name_ka, l.name_en, ...(l.altNames || []), c?.name_ka, c?.name_en].join(' | ')) });
  }
  return out;
}

export function mountLocation(root, store, { onPlaceChange }) {
  const data = store.data;
  const index = buildIndex(data);
  const listId = uid('lb');
  const searchId = uid('f');
  const input = h('input', { id: searchId, type: 'search', role: 'combobox', autocomplete: 'off', spellcheck: 'false',
    'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': listId, placeholder: 'მაგ. ვენა, Vienna, ნატო' });
  const list = h('ul', { id: listId, role: 'listbox', class: 'combo-list', hidden: true, 'aria-label': 'ძიების შედეგები' });
  const count = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  let results = []; let active = -1;

  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
  const highlight = (i) => {
    active = i;
    [...list.children].forEach((li, j) => li.setAttribute('aria-selected', j === i ? 'true' : 'false'));
    if (i >= 0 && list.children[i]) { input.setAttribute('aria-activedescendant', list.children[i].id); list.children[i].scrollIntoView({ block: 'nearest' }); }
  };
  const choose = (r) => {
    close();
    input.value = '';
    store.ui.countryId = r.countryId;
    store.ui.locationId = r.locationId;
    store.scenario.missionId = r.kind === 'mission' ? r.id : null;
    renderSelects();
    changed();
    (r.kind === 'mission' ? missionSel : citySel).focus();
  };
  input.addEventListener('input', () => {
    const q = norm(input.value);
    if (!q) { close(); count.textContent = ''; return; }
    const terms = q.split(' ');
    results = index.filter((r) => terms.every((t) => r.hay.includes(t))).slice(0, 15);
    replace(list, results.map((r, i) => {
      const li = h('li', { id: `${listId}-${i}`, role: 'option', 'aria-selected': 'false', class: 'combo-opt' },
        h('span', { class: 'combo-title' }, r.title), h('span', { class: 'combo-sub' }, r.sub));
      li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(r); });
      return li;
    }));
    if (!results.length) replace(list, h('li', { role: 'option', 'aria-disabled': 'true', class: 'combo-empty' }, 'ვერაფერი მოიძებნა'));
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    count.textContent = results.length ? `${results.length} შედეგი` : 'ვერაფერი მოიძებნა';
    active = -1;
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden || !results.length) { if (e.key === 'Escape') { input.value = ''; close(); } return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(active + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(active - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(results[active >= 0 ? active : 0]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));

  const countrySel = h('select', { id: uid('f'), 'data-path': 'ui.countryId' });
  const citySel = h('select', { id: uid('f'), 'data-path': 'ui.locationId' });
  const missionSel = h('select', { id: uid('f'), 'data-path': 'missionId' });
  store.ids.missionId = missionSel.id;
  const cityNote = h('p', { class: 'hint', 'aria-live': 'polite' });
  const missionNote = h('p', { class: 'hint', 'aria-live': 'polite' });
  const info = h('div', { class: 'mission-info', 'aria-live': 'polite' });

  const changed = () => { renderInfo(); onPlaceChange(); store.schedule(); };

  countrySel.addEventListener('change', () => {
    store.ui.countryId = countrySel.value || null; store.ui.locationId = null; store.scenario.missionId = null;
    renderSelects(true); changed();
  });
  citySel.addEventListener('change', () => {
    store.ui.locationId = citySel.value || null; store.scenario.missionId = null;
    renderSelects(true); changed();
  });
  missionSel.addEventListener('change', () => { store.scenario.missionId = missionSel.value || null; renderSelects(); changed(); });

  function renderSelects(autoPick = false) {
    const countries = core.listCountries(data, { all: true }).filter((c) => c.locationIds.length);
    replace(countrySel, h('option', { value: '' }, L.choose),
      countries.map((c) => h('option', { value: c.id, selected: c.id === store.ui.countryId }, c.name_ka)));
    const cities = store.ui.countryId ? core.listLocations(data, store.ui.countryId) : [];
    if (autoPick && cities.length === 1 && !store.ui.locationId) store.ui.locationId = cities[0].id;
    citySel.disabled = !store.ui.countryId;
    replace(citySel, h('option', { value: '' }, store.ui.countryId ? L.choose : 'ჯერ აირჩიეთ ქვეყანა'),
      cities.map((l) => h('option', { value: l.id, selected: l.id === store.ui.locationId }, l.name_ka + (l.region ? ` (${l.region})` : ''))));
    cityNote.textContent = cities.length === 1 && store.ui.locationId ? 'ავტომატურად არჩეული'
      : cities.length > 1 && !store.ui.locationId ? 'აირჩიეთ ქალაქი' : '';
    const missions = store.ui.locationId ? core.listMissions(data, { locationId: store.ui.locationId }) : [];
    if (autoPick && missions.length === 1 && !store.scenario.missionId) store.scenario.missionId = missions[0].id;
    missionSel.disabled = !store.ui.locationId || !missions.length;
    replace(missionSel, h('option', { value: '' }, !store.ui.locationId ? 'ჯერ აირჩიეთ ქალაქი' : missions.length ? L.choose : 'ამ ქალაქში დანართებში დაწესებულება არ არის'),
      missions.map((m) => h('option', { value: m.id, selected: m.id === store.scenario.missionId }, m.name_ka)));
    missionNote.textContent = missions.length === 1 && store.scenario.missionId ? 'ავტომატურად არჩეული' : '';
  }

  function renderInfo() {
    const m = store.scenario.missionId ? core.resolveMission(data, store.scenario.missionId) : null;
    if (!m) {
      replace(info, store.ui.locationId ? h('p', { class: 'hint' }, 'დაწესებულება არ არის არჩეული — ოფიციალური თანხა დაუდგენელია; ბაზრის ბლოკი ქალაქისთვის მაინც ჩანს.') : null);
      return;
    }
    const k = m.coefficient;
    const basisKa = { 'city-row': 'ქალაქის სტრიქონი', 'country-row': 'ქვეყნის სტრიქონი', none: '—' }[k.basis] || k.basis;
    replace(info,
      h('p', { class: 'mi-line' }, h('strong', null, m.type_ka), ` · დაფინანსება ${m.fundingCurrency ?? '—'} · K ${k.k ?? '—'} · ბინის წილი E ${k.ePercent != null ? k.ePercent + '%' : '—'}`),
      h('p', { class: 'hint' }, `წყარო: დანართი №${m.annex}, სტრ. ${m.rowNo}` + (k.annex4Row ? `; K/E — დანართი №4, სტრ. ${k.annex4Row} (${basisKa})` : '')),
      k.status !== 'available' ? h('p', { class: 'warn', role: 'note' }, k.note_ka || 'ნორმატიული მონაცემი არ არის — ოფიციალური თანხა დაუდგენელია.') : null);
  }

  const lab = (sel, text) => h('label', { for: sel.id }, text);
  root.append(
    h('div', { class: 'field wide combo' }, h('label', { for: searchId }, L.search), input, list, count),
    h('div', { class: 'grid3' },
      h('div', { class: 'field' }, lab(countrySel, L.country), countrySel),
      h('div', { class: 'field' }, lab(citySel, L.city), citySel, cityNote),
      h('div', { class: 'field' }, lab(missionSel, L.mission), missionSel, missionNote)),
    info);

  // მისიიდან ქვეყნისა და ქალაქის აღდგენა (იმპორტი/შენახული სცენარი)
  function syncFromScenario() {
    const m = store.scenario.missionId ? core.resolveMission(data, store.scenario.missionId) : null;
    if (m) { store.ui.countryId = m.countryId; store.ui.locationId = m.locationId; }
    renderSelects(); renderInfo();
  }
  syncFromScenario();
  return { sync: syncFromScenario };
}
