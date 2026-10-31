// საფეხური 4: მთავარი — დარჩენილი თანხა ქირისა და სწავლის შემდეგ; დანარჩენი — ბარათებად; დეტალები ერთი ღილაკით.
import { h, uid } from './dom.js';
import * as core from '../core/index.js';

export const v = (c) => (c && typeof c === 'object' ? c.value ?? null : c ?? null);
export const fmt = (c, cur) => { const x = v(c); return x == null ? '—' : `${core.formatAmount(x)} ${cur ?? ''}`.trim(); };
export const ROLE_KA = { spouse: 'მეუღლე', child: 'შვილი', guardianship: 'მეურვეობის ქვეშ მყოფი' };

/** ეკრანისა და PDF-ის საერთო მოდელი (ერთი წყარო — ციფრები არ აცდება ერთმანეთს). */
export function resultModel({ r, st, sc, mission, data, personName }) {
  const cur = r?.currency ?? mission?.fundingCurrency ?? '';
  const m = r?.monthly || {};
  const ed = r?.education || {};
  const noRent = sc.rent.amount == null;
  const hasEdu = (sc.education || []).length > 0;
  const undetermined = v(m.DminusT) == null;
  const why = undetermined ? (v(m.K) == null ? 'ამ დაწესებულებისთვის კოეფიციენტი (K) ნორმატიულ დანართებში არ არის — თანხა ვერ დადგინდება.' : (m.S?.reason_ka || 'თანხა ვერ დადგინდა.')) : null;
  const pos = core.positionProfiles(data).find((p) => p.id === 'annex2')?.entries.find((e) => e.id === st.entryId);
  const otr = r?.oneTimeReimbursements || {};
  const ot = [];
  if (st.ex.settlement) {
    const s = r?.oneTimeAllowances?.settlement;
    const iu = s?.inputsUsed || {};
    const rate = iu.dailyRate && typeof iu.dailyRate === 'object' ? iu.dailyRate.amount : iu.dailyRate;
    const rateCur = iu.dailyRateCurrency ?? (iu.dailyRate && typeof iu.dailyRate === 'object' ? iu.dailyRate.currency : null) ?? s?.currency;
    ot.push({ label: 'პირველადი მოწყობა', value: v(s) == null ? 'ნორმა ვერ მოიძებნა' : fmt(s, s.currency ?? cur), raw: v(s),
      sub: v(s) != null && rate != null ? `${core.formatAmount(rate)} ${rateCur} × 60 × (1 + 10% × ${iu.n ?? 0})` : null });
  }
  if (st.ex.baggage) {
    const b = otr.baggage; const claimed = (sc.baggage?.claims || []).length > 0;
    ot.push({ label: 'ბარგის გადაზიდვა', value: claimed ? fmt(b?.reimbursable, cur) : `მაქს. ${fmt(b?.cap, cur)}`, raw: claimed ? v(b?.reimbursable) : v(b?.cap),
      sub: claimed ? `ლიმიტი ${fmt(b?.cap, cur)}` : 'ანაზღაურდება ფაქტიური ხარჯი ლიმიტამდე' });
  }
  if (st.ex.broker) ot.push({ label: 'მაკლერის მომსახურება', value: sc.broker ? fmt(otr.broker, cur) : 'მიუთითეთ საკომისიო', raw: v(otr.broker),
    sub: sc.broker ? `${st.head ? '80%' : '50%'} საკომისიოსი, მაქს. ერთი თვის ქირა` : null });
  const ins = st.ex.insurance ? (r?.insurance?.perPerson || []).map((p) => ({ name: personName(p.personId), cap: v(p.annualCap), reimb: v(p.reimbursable), entered: p.policyCost != null && v(p.policyCost) != null })) : [];
  const sum = (xs) => { const ok = xs.filter((x) => x != null); return ok.length === xs.length && ok.length ? (ok.reduce((a, b) => a + Math.round(Number(b) * 100), 0) / 100).toFixed(2) : null; };
  return {
    cur, noRent, hasEdu, undetermined, why, m, ed, ot, ins,
    insCapTotal: sum(ins.map((p) => p.cap)), insReimbTotal: ins.some((p) => p.entered) ? sum(ins.filter((p) => p.entered).map((p) => p.reimb)) : null,
    hero: noRent ? null : v(r?.remainder?.value),
    S: noRent ? v(m.DminusT) : v(m.S),
    rows: [['H', 'საბაზისო თანხა', m.H, true], ['A', 'თანამდებობის პროცენტი', m.A, false, '%'], ['K', 'ქვეყნის კოეფიციენტი', m.K], ['C', 'ოჯახის წევრები (დანამატით)', m.C],
      ['D', 'პერსონალური თანხა', m.D, true], ['E', 'ბინის წილი', m.E, false, '%'], ['T', 'ბინის წილი თანხაში', m.T, true],
      ['G', 'ქირა', m.G, true], ['F', 'ქირის ანაზღაურება', m.F, true], ['S', 'ყოველთვიური თანხა (D − T + F)', m.S, true]]
      .map(([k, label, c, money, suf]) => ({ k, label, raw: v(c), text: v(c) == null ? '—' : money ? fmt(c, cur) : `${v(c)}${suf ?? ''}` })),
    inputs: [
      ['დაწესებულება', mission ? `${mission.location_ka} — ${mission.shortName}` : '—'],
      ['თანამდებობა', pos ? `${pos.positions_ka?.join(' / ') ?? pos.title_ka} (${pos.percent}%)` : '—'],
      ['ხელმძღვანელი', st.head ? 'დიახ' : 'არა'],
      ['ოჯახი', st.family.length ? st.family.map((f) => `${ROLE_KA[f.role]}${f.ageRaw ? ` (${f.ageRaw})` : ''}`).join(', ') : 'არა'],
      ['ქირა თვეში', sc.rent.amount != null ? fmt(sc.rent.amount, cur) + (st.rentFromMarket ? ' (Numbeo-ს საშუალო)' : '') : 'არ არის მითითებული'],
      ['სკოლა/ბაღი თვეში', hasEdu ? sc.education.map((e) => fmt(e.tuition, cur)).join(', ') : '—'],
    ],
  };
}

