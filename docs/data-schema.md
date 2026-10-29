# ნორმატიული მონაცემების სქემა (`src/data/normative-data.json`)

სტატუსი: პირველი ეტაპი, მონაცემთა ინჟინერი. `schemaVersion: 1`, `rulesVersion: "01-82/supplied-pdf-2026-10-28"`.

## 1. მილსადენი

```
sources/original/rotation_sources.pdf            (SHA-256 7ccfcaaa…8717, 34 გვ.)
  │  python3 -I scripts/extract-annexes.py        pdfplumber-ის სიტყვები + ბადის ხაზები;
  │                                               layout-ტექსტთან ჯვარედინი შემოწმება
  ▼
sources/extracted/annex02.raw.json … annex10.raw.json   (ნედლი, გაუსწორებელი)
  │  python3 -I scripts/extract-normative-data.py  ნორმალიზაცია + სახელით მიბმა
  ▼
src/data/normative-data.json                      (აპის ერთადერთი წყარო)
  │  node scripts/validate-data.mjs               exit ≠ 0 შეცდომისას
```

ორივე Python სკრიპტი დეტერმინისტულია; ხელახლა გაშვება იმავე ფაილებს იძლევა. ხელით რედაქტირება `normative-data.json`-ში არ ხდება — შესწორება ხდება `scripts/extract-normative-data.py`-ის კურირებულ ცხრილებში (`MISSIONS`, `LOCATIONS`, `COUNTRIES`, `PARAMETERS`, `K_CITY_ROWS`) და ფიქსირდება `normalizations`-ში.

### 1.1 ამოღების მეთოდი და ვიზუალური შემოწმება

- სტრიქონის „ღუზა“ — პირველ სვეტში დაბეჭდილი ნომერი (`1`, `62.`); სტრიქონის საზღვარი — ორ ღუზას შორის არსებული ჰორიზონტალური ბადის ხაზი (ან შუაწერტილი, თუ ხაზი არ არის). სიტყვა სტრიქონს მიეკუთვნება `top + 2pt`-ით (დან. №4 გვ. 16-ზე სტრ. 26 და 51-ის ტექსტი ქვედა ხაზზე გადადის). სვეტები — თითოეული გვერდის ვერტიკალური ხაზებით.
- pdfplumber-ის ჩაშენებული `extract_tables()` არ გამოიყენება: დან. №4-ში ურევს სტრ. 26/27 და 51/52-ს და კარგავს სტრ. 55-ს.
- გვერდის საზღვარზე გაყოფილი უჯრა (დან. №7 სტრ. 25, დან. №10 სტრ. 28) წინა სტრიქონს ემატება.
- ჯვარედინი შემოწმება: თითოეულ გვერდზე ამოღებული მნიშვნელობების მულტისიმრავლე = `rotation_sources.layout.txt`-ის იმავე გვერდის მნიშვნელობების მულტისიმრავლე (`layoutCrossCheck[].status = "equal-multisets"` — ცხრილის ყველა 21 გვერდზე), სტრიქონის დონეზე — `values-present-on-layout-page`.
- ყველა გვერდი დარენდერდა PNG-ად (pypdfium2, scale 2.2); ცხრილების გვერდები 13–34 ვიზუალურად შემოწმდა (გვ. 18 მხოლოდ დან. №4-ის ცვლილებების სიაა). დაკვირვებები `VISUAL_NOTES`-შია და ნედლ ჩანაწერში `notes`-ად ჩანს.

### 1.2 რაოდენობები (როგორც წყაროშია)

