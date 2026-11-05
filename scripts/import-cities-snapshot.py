#!/usr/bin/env python3
"""Import the user-supplied Numbeo city snapshot into src/data/market-snapshot.json.

Input : sources/original/numbeo-cities-snapshot-2026-10-31.txt (UTF-8 BOM, CRLF; Georgian compilation
        of Numbeo city pages, 80 entries "[NNN] ქვეყანა — ქალაქი")
        src/data/normative-data.json (our location ids)
Output: src/data/market-snapshot.json   (contract: docs/contracts.md §9)

Rules: all amounts are USD decimal strings exactly as printed (thousands commas removed); a value
"მონაცემი არ არის" or a zero is null (never 0). "≈" (converted from local currency by the compiler)
is kept as `converted: true`. Grocery basket = items of "საკვები პროდუქტები და სასმელები" without
wine, the two beers and Marlboro (same rule as the Apify adapter), summed exactly.
usdPerEur = median of USD/EUR over all budget lines that print a € parallel.

Deterministic. Usage: python3 -I scripts/import-cities-snapshot.py   (from the repository root)
"""
import hashlib
import json
import os
import re
import sys
from decimal import Decimal
from fractions import Fraction

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_REL = "sources/original/numbeo-cities-snapshot-2026-10-31.txt"
SRC = os.path.join(ROOT, SRC_REL)
DATA = os.path.join(ROOT, "src", "data", "normative-data.json")
OUT = os.path.join(ROOT, "src", "data", "market-snapshot.json")

MISSING = "მონაცემი არ არის"
NO_RANGE = "დიაპაზონი არ არის"
# file entry → our location id, where the Georgian city name differs from ours
OVERRIDES = {"005": "DE-FRANKFURT", "060": "IN-NEW-DELHI", "070": "RU-MOSCOW", "072": "SA-RIYADH", "077": "KW-KUWAIT-CITY",
             "047": "AZ-GANJA"}
EXTRA = {"006": "Munich", "043": "Belgrade", "044": "Podgorica"}   # not our mission cities (kept, unused)
VATICAN = "039"
GROCERY_EXCLUDE = ("ღვინო", "ადგილობრივი ლუდი", "იმპორტირებული ლუდი", "Marlboro")
RENT = {"1 საძინებლიანი ბინის ქირა — ცენტრში": "centre_1br", "1 საძინებლიანი ბინის ქირა — ცენტრის გარეთ": "outside_1br",
        "3 საძინებლიანი ბინის ქირა — ცენტრში": "centre_3br", "3 საძინებლიანი ბინის ქირა — ცენტრის გარეთ": "outside_3br"}
INDICES = {"ცხოვრების ღირებულების ინდექსი — ქირის გარეშე": "costOfLiving", "ქირის ინდექსი": "rent",
           "ცხოვრების ღირებულებისა და ქირის გაერთიანებული ინდექსი": "costOfLivingPlusRent",
           "საკვები პროდუქტების ფასების ინდექსი": "groceries", "რესტორნების ფასების ინდექსი": "restaurants"}
NUM_RE = re.compile(r"^(≈)?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d+))?$")
anomalies = []


def num(s, ctx):
    """Printed number → (decimal string | None, converted flag)."""
    s = s.strip()
    if s.startswith(MISSING) or s == "":
        return None, False
    m = NUM_RE.match(s)
    if not m:
        anomalies.append(f"{ctx}: unparsed number {s!r}")
        return None, False
    v = m.group(2).replace(",", "") + (("." + m.group(3)) if m.group(3) else "")
    v = str(Decimal(v).normalize()) if "." in v else v
    if "E" in v:
        v = format(Decimal(v), "f")
    if Decimal(v) == 0:
        anomalies.append(f"{ctx}: zero value treated as missing")
        return None, bool(m.group(1))
    return v, bool(m.group(1))


