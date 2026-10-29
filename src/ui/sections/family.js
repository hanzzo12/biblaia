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
    reimbursedElsewhere: { insurance: false, education: false, travel: false, baggage: false }, adultChildInSchool: false,
  };
}

export function mountFamily(root, store, { onMembersChange }) {
  const list = h('div', { class: 'cards' });
  const add = h('button', { type: 'button', class: 'btn', 'data-testid': 'add-family' }, '+ ოჯახის წევრის დამატება');
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
    if (!fam.length) { replace(list, h('p', { class: 'hint' }, 'ოჯახის წევრი არ არის დამატებული.')); return; }
    replace(list, fam.map((m, i) => {
      const p = `family.${i}`;
      const del = h('button', { type: 'button', class: 'btn small secondary', 'aria-label': `${m.label}-ის წაშლა` }, 'წაშლა');
      del.addEventListener('click', () => {
        fam.splice(i, 1);
        store.forget('family'); store.forget('education'); store.forget('insurance');
        onMembersChange();
        render();
        store.structure('family');
        (list.querySelectorAll('fieldset.card')[Math.max(0, i - 1)]?.querySelector('select') || add).focus();
      });
      return h('fieldset', { class: 'card', 'data-member': m.id },
        h('legend', null, m.label),
        h('div', { class: 'grid3' },
          F.select(store, `${p}.role`, 'როლი', enumOptions(core.ROLES, ROLES), { allowEmpty: false, onChange: () => { onMembersChange(); store.structure('family'); } }),
          F.select(store, `${p}.status`, 'სტატუსი', enumOptions(core.MEMBER_STATUSES, MEMBER_STATUSES), { allowEmpty: false }),
          F.integer(store, `${p}.age`, 'ასაკი (სრული წლები)', { max: 120, hint: 'ცარიელი = უცნობი (ნულად არ ითვლება).' }),
          F.date(store, `${p}.birthDate`, 'ან დაბადების თარიღი')),
        h('details', { class: 'conds' },
          h('summary', null, 'პირობები'),
          F.check(store, `${p}.worksInSameMissionOrCity`, 'მუშაობს იმავე დაწესებულებაში ან ქალაქში (დან. №1, მ. 4, პ. 3)'),
          F.check(store, `${p}.supplementPaidToOtherEmployee`, 'მასზე დანამატს სხვა მოსამსახურე იღებს (მ. 4, პ. 1–2)'),
          m.role === 'spouse' ? F.check(store, `${p}.spousePostedInOtherCity`, 'მეუღლე მივლინებულია სხვა ქალაქში (მ. 4, პ. 2)') : null,
          (m.role === 'child' || m.role === 'stepchild') ? F.check(store, `${p}.adultChildInSchool`, 'სრულწლოვანი შვილი/გერი სწავლობს (სრულწლოვანებიდან ≤ 1 წელი)') : null,
          h('fieldset', { class: 'group' }, h('legend', null, 'ანაზღაურებას იღებს სხვა წყაროდან (მ. 4, პ. 4)'),
            F.check(store, `${p}.reimbursedElsewhere.insurance`, 'დაზღვევა'),
            F.check(store, `${p}.reimbursedElsewhere.education`, 'განათლება'),
            F.check(store, `${p}.reimbursedElsewhere.travel`, 'მგზავრობა'),
            F.check(store, `${p}.reimbursedElsewhere.baggage`, 'ბარგი')),
          h('div', { class: 'grid3' },
            F.date(store, `${p}.presence.0.from`, 'ადგილსამყოფელ ქვეყანაში ყოფნა — დან', { onChange: () => cleanPresence(m) }),
            F.date(store, `${p}.presence.0.to`, 'ყოფნა — მდე', { onChange: () => cleanPresence(m) }),
            dates ? F.date(store, `${p}.from`, 'ოჯახის შემადგენლობაში — დან') : null,
            dates ? F.date(store, `${p}.to`, 'ოჯახის შემადგენლობაში — მდე') : null)),
        h('div', { class: 'eligibility', 'data-eligibility-for': m.id, 'aria-live': 'polite' }),
        del);
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