| დანართი | დაბეჭდილი სტრიქონი | ამოღებული | დუბლი | ეფექტური | შენიშვნა |
| --- | ---: | ---: | ---: | ---: | --- |
| №2 თანამდებობები | 9 | 0 | 0 | 9 | |
| №3 ცენტრალური აპარატი | 8 | 0 | 0 | 8 | |
| №4 K/E | 69 | 0 | 0 | 69 | 61 = სერბეთი, მისიის გარეშე |
| №5 EUR დაწესებულებები | 45 | 1 (№40) | 0 | 44 | |
| №6 USD დაწესებულებები | 38 | 0 | 0 | 38 | სულ 82 დაწესებულება |
| №7 დაზღვევა EUR | 45 | 1 (№40) | 0 | 44 | ნუმერაცია/რიგი №5-ისგან განსხვავდება |
| №8 დაზღვევა USD | 39 | 0 | 1 (№31) | 38 | |
| №9 ბარგი EUR | 44 | 0 | 0 | 44 | ამოღებული სტრიქონი აქ გადანომრილია |
| №10 ბარგი USD | 38 | 0 | 0 | 38 | |

## 2. ნედლი ამონაწერი (`sources/extracted/annexNN.raw.json`)

```
{ annex, title, pages, sourceFile, sha256, extractedWith, columns: [...],
  counts: { printedRows, distinctRowNumbers, duplicatedRowCopies, removedRows, effectiveEntries },
  layoutCrossCheck: [{ page, extractedValueTokens, layoutValueTokens, onlyInExtract, onlyInLayout, status }],
  rows: [{ rowNo, rowNoRaw, page, cells: {<column>: "raw string"}, cellLines: {<column>: ["visual line", …]},
           flags: [...], layoutCrossCheck, bandY, bandSource, notes }] }
```

`cells` — ზუსტად ამოღებული ტექსტი (სიტყვები ერთი ჰარით). ალმები (`flags`): `removed`, `duplicated-row`, `duplicated-text`, `multi-value`, `decimal-comma`, `displaced`, `trailing-bracket`, `split-token`, `continued-on-next-page`, `empty-value`.

## 3. ნორმალიზებული ფაილი

### 3.1 ზოგადი წესები

- **რიცხვები** — ათწილადი სტრიქონები `^\d+(\.\d+)?$` (`"2.06"`, `"3100"`), დადებითი. დაბეჭდილი სიზუსტე ინახება (`"2.4"`, `"2.000"`). JS-ში `Number()`-ით არ გადაიყვანოთ გამოთვლისთვის — ბირთვი აგებს ზუსტ წილადს.
- **უცნობი ≠ 0**: არარსებული ნორმატიული მნიშვნელობა არის `null` (UI: „დაუდგენელი“). ვალიდატორი 0-ს არცერთ ნორმატიულ ველში არ უშვებს.
- **ID-ები** სტაბილურია და წყაროს სტრიქონს მიუთითებს: `M-A5-R41` (დან. №5 სტრ. 41), `K-A4-R22`, `INS-A8-R25`, `BAG-A9-R43`, `A2-R3`. ქვეყანა — ISO 3166-1 alpha-2; ქალაქი — `<ISO2>-<CITY>`.
- ვალუტა მხოლოდ `EUR` ან `USD`.
- ყოველ ჩანაწერს აქვს `sourceRef` (+ `page`).

### 3.2 ველები

