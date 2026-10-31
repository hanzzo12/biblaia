// შედარება: 5-მდე ქალაქი გვერდიგვერდ. ვალუტები არასოდეს იკრიბება/კონვერტირდება.
import { h, replace, uid } from './dom.js';
import * as core from '../core/index.js';
import { missionPicker, shortName } from './picker.js';
import { marketList, rentFor, WITH_DATA } from './market.js';
import { comparePdf, downloadBytes } from './pdf/reports.js';

const MAX = 5;

export function mountCompare(root, { data, service, scenario, calc, beds, parseMoney, getMissionId, getRentRaw }) {
  const cols = []; // { missionId, rentRaw, md, loading, token }
  let lastFocus = null;
  const grid = h('div', { class: 'cgrid', 'data-testid': 'compare-grid' });
  const addBox = h('div', { class: 'cadd' });
  const closeBtn = h('button', { type: 'button', class: 'x big', 'aria-label': 'შედარების დახურვა' }, '×');
  const pdfBtn = h('button', { type: 'button', class: 'btn small', 'data-testid': 'compare-pdf' }, 'PDF ჩამოტვირთვა');
  const printBtn = h('button', { type: 'button', class: 'btn ghost small', 'data-testid': 'compare-print' }, 'ბეჭდვა');
  pdfBtn.addEventListener('click', async () => {
    pdfBtn.disabled = true;
    try { downloadBytes(await comparePdf(cols.map((c) => { const M = colModel(c); return { city: M.city, name: M.name, cur: M.cur, remainder: M.remainder, remNote: M.remNote, S: M.Stext, F: M.F, rent: M.rentText, rentLabel: M.rentLabel, market: M.market, index: M.index, source: M.source }; })), `rotacia-shedareba-${new Date().toISOString().slice(0, 10)}.pdf`); }
    catch (e) { console.error(e); } finally { pdfBtn.disabled = false; }
  });
  printBtn.addEventListener('click', () => { document.body.classList.add('print-compare'); window.print(); });
  window.addEventListener('afterprint', () => document.body.classList.remove('print-compare'));
  const panel = h('div', { class: 'cpanel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cmp-title' },
    h('div', { class: 'chead' }, h('h2', { id: 'cmp-title', tabindex: '-1' }, 'შედარება'), h('div', { class: 'chead-actions no-print' }, pdfBtn, printBtn, closeBtn)),
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

  /** სვეტის მონაცემები — ეკრანისა და PDF-ისთვის ერთი წყარო */
  function colModel(c) {
    const m = core.resolveMission(data, c.missionId);
    const cur = m.fundingCurrency;
    const own = parseMoney(c.rentRaw);
    const numbeo = c.md?.currency === cur ? rentFor(c.md, beds()) : null;
    const rent = own.value ?? numbeo;
    const curNow = getMissionId() ? core.resolveMission(data, getMissionId())?.fundingCurrency : cur;
    const eduOk = curNow === cur;
    const hasEdu = (scenario({}).education || []).length > 0;
    const r = calc(scenario({ missionId: c.missionId, rent, extras: false, keepEdu: eduOk }));
    const mm = r?.monthly || {};
    const S = rent == null ? mm.DminusT : mm.S;
    const val = (x) => (x?.value == null ? '—' : `${core.formatAmount(x.value)} ${cur}`);
    const md = c.md && WITH_DATA.has(c.md.status) ? c.md : null;
    const money = (x) => (x == null ? '—' : `${core.formatAmount(x)} ${cur}`);
    return {
      m, cur, own, numbeo, rent, eduOk, hasEdu, S, mm, r,
      city: m.location_ka, name: shortName(m),
      remainder: rent == null ? '—' : val(r?.remainder?.value), remainderRaw: rent == null ? null : r?.remainder?.value?.value ?? null,
      remLabel: hasEdu && eduOk ? 'დარჩება ქირისა და სწავლის შემდეგ' : 'დარჩება ქირის შემდეგ',
      remNote: hasEdu && !eduOk ? 'სწავლა არ ითვლება (სხვა ვალუტა)' : rent == null ? 'მიუთითეთ ქირა' : null,
      Stext: c.loading && !own.value ? '…' : val(S), F: rent == null ? '—' : val(mm.F),
      rentLabel: own.value != null ? `თქვენი, ${beds()} საძინებელი` : numbeo ? `Numbeo-ს საშუალო, ცენტრი, ${beds()} საძინებელი` : `${beds()} საძინებელი`,
      rentText: money(rent),
      market: md ? [
        ['კომუნალური + ინტერნეტი', `${money(md.utilities?.basic85m2?.average)} + ${money(md.utilities?.internet?.average)}`],
        ['სურსათი (კალათა)', money(md.groceries?.basketItemsSum)],
        ['რესტორანი (ბიუჯ. / საშ. 2 პირზე)', `${money(md.restaurants?.inexpensiveMeal?.average)} / ${money(md.restaurants?.midRangeForTwo?.average)}`],
      ] : [['ფასები', 'მიუწვდომელია']],
      index: md?.indices?.costOfLiving ?? null, source: md?.provider?.attribution_ka ?? null,
    };
  }

  function cardFor(c, i) {
    const M = colModel(c);
    const rid = uid('f');
    const rentInp = h('input', { id: rid, type: 'text', inputmode: 'decimal', value: c.rentRaw, placeholder: M.numbeo ? core.formatAmount(M.numbeo) : '0.00', 'data-testid': 'compare-rent' });
    rentInp.addEventListener('change', () => { c.rentRaw = rentInp.value; render(); grid.querySelector(`[data-col="${c.missionId}"] input`)?.focus(); });
    const del = h('button', { type: 'button', class: 'x', 'aria-label': `ამოღება: ${M.city}` }, '×');
    del.addEventListener('click', () => { cols.splice(i, 1); render(); (grid.querySelector('.x') || addBox.querySelector('input'))?.focus(); });
    return h('article', { class: 'ccard', 'data-col': c.missionId },
      h('header', null, h('div', null, h('h3', null, M.city), h('p', { class: 'small muted' }, `${M.name} · ${M.cur}`)), del),
      h('p', { class: 'c-s-l' }, M.remLabel),
      h('p', { class: 'c-s', 'data-testid': 'compare-remainder', 'data-value': M.remainderRaw ?? '' }, M.remainder),
      M.remNote ? h('p', { class: 'tiny muted c-note', 'data-testid': M.hasEdu && !M.eduOk ? 'edu-not-applied' : null }, M.remNote) : null,
      h('div', { class: 'crow' }, h('span', null, M.rent == null ? 'თვიური თანხა (ქირის გარეშე)' : 'თვიური სამივლინებო თანხა'), h('strong', { 'data-testid': 'compare-S', 'data-value': M.S?.value ?? '' }, M.Stext)),
      h('div', { class: 'crow' }, h('span', null, 'ქირის ანაზღაურება'), h('strong', null, M.F)),
      h('div', { class: 'rent-in' }, h('label', { for: rid }, `ქირა (${M.rentLabel})`),
        h('span', { class: 'with-cur' }, rentInp, h('span', { class: 'cur' }, M.cur))),
      h('div', { class: 'cmarket' }, marketList(c.md, beds(), { loading: c.loading, source: false, compact: true })));
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
