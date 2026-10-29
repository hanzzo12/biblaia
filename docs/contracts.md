# საერთო კონტრაქტები (ეტაპი 2)

მფლობელი: ხელმძღვანელი. ცვლილება მხოლოდ ხელმძღვანელთან შეთანხმებით. ვერსია: `contracts-v1`.

ეს დოკუმენტი აფიქსირებს სამ ინტერფეისს, რომლებზეც ერთდროულად მუშაობენ ბირთვი (`src/core`), UI (`src/ui`) და ბაზრის ადაპტერი (`src/providers`, `worker/`).

## 0. ზოგადი შეთანხმებები

- **თანხა შეყვანაში** — ათწილადი სტრიქონი (`"1500"`, `"1500.5"`) ან `null` (= უცნობი). `"0"` = ნამდვილი ნული. ცარიელი ველი UI-ში → `null`, არასოდეს `"0"`.
- UI ღებულობს როგორც მძიმეს, ისე წერტილს; ნორმალიზაცია `src/core/decimal.js`-ის `parseDecimalInput()`-ით (ერთადერთი პარსერი). დასაშვებია მხოლოდ ერთი ათწილადი გამყოფი; ათასეულის გამყოფი არ მიიღება (`"1,500.00"` → შეცდომა). უარყოფითი, `Infinity`, `NaN`, > 10 000 000 → ვალიდაციის შეცდომა.
- **არითმეტიკა** — ზუსტი რაციონალური (`src/core/rational.js`, BigInt). შუალედური დამრგვალება არ ხდება.
- **დამრგვალება (ტექნიკური პოლიტიკა, არა ნორმა)** — ჩვენებისას 2 ათწილადამდე, half-up (0.005 → 0.01), მხოლოდ საბოლოო ნაჩვენებ მნიშვნელობაზე; ჯამები ითვლება ზუსტი მნიშვნელობებიდან და შემდეგ მრგვალდება (ამიტომ ნაჩვენები ჯამი შეიძლება 0.01-ით განსხვავდებოდეს მრგვალებული შესაკრებების ჯამისგან — ეს აღწერილია ბეჭდვის შენიშვნაში).
- **თარიღები** — `"YYYY-MM-DD"` კალენდარული სტრიქონები; ბირთვი Date ობიექტს/დროის სარტყელს არ იყენებს (საკუთარი კალენდარული ფუნქციები, ნაკიანი წლის წესით).
- **ტექსტი** — ყველა მომხმარებლის/პროვაიდერის ტექსტი UI-ში მხოლოდ `textContent`-ით.

## 1. ნორმატიული მონაცემები — `src/data/normative-data.json`

საბოლოო სქემა აღწერილია `docs/data-schema.md`-ში (მონაცემთა ინჟინერი). ძირითადი კოლექციები: `baseAmounts`, `parameters`, `positionProfiles`, `countries`, `locations`, `costCoefficients`, `missions`, `insuranceCaps`, `baggageCaps`, `dailyRates`, `sourceReferences`, `normalizations`; ზედა დონეზე `schemaVersion`, `rulesVersion`, `edition`. ყველა რიცხვი ათწილადი სტრიქონია; აკლია → `null` + `notes`.

ბირთვი მონაცემებს იღებს არგუმენტად (`calculate(scenario, data)`), ამიტომ ტესტებს შეუძლიათ სინთეზური მონაცემების გადაცემა.

## 2. სცენარი (შეყვანა) — `ScenarioV1`

