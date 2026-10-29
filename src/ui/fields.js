// ფორმის ველები, მიბმული store-ის ScenarioV1 გზებზე. ყველა ველს აქვს ნამდვილი <label for>.
import { h, uid } from './dom.js';
import * as core from '../core/index.js';

const parseDecimal = (s) => core.parseDecimalInput(s);

function shell(id, label, control, opts, err) {
  const hint = opts.hint ? h('p', { id: id + '-hint', class: 'hint' }, opts.hint) : null;
  return h('div', { class: 'field' + (opts.wide ? ' wide' : '') },
    h('label', { for: id }, label, opts.required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null),
    opts.unit !== undefined ? h('div', { class: 'with-unit' }, control, h('span', { class: 'unit', 'data-unit-for': id }, opts.unit)) : control,
    hint, err);
}

function setError(store, path, input, err, msg) {
  if (msg) {
    store.errors[path] = msg;
    input.setAttribute('aria-invalid', 'true');
    err.textContent = msg;
  } else {
    delete store.errors[path];
    input.removeAttribute('aria-invalid');
    err.textContent = '';
  }
}

/** თანხა: ცარიელი → null (უცნობი); "0" → ნამდვილი ნული; მძიმე/წერტილი. */
export function money(store, path, label, opts = {}) {
  const id = uid('f');
  store.ids[path] = id;
  const err = h('p', { id: id + '-err', class: 'field-error' });
  const cur = store.get(path);
  const input = h('input', {
    id, type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', 'data-path': path, 'data-kind': 'money',
    'aria-describedby': (opts.hint ? id + '-hint ' : '') + id + '-err',
    value: store.raw[path] ?? (cur ?? ''),
  });
  const apply = (silent) => {
    const raw = input.value;
    store.raw[path] = raw;
    const r = parseDecimal(raw);
    let msg = r.ok ? null : r.error_ka;
    if (!msg && opts.positive && r.normalized !== null && /^0+(\.0+)?$/.test(r.normalized)) msg = 'მნიშვნელობა უნდა იყოს 0-ზე მეტი.';
    setError(store, path, input, err, msg);
    const v = msg ? null : r.normalized;
    if (silent !== true) {
      store.set(path, v);
      if (opts.onChange) opts.onChange(v, raw);
    }
  };
  input.addEventListener('input', apply);
  if (store.raw[path]) apply(true);
  return shell(id, label, input, opts, err);
}

/** მთელი რიცხვი (ასაკი, თვეები). */
export function integer(store, path, label, opts = {}) {
  const id = uid('f');
  store.ids[path] = id;
  const err = h('p', { id: id + '-err', class: 'field-error' });
  const cur = store.get(path);
  const max = opts.max ?? 120;
  const input = h('input', {
    id, type: 'text', inputmode: 'numeric', autocomplete: 'off', 'data-path': path,
    'aria-describedby': (opts.hint ? id + '-hint ' : '') + id + '-err', value: store.raw[path] ?? (cur ?? ''),
  });
  const apply = (silent) => {
    const raw = input.value.trim();
    store.raw[path] = input.value;
    let msg = null; let v = null;
    if (raw !== '') {
      if (!/^\d{1,4}$/.test(raw)) msg = 'შეიყვანეთ მთელი რიცხვი (მაგ. 7).';
      else if (Number(raw) > max) msg = `მნიშვნელობა არ უნდა აღემატებოდეს ${max}-ს.`;
      else if (opts.min !== undefined && Number(raw) < opts.min) msg = `მნიშვნელობა უნდა იყოს მინიმუმ ${opts.min}.`;
      else v = Number(raw);
    }
    setError(store, path, input, err, msg);
    if (silent !== true) { store.set(path, v); if (opts.onChange) opts.onChange(v); }
  };
  input.addEventListener('input', apply);
  if (store.raw[path]) apply(true);
  return shell(id, label, input, opts, err);
}

