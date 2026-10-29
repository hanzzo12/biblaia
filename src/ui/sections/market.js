// სექცია 1-ის ბაზრის ბლოკი: ქირა და ცხოვრების ღირებულების ინდექსი (საორიენტაციო; ოფიციალურ გაანგარიშებას არ ცვლის).
import { h, replace, uid } from '../dom.js';
import { L, MARKET_STATUS, MARKET_WARNINGS, MARKET_RETRYABLE, RENT_METRICS_KA, INDEX_KA, MATCH_KA } from '../labels.js';
import { createEmptyMarketData, marketDataFromManualRecords, validateManualRecord, RENT_METRICS, DEFAULT_RENT_METRIC } from '../../providers/market-contract.js';
import * as P from '../../providers/index.js';
import { snapshotFor } from '../snapshot.js';
const parseManualMarketJson = P.parseManualMarketJson;
import { formatAmount, parseDecimalInput } from '../../core/index.js';

const fmtTime = (iso) => (iso ? String(iso).replace('T', ' ').replace(/:\d\d(\.\d+)?Z$/, ' UTC').replace(/Z$/, ' UTC') : 'უცნობია');
const badge = (status) => h('span', { class: `badge st-${status}`, 'data-status': status }, MARKET_STATUS[status] ?? P.MARKET_STATUS_LABELS_KA?.[status] ?? status);
const warnText = (code) => MARKET_WARNINGS[code] ?? P.MARKET_WARNING_LABELS_KA?.[code] ?? code;
const baseKa = (l) => ({ 'New York City': 'ნიუ-იორკი', Brussels: 'ბრიუსელი', 'Brussels (BE)': 'ბრიუსელი' }[l] ?? l);
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

/**
 * @param {HTMLElement} root
 * @param {any} store
 * @param {{ online: boolean, client: any, fundingCurrency: () => string|null, onUseRent: (x:any) => void }} deps
 */
