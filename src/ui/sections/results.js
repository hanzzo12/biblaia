// სექცია 5: შედეგი. ეკრანი და ბეჭდვა ერთსა და იმავე CalculationResult-ს იყენებს.
import { h, replace } from '../dom.js';
import { L, COMPLETENESS, COMP_STATUS, MONTHLY, PERCENT_IDS, MARKET_STATUS, RENT_METRICS_KA, INDEX_KA } from '../labels.js';
import * as core from '../../core/index.js';

const vOf = (x) => (x && typeof x === 'object' ? x.value ?? null : x ?? null);
const fmt = (v, cur) => { v = vOf(v); return v == null ? null : cur ? `${core.formatAmount(v)} ${cur}` : String(v); };

function catalogEntry(id) {
  const cat = core.ruleCatalog;
  if (!cat) return null;
  if (typeof cat === 'function') return cat(id);
  if (cat instanceof Map) return cat.get(id) ?? null;
  if (Array.isArray(cat)) return cat.find((r) => r.id === id) ?? null;
  return cat[id] ?? null;
}

function collectRuleIds(obj, out = new Set()) {
  if (Array.isArray(obj)) obj.forEach((x) => collectRuleIds(x, out));
  else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'ruleIds' && Array.isArray(v)) v.forEach((r) => out.add(r));
      else collectRuleIds(v, out);
    }
  }
  return out;
}

const statusBadge = (s) => (s ? h('span', { class: `badge cs-${s}`, 'data-status': s }, COMP_STATUS[s] ?? s) : null);
const rules = (ids) => (ids && ids.length ? h('span', { class: 'rule-ids' }, ids.join(', ')) : null);

/** Component → სტრიქონი */
export function compRow(c, label, cur) {
  if (c === null || c === undefined) return null;
  if (typeof c !== 'object') c = { id: '', value: String(c), currency: cur ?? null, status: null };
  const isPct = PERCENT_IDS.has(c.id) && !c.currency;
  const shown = c.value == null ? (c.status === 'not_applicable' ? 'არ ვრცელდება' : 'დაუდგენელი') : isPct ? `${c.value}%` : fmt(c.value, c.currency);
  return h('div', { class: `row cs-row-${c.status ?? 'none'}`, 'data-component': c.id },
    h('span', { class: 'row-label' }, label || c.label_ka || c.id),
    h('span', { class: 'row-value', 'data-value': c.value ?? '', 'data-exact': c.exact ?? '' }, shown),
    h('span', { class: 'row-meta' }, statusBadge(c.status), rules(c.ruleIds)),
    c.reason_ka ? h('span', { class: 'row-reason' }, c.reason_ka) : null);
}

const block = (id, title, ...children) => h('section', { class: 'res-block', 'aria-labelledby': id }, h('h3', { id }, title), ...children);
const empty = (t) => h('p', { class: 'hint' }, t);

