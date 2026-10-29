// User-input decimal parsing and display formatting (contracts §0).
import { rat, R, toFixed, isRational } from './rational.js';

export const MAX_INPUT = 10_000_000n;

/**
 * Parse a user-entered amount. Accepts "1500", "1500.5", "1500,5", surrounding spaces.
 * Rejects thousands separators ("1,500.00", "1 500"), signs, NaN/Infinity, > 10 000 000.
 * Empty / null / undefined → { ok: true, value: null } (= unknown, never 0).
 * @param {string|null|undefined} str
 * @returns {{ ok: boolean, value: import('./rational.js').Rational|null, error_ka: string|null, normalized: string|null }}
 */
export function parseDecimalInput(str) {
  if (str === null || str === undefined) return { ok: true, value: null, error_ka: null, normalized: null };
  if (isRational(str)) return { ok: true, value: str, error_ka: null, normalized: null };
  if (typeof str === 'number') {
    if (!Number.isFinite(str)) return fail('არარიცხვითი მნიშვნელობა.');
    str = String(str);
  }
  if (typeof str !== 'string') return fail('მოსალოდნელია ტექსტური რიცხვი.');
  const s = str.trim();
  if (s === '') return { ok: true, value: null, error_ka: null, normalized: null };
  if (/^[+-]/.test(s)) return fail(s.startsWith('-') ? 'უარყოფითი მნიშვნელობა დაუშვებელია.' : 'ნიშანი „+“ დაუშვებელია.');
  if (/inf|nan/i.test(s)) return fail('არარიცხვითი მნიშვნელობა.');
  const seps = (s.match(/[.,]/g) || []).length;
  if (seps > 1) return fail('დასაშვებია მხოლოდ ერთი ათწილადი გამყოფი; ათასეულის გამყოფი არ გამოიყენება.');
  if (!/^\d+([.,]\d+)?$/.test(s)) return fail('არასწორი რიცხვი. მაგალითი: 1500 ან 1500,50.');
  const normalized = s.replace(',', '.');
  const [ip, fp = ''] = normalized.split('.');
  const value = rat(BigInt(ip + fp), 10n ** BigInt(fp.length));
  if (value.n > MAX_INPUT * value.d) return fail('მნიშვნელობა აღემატება 10 000 000-ს.');
  return { ok: true, value, error_ka: null, normalized: normalized.replace(/^0+(?=\d)/, '') };
}

function fail(error_ka) {
  return { ok: false, value: null, error_ka, normalized: null };
}

/**
 * Format for display: 2 decimals, half-up, thin grouping with a space ("1 234.57").
 * @param {import('./rational.js').Rational|string|null} x
 * @param {{ places?: number }} [opts]
 */
export function formatAmount(x, opts = {}) {
  if (x === null || x === undefined) return '—';
  const s = toFixed(R(x), opts.places ?? 2);
  const neg = s.startsWith('-');
  const [ip, fp] = (neg ? s.slice(1) : s).split('.');
  const grouped = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (neg ? '−' : '') + grouped + (fp !== undefined ? `.${fp}` : '');
}
