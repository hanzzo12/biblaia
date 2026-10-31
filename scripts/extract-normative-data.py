#!/usr/bin/env python3
"""Build src/data/normative-data.json from the raw annex extracts.

Input : sources/extracted/annex02.raw.json ... annex10.raw.json
        (produced by scripts/extract-annexes.py)
Output: src/data/normative-data.json  (schema: docs/data-schema.md)

Every normalisation is listed in `normalizations`. Institutions are linked to
their Annex 7/8 (insurance) and Annex 9/10 (baggage) rows by matching the
institution name in each annex (MATCH keys below) - never by array position.
The script fails if a key does not match exactly one non-removed row.

Usage: python3 -I scripts/extract-normative-data.py   (from the repository root)
"""
import hashlib
import json
import os
import re
import sys
from decimal import Decimal

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "sources", "extracted")
PDF_REL = "sources/original/rotation_sources.pdf"
D211_REL = "sources/original/decree211-matsne-3649787-28.pdf"
D211_RAW = os.path.join(ROOT, "sources", "extracted", "decree211-annex1.raw.json")
# Decree №211 Annex 1, column 2 (currency name as printed) → ISO 4217
CURRENCY_ISO = {
    "ევრო": "EUR", "აშშ დოლარი": "USD", "ავსტრალიური დოლარი": "AUD", "დანიური კრონა": "DKK",
    "იაპონური იენა": "JPY", "ინგლისური გირვანქა სტერლინგი": "GBP", "მალაიზიური რინგიტი": "MYR",
    "ნორვეგიული კრონა": "NOK", "სინგაპურული დოლარი": "SGD", "ქუვეითური დინარი": "KWD",
    "შვედური კრონა": "SEK", "შვეიცარული ფრანკი": "CHF",
}
OUT = os.path.join(ROOT, "src", "data", "normative-data.json")
BANDS = ["0-18", "19-24", "25-29", "30-34", "35-39", "40-44", "45-49",
         "50-54", "55-59", "60-64", "65-69", "70+"]


def load(n):
    with open(os.path.join(RAW, "annex%02d.raw.json" % n), encoding="utf-8") as f:
        return json.load(f)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


# --------------------------------------------------------------------------
# Countries (ISO 3166-1 alpha-2). officialName_ka = wording of Annex 4 where the
# country has a country-wide row; otherwise the usual official Georgian name.
COUNTRIES = [
    ("AT", "ავსტრია", "Austria", "ავსტრიის რესპუბლიკა"),
    ("AU", "ავსტრალია", "Australia", "ავსტრალიის თანამეგობრობა"),
    ("AR", "არგენტინა", "Argentina", "არგენტინის რესპუბლიკა"),
    ("AZ", "აზერბაიჯანი", "Azerbaijan", "აზერბაიჯანის რესპუბლიკა"),
    ("US", "აშშ", "United States", "ამერიკის შეერთებული შტატები"),
    ("BY", "ბელარუსი", "Belarus", "ბელარუსის რესპუბლიკა"),
    ("BE", "ბელგია", "Belgium", "ბელგიის სამეფო"),
    ("BR", "ბრაზილია", "Brazil", "ბრაზილიის ფედერაციული რესპუბლიკა"),
    ("BG", "ბულგარეთი", "Bulgaria", "ბულგარეთის რესპუბლიკა"),
    ("DE", "გერმანია", "Germany", "გერმანიის ფედერაციული რესპუბლიკა"),
    ("DK", "დანია", "Denmark", "დანიის სამეფო"),
    ("GB", "დიდი ბრიტანეთი", "United Kingdom", "დიდი ბრიტანეთისა და ჩრდილოეთ ირლანდიის გაერთიანებული სამეფო"),
    ("EG", "ეგვიპტე", "Egypt", "ეგვიპტის არაბთა რესპუბლიკა"),
    ("ET", "ეთიოპია", "Ethiopia", "ეთიოპიის ფედერაციული დემოკრატიული რესპუბლიკა"),
    ("ES", "ესპანეთი", "Spain", "ესპანეთის სამეფო"),
    ("EE", "ესტონეთი", "Estonia", "ესტონეთის რესპუბლიკა"),
    ("TR", "თურქეთი", "Türkiye", "თურქეთის რესპუბლიკა"),
    ("TM", "თურქმენეთი", "Turkmenistan", "თურქმენეთი"),
    ("JP", "იაპონია", "Japan", "იაპონია"),
    ("JO", "იორდანია", "Jordan", "იორდანიის ჰაშიმიტური სამეფო"),
    ("IR", "ირანი", "Iran", "ირანის ისლამური რესპუბლიკა"),
    ("IL", "ისრაელი", "Israel", "ისრაელის სახელმწიფო"),
    ("IT", "იტალია", "Italy", "იტალიის რესპუბლიკა"),
    ("IN", "ინდოეთი", "India", "ინდოეთის რესპუბლიკა"),
    ("ID", "ინდონეზია", "Indonesia", "ინდონეზიის რესპუბლიკა"),
    ("IE", "ირლანდია", "Ireland", "ირლანდია"),
    ("CY", "კვიპროსი", "Cyprus", "კვიპროსის რესპუბლიკა"),
    ("CA", "კანადა", "Canada", "კანადა"),
    ("QA", "კატარი", "Qatar", "კატარის სახელმწიფო"),
    ("KR", "კორეა", "Republic of Korea", "კორეის რესპუბლიკა"),
    ("LV", "ლატვია", "Latvia", "ლატვიის რესპუბლიკა"),
    ("LT", "ლიეტუვა", "Lithuania", "ლიეტუვას რესპუბლიკა"),
    ("MY", "მალაიზია", "Malaysia", "მალაიზია"),
    ("MX", "მექსიკა", "Mexico", "მექსიკის შეერთებული შტატები"),
    ("MD", "მოლდოვა", "Moldova", "მოლდოვას რესპუბლიკა"),
    ("NL", "ნიდერლანდები", "Netherlands", "ნიდერლანდების სამეფო"),
    ("NO", "ნორვეგია", "Norway", "ნორვეგიის სამეფო"),
    ("PL", "პოლონეთი", "Poland", "პოლონეთის რესპუბლიკა"),
    ("PT", "პორტუგალია", "Portugal", "პორტუგალიის რესპუბლიკა"),
    ("RU", "რუსეთი", "Russian Federation", "რუსეთის ფედერაცია"),
    ("RO", "რუმინეთი", "Romania", "რუმინეთი"),
    ("GR", "საბერძნეთი", "Greece", "საბერძნეთის რესპუბლიკა"),
    ("ZA", "სამხრეთ აფრიკა", "South Africa", "სამხრეთ აფრიკის რესპუბლიკა"),
    ("SA", "საუდის არაბეთი", "Saudi Arabia", "საუდის არაბეთის სამეფო"),
    ("FR", "საფრანგეთი", "France", "საფრანგეთის რესპუბლიკა"),
    ("SK", "სლოვაკეთი", "Slovakia", "სლოვაკეთის რესპუბლიკა"),
    ("SI", "სლოვენია", "Slovenia", "სლოვენიის რესპუბლიკა"),
    ("AM", "სომხეთი", "Armenia", "სომხეთის რესპუბლიკა"),
    ("UZ", "უზბეკეთი", "Uzbekistan", "უზბეკეთის რესპუბლიკა"),
    ("UA", "უკრაინა", "Ukraine", "უკრაინა"),
    ("HU", "უნგრეთი", "Hungary", "უნგრეთი"),
    ("FI", "ფინეთი", "Finland", "ფინეთის რესპუბლიკა"),
    ("KW", "ქუვეითი", "Kuwait", "ქუვეითის სახელმწიფო"),
    ("KZ", "ყაზახეთი", "Kazakhstan", "ყაზახეთის რესპუბლიკა"),
    ("SE", "შვედეთი", "Sweden", "შვედეთის სამეფო"),
    ("CH", "შვეიცარია", "Switzerland", "შვეიცარიის კონფედერაცია"),
    ("CZ", "ჩეხეთი", "Czechia", "ჩეხეთის რესპუბლიკა"),
    ("CN", "ჩინეთი", "China", "ჩინეთის სახალხო რესპუბლიკა"),
    ("CU", "კუბა", "Cuba", "კუბის რესპუბლიკა"),
    ("RS", "სერბეთი", "Serbia", "სერბეთის რესპუბლიკა"),
    ("AE", "არაბთა გაერთიანებული საამიროები", "United Arab Emirates", "არაბთა გაერთიანებული საამიროები"),
    ("VN", "ვიეტნამი", "Viet Nam", "ვიეტნამის სოციალისტური რესპუბლიკა"),
    ("HR", "ხორვატია", "Croatia", "ხორვატიის რესპუბლიკა"),
    ("VA", "წმინდა საყდარი (ვატიკანი)", "Holy See (Vatican City State)", "წმინდა საყდარი"),
]

