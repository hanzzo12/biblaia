// Lookups over normative data (pure; data passed in). contracts §3 helpers.

const byId = new WeakMap();

function idx(data) {
  let ix = byId.get(data);
  if (!ix) {
    const m = (arr) => new Map((arr || []).map((x) => [x.id, x]));
    ix = {
      countries: m(data.countries), locations: m(data.locations), missions: m(data.missions),
      k: m(data.costCoefficients), ins: m(data.insuranceCaps), bag: m(data.baggageCaps),
      params: m(data.parameters), base: new Map((data.baseAmounts || []).map((b) => [b.currency, b])),
      positions: new Map(),
    };
    for (const p of data.positionProfiles || []) for (const e of p.entries || []) ix.positions.set(e.id, { ...e, mode: p.id });
    byId.set(data, ix);
  }
  return ix;
}

export const getIndex = idx;

const TYPE_KA = {
  embassy: 'საელჩო', 'consulate-general': 'გენერალური საკონსულო', consulate: 'საკონსულო',
  'permanent-mission': 'მუდმივი წარმომადგენლობა', 'mission-to-org': 'წარმომადგენლობა საერთაშორისო ორგანიზაციასთან',
  'embassy-section': 'ინტერესების სექცია', other: 'სხვა',
};
export const MISSION_TYPES_KA = Object.freeze({ ...TYPE_KA });

/** Countries that have at least one mission (or all with { all: true }). */
export function listCountries(data, { all = false } = {}) {
  const ix = idx(data);
  const withMission = new Set((data.missions || []).map((m) => m.countryId));
  return (data.countries || [])
    .filter((c) => all || withMission.has(c.id))
    .map((c) => ({ id: c.id, iso2: c.iso2, name_ka: c.name_ka, name_en: c.name_en, officialName_ka: c.officialName_ka,
      missionCount: (data.missions || []).filter((m) => m.countryId === c.id).length,
      locationIds: (data.locations || []).filter((l) => l.countryId === c.id).map((l) => l.id) }))
    .sort((a, b) => a.name_ka.localeCompare(b.name_ka, 'ka'))
    .map((c) => (void ix, c));
}

/** Cities (optionally of one country). Real cities only; never institution names. */
export function listLocations(data, countryId = null) {
  return (data.locations || [])
    .filter((l) => !countryId || l.countryId === countryId)
    .map((l) => ({ ...l, altNames: [...(l.altNames || [])],
      missionIds: (data.missions || []).filter((m) => m.locationId === l.id).map((m) => m.id) }))
    .sort((a, b) => a.name_ka.localeCompare(b.name_ka, 'ka'));
}

/**
 * Missions with display fields. filter: { countryId?, locationId?, query? } (query matches ka/en/alt names, ISO).
 */
export function listMissions(data, filter = {}) {
  const out = [];
  for (const m of data.missions || []) {
    if (filter.countryId && m.countryId !== filter.countryId) continue;
    if (filter.locationId && m.locationId !== filter.locationId) continue;
    const r = resolveMission(data, m.id);
    if (filter.query && !matches(r, filter.query)) continue;
    out.push(r);
  }
  return out.sort((a, b) => (a.country_ka || '').localeCompare(b.country_ka || '', 'ka') || a.name_ka.localeCompare(b.name_ka, 'ka'));
}

function matches(r, q) {
  const s = String(q).trim().toLowerCase();
  if (!s) return true;
  const hay = [r.name_ka, r.name_en, r.rawLabel, r.country_ka, r.country_en, r.countryId, r.location_ka, r.location_en,
    ...(r.locationAltNames || [])].filter(Boolean).map((x) => x.toLowerCase());
  return hay.some((h) => h.includes(s));
}

/**
 * Resolve one mission: names, country, city (market locationId), funding currency, K/E or
 * an explicit "no normative data" state, insurance/baggage rows. Returns null for unknown ids.
 */
export function resolveMission(data, id) {
  const ix = idx(data);
  const m = ix.missions.get(id);
  if (!m) return null;
  const c = ix.countries.get(m.countryId) || null;
  const l = ix.locations.get(m.locationId) || null;
  const k = m.costCoefficientId ? ix.k.get(m.costCoefficientId) || null : null;
  const ins = m.insuranceCapId ? ix.ins.get(m.insuranceCapId) || null : null;
  const bag = m.baggageCapId ? ix.bag.get(m.baggageCapId) || null : null;
  const fallback = l && l.marketFallbackLocationId ? ix.locations.get(l.marketFallbackLocationId) || null : null;
  return {
    id: m.id, annex: m.annex, rowNo: m.rowNo, name_ka: m.name_ka, name_en: m.name_en, rawLabel: m.rawLabel,
    type: m.type, type_ka: TYPE_KA[m.type] || m.type,
    countryId: m.countryId, country_ka: c?.name_ka ?? null, country_en: c?.name_en ?? null,
    locationId: m.locationId, location_ka: l?.name_ka ?? null, location_en: l?.name_en ?? null,
    locationAltNames: l?.altNames ?? [], region: l?.region ?? null, locationBasis: m.locationBasis,
    marketLocationId: m.locationId,
    marketFallback: fallback ? { locationId: fallback.id, name_ka: fallback.name_ka, name_en: fallback.name_en,
      matchStatus: 'nearest-city-fallback', note_ka: l.marketFallbackNote } : null,
    fundingCurrency: m.fundingCurrency,
    coefficient: k
      ? { status: 'available', id: k.id, annex4Row: k.annex4Row, k: k.k, ePercent: k.ePercent, scope: k.scope,
        basis: m.costCoefficientBasis, rawLabel: k.rawLabel, page: k.page }
      : { status: 'no-normative-data', id: null, k: null, ePercent: null, basis: 'none',
        note_ka: 'ნორმატიული მონაცემი არ არის (დანართ №4-ში შესაბამისი სტრიქონი არ არის) — დაუდგენელი.' },
    insuranceCapId: m.insuranceCapId ?? null, insuranceCap: ins,
    baggageCapId: m.baggageCapId ?? null, baggageCap: bag,
    status: m.status, notes: m.notes ?? null, sourceRef: m.sourceRef, page: m.page,
  };
}

/** Position profiles per mode, with suggestedRentHead (a hint only; never decides the rent rule). */
export function positionProfiles(data) {
  return (data.positionProfiles || []).map((p) => ({
    id: p.id, title_ka: p.title_ka, appliesTo: p.appliesTo, sourceRef: p.sourceRef,
    entries: p.entries.map((e) => ({ ...e, mode: p.id, suggestedRentHead: suggestHead(p.id, e) })),
  }));
}

function suggestHead(mode, e) {
  if (mode !== 'annex2') return 'not-head';
  if (e.rowNo === 1) return 'head';           // ambassador / permanent representative — heads of institution
  if (e.rowNo === 2) return 'head-consular';  // consul general / consul heading a post → OQ-10 (P-5)
  return 'not-head';
}

export function getParameter(data, id) {
  return idx(data).params.get(id)?.value ?? null;
}