| ველი | შინაარსი |
| --- | --- |
| `schemaVersion`, `rulesVersion` | სქემის ვერსია (1) და სამართლებრივი მონაცემების ვერსია |
| `edition` | `note`, `latestAmendmentSeen` (`№01-317 of 2026-08-13`), `verification: "supplied-working-copy-only"`, `fullConsolidationVerified: false` |
| `sourceReferences[]` | `id` (`SRC-ORDER`, `SRC-ANNEX1` … `SRC-ANNEX10`), `title`, `annex`, `pages: [from,to]`, `file`, `sha256`, `latestAmendmentNoted` (სამუშაო ასლის ანოტაციიდან), `verification` |
| `baseAmounts[]` | `H-EUR` 3100, `H-USD` 3495 (ბრძანება პ. 3) |
| `parameters[]` | `id`, `value`, `unit`, `sourceRef`, `point`, `citation`, `notes`. Q=7; ქირის სუბსიდიის 80/200 და 50/100; საპროგნოზო კურსი 2.8/3.2 (**მხოლოდ საპროგნოზო**); 60-მაგი და 10%; მაკლერი 80/50, 6 თვე, 1 თვის ქირა; შეჩერება 1 თვე; ავანსი 6 თვე/6 თვე; განათლება 690 EUR / 750 USD, 80%; სრულწლოვანი შვილი +1 წელი; ავტომანქანა 100% |
| `positionProfiles[]` | `annex2` და `annex3` (დამოუკიდებელი რეჟიმები); `entries[]`: `id`, `rowNo`, `title_ka` (ზუსტი), `positions_ka[]` (დაყოფილი), `percent`, `notes` (მაგ. `A2-R3` — პ. 20² ადმინისტრაციული მენეჯერი, 75%) |
| `countries[]` | `id`=`iso2`, `name_ka`, `name_en`, `officialName_ka` |
| `locations[]` | მხოლოდ რეალური ქალაქები: `id`, `countryId`, `name_ka`, `name_en`, `altNames[]`, `region` (აშშ-ის შტატი და სხვ.). `VA-VATICAN-CITY` — `marketFallbackLocationId: "IT-ROME"` + `marketFallbackNote` (მხოლოდ ახსნილი სარეზერვო, არასოდეს „ზუსტი დამთხვევა“) |
| `costCoefficients[]` | `id`, `annex4Row`, `rawLabel`, `countryId`, `locationIds` (`null` = ქვეყნის სტრიქონი), `scope` (`country`/`city`), `k`, `ePercent`, `sourceRef`, `page`, `notes` |
| `missions[]` | `id`, `annex` (5/6), `rowNo`, `rawLabel` (ზუსტი), `name_ka`, `name_en`, `type` (`embassy`, `consulate-general`, `consulate`, `permanent-mission`, `mission-to-org`, `embassy-section`, `other`), `countryId`, `locationId`, `locationBasis` (`source-explicit` / `inferred-capital` / `inferred-seat`), `fundingCurrency`, `costCoefficientId` (ან `null`), `costCoefficientBasis` (`city-row` / `country-row` / `none`), `insuranceCapId`, `baggageCapId`, `status: "listed-in-supplied-annex"`, `sourceRef`, `page`, `notes` |
| `insuranceCaps[]` | `id`, `annex` (7/8), `rowNo`, `rawLabel`, `currency`, `bands` — ზუსტად 12 გასაღები `0-18, 19-24, 25-29, 30-34, 35-39, 40-44, 45-49, 50-54, 55-59, 60-64, 65-69, 70+` (წყაროში „00-18“ და „70-ზევით“) |
| `insuranceBandRule` | ასაკობრივი ჯგუფების წაკითხვის წესი (სრული წლები) |
| `baggageCaps[]` | `id`, `annex` (9/10), `rowNo`, `rawLabel`, `currency`, `amount` |
| `dailyRates[]` | ცარიელი — №211 დადგენილების №1 დანართი არ მოგვეწოდა |
| `dataGaps[]` | `GAP-DAILY-RATES`, `GAP-K-VATICAN`, `GAP-OPERATIONAL-STATUS` |
| `removedEntries[]` | დან. №5 სტრ. 40 და დან. №7 სტრ. 40 — არჩევადი არ არის |
| `normalizations[]` | `id`, `annex`, `rowNo`, `field`, `raw`, `normalized`, `reason` (16 ჩანაწერი) |

### 3.3 მიბმის წესები

