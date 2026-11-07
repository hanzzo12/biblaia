// ცხოვრების ღირებულების მოკლე ბლოკი (MarketData v2 + §9). საორიენტაციოა; ოფიციალურ S-ს არ ცვლის.
import { h, icon } from './dom.js';
import * as P from '../providers/index.js';
import { formatAmount } from '../core/index.js';
import { R, sub, add, toFixed2 } from '../core/rational.js';

export const GROCERIES_LABEL = 'სურსათი — 15 ძირითადი პროდუქტის ერთეულის ფასი ჯამში (1 ლ რძე, 1 კგ ბრინჯი, 12 კვერცხი…), არა თვიური ან კვირის ხარჯი';
export const WITH_DATA = new Set(['fresh', 'cached', 'stale', 'partial']);
export const suggestBedrooms = (n) => (typeof P.suggestBedrooms === 'function' ? P.suggestBedrooms(n) : (n >= 2 ? 3 : 1));
const money = (x, cur) => (x == null ? '—' : `${formatAmount(x)} ${cur ?? ''}`.trim());
const avg = (p) => (p && typeof p === 'object' ? p.average ?? null : p ?? null);
const hasData = (md) => !!md && WITH_DATA.has(md.status);
const kaDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? '')); return m ? `${m[3]}.${m[2]}.${m[1]}` : (s ? String(s) : ''); };
const warn = (md, code) => (md?.warnings || []).find((w) => w.code === code) || null;

export const rentFor = (md, beds) => (hasData(md) ? avg(md.rent?.items?.[`centre_${beds}br`]) : null);

/**
 * საორიენტაციო საცხოვრებელი ხარჯი ქირის გარეშე (§9 პ.2): ბიუჯეტი (1 პირი / ოჯახი 4) ან კომუნალური + ინტერნეტი.
 * @returns {{ deduction: any|null, label: string|null, note: string|null }}
 */
export function livingDeduction(md, familyCount) {
  if (!hasData(md)) return { deduction: null, label: null, note: null };
  const b = md.budget; const alone = familyCount === 0;
  const budget = b ? avg(alone ? b.single : b.family4) : null;
  if (budget != null) {
    const est = b.estimated === true || b.basis === 'estimated-from-index' || (md.warnings || []).some((w) => w.code === 'budget_estimated');
    const who = alone ? 'ერთი პირის' : 'ოთხსულიანი ოჯახის';
    return { deduction: R(budget), estimated: est, kind: 'budget',
      label: `საორიენტაციო საცხოვრებელი ხარჯი — ${who} (Numbeo, ქირის და სწავლის გარეშე: კომუნალური, კვება, ტრანსპორტი)${est ? ' · ≈ ინდექსით შეფასებული' : ''}`,
      note: `გამოკლებულია ${who} თვიური ხარჯი ქირის გარეშე (Numbeo${est ? ', ≈ ინდექსით შეფასებული' : ''})` };
  }
  const u = avg(md.utilities?.basic85m2); const i = avg(md.utilities?.internet);
  if (u == null && i == null) return { deduction: null, label: null, note: null };
  return { deduction: add(R(u ?? '0'), R(i ?? '0')), kind: 'utilities', label: 'კომუნალური (85 მ²) + ინტერნეტი (Numbeo)', note: 'გამოკლებულია კომუნალური (85 მ²) და ინტერნეტი' };
}

/**
 * საორიენტაციო ნაშთი საცხოვრებელი ხარჯების შემდეგ. remainder — ათწილადი სტრიქონი ან რაციონალი.
 * @returns {{ value: string|null, note: string|null, deduction: string|null, label: string|null }}
 */
export function livingRemainder(remainder, md, familyCount) {
  const d = livingDeduction(md, familyCount);
  if (remainder == null || !d.deduction) return { value: null, note: d.note, deduction: d.deduction ? toFixed2(d.deduction) : null, label: d.label, estimated: !!d.estimated, kind: d.kind ?? null };
  return { value: toFixed2(sub(R(remainder), d.deduction)), note: d.note, deduction: toFixed2(d.deduction), label: d.label, estimated: !!d.estimated, kind: d.kind };
}