export function text(store, path, label, opts = {}) {
  const id = uid('f');
  store.ids[path] = id;
  const input = h('input', { id, type: 'text', maxlength: String(opts.maxlength ?? 200), autocomplete: 'off', 'data-path': path, value: store.get(path) ?? '',
    'aria-describedby': opts.hint ? id + '-hint' : null });
  input.addEventListener('input', () => { const v = input.value.trim(); store.set(path, v === '' ? null : input.value); if (opts.onChange) opts.onChange(); });
  return shell(id, label, input, opts, null);
}

export function date(store, path, label, opts = {}) {
  const id = uid('f');
  store.ids[path] = id;
  const err = h('p', { id: id + '-err', class: 'field-error' });
  const input = h('input', { id, type: 'date', min: '1900-01-01', max: '2100-12-31', 'data-path': path, value: store.get(path) ?? '',
    'aria-describedby': (opts.hint ? id + '-hint ' : '') + id + '-err' });
  const apply = () => {
    const v = input.value;
    const ok = v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v);
    setError(store, path, input, err, ok ? null : 'არასწორი თარიღი (წწწწ-თთ-დდ).');
    store.set(path, ok && v !== '' ? v : null);
    if (opts.onChange) opts.onChange();
  };
  input.addEventListener('input', apply);
  input.addEventListener('change', apply);
  return shell(id, label, input, opts, err);
}

export function check(store, path, label, opts = {}) {
  const id = uid('f');
  store.ids[path] = id;
  const input = h('input', { id, type: 'checkbox', 'data-path': path, checked: !!store.get(path), 'aria-describedby': opts.hint ? id + '-hint' : null });
  input.addEventListener('change', () => { store.set(path, input.checked); if (opts.onChange) opts.onChange(input.checked); });
  return h('div', { class: 'check' }, input, h('label', { for: id }, label),
    opts.hint ? h('p', { id: id + '-hint', class: 'hint' }, opts.hint) : null);
}

/** options: [{value,label}]; allowEmpty → პირველი ცარიელი ვარიანტი (null). */
export function select(store, path, label, options, opts = {}) {
  const id = uid('f');
  store.ids[path] = id;
  const cur = store.get(path);
  const sel = h('select', { id, 'data-path': path, 'aria-describedby': opts.hint ? id + '-hint' : null },
    opts.allowEmpty !== false ? h('option', { value: '' }, opts.emptyLabel ?? '— აირჩიეთ —') : null,
    options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(cur) }, o.label)));
  sel.addEventListener('change', () => {
    const v = sel.value === '' ? null : sel.value;
    store.set(path, v);
    if (opts.onChange) opts.onChange(v);
  });
  return shell(id, label, sel, opts, null);
}

/** radio ჯგუფი fieldset/legend-ით. */
export function radios(store, path, legend, options, opts = {}) {
  const name = uid('r');
  const cur = store.get(path);
  const fs = h('fieldset', { class: 'radios' + (opts.inline ? ' inline' : ''), 'data-path': path, 'data-kind': 'radio' }, h('legend', null, legend),
    options.map((o) => {
      const id = uid('f');
      const input = h('input', { id, type: 'radio', name, value: o.value ?? '', checked: String(o.value) === String(cur) || (o.value === null && cur == null), disabled: o.disabled });
      input.addEventListener('change', () => { if (input.checked) { store.set(path, o.value); if (opts.onChange) opts.onChange(o.value); } });
      return h('div', { class: 'radio' }, input, h('label', { for: id }, o.label), o.hint ? h('span', { class: 'hint' }, ' ' + o.hint) : null);
    }),
    opts.hint ? h('p', { class: 'hint' }, opts.hint) : null);
  store.ids[path] = fs.querySelector('input')?.id;
  return fs;
}

/** checkbox, რომელიც სცენარის გზას პირდაპირ არ ებმის (ბლოკის ჩართვა/გამორთვა). */
export function toggle(label, checked, onChange) {
  const id = uid('f');
  const input = h('input', { id, type: 'checkbox', checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('div', { class: 'check' }, input, h('label', { for: id }, label));
}
