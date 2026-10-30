// ბაზრის ბლოკი (MarketData v2, contracts §8): ქირა, კომუნალური, სურსათი, რესტორნები. საორიენტაციოა; ოფიციალურ გაანგარიშებას არ ცვლის.
import { h, replace, uid } from '../dom.js';
import { L, MARKET_STATUS, MARKET_FRIENDLY } from '../labels.js';
import * as P from '../../providers/index.js';
import { formatAmount } from '../../core/index.js';
import { TRANSIENT } from '../market-service.js';

const WITH_DATA = new Set(['fresh', 'cached', 'stale', 'partial']);
export const suggestBedrooms = (n) => (typeof P.suggestBedrooms === 'function' ? P.suggestBedrooms(n) : (n >= 2 ? 3 : 1));
const day = (iso) => (iso ? String(iso).slice(0, 10) : null);
const money = (x, cur) => (x == null ? null : `${formatAmount(x)} ${cur ?? ''}`.trim());
const statusText = (s) => MARKET_STATUS[s] ?? P.MARKET_STATUS_LABELS_KA?.[s] ?? s;

/** ერთი კატეგორიის მნიშვნელობა: დიდი ციფრი + წარწერა. */
function figure(label, value, opts = {}) {
  return h('div', { class: 'fig' + (opts.big ? ' big' : '') },
    h('span', { class: 'fig-label' }, label),
    h('span', { class: 'fig-value', 'data-value': opts.raw ?? '', 'data-testid': opts.testid ?? null }, value ?? '—'),
    opts.sub ? h('span', { class: 'fig-sub' }, opts.sub) : null);
}
const indexLine = (label, v) => (v == null ? null : h('p', { class: 'idx' }, `${label}: `, h('strong', null, v), ' (ნიუ-იორკი = 100)'));

export function skeletonCards(n = 4) {
  return h('div', { class: 'mcards', 'aria-hidden': 'true' }, Array.from({ length: n }, () =>
    h('div', { class: 'mcard skeleton' }, h('span', { class: 'sk sk-title' }), h('span', { class: 'sk sk-big' }), h('span', { class: 'sk sk-line' }))));
}

/** ოთხი ბარათი; compact — შედარებისთვის (ღილაკების გარეშე). */
export function marketCards(md, { area = 'centre', bedrooms = 1, compact = false, controls = null } = {}) {
  const cur = md.currency;
  const metric = `${area}_${bedrooms}br`;
  const price = md.rent?.items?.[metric] ?? null;
  const g = md.groceries || {};
  const card = (key, title, status, ...body) => h('section', { class: `mcard mcard-${key}`, 'aria-label': title, 'data-card': key },
    h('h4', null, title, status && status !== md.status && !WITH_DATA.has(status) ? h('span', { class: `badge st-${status}` }, statusText(status)) : null), ...body);
  return h('div', { class: 'mcards' + (compact ? ' compact' : '') },
    card('rent', 'ქირა', md.rent?.status,
      controls,
      figure(`${area === 'centre' ? 'ცენტრი' : 'ცენტრის გარეთ'} · ${bedrooms} საძინებელი`, price ? money(price.average, cur) : null,
        { big: true, raw: price?.average ?? '', testid: compact ? null : 'market-rent-average', sub: price && (price.low || price.high) ? `დიაპაზონი: ${price.low ? formatAmount(price.low) : '—'} – ${price.high ? formatAmount(price.high) : '—'}` : 'თვეში, საშუალო' }),
      compact ? null : indexLine('ქირის ინდექსი', md.rent?.rentIndex ?? md.indices?.rent)),
    card('utilities', 'კომუნალური', md.utilities?.status,
      figure('ძირითადი, 85 მ² ბინა', money(md.utilities?.basic85m2?.average, cur), { big: true, raw: md.utilities?.basic85m2?.average ?? '', sub: 'თვეში: დენი, გათბობა/გაგრილება, წყალი, ნაგავი' }),
      figure('ინტერნეტი', money(md.utilities?.internet?.average, cur), { raw: md.utilities?.internet?.average ?? '', sub: 'თვეში' })),
    card('groceries', 'სურსათი', g.status,
      figure('ჩამონათვლის ფასების ჯამი', money(g.basketItemsSum, cur), { big: true, raw: g.basketItemsSum ?? '',
        sub: 'ცალკეული ერთეულების (1 ლ რძე, 1 კგ ბრინჯი…) ფასების ჯამი — არა თვიური ხარჯი' + (g.itemsMissing ? `; ${g.itemsMissing} ერთეული აკლია` : '') }),
      compact ? null : indexLine('სურსათის ინდექსი', g.groceriesIndex ?? md.indices?.groceries)),
    card('restaurants', 'რესტორნები', md.restaurants?.status,
      figure('ბიუჯეტური კვება, 1 პირი', money(md.restaurants?.inexpensiveMeal?.average, cur), { big: true, raw: md.restaurants?.inexpensiveMeal?.average ?? '' }),
      figure('საშუალო რესტორანი, 2 პირი', money(md.restaurants?.midRangeForTwo?.average, cur), { raw: md.restaurants?.midRangeForTwo?.average ?? '', sub: 'სამი კერძი' }),
      compact ? null : indexLine('რესტორნების ინდექსი', md.restaurants?.restaurantIndex ?? md.indices?.restaurants)));
}

