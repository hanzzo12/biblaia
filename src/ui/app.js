// მარტივი ოთხსაფეხურიანი კალკულატორი. გამოთვლა — მხოლოდ src/core-ით; ბაზრის ფასები — საორიენტაციოდ.
import { h, replace, uid } from './dom.js';
import * as core from '../core/index.js';
import { missionPicker, shortName } from './picker.js';
import { marketList, suggestBedrooms, rentFor } from './market.js';
import { createMarketService } from './market-service.js';
import { renderResult, resultModel } from './result.js';
import { resultPdf, downloadBytes } from './pdf/reports.js';
import { mountCompare } from './compare.js';

const STEPS = ['მისია', 'თანამდებობა და ოჯახი', 'ქირა, სწავლა, ხარჯები', 'შედეგი'];
const ROLE_KA = { spouse: 'მეუღლე', child: 'შვილი', guardianship: 'მეურვეობის ქვეშ მყოფი' };

/** "1500,5" → "1500.5"; ცარიელი → null; შეცდომა → { error } */
export function parseMoney(raw) {
  const r = core.parseDecimalInput(String(raw ?? ''));
  return r.ok ? { value: r.normalized } : { value: null, error: r.error_ka };
}
const parseAge = (raw) => { const s = String(raw ?? '').trim(); return /^\d{1,3}$/.test(s) && Number(s) <= 120 ? Number(s) : null; };