def price(line_value, ctx):
    """'19.04 | 13.44–29.12 [note]' → Price | None."""
    parts = line_value.split("|", 1)
    avg, conv = num(parts[0], ctx)
    if avg is None:
        return None
    low = high = None
    if len(parts) > 1:
        rng = re.sub(r"\[.*?\]", "", parts[1]).strip()
        if not rng.startswith(NO_RANGE):
            mm = re.match(r"^(≈?[\d,.]+)\s*[–-]\s*(≈?[\d,.]+)", rng)
            if mm:
                low, _ = num(mm.group(1), ctx + " low")
                high, _ = num(mm.group(2), ctx + " high")
            else:
                anomalies.append(f"{ctx}: unparsed range {rng!r}")
    p = {"average": avg, "low": low, "high": high}
    if conv:
        p["converted"] = True
    return p


def iso_date(s):
    s = s.strip()
    m = re.match(r"^(\d{2})\.(\d{2})\.(\d{4})$", s)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    m = re.match(r"^(\d{2})\.(\d{4})$", s)
    if m:
        return f"{m.group(2)}-{m.group(1)}"
    return None


def main():
    raw = open(SRC, "rb").read()
    sha = hashlib.sha256(raw).hexdigest()
    text = raw.decode("utf-8-sig").replace("\r\n", "\n")
    lines = text.split("\n")
    m = re.search(r"მომზადებულია:\s*(\d{2})\.(\d{2})\.(\d{4}),\s*(\d{2}):(\d{2})", text)
    compiled = f"{m.group(3)}-{m.group(2)}-{m.group(1)}T{m.group(4)}:{m.group(5)}+04:00" if m else None
    data = json.load(open(DATA, encoding="utf-8"))
    locs = data["locations"]
    countries = {c["id"]: c for c in data["countries"]}

    heads = [(i, re.match(r"^\[(\d{3})\]\s+(.+?)\s+—\s+(.+)$", l)) for i, l in enumerate(lines)]
    heads = [(i, h) for i, h in heads if h]
    assert len(heads) == 80, len(heads)
    cities, extra, eur_pairs, unmapped = {}, {}, [], []
    vatican_note = None
    for k, (i, h) in enumerate(heads):
        no, country_ka, city_ka = h.group(1), h.group(2), h.group(3)
        block = lines[i + 1:(heads[k + 1][0] if k + 1 < len(heads) else len(lines))]
        if no == VATICAN:
            vatican_note = " ".join(l.strip() for l in block[:2] if l.strip())
            continue
        f = {}
        for l in block:
            for key in ("Numbeo-ს დასახელება:", "მიღების სტატუსი:", "ფასების ბოლო განახლება წყაროში:", "ფასების წყარო:", "Numbeo-ს შენიშვნა:", "ფასობრივი დაფარვა:"):
                if l.startswith(key) and key not in f:
                    f[key] = l[len(key):].strip()
        ctx = f"[{no}] {city_ka}"
        status = f.get("მიღების სტატუსი:", "")
        retrieval = "direct" if status.startswith("უშუალოდ") else "archive" if status.startswith("საჯარო საძიებო") else None
        if retrieval is None:
            anomalies.append(f"{ctx}: unknown retrieval status {status[:40]!r}")
        rec = {"entryNo": int(no), "numbeoName": f.get("Numbeo-ს დასახელება:"), "retrieval": retrieval,
               "sourceUpdatedAt": iso_date(f.get("ფასების ბოლო განახლება წყაროში:", "")), "sourceUrl": f.get("ფასების წყარო:")}
        # sections
        sec, budget, idx = None, {"single": None, "family4": None}, {v: None for v in INDICES.values()}
        rent = {v: None for v in RENT.values()}
        util = {"basic85m2": None, "internet": None}
        rest = {"inexpensiveMeal": None, "midRangeForTwo": None}
        groc_vals, groc_missing, any_converted = [], [], False
        in_indices = False
        index_notes = []
        for l in block:
            s = l.strip()
            if s.startswith("თვიური საორიენტაციო ხარჯები"):
                sec = "budget"; continue
            if s.startswith("ცხოვრების ღირებულების ინდექსები"):
                sec = "indices"; in_indices = True; continue
            if s.startswith("ფასების სრული ჩამონათვალი"):
                sec = "prices"; in_indices = False; continue
            if s in ("რესტორნები და კვება", "საკვები პროდუქტები და სასმელები", "ტრანსპორტი", "კომუნალური და კავშირგაბმულობა — თვიურად",
                     "სპორტი და დასვენება", "ბაღი და სკოლა", "ტანსაცმელი და ფეხსაცმელი", "ბინის ქირა — თვიურად",
                     "ბინის შესყიდვა — 1 მ²-ის ფასი", "ხელფასი და იპოთეკა") and sec in ("prices", "price-sub"):
                sec, sub = "price-sub", s; continue
            if s.startswith("ცხოვრების ხარისხი, უსაფრთხოება"):
                sec = "other"; continue
            if ":" not in s:
                continue
            label, val = s.split(":", 1)
            label, val = label.strip(), val.strip()
            if sec == "budget" and label in ("ერთი ადამიანი", "ოთხსულიანი ოჯახი"):
                key = "single" if label == "ერთი ადამიანი" else "family4"
                usd = re.match(r"^(≈?[\d,]+(?:\.\d+)?)\s*USD", val)
                if usd:
                    a, conv = num(usd.group(1), f"{ctx} budget {key}")
                    par = re.search(r"\(([^)]*)\)", val)
                    if a:
                        budget[key] = {"average": a, "parallelRaw": par.group(1) if par else None}
                        if conv:
                            budget[key]["converted"] = True
                        e = re.match(r"^€([\d,]+(?:\.\d+)?)$", par.group(1)) if par else None
                        if e:
                            eur_pairs.append((Fraction(Decimal(a)) / Fraction(Decimal(e.group(1).replace(",", ""))), ctx, key))
                elif not val.startswith(MISSING):
                    anomalies.append(f"{ctx}: unparsed budget {val!r}")
            elif sec == "indices" and in_indices and label in INDICES and idx[INDICES[label]] is None:
                mm = re.match(r"^(≈?[\d,]+(?:\.\d+)?)\s*(.*)$", val.split("(")[0].strip())
                if mm:
                    idx[INDICES[label]], _ = num(mm.group(1), f"{ctx} index {label}")
                    if mm.group(2).strip(" —"):
                        index_notes.append(f"{INDICES[label]}: {mm.group(2).strip(' —')}")
                elif not val.startswith(MISSING):
                    anomalies.append(f"{ctx}: unparsed index {val!r}")
            elif sec == "price-sub":
                wanted = (sub == "ბინის ქირა — თვიურად" and label in RENT) or sub.startswith("კომუნალური") \
                    or sub == "რესტორნები და კვება" or sub == "საკვები პროდუქტები და სასმელები"
                if not wanted:
                    continue
                p = price(val, f"{ctx} {label}")
                if p and p.get("converted"):
                    any_converted = True
                if sub == "ბინის ქირა — თვიურად" and label in RENT:
                    rent[RENT[label]] = p
                elif sub.startswith("კომუნალური") and label.startswith("85 მ²"):
                    util["basic85m2"] = p
                elif sub.startswith("კომუნალური") and label.startswith("სახლის ულიმიტო ინტერნეტი"):
                    util["internet"] = p
                elif sub == "რესტორნები და კვება" and label.startswith("სადილი იაფ რესტორანში"):
                    rest["inexpensiveMeal"] = p
                elif sub == "რესტორნები და კვება" and label.startswith("სადილი საშუალო კლასის"):
                    rest["midRangeForTwo"] = p
                elif sub == "საკვები პროდუქტები და სასმელები" and not label.startswith(GROCERY_EXCLUDE):
                    (groc_vals.append(p["average"]) if p else groc_missing.append(label))
        basket = None
        if groc_vals:
            basket = format(sum((Decimal(x) for x in groc_vals), Decimal(0)), "f")
        rec.update({
            "rent": rent, "utilities": util,
            "groceries": {"basketItemsSum": basket, "itemsCounted": len(groc_vals), "itemsMissing": len(groc_missing), "missingItems": groc_missing},
            "restaurants": rest, "indices": idx, "budget": budget,
            "notes": None,
        })
        notes = []
        if retrieval == "archive":
            notes.append("საჯარო საძიებო ასლიდან აღდგენილი (31.10.2026-ზე ცოცხლად სრულად ვერ გადამოწმდა).")
        if any_converted:
            notes.append("ნაწილი ფასისა ადგილობრივი ვალუტიდან გადათვლილია (≈, ExchangeRate-API, 31.10.2026).")
        if f.get("Numbeo-ს შენიშვნა:"):
            notes.append("Numbeo: " + f["Numbeo-ს შენიშვნა:"])
        if no in ("014", "067"):
            notes.append("ფაილის შენიშვნა: არასრული ან ნაწილობრივ შეფასებული ფასები.")
        if index_notes:
            notes.append("ინდექსი: " + "; ".join(index_notes) + ".")
        if f.get("ფასობრივი დაფარვა:"):
            notes.append("დაფარვა: " + f["ფასობრივი დაფარვა:"])
        rec["notes"] = " ".join(notes) or None
        if no in EXTRA:
            extra[EXTRA[no]] = rec
            continue
        loc = OVERRIDES.get(no)
        if not loc:
            cands = [l for l in locs if (l["name_ka"] == city_ka or city_ka in l.get("altNames", []))
                     and countries[l["countryId"]]["name_ka"].split()[0] in country_ka + " " + countries[l["countryId"]]["name_ka"]]
            if len(cands) == 1:
                loc = cands[0]["id"]
        if not loc:
            unmapped.append(ctx)
            continue
        assert loc not in cities, ("two entries for", loc)
        cities[loc] = rec
    assert not unmapped, unmapped
    ratios = sorted(r for r, _, _ in eur_pairs)
    n = len(ratios)
    med = ratios[n // 2] if n % 2 else (ratios[n // 2 - 1] + ratios[n // 2]) / 2
    dec6 = lambda fr: format((Decimal(fr.numerator) / Decimal(fr.denominator)).quantize(Decimal("0.000001")), "f")
    out = {
        "schemaVersion": 1,
        "source": {"file": SRC_REL, "sha256": sha, "compiledAt": compiled, "retrievedAt": "2026-10-31",
                   "note_ka": "მომხმარებლის მიერ შედგენილი Numbeo-ს ქალაქების გვერდების ასლი (USD). ნაწილი პირდაპირ 31.10.2026-ს, ნაწილი 2026 წლის მაის–ივნისის საძიებო ასლებიდან (`retrieval` თითო ქალაქზე). ოფიციალურ ნორმატიულ თანხებზე გავლენა არ აქვს."},
        "currency": "USD",
        "usdPerEur": {"value": dec6(med), "exact": f"{med.numerator}/{med.denominator}", "min": dec6(ratios[0]), "max": dec6(ratios[-1]), "pairs": n,
                      "derivedFrom": "Numbeo € parallels in the snapshot (median of all budget pairs)", "date": "2026-10-31", "purpose": "reference display only"},
        "vaticanNote_ka": vatican_note,
        "cities": dict(sorted(cities.items())),
        "extraCities": dict(sorted(extra.items())),
        "parseAnomalies": anomalies,
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    ours = sorted(l["id"] for l in locs if any(mm["locationId"] == l["id"] for mm in data["missions"]))
    missing = [x for x in ours if x not in cities]
    print(f"cities {len(cities)}; extra {sorted(extra)}; usdPerEur {out['usdPerEur']['value']} (min {out['usdPerEur']['min']}, max {out['usdPerEur']['max']}, {n} pairs)")
    print("mission locations without entry:", missing)
    print("budgets:", sum(1 for c in cities.values() if c["budget"]["single"]), "single;", sum(1 for c in cities.values() if c["budget"]["family4"]), "family4")
    print("anomalies:", len(anomalies), anomalies[:10])
    return 0


if __name__ == "__main__":
    sys.exit(main())