1. **დაზღვევა და ბარგი სახელით.** თითოეულ დაწესებულებას `MISSIONS[].key` რეგულარული გამოსახულება აქვს (მაგ. `სტამბ[უო]ლ`, `ფრან[კქ]ფურტ`, `საკონსულო\s+ქ\.\s?ნიუ-`), რომელიც თავისი ვალუტის სამივე დანართში (№5/7/9 ან №6/8/10) **ზუსტად ერთ** არაამოღებულ სტრიქონს უნდა ემთხვეოდეს — სხვაგვარად build ჩერდება. მასივის ინდექსი არ გამოიყენება. ყოველი დაზღვევის/ბარგის სტრიქონი ზუსტად ერთ დაწესებულებას ეკუთვნის.
2. **K/E**: თუ დანართ №4-ში დაწესებულების ქალაქის სტრიქონია (ვაშინგტონი 5, ნიუ-იორკი 6, სან-ფრანცისკო 64, ბარი 65, მილანი 67, ლიონი 68, კრაკოვი 69), ის პრიორიტეტულია (`city-row`). წინააღმდეგ შემთხვევაში — ქვეყნის სტრიქონი (`country-row`). წყაროში ქვეყნის სტრიქონის სხვა ქალაქზე გავრცელება პირდაპირ არ წერია; ეს დაშვება `costCoefficientBasis`-ით ჩანს და სამართლებრივმა ანალიტიკოსმა უნდა დაადასტუროს. სტრიქონის გარეშე: `null` (ვატიკანი).
3. **ადგილმდებარეობა**: სადაც წყარო ქალაქს ასახელებს — `source-explicit`; საელჩოები — `inferred-capital` / `inferred-seat` (ჰააგა, ბერნი, თელ-ავივი, ბრიუსელი-ნატო, სტრასბურგი-ევროპის საბჭო, ნიუ-იორკი-გაერო, ვატიკანი). ბაზრის API-ს ეგზავნება მხოლოდ `locationId`, არა დაწესებულების სახელი.
4. სერბეთის K-სტრიქონი (`K-A4-R61`, `RS-BELGRADE`) შენახულია, მაგრამ მისია არ იქმნება.

## 4. ვალიდაცია (`scripts/validate-data.mjs`)

ამოწმებს: ზედა დონის ფორმას; ID-ების უნიკალურობას (ყველა კოლექციაში); ყველა მითითების გადაწყვეტას; რიცხვები დადებითი ათწილადი სტრიქონებია (0 აკრძალულია); ვალუტა EUR/USD; 12 ასაკობრივ ჯგუფს; დაწესებულების ვალუტა = დაზღვევის/ბარგის სტრიქონის ვალუტა და დანართი (№5→7/9 EUR, №6→8/10 USD); K-სტრიქონის ქვეყანა/ქალაქი და ქალაქის სტრიქონის პრიორიტეტი; რაოდენობებს (მოსალოდნელი და ნედლ ამონაწერებთან შედარებით); ამოღებული სტრიქონი არჩევადი არ არის; ყოველი cap-სტრიქონი ზუსტად ერთ დაწესებულებას ეკუთვნის; `null` K მხოლოდ ახსნით; ცნობილი შესწორებები (`T-DATA-IRAN-K`, `T-DATA-ODESA-INS`, `T-DATA-KYIV-INS`, `T-DATA-LYON-BAG`, `T-DATA-STUTTGART`, `T-DATA-COE`, `T-DATA-NATO-SEPARATE`, `T-DATA-NY-SEPARATE`, `T-DATA-VATICAN-K-NULL`, `T-DATA-NO-SERBIA-MISSION`, `T-DATA-NO-MUNICH`, `T-DATA-COUNTS`); PDF-ის SHA-256.

```
node scripts/validate-data.mjs [ფაილი]     # 0 = OK, 1 = შეცდომა, 2 = წაკითხვა ვერ მოხერხდა
```

## 5. ცვლილებები სამუშაო სქემასთან შედარებით

- დამატებულია: `missions[].locationBasis`, `costCoefficientBasis`, `page`; `costCoefficients[].scope`, `page`; `positionProfiles[].entries[].positions_ka`; `insuranceCaps[].page`, `insuranceBandRule`; `parameters[].unit`, `notes`; `sourceReferences[].latestAmendmentNoted`, `verification`; `edition.fullConsolidationVerified`; ზედა დონეზე `dataGaps`, `removedEntries`.
- `normalizations[]`-ს დაემატა `field`.
- `locations[]` — `marketFallbackLocationId` / `marketFallbackNote` (მხოლოდ ვატიკანი).
- `mission.type` მნიშვნელობების სია უცვლელია; კომბინირებული დაწესებულება (საელჩო + წარმომადგენლობა) ერთი ჩანაწერია `type: "embassy"`-ით, რადგან დანართი №5/6 მას ერთ სტრიქონად ასახელებს.
