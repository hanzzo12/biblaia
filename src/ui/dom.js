// უსაფრთხო DOM დამხმარეები. დინამიკური ტექსტი მხოლოდ textContent / createTextNode-ით.
// innerHTML / outerHTML / insertAdjacentHTML / document.write src/ui-ში აკრძალულია (tests/e2e/ui-smoke.test.js ამოწმებს).

const ATTR_OK = /^(class|id|for|type|name|placeholder|role|tabindex|title|lang|min|max|step|inputmode|autocomplete|rows|maxlength|colspan|scope|accept|href|rel|target|datetime|spellcheck|form|size|pattern)$|^(aria|data)-[a-z-]+$/;
const PROP_BOOL = new Set(['checked', 'disabled', 'hidden', 'open', 'selected', 'required', 'multiple', 'readonly']);

/** @param {unknown} u */
export function safeUrl(u) {
  if (typeof u !== 'string' || u.length > 2048) return null;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
}

function append(el, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false || k === '') continue;
    if (Array.isArray(k)) append(el, k);
    else if (k instanceof Node) el.appendChild(k);
    else el.appendChild(document.createTextNode(String(k)));
  }
}

/**
 * h('div', { class: 'x', on: { click: fn }, text: '...' }, ...children)
 * @param {string} tag
 * @param {Record<string, any>|null} [props]
 * @param {...any} children
 * @returns {any}
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  let value;
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'on') { for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn); continue; }
      if (k === 'text') { el.textContent = String(v); continue; }
      if (k === 'value') { value = v; continue; }
      if (/^on/i.test(k)) throw new Error('inline handler forbidden: ' + k);
      if (PROP_BOOL.has(k)) { el[k] = true; if (k !== 'checked' && k !== 'selected') el.setAttribute(k, ''); continue; }
      if (!ATTR_OK.test(k)) throw new Error('attribute not allowed: ' + k);
      if (k === 'href') {
        const u = v.startsWith('#') ? v : safeUrl(v);
        if (!u) continue;
        el.setAttribute('href', u);
        continue;
      }
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  if (value !== undefined) el.value = String(value);
  return el;
}

/** @param {Element} el @param {...any} children */
export function replace(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

let seq = 0;
export const uid = (p = 'id') => `${p}-${++seq}`;

/** @param {string} sel @param {ParentNode} [root] */
export const $ = (sel, root = document) => root.querySelector(sel);
