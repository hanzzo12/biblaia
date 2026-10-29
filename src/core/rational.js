// Exact rational arithmetic on BigInt (contracts §0). Immutable values.
// A Rational is { n: bigint, d: bigint } with d > 0 and gcd(|n|, d) = 1.

/** @typedef {{ n: bigint, d: bigint }} Rational */

const ZERO_N = 0n;

function gcd(a, b) {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b) [a, b] = [b, a % b];
  return a;
}

/** @returns {Rational} */
export function rat(n, d = 1n) {
  n = BigInt(n);
  d = BigInt(d);
  if (d === 0n) throw new RangeError('rational: division by zero');
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d) || 1n;
  return Object.freeze({ n: n / g, d: d / g });
}

export const ZERO = rat(0);
export const ONE = rat(1);

/** @param {unknown} x */
export function isRational(x) {
  return !!x && typeof x === 'object' && typeof x.n === 'bigint' && typeof x.d === 'bigint';
}

const DEC_RE = /^(-)?(\d+)(?:\.(\d+))?$/;

/**
 * Parse a canonical decimal string ("2.06", "-3", "3100"). Throws on anything else.
 * @param {string} s
 * @returns {Rational}
 */
export function fromDecimal(s) {
  if (isRational(s)) return s;
  if (typeof s === 'number') {
    if (!Number.isInteger(s)) throw new TypeError('rational: non-integer number, use a decimal string');
    return rat(BigInt(s));
  }
  if (typeof s === 'bigint') return rat(s);
  const m = DEC_RE.exec(String(s).trim());
  if (!m) throw new TypeError(`rational: not a decimal string: ${JSON.stringify(s)}`);
  const frac = m[3] || '';
  const n = BigInt(m[2] + frac) * (m[1] ? -1n : 1n);
  return rat(n, 10n ** BigInt(frac.length));
}

/** Coerce decimal string / integer / Rational to Rational. */
export const R = (x) => (isRational(x) ? x : fromDecimal(x));

export const add = (a, b) => { a = R(a); b = R(b); return rat(a.n * b.d + b.n * a.d, a.d * b.d); };
export const sub = (a, b) => { a = R(a); b = R(b); return rat(a.n * b.d - b.n * a.d, a.d * b.d); };
export const mul = (a, b) => { a = R(a); b = R(b); return rat(a.n * b.n, a.d * b.d); };
export const div = (a, b) => { a = R(a); b = R(b); if (b.n === ZERO_N) throw new RangeError('rational: division by zero'); return rat(a.n * b.d, a.d * b.n); };
export const neg = (a) => { a = R(a); return rat(-a.n, a.d); };
/** @returns {-1|0|1} */
export const cmp = (a, b) => { a = R(a); b = R(b); const x = a.n * b.d - b.n * a.d; return x < 0n ? -1 : x > 0n ? 1 : 0; };
export const eq = (a, b) => cmp(a, b) === 0;
export const lt = (a, b) => cmp(a, b) < 0;
export const le = (a, b) => cmp(a, b) <= 0;
export const gt = (a, b) => cmp(a, b) > 0;
export const ge = (a, b) => cmp(a, b) >= 0;
export const min = (a, b) => (le(a, b) ? R(a) : R(b));
export const max = (a, b) => (ge(a, b) ? R(a) : R(b));
export const isZero = (a) => R(a).n === 0n;
export const isNeg = (a) => R(a).n < 0n;
/** percent → fraction: pct("7") = 7/100 */
export const pct = (p) => div(p, 100);
export const sum = (xs) => xs.reduce((acc, x) => add(acc, x), ZERO);

/**
 * Round half-up (away from zero for .5) to `places` decimals; returns a string.
 * @param {Rational|string} a
 * @param {number} places
 */
export function toFixed(a, places = 2) {
  a = R(a);
  const scale = 10n ** BigInt(places);
  const negative = a.n < 0n;
  const absN = negative ? -a.n : a.n;
  // round(|a| * scale) half-up
  const num = absN * scale;
  let q = num / a.d;
  const r = num % a.d;
  if (r * 2n >= a.d) q += 1n;
  let s = q.toString();
  if (places > 0) {
    s = s.padStart(places + 1, '0');
    s = `${s.slice(0, -places)}.${s.slice(-places)}`;
  }
  return (negative && q !== 0n ? '-' : '') + s;
}
export const toFixed2 = (a) => toFixed(a, 2);

/** Exact representation "n/d" (or "n" when d = 1). */
export function toExactString(a) {
  a = R(a);
  return a.d === 1n ? a.n.toString() : `${a.n}/${a.d}`;
}

/** Parse "n/d" or "n" (inverse of toExactString). */
export function fromExactString(s) {
  const m = /^(-?\d+)(?:\/(\d+))?$/.exec(String(s));
  if (!m) throw new TypeError(`rational: bad exact string ${s}`);
  return rat(BigInt(m[1]), BigInt(m[2] || '1'));
}

/** Decimal string without rounding when the value is a finite decimal, else null. */
export function toDecimalString(a) {
  a = R(a);
  let d = a.d, k = 0;
  while (d % 2n === 0n) { d /= 2n; k++; }
  let k5 = 0;
  while (d % 5n === 0n) { d /= 5n; k5++; }
  if (d !== 1n) return null;
  const places = Math.max(k, k5);
  return toFixed(a, places).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}
