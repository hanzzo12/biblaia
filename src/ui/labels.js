// UI-ის ქართული წარწერები (docs/ui-design.md §3). ნორმატიული სახელები მოდის მონაცემებიდან/ბირთვიდან.
// აკრძალული ტერმინები (არ გამოიყენება): იხ. tests/e2e/ui-smoke.test.js BANNED.

export const L = {
  appTitle: 'დიპლომატიური როტაციის კალკულატორი',
  appSubtitle: 'ბრძანება №01-82',
  search: 'ძიება (ქართულად ან ლათინურად)',
  country: 'ქვეყანა', city: 'ქალაქი', mission: 'დაწესებულება',
  choose: '— აირჩიეთ —',
  useAsPlannedRent: 'გამოვიყენო დაგეგმილ ქირად',
  mode: 'გაანგარიშების რეჟიმი', annex2: 'დანართი №2', annex3: 'დანართი №3',
  position: 'თანამდებობა',
  rentHead: 'წარმომადგენლობის ხელმძღვანელი (ქირა და მაკლერი)',
  rent: 'ბინის ყოველთვიური ქირა (G)',
  remainder: 'ქირისა და შეყვანილი განათლების ხარჯის შემდეგ დარჩენილი თანხა',
  S: 'ყოველთვიური სამივლინებო თანხა (S)',
};

export const COMPLETENESS = {
  complete: 'სრული',
  partial: 'ნაწილობრივი',
  incomplete: 'არასრული — ძირითადი თანხა დაუდგენელია',
};

export const COMP_STATUS = {
  calculated: 'გამოთვლილი', scenario: 'სცენარი', unconfirmed: 'დაუდასტურებელი',
  undetermined: 'დაუდგენელი', not_applicable: 'არ ვრცელდება',
};

export const MONTHLY = {
  H: 'საბაზისო თანხა (H)', A: 'თანამდებობრივი მაჩვენებელი (A)', K: 'ღირებულების კოეფიციენტი (K)',
  C: 'დანამატის უფლების მქონე ოჯახის წევრები (C)', Q: 'ოჯახის დანამატი (Q)',
  D: 'საანგარიშო თანხა (D)', E: 'ბინის წილის პროცენტი (E)', T: 'ბინის წილი (T)',
  G: 'ბინის ყოველთვიური ქირა (G)', F: 'ბინის ქირის ანაზღაურება (F)', S: 'ყოველთვიური სამივლინებო თანხა (S)',
  uncoveredRent: 'ქირის დაუფარავი ნაწილი, max(G − F, 0)', rentSurplus: 'F − G დადებითი სხვაობა',
};
export const PERCENT_IDS = new Set(['A', 'E', 'Q']);

export const ROLES = { spouse: 'მეუღლე', child: 'შვილი', stepchild: 'გერი', other: 'სხვა' };
export const MEMBER_STATUSES = {
  regular: 'ჩვეულებრივი', 'support-recipient': 'მხარდაჭერის მიმღები',
  guardianship: 'მეურვეობის ქვეშ', care: 'მზრუნველობის ქვეშ',
};
export const ELIGIBILITY = {
  monthlySupplement: '7% დანამატი', settlement10: 'მოწყობა +10%', insurance: 'დაზღვევა',
  vacationTravel: 'შვებულების მგზავრობა', education: 'განათლება',
};
export const EXTRA_CATEGORIES = {
  visa: 'ვიზა', vaccination: 'სავალდებულო ვაქცინაცია', 'testing-quarantine': 'ტესტირება / კარანტინი',
  'toll-parking': 'ფასიანი გზა / პარკინგი (სამსახურებრივი ავტომანქანა)',
  'early-termination-28': 'ხელშეკრულების ვადამდე შეწყვეტა (პ. 28)', other: 'სხვა',
};
export const TRAVEL_KINDS = {
  departure: 'გამგზავრება', recall: 'გამოწვევა', vacation: 'შვებულების მგზავრობა', 'bereavement-17': 'განსაკუთრებული მგზავრობა (პ. 17)',
};
export const BAGGAGE_KINDS = { departure: 'გამგზავრება', recall: 'გამოწვევა', 'recall-5-1': 'გამოწვევა (პ. 5¹)' };
export const HEAD_BASIS = { 'institution-head': 'დაწესებულების ხელმძღვანელი', 'acting-head-20-1': 'ხელმძღვანელის მოვალეობის შემსრულებელი (პ. 20¹)' };
export const RENT_BASIS = { actual: 'ფაქტობრივი (ხელშეკრულებით)', planned: 'დაგეგმილი', 'market-scenario': 'საბაზრო სცენარი' };