/** სტატუსის/წყაროს ზოლი */
export function marketMeta(md, { online }) {
  const s = md.status;
  const when = day(md.fetchedAt);
  const badgeText = s === 'cached' ? `შენახული ასლი${when ? ' · ' + when : ''}` : s === 'stale' ? `მოძველებული${when ? ' · ' + when : ''}` : s === 'fresh' ? `განახლებულია${when ? ' · ' + when : ''}` : statusText(s);
  return h('div', { class: 'mmeta' },
    h('span', { class: `badge st-${s}`, 'data-status': s }, badgeText),
    md.indices?.costOfLiving != null ? h('span', null, `ცხოვრების ღირებულების ინდექსი: ${md.indices.costOfLiving} (ნიუ-იორკი = 100)`) : null,
    md.resolvedLocation?.matchStatus === 'nearby-explained' ? h('span', { class: 'warn-inline' }, `ახლომდებარე ქალაქი: ${md.resolvedLocation.providerCity ?? md.resolvedLocation.city ?? ''}`) : null,
    md.provider ? h('span', { class: 'attrib' }, md.provider.sourceUrl ? h('a', { href: md.provider.sourceUrl, rel: 'noopener noreferrer', target: '_blank' }, md.provider.attribution_ka || 'წყარო: Numbeo.com') : (md.provider.attribution_ka || '')) : null,
    !online ? null : null);
}

