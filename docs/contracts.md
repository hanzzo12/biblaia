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

```js
{
  schemaVersion: 1, rulesVersion, currency: "EUR" | "USD" | null,
  completeness: "complete" | "partial" | "incomplete",
  missing: [{ field, message_ka }],                // რა აკლია სრული შედეგისთვის
  inputsUsed: { mission, country, location, coefficientRow, position, H, A, K, E, C, Q, ... },
  monthly: { H, A, K, C, Q, D, E, T, G, F, S, uncoveredRent, subsidyAboveRent },  // Component-ები
  periodSegments: [{ from, to, days, monthDays, C, G, fullMonth: {D,T,F,S}, prorated: Component }],
  periodTotal: Component | null,
  education: { perChild: [{ memberId, eligible, P, L, reimbursement, personalCost, ruleIds, notes }], total, personal },
  remainderAfterRentAndEducation: Component,        // S + educationReimbursement − G − educationExpense
  insurance: { perPerson: [{ personId, band, annualCap, policyCost, reimbursable, personalCost, status }] },
  oneTimeAllowances: { settlement: Component },     // ერთჯერადი დახმარება
  oneTimeReimbursements: { broker, baggage, travel: [...], extras: [...] },  // ერთჯერადი ხარჯის დაბრუნება
  annualCaps: { insurance: [...] },
  advances: [{ amount, months, monthlyRepayment, schedule: [{ month, repayment, outstanding }], status }],
  fx: { forecast: { USD: "2.8", EUR: "3.2", label_ka: "საპროგნოზო კურსი (პ.2) — არა საანგარიშსწორებო" } },
  warnings: [{ code, message_ka, ruleIds }],
  errors:   [{ code, message_ka, path }]
}
```

`Component`:

```js
{ key: "F", label_ka: "ბინის ქირის სუბსიდია", exact: "1246862730/1000000" | null, amount: "1246.86" | null,
  currency: "EUR", status: "ok" | "undetermined" | "scenario" | "not-applicable" | "manual-unconfirmed",
  ruleIds: ["R-RENT-F-OTHER"], note_ka: "…" }
```

`amount` — ჩვენებისა და ბეჭდვისთვის (ორი ათწილადი), `exact` — ზუსტი წილადი ტესტებისთვის. UI ეკრანზეც და ბეჭდვაშიც იყენებს იმავე `CalculationResult`-ს.

## 4. ბაზრის მონაცემები — `MarketData`

იხ. `src/providers/market-contract.js` (პროვაიდერის ინჟინერი). ბირთვი მას **არ** იღებს; UI ირჩევს და მხოლოდ მომხმარებლის ღილაკით გადააქვს ქირა `rent.amount`-ში `basis: "market-scenario"`-ით.

## 5. მოდულების საჯარო API

- `src/core/index.js`: `calculate`, `validateScenario`, `emptyScenario`, `listMissions`, `resolveMission`, `insuranceBand`, `SCENARIO_SCHEMA_VERSION`.
- `src/core/decimal.js`: `parseDecimalInput(str) → { ok, value: Rational | null, error_ka }`, `formatAmount(rational) → "1 234.57"`.
- `src/providers/index.js`: `createMarketClient({ endpoint, fetchImpl }) → { get(locationId, currency, { signal }) }`, `validateManualMarketEntry`, `importMarketJson`.
- `src/ui/main.js`: esbuild-ის შესასვლელი წერტილი.
