// სცენარის JSON ექსპორტი/იმპორტი, ადგილობრივი შენახვა (მხოლოდ ღილაკით), ბეჭდვა.
import { h, replace } from '../dom.js';
import * as core from '../../core/index.js';

export const STORAGE_KEY = 'rotationCalc.scenario.v1';
const MAX_BYTES = 256 * 1024;

function storage() { try { return window.localStorage; } catch { return null; } }

export function mountExport(root, store, { load, reset }) {
  const msg = h('div', { class: 'export-msg', role: 'status', 'aria-live': 'polite' });
  const say = (text, kind = 'ok', list = []) => replace(msg, h('p', { class: kind === 'error' ? 'error-text' : 'hint' }, text), list.length ? h('ul', { class: 'errors' }, list.slice(0, 12).map((e) => h('li', null, e))) : null);

  const fileDoc = () => ({
    kind: 'rotation-scenario', schemaVersion: core.SCENARIO_SCHEMA_VERSION ?? 1,
    appVersion: store.meta.appVersion, rulesVersion: store.data.rulesVersion, dataSha256: store.meta.dataSha,
    exportedAt: new Date().toISOString(), scenario: store.coreScenario ? store.coreScenario() : store.scenario,
    compare: (store.ui.compare || []).map((c) => ({ missionId: c.missionId, rent: c.rent ?? null })),
  });

  /** @returns {{ok:boolean, errors:string[], warnings:string[], doc?:any}} */
  function check(text) {
    if (typeof text !== 'string' || text.length > MAX_BYTES) return { ok: false, errors: ['ფაილი ძალიან დიდია (მაქს. 256 KB).'], warnings: [] };
    let doc;
    try { doc = JSON.parse(text.replace(/^﻿/, '')); } catch { return { ok: false, errors: ['ფაილი სწორი JSON არ არის.'], warnings: [] }; }
    if (!doc || typeof doc !== 'object' || doc.kind !== 'rotation-scenario') return { ok: false, errors: ['ეს არ არის კალკულატორის სცენარის ფაილი (kind: "rotation-scenario").'], warnings: [] };
    if (doc.schemaVersion !== (core.SCENARIO_SCHEMA_VERSION ?? 1)) return { ok: false, errors: [`სქემის ვერსია (${String(doc.schemaVersion).slice(0, 20)}) არ არის მხარდაჭერილი.`], warnings: [] };
    const v = core.validateScenario(doc.scenario, store.data);
    const errors = v.ok ? [] : v.errors.map((e) => `${e.path}: ${e.message_ka}`);
    if (doc.compare !== undefined) {
      if (!Array.isArray(doc.compare) || doc.compare.length > 5) errors.push('compare: უნდა იყოს მასივი (მაქს. 5).');
      else doc.compare.forEach((c, i) => {
        if (!c || typeof c.missionId !== 'string' || !core.resolveMission(store.data, c.missionId)) errors.push(`compare[${i}].missionId: უცნობი დაწესებულება.`);
        if (c && c.rent !== null && c.rent !== undefined) { const p = core.parseDecimalInput(c.rent); if (!p.ok || typeof c.rent !== 'string') errors.push(`compare[${i}].rent: ${p.error_ka ?? 'არასწორი თანხა.'}`); }
      });
    }
    const warnings = doc.rulesVersion && doc.rulesVersion !== store.data.rulesVersion ? [`ფაილი შექმნილია წესების სხვა ვერსიით (${String(doc.rulesVersion).slice(0, 80)}); შედეგი გადაითვალა მიმდინარე ვერსიით.`] : [];
    return { ok: errors.length === 0, errors, warnings, doc };
  }

  const exportBtn = h('button', { type: 'button', class: 'btn', 'data-testid': 'export-json' }, 'სცენარის ექსპორტი (JSON)');
  exportBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(fileDoc(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: '#', download: null });
    a.href = url;
    a.download = `rotation-scenario-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say('სცენარი ექსპორტირებულია JSON ფაილად.');
  });

  const fileId = 'scenario-import';
  const file = h('input', { id: fileId, type: 'file', accept: '.json,application/json', class: 'file', 'data-testid': 'import-json' });
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const res = f.size > MAX_BYTES ? { ok: false, errors: ['ფაილი ძალიან დიდია (მაქს. 256 KB).'], warnings: [] } : check(await f.text());
    file.value = '';
    if (!res.ok) { say('იმპორტი უარყოფილია — მიმდინარე ფორმა არ შეცვლილა.', 'error', res.errors); return; }
    load(res.doc.scenario, { compare: res.doc.compare || [] });
    say('სცენარი იმპორტირებულია.', 'ok', res.warnings);
  });

  const saveBtn = h('button', { type: 'button', class: 'btn secondary', 'data-testid': 'save-local' }, 'დამახსოვრება ამ მოწყობილობაზე');
  saveBtn.addEventListener('click', () => {
    const st = storage();
    try { st.setItem(STORAGE_KEY, JSON.stringify(fileDoc())); say('სცენარი შენახულია ამ ბრაუზერში (მხოლოდ ამ მოწყობილობაზე). წასაშლელად — „გასუფთავება“.'); renderRestore(); }
    catch { say('ბრაუზერში შენახვა ვერ მოხერხდა (შესაძლოა დაბლოკილია).', 'error'); }
  });

  const restoreBox = h('span');
  function renderRestore() {
    let has = false;
    try { has = !!storage()?.getItem(STORAGE_KEY); } catch { has = false; }
    if (!has) { replace(restoreBox); return; }
    const b = h('button', { type: 'button', class: 'btn secondary', 'data-testid': 'restore-local' }, 'შენახულის აღდგენა');
    b.addEventListener('click', () => {
      let text = null;
      try { text = storage().getItem(STORAGE_KEY); } catch { text = null; }
      const res = check(text ?? '');
      if (!res.ok) { say('შენახული სცენარი ვერ აღდგა.', 'error', res.errors); return; }
      load(res.doc.scenario, { compare: res.doc.compare || [] });
      say('შენახული სცენარი აღდგენილია.', 'ok', res.warnings);
    });
    replace(restoreBox, b);
  }

  const clearBox = h('span');
  function renderClear(confirming) {
    if (!confirming) {
      const b = h('button', { type: 'button', class: 'btn secondary', 'data-testid': 'clear' }, 'გასუფთავება');
      b.addEventListener('click', () => { renderClear(true); clearBox.querySelector('button')?.focus(); });
      replace(clearBox, b);
      return;
    }
    const yes = h('button', { type: 'button', class: 'btn danger', 'data-testid': 'clear-confirm' }, 'დიახ, წავშალო შენახული და ფორმა');
    const no = h('button', { type: 'button', class: 'btn secondary' }, 'გაუქმება');
    yes.addEventListener('click', () => {
      try { storage()?.removeItem(STORAGE_KEY); } catch { /* დაბლოკილი storage */ }
      reset(); renderClear(false); renderRestore(); say('შენახული მონაცემი წაიშალა, ფორმა დაბრუნდა საწყისზე.');
    });
    no.addEventListener('click', () => { renderClear(false); clearBox.querySelector('button')?.focus(); });
    replace(clearBox, h('span', { role: 'group', 'aria-label': 'გასუფთავების დადასტურება' }, yes, ' ', no));
  }

  const printBtn = h('button', { type: 'button', class: 'btn', 'data-testid': 'print' }, 'ბეჭდვა / PDF-ად შენახვა');
  printBtn.addEventListener('click', () => window.print());

  root.append(h('div', { class: 'toolbar' }, exportBtn,
    h('label', { for: fileId, class: 'btn secondary file-label' }, 'სცენარის იმპორტი'), file,
    saveBtn, restoreBox, clearBox, printBtn),
  h('p', { class: 'hint' }, 'PDF: ბეჭდვის ფანჯარაში აირჩიეთ „PDF-ად შენახვა“ (Save as PDF). ტექსტი რჩება ტექსტად. ბრაუზერში შენახვა ხდება მხოლოდ ღილაკით „დამახსოვრება“.'),
  msg);
  renderRestore(); renderClear(false);
  return { check };
}