```js
{
  schemaVersion: 1,
  missionId: "M-A5-R1" | null,
  position: { mode: "annex2" | "annex3", entryId: "A2-R6" | null },
  status: {
    rentHead: "head" | "not-head" | null,        // ქირისა და საკომისიოს წესისთვის; არ გამოიცნობა A%-ით
    headBasis: "institution-head" | "acting-head-20-1" | null,
    actingHead201: { applies: false, actRef: null },   // პ.20¹ — მინისტრის გადაწყვეტილება; A = ხელმძღვანელის მაჩვენებელი
    adminManager202: { applies: false, actRef: null }  // პ.20² — A2-R3 (75%)
  },
  period: { mode: "full-month" }
        | { mode: "dates", start: "2026-11-01", end: "2027-01-31" },
  family: [{
    id: "F1", label: "ოჯახის წევრი 1",
    role: "spouse" | "child" | "stepchild" | "other",
    status: "regular" | "support-recipient" | "guardianship" | "care",
    age: 7 | null, birthDate: "2019-05-01" | null,
    from: null | "YYYY-MM-DD", to: null | "YYYY-MM-DD",          // შემადგენლობის ცვლილება (დან./1 მ.4 პ.5)
    presence: [{ from, to }] | null,      // ადგილსამყოფელ ქვეყანაში ყოფნა (დან.1 მ.4 პ.6; პ.30ბ)
    worksInSameMissionOrCity: false,      // დან.1 მ.4 პ.3 — დანამატი არ ეკუთვნის
    supplementPaidToOtherEmployee: false, // დან.1 მ.4 პ.1–2 — დანამატს სხვა იღებს
    spousePostedInOtherCity: false,       // დან.1 მ.4 პ.2 — მეუღლეზე დანამატი არ გაიცემა
    reimbursedElsewhere: { insurance: false, education: false, travel: false, baggage: false }, // მ.4 პ.4
    adultChildInSchool: false             // ბრძანების შენიშვნა
  }],
  rent: { amount: "1500" | null, basis: "actual" | "planned" | "market-scenario",
          marketRef: null | { locationId, providerId, metric, fetchedAt },
          changes: [{ from: "YYYY-MM-DD", amount: "1600" }] },   // მხოლოდ თარიღების რეჟიმში
  education: [{ memberId: "F2", tuition: "800", registration: null, transport: "100", meals: "100",
                holidayExtraContract: null, freeStateLanguageSchoolAvailable: false, ministerDecision34: false }],
  insurance: [{ personId: "EMP" | "F1", policyCost: "900" | null, alreadyReimbursed: "0" | null }],
  employee: { age: 40 | null, birthDate: null },
  broker: { fee: "300" | null, serviceDate, rotationStartDate, alreadyReimbursed: false, documented: true, specialDecision81: false },
  baggage: { kind: "departure" | "recall" | "recall-5-1", claims: [{ who: "EMP" | "F1", amount: "600" }], previouslyUsed: "0" },
  settlement: { dailyRate: null | { amount: "60", currency: "EUR", source: "…", sourceDate: "…", confirmed: false },
                fx: null | { rate: "…", date: "…", source: "…" }, exclusion9: null | "a" | "b" | "c" | "d" | "e" | "f",
                transfer10: false },
  travel: [{ kind: "departure" | "recall" | "vacation" | "bereavement-17", personId, actualCost, comparableTicket, route, ownCar: false }],
  advances: [{ kind: "rent", amount: "9000", issueDate: "2026-11-01", months: 6, ministerOrder22: false }],
  extras: [{ category: "visa" | "vaccination" | "testing-quarantine" | "toll-parking" | "early-termination-28" | "other",
             amount: "120", justification: "…", ministerDecisionRequired: false }]
}
```

სრული ვალიდაცია: `validateScenario(scenario, data) → { ok, errors: [{ path, code, message_ka }] }`.

## 3. გამოთვლის პასუხი — `CalculationResult`

`calculate(scenario, data)` — სუფთა, სინქრონული, **არასრულ შეყვანაზე არ ისვრის შეცდომას** (აბრუნებს `completeness` + `missingInputs`).

