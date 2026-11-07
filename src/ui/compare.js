// შედარება: შეუზღუდავი რაოდენობის ქალაქი, ერთნაირი ზედა შეჯამებით; დალაგება, გადათრევა და ← → ღილაკები.
// ვალუტები არასოდეს იკრიბება/კონვერტირდება. ფორმულები — იგივე ჯაჭვი (chain.js), გამოთვლა — ბირთვით.
import { h, replace, uid, clearButton } from './dom.js';
import * as core from '../core/index.js';
import { missionPicker, shortName } from './picker.js';
import { marketTiles, rentFor, WITH_DATA, marketRows, marketNotes, GROCERIES_LABEL } from './market.js';
import { computeChain, chainRows } from './chain.js';
import { R, mul, div, toFixed2, fromExactString } from '../core/rational.js';
import { comparePdf, downloadBytes } from './pdf/reports.js';

const SORTS = [['mine', 'ჩემი თანმიმდევრობა'], ['asc', 'იაფიდან ძვირისკენ'], ['desc', 'ძვირიდან იაფისკენ']];
/** რანჟირების მაჩვენებელი: Numbeo „ცხოვრება + ქირა“ ინდექსი, თუ არა — ცხოვრების ინდექსი */
const costIndex = (md) => {
  if (!md || !WITH_DATA.has(md.status)) return null;
  const x = md.indices?.costOfLivingPlusRent ?? md.indices?.costOfLiving ?? null;
  return x == null ? null : Number(x);
};

