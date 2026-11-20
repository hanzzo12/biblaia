// „ქალაქების სიძვირე“: რამდენი რჩება ხელზე თითო მისიის ქალაქში — ოფიციალური K, E, H (ბირთვის calculate())
// + Numbeo-ს ქირა და საცხოვრებელი ხარჯი. ვალუტები არ იკრიბება; დალაგებისთვის USD → EUR საორიენტაციო კურსით.
import { h, replace, uid } from './dom.js';
import * as core from '../core/index.js';
import { R, div, toFixed2, fromExactString, cmp } from '../core/rational.js';
import { rentFor, livingRemainder, suggestBedrooms, WITH_DATA } from './market.js';
import { citiesPdf, downloadBytes } from './pdf/reports.js';

const SORTS = [['left-desc', 'მეტი რჩება ხელზე → ნაკლები'], ['left-asc', 'ნაკლები → მეტი'], ['alpha', 'ანბანით']];
const FAMILY = [['0', 'მარტო'], ['1', 'მეუღლე'], ['2', 'მეუღლე + 1 შვილი'], ['3', 'მეუღლე + 2 შვილი'], ['4', 'მეუღლე + 3 შვილი']];
const DEFAULT_ENTRY = 'A2-R6'; // პირველი / მეორე მდივანი, 60%
const money = (x) => (x == null ? '—' : core.formatAmount(x));
const neg = (x) => (x != null && String(x).startsWith('-') ? ' neg' : '');