# Locations: real cities only. (id, countryId, name_ka, name_en, altNames, region, extra)
LOCATIONS = [
    ("AT-VIENNA", "AT", "ვენა", "Vienna", ["Wien"], None),
    ("BE-BRUSSELS", "BE", "ბრიუსელი", "Brussels", ["Bruxelles", "Brussel"], None),
    ("BG-SOFIA", "BG", "სოფია", "Sofia", [], None),
    ("DE-BERLIN", "DE", "ბერლინი", "Berlin", [], None),
    ("DE-FRANKFURT", "DE", "მაინის ფრანკფურტი", "Frankfurt am Main", ["Frankfurt"], "Hessen"),
    ("DE-STUTTGART", "DE", "შტუტგარტი", "Stuttgart", [], "Baden-Württemberg"),
    ("DK-COPENHAGEN", "DK", "კოპენჰაგენი", "Copenhagen", ["København"], None),
    ("GB-LONDON", "GB", "ლონდონი", "London", [], None),
    ("FR-PARIS", "FR", "პარიზი", "Paris", [], None),
    ("FR-STRASBOURG", "FR", "სტრასბურგი", "Strasbourg", [], None),
    ("FR-LYON", "FR", "ლიონი", "Lyon", ["Lyons"], None),
    ("ES-MADRID", "ES", "მადრიდი", "Madrid", [], None),
    ("ES-BARCELONA", "ES", "ბარსელონა", "Barcelona", [], None),
    ("EE-TALLINN", "EE", "ტალინი", "Tallinn", [], None),
    ("TR-ANKARA", "TR", "ანკარა", "Ankara", [], None),
    ("TR-ISTANBUL", "TR", "სტამბოლი", "Istanbul", ["სტამბული", "İstanbul"], None),
    ("TR-TRABZON", "TR", "ტრაპიზონი", "Trabzon", ["Trebizond"], None),
    ("IE-DUBLIN", "IE", "დუბლინი", "Dublin", [], None),
    ("IT-ROME", "IT", "რომი", "Rome", ["Roma"], None),
    ("IT-MILAN", "IT", "მილანი", "Milan", ["Milano"], None),
    ("IT-BARI", "IT", "ბარი", "Bari", [], None),
    ("VA-VATICAN-CITY", "VA", "ვატიკანი", "Vatican City", ["Città del Vaticano", "Holy See"], None),
    ("CY-NICOSIA", "CY", "ნიქოზია", "Nicosia", ["Lefkosia"], None),
    ("LV-RIGA", "LV", "რიგა", "Riga", [], None),
    ("LT-VILNIUS", "LT", "ვილნიუსი", "Vilnius", [], None),
    ("MD-CHISINAU", "MD", "კიშინიოვი", "Chișinău", ["Chisinau", "Kishinev"], None),
    ("NL-THE-HAGUE", "NL", "ჰააგა", "The Hague", ["Den Haag", "'s-Gravenhage"], None),
    ("NO-OSLO", "NO", "ოსლო", "Oslo", [], None),
    ("PL-WARSAW", "PL", "ვარშავა", "Warsaw", ["Warszawa"], None),
    ("PL-KRAKOW", "PL", "კრაკოვი", "Kraków", ["Krakow", "Cracow"], None),
    ("PT-LISBON", "PT", "ლისაბონი", "Lisbon", ["Lisboa"], None),
    ("RO-BUCHAREST", "RO", "ბუქარესტი", "Bucharest", ["București"], None),
    ("GR-ATHENS", "GR", "ათენი", "Athens", [], None),
    ("GR-THESSALONIKI", "GR", "სალონიკი", "Thessaloniki", ["თესალონიკი", "Salonica"], None),
    ("SK-BRATISLAVA", "SK", "ბრატისლავა", "Bratislava", [], None),
    ("SI-LJUBLJANA", "SI", "ლიუბლიანა", "Ljubljana", [], None),
    ("HU-BUDAPEST", "HU", "ბუდაპეშტი", "Budapest", [], None),
    ("SE-STOCKHOLM", "SE", "სტოკჰოლმი", "Stockholm", [], None),
    ("CH-BERN", "CH", "ბერნი", "Bern", ["Berne"], None),
    ("CH-GENEVA", "CH", "ჟენევა", "Geneva", ["Genève", "Genf"], None),
    ("CZ-PRAGUE", "CZ", "პრაღა", "Prague", ["Praha"], None),
    ("FI-HELSINKI", "FI", "ჰელსინკი", "Helsinki", [], None),
    ("HR-ZAGREB", "HR", "ზაგრები", "Zagreb", [], None),
    ("RS-BELGRADE", "RS", "ბელგრადი", "Belgrade", ["Beograd"], None),
    ("AU-CANBERRA", "AU", "კანბერა", "Canberra", [], None),
    ("AR-BUENOS-AIRES", "AR", "ბუენოს-აირესი", "Buenos Aires", [], None),
    ("AZ-BAKU", "AZ", "ბაქო", "Baku", [], None),
    ("AZ-GANJA", "AZ", "განჯა", "Ganja", ["Gəncə"], None),
    ("US-WASHINGTON", "US", "ვაშინგტონი", "Washington", ["Washington, D.C."], "District of Columbia"),
    ("US-NEW-YORK", "US", "ნიუ-იორკი", "New York", ["New York City", "NYC"], "New York"),
    ("US-SAN-FRANCISCO", "US", "სან-ფრანცისკო", "San Francisco", [], "California"),
    ("BY-MINSK", "BY", "მინსკი", "Minsk", [], None),
    ("BR-BRASILIA", "BR", "ბრაზილია", "Brasília", ["Brasilia"], None),
    ("EG-CAIRO", "EG", "კაირო", "Cairo", [], None),
    ("TM-ASHGABAT", "TM", "აშხაბადი", "Ashgabat", [], None),
    ("JP-TOKYO", "JP", "ტოკიო", "Tokyo", [], None),
    ("JO-AMMAN", "JO", "ამანი", "Amman", [], None),
    ("IL-TEL-AVIV", "IL", "თელ-ავივი", "Tel Aviv", ["Tel Aviv-Yafo"], None),
    ("IN-NEW-DELHI", "IN", "ნიუ-დელი", "New Delhi", ["Delhi"], None),
    ("ID-JAKARTA", "ID", "ჯაკარტა", "Jakarta", [], None),
    ("IR-TEHRAN", "IR", "თეირანი", "Tehran", [], None),
    ("QA-DOHA", "QA", "დოჰა", "Doha", [], None),
    ("CA-OTTAWA", "CA", "ოტავა", "Ottawa", [], "Ontario"),
    ("KR-SEOUL", "KR", "სეული", "Seoul", [], None),
    ("MY-KUALA-LUMPUR", "MY", "კუალა-ლუმპური", "Kuala Lumpur", [], None),
    ("MX-MEXICO-CITY", "MX", "მეხიკო", "Mexico City", ["Ciudad de México"], None),
    ("RU-MOSCOW", "RU", "მოსკოვი", "Moscow", [], None),
    ("ZA-PRETORIA", "ZA", "პრეტორია", "Pretoria", ["Tshwane"], None),
    ("AM-YEREVAN", "AM", "ერევანი", "Yerevan", [], None),
    ("SA-RIYADH", "SA", "ერ-რიადი", "Riyadh", ["რიადი"], None),
    ("UZ-TASHKENT", "UZ", "ტაშკენტი", "Tashkent", [], None),
    ("UA-KYIV", "UA", "კიევი", "Kyiv", ["Kiev", "Київ"], None),
    ("UA-ODESA", "UA", "ოდესა", "Odesa", ["Odessa"], None),
    ("UA-DONETSK", "UA", "დონეცკი", "Donetsk", [], None),
    ("KW-KUWAIT-CITY", "KW", "ელ-ქუვეითი", "Kuwait City", [], None),
    ("KZ-ASTANA", "KZ", "ასტანა", "Astana", [], None),
    ("CN-BEIJING", "CN", "პეკინი", "Beijing", [], None),
    ("CU-HAVANA", "CU", "ჰავანა", "Havana", ["La Habana"], None),
    ("ET-ADDIS-ABABA", "ET", "ადის-აბება", "Addis Ababa", [], None),
    ("AE-ABU-DHABI", "AE", "აბუ-დაბი", "Abu Dhabi", [], None),
    ("VN-HANOI", "VN", "ჰანოი", "Hanoi", [], None),
]
LOCATION_EXTRA = {
    "VA-VATICAN-CITY": dict(
        marketFallbackLocationId="IT-ROME",
        marketFallbackNote="ვატიკანისთვის ბაზრის მონაცემი შეიძლება არ არსებობდეს. რომის მონაცემი გამოჩნდეს მხოლოდ მკაფიო ახსნით, როგორც ახლომდებარე ქალაქის შეფასება; „ზუსტი დამთხვევის“ სტატუსი არ ენიჭება.",
    ),
}

# Annex 4 city-specific rows -> location ids; other rows are country-wide.
K_CITY_ROWS = {5: ["US-WASHINGTON"], 6: ["US-NEW-YORK"], 64: ["US-SAN-FRANCISCO"], 65: ["IT-BARI"],
               67: ["IT-MILAN"], 68: ["FR-LYON"], 69: ["PL-KRAKOW"], 61: ["RS-BELGRADE"]}