export function mountCompare(root, { data, service, scenario, calc, beds, parseMoney, usdPerEur = null, getMissionId, getRentRaw }) {
  const rate = usdPerEur ? (/^\d+(\/\d+)?$/.test(usdPerEur) ? fromExactString(usdPerEur) : R(usdPerEur)) : null;
  /** სწავლის გადასახადის გადაყვანა საორიენტაციო კურსით (EUR↔USD), 2 ათწილადამდე; სხვა შემთხვევაში null */
  const convertFor = (from, to) => (!rate || from === to ? null
    : from === 'EUR' && to === 'USD' ? (x) => toFixed2(mul(R(x), rate))
      : from === 'USD' && to === 'EUR' ? (x) => toFixed2(div(R(x), rate)) : null);
  const cols = []; // { missionId, rentRaw, md, loading, token } — „ჩემი თანმიმდევრობა“
  let sort = 'mine';
  let lastFocus = null;
  let dragId = null;
  const grid = h('div', { class: 'cgrid', 'data-testid': 'compare-grid' });
  const addBox = h('div', { class: 'cadd' });
  const sortBox = h('div', { class: 'csort' });
  const closeBtn = h('button', { type: 'button', class: 'x big', 'aria-label': 'შედარების დახურვა' }, '×');
  const pdfBtn = h('button', { type: 'button', class: 'btn small', 'data-testid': 'compare-pdf' }, 'PDF ჩამოტვირთვა');
  const printBtn = h('button', { type: 'button', class: 'btn ghost small', 'data-testid': 'compare-print' }, 'ბეჭდვა');
  pdfBtn.addEventListener('click', async () => {
    pdfBtn.disabled = true;
    try { downloadBytes(await comparePdf(ordered().map((c) => pdfCol(colModel(c)))), `rotacia-shedareba-${new Date().toISOString().slice(0, 10)}.pdf`); }
    catch (e) { console.error(e); } finally { pdfBtn.disabled = false; }
  });
  printBtn.addEventListener('click', () => { document.body.classList.add('print-compare'); window.print(); });
  window.addEventListener('afterprint', () => document.body.classList.remove('print-compare'));
  const panel = h('div', { class: 'cpanel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cmp-title' },
    h('div', { class: 'chead' }, h('h2', { id: 'cmp-title', tabindex: '-1' }, 'შედარება'), h('div', { class: 'chead-actions no-print' }, pdfBtn, printBtn), closeBtn),
    h('p', { class: 'muted small clegend' }, 'თქვენი თანამდებობით, ოჯახითა და სწავლით. ქირა — Numbeo-ს საშუალო ცენტრში (შეცვლადი). საცხოვრებელი ხარჯი — Numbeo, ქირისა და სწავლის გარეშე. ≈ — შეფასებული ან კურსით გადაყვანილი. ვალუტები არ იკრიბება.'),
    h('div', { class: 'ctools no-print' }, addBox, sortBox), grid);
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
    if (!id || cols.some((c) => c.missionId === id)) return;
    const c = { missionId: id, rentRaw, md: null, loading: service.online, token: 0 };
    cols.push(c);
    const m = core.resolveMission(data, id);
    const token = ++c.token;
    service.get(m.locationId, m.fundingCurrency).then((md) => {
      if (!cols.includes(c) || token !== c.token) return; // ამოღებული სვეტი
      c.md = md; c.loading = false; render();
    });
  }

  function ordered() {
    if (sort === 'mine') return cols.slice();
    const k = (c) => costIndex(c.md);
    return cols.slice().sort((a, b) => {
      const x = k(a), y = k(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1; if (y == null) return -1; // უცნობი — ბოლოში
      return sort === 'asc' ? x - y : y - x;
    });
  }
  /** ახალი თანმიმდევრობა → „ჩემი თანმიმდევრობა“ */
  function setOrder(list) { cols.splice(0, cols.length, ...list); sort = 'mine'; render(); }
  function move(id, dir) {
    const list = ordered(); const i = list.findIndex((c) => c.missionId === id); const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setOrder(list);
    grid.querySelector(`[data-col="${id}"] [data-testid="compare-move-${dir < 0 ? 'left' : 'right'}"]:not([disabled])`)?.focus()
      ?? grid.querySelector(`[data-col="${id}"] .x`)?.focus();
  }

  /** სვეტის მონაცემები — ეკრანისა და PDF-ისთვის ერთი წყარო */
  function colModel(c) {
    const m = core.resolveMission(data, c.missionId);
    const cur = m.fundingCurrency;
    const own = parseMoney(c.rentRaw);
    const numbeo = c.md?.currency === cur ? rentFor(c.md, beds()) : null;
    const rent = own.value ?? numbeo;
    const curNow = getMissionId() ? core.resolveMission(data, getMissionId())?.fundingCurrency : cur;
    const base = scenario({});
    const hasEdu = (base.education || []).length > 0;
    const conv = curNow !== cur ? convertFor(curNow, cur) : null;
    const eduOk = curNow === cur || !!conv;          // სწავლა ითვლება ყველა ქალაქში (საჭიროებისას — გადაყვანით)
    const eduConverted = hasEdu && !!conv;
    const r = calc(scenario({ missionId: c.missionId, rent, extras: false, keepEdu: eduOk, eduConvert: conv }));
    const fam = base.family.length;
    const chain = computeChain(r, c.md, fam, { hasEdu: hasEdu && eduOk });
    const mm = r?.monthly || {};
    const S = rent == null ? mm.DminusT : mm.S;
    const money = (x) => (x == null ? '—' : `${core.formatAmount(x)} ${cur}`);
    const rows = marketRows(c.md, beds(), { compact: true, familyCount: fam });
    const pending = c.loading && !own.value;
    return {
      c, m, cur, own, numbeo, rent, eduOk, hasEdu, chain, S,
      city: m.location_ka, name: shortName(m),
      remainder: rent == null ? '—' : money(chain.remainder), remainderRaw: rent == null ? null : chain.remainder,
      remLabel: hasEdu && eduOk ? 'დარჩება ქირისა და სწავლის შემდეგ' : 'დარჩება ქირის შემდეგ',
      remNote: rent == null ? (pending ? 'ფასები იტვირთება…' : 'მიუთითეთ ქირა') : eduConverted ? '≈ სწავლა გადაყვანილია Numbeo-ს კურსით' : hasEdu && !eduOk ? 'სწავლა არ ითვლება (კურსი უცნობია)' : null,
      C: r?.monthly?.C?.value ?? null,
      livingRaw: rent == null ? null : chain.living.value,
      livingText: rent == null || chain.living.value == null ? (pending ? '…' : '—') : money(chain.living.value),
      Stext: pending ? '…' : S?.value == null ? '—' : money(S.value),
      F: rent == null ? '—' : money(chain.rent.F),
      extra: rent == null ? '—' : chain.rent.surplus != null && Number(chain.rent.surplus) > 0 ? `0 (ზედმეტი ${money(chain.rent.surplus)})` : money(chain.rent.extra),
      rentLabel: own.value != null ? `თქვენი, ${beds()} საძინებელი` : numbeo ? `Numbeo, ცენტრი, ${beds()} საძინებელი` : `${beds()} საძინებელი`,
      rentText: money(rent),
      market: rows ? rows.slice(1).map((x) => [x.label === GROCERIES_LABEL ? 'სურსათი — 15 პროდუქტის ერთეულის ფასი ჯამში (არა თვიური ხარჯი)' : x.label, x.value]) : [['ფასები', c.md ? '—' : 'მიუწვდომელია']],
      notes: marketNotes(c.md).map((n) => n.text),
      index: c.md?.indices?.costOfLivingPlusRent ?? c.md?.indices?.costOfLiving ?? null,
      source: WITH_DATA.has(c.md?.status) ? c.md?.provider?.attribution_ka ?? null : null,
    };
  }
  const pdfCol = (M) => ({ city: M.city, name: M.name, cur: M.cur, remainder: M.remainder, remNote: M.remNote, living: M.livingText, livingNote: M.chain.living.estimated ? '≈ ინდექსით შეფასებული' : M.chain.living.kind === 'utilities' ? 'კომუნალური + ინტერნეტი' : null,
    notes: M.notes, S: M.Stext, F: M.F, extra: M.extra, rent: M.rentText, rentLabel: M.rentLabel, market: M.market, index: M.index, source: M.source });

  function cardFor(c, i, n) {
    const M = colModel(c);
    const rid = uid('f');
    const rentInp = h('input', { id: rid, type: 'text', inputmode: 'decimal', value: c.rentRaw, placeholder: M.numbeo ? core.formatAmount(M.numbeo) : '0.00', 'data-testid': 'compare-rent' });
    rentInp.addEventListener('change', () => { c.rentRaw = rentInp.value; render(); grid.querySelector(`[data-col="${c.missionId}"] input`)?.focus(); });
    const del = h('button', { type: 'button', class: 'x', 'aria-label': `ამოღება: ${M.city}` }, '×');
    del.addEventListener('click', () => { cols.splice(cols.indexOf(c), 1); render(); (grid.querySelector('.x') || addBox.querySelector('input'))?.focus(); });
    const left = h('button', { type: 'button', class: 'mv', disabled: i === 0, 'aria-label': `${M.city} — მარცხნივ გადატანა`, title: 'მარცხნივ', 'data-testid': 'compare-move-left' }, '←');
    const right = h('button', { type: 'button', class: 'mv', disabled: i === n - 1, 'aria-label': `${M.city} — მარჯვნივ გადატანა`, title: 'მარჯვნივ', 'data-testid': 'compare-move-right' }, '→');
    left.addEventListener('click', () => move(c.missionId, -1));
    right.addEventListener('click', () => move(c.missionId, 1));
    const card = h('article', { class: 'ccard', 'data-col': c.missionId, 'data-c': M.C ?? '', draggable: 'true' },
      h('header', null,
        h('span', { class: 'grip', 'aria-hidden': 'true', title: 'გადაათრიეთ თანმიმდევრობის შესაცვლელად' }, '⠿'),
        h('div', { class: 'ch-t' }, h('h3', null, M.city), h('p', { class: 'small muted' }, M.name)),
        h('span', { class: 'cur-tag' }, M.cur), del),
      h('div', { class: 'csum' },
        h('p', { class: 'c-s-l' }, M.remLabel),
        h('p', { class: 'c-s' + (String(M.remainderRaw ?? '').startsWith('-') ? ' neg' : ''), 'data-testid': 'compare-remainder', 'data-value': M.remainderRaw ?? '' }, M.remainder),
        h('p', { class: 'tiny muted c-note', 'data-testid': M.remNote?.startsWith('≈') ? 'edu-converted' : null }, M.remNote ?? ' '),
        h('p', { class: 'c-s-l' }, 'დარჩება საცხოვრებელი ხარჯების შემდეგ (საორიენტაციო)'),
        h('p', { class: 'c-s2' + (String(M.livingRaw ?? '').startsWith('-') ? ' neg' : ''), 'data-testid': 'compare-remainder-living', 'data-value': M.livingRaw ?? '' }, M.livingText),
        h('p', { class: 'tiny muted c-note2' }, M.chain.living.estimated ? '≈ ინდექსით შეფასებული' : M.chain.living.kind === 'utilities' ? 'გამოკლებულია კომუნალური + ინტერნეტი' : ' ')),
      h('div', { class: 'cdet' },
        h('div', { class: 'crow' }, h('span', null, M.rent == null ? 'თვიური თანხა (ქირის გარეშე)' : 'თვიური სამივლინებო თანხა'), h('strong', { 'data-testid': 'compare-S', 'data-value': M.S?.value ?? '' }, M.Stext)),
        M.rent == null ? null : h('ol', { class: 'cchain', 'data-testid': 'compare-chain', 'aria-label': 'როგორ მივიღეთ' }, chainRows(M.chain).slice(1).map((x) => h('li', { class: x.strong ? 'strong' : null },
          h('span', { class: 'cc-s', 'aria-hidden': 'true' }, x.sign), h('span', { class: 'cc-l' }, x.short ?? x.label), h('span', { class: 'cc-v' + (String(x.value ?? '').startsWith('-') ? ' neg' : '') }, x.value == null ? '—' : `${core.formatAmount(x.value)} ${M.cur}`)))),
        h('div', { class: 'rent-in' }, h('label', { for: rid }, `ქირა (${M.rentLabel})`),
          h('span', { class: 'with-cur' }, h('span', { class: 'inp-wrap' }, rentInp, clearButton(rentInp)), h('span', { class: 'cur' }, M.cur))),
        h('div', { class: 'crow' }, h('span', null, 'რამდენს ანაზღაურებს (F)'), h('strong', null, M.F)),
        h('div', { class: 'crow' }, h('span', null, 'თქვენ ამატებთ ქირაში'), h('strong', null, M.extra))),
      h('div', { class: 'cmarket' }, marketTiles(c.md, beds(), { loading: c.loading, source: false, compact: true, familyCount: scenario({}).family.length })),
      h('div', { class: 'cmove no-print' }, left, right));
    // გადათრევა (მაუსი)
    card.addEventListener('dragstart', (e) => { dragId = c.missionId; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', c.missionId); } catch { /* */ } });
    card.addEventListener('dragend', () => { dragId = null; card.classList.remove('dragging'); });
    card.addEventListener('dragover', (e) => { if (dragId && dragId !== c.missionId) { e.preventDefault(); card.classList.add('drop'); } });
    card.addEventListener('dragleave', () => card.classList.remove('drop'));
    card.addEventListener('drop', (e) => { e.preventDefault(); card.classList.remove('drop'); dropOn(dragId, c.missionId); });
    // შეხებით გადათრევა (სახელურით)
    const grip = card.querySelector('.grip');
    grip.addEventListener('touchstart', (e) => { dragId = c.missionId; card.classList.add('dragging'); e.preventDefault(); }, { passive: false });
    grip.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });
    grip.addEventListener('touchend', (e) => {
      card.classList.remove('dragging');
      const t = e.changedTouches[0];
      const target = document.elementFromPoint(t.clientX, t.clientY)?.closest('[data-col]');
      if (target) dropOn(dragId, target.getAttribute('data-col'));
      dragId = null;
    });
    return card;
  }
  function dropOn(fromId, toId) {
    if (!fromId || fromId === toId) return;
    const list = ordered();
    const from = list.findIndex((x) => x.missionId === fromId); const to = list.findIndex((x) => x.missionId === toId);
    if (from < 0 || to < 0) return;
    const [it] = list.splice(from, 1); list.splice(to, 0, it);
    setOrder(list);
  }

  function render() {
    replace(addBox, missionPicker({ data, label: '+ ქალაქის დამატება', placeholder: 'ჩაწერეთ ქალაქი…', exclude: cols.map((c) => c.missionId), testid: 'compare-add',
      onPick: (id) => { add(id); render(); addBox.querySelector('input')?.focus(); } }));
    const sid = uid('f');
    const sel = h('select', { id: sid, 'data-testid': 'compare-sort' }, SORTS.map(([v, t]) => h('option', { value: v, selected: v === sort }, t)));
    sel.addEventListener('change', () => { sort = sel.value; render(); sortBox.querySelector('select')?.focus(); });
    replace(sortBox, h('div', { class: 'field' }, h('label', { for: sid }, 'დალაგება'), sel,
      h('p', { class: 'tiny muted' }, 'სიძვირე — Numbeo-ს „ცხოვრება + ქირა“ ინდექსით. თანმიმდევრობა — თრევით ან ← →.')));
    const list = ordered();
    replace(grid, list.length ? list.map((c, i) => cardFor(c, i, list.length)) : h('p', { class: 'muted' }, 'დაამატეთ ქალაქი შესადარებლად.'));
    const src = cols.find((c) => WITH_DATA.has(c.md?.status) && c.md?.provider)?.md?.provider;
    if (src) grid.append(h('p', { class: 'msource wide' }, src.attribution_ka || 'წყარო: Numbeo.com'));
  }
  return { open, close, render };
}