/** ბლოკის სტრიქონები — ეკრანისა და PDF-ის საერთო წყარო. */
export function marketRows(md, beds, { compact = false, familyCount = 0 } = {}) {
  if (!hasData(md)) return null;
  const cur = md.currency;
  const u = md.utilities || {}; const g = md.groceries || {}; const r = md.restaurants || {}; const b = md.budget || null;
  const c = avg(md.rent?.items?.[`centre_${beds}br`]); const o = avg(md.rent?.items?.[`outside_${beds}br`]);
  const rows = [];
  rows.push(compact
    ? { label: `ქირა, ${beds} საძ. (ცენტრი)`, value: money(c, cur), raw: c }
    : { label: `ქირა, ${beds} საძინებელი`, value: `ცენტრი ${money(c, cur)} · გარეუბანი ${money(o, cur)}`, raw: c, testid: 'market-rent' });
  rows.push({ label: compact ? 'კომუნალური + ინტ.' : 'კომუნალური (85 მ²) + ინტერნეტი', value: avg(u.basic85m2) != null || avg(u.internet) != null ? `${money(avg(u.basic85m2), cur)} + ${money(avg(u.internet), cur)}` : '—', raw: avg(u.basic85m2) });
  rows.push({ label: GROCERIES_LABEL, value: money(g.basketItemsSum, cur), raw: g.basketItemsSum, long: true });
  rows.push({ label: compact ? 'რესტორანი' : 'რესტორანი (ბიუჯეტური / საშუალო 2 პირზე)', value: avg(r.inexpensiveMeal) != null || avg(r.midRangeForTwo) != null ? `${money(avg(r.inexpensiveMeal), cur)} / ${money(avg(r.midRangeForTwo), cur)}` : '—', raw: avg(r.inexpensiveMeal) });
  if (b && (avg(b.single) != null || avg(b.family4) != null)) {
    const est = b.estimated || b.basis === 'estimated-from-index';
    rows.push({ label: (compact ? 'თვიური ხარჯი (1 / 4 პირი)' : 'თვიური ხარჯი ქირის გარეშე (1 პირი / ოჯახი 4)') + (est ? ' ≈ ინდექსით' : ''), value: `${money(avg(b.single), cur)} / ${money(avg(b.family4), cur)}`, raw: avg(familyCount === 0 ? b.single : b.family4), testid: compact ? null : 'market-budget' });
  }
  return rows;
}

/** მცირე შენიშვნები: ასლი, დედაქალაქი, კურსი. */
export function marketNotes(md) {
  if (!md) return [];
  const out = [];
  const snap = warn(md, 'snapshot_copy');
  if (snap) out.push({ kind: 'badge', text: snap.message_ka || `შენახული მონაცემი · ${kaDate(md.fetchedAt ?? md.budget?.sourceUpdatedAt)}` });
  const cap = warn(md, 'capital_fallback');
  if (cap || md.resolvedLocation?.matchStatus === 'capital-fallback') {
    out.push({ kind: 'line', text: cap?.message_ka || `ქალაქის მონაცემი არ მოიძებნა — ნაჩვენებია დედაქალაქის (${md.resolvedLocation?.city ?? '—'}) მონაცემი` });
  }
  const be = warn(md, 'budget_estimated');
  if (be) out.push({ kind: 'tiny', text: be.message_ka || '≈ შეფასებულია Numbeo-ს ინდექსით' });
  const fx = warn(md, 'reference_fx');
  if (fx) out.push({ kind: 'tiny', text: fx.message_ka || '≈ გადაყვანილია USD-დან Numbeo-ს კურსით (საორიენტაციოდ)' });
  return out;
}

function row(x) {
  return h('div', { class: 'mrow' + (x.long ? ' long' : '') }, h('span', { class: 'mrow-l' }, x.label), h('span', { class: 'mrow-v', 'data-value': x.raw ?? '', 'data-testid': x.testid ?? null }, x.value));
}

export function skeleton(rows = 4) {
  return h('div', { class: 'mlist', 'aria-hidden': 'true' }, Array.from({ length: rows }, () => h('div', { class: 'mrow' }, h('span', { class: 'sk' }), h('span', { class: 'sk sk-s' }))));
}