```js
{
  schemaVersion: 1, rulesVersion, currency: "EUR" | "USD" | null,
  completeness: "complete" | "partial" | "incomplete",
  missingInputs: [{ path: "rent.amount", message_ka }],
  inputsUsed: { missionId, mission_ka, countryId, locationId, coefficientId, positionEntryId, positionPercent, rentHead, ... },
  monthly: { H, A, K, C, Q, D, E, T, G, F, S, uncoveredRent, rentSurplus },     // Component-ები (სრული თვე)
  family: [{ memberId, label, eligibility: {                                     // თითო წესზე true | false | null
      monthlySupplement: { value, reason_ka, ruleIds },
      settlement10: { ... }, insurance: { ... }, vacationTravel: { ... }, education: { ... } } }],
  periodSegments: [{ from, to, days, daysInMonth, C, G, fullMonth: { D, T, F, S }, prorated: Component }],
  periodTotal: Component | null,
  education: { perChild: [{ memberId, eligible, components: {...}, P, L, reimbursement, personalCost, ruleIds, notes_ka }],
               total, personal, alternativePooled: Component | null },
  remainder: { value: Component, terms: { S, educationReimbursement, G, educationExpense } }, // S + eduReimb − G − eduExpense
  insurance: { perPerson: [{ personId, band, annualCap, policyCost, alreadyReimbursed, reimbursable, personalCost, status, ruleIds }] },
  oneTimeAllowances: { settlement: Component },
  oneTimeReimbursements: { broker: Component, baggage: { cap, previouslyUsed, claimed, reimbursable, remainingCap }, travel: [Component], extras: [Component] },
  annualCaps: { insurance: [Component] },
  advances: [{ amount, months, monthlyRepayment, schedule: [{ month, repayment, outstanding }], status, ruleIds }],
  fx: { forecast: { USD: "2.8", EUR: "3.2", purpose_ka: "საპროგნოზო კურსი (პ.2) — არა საანგარიშსწორებო", ruleIds } },
  warnings: [{ code, severity: "info" | "warning", message_ka, ruleIds, path }],
  errors:   [{ code, severity: "error", message_ka, ruleIds, path }],
  assumptions: [{ code, message_ka, ruleIds, openQuestion: "OQ-02" }]
}
```

`Component`:

```js
{ id: "F", category: "monthly" | "reimbursement" | "remainder" | "one-time-allowance" | "one-time-reimbursement"
                  | "annual-cap" | "advance" | "liability" | "parameter",
  label_ka: "ბინის ქირის სუბსიდია",
  value: "1246.86" | null,              // ჩვენება/ბეჭდვა, 2 ათწილადი (half-up) ან პროცენტი/კოეფიციენტი როგორც წყაროშია
  exact: "124686273/100000" | null,     // ზუსტი წილადი ტესტებისთვის
  currency: "EUR" | "USD" | null,
  status: "calculated" | "scenario" | "unconfirmed" | "undetermined" | "not_applicable",
  reason_ka: "…", ruleIds: ["R-RENT-F-OTHER"], inputsUsed: { G: "1500", T: "…" } }
```

UI ეკრანზეც და ბეჭდვაშიც იყენებს იმავე `CalculationResult`-ს. დამხმარეები: `ruleCatalog` (ruleId → სათაური, წყარო, სტატუსი; `src/core/rule-catalog.js`, წყარო `docs/rules.md`), `listCountries/listLocations/listMissions/resolveMission(data, id)` (ka/en სახელები, ალიასები, ISO, ბაზრის locationId, დაფინანსების ვალუტა, K/E ან „ნორმატიული მონაცემი არ არის“), `positionProfiles` თითო რეჟიმზე `suggestedRentHead`-ით, ენუმები ქართული სახელებით (`ROLES`, `MEMBER_STATUSES`, `EXTRA_CATEGORIES`).

## 3ა. ხელმძღვანელის გადაწყვეტილებები (ეტაპი 2)

| # | საკითხი | გადაწყვეტილება | სტატუსი |
| --- | --- | --- | --- |
| P-1 | დამრგვალება | ზუსტი გამოთვლა, half-up 2 ათწილადამდე მხოლოდ ჩვენებისას (`R-ROUND-001`) | technical-policy |
| P-2 | თარიღები | ორივე ბოლო ჩათვლით; ცვლილება მოქმედებს საკუთარი თარიღიდან; სეგმენტი = სრული თვის განაკვეთი × დღეები / თვის დღეები | technical-policy (`R-PRORATE-001`) |
| P-3 | G = T | F = T, `assumptions`-ში OQ-01 | interpretation |
| P-4 | განათლების ზღვარი | თითო ბავშვზე; `alternativePooled` ცალკე ჩანს; OQ-02 | interpretation |
| P-5 | საკონსულო დაწესებულების ხელმძღვანელი | საკომისიო 80% — პირდაპირი (პ.8); ქირის 80% — `scenario` სტატუსით + OQ-10 | interpretation |
| P-6 | პ.20¹ | A = ხელმძღვანელის მაჩვენებელი მხოლოდ აქტის მითითებით; ქირა/საკომისიო ხელმძღვანელის წესით — `scenario` (OQ-11) | interpretation |
| P-7 | №4 ქვეყნის სტრიქონი | თუ ქვეყანას მხოლოდ ზოგადი სტრიქონი აქვს → ვრცელდება ყველა ქალაქზე (`calculated` + შენიშვნა OQ-09); თუ ქვეყანას მხოლოდ ქალაქის სტრიქონები აქვს და მისიის ქალაქი მათ შორის არ არის → `undetermined` | interpretation |
| P-8 | ვატიკანი / დანართებში არარსებული მისია | `undetermined`; ახლომდებარე ქალაქის მონაცემი მხოლოდ ახსნით, „ზუსტი“ სტატუსის გარეშე | — |
| P-9 | პირველადი მოწყობა | dailyRate მხოლოდ ხელით, წყაროთი/თარიღით → `unconfirmed`; დადასტურებულ ჯამში არ შედის; სხვა ვალუტა მხოლოდ მითითებული კურსით | OQ-04 |
| P-10 | ასაკის ჯგუფის თარიღი | მომხმარებლის შეყვანილი ასაკი; დაბადების თარიღით — პოლისის/პერიოდის დაწყების დღეს, მონიშნული ვარაუდით (OQ-08) | interpretation |
| P-11 | დაზღვევის ლიმიტი | წლიური, არ პროპორცირდება და არ ემატება შემოსავალს | direct |
| P-12 | ქირა არა-დაფინანსების ვალუტაში | მომხმარებელი შეიყვანს დაფინანსების ვალუტაში; სხვა ვალუტა + კურსი → `scenario` (OQ-14) | interpretation |

