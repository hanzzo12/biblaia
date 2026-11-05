// გამჭვირვალე ჯაჭვი: S − G − სწავლის საკუთარი წილი = ნაშთი (ბირთვის r.remainder); − საცხოვრებელი ხარჯი = საორიენტაციო ნაშთი.
// ყველა ოპერაცია ზუსტი რაციონალებით (Component.exact), რომ ეკრანი ბირთვს ზუსტად დაემთხვეს.
import { h } from './dom.js';
import * as core from '../core/index.js';
import { R, sub, add, eq, toFixed2, fromExactString, ZERO } from '../core/rational.js';
import { livingRemainder } from './market.js';

const ex = (c) => {
  if (c == null) return null;
  if (typeof c === 'object') {
    if (c.exact) return /^-?\d+(\/\d+)?$/.test(c.exact) ? fromExactString(c.exact) : R(c.exact);
    return c.value != null ? R(c.value) : null;
  }
  return R(c);
};
const fx = (x) => (x == null ? null : toFixed2(x));

/** @returns {{ S, G, eduPersonal, hasEdu, remainder, matches, living, rent: { G, T, FminusT, F, extra, surplus } }} (ათწილადი სტრიქონები) */
export function computeChain(r, md, familyCount, { hasEdu = false } = {}) {
  const m = r?.monthly || {}; const ed = r?.education || {};
  const S = ex(m.S), G = ex(m.G), T = ex(m.T), F = ex(m.F);
  const eduE = hasEdu ? ex(ed.expense) : ZERO;
  const eduR = hasEdu ? ex(ed.total) : ZERO;
  const eduPersonal = eduE != null && eduR != null ? sub(eduE, eduR) : null;
  const remainder = ex(r?.remainder?.value);
  const check = S != null && G != null && eduE != null && eduR != null ? add(sub(sub(S, G), eduE), eduR) : null;
  const matches = remainder != null && check != null && eq(remainder, check);
  if (remainder != null && check != null && !matches) console.warn('chain mismatch', toFixed2(check), toFixed2(remainder));
  const living = livingRemainder(remainder, md, familyCount);
  return {
    S: fx(S), G: fx(G), eduPersonal: fx(eduPersonal), eduExpense: fx(eduE), eduReimb: fx(eduR), hasEdu, remainder: fx(remainder), matches, living,
    rent: { G: fx(G), T: fx(T), FminusT: F != null && T != null ? fx(sub(F, T)) : null, F: fx(F), extra: fx(ex(m.uncoveredRent)), surplus: fx(ex(m.rentSurplus)) },
  };
}

const money = (x, cur) => (x == null ? '—' : `${core.formatAmount(x)} ${cur}`);
const neg = (x) => (x != null && String(x).startsWith('-') ? ' neg' : '');

/** ჯაჭვის სტრიქონები (ეკრანი და PDF) */
export function chainRows(c) {
  const rows = [
    { sign: '', label: 'ყოველთვიური სამივლინებო თანხა', value: c.S },
    { sign: '−', label: 'ბინის ქირა (სრული)', short: 'ქირა', value: c.G },
  ];
  if (c.hasEdu) {
    rows.push({ sign: '−', label: 'სწავლის გადასახადი (სრული)', short: 'სწავლის გადასახადი', value: c.eduExpense });
    rows.push({ sign: '+', label: 'სწავლის ანაზღაურება', short: 'სწავლის ანაზღაურება', value: c.eduReimb });
  }
  rows.push({ sign: '=', label: 'დარჩენილი თანხა ქირისა და სწავლის შემდეგ', short: 'ქირისა და სწავლის შემდეგ', value: c.remainder, strong: true, testid: 'chain-remainder' });
  rows.push({ sign: '−', label: c.living.label ?? 'საორიენტაციო საცხოვრებელი ხარჯი (Numbeo, ქირის და სწავლის გარეშე)', short: `საცხოვრებელი ხარჯი (Numbeo${c.living.estimated ? ', ≈ ინდექსით' : ''})`, value: c.living.deduction });
  rows.push({ sign: '=', label: 'დარჩენილი თანხა ქირის, სწავლისა და საცხოვრებელი ხარჯების შემდეგ (საორიენტაციო)', short: 'საბოლოოდ (საორიენტაციო)', value: c.living.value, strong: true, testid: 'remainder-living' });
  return rows;
}
export const CHAIN_NOTE = 'Numbeo-ს შეფასება ქირასა და სწავლას არ შეიცავს — ქირა ზემოთ ერთხელ აკლდება.';

export function renderChain(c, cur, { loading = false } = {}) {
  return h('section', { class: 'chain', 'data-testid': 'chain', 'aria-label': 'როგორ მივიღეთ დარჩენილი თანხა' },
    h('ol', { class: 'chain-list' }, chainRows(c).map((x) => h('li', { class: 'chain-row' + (x.strong ? ' strong' : '') },
      h('span', { class: 'chain-sign', 'aria-hidden': 'true' }, x.sign),
      h('span', { class: 'chain-l' }, x.label),
      h('span', { class: 'chain-v' + neg(x.value), 'data-value': x.value ?? '', 'data-testid': x.testid ?? null }, x.value == null && loading ? '…' : money(x.value, cur))))),
    h('p', { class: 'tiny muted' }, c.living.note ? `${c.living.note}. ${CHAIN_NOTE}` : loading ? 'ფასები იტვირთება…' : 'საცხოვრებელი ხარჯის შეფასება ამ ქალაქისთვის მიუწვდომელია.'));
}

/** ქირის ანაზღაურების დაშლა */
export function rentBreakdownRows(c) {
  const r = c.rent;
  const rows = [
    { label: 'ბინის ძირითადი წილი (T)', value: r.T },
    { label: 'სამსახურის დამატებითი ანაზღაურება', value: r.FminusT },
    { label: 'სულ ანაზღაურება (F)', value: r.F, strong: true },
  ];
  if (r.surplus != null && Number(r.surplus) > 0) rows.push({ label: 'ანაზღაურება აღემატება ქირას (F − G)', value: r.surplus });
  else rows.push({ label: 'თქვენ ამატებთ', value: r.extra, strong: true });
  return rows;
}
