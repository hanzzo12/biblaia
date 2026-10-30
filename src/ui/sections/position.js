// სექცია 2: თანამდებობა (მარტივი ხედი) + დამატებითი პირობები: რეჟიმი, ხელმძღვანელის სტატუსი, 20¹/20²/19, პერიოდი, ასაკი.
import { h, replace } from '../dom.js';
import { L, HEAD_BASIS } from '../labels.js';
import * as F from '../fields.js';
import * as core from '../../core/index.js';

export const currentMonth = () => new Date().toISOString().slice(0, 7);

export function mountPosition(simpleRoot, advRoot, store) {
  const simple = h('div');
  const adv = h('div');
  simpleRoot.append(simple);
  advRoot.append(adv);
  const profiles = () => (core.positionProfiles ? core.positionProfiles(store.data) : store.data.positionProfiles);
  const headOf = (e) => (e?.suggestedRentHead === 'head' || e?.suggestedRentHead === 'head-consular' ? 'head' : e ? 'not-head' : null);

  function render() {
    const sc = store.scenario;
    const prof = profiles().find((p) => p.id === sc.position.mode) || profiles()[0];
    const entries = prof?.entries || [];
    const entry = entries.find((e) => e.id === sc.position.entryId) || null;
    const dates = sc.period.mode === 'dates';
    const rh = sc.status.rentHead;
    replace(simple,
      F.select(store, 'position.entryId', L.position, entries.map((e) => ({ value: e.id, label: `${e.positions_ka?.join(' / ') || e.title_ka} — ${e.percent}%` })),
        { wide: true, onChange: (id) => {
          store.ui.notice = null;
          const e = entries.find((x) => x.id === id);
          if (!store.ui.rentHeadTouched) sc.status.rentHead = headOf(e);
          render(); store.schedule();
          document.getElementById(store.ids['position.entryId'])?.focus();
        } }),
      store.ui.notice ? h('p', { class: 'warn', role: 'status' }, store.ui.notice) : null,
      entry ? h('p', { class: 'hint' }, `${sc.position.mode === 'annex3' ? L.annex3 : L.annex2} · ქირის წესი: `,
        h('strong', null, rh === 'head' ? 'ხელმძღვანელი (80%)' : rh === 'not-head' ? 'სხვა მოსამსახურე (50%)' : 'დაუზუსტებელი'),
        entry.suggestedRentHead === 'head-consular' ? ' — საკონსულო დაწესებულების ხელმძღვანელისთვის ქირის 80% სცენარია (OQ-10)' : '',
        ' · შეცვლა — „დამატებითი პირობები“') : null);

    replace(adv,
      h('div', { class: 'adv-group' }, h('h3', null, 'თანამდებობის რეჟიმი და სტატუსი'),
        F.radios(store, 'position.mode', L.mode, [
          { value: 'annex2', label: L.annex2, hint: '— როტაციით მივლინებული' },
          { value: 'annex3', label: L.annex3, hint: '— ცენტრალური აპარატი (პ. 37–39)' },
        ], { inline: true, onChange: (mode) => {
          const old = entry?.positions_ka?.[0];
          const next = profiles().find((p) => p.id === mode)?.entries.find((e) => e.positions_ka?.includes(old));
          sc.position.entryId = next ? next.id : null;
          store.ui.notice = old && !next ? `თანამდებობა „${old}“ არჩეულ რეჟიმში არ არის — აირჩიეთ ხელახლა.` : null;
          render(); store.schedule();
          adv.querySelector('[data-path="position.mode"] input:checked')?.focus();
        } }),
        sc.position.mode === 'annex3' ? F.text(store, 'position.orderRef37', 'დანართი №3-ის საფუძველი — აქტის რეკვიზიტები (პ. 37)', { wide: true }) : null,
        F.radios(store, 'status.rentHead', L.rentHead, [
          { value: 'head', label: 'დიახ (ქირა 80%, მაკლერი 80%)' },
          { value: 'not-head', label: 'არა (ქირა 50%, მაკლერი 50%)' },
          { value: null, label: 'უცნობია' },
        ], { inline: true, hint: 'თანამდებობის პროცენტით არ განისაზღვრება.', onChange: () => { store.ui.rentHeadTouched = true; render(); } }),
        rh === 'head' ? F.select(store, 'status.headBasis', 'ხელმძღვანელის სტატუსის საფუძველი', Object.entries(HEAD_BASIS).map(([value, label]) => ({ value, label }))) : null,
        F.check(store, 'status.actingHead201.applies', 'ხელმძღვანელის მოვალეობის შემსრულებელი (პ. 20¹)', { onChange: () => render() }),
        sc.status.actingHead201.applies ? h('div', { class: 'grid3' }, F.text(store, 'status.actingHead201.actRef', 'აქტის რეკვიზიტები'),
          F.date(store, 'status.actingHead201.from', 'დან'), F.date(store, 'status.actingHead201.to', 'მდე')) : null,
        F.check(store, 'status.adminManager202.applies', 'ადმინისტრაციული მენეჯერი სხვა დაწესებულებაში (პ. 20², 75%)', { onChange: () => render() }),
        sc.status.adminManager202.applies ? h('div', { class: 'grid3' }, F.text(store, 'status.adminManager202.actRef', 'აქტის რეკვიზიტები'),
          F.date(store, 'status.adminManager202.from', 'დან'), F.date(store, 'status.adminManager202.to', 'მდე')) : null,
        F.toggle('თანხის შენარჩუნება შეჩერებისას (პ. 19)', !!sc.retention19?.applies, (on) => {
          sc.retention19 = on ? { applies: true, from: null, to: null, decisionRef: null } : null;
          store.forget('retention19'); render(); store.schedule();
        }),
        sc.retention19?.applies ? h('div', { class: 'grid3' }, F.date(store, 'retention19.from', 'დან'), F.date(store, 'retention19.to', 'მდე'),
          F.text(store, 'retention19.decisionRef', 'მინისტრის გადაწყვეტილება')) : null),
      h('div', { class: 'adv-group' }, h('h3', null, 'პერიოდი და ასაკი'),
        F.radios(store, 'period.mode', 'საანგარიშო პერიოდი', [
          { value: 'full-month', label: 'სრული თვე' },
          { value: 'dates', label: 'თარიღებით (არასრული თვე, ცვლილებები)' },
        ], { inline: true, onChange: (mode) => {
          if (mode === 'dates') { sc.period.start = sc.period.start ?? null; sc.period.end = sc.period.end ?? null; delete sc.period.month; }
          else { delete sc.period.start; delete sc.period.end; sc.period.month = sc.period.month ?? currentMonth(); }
          render(); store.structure('period');
          adv.querySelector('[data-path="period.mode"] input:checked')?.focus();
        } }),
        h('div', { class: 'grid3' },
          !dates ? F.month(store, 'period.month', 'საანგარიშო თვე', { hint: 'დამოკიდებული პირების ყოფნისა და 20¹/20²-ის შესამოწმებლად.' }) : null,
          dates ? F.date(store, 'period.start', 'დაწყება') : null,
          dates ? F.date(store, 'period.end', 'დასრულება', { hint: 'ორივე თარიღი ჩათვლით.' }) : null,
          F.integer(store, 'employee.age', 'თქვენი ასაკი', { max: 120, hint: 'დაზღვევის ზღვრისთვის. ცარიელი = უცნობი.' }),
          F.date(store, 'employee.birthDate', 'ან დაბადების თარიღი'))));
  }
  render();
  return { render };
}
