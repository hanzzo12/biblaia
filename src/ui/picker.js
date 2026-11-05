// საძიებო ჩამოსაშლელი სია (ARIA combobox): ქართული + ლათინური ძებნა, ქვეყნებად დაჯგუფებული.
import { h, replace, uid } from './dom.js';
import * as core from '../core/index.js';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[‐-―\-–—'’".,()«»„“]/g, ' ').replace(/\s+/g, ' ').trim();

export function shortName(m) {
  if (m.type === 'embassy') return 'საელჩო';
  if (m.type === 'consulate-general') return 'გენერალური საკონსულო';
  if (m.type === 'consulate') return 'საკონსულო';
  return String(m.name_ka || '').replace(/^საქართველოს\s+/, '');
}
export const missionLabel = (m) => `${m.location_ka ?? '—'} — ${shortName(m)}`;

let cache = null;
export function missionIndex(data) {
  if (cache) return cache;
  cache = core.listMissions(data, {}).map((m) => ({
    m, label: missionLabel(m), country: m.country_ka ?? '—',
    hay: norm([m.name_ka, m.name_en, m.rawLabel, m.country_ka, m.country_en, m.location_ka, m.location_en, ...(m.locationAltNames || []), shortName(m)].join(' | ')),
  }));
  return cache;
}

/**
 * @param {{ data:any, label:string, placeholder?:string, value?:string|null, exclude?:string[], onPick:(id:string)=>void, testid?:string }} o
 */
export function missionPicker(o) {
  const items = missionIndex(o.data);
  const id = uid('pk'); const listId = uid('lb');
  const cur = items.find((x) => x.m.id === o.value);
  const input = h('input', { id, type: 'text', role: 'combobox', autocomplete: 'off', spellcheck: 'false', 'aria-autocomplete': 'list',
    'aria-expanded': 'false', 'aria-controls': listId, placeholder: o.placeholder ?? 'ჩაწერეთ ქალაქი ან ქვეყანა — მაგ. ვენა, Vienna', value: cur?.label ?? '', 'data-testid': o.testid ?? null });
  const list = h('ul', { id: listId, role: 'listbox', class: 'pk-list', hidden: true, 'aria-label': o.label });
  const live = h('span', { class: 'sr-only', 'aria-live': 'polite' });
  let opts = []; let active = -1;

  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
  const highlight = (i) => {
    active = i;
    opts.forEach((x, j) => x.el.setAttribute('aria-selected', j === i ? 'true' : 'false'));
    if (opts[i]) { input.setAttribute('aria-activedescendant', opts[i].el.id); opts[i].el.scrollIntoView({ block: 'nearest' }); }
  };
  const pick = (x) => { input.value = x.label; close(); o.onPick(x.m.id); };
  const open = () => {
    const q = norm(input.value === cur?.label ? '' : input.value);
    const terms = q ? q.split(' ') : [];
    const found = items.filter((x) => !(o.exclude || []).includes(x.m.id) && terms.every((t) => x.hay.includes(t)));
    opts = [];
    const groups = new Map();
    for (const x of found) { if (!groups.has(x.country)) groups.set(x.country, []); groups.get(x.country).push(x); }
    replace(list, found.length ? [...groups].map(([country, xs]) => [
      h('li', { role: 'presentation', class: 'pk-group' }, country),
      xs.map((x) => {
        const el = h('li', { id: uid('op'), role: 'option', 'aria-selected': 'false', class: 'pk-opt' }, x.label);
        el.addEventListener('mousedown', (e) => { e.preventDefault(); pick(x); });
        opts.push({ el, x });
        return el;
      })]) : h('li', { class: 'pk-empty', role: 'presentation' }, 'ვერაფერი მოიძებნა'));
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
    live.textContent = found.length ? `${found.length} ვარიანტი` : 'ვერაფერი მოიძებნა';
    active = -1;
  };
  input.addEventListener('focus', () => { input.select(); open(); });
  input.addEventListener('input', open);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) open(); highlight(Math.min(active + 1, opts.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(active - 1, 0)); }
    else if (e.key === 'Enter') { if (!list.hidden && opts.length) { e.preventDefault(); pick(opts[active >= 0 ? active : 0].x); } }
    else if (e.key === 'Escape') { close(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { close(); if (cur && !input.value) input.value = cur.label; }, 150));
  return h('div', { class: 'field picker' }, h('label', { for: id }, o.label), h('div', { class: 'pk-wrap' }, input, list), live);
}