export function startApp({ data, meta, online, client }) {
  const service = createMarketService({ online, client });
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthEnd = `${month}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
  const fresh = () => ({
    step: 1, maxStep: 1, missionId: null, mode: 'annex2', entryId: null, head: false, headTouched: false, ageRaw: '',
    family: [], nextId: 1, rentRaw: '', rentFromMarket: false, edu: {},
    ex: { insurance: false, baggage: false, broker: false, settlement: false }, policy: {}, bagRaw: '', brokerRaw: '', dailyOverride: false, dailyRaw: '', dailyCur: null,
  });
  let st = fresh();
  const market = { locationId: null, md: null, loading: false, token: 0 };
  const app = document.getElementById('app');
  const mission = () => (st.missionId ? core.resolveMission(data, st.missionId) : null);
  const beds = () => suggestBedrooms(st.family.length);
  const profiles = () => core.positionProfiles(data);

  /** ScenarioV1 მიმდინარე მდგომარეობიდან (contracts §2). */
  function scenario({ missionId = st.missionId, rent, extras = true, keepEdu = true } = {}) {
    const sc = core.emptyScenario();
    sc.missionId = missionId;
    sc.position = { mode: 'annex2', entryId: st.entryId };
    sc.status.rentHead = st.head ? 'head' : 'not-head';
    sc.period = { mode: 'full-month', month };
    sc.employee.age = parseAge(st.ageRaw);
    sc.family = st.family.map((f, i) => ({
      ...core.emptyFamilyMember(f.id, `${ROLE_KA[f.role]} ${i + 1}`),
      role: f.role === 'guardianship' ? 'other' : f.role, status: f.role === 'guardianship' ? 'guardianship' : 'regular',
      age: parseAge(f.ageRaw), presence: f.role === 'guardianship' ? [{ from: `${month}-01`, to: monthEnd }] : null,
    }));
    const g = rent !== undefined ? rent : parseMoney(st.rentRaw).value;
    sc.rent = { amount: g, basis: rent === undefined && st.rentFromMarket ? 'market-scenario' : 'actual', marketRef: rent === undefined && st.rentFromMarket ? st.marketRef : null, changes: [] };
    if (keepEdu) {
      sc.education = st.family.filter((f) => f.role === 'child').map((f) => ({ f, v: parseMoney(st.edu[f.id]).value })).filter((x) => x.v != null)
        .map(({ f, v }) => ({ memberId: f.id, tuition: v, registration: null, transport: null, meals: null, holidayExtraContract: null, freeStateLanguageSchoolAvailable: false, ministerDecision34: false }));
    }
    if (extras) {
      if (st.ex.insurance) {
        sc.insurance = ['EMP', ...st.family.map((f) => f.id)].map((id) => ({ id, v: parseMoney(st.policy[id]).value })).filter((x) => x.v != null)
          .map((x) => ({ personId: x.id, policyCost: x.v, alreadyReimbursed: '0', policyStart: null }));
      }
      if (st.ex.baggage) { const b = parseMoney(st.bagRaw).value; sc.baggage = { kind: 'departure', claims: b != null ? [{ who: 'EMP', amount: b }] : [], previouslyUsed: '0' }; }
      const fee = parseMoney(st.brokerRaw).value;
      if (st.ex.broker && fee != null) sc.broker = { fee, serviceDate: `${month}-01`, rotationStartDate: `${month}-01`, alreadyReimbursed: false, documented: true, specialDecision81: false };
      const dr = parseMoney(st.dailyRaw).value;
      if (st.ex.settlement && (st.dailyOverride || !core.dailyRateForMission(data, missionId)) && dr != null) sc.settlement = { ...sc.settlement, dailyRate: { amount: dr, currency: st.dailyCur || mission()?.fundingCurrency || 'EUR', source: 'მომხმარებლის მითითებით', sourceDate: null, confirmed: false } };
    }
    return sc;
  }
  const calc = (sc) => { try { return core.calculate(sc, data); } catch (e) { console.error(e); return null; } };

  async function loadMarket() {
    const m = mission();
    const loc = m?.locationId ?? null;
    if (loc === market.locationId && (market.md || market.loading)) return;
    market.locationId = loc; market.md = null;
    const token = ++market.token;
    if (!loc) { market.loading = false; refreshMarket(); return; }
    market.loading = service.online;
    refreshMarket();
    const md = await service.get(loc, m.fundingCurrency);
    if (token !== market.token) return; // გვიანი პასუხი სხვა ქალაქისთვის
    market.loading = false; market.md = md;
    refreshMarket();
  }
  let refreshMarket = () => {};

  // ---------- ჩარჩო ----------
  const pills = h('ol', { class: 'pills', 'aria-label': 'საფეხურები' });
  const body = h('div', { class: 'step-body' });
  const nav = h('div', { class: 'nav no-print' });
  const compare = mountCompare(document.getElementById('compare'), { data, service, scenario, calc, beds, parseMoney, getMissionId: () => st.missionId, getRentRaw: () => st.rentRaw });
  app.append(pills, h('div', { class: 'card main-card' }, body, nav));
  for (const b of document.querySelectorAll('[data-open-compare]')) b.addEventListener('click', () => compare.open());

  function go(step) {
    st.step = step; st.maxStep = Math.max(st.maxStep, step);
    render();
    body.querySelector('h2')?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const canNext = () => (st.step === 1 ? !!st.missionId : st.step === 2 ? !!st.entryId : true);

  function render() {
    replace(pills, STEPS.map((t, i) => {
      const n = i + 1;
      const state = n === st.step ? 'active' : n < st.step || n <= st.maxStep ? 'done' : 'todo';
      const b = h('button', { type: 'button', class: `pill ${state}`, disabled: n > st.maxStep, 'aria-current': n === st.step ? 'step' : null },
        h('span', { class: 'pill-n' }, String(n)), h('span', { class: 'pill-t' }, t));
      b.addEventListener('click', () => go(n));
      return h('li', null, b);
    }));
    replace(body, [step1, step2, step3, step4][st.step - 1]());
    const back = h('button', { type: 'button', class: 'btn ghost', disabled: st.step === 1 }, '← უკან');
    back.addEventListener('click', () => go(st.step - 1));
    const next = h('button', { type: 'button', class: 'btn', 'data-testid': 'next' }, st.step === 3 ? 'შედეგის ნახვა →' : 'შემდეგი →');
    next.addEventListener('click', () => {
      if (!canNext()) { const msg = body.querySelector('[data-need]'); if (msg) { msg.hidden = false; msg.focus(); } return; }
      go(st.step + 1);
    });
    const reset = h('button', { type: 'button', class: 'btn ghost', 'data-testid': 'reset' }, 'თავიდან');
    reset.addEventListener('click', () => { st = fresh(); market.locationId = null; market.md = null; market.token++; go(1); });
    replace(nav, st.step < 4 ? [back, next] : [back, h('span', { class: 'spacer' }), reset]);
  }

  const need = (text) => h('p', { class: 'need', 'data-need': '', hidden: true, tabindex: '-1', role: 'alert' }, text);
  const title = (t, sub) => [h('h2', { tabindex: '-1' }, t), sub ? h('p', { class: 'lead' }, sub) : null];

  // ---------- 1. მისია ----------
  function step1() {
    const info = h('p', { class: 'info-line', 'data-testid': 'mission-info' });
    const card = h('section', { class: 'mcard', 'aria-live': 'polite' });
    const fill = () => {
      const m = mission();
      if (!m) { replace(info); replace(card); card.hidden = true; return; }
      const k = m.coefficient;
      replace(info, `ვალუტა ${m.fundingCurrency} · კოეფიციენტი K ${k.k ?? '—'} · ბინის წილი ${k.ePercent != null ? k.ePercent + '%' : '—'}`);
      card.hidden = false;
      replace(card, h('h3', null, `ცხოვრების ღირებულება — ${m.location_ka}`), marketList(market.md, beds(), { loading: market.loading }));
    };
    refreshMarket = fill;
    const picker = missionPicker({ data, label: 'საელჩო / საკონსულო / მისია', value: st.missionId, testid: 'mission',
      onPick: (id) => { st.missionId = id; st.dailyCur = null; body.querySelector('[data-need]')?.setAttribute('hidden', ''); fill(); loadMarket(); } });
    setTimeout(fill, 0);
    if (st.missionId) loadMarket();
    return [...title('სად მიდიხართ?', 'აირჩიეთ დაწესებულება — ჩაწერეთ ქალაქი ან ქვეყანა.'), picker, info, need('ჯერ აირჩიეთ დაწესებულება.'), card];
  }

  // ---------- 2. თანამდებობა და ოჯახი ----------
  function step2() {
    const entries = profiles().find((p) => p.id === 'annex2')?.entries || [];
    const suggestHead = (e) => e?.suggestedRentHead === 'head' || e?.suggestedRentHead === 'head-consular';
    const headId = uid('f');
    const head = h('input', { id: headId, type: 'checkbox', role: 'switch', checked: st.head, 'data-testid': 'head' });
    head.addEventListener('change', () => { st.head = head.checked; st.headTouched = true; });
    const name = uid('pos');
    const pcts = entries.map((e) => Number(e.percent));
    const lo = Math.min(...pcts), hi = Math.max(...pcts);
    const group = h('div', { class: 'poslist', role: 'radiogroup', 'aria-labelledby': name + '-l', 'data-testid': 'position' },
      entries.map((e) => {
        const id = uid('f');
        const inp = h('input', { id, type: 'radio', name, value: e.id, checked: e.id === st.entryId, 'data-testid': `pos-${e.id}` });
        inp.addEventListener('change', () => {
          st.entryId = e.id;
          if (!st.headTouched) { st.head = suggestHead(e); head.checked = st.head; }
          body.querySelector('[data-need]')?.setAttribute('hidden', '');
        });
        const lvl = hi === lo ? 3 : Math.round(((Number(e.percent) - lo) / (hi - lo)) * 4);
        return h('div', { class: 'pos' }, inp,
          h('label', { for: id },
            h('span', { class: 'pos-names' }, (e.positions_ka?.length ? e.positions_ka : [e.title_ka]).map((t) => h('span', { class: 'pos-name' }, t))),
            h('span', { class: `pos-pct l${lvl}` }, `${e.percent}%`)));
      }));
    const ageId = uid('f');
    const age = h('input', { id: ageId, type: 'text', inputmode: 'numeric', class: 'short', value: st.ageRaw, placeholder: 'მაგ. 40', 'aria-describedby': ageId + '-h' });
    age.addEventListener('input', () => { st.ageRaw = age.value; });
    const famList = h('div', { class: 'fam' });
    const addBtn = h('button', { type: 'button', class: 'btn-add', 'data-testid': 'add-family' }, '+ ოჯახის წევრი');
    addBtn.addEventListener('click', () => {
      st.family.push({ id: 'F' + st.nextId++, role: st.family.some((f) => f.role === 'spouse') ? 'child' : 'spouse', ageRaw: '' });
      fillFam(); famList.lastElementChild?.querySelector('select')?.focus();
    });
    function fillFam() {
      replace(famList, st.family.length ? st.family.map((f, i) => {
        const rid = uid('f'); const aid = uid('f');
        const role = h('select', { id: rid }, Object.entries(ROLE_KA).map(([v, t]) => h('option', { value: v, selected: f.role === v }, t)));
        role.addEventListener('change', () => { f.role = role.value; });
        const a = h('input', { id: aid, type: 'text', inputmode: 'numeric', value: f.ageRaw, placeholder: 'ასაკი' });
        a.addEventListener('input', () => { f.ageRaw = a.value; });
        const del = h('button', { type: 'button', class: 'x', 'aria-label': `ოჯახის წევრი ${i + 1}-ის წაშლა` }, '×');
        del.addEventListener('click', () => { st.family.splice(i, 1); delete st.edu[f.id]; delete st.policy[f.id]; fillFam(); (famList.querySelector('select') || addBtn).focus(); });
        return h('div', { class: 'fam-row', 'data-member': f.id },
          h('label', { for: rid, class: 'sr-only' }, `ოჯახის წევრი ${i + 1} — როლი`), role,
          h('label', { for: aid, class: 'sr-only' }, `ოჯახის წევრი ${i + 1} — ასაკი`), a, del);
      }) : h('p', { class: 'muted small' }, 'ოჯახის წევრები არ არის დამატებული.'));
    }
    fillFam();
    return [...title('თანამდებობა და ოჯახი'),
      h('p', { class: 'label', id: name + '-l' }, 'თანამდებობა'), group,
      need('აირჩიეთ თანამდებობა.'),
      h('div', { class: 'toggle' }, head, h('label', { for: headId }, h('strong', null, 'წარმომადგენლობის ხელმძღვანელი'), h('span', { class: 'muted small' }, 'ქირის ზედმეტის 80% ანაზღაურდება (სხვებს — 50%)'))),
      h('div', { class: 'field' }, h('label', { for: ageId }, 'თქვენი ასაკი'), age, h('p', { id: ageId + '-h', class: 'muted small' }, 'საჭიროა მხოლოდ დაზღვევის ლიმიტისთვის; შეიძლება დატოვოთ ცარიელი.')),
      h('h3', null, 'ოჯახის წევრები, რომლებიც თან მიგყვებათ'), famList, addBtn];
  }

  // ---------- 3. ქირა, სწავლა, ხარჯები ----------
  function moneyField(label, get, set, opts = {}) {
    const id = uid('f'); const err = h('p', { class: 'err', id: id + '-e' });
    const inp = h('input', { id, type: 'text', inputmode: 'decimal', autocomplete: 'off', value: get(), placeholder: opts.placeholder ?? '0.00', 'aria-describedby': id + '-e', 'data-testid': opts.testid ?? null });
    const check = () => { const r = parseMoney(inp.value); err.textContent = r.error ?? ''; if (r.error) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); };
    inp.addEventListener('input', () => { set(inp.value); check(); });
    if (get()) check();
    return { el: h('div', { class: 'field' }, h('label', { for: id }, label), h('div', { class: 'with-cur' }, inp, h('span', { class: 'cur' }, opts.cur ?? '')), err, opts.after ?? null), inp };
  }

  function step3() {
    const m = mission(); const cur = m?.fundingCurrency ?? '';
    const chipBox = h('div', { class: 'chip-box', 'aria-live': 'polite' });
    const rent = moneyField('ბინის ქირა თვეში', () => st.rentRaw, (v) => { st.rentRaw = v; st.rentFromMarket = false; }, { cur, testid: 'rent', after: chipBox });
    const fillChip = () => {
      const avg = rentFor(market.md, beds());
      if (avg == null || market.md?.currency !== cur) { replace(chipBox); return; }
      const b = h('button', { type: 'button', class: 'chip', 'data-testid': 'use-market-rent' }, `Numbeo-ს საშუალო (ცენტრი, ${beds()} საძინებელი): ${core.formatAmount(avg)} ${cur} — გამოყენება`);
      b.addEventListener('click', () => {
        st.rentRaw = avg; st.rentFromMarket = true;
        st.marketRef = { locationId: market.md.requestedLocationId, providerId: market.md.provider?.id ?? 'numbeo-apify', metric: `centre_${beds()}br`, fetchedAt: market.md.fetchedAt ?? null };
        rent.inp.value = avg; rent.inp.dispatchEvent(new Event('change')); rent.inp.focus();
      });
      replace(chipBox, b);
    };
    refreshMarket = fillChip;
    fillChip();
    loadMarket();
    const kids = st.family.filter((f) => f.role === 'child');
    const extra = (key, label, ...inner) => {
      const id = uid('f');
      const cb = h('input', { id, type: 'checkbox', checked: st.ex[key], 'data-testid': `ex-${key}` });
      const box = h('div', { class: 'ex-body', hidden: !st.ex[key] }, ...inner);
      cb.addEventListener('change', () => { st.ex[key] = cb.checked; box.hidden = !cb.checked; if (cb.checked) box.querySelector('input')?.focus(); });
      return h('div', { class: 'ex' + (st.ex[key] ? ' on' : '') }, h('div', { class: 'ex-head' }, cb, h('label', { for: id }, label)), box);
    };
    const lim = calc(scenario({ rent: null }));
    const bagCap = lim?.oneTimeReimbursements?.baggage?.cap?.value;
    const persons = (lim?.insurance?.perPerson || []);
    const capSum = persons.every((p) => p.annualCap?.value != null) && persons.length ? (persons.reduce((a, p) => a + Math.round(Number(p.annualCap.value) * 100), 0) / 100).toFixed(2) : null;
    const insBox = h('div', { class: 'ins' },
      h('p', { class: 'small muted' }, 'წლიური ლიმიტი — მაქსიმუმი, რამდენიც ანაზღაურდება პოლისის ფასიდან წელიწადში (არა თვიური და არა გასაცემი თანხა).'),
      persons.map((p) => {
        const nm = personName(p.personId);
        const f = moneyField(`${nm} — პოლისის ფასი წელიწადში (არასავალდებულო)`, () => st.policy[p.personId] ?? '', (x) => { st.policy[p.personId] = x; }, { cur, placeholder: '' });
        return h('div', { class: 'ins-row', 'data-person': p.personId },
          h('div', { class: 'ins-cap' }, h('span', null, nm), h('strong', null, p.annualCap?.value != null ? `წლიური ლიმიტი: ${core.formatAmount(p.annualCap.value)} ${cur}` : 'ლიმიტი: მიუთითეთ ასაკი')), f.el);
      }),
      h('p', { class: 'ins-total' }, 'ოჯახის ჯამური წლიური ლიმიტი: ', h('strong', null, capSum ? `${core.formatAmount(capSum)} ${cur}` : '—')));
    const setl = lim?.oneTimeAllowances?.settlement;
    const iu = setl?.inputsUsed || {};
    const auto = !st.dailyOverride && setl?.value != null && iu.dailyRateId;
    const overrideLink = h('button', { type: 'button', class: 'linkish' }, st.dailyOverride ? 'ნორმატიული ნორმის გამოყენება' : 'სხვა ნორმის მითითება');
    overrideLink.addEventListener('click', () => { st.dailyOverride = !st.dailyOverride; replace(body, step3()); body.querySelector('[data-testid="ex-settlement"]')?.focus(); });
    const curSel = h('select', { 'aria-label': 'ნორმის ვალუტა', class: 'cur-sel' }, ['EUR', 'USD'].map((c) => h('option', { value: c, selected: (st.dailyCur || cur) === c }, c)));
    curSel.addEventListener('change', () => { st.dailyCur = curSel.value; });
    return [...title('ქირა, სწავლა, ხარჯები', 'თვიური თანხები. თუ ქირა ჯერ არ იცით — დატოვეთ ცარიელი.'),
      rent.el,
      kids.length ? h('h3', null, 'სკოლა / ბაღი') : null,
      kids.map((f, i) => moneyField(`სკოლა/ბაღი — თვიური გადასახადი (შვილი ${i + 1}${parseAge(f.ageRaw) != null ? ', ' + parseAge(f.ageRaw) + ' წ.' : ''})`, () => st.edu[f.id] ?? '', (v) => { st.edu[f.id] = v; }, { cur, testid: 'edu' }).el),
      h('h3', null, 'დამატებითი ხარჯები'),
      h('div', { class: 'extras' },
        extra('insurance', 'დაზღვევა', insBox),
        extra('baggage', 'ბარგის გადაზიდვა', h('p', { class: 'small' }, `ლიმიტი: ${bagCap ? core.formatAmount(bagCap) + ' ' + cur : '—'}`),
          moneyField('ფაქტიური ხარჯი (არასავალდებულო)', () => st.bagRaw, (v) => { st.bagRaw = v; }, { cur }).el),
        extra('broker', 'მაკლერის მომსახურება', moneyField('მაკლერის საკომისიო', () => st.brokerRaw, (v) => { st.brokerRaw = v; }, { cur }).el),
        extra('settlement', 'პირველადი მოწყობა',
          auto ? h('p', { class: 'small', 'data-testid': 'settlement-auto' }, `დღიური ნორმა: ${core.formatAmount(iu.dailyRate)} ${iu.dailyRateCurrency} (მთავრობის №211 დადგენილება) × 60 × (1 + 10% × ${iu.n} ოჯახის წევრი) = `, h('strong', null, `${core.formatAmount(setl.value)} ${setl.currency}`))
            : !st.dailyOverride ? h('p', { class: 'small muted' }, 'ამ ქალაქისთვის დღიური ნორმა ვერ მოიძებნა — მიუთითეთ.') : null,
          st.dailyOverride || !auto ? h('div', { class: 'row2' }, moneyField('დღიური ნორმა', () => st.dailyRaw, (v) => { st.dailyRaw = v; st.dailyOverride = true; }).el, curSel) : null,
          auto || st.dailyOverride ? overrideLink : null))];
  }

  // ---------- 4. შედეგი ----------
  function step4() {
    const sc = scenario();
    const r = calc(sc);
    const m = mission();
    const M = resultModel({ r, st, sc, mission: m ? { ...m, shortName: shortName(m) } : null, data, personName });
    return renderResult(M, {
      onPrint: () => window.print(),
      onCompare: () => compare.open(),
      onPdf: async (btn) => {
        btn.disabled = true; const t = btn.textContent; btn.textContent = 'მზადდება…';
        try { downloadBytes(await resultPdf(M), `rotacia-shedegi-${new Date().toISOString().slice(0, 10)}.pdf`); }
        catch (e) { console.error(e); alertLine('PDF ვერ შეიქმნა. სცადეთ „ბეჭდვა“.'); }
        finally { btn.disabled = false; btn.textContent = t; }
      },
    });
  }
  function alertLine(text) { const p = h('p', { class: 'need', role: 'alert' }, text); body.append(p); }
  function personName(id) {
    if (id === 'EMP') return 'თქვენ';
    const i = st.family.findIndex((f) => f.id === id);
    return i < 0 ? id : `${ROLE_KA[st.family[i].role]} ${i + 1}`;
  }

  render();
  return { get state() { return st; } };
}
