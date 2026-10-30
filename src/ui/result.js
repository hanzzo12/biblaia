// საფეხური 4: მთავარი თანხები + ერთი ღილაკით „როგორ დაითვალა“.
import { h, uid } from './dom.js';
import * as core from '../core/index.js';

const v = (c) => (c && typeof c === 'object' ? c.value ?? null : c ?? null);
const fmt = (c, cur) => { const x = v(c); return x == null ? '—' : `${core.formatAmount(x)} ${cur ?? ''}`.trim(); };
const ROLE_KA = { spouse: 'მეუღლე', child: 'შვილი', guardianship: 'მეურვეობის ქვეშ მყოფი' };

function card(label, value, raw, sub, testid) {
  return h('div', { class: 'rcard', 'data-testid': testid ?? null },
    h('span', { class: 'rc-label' }, label),
    h('span', { class: 'rc-value' + (raw != null && String(raw).startsWith('-') ? ' neg' : ''), 'data-value': raw ?? '' }, value),
    sub ? h('span', { class: 'rc-sub' }, sub) : null);
}

export function renderResult({ r, st, sc, noRent, mission, data, onPrint, onCompare, shortName }) {
  const cur = r?.currency ?? mission?.fundingCurrency ?? '';
  const m = r?.monthly || {};
  const ed = r?.education || {};
  const hasEdu = (sc.education || []).length > 0;
  const heroVal = noRent ? m.DminusT : m.S;
  const undetermined = v(heroVal) == null;
  const why = undetermined ? (m.K?.value == null ? 'ამ დაწესებულებისთვის კოეფიციენტი (K) ნორმატიულ დანართებში არ არის — თანხა ვერ დადგინდება.' : (m.S?.reason_ka || 'თანხა ვერ დადგინდა.')) : null;

  // ერთჯერადი
  const ot = [];
  const otr = r?.oneTimeReimbursements || {};
  if (st.ex.settlement) {
    const s = r?.oneTimeAllowances?.settlement;
    ot.push(['პირველადი მოწყობა', v(s) == null ? 'მიუთითეთ დღიური ნორმა' : fmt(s, s.currency ?? cur), v(s), v(s) != null ? 'თქვენ მიერ მითითებული დღიური ნორმით' : null]);
  }
  if (st.ex.baggage) {
    const b = otr.baggage;
    const claimed = (sc.baggage?.claims || []).length > 0;
    ot.push(['ბარგის გადაზიდვა', claimed ? fmt(b?.reimbursable, cur) : `ლიმიტი ${fmt(b?.cap, cur)}`, claimed ? v(b?.reimbursable) : v(b?.cap), claimed ? `ლიმიტი ${fmt(b?.cap, cur)}` : 'ანაზღაურდება ფაქტიური ხარჯი ლიმიტის ფარგლებში']);
  }
  if (st.ex.broker) ot.push(['მაკლერის მომსახურება', sc.broker ? fmt(otr.broker, cur) : 'მიუთითეთ საკომისიო', v(otr.broker), sc.broker ? (st.head ? '80% საკომისიოსი, მაქს. ერთი თვის ქირა' : '50% საკომისიოსი, მაქს. ერთი თვის ქირა') : null]);
  const caps = st.ex.insurance ? (r?.insurance?.perPerson || []) : [];

  // დეტალების ცხრილი
  const rows = [
    ['H', 'საბაზისო თანხა', m.H, true], ['A', 'თანამდებობის პროცენტი', m.A, false, '%'], ['K', 'ქვეყნის კოეფიციენტი', m.K], ['C', 'ოჯახის წევრები (დანამატით)', m.C],
    ['D', 'პერსონალური თანხა', m.D, true], ['E', 'ბინის წილი', m.E, false, '%'], ['T', 'ბინის წილი თანხაში', m.T, true],
    ['G', 'ქირა', m.G, true], ['F', 'ქირის ანაზღაურება', m.F, true], ['S', 'ყოველთვიური თანხა (D − T + F)', m.S, true],
  ];
  const notes = [...(r?.assumptions || []), ...(r?.warnings || []).filter((w) => w.severity !== 'info')].map((a) => a.message_ka).filter(Boolean);
  const detId = uid('det');
  const det = h('div', { id: detId, class: 'details', hidden: true },
    h('table', { class: 'calc' }, h('tbody', null, rows.map(([k, label, c, money, suf]) => h('tr', { 'data-component': k },
      h('th', { scope: 'row' }, h('span', { class: 'sym' }, k), ' ', label),
      h('td', { 'data-value': v(c) ?? '' }, v(c) == null ? '—' : money ? fmt(c, cur) : `${v(c)}${suf ?? ''}`))))),
    h('p', { class: 'formula' }, 'D = H × A × K × (1 + 7% × C) · T = D × E · S = D − T + F'),
    hasEdu ? h('p', { class: 'small' }, `სწავლა: ანაზღაურდება თვეში ${cur === 'USD' ? '750 USD' : '690 EUR'}-მდე სრულად, ზედმეტის 80%.`) : null,
    notes.length ? h('ul', { class: 'foot-notes' }, notes.slice(0, 6).map((n) => h('li', null, n))) : null,
    h('p', { class: 'tiny muted' }, `წესების ვერსია: ${r?.rulesVersion ?? data.rulesVersion}`));
  const detBtn = h('button', { type: 'button', class: 'btn ghost', 'aria-expanded': 'false', 'aria-controls': detId, 'data-testid': 'how' }, 'როგორ დაითვალა');
  detBtn.addEventListener('click', () => { det.hidden = !det.hidden; detBtn.setAttribute('aria-expanded', String(!det.hidden)); });

  const printBtn = h('button', { type: 'button', class: 'btn', 'data-testid': 'print' }, 'PDF / ბეჭდვა');
  printBtn.addEventListener('click', onPrint);
  const cmpBtn = h('button', { type: 'button', class: 'btn ghost', 'data-testid': 'compare-open' }, 'შედარება');
  cmpBtn.addEventListener('click', onCompare);

  // ბეჭდვის შეყვანის მოკლე ჩამონათვალი
  const pos = core.positionProfiles(data).find((p) => p.id === st.mode)?.entries.find((e) => e.id === st.entryId);
  const inputs = [
    ['დაწესებულება', mission ? `${mission.location_ka} — ${shortName(mission)}` : '—'],
    ['თანამდებობა', pos ? `${pos.positions_ka?.join(' / ') ?? pos.title_ka} (${pos.percent}%)` : '—'],
    ['ხელმძღვანელი', st.head ? 'დიახ' : 'არა'],
    ['ოჯახი', st.family.length ? st.family.map((f) => `${ROLE_KA[f.role]}${f.ageRaw ? ` (${f.ageRaw})` : ''}`).join(', ') : 'არა'],
    ['ქირა', sc.rent.amount != null ? fmt(sc.rent.amount, cur) + (st.rentFromMarket ? ' (Numbeo-ს საშუალო)' : '') : 'არ არის მითითებული'],
    ['სწავლა', hasEdu ? sc.education.map((e) => fmt(e.tuition, cur)).join(', ') : '—'],
    ['პერიოდი', `სრული თვე (${sc.period.month})`],
  ];

  return [
    h('h2', { tabindex: '-1' }, 'შედეგი'),
    h('div', { class: 'print-only' }, h('table', { class: 'inputs' }, h('tbody', null, inputs.map(([k, x]) => h('tr', null, h('th', { scope: 'row' }, k), h('td', null, x)))))),
    h('div', { class: 'hero', 'aria-live': 'polite' },
      h('p', { class: 'hero-l' }, noRent ? 'ყოველთვიური სამივლინებო თანხა (ქირის გარეშე)' : 'ყოველთვიური სამივლინებო თანხა'),
      h('p', { class: 'hero-v' }, h('span', { 'data-testid': 'S', 'data-value': v(heroVal) ?? '' }, undetermined ? '—' : fmt(heroVal, cur))),
      noRent && !undetermined ? h('p', { class: 'hero-n' }, 'ქირა არ არის მითითებული — ქირის ანაზღაურება არ შედის.') : null),
    why ? h('p', { class: 'muted small' }, why) : null,
    h('div', { class: 'rcards' },
      card('ქირის ანაზღაურება', noRent ? '—' : fmt(m.F, cur), noRent ? null : v(m.F), noRent ? 'ქირა არ არის მითითებული' : `თქვენი წილი ქირაში: ${fmt(m.uncoveredRent, cur)}`, 'F'),
      card('სწავლის ანაზღაურება', hasEdu ? fmt(ed.total, cur) : '—', hasEdu ? v(ed.total) : null, hasEdu ? `თქვენი წილი: ${fmt(ed.personal, cur)}` : 'სწავლის ხარჯი არ არის მითითებული', 'edu'),
      card('დარჩენილი თანხა ქირისა და სწავლის შემდეგ', noRent ? '—' : fmt(r?.remainder?.value, cur), noRent ? null : v(r?.remainder?.value), 'თვიურ თანხას + სწავლის ანაზღაურებას გამოკლებული ქირა და სწავლის გადასახადი; სხვა ხარჯები არ აკლდება.', 'remainder')),
    ot.length || caps.length ? h('section', { class: 'onetime' },
      ot.length ? [h('h3', null, 'ერთჯერადი'), h('ul', { class: 'olist' }, ot.map(([label, text, raw, sub]) => h('li', null,
        h('span', null, label, sub ? h('span', { class: 'small muted block' }, sub) : null), h('strong', { 'data-value': raw ?? '' }, text))))] : null,
      caps.length ? [h('h3', null, 'დაზღვევის წლიური ლიმიტი'), h('p', { class: 'small muted' }, 'ეს ლიმიტია — ანაზღაურდება პოლისის ფაქტიური ფასი ამ ზღვრამდე.'),
        h('ul', { class: 'olist' }, caps.map((p) => h('li', null, h('span', null, p.personId === 'EMP' ? 'თქვენ' : (p.label ?? p.personId)),
          h('strong', { 'data-value': v(p.annualCap) ?? '' }, v(p.annualCap) == null ? 'მიუთითეთ ასაკი' : fmt(p.annualCap, cur))))),
        v(r?.insurance?.perPerson?.[0]?.reimbursable) != null ? h('p', { class: 'small' }, `თქვენი პოლისიდან ანაზღაურდება: ${fmt(r.insurance.perPerson[0].reimbursable, cur)}`) : null] : null) : null,
    h('div', { class: 'actions no-print' }, detBtn, printBtn, cmpBtn),
    det,
  ];
}