function card(label, value, raw, sub, testid, big = false) {
  return h('div', { class: 'rcard' + (big ? ' big' : ''), 'data-testid': testid ?? null },
    h('span', { class: 'rc-label' }, label),
    h('span', { class: 'rc-value' + (raw != null && String(raw).startsWith('-') ? ' neg' : ''), 'data-value': raw ?? '' }, value),
    sub ? h('span', { class: 'rc-sub' }, sub) : null);
}

export function renderResult(M, { onPdf, onPrint, onCompare }) {
  const { cur, m, ed } = M;
  const detId = uid('det');
  const det = h('div', { id: detId, class: 'details', hidden: true },
    h('table', { class: 'calc' }, h('tbody', null, M.rows.map((x) => h('tr', { 'data-component': x.k },
      h('th', { scope: 'row' }, h('span', { class: 'sym' }, x.k), ' ', x.label), h('td', { 'data-value': x.raw ?? '' }, x.text))))),
    h('p', { class: 'formula' }, 'D = H × A × K × (1 + 7% × C) · T = D × E · S = D − T + F'),
    M.hasEdu ? h('p', { class: 'small' }, `სწავლა: ანაზღაურდება თვეში ${cur === 'USD' ? '750 USD' : '690 EUR'}-მდე სრულად, ზედმეტის 80%.`) : null,
    h('p', { class: 'tiny muted' }, 'თანხები ითვლება ზუსტად და მრგვალდება 2 ათწილადამდე.'));
  const detBtn = h('button', { type: 'button', class: 'btn ghost', 'aria-expanded': 'false', 'aria-controls': detId, 'data-testid': 'how' }, 'როგორ დაითვალა');
  detBtn.addEventListener('click', () => { det.hidden = !det.hidden; detBtn.setAttribute('aria-expanded', String(!det.hidden)); });
  const pdfBtn = h('button', { type: 'button', class: 'btn', 'data-testid': 'pdf-download' }, 'PDF ჩამოტვირთვა');
  pdfBtn.addEventListener('click', () => onPdf(pdfBtn));
  const printBtn = h('button', { type: 'button', class: 'btn ghost', 'data-testid': 'print' }, 'ბეჭდვა');
  printBtn.addEventListener('click', onPrint);
  const cmpBtn = h('button', { type: 'button', class: 'btn ghost', 'data-testid': 'compare-open' }, 'შედარება');
  cmpBtn.addEventListener('click', onCompare);

  return [
    h('h2', { tabindex: '-1' }, 'შედეგი'),
    h('div', { class: 'print-only' }, h('table', { class: 'inputs' }, h('tbody', null, M.inputs.map(([k, x]) => h('tr', null, h('th', { scope: 'row' }, k), h('td', null, x)))))),
    h('div', { class: 'hero', 'aria-live': 'polite' },
      h('p', { class: 'hero-l' }, 'დარჩენილი თანხა ქირისა და სწავლის შემდეგ'),
      M.noRent
        ? h('p', { class: 'hero-msg', 'data-testid': 'hero-remainder', 'data-value': '' }, 'მიუთითეთ ქირა, რომ დარჩენილი თანხა გამოჩნდეს')
        : h('p', { class: 'hero-v' }, h('span', { 'data-testid': 'hero-remainder', 'data-value': M.hero ?? '' }, M.hero == null ? '—' : `${core.formatAmount(M.hero)} ${cur}`), h('span', { class: 'per' }, ' / თვე')),
      h('p', { class: 'hero-n' }, M.noRent ? '' : 'სხვა ხარჯები (კვება, კომუნალური…) არ აკლდება.')),
    M.why ? h('p', { class: 'muted small' }, M.why) : null,
    h('div', { class: 'rcards' },
      card(M.noRent ? 'ყოველთვიური სამივლინებო თანხა (ქირის გარეშე)' : 'ყოველთვიური სამივლინებო თანხა', M.S == null ? '—' : `${core.formatAmount(M.S)} ${cur}`, M.S, M.noRent ? 'ქირის ანაზღაურება არ შედის' : 'ქირის ანაზღაურების ჩათვლით', 'S-card', true),
      card('ქირის ანაზღაურება', M.noRent ? '—' : fmt(m.F, cur), M.noRent ? null : v(m.F), M.noRent ? 'ქირა არ არის მითითებული' : `თქვენი წილი ქირაში: ${fmt(m.uncoveredRent, cur)}`, 'F'),
      card('სწავლის ანაზღაურება', M.hasEdu ? fmt(ed.total, cur) : '—', M.hasEdu ? v(ed.total) : null, M.hasEdu ? `თქვენი წილი: ${fmt(ed.personal, cur)}` : 'სწავლის ხარჯი არ არის მითითებული', 'edu')),
    h('span', { hidden: true, 'data-testid': 'S', 'data-value': M.S ?? '' }),
    M.ot.length || M.ins.length ? h('section', { class: 'onetime' },
      M.ot.length ? [h('h3', null, 'ერთჯერადი'), h('ul', { class: 'olist' }, M.ot.map((x) => h('li', null,
        h('span', null, x.label, x.sub ? h('span', { class: 'small muted block' }, x.sub) : null), h('strong', { 'data-value': x.raw ?? '' }, x.value))))] : null,
      M.ins.length ? [h('h3', null, 'დაზღვევა — წლიური ლიმიტი (მაქსიმუმი, არა გასაცემი თანხა)'),
        h('ul', { class: 'olist' }, M.ins.map((p) => h('li', null, h('span', null, p.name, p.entered ? h('span', { class: 'small muted block' }, `ანაზღაურდება: ${p.reimb == null ? '—' : core.formatAmount(p.reimb) + ' ' + cur}`) : null),
          h('strong', { 'data-value': p.cap ?? '' }, p.cap == null ? 'მიუთითეთ ასაკი' : `${core.formatAmount(p.cap)} ${cur} / წელი`))),
        h('li', { class: 'total' }, h('span', null, 'ოჯახის ჯამური წლიური ლიმიტი'), h('strong', null, M.insCapTotal == null ? '—' : `${core.formatAmount(M.insCapTotal)} ${cur} / წელი`)),
        M.insReimbTotal != null ? h('li', { class: 'total' }, h('span', null, 'ანაზღაურდება სულ (შეყვანილი პოლისებით)'), h('strong', null, `${core.formatAmount(M.insReimbTotal)} ${cur}`)) : null)] : null) : null,
    h('div', { class: 'actions no-print' }, pdfBtn, printBtn, detBtn, cmpBtn),
    det,
  ];
}
