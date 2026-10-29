// Temporary minimal full-month calculation (being extended). See contracts §3.
import { R, mul, div, add, sub, pct, cmp, min, max, toFixed2, toExactString, ZERO } from './rational.js';
import { parseDecimalInput } from './decimal.js';
import { getIndex } from './lookup.js';

export const SCENARIO_SCHEMA_VERSION = 1;

const comp = (id, label_ka, v, currency, status, ruleIds, extra = {}) => ({
  id, category: 'monthly', label_ka, value: v == null ? null : toFixed2(v), exact: v == null ? null : toExactString(v),
  currency, status, reason_ka: extra.reason_ka || '', ruleIds, inputsUsed: extra.inputsUsed || {},
});

export function calculate(scenario, data) {
  const ix = getIndex(data);
  const m = ix.missions.get(scenario?.missionId);
  const cur = m?.fundingCurrency ?? null;
  const k = m?.costCoefficientId ? ix.k.get(m.costCoefficientId) : null;
  const pos = ix.positions.get(scenario?.position?.entryId);
  const H = cur ? R(ix.base.get(cur).amount) : null;
  const C = (scenario?.family || []).length;
  const D = H && pos && k ? mul(mul(mul(H, pct(pos.percent)), k.k), pct(100 + C * 7)) : null;
  const T = D && k ? mul(D, pct(k.ePercent)) : null;
  const G = parseDecimalInput(scenario?.rent?.amount).value;
  let F = null;
  if (T && G) {
    if (G.n === 0n) F = ZERO;
    else if (cmp(G, T) <= 0) F = T;
    else {
      const head = scenario?.status?.rentHead === 'head';
      F = add(T, min(mul(sub(G, T), head ? pct(80) : pct(50)), head ? mul(T, 2) : T));
    }
  }
  const S = D && T && F ? add(sub(D, T), F) : null;
  const st = (v) => (v == null ? 'undetermined' : 'calculated');
  return {
    schemaVersion: 1, rulesVersion: data.rulesVersion, currency: cur,
    completeness: S ? 'complete' : 'incomplete', missingInputs: [], inputsUsed: {},
    monthly: { H: comp('H', 'საბაზისო თანხა', H, cur, st(H), ['R-H-001']), D: comp('D', 'პერსონალური განაკვეთი', D, cur, st(D), ['R-D-001']),
      T: comp('T', 'ბინის ქირის წილი', T, cur, st(T), ['R-T-001']), G: comp('G', 'ქირა', G, cur, st(G), ['R-RENT']),
      F: comp('F', 'ბინის ქირის სუბსიდია', F, cur, st(F), ['R-RENT-F-OTHER']), S: comp('S', 'ყოველთვიური განაკვეთი', S, cur, st(S), ['R-S-001']) },
    family: [], periodSegments: [], periodTotal: null, warnings: [], errors: [], assumptions: [],
  };
}