export function mountResults(root, store, { marketSummary }) {
  const bar = h('div', { class: 'summary-bar', role: 'status', 'aria-live': 'polite', 'data-testid': 'summary-bar' });
  const jump = h('a', { href: '#results-title', class: 'summary-jump' }, 'შედეგი ↓');
  const barWrap = h('div', { class: 'summary-wrap no-print' }, bar, jump);
  const body = h('div', { class: 'results-body' });
  root.append(barWrap, body);
  let liveTimer = null;

  function render(result, calcError) {
    const r = result || {};
    const cur = r.currency;
    const m = r.monthly || {};
    const fieldErrors = Object.entries(store.errors);
    const missing = r.missingInputs || [];
    const link = (path, text) => {
      const id = store.ids[store.resolvePath ? store.resolvePath(path) : path];
      return id ? h('a', { href: '#' + id, on: { click: (e) => { e.preventDefault(); const el = document.getElementById(id); el?.closest('details')?.setAttribute('open', ''); el?.focus(); } } }, text) : text;
    };
    // მოკლე ზოლი (aria-live debounce)
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      bar.textContent = calcError ? 'გაანგარიშების შეცდომა' : `S: ${m.S?.value != null ? fmt(m.S.value, cur) : 'დაუდგენელი'} · ${COMPLETENESS[r.completeness] ?? '—'}`;
    }, 400);

    const ed = r.education || {};
    const ins = r.insurance?.perPerson || [];
    const otr = r.oneTimeReimbursements || {};
    const bag = otr.baggage;
    const ms = marketSummary();
    const ruleIds = [...collectRuleIds(r)].sort();
    const srcs = store.data.sourceReferences || [];

    replace(body,
      calcError ? h('div', { class: 'error-box', role: 'alert' }, 'გაანგარიშება ვერ შესრულდა: ', calcError) : null,
      h('div', { class: `completeness cp-${r.completeness ?? 'none'}`, 'data-testid': 'completeness', 'data-completeness': r.completeness ?? '' },
        h('strong', null, 'სისრულე: '), COMPLETENESS[r.completeness] ?? 'დაუდგენელი'),
      missing.length ? h('div', { class: 'missing' }, h('p', null, 'სრული შედეგისთვის საჭიროა:'),
        h('ul', null, missing.map((x) => h('li', null, link(x.path, x.message_ka || x.path))))) : null,
      fieldErrors.length ? h('div', { class: 'error-box', role: 'alert' }, h('p', null, 'შეასწორეთ ველები (არასწორი მნიშვნელობა გაანგარიშებაში უცნობად ითვლება):'),
        h('ul', null, fieldErrors.map(([path, msg]) => h('li', null, link(path, `${path}: ${msg}`))))) : null,

      block('res-monthly', '1. ' + L.S,
        h('div', { class: 'big', 'data-component': 'S-big' }, h('span', { 'data-value': m.S?.value ?? '', 'data-testid': 'S' }, m.S?.value != null ? fmt(m.S.value, cur) : 'დაუდგენელი'), ' ', statusBadge(m.S?.status)),
        h('details', { class: 'how', open: true }, h('summary', null, 'როგორ დაითვალა'),
          h('p', { class: 'formula' }, 'D = H × A × K × (1 + Q × C);  T = D × E;  S = D − T + F'),
          ['H', 'A', 'K', 'C', 'Q', 'D', 'E', 'T', 'DminusT', 'G', 'F', 'S', 'uncoveredRent', 'rentSurplus'].map((k) => compRow(m[k], MONTHLY[k]))),
        r.fx?.forecast?.illustrativeS_GEL ? compRow(r.fx.forecast.illustrativeS_GEL, 'S ლარში — მხოლოდ საილუსტრაციოდ, საპროგნოზო კურსით (არა დაფინანსების კურსი)', 'GEL') : null,
        (r.periodSegments || []).length ? h('div', { class: 'table-wrap' }, h('table', { class: 'segments' },
          h('caption', null, 'პერიოდის მონაკვეთები (სრული თვის განაკვეთი × დღეები / თვის დღეები)'),
          h('thead', null, h('tr', null, ['დან', 'მდე', 'დღე', 'C', 'G', 'სრული თვის S', 'მონაკვეთის თანხა'].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', null, r.periodSegments.map((s) => h('tr', null,
            h('td', null, s.from), h('td', null, s.to), h('td', null, `${s.days}/${s.daysInMonth}`),
            h('td', null, vOf(s.C) ?? '—'), h('td', null, fmt(s.G, cur) ?? '—'),
            h('td', null, s.fullMonth?.S?.value != null ? fmt(s.fullMonth.S.value, cur) : '—'),
            h('td', { 'data-value': s.prorated?.value ?? '' }, s.prorated?.value != null ? fmt(s.prorated.value, cur) : 'დაუდგენელი')))))) : null,
        r.periodTotal ? compRow(r.periodTotal, 'პერიოდის ჯამი') : null),

      block('res-reimb', '2. ხარჯების ანაზღაურება (ყოველთვიური)',
        (ed.perChild || []).length ? ed.perChild.map((c) => h('div', { class: 'sub' },
          h('h4', null, `განათლება — ${store.scenario.family.find((f) => f.id === c.memberId)?.label ?? c.memberId}`, c.eligible === false ? ' (არ ეკუთვნის)' : c.eligible == null ? ' (უფლება დაუდგენელია)' : ''),
          compRow(c.P, 'დასაშვები ხარჯი (P)', cur), compRow(c.L, 'ზღვარი (L)', cur), compRow(c.reimbursement, 'ანაზღაურება', cur), compRow(c.personalCost, 'საკუთარი წილი', cur),
          c.notes_ka ? h('p', { class: 'hint' }, c.notes_ka) : null))
          : empty('განათლების ხარჯი არ არის შეყვანილი.'),
        compRow(ed.expense, 'განათლების ხარჯი — ჯამი'), compRow(ed.total, 'განათლების ანაზღაურება — ჯამი'), compRow(ed.personal, 'განათლების საკუთარი ხარჯი — ჯამი'),
        ed.alternativePooled ? compRow(ed.alternativePooled, 'ალტერნატიული წაკითხვა: საერთო ზღვარი (OQ-02)') : null),

      block('res-remainder', '3. ' + L.remainder,
        r.remainder?.value ? [compRow(r.remainder.value, L.remainder),
          h('p', { class: 'formula' }, 'S + განათლების ანაზღაურება − G − განათლების ხარჯი' +
            (r.remainder.terms ? ` = ${['S', 'educationReimbursement', 'G', 'educationExpense'].map((k) => { const v = vOf(r.remainder.terms[k]); return v == null ? '?' : core.formatAmount(v); }).join(' / ')}` : ''))]
          : empty('დაუდგენელი.'),
        h('p', { class: 'hint' }, 'სხვა ყოველდღიური ხარჯები (კვება, კომუნალური და სხვ.) გამოკლებული არ არის. უარყოფითი ნაშთი ნაჩვენებია როგორც არის.')),

      block('res-onetime', '4. ერთჯერადი თანხები',
        h('h4', null, 'ერთჯერადი დახმარება'),
        compRow(r.oneTimeAllowances?.settlement, 'პირველადი მოწყობა') || empty('—'),
        r.oneTimeAllowances?.retention19?.status !== 'not_applicable' ? compRow(r.oneTimeAllowances?.retention19, 'თანხის შენარჩუნება შეჩერებისას (პ. 19)') : null,
        compRow(r.oneTimeAllowances?.vacationMonth, 'შვებულების ერთთვიანი თანხა (სცენარი; ჯამში არ ემატება)'),
        h('h4', null, 'ერთჯერადი ხარჯის ანაზღაურება'),
        compRow(otr.broker, 'მაკლერის მომსახურება'),
        bag && store.scenario.baggage ? h('div', { class: 'sub' }, h('h5', null, 'ბარგი'),
          (bag.perClaim || []).map((c, i) => compRow(c, c?.label_ka || `მოთხოვნა ${i + 1}`, cur)), compRow(bag.personalCost, 'საკუთარი ხარჯი', cur), compRow(bag.cap, 'ზღვარი', cur), compRow(bag.previouslyUsed, 'უკვე გამოყენებული', cur),
          compRow(bag.claimed, 'მოთხოვნილი', cur), compRow(bag.reimbursable, 'ასანაზღაურებელი', cur), compRow(bag.remainingCap, 'დარჩენილი ლიმიტი', cur)) : null,
        (otr.travel || []).map((c, i) => compRow(c, c.label_ka || `მგზავრობა ${i + 1}`)),
        (otr.extras || []).map((c, i) => compRow(c, c.label_ka || `სხვა ხარჯი ${i + 1}`)),
        r.totals ? h('div', { class: 'sub' }, h('h4', null, 'ჯამები'), compRow(r.totals.oneTimeConfirmed), compRow(r.totals.oneTimePending),
          (r.totals.undeterminedIds || []).length ? h('p', { class: 'hint' }, 'დაუდგენელი ჩანაწერები (ჯამში არ შედის): ' + r.totals.undeterminedIds.join(', ')) : null,
          (r.totals.otherCurrencyIds || []).length ? h('p', { class: 'hint' }, 'სხვა ვალუტის ჩანაწერები (არ შეიკრიბება): ' + r.totals.otherCurrencyIds.join(', ')) : null) : null,
        !otr.broker && !bag && !(otr.travel || []).length && !(otr.extras || []).length ? empty('ერთჯერადი ხარჯი არ არის შეყვანილი.') : null),

      block('res-caps', '5. წლიური ზღვრები (არ არის გასაცემი თანხა)',
        ins.length ? h('div', { class: 'table-wrap' }, h('table', null,
          h('thead', null, h('tr', null, ['პირი', 'ასაკობრივი ჯგუფი', 'წლიური ზღვარი', 'პოლისი', 'უკვე ანაზღ.', 'ასანაზღაურებელი', 'საკუთარი', 'სტატუსი'].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', null, ins.map((p) => {
            const cell = (x) => { const v = x?.value ?? (typeof x === 'string' ? x : null); return h('td', { 'data-value': v ?? '' }, v == null ? '—' : fmt(v, x?.currency ?? cur)); };
            return h('tr', null, h('td', null, p.personId === 'EMP' ? 'თანამშრომელი' : (store.scenario.family.find((f) => f.id === p.personId)?.label ?? p.personId)),
              h('td', null, p.band ?? 'დაუდგენელი'), cell(p.annualCap), cell(p.policyCost), cell(p.alreadyReimbursed), cell(p.reimbursable), cell(p.personalCost),
              h('td', null, statusBadge(p.status)));
          })))) : null,
        (r.annualCaps?.insurance || []).map((c) => compRow(c)),
        !ins.length && !(r.annualCaps?.insurance || []).length ? empty('—') : null),

      block('res-adv', '6. ავანსი და დასაბრუნებელი ვალდებულება',
        (r.advances || []).length ? r.advances.map((a, i) => h('div', { class: 'sub' }, h('h4', null, `ავანსი ${i + 1}`, ' ', statusBadge(a.status)),
          compRow(a.amount, 'ავანსის თანხა', cur), compRow(a.monthlyRepayment, 'ყოველთვიური დაფარვა', cur), compRow(a.limit, 'ზღვარი', cur),
          a.requiresMinisterOrder ? h('p', { class: 'warn' }, 'საჭიროებს მინისტრის ინდივიდუალურ აქტს.') : null,
          (a.schedule || []).length ? h('table', { class: 'schedule' }, h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'თვე'), h('th', { scope: 'col' }, 'დაფარვა'), h('th', { scope: 'col' }, 'დარჩენილი ვალდებულება'))),
            h('tbody', null, a.schedule.map((s) => h('tr', null, h('td', null, s.month), h('td', null, fmt(s.repayment, cur) ?? '—'), h('td', null, fmt(s.outstanding, cur) ?? '—'))))) : null,
          rules(a.ruleIds))) : empty('ავანსი არ არის შეყვანილი.'),
        h('p', { class: 'hint' }, 'ავანსი შემოსავალში და ანაზღაურების ჯამში არ შედის.')),

      block('res-market', '7. ბაზრის საინფორმაციო მაჩვენებლები',
        ms ? h('dl', { class: 'kv' },
          h('dt', null, `ქირა (${RENT_METRICS_KA[ms.metric]})`), h('dd', null, ms.rent ? `${core.formatAmount(ms.rent)} ${ms.currency ?? ''}` : '—', ' · ', MARKET_STATUS[ms.rentStatus] ?? ms.rentStatus ?? '—'),
          h('dt', null, INDEX_KA.costOfLivingExcludingRent), h('dd', null, ms.index ?? '—', ' · ', MARKET_STATUS[ms.indexStatus] ?? ms.indexStatus ?? '—'),
          h('dt', null, 'წყარო'), h('dd', null, ms.source ?? '—')) : empty('ქალაქი არ არის არჩეული.'),
        h('p', { class: 'hint' }, 'ოფიციალურ გაანგარიშებაზე (H, K, E) გავლენა არ აქვს.'),
        store.scenario.rent.basis === 'market-scenario' ? h('p', { class: 'warn', 'data-testid': 'market-scenario-note' }, 'სცენარი: ქირა (G) აღებულია საბაზრო შეფასებიდან და ფაქტობრივი ხელშეკრულება არ არის.') : null),

      block('res-notes', '8. გაფრთხილებები, ვარაუდები, წესები და წყაროები',
        (r.errors || []).length ? h('div', null, h('h4', null, 'შეცდომები'), h('ul', { class: 'errors', 'data-testid': 'result-errors' }, r.errors.map((w) => h('li', { 'data-code': w.code }, link(w.path, w.message_ka), ' ', rules(w.ruleIds))))) : null,
        (r.warnings || []).length ? h('div', null, h('h4', null, 'გაფრთხილებები და შენიშვნები'), h('ul', { class: 'warnings', 'data-testid': 'result-warnings' }, r.warnings.map((w) => h('li', { 'data-code': w.code, class: 'sev-' + (w.severity || 'warning') }, w.severity === 'info' ? 'ℹ ' : '⚠ ', link(w.path, w.message_ka), ' ', rules(w.ruleIds))))) : null,
        (r.assumptions || []).length ? h('div', null, h('h4', null, 'ვარაუდები და ინტერპრეტაციები'),
          h('ul', null, r.assumptions.map((a) => h('li', { 'data-code': a.code }, a.message_ka, a.openQuestion ? ` (${a.openQuestion})` : '', ' ', rules(a.ruleIds))))) : null,
        r.fx?.forecast ? h('p', { class: 'hint' }, `საპროგნოზო კურსი: 1 USD = ${r.fx.forecast.USD} GEL, 1 EUR = ${r.fx.forecast.EUR} GEL — ${r.fx.forecast.purpose_ka ?? ''}`) : null,
        h('p', { class: 'hint' }, 'დამრგვალება: ზუსტი გამოთვლა, ჩვენებისას 2 ათწილადამდე (half-up); ნაჩვენები ჯამი შესაკრებების მრგვალებული ჯამისგან შეიძლება 0.01-ით განსხვავდებოდეს (ტექნიკური პოლიტიკა, არა ნორმა).'),
        ruleIds.length ? h('div', null, h('h4', null, 'გამოყენებული წესები'),
          h('ul', { class: 'rules' }, ruleIds.map((id) => { const e = catalogEntry(id); return h('li', null, h('code', null, id), e ? ` — ${e.title_ka ?? e.title ?? ''}${e.source_ka || e.source ? ` (${e.source_ka ?? e.source})` : ''}` : ''); }))) : null,
        h('h4', null, 'წყაროები'),
        h('ul', { class: 'sources' }, srcs.map((s) => h('li', null, `${s.title}${s.pages ? `, გვ. ${s.pages.join('–')}` : ''}`))),
        h('p', { class: 'meta', 'data-testid': 'versions' }, `წესების ვერსია: ${r.rulesVersion ?? store.data.rulesVersion} · მონაცემების SHA-256: ${store.meta.dataSha} · აპის ვერსია: ${store.meta.appVersion} · აწყობა: ${store.meta.buildDate}`)));
  }

  return { render };
}
