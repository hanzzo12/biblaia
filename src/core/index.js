// Public API of the calculation core (contracts §5). Pure ES modules; no DOM, no network.
export { calculate, SCENARIO_SCHEMA_VERSION } from './calculate.js';
export { validateScenario, emptyScenario, emptyFamilyMember } from './scenario.js';
export { listCountries, listLocations, listMissions, resolveMission, positionProfiles, getParameter, dailyRateForMission, MISSION_TYPES_KA } from './lookup.js';
export { insuranceBand, BANDS } from './formulas.js';
export { parseDecimalInput, formatAmount } from './decimal.js';
export { ruleCatalog, RULE_IDS, RULES_REGISTRY_VERSION, hasRule } from './rule-catalog.js';
export {
  ROLES, MEMBER_STATUSES, DEPENDENT_STATUSES, EXTRA_CATEGORIES, TRAVEL_KINDS, TRAVEL_ROUTES, BAGGAGE_KINDS, SETTLEMENT_EXCLUSIONS,
  ADVANCE_KINDS, RENT_HEAD, RENT_BASIS, COMPONENT_STATUSES, COMPLETENESS, CATEGORIES,
} from './enums.js';