# Annex 4 row -> country
K_COUNTRY = {1: "AU", 2: "AT", 3: "AR", 4: "AZ", 5: "US", 6: "US", 7: "BY", 8: "BE", 9: "BR", 10: "BG",
             11: "DE", 12: "DK", 13: "GB", 14: "EG", 15: "ET", 16: "ES", 17: "EE", 18: "TR", 19: "TM",
             20: "JP", 21: "JO", 22: "IR", 23: "IL", 24: "IT", 25: "IN", 26: "ID", 27: "IE", 28: "CY",
             29: "CA", 30: "QA", 31: "KR", 32: "LV", 33: "LT", 34: "MY", 35: "MX", 36: "MD", 37: "NL",
             38: "NO", 39: "PL", 40: "PT", 41: "RU", 42: "RO", 43: "GR", 44: "ZA", 45: "SA", 46: "FR",
             47: "SK", 48: "SI", 49: "AM", 50: "UZ", 51: "UA", 52: "HU", 53: "FI", 54: "KW", 55: "KZ",
             56: "SE", 57: "CH", 58: "CZ", 59: "CN", 60: "CU", 61: "RS", 62: "AE", 63: "VN", 64: "US",
             65: "IT", 66: "HR", 67: "IT", 68: "FR", 69: "PL"}