export const RENT_METRICS_KA = {
  centre_1br: 'ცენტრი — 1 საძინებელი', centre_3br: 'ცენტრი — 3 საძინებელი',
  outside_1br: 'ცენტრის გარეთ — 1 საძინებელი', outside_3br: 'ცენტრის გარეთ — 3 საძინებელი',
};
export const INDEX_KA = {
  costOfLivingExcludingRent: 'ცხოვრების ღირებულების ინდექსი (ქირის გარეშე)',
  rentIndex: 'ქირის ინდექსი',
  costOfLivingPlusRent: 'ცხოვრების ღირებულების ინდექსი ქირით',
};

export const MARKET_STATUS = {
  loading: 'იტვირთება…', fresh: 'განახლებულია', cached: 'შენახული ასლი', stale: 'მოძველებულია',
  manual: 'ხელით შეყვანილი', partial: 'ნაწილობრივ ხელმისაწვდომია', not_found: 'ვერ მოიძებნა',
  network_error: 'კავშირი ვერ შედგა', timeout: 'მოთხოვნის დრო ამოიწურა',
  not_configured: 'პროვაიდერი არ არის კონფიგურირებული', unauthorized: 'პროვაიდერმა წვდომა უარყო',
  rate_limited: 'მოთხოვნების ლიმიტი ამოიწურა', upstream_error: 'პროვაიდერის შეცდომა',
  invalid_response: 'არასწორი პასუხი — უარყოფილია', wrong_city: 'პასუხი სხვა ქალაქს ან ვალუტას ეკუთვნის — უარყოფილია',
};
export const MARKET_RETRYABLE = new Set(['network_error', 'timeout', 'stale', 'upstream_error', 'rate_limited', 'invalid_response']);

export const MARKET_WARNINGS = {
  nearby_city: 'ახლომდებარე ქალაქის მონაცემი — ზუსტი დამთხვევა არ არის.',
  country_level_only: 'მხოლოდ ქვეყნის დონის მონაცემი; ქალაქის ცენტრის ქირად არ ჩანს.',
  low_data_points: 'მონაცემთა წერტილების მცირე რაოდენობა.',
  range_is_not_confidence_interval: 'დიაპაზონი პროვაიდერისაა და ნდობის ინტერვალი არ არის.',
  quality_not_guaranteed: 'ბინის ხარისხი, ფართობი, ავეჯი და უბანი განსხვავდება; სტატისტიკური საშუალო ხარისხს არ უზრუნველყოფს.',
  index_is_not_money: 'ინდექსი ფულადი თანხა არ არის და ბრძანების K-ს არ ცვლის.',
  source_date_unknown: 'წყაროში მონაცემის განახლების თარიღი უცნობია.',
  stale_cache_used: 'გამოყენებულია ვადაგასული შენახული ასლი.',
  partial_data: 'მონაცემი ნაწილობრივია.',
  manual_entry: 'მონაცემი ხელითაა შეყვანილი — ავტომატურად მოპოვებული არ არის.',
  snapshot_not_live: 'დათარიღებული ასლი — არა მიმდინარე ფასი.',
  mixed_sources: 'მაჩვენებლები სხვადასხვა წყაროდანაა.',
  license_unconfirmed: 'მონაცემის გამოყენების ლიცენზია დაუდასტურებელია.',
  synthetic_test_data: 'სატესტო (სინთეზური) მონაცემი — რეალური ფასი არ არის.',
  item_mapping_unverified: 'მაჩვენებლის იდენტიფიკაცია დაუდასტურებელია.',
};

export const MATCH_KA = {
  exact: 'ზუსტი დამთხვევა', 'nearby-explained': 'ახლომდებარე ქალაქი (ახსნით)', 'country-level': 'ქვეყნის დონე', none: 'დამთხვევა არ არის',
};

/** enum → [{value,label}]: ბირთვის ენუმი (ობიექტი ან მასივი) ან სარეზერვო ცხრილი. */
export function enumOptions(coreEnum, fallback) {
  if (Array.isArray(coreEnum) && coreEnum.length) {
    return coreEnum.map((e) => (typeof e === 'string' ? { value: e, label: fallback[e] || e } : { value: e.id ?? e.value, label: e.label_ka ?? e.name_ka ?? fallback[e.id ?? e.value] ?? String(e.id ?? e.value) }));
  }
  const src = coreEnum && typeof coreEnum === 'object' && Object.keys(coreEnum).length ? coreEnum : fallback;
  return Object.entries(src).map(([value, v]) => ({ value, label: typeof v === 'string' ? v : (v?.label_ka ?? v?.name_ka ?? fallback[value] ?? value) }));
}