## 4. ბაზრის მონაცემები — `MarketData`

იხ. `src/providers/market-contract.js` (პროვაიდერის ინჟინერი). ბირთვი მას **არ** იღებს; UI ირჩევს და მხოლოდ მომხმარებლის ღილაკით გადააქვს ქირა `rent.amount`-ში `basis: "market-scenario"`-ით.

## 5. მოდულების საჯარო API

- `src/core/index.js`: `calculate`, `validateScenario`, `emptyScenario`, `listMissions`, `resolveMission`, `insuranceBand`, `SCENARIO_SCHEMA_VERSION`.
- `src/core/decimal.js`: `parseDecimalInput(str) → { ok, value: Rational | null, error_ka }`, `formatAmount(rational) → "1 234.57"`.
- `src/providers/index.js`: `createMarketClient({ endpoint, fetchImpl, timeoutMs }) → { get(locationId, currency, { signal }) → Promise<MarketData> }` (არასოდეს ისვრის — შეცდომა სტატუსად), `parseManualMarketJson(text) → { ok, data, errors: [{ path, code, message_ka }] }`, `validateManualRecord`. სტატუსები და ფორმა — `src/providers/market-contract.js`.
- `src/ui/main.js`: esbuild-ის შესასვლელი წერტილი.

## 6. v1.1 დამატებები (ბირთვის ინჟინრის წინადადება, ხელმძღვანელის მიერ მიღებული)

არაფერი არ გადარქმეულა/წაშლილა; ყველა დამატება არასავალდებულოა.

- სცენარი: `insurance[].policyStart` (ასაკი დაბადების თარიღიდან, OQ-08); `baggage.callbackAlreadyReimbursed`, `travel[].callbackAlreadyReimbursed` (პ.5²); `travel[].route` = `georgia` | `third-country` | `other`; `advances[].kind` პ.27-ის შემთხვევებისთვის.
- შედეგი: `monthly.DminusT`; `education.expense`; `totals` (დადასტურებული ქვეჯამი ცალკე სცენარული/დაუდასტურებელი ნაწილისგან, დაუდგენელი და სხვა ვალუტის ჩანაწერების სია); `oneTimeAllowances.vacationMonth` (ყოველთვის `scenario`, ჯამში არ ემატება); `fx.forecast.usableForSettlement = false`, `fx.forecast.illustrativeS_GEL`; `oneTimeReimbursements.baggage.perClaim`, `.personalCost`; `advances[].limit`, `advances[].requiresMinisterOrder`; `family[]`/`insurance.perPerson[]`-ში label და ასაკი.
- სისრულე: `incomplete` — D ვერ ითვლება (მისია/თანამდებობა/K აკლია); `partial` — სავალდებულო შეყვანა აკლია ან S/პერიოდის ჯამი/ნაშთი/შეყვანილი ერთჯერადი ჩანაწერი დაუდგენელი ან დაუდასტურებელია; `complete` — დანარჩენი. მარტო `scenario` სტატუსი შედეგს `partial`-ად არ აქცევს.