# --------------------------------------------------------------------------
# Institutions. key = regex that must match exactly one (non-removed) row of the
# institution's annexes (5/7/9 for EUR, 6/8/10 for USD).
# fields: (annex, rowNo, key, type, countryId, locationId, locationBasis, kRow, kBasis, name_ka, name_en, notes)
E, U = 5, 6
MISSIONS = [
    (E, 1, r"ავსტრიის", "embassy", "AT", "AT-VIENNA", "source-explicit", 2, "country-row",
     "საქართველოს საელჩო ავსტრიის რესპუბლიკაში და მუდმივი წარმომადგენლობა ეუთოსა და ვენის საერთაშორისო ორგანიზაციებთან",
     "Embassy of Georgia to Austria and Permanent Mission to the OSCE and international organisations in Vienna",
     "Annex 5 names one combined institution (embassy + permanent mission)."),
    (E, 2, r"ბელგიის", "embassy", "BE", "BE-BRUSSELS", "inferred-capital", 8, "country-row",
     "საქართველოს საელჩო ბელგიის სამეფოში და წარმომადგენლობა ევროკავშირში",
     "Embassy of Georgia to Belgium and Mission to the European Union",
     "Combined institution (embassy + EU mission) per Annex 5 row 2. NATO mission is a separate institution (Annex 5 row 20)."),
    (E, 3, r"ბულგარეთის", "embassy", "BG", "BG-SOFIA", "inferred-capital", 10, "country-row",
     "საქართველოს საელჩო ბულგარეთის რესპუბლიკაში", "Embassy of Georgia to Bulgaria", None),
    (E, 4, r"გერმანიის", "embassy", "DE", "DE-BERLIN", "inferred-capital", 11, "country-row",
     "საქართველოს საელჩო გერმანიის ფედერაციულ რესპუბლიკაში", "Embassy of Georgia to Germany", None),
    (E, 5, r"დანიის", "embassy", "DK", "DK-COPENHAGEN", "inferred-capital", 12, "country-row",
     "საქართველოს საელჩო დანიის სამეფოში", "Embassy of Georgia to Denmark", None),
    (E, 6, r"ბრიტანეთ", "embassy", "GB", "GB-LONDON", "inferred-capital", 13, "country-row",
     "საქართველოს საელჩო დიდ ბრიტანეთსა და ჩრდილოეთ ირლანდიის გაერთიანებულ სამეფოში და მუდმივი წარმომადგენლობა საერთაშორისო საზღვაო ორგანიზაციაში",
     "Embassy of Georgia to the United Kingdom and Permanent Mission to the IMO", None),
    (E, 7, r"ევროპის საბჭოს", "permanent-mission", "FR", "FR-STRASBOURG", "inferred-seat", 46, "country-row",
     "საქართველოს მუდმივი წარმომადგენლობა ევროპის საბჭოსთან", "Permanent Mission of Georgia to the Council of Europe",
     "Seat of the Council of Europe is Strasbourg (not Paris). Annex 4 has no Strasbourg row; France country-wide row 46 used (Lyon has its own row 68)."),
    (E, 8, r"ესპანეთის", "embassy", "ES", "ES-MADRID", "source-explicit", 16, "country-row",
     "საქართველოს საელჩო ესპანეთის სამეფოში და მუდმივი წარმომადგენლობა გაეროს მსოფლიო ტურიზმის ორგანიზაციაში (UNWTO)",
     "Embassy of Georgia to Spain and Permanent Mission to UN Tourism (UNWTO), Madrid", None),
    (E, 9, r"ბარსელონა", "consulate-general", "ES", "ES-BARCELONA", "source-explicit", 16, "country-row",
     "საქართველოს გენერალური საკონსულო ქ. ბარსელონაში", "Consulate General of Georgia in Barcelona", None),
    (E, 10, r"ესტონეთის", "embassy", "EE", "EE-TALLINN", "inferred-capital", 17, "country-row",
     "საქართველოს საელჩო ესტონეთის რესპუბლიკაში", "Embassy of Georgia to Estonia", None),
    (E, 11, r"თურქეთის", "embassy", "TR", "TR-ANKARA", "inferred-capital", 18, "country-row",
     "საქართველოს საელჩო თურქეთის რესპუბლიკაში", "Embassy of Georgia to Türkiye", None),
    (E, 12, r"სტამბ[უო]ლ", "consulate-general", "TR", "TR-ISTANBUL", "source-explicit", 18, "country-row",
     "საქართველოს გენერალური საკონსულო ქ. სტამბოლში", "Consulate General of Georgia in Istanbul",
     "Annex 5 spells 'სტამბულში', Annexes 7 and 9 'სტამბოლში'."),
    (E, 13, r"ტრაპიზონ", "consulate-general", "TR", "TR-TRABZON", "source-explicit", 18, "country-row",
     "საქართველოს გენერალური საკონსულო ქ. ტრაპიზონში", "Consulate General of Georgia in Trabzon", None),
    (E, 14, r"საელჩო\s+ირლანდიაში", "embassy", "IE", "IE-DUBLIN", "inferred-capital", 27, "country-row",
     "საქართველოს საელჩო ირლანდიაში", "Embassy of Georgia to Ireland", None),
    (E, 15, r"იტალიის", "embassy", "IT", "IT-ROME", "source-explicit", 24, "country-row",
     "საქართველოს საელჩო იტალიის რესპუბლიკაში და მუდმივი წარმომადგენლობა რომში განლაგებულ გაეროს ორგანიზაციებში (FAO, IFAD, WFP)",
     "Embassy of Georgia to Italy and Permanent Mission to the UN agencies in Rome (FAO, IFAD, WFP)",
     "Source prints '(FAO,IFAD,WEP)'; 'WEP' is reproduced in rawLabel unchanged."),
    (E, 16, r"კვიპროსის", "embassy", "CY", "CY-NICOSIA", "inferred-capital", 28, "country-row",
     "საქართველოს საელჩო კვიპროსის რესპუბლიკაში", "Embassy of Georgia to Cyprus", None),
    (E, 17, r"ლატვიის", "embassy", "LV", "LV-RIGA", "inferred-capital", 32, "country-row",
     "საქართველოს საელჩო ლატვიის რესპუბლიკაში", "Embassy of Georgia to Latvia", None),
    (E, 18, r"ლიეტუვას", "embassy", "LT", "LT-VILNIUS", "inferred-capital", 33, "country-row",
     "საქართველოს საელჩო ლიეტუვას რესპუბლიკაში", "Embassy of Georgia to Lithuania", None),
    (E, 19, r"მოლდოვას", "embassy", "MD", "MD-CHISINAU", "inferred-capital", 36, "country-row",
     "საქართველოს საელჩო მოლდოვას რესპუბლიკაში", "Embassy of Georgia to Moldova", None),
    (E, 20, r"ნატო", "mission-to-org", "BE", "BE-BRUSSELS", "inferred-seat", 8, "country-row",
     "საქართველოს წარმომადგენლობა ნატოსთან", "Mission of Georgia to NATO",
     "Separate institution from the embassy in Belgium / EU mission (Annex 5 row 2), although city, K/E and tariffs coincide."),
    (E, 21, r"ნიდერლანდების", "embassy", "NL", "NL-THE-HAGUE", "inferred-seat", 37, "country-row",
     "საქართველოს საელჩო ნიდერლანდების სამეფოში", "Embassy of Georgia to the Netherlands", None),
    (E, 22, r"ნორვეგიის", "embassy", "NO", "NO-OSLO", "inferred-capital", 38, "country-row",
     "საქართველოს საელჩო ნორვეგიის სამეფოში", "Embassy of Georgia to Norway", None),
    (E, 23, r"პოლონეთის", "embassy", "PL", "PL-WARSAW", "inferred-capital", 39, "country-row",
     "საქართველოს საელჩო პოლონეთის რესპუბლიკაში", "Embassy of Georgia to Poland", None),
    (E, 24, r"პორტუგალიის", "embassy", "PT", "PT-LISBON", "inferred-capital", 40, "country-row",
     "საქართველოს საელჩო პორტუგალიის რესპუბლიკაში", "Embassy of Georgia to Portugal", None),
    (E, 25, r"რუმინეთ", "embassy", "RO", "RO-BUCHAREST", "inferred-capital", 42, "country-row",
     "საქართველოს საელჩო რუმინეთში", "Embassy of Georgia to Romania", None),
    (E, 26, r"საბერძნეთის", "embassy", "GR", "GR-ATHENS", "inferred-capital", 43, "country-row",
     "საქართველოს საელჩო საბერძნეთის რესპუბლიკაში", "Embassy of Georgia to Greece", None),
    (E, 27, r"საფრანგეთის", "embassy", "FR", "FR-PARIS", "inferred-capital", 46, "country-row",
     "საქართველოს საელჩო საფრანგეთის რესპუბლიკაში და მუდმივი წარმომადგენლობა იუნესკოში",
     "Embassy of Georgia to France and Permanent Delegation to UNESCO", None),
    (E, 28, r"სლოვაკეთის", "embassy", "SK", "SK-BRATISLAVA", "inferred-capital", 47, "country-row",
     "საქართველოს საელჩო სლოვაკეთის რესპუბლიკაში", "Embassy of Georgia to Slovakia", None),
    (E, 29, r"სლოვენიის", "embassy", "SI", "SI-LJUBLJANA", "inferred-capital", 48, "country-row",
     "საქართველოს საელჩო სლოვენიის რესპუბლიკაში", "Embassy of Georgia to Slovenia", None),
    (E, 30, r"უნგრეთ", "embassy", "HU", "HU-BUDAPEST", "inferred-capital", 52, "country-row",
     "საქართველოს საელჩო უნგრეთში", "Embassy of Georgia to Hungary", None),
    (E, 31, r"სალონიკ", "consulate-general", "GR", "GR-THESSALONIKI", "source-explicit", 43, "country-row",
     "საქართველოს გენერალური საკონსულო ქ. სალონიკში", "Consulate General of Georgia in Thessaloniki", None),
    (E, 32, r"ფრან[კქ]ფურტ", "consulate-general", "DE", "DE-FRANKFURT", "source-explicit", 11, "country-row",
     "საქართველოს გენერალური საკონსულო ქ. მაინის ფრანკფურტში", "Consulate General of Georgia in Frankfurt am Main",
     "Annex 7 spells 'ფრანქფურტში'."),
    (E, 33, r"შვედეთის", "embassy", "SE", "SE-STOCKHOLM", "inferred-capital", 56, "country-row",
     "საქართველოს საელჩო შვედეთის სამეფოში", "Embassy of Georgia to Sweden", None),
    (E, 34, r"შვეიცარიის", "embassy", "CH", "CH-BERN", "inferred-seat", 57, "country-row",
     "საქართველოს საელჩო შვეიცარიის კონფედერაციაში", "Embassy of Georgia to Switzerland", None),
    (E, 35, r"ჟენევა", "permanent-mission", "CH", "CH-GENEVA", "source-explicit", 57, "country-row",
     "საქართველოს მუდმივი წარმომადგენლობა ჟენევაში გაეროს განყოფილებებსა და სხვა საერთაშორისო ორგანიზაციებში",
     "Permanent Mission of Georgia to the UN Office and other international organisations in Geneva",
     "Separate institution from the embassy in Bern (Annex 5 row 34)."),
    (E, 36, r"ჩეხეთის", "embassy", "CZ", "CZ-PRAGUE", "inferred-capital", 58, "country-row",
     "საქართველოს საელჩო ჩეხეთის რესპუბლიკაში", "Embassy of Georgia to Czechia", None),
    (E, 37, r"ვატიკან", "embassy", "VA", "VA-VATICAN-CITY", "inferred-seat", None, "none",
     "საქართველოს საელჩო წმინდა საყდართან (ვატიკანში)", "Embassy of Georgia to the Holy See",
     "Annex 4 has no Holy See/Vatican row. Whether the Italy row 24 applies depends on the embassy's actual seat (Rome or Vatican City), which the supplied sources do not establish: K/E left undetermined (null)."),
    (E, 38, r"ფინეთის", "embassy", "FI", "FI-HELSINKI", "inferred-capital", 53, "country-row",
     "საქართველოს საელჩო ფინეთის რესპუბლიკაში", "Embassy of Georgia to Finland", None),
    (E, 39, r"ბარიში", "consulate-general", "IT", "IT-BARI", "source-explicit", 65, "city-row",
     "საქართველოს გენერალური საკონსულო ქ. ბარიში", "Consulate General of Georgia in Bari",
     "City-specific Annex 4 row 65 (E = 21) takes priority over the Italy country row 24 (E = 22)."),
    (E, 41, r"შტუტგარტ", "consulate-general", "DE", "DE-STUTTGART", "source-explicit", 11, "country-row",
     "საქართველოს გენერალური საკონსულო ქ. შტუტგარტში", "Consulate General of Georgia in Stuttgart", None),
    (E, 42, r"ხორვატიის", "embassy", "HR", "HR-ZAGREB", "inferred-capital", 66, "country-row",
     "საქართველოს საელჩო ხორვატიის რესპუბლიკაში", "Embassy of Georgia to Croatia", None),
    (E, 43, r"მილან", "consulate-general", "IT", "IT-MILAN", "source-explicit", 67, "city-row",
     "საქართველოს გენერალური საკონსულო ქ. მილანში", "Consulate General of Georgia in Milan", None),
    (E, 44, r"ლიონ", "consulate-general", "FR", "FR-LYON", "source-explicit", 68, "city-row",
     "საქართველოს გენერალური საკონსულო ქ. ლიონში", "Consulate General of Georgia in Lyon", None),
    (E, 45, r"კრაკოვ", "consulate-general", "PL", "PL-KRAKOW", "source-explicit", 69, "city-row",
     "საქართველოს გენერალური საკონსულო ქ. კრაკოვში", "Consulate General of Georgia in Kraków", None),
    # ---- USD (Annex 6) ----
    (U, 1, r"ავსტრალიის", "embassy", "AU", "AU-CANBERRA", "inferred-capital", 1, "country-row",
     "საქართველოს საელჩო ავსტრალიის თანამეგობრობაში", "Embassy of Georgia to Australia", None),
    (U, 2, r"არგენტინის", "embassy", "AR", "AR-BUENOS-AIRES", "inferred-capital", 3, "country-row",
     "საქართველოს საელჩო არგენტინის რესპუბლიკაში", "Embassy of Georgia to Argentina", None),
    (U, 3, r"აზერბაიჯანის", "embassy", "AZ", "AZ-BAKU", "inferred-capital", 4, "country-row",
     "საქართველოს საელჩო აზერბაიჯანის რესპუბლიკაში", "Embassy of Georgia to Azerbaijan", None),
    (U, 4, r"აშშ-ში", "embassy", "US", "US-WASHINGTON", "inferred-capital", 5, "city-row",
     "საქართველოს საელჩო აშშ-ში", "Embassy of Georgia to the United States",
     "Annex 4 has only city rows for the US (Washington 5, New York 6, San Francisco 64); the embassy is linked to Washington."),
    (U, 5, r"გაერთიანებული\s+ერების", "permanent-mission", "US", "US-NEW-YORK", "inferred-seat", 6, "city-row",
     "საქართველოს მუდმივი წარმომადგენლობა გაეროსთან", "Permanent Mission of Georgia to the United Nations",
     "Separate institution from the Consulate General in New York (Annex 6 row 28)."),
    (U, 6, r"ბელარუსის", "embassy", "BY", "BY-MINSK", "inferred-capital", 7, "country-row",
     "საქართველოს საელჩო ბელარუსის რესპუბლიკაში", "Embassy of Georgia to Belarus", None),
    (U, 7, r"ბრაზილიის", "embassy", "BR", "BR-BRASILIA", "inferred-capital", 9, "country-row",
     "საქართველოს საელჩო ბრაზილიის ფედერაციულ რესპუბლიკაში და წარმომადგენლობა კარიბის ქვეყნების გაერთიანებაში",
     "Embassy of Georgia to Brazil and Mission to CARICOM", None),
    (U, 8, r"ეგვიპტის", "embassy", "EG", "EG-CAIRO", "inferred-capital", 14, "country-row",
     "საქართველოს საელჩო ეგვიპტის არაბთა რესპუბლიკაში", "Embassy of Georgia to Egypt", None),
    (U, 9, r"თურქმენეთ", "embassy", "TM", "TM-ASHGABAT", "inferred-capital", 19, "country-row",
     "საქართველოს საელჩო თურქმენეთში", "Embassy of Georgia to Turkmenistan", None),
    (U, 10, r"იაპონია", "embassy", "JP", "JP-TOKYO", "inferred-capital", 20, "country-row",
     "საქართველოს საელჩო იაპონიაში", "Embassy of Georgia to Japan", None),
    (U, 11, r"იორდანი", "embassy", "JO", "JO-AMMAN", "inferred-capital", 21, "country-row",
     "საქართველოს საელჩო იორდანიის ჰაშიმიტურ სამეფოში", "Embassy of Georgia to Jordan", None),
    (U, 12, r"ისრაელ", "embassy", "IL", "IL-TEL-AVIV", "inferred-seat", 23, "country-row",
     "საქართველოს საელჩო ისრაელის სახელმწიფოში", "Embassy of Georgia to Israel", None),
    (U, 13, r"ინდოეთის", "embassy", "IN", "IN-NEW-DELHI", "inferred-capital", 25, "country-row",
     "საქართველოს საელჩო ინდოეთის რესპუბლიკაში და მუდმივი წარმომადგენლობა გაეროს აზიისა და წყნარი ოკეანის ეკონომიკურ და სოციალურ კომისიაში (ESCAP)",
     "Embassy of Georgia to India and Permanent Mission to UN ESCAP", None),
    (U, 14, r"ინდონეზიის", "embassy", "ID", "ID-JAKARTA", "inferred-capital", 26, "country-row",
     "საქართველოს საელჩო ინდონეზიის რესპუბლიკაში და წარმომადგენლობა ASEAN-ში",
     "Embassy of Georgia to Indonesia and Mission to ASEAN", None),
    (U, 15, r"ირანის", "embassy", "IR", "IR-TEHRAN", "inferred-capital", 22, "country-row",
     "საქართველოს საელჩო ირანის ისლამურ რესპუბლიკაში", "Embassy of Georgia to Iran", None),
    (U, 16, r"კატარის", "embassy", "QA", "QA-DOHA", "inferred-capital", 30, "country-row",
     "საქართველოს საელჩო კატარის სახელმწიფოში", "Embassy of Georgia to Qatar", None),
    (U, 17, r"კანადა", "embassy", "CA", "CA-OTTAWA", "inferred-capital", 29, "country-row",
     "საქართველოს საელჩო კანადაში და მუდმივი წარმომადგენლობა საერთაშორისო სამოქალაქო ავიაციის ორგანიზაციაში (ICAO)",
     "Embassy of Georgia to Canada and Permanent Mission to ICAO",
     "Combined institution; ICAO itself is in Montreal, the embassy in Ottawa (location = Ottawa, not verified)."),
    (U, 18, r"კორეის", "embassy", "KR", "KR-SEOUL", "inferred-capital", 31, "country-row",
     "საქართველოს საელჩო კორეის რესპუბლიკაში", "Embassy of Georgia to the Republic of Korea", None),
    (U, 19, r"მალაიზია", "embassy", "MY", "MY-KUALA-LUMPUR", "inferred-capital", 34, "country-row",
     "საქართველოს საელჩო მალაიზიაში", "Embassy of Georgia to Malaysia", None),
    (U, 20, r"მექსიკის", "embassy", "MX", "MX-MEXICO-CITY", "inferred-capital", 35, "country-row",
     "საქართველოს საელჩო მექსიკის შეერთებულ შტატებში", "Embassy of Georgia to Mexico", None),
    (U, 21, r"რუსეთის", "embassy-section", "RU", "RU-MOSCOW", "inferred-capital", 41, "country-row",
     "საქართველოს ინტერესების სექცია შვეიცარიის კონფედერაციის საელჩოში რუსეთის ფედერაციაში",
     "Section of Interests of Georgia at the Embassy of Switzerland in the Russian Federation", None),
    (U, 22, r"სამხრეთ\s+აფრიკის", "embassy", "ZA", "ZA-PRETORIA", "inferred-capital", 44, "country-row",
     "საქართველოს საელჩო სამხრეთ აფრიკის რესპუბლიკაში", "Embassy of Georgia to South Africa", None),
    (U, 23, r"სომხეთის", "embassy", "AM", "AM-YEREVAN", "inferred-capital", 49, "country-row",
     "საქართველოს საელჩო სომხეთის რესპუბლიკაში", "Embassy of Georgia to Armenia", None),
    (U, 24, r"საუდის", "embassy", "SA", "SA-RIYADH", "inferred-capital", 45, "country-row",
     "საქართველოს საელჩო საუდის არაბეთის სამეფოში და წარმომადგენლობა ისლამური თანამშრომლობის ორგანიზაციაში (OIC)",
     "Embassy of Georgia to Saudi Arabia and Mission to the OIC", None),
    (U, 25, r"უზბეკეთის", "embassy", "UZ", "UZ-TASHKENT", "inferred-capital", 50, "country-row",
     "საქართველოს საელჩო უზბეკეთის რესპუბლიკაში", "Embassy of Georgia to Uzbekistan", None),
    (U, 26, r"უკრაინაში", "embassy", "UA", "UA-KYIV", "inferred-capital", 51, "country-row",
     "საქართველოს საელჩო უკრაინაში და მუდმივი წარმომადგენლობა სუამში", "Embassy of Georgia to Ukraine and Permanent Mission to GUAM", None),
    (U, 27, r"ქუვეით", "embassy", "KW", "KW-KUWAIT-CITY", "inferred-capital", 54, "country-row",
     "საქართველოს საელჩო ქუვეითის სახელმწიფოში", "Embassy of Georgia to Kuwait", None),
    (U, 28, r"საკონსულო\s+ქ\.\s?ნიუ-", "consulate-general", "US", "US-NEW-YORK", "source-explicit", 6, "city-row",
     "საქართველოს გენერალური საკონსულო ქ. ნიუ-იორკში", "Consulate General of Georgia in New York",
     "Separate institution from the UN mission (Annex 6 row 5)."),
    (U, 29, r"ოდესა", "consulate-general", "UA", "UA-ODESA", "source-explicit", 51, "country-row",
     "საქართველოს გენერალური საკონსულო ქ. ოდესაში", "Consulate General of Georgia in Odesa", None),
    (U, 30, r"დონეცკ", "consulate-general", "UA", "UA-DONETSK", "source-explicit", 51, "country-row",
     "საქართველოს გენერალური საკონსულო ქ. დონეცკში", "Consulate General of Georgia in Donetsk",
     "Listed in the supplied annexes; current operational status not verified."),
    (U, 31, r"განჯა", "consulate-general", "AZ", "AZ-GANJA", "source-explicit", 4, "country-row",
     "საქართველოს გენერალური საკონსულო ქ. განჯაში", "Consulate General of Georgia in Ganja", None),
    (U, 32, r"ყაზახეთის", "embassy", "KZ", "KZ-ASTANA", "inferred-capital", 55, "country-row",
     "საქართველოს საელჩო ყაზახეთის რესპუბლიკაში", "Embassy of Georgia to Kazakhstan", None),
    (U, 33, r"ჩინეთის", "embassy", "CN", "CN-BEIJING", "inferred-capital", 59, "country-row",
     "საქართველოს საელჩო ჩინეთის სახალხო რესპუბლიკაში", "Embassy of Georgia to China", None),
    (U, 34, r"კუბის", "embassy", "CU", "CU-HAVANA", "inferred-capital", 60, "country-row",
     "საქართველოს საელჩო კუბის რესპუბლიკაში", "Embassy of Georgia to Cuba", None),
    (U, 35, r"ეთიოპიის", "embassy", "ET", "ET-ADDIS-ABABA", "inferred-capital", 15, "country-row",
     "საქართველოს საელჩო ეთიოპიის ფედერაციულ დემოკრატიულ რესპუბლიკაში", "Embassy of Georgia to Ethiopia", None),
    (U, 36, r"არაბთა\s+გაერთიანებულ", "embassy", "AE", "AE-ABU-DHABI", "inferred-capital", 62, "country-row",
     "საქართველოს საელჩო არაბთა გაერთიანებულ საამიროებში", "Embassy of Georgia to the United Arab Emirates", None),
    (U, 37, r"ვიეტნამის", "embassy", "VN", "VN-HANOI", "inferred-capital", 63, "country-row",
     "საქართველოს საელჩო ვიეტნამის სოციალისტურ რესპუბლიკაში", "Embassy of Georgia to Viet Nam", None),
    (U, 38, r"სან-ფრანცისკო", "consulate-general", "US", "US-SAN-FRANCISCO", "source-explicit", 64, "city-row",
     "საქართველოს გენერალური საკონსულო ქ. სან-ფრანცისკოში", "Consulate General of Georgia in San Francisco", None),
]