export function mountMarket(root, store, deps) {
  const m = store.market = store.market || { md: null, locationId: null, currency: null, seq: 0, ctrl: null, metric: DEFAULT_RENT_METRIC, manualRecords: [], confirm: false, importErrors: [], formErrors: [] };
  const box = h('div', { class: 'market', 'aria-live': 'polite', 'aria-busy': 'false', 'data-testid': 'market-block' });
  const manualBox = h('details', { class: 'market-manual' });
  root.append(box, manualBox);

  function locationRecord() { return (store.data.locations || []).find((l) => l.id === m.locationId) || null; }

  function shown() {
    const own = m.manualRecords.filter((r) => r.locationId === m.locationId);
    if (own.length) {
      try { return { md: marketDataFromManualRecords(m.locationId, own), manual: true }; } catch (e) { m.formErrors = ['ხელით შეყვანილი ჩანაწერები ერთმანეთს არ ეთავსება (ვალუტა/ბაზა).']; }
    }
    return { md: m.md, manual: false };
  }

  async function load(locationId, currency) {
    m.locationId = locationId; m.currency = currency; m.confirm = false;
    const seq = ++m.seq;
    if (m.ctrl) m.ctrl.abort();
    m.ctrl = null;
    if (!locationId) { m.md = null; render(); return; }
    if (!deps.online || !deps.client) {
      const snap = snapshotFor(locationId);
      m.snapshot = snap;
      m.md = snap ? snap.md : createEmptyMarketData(locationId, 'not_configured');
      render(); return;
    }
    m.snapshot = null;
    m.md = createEmptyMarketData(locationId, 'loading');
    render();
    const ctrl = new AbortController();
    m.ctrl = ctrl;
    let md;
    try { md = await deps.client.get(locationId, currency, { signal: ctrl.signal }); } catch { md = createEmptyMarketData(locationId, 'network_error'); }
    if (seq !== m.seq) return; // გვიან მოსული პასუხი წინა ქალაქისთვის — უგულებელყოფილია
    if (!md || md.requestedLocationId !== locationId || (md.currency && currency && md.currency !== currency)) md = createEmptyMarketData(locationId, 'wrong_city');
    m.md = md;
    render();
  }

  function useButton(md, item) {
    const fund = deps.fundingCurrency();
    let reason = null;
    if (!item || item.average == null) reason = 'საშუალო ქირა ხელმისაწვდომი არ არის.';
    else if (!fund) reason = 'აირჩიეთ დაწესებულება — საჭიროა დაფინანსების ვალუტა.';
    else if (md.currency !== fund) reason = `ქირის ვალუტა (${md.currency ?? '—'}) არ ემთხვევა დაფინანსების ვალუტას (${fund}); კონვერტაცია არ ხდება.`;
    else if (md.resolvedLocation?.matchStatus === 'country-level') reason = 'ქვეყნის დონის მონაცემი ქალაქის ქირად არ გამოიყენება.';
    const rid = uid('h');
    const btn = h('button', { type: 'button', class: 'btn', disabled: !!reason, 'aria-describedby': rid, 'data-testid': 'use-market-rent' }, L.useAsPlannedRent);
    const apply = () => {
      m.confirm = false;
      deps.onUseRent({ amount: item.average, marketRef: { locationId: md.requestedLocationId, providerId: item.source?.id ?? md.provider?.id ?? 'manual', metric: item.metric, fetchedAt: item.fetchedAt ?? null } });
      render();
    };
    btn.addEventListener('click', () => {
      const r = store.scenario.rent;
      if (r.amount != null && r.basis !== 'market-scenario') { m.confirm = true; render(); box.querySelector('[data-confirm-yes]')?.focus(); return; }
      apply();
    });
    const parts = [btn, h('p', { id: rid, class: 'hint' }, reason ?? 'გადაიტანს საშუალო ქირას ველში „ბინის ყოველთვიური ქირა (G)“ და გაანგარიშებას მონიშნავს სცენარად.')];
    if (m.confirm && !reason) {
      const yes = h('button', { type: 'button', class: 'btn', 'data-confirm-yes': '' }, 'დიახ, ჩავანაცვლო');
      const no = h('button', { type: 'button', class: 'btn secondary' }, 'გაუქმება');
      yes.addEventListener('click', apply);
      no.addEventListener('click', () => { m.confirm = false; render(); });
      parts.push(h('div', { class: 'confirm', role: 'alertdialog', 'aria-label': 'ქირის ჩანაცვლება' },
        h('p', null, `ველში უკვე შეყვანილია ქირა ${formatAmount(store.scenario.rent.amount)}. ჩავანაცვლო საბაზრო შეფასებით ${formatAmount(item.average)} ${md.currency}?`), yes, ' ', no));
    }
    return h('div', { class: 'use-rent' }, parts);
  }

  function render() {
    const loc = locationRecord();
    if (!m.locationId) { replace(box, h('h3', null, 'ქირა და ცხოვრების ღირებულება'), h('p', { class: 'hint' }, 'აირჩიეთ ქალაქი — აქვე გამოჩნდება საორიენტაციო ქირა და ინდექსი.')); renderManual(); return; }
    const { md, manual } = shown();
    box.setAttribute('aria-busy', md?.rent?.status === 'loading' ? 'true' : 'false');
    const items = md?.rent?.items || {};
    const metrics = Object.keys(RENT_METRICS).filter((k) => k === DEFAULT_RENT_METRIC || items[k]);
    if (!metrics.includes(m.metric)) m.metric = DEFAULT_RENT_METRIC;
    const item = items[m.metric] || null;
    const name = uid('r');
    const metricRadios = h('fieldset', { class: 'radios inline' }, h('legend', null, 'ქირის ტიპი'),
      metrics.map((k) => {
        const id = uid('f');
        const inp = h('input', { id, type: 'radio', name, value: k, checked: k === m.metric });
        inp.addEventListener('change', () => { m.metric = k; m.confirm = false; render(); box.querySelector(`input[value="${k}"]`)?.focus(); });
        return h('div', { class: 'radio' }, inp, h('label', { for: id }, RENT_METRICS_KA[k]));
      }));
    const ind = md?.indices;
    const occ = ind?.officialCorrectionCoefficient && (ind.officialCorrectionCoefficient.value != null || ind.officialCorrectionCoefficient.status !== 'not_configured') ? ind.officialCorrectionCoefficient : null;
    const isEurostat = md?.provider?.id === 'eurostat' || (occ && occ.value != null);
    let links = [];
    try { links = typeof P.externalCityLinks === 'function' ? (P.externalCityLinks(loc) || []) : []; } catch { links = []; }
    const provider = md?.provider;
    const src = item?.source || provider;
    const srcView = (s) => s ? h('span', null, s.name, s.sourceUrl ? [' — ', h('a', { href: s.sourceUrl, rel: 'noopener noreferrer', target: '_blank' }, s.sourceUrl)] : null, s.attribution ? ` (${s.attribution})` : null) : 'უცნობია';
    const retry = deps.online && !manual && (MARKET_RETRYABLE.has(md?.rent?.status) || MARKET_RETRYABLE.has(ind?.status));
    const retryBtn = retry ? h('button', { type: 'button', class: 'btn secondary' }, 'ხელახლა ცდა') : null;
    if (retryBtn) retryBtn.addEventListener('click', () => load(m.locationId, m.currency));
    const status = md?.rent?.status ?? 'not_configured';
    replace(box,
      h('h3', null, 'ქირა და ცხოვრების ღირებულება (საორიენტაციო)'),
      !deps.online ? h('p', { class: 'note', 'data-testid': 'offline-note' }, 'ოფლაინ ფაილი: ბაზრის მონაცემი ქსელიდან არ ითხოვება (ფაილი სერვერის გარეშე მუშაობს). გამოიყენება მხოლოდ ჩაშენებული დათარიღებული ასლი (თუ არის), ხელით შეყვანა ან JSON ფაილი (ქვემოთ). ონლაინ ვერსიაში ცხოვრების ღირებულების კოეფიციენტი მოდის Eurostat-იდან.') : null,
      manual ? h('p', { class: 'note' }, 'ნაჩვენებია ხელით შეყვანილი / იმპორტირებული მონაცემი.') : null,
      !manual && m.snapshot ? h('p', { class: 'note', 'data-testid': 'snapshot-note' }, `შენახული ასლი, თარიღი: ${m.snapshot.date ? fmtTime(m.snapshot.date) : 'უცნობია'} — არ არის მიმდინარე (live) მონაცემი.`) : null,
      loc?.marketFallbackNote ? h('p', { class: 'warn' }, loc.marketFallbackNote) : null,
      md?.resolvedLocation?.city ? h('p', { class: 'hint' }, `პროვაიდერის ქალაქი: ${md.resolvedLocation.city} — ${MATCH_KA[md.resolvedLocation.matchStatus] ?? md.resolvedLocation.matchStatus}`, md.resolvedLocation.note ? `. ${md.resolvedLocation.note}` : '') : null,
      h('div', { class: 'market-grid' },
        h('section', { class: 'market-rent', 'aria-label': 'ქირა' },
          h('h4', null, 'ქირა ', badge(item?.status && status !== 'loading' ? item.status : status)),
          metricRadios,
          h('p', { class: 'hint' }, 'ცენტრში ბინის საშუალო საორიენტაციო ქირა. ბინის ხარისხი, ფართობი, ავეჯი და უბანი განსხვავდება; სტატისტიკური საშუალო „საშუალო ხარისხს“ არ უზრუნველყოფს.'),
          h('dl', { class: 'kv' },
            h('dt', null, 'საშუალო თვიური ქირა'), h('dd', { 'data-testid': 'market-rent-average', 'data-value': item?.average ?? '' }, item?.average != null ? `${formatAmount(item.average)} ${md.currency ?? ''}` : '—'),
            h('dt', null, 'პროვაიდერის დიაპაზონი'), h('dd', null, item?.low != null || item?.high != null ? `${item.low != null ? formatAmount(item.low) : '—'} – ${item.high != null ? formatAmount(item.high) : '—'} ${md.currency ?? ''}` : '—'),
            item?.dataPoints != null ? [h('dt', null, 'მონაცემთა წერტილები'), h('dd', null, String(item.dataPoints))] : null,
            h('dt', null, 'მონაცემის განახლება (წყაროში)'), h('dd', null, item?.sourceUpdatedAt ?? 'უცნობია'),
            h('dt', null, 'მიღების დრო'), h('dd', null, fmtTime(item?.fetchedAt)),
            h('dt', null, 'წყარო'), h('dd', null, srcView(src))),
          useButton(md, item)),
        h('section', { class: 'market-index', 'aria-label': 'ცხოვრების ღირებულების ინდექსი' },
          h('h4', null, 'ცხოვრების ღირებულება ', badge(ind?.status ?? status)),
          occ ? h('div', { class: 'occ', 'data-testid': 'occ' },
            h('dl', { class: 'kv' },
              h('dt', null, 'ოფიციალური კორექტირების კოეფიციენტი (Eurostat)'), h('dd', { 'data-value': occ.value ?? '' }, occ.value ?? '—', ' ', badge(occ.status)),
              h('dt', null, 'შედარების ბაზა'), h('dd', null, occ.baseline ? `${baseKa(occ.baseline.label)} = ${occ.baseline.value}` : '—'),
              h('dt', null, 'პერიოდი'), h('dd', null, occ.period ?? 'უცნობია'),
              occ.dataset ? [h('dt', null, 'მონაცემთა ნაკრები'), h('dd', null, occ.dataset)] : null,
              h('dt', null, 'მიღების დრო'), h('dd', null, fmtTime(occ.fetchedAt))),
            h('p', { class: 'hint' }, 'ევროკავშირის მოსამსახურეთა ანაზღაურების კორექტირების კოეფიციენტი (ბრიუსელი = 100). ეს არ არის ქირა და არ ცვლის ბრძანების K-ს.')) : null,
          h('dl', { class: 'kv' },
            Object.keys(INDEX_KA).map((k) => (occ && ind?.[k] == null ? null : [h('dt', null, INDEX_KA[k]), h('dd', { 'data-testid': `index-${k}` }, ind?.[k] ?? '—')])),
            occ && !ind?.baseline ? null : [h('dt', null, 'შედარების ბაზა'), h('dd', null, ind?.baseline ? `${baseKa(ind.baseline.label)} = ${ind.baseline.value}` : '—')],
            h('dt', null, 'მონაცემის განახლება (წყაროში)'), h('dd', null, ind?.sourceUpdatedAt ?? 'უცნობია'),
            h('dt', null, 'მიღების დრო'), h('dd', null, fmtTime(ind?.fetchedAt)),
            h('dt', null, 'წყარო'), h('dd', null, srcView(ind?.source || provider))),
          h('p', { class: 'hint' }, 'ინდექსი ფულადი თანხა არ არის, თვიურ ხარჯად არ ჩანს და ბრძანების K-ს არ ცვლის.'))),
      md?.cache?.expiresAt ? h('p', { class: 'hint' }, `შენახული ასლის ვადა: ${fmtTime(md.cache.expiresAt)}`) : null,
      (md?.warnings || []).length ? h('ul', { class: 'warnings' }, md.warnings.map((w) => h('li', null, warnText(w.code)))) : null,
      isEurostat ? h('p', { class: 'hint', 'data-testid': 'eurostat-attribution' },
        md?.provider?.attribution || 'წყარო: Eurostat (© European Union), CC BY 4.0.',
        ' Eurostat პასუხისმგებელი არ არის ამ გვერდზე მონაცემის გამოყენებასა და ინტერპრეტაციაზე. კოეფიციენტი საორიენტაციოა.') : null,
      links.length ? h('div', { class: 'ext-links' }, h('p', { class: 'hint' }, 'გარე ბმული — მონაცემი არ იტვირთება:'),
        h('ul', null, links.map((l) => h('li', null, h('a', { href: l.url ?? l.href, rel: 'noopener noreferrer', target: '_blank' }, l.label_ka ?? l.label ?? l.name ?? (l.url ?? l.href)))))) : null,
      retryBtn);
    renderManual();
  }

  // ---- ხელით შეყვანა და JSON იმპორტი ----
  const form = { metric: 'rent:centre_1br', value: '', low: '', high: '', currency: '', sourceName: '', sourceUrl: '', sourceDate: '', baseLabel: 'New York City', baseValue: '100' };
  function renderManual() {
    const fid = (k) => `mm-${k}`;
    const inp = (k, label, attrs = {}) => {
      const el = h('input', { id: fid(k), type: 'text', value: form[k], autocomplete: 'off', ...attrs });
      el.addEventListener('input', () => { form[k] = el.value; });
      return h('div', { class: 'field' }, h('label', { for: fid(k) }, label), el);
    };
    const isRent = form.metric.startsWith('rent:');
    const metricSel = h('select', { id: fid('metric') },
      Object.keys(RENT_METRICS).map((k) => h('option', { value: 'rent:' + k, selected: form.metric === 'rent:' + k }, 'ქირა: ' + RENT_METRICS_KA[k])),
      Object.keys(INDEX_KA).map((k) => h('option', { value: 'index:' + k, selected: form.metric === 'index:' + k }, INDEX_KA[k])));
    metricSel.addEventListener('change', () => { form.metric = metricSel.value; renderManual(); document.getElementById(fid('metric'))?.focus(); });
    const curSel = h('select', { id: fid('currency') }, ['EUR', 'USD'].map((c) => h('option', { value: c, selected: (form.currency || deps.fundingCurrency() || 'EUR') === c }, c)));
    curSel.addEventListener('change', () => { form.currency = curSel.value; });
    const add = h('button', { type: 'button', class: 'btn' }, 'ჩანაწერის დამატება');
    add.addEventListener('click', () => addManual());
    const file = h('input', { id: fid('file'), type: 'file', accept: '.json,application/json' });
    file.addEventListener('change', () => importFile(file));
    const own = m.manualRecords;
    replace(manualBox,
      h('summary', null, 'ხელით შეყვანა / JSON იმპორტი'),
      m.locationId ? null : h('p', { class: 'hint' }, 'ჯერ აირჩიეთ ქალაქი.'),
      h('div', { class: 'grid3' },
        h('div', { class: 'field' }, h('label', { for: fid('metric') }, 'მაჩვენებელი'), metricSel),
        inp('value', isRent ? 'საშუალო თვიური თანხა' : 'ინდექსის მნიშვნელობა', { inputmode: 'decimal' }),
        isRent ? h('div', { class: 'field' }, h('label', { for: fid('currency') }, 'ვალუტა'), curSel) : null,
        isRent ? inp('low', 'დიაპაზონი — ქვედა (არასავალდებულო)', { inputmode: 'decimal' }) : null,
        isRent ? inp('high', 'დიაპაზონი — ზედა (არასავალდებულო)', { inputmode: 'decimal' }) : null,
        !isRent ? inp('baseLabel', 'შედარების ბაზა (ქალაქი)') : null,
        !isRent ? inp('baseValue', 'ბაზის მნიშვნელობა') : null,
        inp('sourceName', 'წყაროს დასახელება *'),
        inp('sourceUrl', 'წყაროს URL (არასავალდებულო)', { inputmode: 'url' }),
        inp('sourceDate', 'წყაროს თარიღი: წწწწ ან წწწწ-თთ ან წწწწ-თთ-დდ (თუ ცნობილია)')),
      add,
      m.formErrors.length ? h('ul', { class: 'errors', role: 'alert' }, m.formErrors.map((e) => h('li', null, e))) : null,
      h('div', { class: 'field' }, h('label', { for: fid('file') }, 'JSON ფაილის იმპორტი (kind: "market-import")'), file),
      m.importErrors.length ? h('ul', { class: 'errors', role: 'alert' }, m.importErrors.slice(0, 10).map((e) => h('li', null, e))) : null,
      own.length ? h('ul', { class: 'manual-list' }, own.map((r, i) => {
        const del = h('button', { type: 'button', class: 'btn small secondary', 'aria-label': `ჩანაწერის წაშლა: ${r.city}, ${r.metric}` }, 'წაშლა');
        del.addEventListener('click', () => { m.manualRecords.splice(i, 1); render(); });
        return h('li', null, `${r.city} — ${RENT_METRICS_KA[r.metric] ?? INDEX_KA[r.metric] ?? r.metric}: ${r.value}${r.currency ? ' ' + r.currency : ''} · ${r.source.name}${r.sourceDate ? ' (' + r.sourceDate + ')' : ''} · ${r.origin === 'json-import' ? 'JSON იმპორტი' : 'ხელით'} `, del);
      })) : null);
  }

  function addManual() {
    m.formErrors = [];
    const loc = locationRecord();
    if (!loc) { m.formErrors = ['ჯერ აირჩიეთ ქალაქი.']; renderManual(); return; }
    const [type, metric] = form.metric.split(':');
    const dec = (s, label, optional) => {
      if (optional && String(s).trim() === '') return null;
      const r = parseDecimalInput(String(s));
      if (!r.ok || r.normalized === null) { m.formErrors.push(`${label}: ${r.error_ka ?? 'სავალდებულოა.'}`); return null; }
      return r.normalized;
    };
    const rec = {
      kind: 'manual-market-record', schemaVersion: 1, origin: 'manual', locationId: loc.id, city: loc.name_ka, countryCode: loc.countryId,
      metricType: type, metric, value: dec(form.value, 'მნიშვნელობა'), currency: type === 'rent' ? (form.currency || deps.fundingCurrency() || 'EUR') : null,
      source: { name: form.sourceName.trim(), url: form.sourceUrl.trim() || null }, sourceDate: form.sourceDate.trim() || null, enteredAt: nowIso(),
    };
    if (type === 'rent') { rec.low = dec(form.low, 'დიაპაზონი — ქვედა', true); rec.high = dec(form.high, 'დიაპაზონი — ზედა', true); }
    else rec.baseline = { label: form.baseLabel.trim(), value: dec(form.baseValue, 'ბაზის მნიშვნელობა') };
    if (!rec.source.name) m.formErrors.push('წყაროს დასახელება სავალდებულოა.');
    if (!m.formErrors.length) {
      const v = validateManualRecord(rec, { allowedCurrencies: ['EUR', 'USD'] });
      if (!v.ok) m.formErrors.push(...v.errors.map((e) => 'არასწორი ველი: ' + e));
    }
    if (!m.formErrors.length) {
      const other = m.manualRecords.filter((r) => r.locationId === loc.id && r.metricType === 'rent' && type === 'rent' && r.currency !== rec.currency);
      if (other.length) m.formErrors.push('ერთი ქალაქისთვის ქირის ჩანაწერები ერთ ვალუტაში უნდა იყოს.');
    }
    if (!m.formErrors.length) {
      m.manualRecords = m.manualRecords.filter((r) => !(r.locationId === loc.id && r.metricType === type && r.metric === metric));
      m.manualRecords.push(rec);
      Object.assign(form, { value: '', low: '', high: '' });
    }
    render();
  }

  async function importFile(input) {
    m.importErrors = [];
    const f = input.files && input.files[0];
    if (!f) return;
    if (f.size > 256 * 1024) { m.importErrors = ['ფაილი ძალიან დიდია (მაქს. 256 KB).']; render(); return; }
    const res = parseManualMarketJson(await f.text(), { allowedCurrencies: ['EUR', 'USD'] });
    if (!res.ok) { m.importErrors = ['იმპორტი უარყოფილია:', ...res.errors.map((e) => `${e.path}: ${e.message_ka}`)]; render(); input.value = ''; return; }
    const obj = res.data;
    const keys = new Set(obj.records.map((r) => `${r.locationId}|${r.metricType}|${r.metric}`));
    m.manualRecords = m.manualRecords.filter((r) => !keys.has(`${r.locationId}|${r.metricType}|${r.metric}`)).concat(obj.records);
    m.importErrors = [`იმპორტირებულია ${obj.records.length} ჩანაწერი.`];
    input.value = '';
    render();
  }

  render();
  return { load, render, setRecords(recs) { m.manualRecords = recs; render(); } };
}