/** md = null + loading → ჩონჩხი; მონაცემის გარეშე → ერთი ნაცრისფერი ხაზი. */
export function marketList(md, beds, { loading = false, source = true, compact = false, familyCount = 0 } = {}) {
  if (loading) return h('div', { class: 'market-load', 'aria-busy': 'true' }, h('span', { class: 'sr-only' }, 'ფასები იტვირთება'), skeleton());
  if (md?.status === 'pending_refresh') return h('p', { class: 'muted small', 'data-testid': 'market-unavailable' }, 'ფასები მალე განახლდება');
  const rows = marketRows(md, beds, { compact, familyCount });
  if (!rows) return h('p', { class: 'muted small', 'data-testid': 'market-unavailable' }, 'ფასები ამჟამად მიუწვდომელია');
  const notes = marketNotes(md);
  return h('div', { class: 'mlist' },
    notes.filter((n) => n.kind === 'badge').map((n) => h('span', { class: 'mbadge' }, n.text)),
    notes.filter((n) => n.kind === 'line').map((n) => h('p', { class: 'muted small mnote' }, n.text)),
    rows.map(row),
    md.indices?.costOfLiving != null ? h('p', { class: 'mindex' }, compact ? `ინდექსი: ${md.indices.costOfLiving} (ნიუ-იორკი = 100)` : `ცხოვრების ღირებულების ინდექსი: ${md.indices.costOfLiving} (ნიუ-იორკი = 100)`) : null,
    source ? notes.filter((n) => n.kind === 'tiny').map((n) => h('p', { class: 'msource' }, n.text)) : null,
    source && md.provider ? h('p', { class: 'msource' },
      md.provider.sourceUrl ? h('a', { href: md.provider.sourceUrl, rel: 'noopener noreferrer', target: '_blank' }, md.provider.attribution_ka || 'წყარო: Numbeo.com') : (md.provider.attribution_ka || ''),
      md.fetchedAt ? ` · ${kaDate(md.fetchedAt)}` : '') : null);
}

/* ---------- ფილები (ეკრანი): ხატულა + დიდი ციფრი + მოკლე წარწერა ---------- */
// ხატულები ხელით დახატულია (24×24, stroke) — გარე ბიბლიოთეკის გარეშე.
const ICONS = {
  rent: ['M3 10.5 12 3l9 7.5', 'M5 9.5V21h14V9.5', 'M10 21v-6h4v6'],
  bolt: ['M13 2 4 14h7l-1 8 9-12h-7z'],
  wifi: ['M2 8.8a15 15 0 0 1 20 0', 'M5 12.3a10 10 0 0 1 14 0', 'M8.5 15.8a5 5 0 0 1 7 0', 'M12 19.5h.01'],
  cart: ['M3 3h2l2.4 11.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 1.9-1.4L21 8H6.2', 'M9.5 20.5h.01', 'M17.5 20.5h.01'],
  food: ['M4 2v7a3 3 0 0 0 3 3v10', 'M10 2v7a3 3 0 0 1-3 3', 'M7 2v6', 'M19 22V2c-2.5 1-4 3.5-4 7v4h4'],
  wallet: ['M20 7H5a2 2 0 0 1 0-4h13v4', 'M3 5v14a2 2 0 0 0 2 2h15v-4', 'M20 11h-4a2 2 0 0 0 0 4h4z'],
  chart: ['M3 3v18h18', 'M7 15l4-4 3 3 6-7'],
};
function tile(key, label, value, sub, o = {}) {
  return h('li', { class: 'irow', 'data-tile': key, title: o.title ?? null },
    icon(ICONS[o.icon ?? key]),
    h('span', { class: 'irow-t' }, h('span', { class: 'irow-l' }, label), sub ? h('span', { class: 'irow-s' }, sub) : null,
      o.hidden ? h('span', { class: 'sr-only' }, o.hidden) : null),
    h('span', { class: 'irow-v', 'data-value': o.raw ?? '', 'data-testid': o.testid ?? null }, value));
}