# Annex 2 / 3 positions (split of each row into individual position titles)
A2_POS = {
    1: ["საგანგებო და სრულუფლებიანი ელჩი", "საერთაშორისო ორგანიზაციასთან საქართველოს მუდმივი წარმომადგენელი", "საერთაშორისო ორგანიზაციასთან საქართველოს წარმომადგენელი"],
    2: ["გენერალური კონსული", "კონსული - საკონსულო დაწესებულების ხელმძღვანელი"],
    3: ["საგანგებო და სრულუფლებიანი დესპანი", "საერთაშორისო ორგანიზაციასთან საქართველოს მუდმივი წარმომადგენლის მოადგილე", "საერთაშორისო ორგანიზაციასთან საქართველოს წარმომადგენლის მოადგილე", "ადმინისტრაციული მენეჯერი, რომელიც დროებით/მუდმივად ასრულებს სხვა საქართველოს დიპლომატიურ წარმომადგენლობებსა და საკონსულო დაწესებულებებში ადმინისტრაციული მენეჯერის მოვალეობას"],
    4: ["უფროსი მრჩეველი", "კონსული"],
    5: ["მრჩეველი", "ადმინისტრაციული მენეჯერი", "ვიცე-კონსული"],
    6: ["პირველი მდივანი", "მეორე მდივანი"],
    7: ["მესამე მდივანი", "ატაშე", "უსაფრთხოების ოფიცერი"],
    8: ["რეფერენტი"],
    9: ["მძღოლი"],
}
A2_NOTES = {
    2: "'კონსული-საკონსულო დაწესებულების ხელმძღვანელი' = consul who heads a consular post (80%); a consul who is not head of post is row 4 (70%).",
    3: "Administrative manager performing the duties in another mission: Annex 2 row 3 applies during that period (Order pt 20², added by №01-317 of 2026-08-13). Source text has the typo 'საერთშორისო'.",
    5: "Ordinary administrative manager: 65%. See row 3 for the pt 20² case.",
}
A3_POS = {
    1: ["მინისტრის პირველი მოადგილე", "მინისტრის მოადგილე", "სამინისტროს დირექტორატის დირექტორი", "დეპარტამენტის უფროსი", "მინისტრის კაბინეტის უფროსი", "საგანგებო დავალებათა ელჩი"],
    2: ["დირექტორატის დირექტორის მოადგილე", "დეპარტამენტის უფროსის მოადგილე"],
    3: ["სამმართველოს უფროსი"], 4: ["მრჩეველი"], 5: ["პირველი მდივანი"], 6: ["მეორე მდივანი"],
    7: ["მესამე მდივანი", "ატაშე", "რეფერენტი", "უსაფრთხოების ოფიცერი"], 8: ["მძღოლი"],
}

