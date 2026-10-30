// სექცია 4: ქირა, განათლება და დამატებითი ხარჯები.
import { h, replace } from '../dom.js';
import { L, RENT_BASIS, EXTRA_CATEGORIES, TRAVEL_KINDS, BAGGAGE_KINDS, enumOptions } from '../labels.js';

export function syncInsurance(sc) {
  const ids = ['EMP', ...sc.family.map((m) => m.id)];
  const by = new Map((sc.insurance || []).map((x) => [x.personId, x]));
  sc.insurance = ids.map((id) => by.get(id) || { personId: id, policyCost: null, alreadyReimbursed: null, policyStart: null });
}
import * as F from '../fields.js';
import * as core from '../../core/index.js';


export function mountExpenses(root, advRoot, store) {
  const box = h('div');
  const advBox = h('div');
  root.append(box);
  advRoot.append(advBox);
  const scope = { querySelector: (q) => box.querySelector(q) || advBox.querySelector(q) };
  const open = store.ui.open = store.ui.open || {};

  const det = (key, summary, ...children) => {
    const d = h('details', { class: 'group-details', open: !!open[key], 'data-details': key }, h('summary', null, summary), ...children);
    d.addEventListener('toggle', () => { open[key] = d.open; });
    return d;
  };

  const people = () => [{ value: 'EMP', label: 'თანამშრომელი' }, ...store.scenario.family.map((m) => ({ value: m.id, label: m.label }))];

  /** სიის რედაქტორი: დამატება/წაშლა, თითო ელემენტი — fieldset. */
  function listEditor(path, { itemLabel, make, fields, addLabel }) {
    const arr = store.get(path);
    const wrap = h('div', { class: 'list-editor', 'data-list': path });
    const items = arr.map((it, i) => {
      const del = h('button', { type: 'button', class: 'btn small secondary', 'aria-label': `${itemLabel} ${i + 1}-ის წაშლა` }, 'წაშლა');
      del.addEventListener('click', () => {
        arr.splice(i, 1); store.forget(path); render(); store.structure(path);
        (scope.querySelector(`[data-list="${path}"] fieldset:last-of-type select, [data-list="${path}"] fieldset:last-of-type input`) || scope.querySelector(`[data-list="${path}"] > button`))?.focus();
      });
      return h('fieldset', { class: 'card' }, h('legend', null, `${itemLabel} ${i + 1}`), h('div', { class: 'grid3' }, fields(`${path}.${i}`, it)), del);
    });
    const add = h('button', { type: 'button', class: 'btn secondary' }, addLabel);
    add.addEventListener('click', () => {
      arr.push(make()); render(); store.structure(path);
      scope.querySelector(`[data-list="${path}"] fieldset:last-of-type select, [data-list="${path}"] fieldset:last-of-type input`)?.focus();
    });
    wrap.append(...items, add);
    return wrap;
  }

  const rentHint = h('p', { class: 'hint', id: 'rent-hint', 'aria-live': 'polite', 'data-testid': 'rent-hint' });
  const rentWarn = h('div', { 'aria-live': 'polite' });

  function updateRentNotes() {
    const r = store.scenario.rent;
    const raw = store.raw['rent.amount'];
    rentHint.textContent = store.errors['rent.amount'] ? '' : r.amount == null ? (raw && raw.trim() ? '' : 'ქირა ჯერ უცნობია — შედეგი ნაწილობრივია. ცარიელი ველი ნულს არ ნიშნავს.')
      : /^0+(\.0+)?$/.test(r.amount) ? 'ქირა არ არის (G = 0).' : `ქირის წყარო: ${RENT_BASIS[r.basis] ?? r.basis}.`;
    const ui = store.ui;
    const other = r.amount != null && ui.rentLocationId && ui.locationId && ui.rentLocationId !== ui.locationId;
    const loc = other ? (store.data.locations || []).find((l) => l.id === ui.rentLocationId) : null;
    replace(rentWarn, other ? h('p', { class: 'warn', 'data-testid': 'rent-other-city' }, `დაგეგმილი ქირა შეყვანილია სხვა ქალაქისთვის (${loc?.name_ka ?? ui.rentLocationId}). გადაამოწმეთ.`) : null);
  }

  function cleanRange(p, key) {
    const o = store.get(`${p}.${key}`);
    if (!o) return;
    o.from = o.from ?? null; o.to = o.to ?? null;
    if (!o.from && !o.to) store.set(`${p}.${key}`, null);
  }

  function render() {
    const sc = store.scenario;
    const dates = sc.period.mode === 'dates';
    const children = sc.family.filter((m) => m.role === 'child' || m.role === 'stepchild' || m.role === 'other');
    replace(box,
      h('div', { class: 'rent-block' },
        F.money(store, 'rent.amount', L.rent, { unit: '', positive: false, hint: 'ცარიელი = უცნობი; 0 = ქირა არ არის. შეიყვანეთ დაფინანსების ვალუტაში.', onChange: () => {
          store.ui.rentLocationId = store.ui.locationId;
          if (sc.rent.basis === 'market-scenario') { sc.rent.basis = 'planned'; sc.rent.marketRef = null; render(); document.getElementById(store.ids['rent.amount'])?.focus(); }
          updateRentNotes();
        } }),
        rentHint, rentWarn,
        F.radios(store, 'rent.basis', 'ქირის წყარო', [
          { value: 'actual', label: RENT_BASIS.actual },
          { value: 'planned', label: RENT_BASIS.planned },
          { value: 'market-scenario', label: RENT_BASIS['market-scenario'], disabled: sc.rent.basis !== 'market-scenario', hint: '(მხოლოდ ღილაკით „' + L.useAsPlannedRent + '“)' },
        ], { inline: true, onChange: () => updateRentNotes() }),
        dates ? h('div', null, h('h4', null, 'ქირის ცვლილება პერიოდში'),
          listEditor('rent.changes', { itemLabel: 'ცვლილება', addLabel: '+ ქირის ცვლილება', make: () => ({ from: null, amount: null }),
            fields: (p) => [F.date(store, `${p}.from`, 'თარიღიდან'), F.money(store, `${p}.amount`, 'ახალი ქირა', { unit: '' })] })) : null),

      h('fieldset', { class: 'group edu' }, h('legend', null, 'განათლება (თითო ბავშვზე)'),
        children.length ? null : h('p', { class: 'hint' }, 'ჯერ დაამატეთ შვილი/გერი სექციაში 3.'),
        listEditor('education', { itemLabel: 'განათლება', addLabel: '+ ბავშვის განათლების ხარჯი',
          make: () => ({ memberId: children[0]?.id ?? null, tuition: null, registration: null, transport: null, meals: null, holidayExtraContract: null, freeStateLanguageSchoolAvailable: false, paidSchoolLanguageSameAsState: false, schoolYear: null, ministerDecision34: false }),
          fields: (p) => [
            F.select(store, `${p}.memberId`, 'ბავშვი', children.map((m) => ({ value: m.id, label: m.label }))),
            F.money(store, `${p}.tuition`, 'სწავლის საფასური (თვეში)', { unit: '' }),
            h('details', { class: 'conds wide' }, h('summary', null, 'სხვა კომპონენტები და პირობები'), h('div', { class: 'grid3' },
            F.money(store, `${p}.registration`, 'რეგისტრაცია', { unit: '' }),
            F.money(store, `${p}.transport`, 'ნებადართული ტრანსპორტირება (თვეში)', { unit: '' }),
            F.money(store, `${p}.meals`, 'კვება (თვეში)', { unit: '' }),
            F.money(store, `${p}.holidayExtraContract`, 'არდადეგების დამატებითი ხელშეკრულება', { unit: '' }),
            F.date(store, `${p}.schoolYear.from`, 'სასწავლო წელი — დან', { onChange: () => cleanRange(p, 'schoolYear') }),
            F.date(store, `${p}.schoolYear.to`, 'სასწავლო წელი — მდე', { onChange: () => cleanRange(p, 'schoolYear') }),
            F.check(store, `${p}.freeStateLanguageSchoolAvailable`, 'ხელმისაწვდომია უფასო სასწავლებელი სახელმწიფო ენაზე'),
            F.check(store, `${p}.paidSchoolLanguageSameAsState`, 'ფასიანი სასწავლებლის სწავლების ენა ემთხვევა სახელმწიფო ენას'),
            F.check(store, `${p}.ministerDecision34`, 'ინდივიდუალური გადაწყვეტილება (პ. 34)'))),
          ] }))
    );
    replace(advBox,
        det('ins', 'დაზღვევა (თითო პირზე)',
          h('p', { class: 'hint' }, 'წლიური ზღვარი დაზღვევის ანაზღაურების მაქსიმუმია და გასაცემ თანხას არ ნიშნავს.'),
          sc.insurance.map((it, i) => h('fieldset', { class: 'card' }, h('legend', null, people().find((p) => p.value === it.personId)?.label ?? it.personId),
            h('div', { class: 'grid3' },
              F.money(store, `insurance.${i}.policyCost`, 'პოლისის ფასი (ფაქტობრივი/დაგეგმილი, წლიური)', { unit: '' }),
              F.money(store, `insurance.${i}.alreadyReimbursed`, 'უკვე ანაზღაურებული ამ ლიმიტიდან', { unit: '' }),
              F.date(store, `insurance.${i}.policyStart`, 'პოლისის დაწყება'),
              F.date(store, `insurance.${i}.policyEnd`, 'პოლისის დასრულება'))))),
        det('broker', 'მაკლერის მომსახურება',
          F.toggle('მაკლერის საკომისიოს მოთხოვნა', !!sc.broker, (on) => {
            sc.broker = on ? { fee: null, serviceDate: null, rotationStartDate: null, alreadyReimbursed: false, documented: false, specialDecision81: false } : null;
            store.forget('broker'); render(); store.schedule();
          }),
          sc.broker ? [h('div', { class: 'grid3' },
            F.money(store, 'broker.fee', 'ფაქტობრივი საკომისიო', { unit: '', hint: 'ნაგულისხმევი არ აქვს; ქირის ტოლად არ ივსება.' }),
            F.date(store, 'broker.serviceDate', 'მომსახურების თარიღი'),
            F.date(store, 'broker.rotationStartDate', 'როტაციის დაწყების თარიღი')),
          F.check(store, 'broker.documented', 'არსებობს დამადასტურებელი დოკუმენტი'),
          F.check(store, 'broker.alreadyReimbursed', 'საკომისიო ამ როტაციაზე უკვე ანაზღაურდა'),
          F.check(store, 'broker.specialDecision81', 'სპეციალური გადაწყვეტილება (პ. 8¹)')] : null),
        det('baggage', 'ბარგი',
          F.toggle('ბარგის ხარჯის მოთხოვნა', !!sc.baggage, (on) => {
            sc.baggage = on ? { kind: 'departure', claims: [], previouslyUsed: null, callbackAlreadyReimbursed: false } : null;
            store.forget('baggage'); render(); store.schedule();
          }),
          sc.baggage ? [h('div', { class: 'grid3' },
            F.select(store, 'baggage.kind', 'შემთხვევა', enumOptions(core.BAGGAGE_KINDS, BAGGAGE_KINDS), { allowEmpty: false }),
            F.money(store, 'baggage.previouslyUsed', 'უკვე გამოყენებული ლიმიტი', { unit: '' })),
          F.check(store, 'baggage.callbackAlreadyReimbursed', 'სპეციალური გამოძახება უკვე ანაზღაურდა (პ. 5²)'),
          listEditor('baggage.claims', { itemLabel: 'ბარგის ხარჯი', addLabel: '+ ბარგის ხარჯი', make: () => ({ who: 'EMP', amount: null }),
            fields: (p) => [F.select(store, `${p}.who`, 'ვისი', people(), { allowEmpty: false }), F.money(store, `${p}.amount`, 'ფაქტობრივი დასაშვები ხარჯი', { unit: '' })] })] : null),
        det('settlement', 'პირველადი მოწყობა',
          h('p', { class: 'hint' }, 'დღიური ნორმა (მთავრობის №211 დადგენილება) მოწოდებულ წყაროებში არ არის — შეიყვანეთ ხელით წყაროთი; შედეგი დაუდასტურებელია.'),
          F.toggle('დღიური ნორმის ხელით შეყვანა', !!sc.settlement.dailyRate, (on) => {
            sc.settlement.dailyRate = on ? { amount: null, currency: null, source: null, sourceDate: null, confirmed: false } : null;
            store.forget('settlement.dailyRate'); render(); store.schedule();
          }),
          sc.settlement.dailyRate ? h('div', { class: 'grid3' },
            F.money(store, 'settlement.dailyRate.amount', 'დღიური ნორმა', { positive: true }),
            F.select(store, 'settlement.dailyRate.currency', 'ნორმის ვალუტა', ['EUR', 'USD', 'GEL', 'GBP', 'CHF'].map((c) => ({ value: c, label: c }))),
            F.text(store, 'settlement.dailyRate.source', 'წყარო'),
            F.date(store, 'settlement.dailyRate.sourceDate', 'წყაროს თარიღი'),
            F.check(store, 'settlement.dailyRate.confirmed', 'ნორმა დადასტურებულია ოფიციალური წყაროთი')) : null,
          F.toggle('ნორმის ვალუტის კურსის მითითება', !!sc.settlement.fx, (on) => {
            sc.settlement.fx = on ? { rate: null, date: null, source: null } : null;
            store.forget('settlement.fx'); render(); store.schedule();
          }),
          sc.settlement.fx ? h('div', { class: 'grid3' },
            F.money(store, 'settlement.fx.rate', 'კურსი (1 ნორმის ვალუტა = ? დაფინანსების ვალუტა)', { positive: true }),
            F.date(store, 'settlement.fx.date', 'კურსის თარიღი'),
            F.text(store, 'settlement.fx.source', 'კურსის წყარო')) : null,
          F.select(store, 'settlement.exclusion9', 'გამონაკლისი (პ. 9)', enumOptions(core.SETTLEMENT_EXCLUSIONS, {}), { emptyLabel: 'არ ვრცელდება' }),
          F.date(store, 'settlement.postingDate', 'წარგზავნის თარიღი'),
          F.check(store, 'settlement.transfer10', 'სხვა ქალაქში გადაყვანა (პ. 10)')),
        det('travel', 'მგზავრობა',
          listEditor('travel', { itemLabel: 'მგზავრობა', addLabel: '+ მგზავრობა', make: () => ({ kind: 'departure', personId: 'EMP', actualCost: null, comparableTicket: null, route: null, date: null, ownCar: false, interruptedLeave: false, callbackAlreadyReimbursed: false }),
            fields: (p) => [
              F.select(store, `${p}.kind`, 'კატეგორია', enumOptions(core.TRAVEL_KINDS, TRAVEL_KINDS), { allowEmpty: false }),
              F.select(store, `${p}.personId`, 'მგზავრი', people(), { allowEmpty: false }),
              F.select(store, `${p}.route`, 'მიმართულება', enumOptions(core.TRAVEL_ROUTES, {})),
              F.money(store, `${p}.actualCost`, 'ფაქტობრივი ღირებულება (ეკონომკლასი)', { unit: '' }),
              F.money(store, `${p}.comparableTicket`, 'შესადარებელი ბილეთის ფასი', { unit: '' }),
              F.date(store, `${p}.date`, 'მგზავრობის თარიღი'),
              F.check(store, `${p}.ownCar`, 'პირადი ავტომანქანით (პ. 5)'),
              F.check(store, `${p}.interruptedLeave`, 'შეწყვეტილი შვებულება (სამსახურებრივი გამოძახება)'),
              F.check(store, `${p}.callbackAlreadyReimbursed`, 'სპეციალური გამოძახება უკვე ანაზღაურდა (პ. 5²)'),
            ] })),
        det('advances', 'ავანსი (დასაბრუნებელი)',
          h('p', { class: 'hint' }, 'ავანსი შემოსავალი არ არის და არც ხარჯის ანაზღაურება — ჩანს ცალკე, დაფარვის გრაფიკით.'),
          listEditor('advances', { itemLabel: 'ავანსი', addLabel: '+ ავანსი', make: () => ({ kind: 'rent', amount: null, issueDate: null, months: 6, ministerOrder22: false }),
            fields: (p) => [
              F.select(store, `${p}.kind`, 'ავანსის სახე', enumOptions(core.ADVANCE_KINDS, { rent: 'ბინის ქირის ავანსი' }), { allowEmpty: false }),
              F.money(store, `${p}.amount`, 'ავანსის თანხა', { unit: '' }),
              F.date(store, `${p}.issueDate`, 'გაცემის თარიღი'),
              F.integer(store, `${p}.months`, 'დაფარვის თვეები', { min: 1, max: 120 }),
              F.check(store, `${p}.ministerOrder22`, 'მინისტრის ინდივიდუალური აქტი (პ. 22–27)'),
            ] })),
        det('extras', 'სხვა ხარჯები',
          listEditor('extras', { itemLabel: 'ხარჯი', addLabel: '+ სხვა ხარჯი', make: () => ({ category: 'visa', amount: null, justification: null, ministerDecisionRequired: false }),
            fields: (p) => [
              F.select(store, `${p}.category`, 'კატეგორია', enumOptions(core.EXTRA_CATEGORIES, EXTRA_CATEGORIES), { allowEmpty: false }),
              F.money(store, `${p}.amount`, 'ფაქტობრივი თანხა', { unit: '' }),
              F.text(store, `${p}.justification`, 'დასაბუთება', { wide: true }),
              F.check(store, `${p}.ministerDecisionRequired`, 'საჭიროებს მინისტრის გადაწყვეტილებას'),
            ] })));
    updateRentNotes();
  }

  render();
  return { render, updateRentNotes };
}
