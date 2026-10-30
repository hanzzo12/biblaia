// სექცია 3: ოჯახის წევრები და თითო წევრის პირობები. სახელი არ ითხოვება.
import { h, replace } from '../dom.js';
import { ROLES, MEMBER_STATUSES, ELIGIBILITY, enumOptions } from '../labels.js';
import * as F from '../fields.js';
import * as core from '../../core/index.js';

export function newMember(family) {
  let n = 1;
  const ids = new Set(family.map((m) => m.id));
  while (ids.has('F' + n)) n++;
  return {
    id: 'F' + n, label: 'ოჯახის წევრი ' + n, role: family.some((m) => m.role === 'spouse') ? 'child' : 'spouse', status: 'regular',
    age: null, birthDate: null, from: null, to: null, presence: null,
    worksInSameMissionOrCity: false, supplementPaidToOtherEmployee: false, spousePostedInOtherCity: false,
    reimbursedElsewhere: { insurance: false, education: false, travel: false, baggage: false }, adultChildInSchool: false, hostStateConsent: false,
  };
}

export function mountFamily(root, store, { onMembersChange }) {
  const list = h('div', { class: 'cards' });
  const add = h('button', { type: 'button', class: 'btn ghost', 'data-testid': 'add-family' }, '+ ოჯახის წევრის დამატება');
  root.append(list, add);
  add.addEventListener('click', () => {
    store.scenario.family.push(newMember(store.scenario.family));
    onMembersChange();
    render();
    store.structure('family');
    list.lastElementChild?.querySelector('select')?.focus();
  });

  function render() {
    const fam = store.scenario.family;
    const dates = store.scenario.period.mode === 'dates';
    if (!fam.length) { replace(list, h('p', { class: 'hint' }, 'მარტო მიემგზავრებით? დატოვეთ ცარიელი. თანმხლები ოჯახის წევრები დაამატეთ ქვემოთ.')); return; }
    replace(list, fam.map((m, i) => {
      const p = `family.${i}`;
      const del = h('button', { type: 'button', class: 'icon-btn', 'aria-label': `${m.label}-ის წაშლა`, title: 'წაშლა' }, '×');
      del.addEventListener('click', () => {
        fam.splice(i, 1);
        store.forget('family'); store.forget('education'); store.forget('insurance');
        onMembersChange();
        render();
        store.structure('family');
        (list.querySelectorAll('fieldset.member')[Math.max(0, i - 1)]?.querySelector('select') || add).focus();
      });
      return h('fieldset', { class: 'member', 'data-member': m.id },
        h('legend', { class: 'sr-only' }, m.label),
        h('div', { class: 'member-row' },
          h('span', { class: 'member-no', 'aria-hidden': 'true' }, String(i + 1)),
          F.select(store, `${p}.role`, 'როლი', enumOptions(core.ROLES, ROLES), { allowEmpty: false, onChange: () => { onMembersChange(); store.structure('family'); } }),
          F.integer(store, `${p}.age`, 'ასაკი', { max: 120 }),
          del),
        h('details', { class: 'conds' },
          h('summary', null, 'პირობები და უფლებები'),
          h('div', { class: 'eligibility', 'data-eligibility-for': m.id, 'aria-live': 'polite' }),
          h('div', { class: 'grid3' },
            F.select(store, `${p}.status`, 'სტატუსი', enumOptions(core.MEMBER_STATUSES, MEMBER_STATUSES), { allowEmpty: false }),
            F.date(store, `${p}.birthDate`, 'დაბადების თარიღი (ასაკის ნაცვლად)')),
          F.check(store, `${p}.worksInSameMissionOrCity`, 'მუშაობს იმავე დაწესებულებაში ან ქალაქში (დან. №1, მ. 4, პ. 3)'),
          F.check(store, `${p}.supplementPaidToOtherEmployee`, 'მასზე დანამატს სხვა მოსამსახურე იღებს (მ. 4, პ. 1–2)'),
          m.role === 'spouse' ? F.check(store, `${p}.spousePostedInOtherCity`, 'მეუღლე მივლინებულია სხვა ქალაქში (მ. 4, პ. 2)') : null,
          (m.role === 'child' || m.role === 'stepchild') ? F.check(store, `${p}.adultChildInSchool`, 'სრულწლოვანი შვილი/გერი სწავლობს (სრულწლოვანებიდან ≤ 1 წელი)') : null,
          (m.role === 'child' || m.role === 'stepchild') ? F.check(store, `${p}.hostStateConsent`, 'სრულწლოვანზე არის ადგილსამყოფელი სახელმწიფოს თანხმობა') : null,
          h('fieldset', { class: 'group' }, h('legend', null, 'ანაზღაურებას იღებს სხვა წყაროდან (მ. 4, პ. 4)'),
            h('div', { class: 'checks-inline' },
              F.check(store, `${p}.reimbursedElsewhere.insurance`, 'დაზღვევა'),
              F.check(store, `${p}.reimbursedElsewhere.education`, 'განათლება'),
              F.check(store, `${p}.reimbursedElsewhere.travel`, 'მგზავრობა'),
              F.check(store, `${p}.reimbursedElsewhere.baggage`, 'ბარგი'))),
          h('div', { class: 'grid3' },
            F.date(store, `${p}.presence.0.from`, 'ქვეყანაში ყოფნა — დან', { onChange: () => cleanPresence(m) }),
            F.date(store, `${p}.presence.0.to`, 'ქვეყანაში ყოფნა — მდე', { onChange: () => cleanPresence(m) }),
            dates ? F.date(store, `${p}.from`, 'ოჯახში — დან') : null,
            dates ? F.date(store, `${p}.to`, 'ოჯახში — მდე') : null)));
    }));
  }

  function cleanPresence(m) {
    const p = m.presence?.[0];
    if (!p) return;
    p.from = p.from ?? null; p.to = p.to ?? null;
    if (!p.from && !p.to) m.presence = null;
  }

  /** ბირთვის პასუხიდან თითო წევრის უფლებები */
  function updateEligibility(result) {
    for (const el of list.querySelectorAll('[data-eligibility-for]')) {
      const r = (result?.family || []).find((f) => f.memberId === el.getAttribute('data-eligibility-for'));
      if (!r?.eligibility) { replace(el); continue; }
      replace(el, h('ul', { class: 'elig' }, Object.entries(r.eligibility).map(([k, e]) => {
        const v = e?.value;
        const word = v === true ? 'კი' : v === false ? 'არა' : 'დაუდგენელი';
        return h('li', { class: `elig-${v === true ? 'yes' : v === false ? 'no' : 'unknown'}`, title: e?.reason_ka || null },
          h('strong', null, `${ELIGIBILITY[k] ?? k}: ${word}`), e?.reason_ka ? h('span', { class: 'hint' }, ' — ' + e.reason_ka) : null);
      })));
    }
  }

  render();
  return { render, updateEligibility };
}
