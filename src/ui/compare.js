// შედარება: 5-მდე ქალაქი გვერდიგვერდ. ვალუტები არასოდეს იკრიბება/კონვერტირდება.
import { h, replace, uid } from './dom.js';
import * as core from '../core/index.js';
import { missionPicker, shortName } from './picker.js';
import { marketList, rentFor } from './market.js';

const MAX = 5;

export function mountCompare(root, { data, service, scenario, calc, beds, parseMoney, getMissionId, getRentRaw }) {
  const cols = []; // { missionId, rentRaw, md, loading, token }
  let lastFocus = null;
  const grid = h('div', { class: 'cgrid', 'data-testid': 'compare-grid' });
  const addBox = h('div', { class: 'cadd' });
  const closeBtn = h('button', { type: 'button', class: 'x big', 'aria-label': 'შედარების დახურვა' }, '×');
  const panel = h('div', { class: 'cpanel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cmp-title' },
    h('div', { class: 'chead' }, h('h2', { id: 'cmp-title', tabindex: '-1' }, 'შედარება'), closeBtn),
    h('p', { class: 'muted small' }, 'თქვენი თანამდებობითა და ოჯახით. ქირა — Numbeo-ს საშუალო ცენტრში (შეგიძლიათ შეცვალოთ). ვალუტები არ კონვერტირდება.'),
    addBox, grid);
  root.append(panel);
  root.hidden = true;
  closeBtn.addEventListener('click', close);
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  function close() { root.hidden = true; document.body.classList.remove('modal-open'); lastFocus?.focus(); }
  function open() {
    lastFocus = document.activeElement;
    if (!cols.length && getMissionId()) add(getMissionId(), getRentRaw());
    root.hidden = false; document.body.classList.add('modal-open');
    render();
    panel.querySelector('h2')?.focus();
  }

  function add(id, rentRaw = '') {
    if (!id || cols.length >= MAX || cols.some((c) => c.missionId === id)) return;
    const c = { missionId: id, rentRaw, md: null, loading: service.online, token: 0 };
    cols.push(c);
    const m = core.resolveMission(data, id);
    const token = ++c.token;
    service.get(m.locationId, m.fundingCurrency).then((md) => {
      if (!cols.includes(c) || token !== c.token) return; // ამოღებული სვეტი
      c.md = md; c.loading = false; render();
    });
  }

  function cardFor(c, i) {
    const m = core.resolveMission(data, c.missionId);
    const cur = m.fundingCurrency;
    const own = parseMoney(c.rentRaw);
    const numbeo = rentFor(c.md, beds());
    const rent = own.value ?? (c.md?.currency === cur ? numbeo : null);
    const curNow = getMissionId() ? core.resolveMission(data, getMissionId())?.fundingCurrency : cur;
    const r = calc(scenario({ missionId: c.missionId, rent, extras: false, keepEdu: curNow === cur }));
    const mm = r?.monthly || {};
    const S = rent == null ? mm.DminusT : mm.S;
    const rid = uid('f');
    const rentInp = h('input', { id: rid, type: 'text', inputmode: 'decimal', value: c.rentRaw, placeholder: numbeo ? core.formatAmount(numbeo) : '0.00', 'data-testid': 'compare-rent' });
    rentInp.addEventListener('change', () => { c.rentRaw = rentInp.value; render(); grid.querySelector(`[data-col="${c.missionId}"] input`)?.focus(); });
    const del = h('button', { type: 'button', class: 'x', 'aria-label': `ამოღება: ${m.location_ka}` }, '×');
    del.addEventListener('click', () => { cols.splice(i, 1); render(); (grid.querySelector('.x') || addBox.querySelector('input'))?.focus(); });
    const val = (x) => (x?.value == null ? '—' : `${core.formatAmount(x.value)} ${cur}`);
    return h('article', { class: 'ccard', 'data-col': c.missionId },
      h('header', null, h('div', null, h('h3', null, m.location_ka), h('p', { class: 'small muted' }, `${shortName(m)} · ${cur}`)), del),
      h('p', { class: 'c-s-l' }, rent == null ? 'თვიური თანხა (ქირის გარეშე)' : 'თვიური თანხა'),
      h('p', { class: 'c-s', 'data-testid': 'compare-S', 'data-value': S?.value ?? '' }, c.loading && !own.value ? '…' : val(S)),
      h('div', { class: 'crow' }, h('span', null, 'ქირის ანაზღაურება'), h('strong', null, rent == null ? '—' : val(mm.F))),
      h('div', { class: 'crow' }, h('span', null, 'დარჩება ქირის შემდეგ'), h('strong', { 'data-value': r?.remainder?.value?.value ?? '' }, rent == null ? '—' : val(r?.remainder?.value))),
      h('div', { class: 'crow rent-in' }, h('label', { for: rid }, own.value != null ? 'ქირა (თქვენი)' : numbeo ? 'ქირა: Numbeo-ს საშუალო' : 'ქირა'),
        h('span', { class: 'with-cur' }, rentInp, h('span', { class: 'cur' }, cur))),
      h('div', { class: 'cmarket' }, marketList(c.md, beds(), { loading: c.loading, source: false })));
  }

  function render() {
    replace(addBox, cols.length < MAX
      ? missionPicker({ data, label: '+ ქალაქის დამატება', placeholder: 'ჩაწერეთ ქალაქი…', exclude: cols.map((c) => c.missionId), testid: 'compare-add',
        onPick: (id) => { add(id); render(); addBox.querySelector('input')?.focus(); } })
      : h('p', { class: 'muted small' }, `მაქსიმუმ ${MAX} ქალაქი.`));
    replace(grid, cols.length ? cols.map(cardFor) : h('p', { class: 'muted' }, 'დაამატეთ ქალაქი შესადარებლად.'));
    const src = cols.find((c) => c.md?.provider)?.md?.provider;
    if (src) grid.append(h('p', { class: 'msource wide' }, src.attribution_ka || 'წყარო: Numbeo.com'));
  }
  return { open, close };
}