/** ცხოვრების ღირებულების ფილები. compact — შედარების ბარათისთვის. */
export function marketTiles(md, beds, { loading = false, compact = false, familyCount = 0, source = true } = {}) {
  if (loading) return h('div', { class: 'market-load', 'aria-busy': 'true' }, h('span', { class: 'sr-only' }, 'ფასები იტვირთება'), skeleton(3));
  if (md?.status === 'pending_refresh') return h('p', { class: 'muted small', 'data-testid': 'market-unavailable' }, 'ფასები მალე განახლდება');
  if (!hasData(md)) return h('p', { class: 'muted small', 'data-testid': 'market-unavailable' }, 'ფასები ამჟამად მიუწვდომელია');
  const cur = md.currency;
  const m = (x) => (x == null ? '—' : `${formatAmount(x)} ${cur}`);
  const u = md.utilities || {}; const g = md.groceries || {}; const r = md.restaurants || {}; const b = md.budget || null;
  const c = avg(md.rent?.items?.[`centre_${beds}br`]); const o = avg(md.rent?.items?.[`outside_${beds}br`]);
  const alone = familyCount === 0;
  const bud = b ? avg(alone ? b.single : b.family4) : null;
  const est = !!b && (b.estimated === true || b.basis === 'estimated-from-index');
  const notes = marketNotes(md);
  const tiles = [
    tile('rent', 'ქირა', m(c), `ცენტრი · ${beds} საძ.${o != null && !compact ? ` · გარეუბანი ${formatAmount(o)}` : ''}`, { raw: c, testid: compact ? null : 'market-rent' }),
    tile('utilities', 'კომუნალური', m(avg(u.basic85m2)), '85 მ² ბინა, თვეში', { icon: 'bolt', raw: avg(u.basic85m2) }),
    tile('internet', 'ინტერნეტი', m(avg(u.internet)), 'თვეში', { icon: 'wifi', raw: avg(u.internet) }),
    tile('groceries', 'სურსათი', m(g.basketItemsSum), '15 პროდუქტის ერთ. ფასი · არა თვიური', { icon: 'cart', raw: g.basketItemsSum, title: GROCERIES_LABEL, hidden: GROCERIES_LABEL }),
    tile('restaurants', 'რესტორანი', m(avg(r.inexpensiveMeal)), `ბიუჯეტური · 2 პირზე ${avg(r.midRangeForTwo) != null ? formatAmount(avg(r.midRangeForTwo)) : '—'}`, { icon: 'food', raw: avg(r.inexpensiveMeal) }),
    tile('budget', 'თვიური ხარჯი', m(bud), `${alone ? '1 პირი' : 'ოჯახი (4)'} · ქირის გარეშე${est ? ' · ≈ ინდექსით' : ''}`, { icon: 'wallet', raw: bud, testid: compact ? null : 'market-budget',
      hidden: b ? `1 პირი: ${m(avg(b.single))}; ოჯახი 4: ${m(avg(b.family4))}` : null }),
    tile('index', 'ინდექსი', md.indices?.costOfLiving != null ? String(md.indices.costOfLiving) : '—', `ცხოვრება${md.indices?.costOfLivingPlusRent != null ? ` · +ქირა ${md.indices.costOfLivingPlusRent}` : ''} · ნიუ-იორკი = 100`, { icon: 'chart', raw: md.indices?.costOfLiving ?? null }),
  ].filter(Boolean);
  const small = [...notes.map((n) => n.text), source && md.provider ? null : null].filter(Boolean);
  return h('div', { class: 'mtiles-wrap' },
    h('ul', { class: 'ilist' + (compact ? ' compact' : '') }, tiles),
    small.length ? h('p', { class: 'mnotes' }, small.join(' · ')) : null,
    source && md.provider ? h('p', { class: 'msource' },
      md.provider.sourceUrl ? h('a', { href: md.provider.sourceUrl, rel: 'noopener noreferrer', target: '_blank' }, md.provider.attribution_ka || 'წყარო: Numbeo.com') : (md.provider.attribution_ka || ''),
      md.fetchedAt ? ` · ${kaDate(md.fetchedAt)}` : '') : null);
}