export function mountCities(root, { data, marketFor, usdPerEur = null, getProfile = () => null, positions = () => [], shortPos = {} }) {
  const rate = usdPerEur ? (/^\d+(\/\d+)?$/.test(usdPerEur) ? fromExactString(usdPerEur) : R(usdPerEur)) : null;
  let sort = 'left-desc'; let onlySel = false; let touched = false;
  let profile = { entryId: DEFAULT_ENTRY, family: 0 };
  let rows = null;
  const selected = new Set();
  const box = h('div', { class: 'cities' });
  root.append(box);

  // ერთი მისია თითო ქალაქზე (საელჩო, თუ არის)
  const missionByLoc = new Map();
  for (const m of core.listMissions(data, {})) {
    const cur = missionByLoc.get(m.locationId);
    if (!cur || (cur.type !== 'embassy' && m.type === 'embassy')) missionByLoc.set(m.locationId, m);
  }
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  function scenarioFor(m, rent) {
    const sc = core.emptyScenario();
    const e = positions().find((x) => x.id === profile.entryId);
    sc.missionId = m.id;
    sc.position = { mode: 'annex2', entryId: profile.entryId };
    sc.status.rentHead = e?.suggestedRentHead === 'head' || e?.suggestedRentHead === 'head-consular' ? 'head' : 'not-head';
    sc.period = { mode: 'full-month', month };
    const n = profile.family;
    const fam = [];
    if (n >= 1) fam.push({ ...core.emptyFamilyMember('F1', 'მეუღლე'), role: 'spouse', age: 35 });
    for (let i = 0; i < n - 1; i++) fam.push({ ...core.emptyFamilyMember(`F${i + 2}`, `შვილი ${i + 1}`), role: 'child', age: [6, 9, 12][i] });
    sc.family = fam;
    sc.rent = { amount: rent, basis: 'planned', marketRef: null, changes: [] };
    return sc;
  }

  function compute() {
    const beds = suggestBedrooms(profile.family);
    rows = [...missionByLoc.values()].map((m) => {
      const cur = m.fundingCurrency;
      let md = null;
      try { md = marketFor(m.locationId, cur); } catch { md = null; }
      const has = md && WITH_DATA.has(md.status);
      const G = has ? rentFor(md, beds) : null;
      let r = null;
      try { r = core.calculate(scenarioFor(m, G), data); } catch (e) { console.error(e); }
      const S = G != null ? r?.monthly?.S?.value ?? null : null;
      const afterRent = G != null ? r?.remainder?.value?.value ?? null : null;
      const liv = livingRemainder(afterRent, has ? md : null, profile.family);
      const left = afterRent != null ? liv.value : null;
      const leftEur = left == null ? null : cur === 'EUR' ? R(left) : rate ? div(R(left), rate) : null;
      return {
        locationId: m.locationId, city: m.location_ka, country: m.country_ka, cur, k: m.coefficient?.k ?? null, e: m.coefficient?.ePercent ?? null,
        S, G, living: liv.deduction, estimated: !!liv.estimated, partial: liv.kind === 'utilities' && left != null, left, afterRent, leftEur, leftEurText: leftEur != null && cur !== 'EUR' ? toFixed2(leftEur) : null,
        index: has ? md.indices?.costOfLivingPlusRent ?? md.indices?.costOfLiving ?? null : null,
        note: G == null ? 'ქირის მონაცემი არ არის' : S == null ? 'ოფიციალური K დანართში არ არის' : liv.deduction == null ? 'საცხოვრებელი ხარჯი უცნობია' : liv.kind === 'utilities' ? 'გამოკლებულია მხოლოდ კომუნალური + ინტერნეტი (სრული ხარჯი Numbeo-ზე არ არის)' : null,
      };
    });
  }

  function view() {
    let list = rows.filter((r) => !onlySel || selected.has(r.locationId));
    const byCity = (a, b) => a.city.localeCompare(b.city, 'ka');
    if (sort === 'alpha') return list.slice().sort(byCity);
    return list.slice().sort((a, b) => {
      if (a.leftEur == null && b.leftEur == null) return byCity(a, b);
      if (a.leftEur == null) return 1; if (b.leftEur == null) return -1; // მონაცემის გარეშე — ბოლოში
      if (a.partial !== b.partial) return a.partial ? 1 : -1; // მხოლოდ კომუნალური გამოკლებული — სრულის შემდეგ
      const c = cmp(a.leftEur, b.leftEur);
      return sort === 'left-desc' ? -c : c;
    });
  }

  function syncProfile() {
    if (touched) return;
    const p = getProfile();
    if (!p) return;
    profile = { entryId: p.entryId || DEFAULT_ENTRY, family: p.family ?? 0 };
  }

  function load() { syncProfile(); compute(); render(); }

  const head = ['', 'ქალაქი', 'ქვეყანა', 'ყოველთვიური თანხა S', 'ქირა (Numbeo)', 'საცხოვრებელი ხარჯი', 'დარჩება ხელზე', 'დარჩება ქირის შემდეგ', 'K', 'E', 'ინდექსი', 'ვალუტა'];
  const pdfCells = (r) => [r.city, r.country, money(r.S), money(r.G), r.living == null ? '—' : `${money(r.living)}${r.estimated ? ' ≈' : ''}`,
    r.left == null ? '—' : `${money(r.left)}${r.leftEurText ? ` (≈ ${money(r.leftEurText)} EUR)` : ''}`, money(r.afterRent), r.k ?? '—', r.e != null ? `${r.e}%` : '—', r.index ?? '—', r.cur];

  function render() {
    if (!rows) { replace(box, h('p', { class: 'muted' }, 'იტვირთება…')); return; }
    const list = view();
    const pid = uid('f'); const fid = uid('f'); const sid = uid('f'); const oid = uid('f');
    const pos = h('select', { id: pid, 'data-testid': 'cities-profile-position' }, positions().map((e) =>
      h('option', { value: e.id, selected: e.id === profile.entryId }, `${(shortPos[e.rowNo] || [e.positions_ka?.join(' / ') || e.title_ka])[0]} — ${e.percent}%`)));
    pos.addEventListener('change', () => { profile.entryId = pos.value; touched = true; compute(); render(); box.querySelector('[data-testid="cities-profile-position"]')?.focus(); });
    const fam = h('select', { id: fid, 'data-testid': 'cities-profile-family' }, FAMILY.map(([v, t]) => h('option', { value: v, selected: Number(v) === profile.family }, t)));
    fam.addEventListener('change', () => { profile.family = Number(fam.value); touched = true; compute(); render(); box.querySelector('[data-testid="cities-profile-family"]')?.focus(); });
    const sel = h('select', { id: sid, 'data-testid': 'cities-sort' }, SORTS.map(([v, t]) => h('option', { value: v, selected: v === sort }, t)));
    sel.addEventListener('change', () => { sort = sel.value; render(); box.querySelector('[data-testid="cities-sort"]')?.focus(); });
    const only = h('input', { id: oid, type: 'checkbox', checked: onlySel, 'data-testid': 'cities-only-selected' });
    only.addEventListener('change', () => { onlySel = only.checked; render(); box.querySelector('[data-testid="cities-only-selected"]')?.focus(); });
    const allSel = list.length > 0 && list.every((r) => selected.has(r.locationId));
    const toggleAll = h('button', { type: 'button', class: 'btn ghost small', 'data-testid': 'cities-select-all' }, allSel ? 'ყველას მოხსნა' : 'ყველას მონიშვნა');
    toggleAll.addEventListener('click', () => { for (const r of view()) { if (allSel) selected.delete(r.locationId); else selected.add(r.locationId); } render(); box.querySelector('[data-testid="cities-select-all"]')?.focus(); });
    const beds = suggestBedrooms(profile.family);
    const posLabel = pos.selectedOptions[0]?.textContent ?? '';
    const legend = `დარჩება ხელზე = S − ქირა (Numbeo, ცენტრი, ${beds} საძ.) − საცხოვრებელი ხარჯი (Numbeo, ქირის გარეშე; ≈ ინდექსით შეფასებული). S — ოფიციალური K, E და საბაზისო თანხით. USD ქალაქების რიგი — EUR-ში გადაყვანით (Numbeo-ს კურსით${rate ? `, 1 EUR = ${toFixed2(rate)} USD` : ''}); ვალუტები არ იკრიბება. სწავლა არ ითვლება.`;
    const pdf = h('button', { type: 'button', class: 'btn small', 'data-testid': 'cities-pdf' }, 'PDF ჩამოტვირთვა');
    pdf.addEventListener('click', async () => {
      pdf.disabled = true;
      try { downloadBytes(await citiesPdf(view().map((r) => ({ cells: pdfCells(r) })), { sortLabel: `პროფილი: ${posLabel}, ${FAMILY[profile.family][1]}. დალაგება: ${SORTS.find((s) => s[0] === sort)[1]}.`, legend }), `qalaqebis-sidzvire-${new Date().toISOString().slice(0, 10)}.pdf`); }
      catch (e) { console.error(e); } finally { pdf.disabled = false; }
    });
    const print = h('button', { type: 'button', class: 'btn ghost small', 'data-testid': 'cities-print' }, 'ბეჭდვა');
    print.addEventListener('click', () => { document.body.classList.add('print-cities'); window.print(); });
    replace(box,
      h('div', { class: 'ctl no-print' },
        h('div', { class: 'field' }, h('label', { for: pid }, 'თანამდებობა'), pos),
        h('div', { class: 'field' }, h('label', { for: fid }, 'ოჯახი'), fam),
        h('div', { class: 'field' }, h('label', { for: sid }, 'დალაგება'), sel)),
      h('div', { class: 'ctl-row no-print' }, h('span', { class: 'chk' }, only, h('label', { for: oid }, 'მხოლოდ მონიშნულები')), toggleAll, pdf, print,
        h('span', { class: 'tiny muted' }, `${list.length} ქალაქი${selected.size ? ` · მონიშნულია ${selected.size}` : ''}`)),
      h('p', { class: 'tiny muted clegend' }, legend),
      h('div', { class: 'table-scroll', role: 'region', 'aria-label': 'ქალაქების ცხრილი', tabindex: '0' },
        h('table', { class: 'ctable', 'data-testid': 'cities-table' },
          h('thead', null, h('tr', null, head.map((t, i) => h('th', { scope: 'col', class: i >= 3 && i <= 10 ? 'num' : null }, t)))),
          h('tbody', null, list.map((r) => {
            const id = uid('f');
            const cb = h('input', { id, type: 'checkbox', checked: selected.has(r.locationId), 'aria-label': `მონიშვნა: ${r.city}` });
            const tr = h('tr', { class: selected.has(r.locationId) ? 'sel' : null, 'data-location': r.locationId },
              h('td', { class: 'cb' }, cb),
              h('th', { scope: 'row' }, r.city, r.note ? h('span', { class: 'row-note' }, r.note) : null), h('td', null, r.country),
              h('td', { class: 'num' }, money(r.S)), h('td', { class: 'num' }, money(r.G)),
              h('td', { class: 'num' }, money(r.living), r.estimated ? h('span', { class: 'est', title: 'ინდექსით შეფასებული' }, ' ≈') : null),
              h('td', { class: 'num strong' + neg(r.left), 'data-testid': 'cities-col-left', 'data-value': r.left ?? '', 'data-eur': r.leftEur != null ? toFixed2(r.leftEur) : '', 'data-partial': r.partial ? '1' : '' },
                money(r.left), r.leftEurText ? h('span', { class: 'eur' }, `≈ ${money(r.leftEurText)} EUR`) : null),
              h('td', { class: 'num' + neg(r.afterRent) }, money(r.afterRent)), h('td', { class: 'num' }, r.k ?? '—'), h('td', { class: 'num' }, r.e != null ? `${r.e}%` : '—'),
              h('td', { class: 'num small-idx' }, r.index ?? '—'), h('td', null, r.cur));
            cb.addEventListener('change', () => { if (cb.checked) selected.add(r.locationId); else selected.delete(r.locationId); if (onlySel) render(); else tr.classList.toggle('sel', cb.checked); });
            return tr;
          })))),
      h('p', { class: 'msource' }, 'წყარო: Numbeo.com (მოპოვებულია Apify-ის მეშვეობით; შენახული ასლები). საორიენტაციოა; ოფიციალური თანხა — S (ბრძანება).'));
  }
  return { load };
}