SOURCE_REFS = [
    ("SRC-ORDER", "ბრძანება №01-82 (2018-04-05) — გრძელვადიანი მივლინების ანაზღაურების წესი", None, [2, 9],
     "№01-317 of 2026-08-13 (pts 20, 20², per working-copy annotations)"),
    ("SRC-ANNEX1", "დანართი №1 — ინსტრუქცია და გამოთვლის ფორმულები", 1, [10, 12], "№01-608 of 2023-12-15"),
    ("SRC-ANNEX2", "დანართი №2 — როტაციით მივლინებულთა თანამდებობრივი მაჩვენებლები", 2, [13, 13], "№01-317 of 2026-08-13"),
    ("SRC-ANNEX3", "დანართი №3 — ცენტრალური აპარატის თანამდებობრივი მაჩვენებლები", 3, [14, 14], "№01-770 of 2025-09-17"),
    ("SRC-ANNEX4", "დანართი №4 — ქვეყნის/ქალაქის სიძვირის ადაპტირებული კოეფიციენტი (K) და ბინის წილი (E)", 4, [15, 18], "№01-43 of 2026-02-09"),
    ("SRC-ANNEX5", "დანართი №5 — ევროში დასაფინანსებელი დაწესებულებები", 5, [19, 20], "№01-559 of 2024-10-30"),
    ("SRC-ANNEX6", "დანართი №6 — აშშ დოლარში დასაფინანსებელი დაწესებულებები", 6, [21, 22], "№01-265 of 2021-12-08"),
    ("SRC-ANNEX7", "დანართი №7 — სამედიცინო დაზღვევის წლიური ზღვრული ოდენობები (EUR)", 7, [23, 26], "№01-559 of 2024-10-30"),
    ("SRC-ANNEX8", "დანართი №8 — სამედიცინო დაზღვევის წლიური ზღვრული ოდენობები (USD)", 8, [27, 29], "№01-217 of 2024-05-29"),
    ("SRC-ANNEX9", "დანართი №9 — ბარგის ანაზღაურების ზღვრული ოდენობები (EUR)", 9, [30, 31], "№01-559 of 2024-10-30"),
    ("SRC-ANNEX10", "დანართი №10 — ბარგის ანაზღაურების ზღვრული ოდენობები (USD)", 10, [32, 34], "№01-374 of 2023-07-28"),
]

PARAMETERS = [
    # id, value, unit, sourceRef, point, citation, note
    ("FAMILY-SUPPLEMENT-PCT", "7", "percent-per-member", "SRC-ANNEX1", "art.3(b)", "დანართი №1, მუხლი 3 „ბ“: Q – ოჯახის თითოეულ წევრზე პროცენტული დანამატი (Q = 7)", None),
    ("RENT-SUBSIDY-HEAD-EXCESS-PCT", "80", "percent", "SRC-ANNEX1", "art.3(d)(c)(a)", "F = T + (G − T) × 80% — დიპლომატიური დაწესებულების ხელმძღვანელი", None),
    ("RENT-SUBSIDY-HEAD-CAP-PCT-OF-T", "200", "percent-of-T", "SRC-ANNEX1", "art.3(d)(c)(a)", "(G − T) × 80% ≤ 2 × T", None),
    ("RENT-SUBSIDY-OTHER-EXCESS-PCT", "50", "percent", "SRC-ANNEX1", "art.3(d)(c)(b)", "F = T + (G − T) × 50% — დანარჩენი მოსამსახურეები", None),
    ("RENT-SUBSIDY-OTHER-CAP-PCT-OF-T", "100", "percent-of-T", "SRC-ANNEX1", "art.3(d)(c)(b)", "(G − T) × 50% ≤ T", None),
    ("FX-FORECAST-GEL-PER-USD", "2.8", "GEL-per-USD", "SRC-ORDER", "2", "საპროგნოზო სავალუტო კურსი: 1 აშშ დოლარი – 2.8 ლარი", "Forecast (budget planning) rate only. Financing uses the exchange rate on the financing date; never use for conversions in calculations."),
    ("FX-FORECAST-GEL-PER-EUR", "3.2", "GEL-per-EUR", "SRC-ORDER", "2", "საპროგნოზო სავალუტო კურსი: 1 ევრო – 3.2 ლარი", "Forecast (budget planning) rate only. Financing uses the exchange rate on the financing date; never use for conversions in calculations."),
    ("CAR-TRAVEL-COMPENSATION-PCT", "100", "percent-of-economy-ticket", "SRC-ORDER", "5", "საკუთარი ავტომანქანით მგზავრობა — ეკონომ კლასის ერთი ავიაბილეთის ღირებულების 100%", None),
    ("SETTLEMENT-DSA-MULTIPLIER", "60", "times-daily-rate", "SRC-ORDER", "7", "პირველადი მოწყობა — №211 დადგენილების №1 დანართის სადღეღამისო ნორმის სამოცმაგი ოდენობა", "Daily rates (Decree №211 Annex 1) are not in the supplied sources; see dailyRates/dataGaps."),
    ("SETTLEMENT-FAMILY-PCT", "10", "percent-per-member", "SRC-ORDER", "7", "თითოეულ ოჯახის წევრზე (გარდა მხარდაჭერის მიმღებისა და მეურვეობის/მზრუნველობის ქვეშ მყოფი პირებისა) დამატებით 10%", None),
    ("BROKER-HEAD-PCT", "80", "percent-of-fee", "SRC-ORDER", "8", "ხელმძღვანელებს — მომსახურების ხარჯის 80%", None),
    ("BROKER-OTHER-PCT", "50", "percent-of-fee", "SRC-ORDER", "8", "დანარჩენ მოსამსახურეებს — 50%", None),
    ("BROKER-WINDOW-MONTHS", "6", "months-from-posting", "SRC-ORDER", "8", "წარგზავნიდან 6 თვის განმავლობაში, ერთჯერადად", None),
    ("BROKER-CAP-MONTHS-RENT", "1", "months-of-rent", "SRC-ORDER", "8", "არაუმეტეს დასაქირავებელი ბინის ერთი თვის ქირის ოდენობისა", None),
    ("SUSPENSION-KEEP-MAX-MONTHS", "1", "months", "SRC-ORDER", "19", "სამსახურებრივი ურთიერთობის შეჩერების სხვა შემთხვევებში — არაუმეტეს ერთი თვის ვადით (მინისტრის გადაწყვეტილებით)", None),
    ("RENT-ADVANCE-MAX-MONTHS-RENT", "6", "months-of-rent", "SRC-ORDER", "22", "საავანსო თანხა არა უმეტეს ექვსი თვის ბინის ქირის ოდენობისა", "Ministerial order may allow more (pt 22, last sentence)."),
    ("RENT-ADVANCE-REPAY-MONTHS", "6", "months", "SRC-ORDER", "22", "დაბრუნება ავანსის გაცემის დღიდან არაუმეტეს ექვსი თვის ვადაში, ყოველთვიურად, პროპორციული ოდენობით", None),
    ("EDU-LIMIT-EUR", "690", "EUR-per-month", "SRC-ORDER", "32(a)", "ევროში დაფინანსების შემთხვევაში – თვეში არაუმეტეს 690 ევრო", None),
    ("EDU-LIMIT-USD", "750", "USD-per-month", "SRC-ORDER", "32(b)", "აშშ დოლარში დაფინანსების შემთხვევაში – თვეში არაუმეტეს 750 აშშ დოლარი", None),
    ("EDU-EXCESS-SHARE-PCT", "80", "percent", "SRC-ORDER", "33", "ხარჯსა და ყოველთვიურ ლიმიტს შორის სხვაობის 80%", None),
    ("ADULT-CHILD-SCHOOL-EXTENSION-YEARS", "1", "years-after-majority", "SRC-ORDER", "note after pt 43", "სრულწლოვანი შვილი/გერი ზოგადსაგანმანათლებლო დაწესებულებაში სწავლის დასრულებამდე, სრულწლოვანების მიღწევიდან არაუმეტეს 1 წლის განმავლობაში", None),
]


