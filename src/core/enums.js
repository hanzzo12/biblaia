// Enumerations with Georgian display names (contracts §3 helpers).
const freeze = (o) => Object.freeze(o);

export const ROLES = freeze({ spouse: 'მეუღლე', child: 'შვილი', stepchild: 'გერი', other: 'ოჯახის სხვა წევრი' });

export const MEMBER_STATUSES = freeze({
  regular: 'ჩვეულებრივი',
  'support-recipient': 'მხარდაჭერის მიმღები',
  guardianship: 'მეურვეობის ქვეშ მყოფი',
  care: 'მზრუნველობის ქვეშ მყოფი',
});
/** Statuses with presence-limited rights (Annex 1 art.4 second "6"; pts 7, 12(c), 30(b)). */
export const DEPENDENT_STATUSES = freeze(['support-recipient', 'guardianship', 'care']);

export const EXTRA_CATEGORIES = freeze({
  visa: 'ვიზა (პ.7¹)',
  vaccination: 'სავალდებულო ვაქცინაცია (პ.6)',
  'testing-quarantine': 'ტესტირება / იზოლაცია-კარანტინი (პ.6¹)',
  'toll-parking': 'ფასიანი გზა / პარკინგი (პ.21)',
  'early-termination-28': 'ხელშეკრულებების შეწყვეტის ხარჯი ადრეული გამოწვევისას (პ.28)',
  'covid-aid-6-2': 'ერთჯერადი დახმარება COVID-ის მკურნალობაზე (პ.6², მინისტრის გადაწყვეტილებით)',
  'head-residence-29': 'ხელმძღვანელის ბინის დაქირავება/შენახვა (პ.29, მინისტრის გადაწყვეტილებით)',
  other: 'სხვა ხარჯი (მინისტრის გადაწყვეტილებით)',
});
export const EXTRA_RULES = freeze({
  visa: ['R-VISA-071'], vaccination: ['R-VACC-006'], 'testing-quarantine': ['R-QUAR-061'],
  'toll-parking': ['R-TOLL-021'], 'early-termination-28': ['R-RECALL-028'], 'covid-aid-6-2': ['R-COVID-062'],
  'head-residence-29': ['R-HEADRES-029'], other: [],
});

export const TRAVEL_KINDS = freeze({
  departure: 'გამგზავრება მივლინებაში (პ.4ა)',
  recall: 'გამოწვევა (პ.4ა)',
  'recall-5-1': 'გამოძახება მინისტრის აქტით (პ.5¹)',
  vacation: 'შვებულების მგზავრობა (პ.12ბ–გ)',
  'bereavement-17': 'ოჯახის წევრის გარდაცვალება (პ.17)',
});
export const TRAVEL_ROUTES = freeze({ georgia: 'საქართველოს მიმართულებით', 'third-country': 'სხვა (მესამე) ქვეყანაში', other: 'სხვა' });

export const BAGGAGE_KINDS = freeze({
  departure: 'გამგზავრება (პ.4ბ)',
  recall: 'გამოწვევა (პ.4ბ)',
  'recall-5-1': 'გამოძახება მინისტრის აქტით (პ.5¹)',
});

export const SETTLEMENT_EXCLUSIONS = freeze({
  a: 'პ.9ა — ვადამდე გადაყვანა იმავე ქალაქის სხვა დაწესებულებაში',
  b: 'პ.9ბ — ვადის გასვლიდან ერთ თვეში წარგზავნა იმავე ქალაქში',
  c: 'პ.9გ — შრომითი ხელშეკრულებით დასაქმებული იმავე ქალაქში',
  d: 'პ.9დ — ადგილსამყოფელი ქვეყნის რეზიდენტი / საცხოვრებელი იმავე ქალაქში',
  e: 'პ.9ე — ოჯახის წევრი უკვე მივლინებულია იმავე ქალაქში',
  f: 'პ.9ვ — ოჯახის ორი წევრი ერთდროულად იმავე ქალაქში (მხოლოდ ერთ-ერთზე)',
});

export const ADVANCE_KINDS = freeze({
  rent: 'ბინის ქირის ავანსი (პ.22)',
  'current-month': 'მიმდინარე თვის თანხა (პ.27ა)',
  vacation: 'შვებულება — მიმდინარე და მომდევნო თვე (პ.27ბ)',
  other: 'კანონმდებლობით გათვალისწინებული სხვა (პ.27დ)',
});

export const RENT_HEAD = freeze({ head: 'დაწესებულების ხელმძღვანელი', 'not-head': 'სხვა მოსამსახურე' });
export const RENT_BASIS = freeze({ actual: 'ფაქტობრივი ქირა', planned: 'დაგეგმილი ქირა', 'market-scenario': 'ბაზრის ფასი (სცენარი)' });

export const COMPONENT_STATUSES = freeze({
  calculated: 'გამოთვლილი',
  scenario: 'სცენარი',
  unconfirmed: 'დაუდასტურებელი',
  undetermined: 'დაუდგენელი',
  not_applicable: 'არ ვრცელდება',
});
export const COMPLETENESS = freeze({ complete: 'სრული', partial: 'ნაწილობრივი', incomplete: 'არასრული' });
export const CATEGORIES = freeze({
  monthly: 'ყოველთვიური', reimbursement: 'ანაზღაურება', remainder: 'ნაშთი', 'one-time-allowance': 'ერთჯერადი დახმარება',
  'one-time-reimbursement': 'ერთჯერადი ანაზღაურება', 'annual-cap': 'წლიური ზღვარი', advance: 'ავანსი',
  liability: 'დასაბრუნებელი თანხა', parameter: 'პარამეტრი',
});
