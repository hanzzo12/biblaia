// „ქალაქების სიძვირე“: ყველა მისიის ქალაქი Numbeo-ს მონაცემებით (MarketSummary, contracts §9 / providers summary.js).
import { h, replace, uid } from './dom.js';
import * as core from '../core/index.js';
import { citiesPdf, downloadBytes } from './pdf/reports.js';

const SORTS = [['alpha', 'ანბანით'], ['asc', 'იაფიდან ძვირისკენ'], ['desc', 'ძვირიდან იაფისკენ']];
const SOURCE_KA = { kv: 'Numbeo', 'apify-snapshot': 'Numbeo ასლი', 'user-snapshot': 'Numbeo ასლი', capital: 'დედაქალაქის მონაცემი' };
const kaDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? '')); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; };
const num = (x) => (x == null || x === '' ? null : Number(x));

export function mountCities(root, { data, loadSummary }) {
  let rows = null; let error = false;
  let sort = 'alpha'; let onlySel = false;
  const selected = new Set();
  const kByLocation = new Map();
  for (const m of core.listMissions(data, {})) {
    const k = m.coefficient?.k;
    if (k == null) continue;
    const set = kByLocation.get(m.locationId) || new Set(); set.add(k); kByLocation.set(m.locationId, set);
  }
  const box = h('div', { class: 'cities' });
  root.append(box);

  async function load() {
    if (rows || error) return;
    render();
    try {
      const sum = await loadSummary();
      rows = (sum?.rows || []).map((r) => ({
        ...r,
        k: kByLocation.has(r.locationId) ? [...kByLocation.get(r.locationId)].join(' / ') : '—',
        src: r.fallbackFrom ? `დედაქალაქის მონაცემი (${r.fallbackFrom.city_ka})` : SOURCE_KA[r.source] ?? '—',
        date: kaDate(r.sourceDate),
      }));
      if (!rows.length) error = true;
    } catch (e) { console.error(e); error = true; }
    render();
  }

  function view() {
    let list = (rows || []).filter((r) => !onlySel || selected.has(r.locationId));
    const key = (r) => num(r.indices?.costOfLivingPlusRent);
    if (sort === 'alpha') list = list.slice().sort((a, b) => a.city_ka.localeCompare(b.city_ka, 'ka'));
    else list = list.slice().sort((a, b) => {
      const x = key(a), y = key(b);
      if (x == null && y == null) return a.city_ka.localeCompare(b.city_ka, 'ka');
      if (x == null) return 1; if (y == null) return -1;
      return sort === 'asc' ? x - y : y - x;
    });
    return list;
  }
  const money = (x, cur) => (x == null ? '—' : `${core.formatAmount(x)} ${cur}`);
  const cells = (r) => [r.city_ka, r.country_ka, r.indices?.costOfLivingPlusRent ?? '—', r.indices?.costOfLiving ?? '—', r.indices?.rent ?? '—',
    r.rentCentre1br == null ? '—' : core.formatAmount(r.rentCentre1br), r.currency, r.k, `${r.src}${r.date ? ' · ' + r.date : ''}`];

  function render() {
    if (!rows && !error) { replace(box, h('p', { class: 'muted' }, 'მონაცემები იტვირთება…')); return; }
    if (error) { replace(box, h('p', { class: 'muted' }, 'ფასები ამჟამად მიუწვდომელია')); return; }
    const list = view();
    const sid = uid('f'); const oid = uid('f');
    const sel = h('select', { id: sid, 'data-testid': 'cities-sort' }, SORTS.map(([v, t]) => h('option', { value: v, selected: v === sort }, t)));
    sel.addEventListener('change', () => { sort = sel.value; render(); box.querySelector('[data-testid="cities-sort"]')?.focus(); });
    const only = h('input', { id: oid, type: 'checkbox', checked: onlySel, 'data-testid': 'cities-only-selected' });
    only.addEventListener('change', () => { onlySel = only.checked; render(); box.querySelector('[data-testid="cities-only-selected"]')?.focus(); });
    const allSel = list.length > 0 && list.every((r) => selected.has(r.locationId));
    const toggleAll = h('button', { type: 'button', class: 'btn ghost small', 'data-testid': 'cities-select-all' }, allSel ? 'ყველას მოხსნა' : 'ყველას მონიშვნა');
    toggleAll.addEventListener('click', () => { for (const r of view()) { if (allSel) selected.delete(r.locationId); else selected.add(r.locationId); } render(); box.querySelector('[data-testid="cities-select-all"]')?.focus(); });
    const pdf = h('button', { type: 'button', class: 'btn small', 'data-testid': 'cities-pdf' }, 'PDF ჩამოტვირთვა');
    pdf.addEventListener('click', async () => {
      pdf.disabled = true;
      try { downloadBytes(await citiesPdf(view().map((r) => ({ cells: cells(r) })), { sortLabel: `დალაგება: ${SORTS.find((s) => s[0] === sort)[1]}${sort !== 'alpha' ? ' („ცხოვრება + ქირა“ ინდექსით)' : ''}${onlySel ? ' · მხოლოდ მონიშნულები' : ''}.` }), `qalaqebis-sidzvire-${new Date().toISOString().slice(0, 10)}.pdf`); }
      catch (e) { console.error(e); } finally { pdf.disabled = false; }
    });
    const print = h('button', { type: 'button', class: 'btn ghost small', 'data-testid': 'cities-print' }, 'ბეჭდვა');
    print.addEventListener('click', () => { document.body.classList.add('print-cities'); window.print(); });
    const heads = ['', 'ქალაქი', 'ქვეყანა', 'ცხოვრება + ქირა', 'ცხოვრება', 'ქირა (ინდექსი)', 'ქირა ცენტრში, 1 საძ.', 'ვალუტა', 'K (დან. №4)', 'წყარო / თარიღი'];
    replace(box,
      h('div', { class: 'ctl no-print' },
        h('div', { class: 'field' }, h('label', { for: sid }, 'დალაგება'), sel,
          h('p', { class: 'tiny muted' }, 'სიძვირე — Numbeo-ს „ცხოვრება + ქირა“ ინდექსით (ნიუ-იორკი = 100).')),
        h('div', { class: 'ctl-row' },
          h('span', { class: 'chk' }, only, h('label', { for: oid }, 'მხოლოდ მონიშნულები')),
          toggleAll, pdf, print),
        h('p', { class: 'tiny muted' }, `${list.length} ქალაქი${selected.size ? ` · მონიშნულია ${selected.size}` : ''}`)),
      h('div', { class: 'table-scroll', role: 'region', 'aria-label': 'ქალაქების ცხრილი', tabindex: '0' },
        h('table', { class: 'ctable', 'data-testid': 'cities-table' },
          h('thead', null, h('tr', null, heads.map((t, i) => h('th', { scope: 'col', class: i >= 3 && i <= 6 ? 'num' : null }, t)))),
          h('tbody', null, list.map((r) => {
            const id = uid('f');
            const cb = h('input', { id, type: 'checkbox', checked: selected.has(r.locationId), 'aria-label': `მონიშვნა: ${r.city_ka}` });
            cb.addEventListener('change', () => { if (cb.checked) selected.add(r.locationId); else selected.delete(r.locationId); if (onlySel) { render(); } else { tr.classList.toggle('sel', cb.checked); } });
            const c = cells(r);
            const tr = h('tr', { class: selected.has(r.locationId) ? 'sel' : null, 'data-location': r.locationId },
              h('td', { class: 'cb no-print-cb' }, cb),
              h('th', { scope: 'row' }, c[0]), h('td', null, c[1]),
              h('td', { class: 'num strong', 'data-value': r.indices?.costOfLivingPlusRent ?? '' }, c[2]), h('td', { class: 'num' }, c[3]), h('td', { class: 'num' }, c[4]),
              h('td', { class: 'num' }, r.rentCentre1br == null ? '—' : money(r.rentCentre1br, r.currency)), h('td', null, c[6]), h('td', { class: 'num' }, c[7]),
              h('td', { class: 'src' }, h('span', { class: 'mbadge' }, c[8])));
            return tr;
          })))),
      h('p', { class: 'msource' }, 'წყარო: Numbeo.com (მოპოვებულია Apify-ის მეშვეობით; ნაწილი — შენახული ასლებიდან). საორიენტაციოა; ოფიციალურ K-ს არ ცვლის.'));
  }
  return { load };
}