def dec(s):
    """Validate a decimal string (raises on failure) and return it unchanged."""
    if not re.match(r"^\d+(\.\d+)?$", s):
        raise ValueError("not a decimal string: %r" % s)
    Decimal(s)
    return s


def norm_label(s):
    return re.sub(r"\s+", " ", s).strip()


def main():
    raw = {n: load(n) for n in range(2, 11)}
    sha = raw[4]["sha256"]
    assert sha == sha256(os.path.join(ROOT, PDF_REL)), "PDF hash changed - rerun extract-annexes.py"
    norms = []

    def add_norm(annex, row_no, raw_v, normalized, reason, field=None):
        norms.append(dict(id="N-%03d" % (len(norms) + 1), annex=annex, rowNo=row_no, field=field,
                          raw=raw_v, normalized=normalized, reason=reason))

    src = [dict(id=i, title=t, annex=a, pages=p, file=PDF_REL, sha256=sha,
                latestAmendmentNoted=am,
                verification="supplied-working-copy-only")
           for (i, t, a, p, am) in SOURCE_REFS]
    src.append(dict(id="SRC-DECREE211-A1", title="საქართველოს მთავრობის 2017 წლის 25 აპრილის №211 დადგენილება, დანართი №1 — სადღეღამისო ნორმები",
                    annex=None, pages=[8, 16], file=D211_REL, sha256=sha256(os.path.join(ROOT, D211_REL)),
                    latestAmendmentNoted="Annex 1: №470 of 2022-09-28 (also №91 of 2020-02-10)",
                    verification="user-supplied matsne consolidated preview (doc 3649787, '28'); effective date not stated"))

    # ---- positions
    def positions(annex, pos, notes):
        out = []
        for r in raw[annex]["rows"]:
            out.append(dict(id="A%d-R%d" % (annex, r["rowNo"]), rowNo=r["rowNo"], title_ka=norm_label(r["cells"]["title"]),
                            positions_ka=pos[r["rowNo"]], percent=dec(r["cells"]["percent"]),
                            sourceRef="SRC-ANNEX%d" % annex, page=r["page"], notes=notes.get(r["rowNo"])))
        return out

    profiles = [
        dict(id="annex2", title_ka="დანართი №2 — საზღვარგარეთ როტაციით მივლინებულ მოსამსახურეთა თანამდებობრივი მაჩვენებლები",
             appliesTo="staff posted on rotation (Order pt 1(b))", sourceRef="SRC-ANNEX2", entries=positions(2, A2_POS, A2_NOTES)),
        dict(id="annex3", title_ka="დანართი №3 — ცენტრალური აპარატის მოსამსახურეთა თანამდებობრივი მაჩვენებლები",
             appliesTo="HQ staff on long-term assignment abroad under Order pt 37 (independent mode)", sourceRef="SRC-ANNEX3",
             entries=positions(3, A3_POS, {})),
    ]

    # ---- K/E
    kcoef = []
    for r in raw[4]["rows"]:
        n = r["rowNo"]
        k_raw, e_raw = r["cells"]["k"], r["cells"]["e"]
        k = k_raw
        notes = []
        if "duplicated-text" in r["flags"]:
            toks = k_raw.split()
            assert len(set(toks)) == 1
            k = toks[0]
            add_norm(4, n, k_raw, k, "Same value printed twice in the K cell (duplicated text); one value kept, no second entitlement.", "k")
        if "," in k:
            k2 = k.replace(",", ".")
            add_norm(4, n, k, k2, "Decimal comma; K values in this column are coefficients around 1.4–2.7, so ',' is the decimal separator, not a thousands separator.", "k")
            k = k2
        if "displaced" in r["flags"] and "duplicated-text" not in r["flags"]:
            notes.append("K printed displaced within its cell (see raw notes); value unchanged.")
            add_norm(4, n, k_raw + " (printed at the bottom of the row-%d cell / on a separate line in the layout text)" % n, k,
                     "Displaced value assigned to its own row by cell geometry (grid lines); value unchanged.", "k")
        label = norm_label(r["cells"]["label"])
        if n == 4:
            add_norm(4, n, label, "აზერბაიჯანის რესპუბლიკა", "Stray fragment '(ა' under the label removed.", "label")
            label = "აზერბაიჯანის რესპუბლიკა"
        if r["rowNoRaw"].endswith("."):
            notes.append("Row number printed as '%s'." % r["rowNoRaw"])
        city = K_CITY_ROWS.get(n)
        if n == 61:
            notes.append("No institution in Annexes 5/6 is located in Serbia; this row alone establishes neither a mission, its funding currency nor insurance/baggage caps.")
        kcoef.append(dict(id="K-A4-R%d" % n, annex4Row=n, rawLabel=label, countryId=K_COUNTRY[n],
                          locationIds=city, scope="city" if city else "country",
                          k=dec(k), ePercent=dec(e_raw), sourceRef="SRC-ANNEX4", page=r["page"],
                          notes=" ".join(notes) or None))

    # ---- insurance & baggage caps (one entry per non-removed row; duplicates merged)
    def caps_ins(annex, cur):
        out, seen = [], {}
        for r in raw[annex]["rows"]:
            if "removed" in r["flags"]:
                continue
            bands, notes = {}, []
            for b in BANDS:
                v = r["cells"][b]
                v2 = v.replace(" ", "").rstrip("]")
                if v2 != v:
                    add_norm(annex, r["rowNo"], v, v2, "Stray ']' and/or a word split by a font change removed; digits unchanged.", b)
                bands[b] = dec(v2)
            lab = norm_label(r["cells"]["label"])
            if annex == 8 and r["rowNo"] == 16:
                fixed = lab.replace("(სIაCქAაOრ)თველოს", "საქართველოს")
                add_norm(8, 16, lab, fixed, "'(ICAO)' of row 15 is overprinted on the first word of row 16; characters de-interleaved.", "label")
                lab = fixed
            if r["rowNo"] in seen:
                prev = seen[r["rowNo"]]
                assert prev["bands"] == bands, "duplicate row with different values"
                add_norm(annex, r["rowNo"], "row %d printed twice: '%s' / '%s'" % (r["rowNo"], prev["rawLabel"], lab),
                         "single entry INS-A%d-R%d" % (annex, r["rowNo"]),
                         "Duplicated row with identical values; kept once (no second entitlement). Annex 6 names the institution 'გენერალური საკონსულო'.")
                prev["notes"] = (prev["notes"] or "") + " Printed twice in the source (second copy: '%s')." % lab
                continue
            if "continued-on-next-page" in r["flags"]:
                add_norm(annex, r["rowNo"], "label split across pages %d/%d" % (r["page"], r["page"] + 1), lab,
                         "Label cell split by the page break; both parts joined.", "label")
            if annex == 8 and r["rowNo"] == 24:
                add_norm(8, 24, lab, "(identified as) საქართველოს გენერალური საკონსულო ქ. ნიუ-იორკში",
                         "Label truncated in the source cell; identification only, rawLabel kept as printed.", "label")
                notes.append("Label truncated in source ('…ქ.ნიუ-'); identified as the Consulate General in New York by row position and the Annex 6/10 lists.")
            ent = dict(id="INS-A%d-R%d" % (annex, r["rowNo"]), annex=annex, rowNo=r["rowNo"], rawLabel=lab,
                       currency=cur, bands=bands, sourceRef="SRC-ANNEX%d" % annex, page=r["page"],
                       notes=" ".join(notes) or None)
            seen[r["rowNo"]] = ent
            out.append(ent)
        return out

    def caps_bag(annex, cur):
        out = []
        for r in raw[annex]["rows"]:
            if "removed" in r["flags"]:
                continue
            if "continued-on-next-page" in r["flags"]:
                add_norm(annex, r["rowNo"], "label split across pages %d/%d" % (r["page"], r["page"] + 1),
                         norm_label(r["cells"]["label"]), "Label cell split by the page break; both parts joined.", "label")
            out.append(dict(id="BAG-A%d-R%d" % (annex, r["rowNo"]), annex=annex, rowNo=r["rowNo"],
                            rawLabel=norm_label(r["cells"]["label"]), currency=cur, amount=dec(r["cells"]["amount"]),
                            sourceRef="SRC-ANNEX%d" % annex, page=r["page"], notes=None))
        return out

    ins = caps_ins(7, "EUR") + caps_ins(8, "USD")
    bag = caps_bag(9, "EUR") + caps_bag(10, "USD")

    # ---- missions
    removed = []
    for a in (5, 7):
        for r in raw[a]["rows"]:
            if "removed" in r["flags"]:
                removed.append(dict(annex=a, rowNo=r["rowNo"], rawLabel=norm_label(r["cells"]["label"]),
                                    page=r["page"], sourceRef="SRC-ANNEX%d" % a,
                                    note="Removed row (ამოღებულია); not selectable, no data derived from it."))

    def find(annex, key, pool):
        hits = [x for x in pool if x["annex"] == annex and re.search(key, x["rawLabel"])]
        ids = {h["id"] for h in hits}
        if len(ids) != 1:
            raise SystemExit("key %r matches %d entries in annex %d: %s" % (key, len(ids), annex, sorted(ids)))
        return hits[0]

    mrows = {a: {r["rowNo"]: r for r in raw[a]["rows"] if "removed" not in r["flags"]} for a in (5, 6)}
    missions = []
    used = {a: set() for a in (5, 6)}
    for (annex, row, key, typ, cc, loc, lbasis, krow, kbasis, name_ka, name_en, note) in MISSIONS:
        r = mrows[annex][row]
        raw_label = norm_label(r["cells"]["label"])
        assert re.search(key, raw_label), (annex, row, key, raw_label)
        used[annex].add(row)
        cur = "EUR" if annex == 5 else "USD"
        ia, ba = (7, 9) if annex == 5 else (8, 10)
        pool_ins = [x for x in ins if x["annex"] == ia]
        pool_bag = [x for x in bag if x["annex"] == ba]
        ic = find(ia, key, pool_ins)
        bc = find(ba, key, pool_bag)
        kid = None
        if krow is not None:
            kid = "K-A4-R%d" % krow
            kent = next(k for k in kcoef if k["id"] == kid)
            assert kent["countryId"] == cc, (row, kid)
            if kent["locationIds"]:
                assert loc in kent["locationIds"], (row, kid, loc)
        missions.append(dict(
            id="M-A%d-R%d" % (annex, row), annex=annex, rowNo=row, rawLabel=raw_label, name_ka=name_ka, name_en=name_en,
            type=typ, countryId=cc, locationId=loc, locationBasis=lbasis, fundingCurrency=cur,
            costCoefficientId=kid, costCoefficientBasis=kbasis, insuranceCapId=ic["id"], baggageCapId=bc["id"],
            status="listed-in-supplied-annex", sourceRef="SRC-ANNEX%d" % annex, page=r["page"], notes=note))
    for a in (5, 6):
        missing = set(mrows[a]) - used[a]
        assert not missing, ("unmapped institutions", a, missing)
    # every cap row must be used by exactly one institution
    for coll, name in ((ins, "insuranceCapId"), (bag, "baggageCapId")):
        cnt = {}
        for m in missions:
            cnt[m[name]] = cnt.get(m[name], 0) + 1
        for c in coll:
            assert cnt.get(c["id"]) == 1, ("cap row not used exactly once", c["id"], cnt.get(c["id"]))

    locations = []
    for (lid, cc, ka, en, alt, region) in LOCATIONS:
        d = dict(id=lid, countryId=cc, name_ka=ka, name_en=en, altNames=alt, region=region)
        d.update(LOCATION_EXTRA.get(lid, {}))
        locations.append(d)

    countries = [dict(id=c, iso2=c, name_ka=ka, name_en=en, officialName_ka=off) for (c, ka, en, off) in COUNTRIES]
    # ---- daily rates (Decree №211 Annex 1, column 3 "მოკლევადიანი მივლინებისას", column-2 currency)
    with open(D211_RAW, encoding="utf-8") as f:
        d211 = json.load(f)
    assert d211["sha256"] == sha256(os.path.join(ROOT, D211_REL)), "Decree 211 PDF hash changed - rerun extract-decree211.py"
    by_name = {}
    for r in d211["rows"]:
        by_name.setdefault(r["cells"]["country"], []).append(r)
    daily = []
    for c in countries:
        hits = by_name.get(c["officialName_ka"], [])
        if not hits:
            continue
        assert len(hits) == 1, ("duplicate Annex 1 row", c["id"])
        r = hits[0]
        cur_name = r["cells"]["currency"]
        assert cur_name in CURRENCY_ISO, ("unknown currency", cur_name)
        note = "Column 3 (short-term trip abroad) per Order №01-82 pt 7; columns 4 and 5 kept for reference only."
        if r["cells"]["country"] == "სამხრეთ აფრიკის რესპუბლიკა":
            note += " Columns 4/5 printed as 29 / 60 (unusual, kept as printed)."
        daily.append(dict(
            id="DSA-%s" % c["id"], countryId=c["id"], locationId=None, amount=dec(r["cells"]["c3_shortTrip"]),
            currency=CURRENCY_ISO[cur_name], currencyRaw=cur_name, rawLabel=r["cells"]["country"],
            sourceRef="SRC-DECREE211-A1", row=r["row"], page=r["page"],
            edition="matsne 3649787, consolidated preview '28' (PDF created 2026-07-16); Annex 1 amendments printed: №91 (2020-02-10), №470 (2022-09-28); effective date not stated",
            column="3", otherColumns=dict(c4_staffInHostState=r["cells"]["c4_staffInHostState"], c5_accommodation=r["cells"]["c5_accommodation"]),
            notes=note))
    no_rate = sorted({m["countryId"] for m in missions} - {x["countryId"] for x in daily})

    data = dict(
        schemaVersion=1,
        rulesVersion="01-82/supplied-pdf-2026-10-28",
        edition=dict(
            note="Order №01-82 of 2018-04-05 with Annexes 1–10 as contained in the supplied combined working copy (compiled 2026-10-28). Amendment annotations are reproduced as printed; effective dates of individual norms are not asserted.",
            latestAmendmentSeen="№01-317 of 2026-08-13",
            verification="supplied-working-copy-only",
            fullConsolidationVerified=False,
        ),
        sourceReferences=src,
        baseAmounts=[
            dict(id="H-EUR", currency="EUR", amount="3100", sourceRef="SRC-ORDER", point="3", citation="საბაზისო თანხა 3100 ევრო (№01-770, 2025-09-17)"),
            dict(id="H-USD", currency="USD", amount="3495", sourceRef="SRC-ORDER", point="3", citation="საბაზისო თანხა 3495 აშშ დოლარი (№01-770, 2025-09-17)"),
        ],
        parameters=[dict(id=i, value=dec(v), unit=u, sourceRef=s, point=p, citation=c, notes=n)
                    for (i, v, u, s, p, c, n) in PARAMETERS],
        positionProfiles=profiles,
        countries=countries,
        locations=locations,
        costCoefficients=kcoef,
        missions=missions,
        insuranceCaps=ins,
        insuranceBandRule="Age bands as printed: 00-18, 19-24, …, 65-69, 70-ზევით. Band keys use completed years of age ('0-18' = 0..18, '70+' = 70 and older).",
        baggageCaps=bag,
        dailyRates=daily,
        dailyRateRule="Order №01-82 pt 7: 60 × the Decree №211 Annex 1 daily rate for short-term trips abroad 'in foreign currency' = column 3, in the column-2 currency (may differ from the mission's funding currency; never converted). Annex 1 has country rows only (no city rows).",
        dataGaps=[
            dict(id="GAP-DAILY-RATE-NO-ROW", affects=["dailyRates"] + [m["id"] for m in missions if m["countryId"] in no_rate],
                 note="Decree №211 Annex 1 has no row for: %s (Holy See). Settlement stays undetermined unless a rate is entered manually; Italy's row is not borrowed." % ", ".join(no_rate)),
            dict(id="GAP-K-VATICAN", affects=["M-A5-R37"],
                 note="Annex 4 has no row for the Holy See/Vatican; K and E are undetermined for the Embassy to the Holy See."),
            dict(id="GAP-OPERATIONAL-STATUS", affects=["missions"],
                 note="Missions are those listed in the supplied annexes; their current operational status (e.g. Donetsk) is not verified."),
        ],
        removedEntries=removed,
        normalizations=norms,
    )
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("missions %d (EUR %d, USD %d), K rows %d, insurance %d, baggage %d, locations %d, countries %d, normalizations %d"
          % (len(missions), sum(m["annex"] == 5 for m in missions), sum(m["annex"] == 6 for m in missions),
             len(kcoef), len(ins), len(bag), len(locations), len(countries), len(norms)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
