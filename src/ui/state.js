// აპის მდგომარეობა: ScenarioV1 (docs/contracts.md §2) + UI-ის დამხმარე მონაცემები.

export function fallbackScenario() {
  return {
    schemaVersion: 1,
    missionId: null,
    position: { mode: 'annex2', entryId: null },
    status: { rentHead: null, headBasis: null, actingHead201: { applies: false, actRef: null }, adminManager202: { applies: false, actRef: null } },
    period: { mode: 'full-month' },
    family: [],
    rent: { amount: null, basis: 'actual', marketRef: null, changes: [] },
    education: [],
    insurance: [],
    employee: { age: null, birthDate: null },
    broker: { fee: null, serviceDate: null, rotationStartDate: null, alreadyReimbursed: false, documented: false, specialDecision81: false },
    baggage: { kind: 'departure', claims: [], previouslyUsed: null },
    settlement: { dailyRate: null, fx: null, exclusion9: null, transfer10: false },
    travel: [],
    advances: [],
    extras: [],
  };
}

/** @param {string} path */
const parts = (path) => path.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p));

export function getPath(obj, path) {
  let o = obj;
  for (const p of parts(path)) { if (o == null) return undefined; o = o[p]; }
  return o;
}

export function setPath(obj, path, value) {
  const ps = parts(path);
  let o = obj;
  for (let i = 0; i < ps.length - 1; i++) {
    if (o[ps[i]] == null || typeof o[ps[i]] !== 'object') o[ps[i]] = typeof ps[i + 1] === 'number' ? [] : {};
    o = o[ps[i]];
  }
  o[ps[ps.length - 1]] = value;
}

export const clone = (x) => JSON.parse(JSON.stringify(x));

export function createStore(data, initialScenario) {
  const store = {
    data,
    scenario: initialScenario,
    raw: {},        // path → შეყვანილი ტექსტი (არასწორი მნიშვნელობაც ინახება)
    errors: {},     // path → შეცდომის ტექსტი
    ids: {},        // path → DOM id (შეცდომების ბმულებისთვის)
    labels: {},     // path → ველის წარწერა (ბეჭდვის შეყვანის ცხრილისთვის)
    result: null,
    ui: { countryId: null, locationId: null, rentLocationId: null, notice: null },
    listeners: { calc: [], structure: [] },
    on(kind, fn) { this.listeners[kind].push(fn); },
    emit(kind, detail) { for (const fn of this.listeners[kind]) fn(detail); },
    get(path) { return getPath(this.scenario, path); },
    set(path, value) { setPath(this.scenario, path, value); this.schedule(); },
    _pending: false,
    schedule() {
      if (this._pending) return;
      this._pending = true;
      const run = () => { this._pending = false; this.emit('calc'); };
      if (typeof requestAnimationFrame === 'function' && !document.hidden) requestAnimationFrame(run); else setTimeout(run, 0);
    },
    /** სიის ელემენტის წაშლისას შესაბამისი raw/errors გასაღებების გასუფთავება */
    forget(prefix) {
      for (const m of [this.raw, this.errors, this.ids, this.labels]) for (const k of Object.keys(m)) if (k === prefix || k.startsWith(prefix + '.')) delete m[k];
    },
    structure(section) { this.emit('structure', section); this.schedule(); },
  };
  return store;
}
