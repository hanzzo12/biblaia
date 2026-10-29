// Pure calendar arithmetic on "YYYY-MM-DD" strings (no Date, no time zones). contracts §0, P-2.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function daysInMonth(y, m) {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** @returns {{ y: number, m: number, d: number } | null} */
export function parseDate(s) {
  const mt = typeof s === 'string' ? DATE_RE.exec(s) : null;
  if (!mt) return null;
  const y = +mt[1], m = +mt[2], d = +mt[3];
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

export const isValidDate = (s) => parseDate(s) !== null;

const pad = (n, w = 2) => String(n).padStart(w, '0');
export const formatDate = ({ y, m, d }) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

/** Day number (days since 0000-03-01 proleptic Gregorian); only differences matter. */
export function toOrdinal(s) {
  const p = typeof s === 'string' ? parseDate(s) : s;
  if (!p) throw new RangeError(`calendar: invalid date ${JSON.stringify(s)}`);
  let { y, m, d } = p;
  if (m <= 2) { y -= 1; m += 12; }
  return 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + Math.floor((153 * (m - 3) + 2) / 5) + d;
}

export function fromOrdinal(n) {
  // inverse of toOrdinal via search within year (simple, exact)
  let y = Math.floor(n / 365.2425);
  while (toOrdinal({ y: y + 1, m: 1, d: 1 }) <= n) y++;
  while (toOrdinal({ y, m: 1, d: 1 }) > n) y--;
  let m = 1;
  while (m < 12 && toOrdinal({ y, m: m + 1, d: 1 }) <= n) m++;
  const d = n - toOrdinal({ y, m, d: 1 }) + 1;
  return formatDate({ y, m, d });
}

export const compareDates = (a, b) => Math.sign(toOrdinal(a) - toOrdinal(b));
export const addDays = (s, n) => fromOrdinal(toOrdinal(s) + n);
/** Inclusive day count: daysInclusive("2027-03-28", "2027-03-31") = 4. */
export const daysInclusive = (from, to) => toOrdinal(to) - toOrdinal(from) + 1;

/** Add calendar months; day clamped to month end ("2027-08-31" + 6 → "2028-02-29"). */
export function addMonths(s, n) {
  const p = parseDate(s);
  if (!p) throw new RangeError(`calendar: invalid date ${s}`);
  const total = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(total / 12), m = (total % 12) + 1;
  return formatDate({ y, m, d: Math.min(p.d, daysInMonth(y, m)) });
}

export const monthKey = (s) => s.slice(0, 7);
export const monthStart = (s) => `${s.slice(0, 7)}-01`;
export function monthEnd(s) {
  const p = parseDate(s);
  return formatDate({ y: p.y, m: p.m, d: daysInMonth(p.y, p.m) });
}
export const daysInMonthOf = (s) => { const p = parseDate(s); return daysInMonth(p.y, p.m); };

/** Completed years of age on `onDate` for a birth date. */
export function ageOn(birthDate, onDate) {
  const b = parseDate(birthDate), o = parseDate(onDate);
  if (!b || !o) return null;
  let age = o.y - b.y;
  if (o.m < b.m || (o.m === b.m && o.d < b.d)) age--;
  return age;
}

/**
 * Split [start, end] (inclusive) into segments at month boundaries and at the given
 * change dates (a change date starts a new segment). Returns [{ from, to, days, daysInMonth, month }].
 */
export function segmentPeriod(start, end, changeDates = []) {
  const a = toOrdinal(start), b = toOrdinal(end);
  if (b < a) return [];
  const cuts = new Set();
  for (const c of changeDates) {
    if (!isValidDate(c)) continue;
    const o = toOrdinal(c);
    if (o > a && o <= b) cuts.add(o);
  }
  // month starts inside the period
  let cur = monthStart(start);
  for (;;) {
    cur = addMonths(cur, 1);
    const o = toOrdinal(cur);
    if (o > b) break;
    cuts.add(o);
  }
  const points = [a, ...[...cuts].sort((x, y) => x - y)];
  return points.map((p, i) => {
    const to = i + 1 < points.length ? points[i + 1] - 1 : b;
    const from = fromOrdinal(p);
    return { from, to: fromOrdinal(to), days: to - p + 1, daysInMonth: daysInMonthOf(from), month: monthKey(from) };
  });
}

/** Number of days of [from,to] covered by the union of ranges [{from,to}] (inclusive). */
export function overlapDays(from, to, ranges) {
  const a = toOrdinal(from), b = toOrdinal(to);
  const covered = new Set();
  for (const r of ranges || []) {
    if (!isValidDate(r?.from) || !isValidDate(r?.to)) continue;
    const lo = Math.max(a, toOrdinal(r.from)), hi = Math.min(b, toOrdinal(r.to));
    for (let x = lo; x <= hi; x++) covered.add(x);
  }
  return covered.size;
}

/** Is the date within [from, to] where either end may be null (open). */
export function withinOpen(date, from, to) {
  const o = toOrdinal(date);
  if (from && isValidDate(from) && o < toOrdinal(from)) return false;
  if (to && isValidDate(to) && o > toOrdinal(to)) return false;
  return true;
}