export function mountMarket(root, store, deps) {
  const m = store.market = store.market || { locationId: null, currency: null, md: null, area: 'centre', bedrooms: null, bedroomsTouched: false, confirm: false, token: 0, startedAt: 0 };
  const box = h('div', { class: 'market', 'aria-live': 'polite', 'aria-busy': 'false', 'data-testid': 'market-block' });
  root.append(box);
  let slowTimer = null;

  async function load(locationId, currency, force = false) {
    m.locationId = locationId; m.currency = currency; m.confirm = false;
    const token = ++m.token;
    m.md = null;
    if (!locationId) { render(); return; }
    m.loading = true; m.startedAt = Date.now();
    render();
    clearTimeout(slowTimer);
    slowTimer = setTimeout(() => { if (m.loading && token === m.token) render(); }, 8000);
    const md = await deps.service.get(locationId, currency, { force });
    if (token !== m.token) return; // გვიან მოსული პასუხი სხვა ქალაქისთვის
    m.loading = false; m.md = md;
    render();
  }

  function bedrooms() { return m.bedroomsTouched && m.bedrooms ? m.bedrooms : suggestBedrooms(store.scenario.family.length); }

  function controls() {
    const seg = (name, legend, options, cur, onPick) => {
      const nm = uid('r');
      return h('fieldset', { class: 'seg' }, h('legend', { class: 'sr-only' }, legend), options.map(([v, label]) => {
        const id = uid('f');
        const inp = h('input', { id, type: 'radio', name: nm, value: String(v), checked: v === cur });
        inp.addEventListener('change', () => { onPick(v); render(); box.querySelector(`[data-seg="${name}"] input:checked`)?.focus(); });
        return h('span', { class: 'seg-opt' }, inp, h('label', { for: id }, label));
      }));
    };
    const b = bedrooms();
    const area = seg('area', 'უბანი', [['centre', 'ცენტრი'], ['outside', 'გარეუბანი']], m.area, (v) => { m.area = v; m.confirm = false; });
    area.setAttribute('data-seg', 'area');
    const beds = seg('beds', 'საძინებლები', [[1, '1 საძინებელი'], [3, '3 საძინებელი']], b, (v) => { m.bedrooms = v; m.bedroomsTouched = true; m.confirm = false; });
    beds.setAttribute('data-seg', 'beds');
    return h('div', { class: 'rent-controls' }, area, beds,
      !m.bedroomsTouched ? h('p', { class: 'hint' }, `შერჩეულია ოჯახის მიხედვით (${store.scenario.family.length ? 'თქვენ + ' + store.scenario.family.length : 'მარტო'}); 2-საძინებლიანის მონაცემი წყაროს არ აქვს.`) : null);
  }

  function useButton(md) {
    const metric = `${m.area}_${bedrooms()}br`;
    const price = md.rent?.items?.[metric];
    const fund = deps.fundingCurrency();
    let reason = null;
    if (!price?.average) reason = 'ამ ტიპის ბინის ფასი არ არის.';
    else if (!fund) reason = 'ჯერ აირჩიეთ დაწესებულება.';
    else if (md.currency !== fund) reason = `ფასი ${md.currency}-შია, დაფინანსება — ${fund}-ში; კონვერტაცია არ ხდება.`;
    const rid = uid('h');
    const btn = h('button', { type: 'button', class: 'btn', disabled: !!reason, 'aria-describedby': rid, 'data-testid': 'use-market-rent' }, L.useAsPlannedRent);
    const apply = () => {
      m.confirm = false;
      deps.onUseRent({ amount: price.average, marketRef: { locationId: md.requestedLocationId, providerId: md.provider?.id ?? 'numbeo-apify', metric, fetchedAt: md.fetchedAt ?? null } });
      render();
    };
    btn.addEventListener('click', () => {
      const r = store.scenario.rent;
      if (r.amount != null && r.basis !== 'market-scenario') { m.confirm = true; render(); box.querySelector('[data-confirm-yes]')?.focus(); return; }
      apply();
    });
    const out = [btn, h('span', { id: rid, class: 'hint' }, reason ?? ' გადაიტანს ფასს ქირის ველში — გაანგარიშება მოინიშნება სცენარად.')];
    if (m.confirm && !reason) {
      const yes = h('button', { type: 'button', class: 'btn', 'data-confirm-yes': '' }, 'დიახ, ჩავანაცვლო');
      const no = h('button', { type: 'button', class: 'btn ghost' }, 'გაუქმება');
      yes.addEventListener('click', apply);
      no.addEventListener('click', () => { m.confirm = false; render(); });
      out.push(h('div', { class: 'confirm', role: 'group', 'aria-label': 'ქირის ჩანაცვლება' },
        h('p', null, `ქირის ველში უკვე წერია ${formatAmount(store.scenario.rent.amount)}. ჩავანაცვლო ${formatAmount(price.average)} ${md.currency}-ით?`), yes, ' ', no));
    }
    return h('div', { class: 'use-rent' }, out);
  }

  function render() {
    const loc = (store.data.locations || []).find((l) => l.id === m.locationId);
    if (!m.locationId) { replace(box); box.hidden = true; return; }
    box.hidden = false;
    const head = h('div', { class: 'market-head' }, h('h3', null, `ცხოვრების ხარჯები — ${loc?.name_ka ?? ''}`), h('span', { class: 'hint' }, 'საორიენტაციო ფასები; ოფიციალურ გაანგარიშებაზე გავლენა არ აქვს'));
    if (m.loading) {
      box.setAttribute('aria-busy', 'true');
      const long = Date.now() - m.startedAt > 7000;
      replace(box, head, h('p', { class: 'loading-note', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }),
        long ? 'ფასები იტვირთება — პირველად ამ ქალაქისთვის შეიძლება 1–1½ წუთი დასჭირდეს. კალკულატორით სარგებლობა შეგიძლიათ.' : 'ფასები იტვირთება…'),
      skeletonCards());
      return;
    }
    box.setAttribute('aria-busy', 'false');
    const md = m.md;
    if (!md) { replace(box, head); return; }
    if (!deps.service.online || !WITH_DATA.has(md.status)) {
      const retry = deps.service.online && TRANSIENT.has(md.status) ? h('button', { type: 'button', class: 'btn ghost' }, 'თავიდან ცდა') : null;
      if (retry) retry.addEventListener('click', () => load(m.locationId, m.currency, true));
      replace(box, head, h('div', { class: 'empty-state', 'data-status': md.status, 'data-testid': deps.service.online ? 'market-empty' : 'offline-note' },
        h('p', null, !deps.service.online ? MARKET_FRIENDLY.offline : (MARKET_FRIENDLY[md.status] ?? statusText(md.status))), retry));
      return;
    }
    replace(box, head,
      marketCards(md, { area: m.area, bedrooms: bedrooms(), controls: controls() }),
      useButton(md),
      marketMeta(md, { online: true }),
      (md.warnings || []).length ? h('details', { class: 'mwarn' }, h('summary', null, `შენიშვნები (${md.warnings.length})`),
        h('ul', null, md.warnings.map((w) => h('li', null, w.message_ka ?? P.MARKET_WARNING_LABELS_KA?.[w.code] ?? w.code)))) : null);
  }

  render();
  return { load, render, summary: () => (m.md && WITH_DATA.has(m.md.status) ? { md: m.md, area: m.area, bedrooms: bedrooms() } : null) };
}
