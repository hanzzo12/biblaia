// @ts-check
/**
 * Apify-ის მონაცემის დამაჯერებლობა (2026-11-04: Astana — KZT „USD“ ნიშნით, Odessa — ტეხასი).
 * შედარება საცნობარო მონაცემთან (მომხმარებლის ასლი იმავე ვალუტაში ან KV-ის წინა ასლი): ქირის ფარდობა > 3× ან < ⅓ → დაუჯერებელი.
 */
export const MAX_RENT_RATIO = 3;
export const MAX_ABSOLUTE_RENT = 20000; // EUR/USD — თვიური ქირა, ამაზე მეტი ⇒ სხვა ვალუტა

const ORDER = ['centre_1br', 'outside_1br', 'centre_3br', 'outside_3br'];

/**
 * @param {any} md ახალი (Apify) @param {any} ref საცნობარო (იმავე ვალუტაში) ან null
 * @returns {{ implausible: boolean, reason?: string }}
 */
export function checkAgainstReference(md, ref) {
  const items = md?.rent?.items || {};
  for (const k of ORDER) if (items[k] && Number(items[k].average) > MAX_ABSOLUTE_RENT) return { implausible: true, reason: `${k}>${MAX_ABSOLUTE_RENT}` };
  const ri = ref?.rent?.items || {};
  for (const k of ORDER) {
    const a = Number(items[k]?.average); const b = Number(ri[k]?.average);
    if (a > 0 && b > 0) {
      const r = a / b;
      return r > MAX_RENT_RATIO || r < 1 / MAX_RENT_RATIO ? { implausible: true, reason: `${k}:ratio ${r.toFixed(2)}` } : { implausible: false };
    }
  }
  return { implausible: false };
}
