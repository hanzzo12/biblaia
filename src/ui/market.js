// ცხოვრების ღირებულების მოკლე ბარათი (MarketData v2). საორიენტაციოა; გაანგარიშებას არ ცვლის.
import { h } from './dom.js';
import * as P from '../providers/index.js';
import { formatAmount } from '../core/index.js';

export const WITH_DATA = new Set(['fresh', 'cached', 'stale', 'partial']);
export const suggestBedrooms = (n) => (typeof P.suggestBedrooms === 'function' ? P.suggestBedrooms(n) : (n >= 2 ? 3 : 1));
const money = (x, cur) => (x == null ? '—' : `${formatAmount(x)} ${cur ?? ''}`.trim());

export const rentFor = (md, beds) => (md && WITH_DATA.has(md.status) ? md.rent?.items?.[`centre_${beds}br`]?.average ?? null : null);

function row(label, value, raw, testid) {
  return h('div', { class: 'mrow' }, h('span', { class: 'mrow-l' }, label), h('span', { class: 'mrow-v', 'data-value': raw ?? '', 'data-testid': testid ?? null }, value));
}

export function skeleton(rows = 4) {
  return h('div', { class: 'mlist', 'aria-hidden': 'true' }, Array.from({ length: rows }, () => h('div', { class: 'mrow' }, h('span', { class: 'sk' }), h('span', { class: 'sk sk-s' }))));
}

/** 4 სტრიქონი + ინდექსი + წყარო. md = null → იტვირთება; მონაცემის გარეშე → ერთი ნაცრისფერი ხაზი. */
export function marketList(md, beds, { loading = false, source = true, compact = false } = {}) {
  if (loading) return h('div', { class: 'market-load', 'aria-busy': 'true' }, h('span', { class: 'sr-only' }, 'ფასები იტვირთება'), skeleton());
  if (!md || !WITH_DATA.has(md.status)) return h('p', { class: 'muted small', 'data-testid': 'market-unavailable' }, 'ფასები ამჟამად მიუწვდომელია');
  const cur = md.currency;
  const u = md.utilities || {}; const g = md.groceries || {}; const r = md.restaurants || {};
  const rent = md.rent?.items?.[`centre_${beds}br`]?.average ?? null;
  const util = u.basic85m2?.average != null || u.internet?.average != null
    ? `${money(u.basic85m2?.average, cur)}${u.internet?.average != null ? ` + ${money(u.internet.average, cur)}` : ''}` : '—';
  const rest = r.inexpensiveMeal?.average != null || r.midRangeForTwo?.average != null
    ? `${money(r.inexpensiveMeal?.average, cur)} / ${money(r.midRangeForTwo?.average, cur)}` : '—';
  return h('div', { class: 'mlist' },
    row(compact ? `ქირა, ${beds} საძ.` : `ქირა ცენტრში (${beds} საძინებელი)`, money(rent, cur), rent, compact ? null : 'market-rent'),
    row(compact ? 'კომუნალური + ინტ.' : 'კომუნალური (85 მ²) + ინტერნეტი', util, u.basic85m2?.average),
    row(compact ? 'სურსათი' : 'სურსათი (ძირითადი კალათა)', money(g.basketItemsSum, cur), g.basketItemsSum),
    row(compact ? 'რესტორანი' : 'რესტორანი (ბიუჯეტური / საშუალო 2 პირზე)', rest, r.inexpensiveMeal?.average),
    md.indices?.costOfLiving != null ? h('p', { class: 'mindex' }, compact ? `ინდექსი: ${md.indices.costOfLiving} (ნიუ-იორკი = 100)` : `ცხოვრების ღირებულების ინდექსი: ${md.indices.costOfLiving} (ნიუ-იორკი = 100)`) : null,
    source && md.provider ? h('p', { class: 'msource' },
      md.provider.sourceUrl ? h('a', { href: md.provider.sourceUrl, rel: 'noopener noreferrer', target: '_blank' }, md.provider.attribution_ka || 'წყარო: Numbeo.com') : (md.provider.attribution_ka || ''),
      md.fetchedAt ? ` · ${String(md.fetchedAt).slice(0, 10)}` : '') : null);
}
