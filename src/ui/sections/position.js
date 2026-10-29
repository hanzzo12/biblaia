// სექცია 2: რეჟიმი, თანამდებობა, სპეციალური სტატუსი, თანამშრომლის ასაკი, პერიოდი.
import { h, replace } from '../dom.js';
import { L, HEAD_BASIS } from '../labels.js';
import * as F from '../fields.js';
import * as core from '../../core/index.js';

export const currentMonth = () => new Date().toISOString().slice(0, 7);

export function mountPosition(root, store) {
  const box = h('div');
  root.append(box);
  const profiles = () => (core.positionProfiles ? core.positionProfiles(store.data) : store.data.positionProfiles);

  function suggestion(entry) {
    const s = entry?.suggestedRentHead;
    if (s === 'head') return { value: 'head', text: 'შემოთავაზებულია თანამდებობის მიხედვით: დაწესებულების ხელმძღვანელი. შეცვლადია.' };
    if (s === 'head-consular') return { value: 'head', text: 'საკონსულო დაწესებულების ხელმძღვანელი: მაკლერის 80% — პ. 8; ქირის 80% — სცენარის სტატუსით (ღია საკითხი OQ-10).' };
    if (s === 'not-head') return { value: 'not-head', text: 'შემოთავაზებულია თანამდებობის მიხედვით: არ არის ხელმძღვანელი. შეცვლადია (მაგ. პ. 20¹).' };
    return null;
  }

  function render() {
    const sc = store.scenario;
    const prof = profiles().find((p) => p.id === sc.position.mode) || profiles()[0];
    const entries = prof?.entries || [];
    const entry = entries.find((e) => e.id === sc.position.entryId) || null;
    const sug = suggestion(entry);
    const dates = sc.period.mode === 'dates';
    replace(box,
      F.radios(store, 'position.mode', L.mode, [
        { value: 'annex2', label: L.annex2, hint: '— საზღვარგარეთ როტაციით მივლინებული მოსამსახურე' },
        { value: 'annex3', label: L.annex3, hint: '— ცენტრალური აპარატის მოსამსახურე (ბრძანების პ. 37–39-ის პირობებით)' },
      ], { onChange: (mode) => {
        const old = entry?.positions_ka?.[0];
        const next = profiles().find((p) => p.id === mode)?.entries.find((e) => e.positions_ka?.includes(old));
        sc.position.entryId = next ? next.id : null;
        store.ui.notice = old && !next ? `თანამდებობა „${old}“ არჩეულ რეჟიმში არ არის — აირჩიეთ ხელახლა.` : null;
        render(); store.schedule();
        box.querySelector('input[type=radio]:checked')?.focus();
      } }),
      store.ui.notice ? h('p', { class: 'warn', role: 'status' }, store.ui.notice) : null,
      sc.position.mode === 'annex3' ? F.text(store, 'position.orderRef37', 'დანართი №3-ის გამოყენების საფუძველი — აქტის რეკვიზიტები (ბრძანების პ. 37)', { wide: true, hint: 'აქტის გარეშე დანართი №3-ის გამოყენება სცენარად ჩაითვლება.' }) : null,
      F.select(store, 'position.entryId', L.position,
        entries.map((e) => ({ value: e.id, label: `${e.title_ka} — ${e.percent}%` })),
        { wide: true, hint: prof ? `წყარო: ${prof.title_ka}` : '', onChange: (id) => {
          store.ui.notice = null;
          const e = entries.find((x) => x.id === id);
          const s = suggestion(e);
          if (s && !store.ui.rentHeadTouched) sc.status.rentHead = s.value;
          render(); store.schedule();
          document.getElementById(store.ids['position.entryId'])?.focus();
        } }),
      h('fieldset', { class: 'group' }, h('legend', null, 'სპეციალური სტატუსი'),
        F.radios(store, 'status.rentHead', L.rentHead, [
          { value: 'head', label: 'დიახ — ქირა 80% / 200%, მაკლერი 80%' },
          { value: 'not-head', label: 'არა — ქირა 50% / 100%, მაკლერი 50%' },
          { value: null, label: 'ჯერ უცნობია' },
        ], { inline: true, hint: (sug ? sug.text + ' ' : '') + 'ხელმძღვანელის სტატუსი თანამდებობის პროცენტით არ განისაზღვრება.', onChange: () => { store.ui.rentHeadTouched = true; } }),
        sc.status.rentHead === 'head' ? F.select(store, 'status.headBasis', 'ხელმძღვანელის სტატუსის საფუძველი',
          Object.entries(HEAD_BASIS).map(([value, label]) => ({ value, label }))) : null,
        F.check(store, 'status.actingHead201.applies', 'ხელმძღვანელის მოვალეობის შემსრულებელი (ბრძანების პ. 20¹)',
          { hint: 'A = ხელმძღვანელის მაჩვენებელი მხოლოდ მინისტრის აქტის მითითებით; ქირა/მაკლერი ხელმძღვანელის წესით — სცენარი (OQ-11).', onChange: () => render() }),
        sc.status.actingHead201.applies ? h('div', { class: 'grid3' }, F.text(store, 'status.actingHead201.actRef', 'აქტის რეკვიზიტები (პ. 20¹)'),
          F.date(store, 'status.actingHead201.from', 'მოვალეობის შესრულება — დან'), F.date(store, 'status.actingHead201.to', 'მოვალეობის შესრულება — მდე')) : null,
        F.check(store, 'status.adminManager202.applies', 'ადმინისტრაციული მენეჯერი სხვა დაწესებულებაში (ბრძანების პ. 20², 75%)',
          { hint: 'დანართი №2, სტრ. 3 — მოვალეობის შესრულების პერიოდში.', onChange: () => render() }),
        sc.status.adminManager202.applies ? h('div', { class: 'grid3' }, F.text(store, 'status.adminManager202.actRef', 'აქტის რეკვიზიტები (პ. 20²)'),
          F.date(store, 'status.adminManager202.from', 'მოვალეობის შესრულება — დან'), F.date(store, 'status.adminManager202.to', 'მოვალეობის შესრულება — მდე')) : null,
        F.toggle('თანხის შენარჩუნება შეჩერებისას (ბრძანების პ. 19)', !!sc.retention19?.applies, (on) => {
          sc.retention19 = on ? { applies: true, from: null, to: null, decisionRef: null } : null;
          store.forget('retention19'); render(); store.schedule();
        }),
        sc.retention19?.applies ? h('div', { class: 'grid3' },
          F.date(store, 'retention19.from', 'შენარჩუნება — დან'), F.date(store, 'retention19.to', 'შენარჩუნება — მდე'),
          F.text(store, 'retention19.decisionRef', 'მინისტრის გადაწყვეტილება (თუ საჭიროა)')) : null),
      h('div', { class: 'grid3' },
        F.integer(store, 'employee.age', 'თანამშრომლის ასაკი (სრული წლები)', { max: 120, hint: 'საჭიროა დაზღვევისთვის. ცარიელი = უცნობი.' }),
        F.date(store, 'employee.birthDate', 'ან დაბადების თარიღი')),
      F.radios(store, 'period.mode', 'საანგარიშო პერიოდი', [
        { value: 'full-month', label: 'სრული თვე' },
        { value: 'dates', label: 'თარიღებით (არასრული თვეები, შუა თვის ცვლილებები)' },
      ], { inline: true, onChange: (mode) => {
        if (mode === 'dates') { sc.period.start = sc.period.start ?? null; sc.period.end = sc.period.end ?? null; delete sc.period.month; }
        else { delete sc.period.start; delete sc.period.end; sc.period.month = sc.period.month ?? currentMonth(); }
        render(); store.structure('period');
        box.querySelector('[data-path="period.mode"] input:checked')?.focus();
      } }),
      !dates ? h('div', { class: 'grid3' }, F.month(store, 'period.month', 'საანგარიშო თვე', { hint: 'საჭიროა დამოკიდებული პირების ყოფნისა და პ. 20¹/20²-ის პერიოდის შესამოწმებლად.' })) : null,
      dates ? h('div', { class: 'grid3 advanced' },
        F.date(store, 'period.start', 'პერიოდის დაწყება'),
        F.date(store, 'period.end', 'პერიოდის დასრულება', { hint: 'ორივე თარიღი ჩათვლით. ქირისა და ოჯახის ცვლილებები — სექციებში 3 და 4.' })) : null);
  }
  render();
  return { render };
}
