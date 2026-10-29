#!/usr/bin/env python3
"""Independent recomputation of tests/fixtures/golden-cases.json.

Written by the independent verifier directly from order No 01-82 and its annexes
(supplied edition). It deliberately imports NOTHING from the project's src/ and
uses exact rational arithmetic (fractions.Fraction) throughout.

It also cross-checks every table value that was read visually from the rendered
PDF pages against the PDF text layer (sources/extracted/rotation_sources.layout.txt).

Usage:  python3 tests/independent/compute_golden.py [-v]
Exit code 0 = all assertions passed.
"""
from __future__ import annotations

import datetime as dt
import json
import sys
from fractions import Fraction as Fr
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CASES = ROOT / "tests" / "fixtures" / "golden-cases.json"
LAYOUT = ROOT / "sources" / "extracted" / "rotation_sources.layout.txt"
VERBOSE = "-v" in sys.argv

# ---------------------------------------------------------------- rule constants
# Order pt 3; Annex 1 art. 3(b) Q = 7; pt 32-33; pt 8; pt 7.
H = {"EUR": Fr(3100), "USD": Fr(3495)}
Q = Fr(7, 100)
EDU_LIMIT = {"EUR": Fr(690), "USD": Fr(750)}
EDU_EXCESS = Fr(8, 10)
BROKER_RATE = {True: Fr(8, 10), False: Fr(5, 10)}
SETTLE_DAYS = 60
SETTLE_MEMBER = Fr(1, 10)
SETTLE_EXCLUDED = {"support-recipient", "guardianship"}
BANDS = [(0, 18, "0-18"), (19, 24, "19-24"), (25, 29, "25-29"), (30, 34, "30-34"),
         (35, 39, "35-39"), (40, 44, "40-44"), (45, 49, "45-49"), (50, 54, "50-54"),
         (55, 59, "55-59"), (60, 64, "60-64"), (65, 69, "65-69")]

# ---------------------------------------------------------------- helpers
failures: list[str] = []
checks = 0


def fr(s) -> Fr:
    s = str(s)
    if "/" in s:
        a, b = s.split("/")
        return Fr(a) / Fr(b)
    return Fr(s)


def disp(x: Fr) -> str:
    """ROUND_HALF_UP to 2 decimals on the exact rational (proposed policy)."""
    sign = -1 if x < 0 else 1
    q = (abs(x) * 100 + Fr(1, 2)).__floor__()
    q *= sign
    neg = q < 0
    q = abs(q)
    return ("-" if neg else "") + f"{q // 100}.{q % 100:02d}"


def check(cid: str, label: str, got, want):
    global checks
    checks += 1
    ok = got == want
    if not ok:
        failures.append(f"{cid} {label}: got {got!r}, expected {want!r}")
    elif VERBOSE:
        print(f"  ok {cid} {label} = {got!r}")


def check_money(cid: str, label: str, got: Fr, exp):
    if exp == "undetermined":
        check(cid, label, got, "undetermined")
        return
    if isinstance(exp, dict):
        check(cid, label + ".exact", got, fr(exp["exact"]))
        if "display" in exp:
            check(cid, label + ".display", disp(got) if isinstance(got, Fr) else got, exp["display"])
    else:
        check(cid, label, got, fr(exp))


# ---------------------------------------------------------------- formulas
def rent_subsidy(T: Fr, G, head: bool):
    """Annex 1 art. 3(d). G=None -> undetermined. G == T -> T (interpretation)."""
    if G is None:
        return "undetermined"
    G = fr(G)
    if G < 0:
        raise ValueError("negative rent")
    if G == 0:
        return Fr(0)
    if G <= T:
        return T
    rate, cap = (Fr(8, 10), 2 * T) if head else (Fr(5, 10), T)
    return T + min(rate * (G - T), cap)


def monthly(inp: dict) -> dict:
    Hb = fr(inp["H"])
    A = fr(inp["A_percent"]) / 100
    K = fr(inp["K"])
    E = fr(inp["E_percent"]) / 100
    C = Fr(inp["C"])
    D = Hb * A * K * (1 + Q * C)
    T = D * E
    F = rent_subsidy(T, inp.get("G"), bool(inp.get("isHead")))
    out = {"D": D, "T": T, "F": F, "DminusT": D - T}
    if F == "undetermined":
        out["S"] = "undetermined"
    else:
        out["S"] = D - T + F
        G = fr(inp["G"])
        out["uncoveredHousing"] = max(G - F, Fr(0))
    return out


def education(P: Fr, cur: str, eligible: bool = True) -> Fr:
    if not eligible:
        return Fr(0)
    L = EDU_LIMIT[cur]
    return min(P, L) + EDU_EXCESS * max(P - L, Fr(0))


def add_months(d: dt.date, n: int) -> dt.date:
    y, m = divmod(d.month - 1 + n, 12)
    y += d.year
    m += 1
    import calendar
    last = calendar.monthrange(y, m)[1]
    return dt.date(y, m, min(d.day, last))


def broker_eligibility(posting: str, service: str, already: bool):
    if already:
        return False
    p = dt.date.fromisoformat(posting)
    s = dt.date.fromisoformat(service)
    anniv = add_months(p, 6)
    if s < p:
        return False
    if s < anniv:
        return True
    if s == anniv:
        return "undetermined"
    return False


def baggage(cap: Fr, used: Fr, claims):
    remaining = max(cap - used, Fr(0))
    out = []
    for c in claims:
        r = min(fr(c), remaining)
        out.append(r)
        remaining -= r
    return out, remaining


def settlement(rate: Fr, members) -> tuple[int, Fr]:
    n = sum(1 for m in members if m["status"] not in SETTLE_EXCLUDED)
    return n, rate * SETTLE_DAYS * (1 + SETTLE_MEMBER * n)


def band(age):
    if age is None:
        return "undetermined"
    if age < 0:
        raise ValueError
    for lo, hi, name in BANDS:
        if lo <= age <= hi:
            return name
    return "70+"


def days_incl(a: str, b: str) -> int:
    return (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days + 1


def month_days(ym: str) -> int:
    import calendar
    y, m = map(int, ym.split("-"))
    return calendar.monthrange(y, m)[1]


# ---------------------------------------------------------------- source text
PAGES = LAYOUT.read_text(encoding="utf-8").split("\f")  # PAGES[0] = page 1


def page_tokens(page: int) -> list[str]:
    toks = []
    for t in PAGES[page - 1].split():
        t = t.strip("]").rstrip(".")
        if t:
            toks.append(t)
    return toks


def page_lines(page: int) -> list[str]:
    return [" ".join(l.split()) for l in PAGES[page - 1].splitlines() if l.strip()]


def has_sequence(page: int, seq) -> bool:
    toks = page_tokens(page)
    seq = [str(x) for x in seq]
    n = len(seq)
    return any(toks[i:i + n] == seq for i in range(len(toks) - n + 1))


def window_has(page: int, fragment: str, tokens, radius: int = 1) -> bool:
    lines = page_lines(page)
    frag = " ".join(fragment.split())
    for i, l in enumerate(lines):
        if frag in l:
            win = " ".join(lines[max(0, i - radius): i + radius + 1]).split()
            win = [t.strip("]").rstrip(".") for t in win]
            if all(str(t) in win for t in tokens):
                return True
    return False


def row_window_has(page: int, row: int, token: str, radius: int = 1) -> bool:
    lines = page_lines(page)
    for i, l in enumerate(lines):
        first = l.split()[0].rstrip(".")
        if first == str(row):
            win = " ".join(lines[max(0, i - radius): i + radius + 1]).split()
            if token in win:
                return True
    return False


def src(cid: str, label: str, ok: bool):
    check(cid, "source:" + label, ok, True)


# ---------------------------------------------------------------- dispatch
def run_case(c: dict):
    cid, k, inp, exp = c["id"], c["kind"], c.get("inputs", {}), c.get("expected", {})

    if k == "rent":
        D = fr(inp["D"])
        T = D * fr(inp["E_percent"]) / 100
        F = rent_subsidy(T, inp["G"], inp["isHead"])
        S = D - T + F
        res = {"T": T, "F": F, "S": S, "uncoveredHousing": max(fr(inp["G"]) - F, Fr(0)),
               "subsidyAboveRent": max(F - fr(inp["G"]), Fr(0))}
        for key, e in exp.items():
            check_money(cid, key, res[key], e)
        if "mustNotEqual" in c:
            for key, v in c["mustNotEqual"].items():
                if key != "reason":
                    check(cid, f"mustNotEqual.{key}", res[key] != fr(v), True)

    elif k == "monthly":
        res = monthly(inp)
        for key, e in exp.items():
            check_money(cid, key, res[key], e)

    elif k == "monthly-with-education":
        res = monthly(inp)
        cur = inp["currency"]
        edu = sum((education(fr(p), cur) for p in inp["educationExpenses"]), Fr(0))
        paid = sum((fr(p) for p in inp["educationExpenses"]), Fr(0))
        check_money(cid, "S", res["S"], exp["S"])
        check_money(cid, "educationReimbursement", edu, exp["educationReimbursement"])
        check_money(cid, "remainderAfterRentAndEducation", res["S"] + edu - fr(inp["G"]) - paid,
                    exp["remainderAfterRentAndEducation"])

    elif k == "monthly-pair":
        for who in ("higher", "lower"):
            res = monthly(inp[who])
            for key, e in exp[who].items():
                check_money(cid, f"{who}.{key}", res[key], e)

    elif k == "position-table":
        a2 = {l for l in page_lines(13)}
        a3 = {l for l in page_lines(14)}
        src(cid, "A2 r6 60", "6 პირველი მდივანი, მეორე მდივანი 60" in a2)
        src(cid, "A2 r7 55", "7 მესამე მდივანი, ატაშე, უსაფრთხოების ოფიცერი 55" in a2)
        src(cid, "A2 r5 65", "5 მრჩეველი, ადმინისტრაციული მენეჯერი, ვიცე-კონსული 65" in a2)
        src(cid, "A2 r8 50", "8 რეფერენტი 50" in a2)
        src(cid, "A2 r9 40", "9 მძღოლი 40" in a2)
        src(cid, "A3 r5 60", "5 პირველი მდივანი 60" in a3)
        src(cid, "A3 r6 55", "6 მეორე მდივანი 55" in a3)
        src(cid, "A3 r7 50", "7 მესამე მდივანი, ატაშე, რეფერენტი, უსაფრთხოების ოფიცერი 50" in a3)
        src(cid, "A3 r4 65", "4 მრჩეველი 65" in a3)
        src(cid, "A3 r8 40", "8 მძღოლი 40" in a3)
        # the case's mapping must agree with those rows
        a2map = {"პირველი მდივანი": "60", "მეორე მდივანი": "60", "მესამე მდივანი": "55", "ატაშე": "55",
                 "უსაფრთხოების ოფიცერი": "55", "რეფერენტი": "50", "მრჩეველი": "65", "მძღოლი": "40"}
        a3map = {"პირველი მდივანი": "60", "მეორე მდივანი": "55", "მესამე მდივანი": "50", "ატაშე": "50",
                 "უსაფრთხოების ოფიცერი": "50", "რეფერენტი": "50", "მრჩეველი": "65", "მძღოლი": "40"}
        check(cid, "annex2", exp["annex2"], a2map)
        check(cid, "annex3", exp["annex3"], a3map)

    elif k == "education":
        r = education(fr(inp["P"]), inp["currency"], inp["eligible"])
        check_money(cid, "reimbursement", r, exp["reimbursement"])
        check_money(cid, "personalCost", fr(inp["P"]) - r, exp["personalCost"])

    elif k == "education-multi":
        cur = inp["currency"]
        per = [education(fr(ch["P"]), cur, ch["eligible"]) for ch in inp["children"]]
        for i, (g, e) in enumerate(zip(per, exp["perChild"])):
            check_money(cid, f"perChild[{i}]", g, e)
        check_money(cid, "total", sum(per, Fr(0)), exp["total"])
        tot_p = sum((fr(ch["P"]) for ch in inp["children"]), Fr(0))
        check_money(cid, "personalCost", tot_p - sum(per, Fr(0)), exp["personalCost"])
        check(cid, "alternativeIfPooled", education(tot_p, cur), fr(c["alternativeIfPooled"]["total"]))

    elif k == "education-eligibility":
        got = [x["inSchool"] and x["hostConsent"] and x["monthsSinceMajority"] <= 12 for x in inp["cases"]]
        check(cid, "eligible", got, exp["eligible"])

    elif k == "broker":
        dates = inp.get("serviceDates") or [inp["serviceDate"]]
        elig = [broker_eligibility(inp["postingDate"], d, inp["alreadyReimbursed"]) for d in dates]
        if "serviceDates" in inp:
            check(cid, "eligible", elig, exp["eligible"])
            return
        check(cid, "eligible", elig[0], exp["eligible"])
        amt = min(fr(inp["fee"]) * BROKER_RATE[inp["isHead"]], fr(inp["rent"])) if elig[0] is True else Fr(0)
        check_money(cid, "reimbursement", amt, exp["reimbursement"])
        if "legacyValue" in c and "reimbursement" in c["legacyValue"]:
            legacy = fr(inp["rent"]) * BROKER_RATE[inp["isHead"]]
            check(cid, "legacy reproduced", legacy, fr(c["legacyValue"]["reimbursement"]))
            check(cid, "legacy differs", legacy != amt, True)

    elif k == "baggage":
        reimb, rem = baggage(fr(inp["cap"]), fr(inp["previouslyUsed"]), inp["claims"])
        check(cid, "reimbursements", reimb, [fr(x) for x in exp["reimbursements"]])
        check(cid, "remaining", rem, fr(exp["remaining"]))
        if "personalCost" in exp:
            check(cid, "personalCost", sum((fr(x) for x in inp["claims"]), Fr(0)) - sum(reimb, Fr(0)),
                  fr(exp["personalCost"]))

    elif k == "baggage-event":
        if inp["event"] == "recall" and inp["callBackAlreadyReimbursed"]:
            reimb = [Fr(0) for _ in inp["claims"]]
        else:
            reimb, _ = baggage(fr(inp["cap"]), Fr(0), inp["claims"])
        check(cid, "reimbursements", reimb, [fr(x) for x in exp["reimbursements"]])

    elif k == "settlement":
        rate = fr(inp["dailyRate"])
        if "variants" in inp:
            got = [settlement(rate, v["members"])[1] for v in inp["variants"]]
            check(cid, "amounts", got, [fr(x) for x in exp["amounts"]])
            return
        n, amt = settlement(rate, inp["members"])
        if inp.get("exception", "").startswith("pt9"):
            amt = Fr(0)
        if "countableMembers" in exp:
            check(cid, "countableMembers", n, exp["countableMembers"])
        check_money(cid, "amount", amt, exp["amount"])
        if "currency" in exp:
            check(cid, "currency", inp["dailyRateCurrency"], exp["currency"])
            confirmed = inp.get("dailyRateStatus") == "confirmed" and inp["dailyRateCurrency"] == inp["missionCurrency"]
            check(cid, "includedInConfirmedEURTotal", confirmed, exp["includedInConfirmedEURTotal"])

    elif k == "prorate":
        md = inp["monthDays"]
        if "month" in inp:
            check(cid, "monthDays", month_days(inp["month"]), md)
        if "from" in inp:
            check(cid, "days", days_incl(inp["from"], inp["to"]), inp["days"])
        check_money(cid, "amount", fr(inp["fullRate"]) * inp["days"] / md, exp["amount"])

    elif k == "daycount":
        check(cid, "days", [days_incl(a, b) for a, b in inp["ranges"]], exp["days"])

    elif k == "segments":
        md = month_days(inp["month"])
        check(cid, "monthDays", md, inp["monthDays"])
        segS, segD, total, prev_end = [], [], Fr(0), None
        for s in inp["segments"]:
            check(cid, f"days {s['from']}", days_incl(s["from"], s["to"]), s["days"])
            if prev_end is not None:
                check(cid, f"contiguous {s['from']}",
                      dt.date.fromisoformat(s["from"]) - prev_end, dt.timedelta(days=1))
            prev_end = dt.date.fromisoformat(s["to"])
            p = dict(inp["base"])
            p.update({kk: vv for kk, vv in s.items() if kk in ("G", "C")})
            r = monthly(p)
            segS.append(r["S"])
            segD.append(r["D"])
            total += r["S"] * s["days"] / md
        check(cid, "coversMonth", sum(s["days"] for s in inp["segments"]), md)
        check(cid, "segmentFullMonthS", segS, [fr(x) for x in exp["segmentFullMonthS"]])
        if "segmentFullMonthD" in exp:
            check(cid, "segmentFullMonthD", segD, [fr(x) for x in exp["segmentFullMonthD"]])
        check_money(cid, "totalS", total, exp["totalS"])
        if "antiPattern" in c:
            avgG = sum((fr(s["G"]) * s["days"] for s in inp["segments"]), Fr(0)) / md
            p = dict(inp["base"])
            p["G"] = str(avgG.numerator) + "/" + str(avgG.denominator)
            wrong = monthly({**p, "G": None})  # D, T only
            Fwrong = rent_subsidy(wrong["T"], avgG, p["isHead"])
            Swrong = wrong["D"] - wrong["T"] + Fwrong
            check(cid, "antiPattern differs", Swrong != total, True)

    elif k == "rounding":
        check(cid, "displayHalfUp", [disp(fr(v)) for v in inp["values"]], exp["displayHalfUp"])

    elif k == "rounding-chain":
        r = monthly(inp)
        check(cid, "S_display", disp(r["S"]), exp["S_display"])
        D2 = fr(disp(r["D"]))
        T2 = fr(disp(D2 * fr(inp["E_percent"]) / 100))
        F2 = fr(disp(T2 + min(Fr(1, 2) * fr(disp(fr(inp["G"]) - T2)), T2)))
        S2 = disp(D2 - T2 + F2)
        check(cid, "rounded-chain antipattern", S2, exp["S_from_rounded_intermediates_antiPattern"])
        check(cid, "mustNotEqual", disp(r["S"]) != c["mustNotEqual"]["S_display"], True)

    elif k == "insurance-band":
        check(cid, "bands", [band(a) for a in inp["ages"]], exp["bands"])

    elif k == "insurance-row":
        check(cid, "12 bands", len(exp["bands"]), 12)
        sc = c["sourceCheck"]
        src(cid, f"p{sc['page']} sequence", has_sequence(sc["page"], sc["tokens"]))
        nums = [t for t in sc["tokens"] if t.isdigit() and len(t) >= 3]
        check(cid, "tokens match expected (as multiset)", sorted(nums), sorted(exp["bands"]))

    elif k == "insurance-spot":
        for r in exp["rows"]:
            check(cid, f"A{r['annex']} r{r['row']} 12 bands", len(r["bands"]), 12)
            src(cid, f"A{r['annex']} r{r['row']} p{r['page']}", has_sequence(r["page"], r["bands"]))

    elif k == "insurance-reimb":
        cap, used, price = fr(inp["cap"]), fr(inp["alreadyUsed"]), fr(inp["policyPrice"])
        rem = max(cap - used, Fr(0))
        r = min(price, rem)
        check(cid, "reimbursement", r, fr(exp["reimbursement"]))
        if "personalCost" in exp:
            check(cid, "personalCost", price - r, fr(exp["personalCost"]))
        if "remainingCap" in exp:
            check(cid, "remainingCap", rem - r, fr(exp["remainingCap"]))
        if "capShown" in exp:
            check(cid, "capShown", cap, fr(exp["capShown"]))

    elif k == "advance":
        if "variants" in inp:
            rent = fr(inp["rent"])
            got = [fr(v["advance"]) > 6 * rent or v["months"] > 6 for v in inp["variants"]]
            check(cid, "requiresMinisterOrder", got, exp["requiresMinisterOrder"])
            return
        S, rent, adv, n = fr(inp["S_monthly"]), fr(inp["rent"]), fr(inp["advance"]), inp["months"]
        check(cid, "maxAdvanceWithoutOrder", 6 * rent, fr(exp["maxAdvanceWithoutOrder"]))
        rep = adv / n
        check(cid, "monthlyRepayment", rep, fr(exp["monthlyRepayment"]))
        check(cid, "outstanding", [adv - rep * (i + 1) for i in range(n)],
              [fr(x) for x in exp["outstandingAfterEachMonth"]])
        income_with = sum((S for _ in range(n)), Fr(0))  # advance is neither income nor expense
        check(cid, "totalS with advance", income_with, fr(exp["totalS_6months_with_advance"]))
        check(cid, "totalS without advance", n * S, fr(exp["totalS_6months_without_advance"]))
        check(cid, "net advance effect", adv - rep * n, fr(exp["netAdvanceEffectOnIncome"]))

    elif k == "fx":
        check(cid, "pt2 text", "1 აშშ დოლარი – 2.8 ლარი და 1 ევრო – 3.2 ლარი" in " ".join(PAGES[1].split()), True)
        check_money(cid, "illustrativeGEL", fr(inp["S_EUR"]) * fr(inp["forecastGELperEUR"]), exp["illustrativeGEL"])
        check(cid, "usableAsSettlementRate", False, exp["usableAsSettlementRate"])

    elif k == "annual":
        S = fr(inp["S_monthly"])
        check(cid, "simpleScenario12", 12 * S, fr(exp["simpleScenario12"]))
        check(cid, "vacationAmountConditional", S, fr(exp["vacationAmountConditional"]))

    elif k == "data-ke":
        sc = c["sourceCheck"]
        src(cid, "Iran line", window_has(sc["page"], sc["fragment"], sc["tokens"], radius=0))
        check(cid, "K", fr(exp["K"]), Fr("1.89"))

    elif k == "data-ke-spot":
        for r in exp["rows"]:
            src(cid, f"A4 r{r['row']} {r['Kraw']}/{r['E']}",
                window_has(r["page"], r["name"], [str(r["row"]), r["Kraw"], r["E"]], radius=1))
            check(cid, f"A4 r{r['row']} normalize", fr(r["Kraw"].replace(",", ".")), fr(r["K"]))

    elif k == "data-ke-pair":
        src(cid, "Washington", window_has(15, "აშშ ქ. ვაშინგტონი", ["5", "2.185", "28"], 0))
        src(cid, "New York", window_has(15, "აშშ ქ. ნიუ-იორკი", ["6", "2.65", "32"], 0))
        src(cid, "A6 UN mission", window_has(21, "გაერთიანებული ერების ორგანიზაციასთან", ["5"], 0))
        src(cid, "A6 NY consulate", window_has(22, "გენერალური საკონსულო ქ.ნიუ-იორკში", ["28"], 0))

    elif k == "data-institution":
        if cid == "T-DATA-INST-01":
            src(cid, "A5 r2", window_has(19, "საელჩო ბელგიის სამეფოში", ["2"], 0))
            src(cid, "A5 r20", window_has(19, "წარმომადგენლობა ნატოსთან", ["20"], 0))
            src(cid, "A9 r2", row_window_has(30, 2, "1650"))
            src(cid, "A9 r17", window_has(30, "ნატო-ში", ["17", "1650"], 0))
        elif cid == "T-DATA-INST-02":
            src(cid, "A5 r41", window_has(20, "ქ. შტუტგარტში", ["41"], 0))
            src(cid, "A9 r40", window_has(31, "ქ. შტუტგარტში", ["40", "1650"], 1))
            src(cid, "A7 r41 seq", has_sequence(26, ["41", "864", "1025", "1265", "1344", "1504", "1663"]))
        elif cid == "T-DATA-INST-03":
            src(cid, "A5 r7", window_has(19, "ევროპის საბჭოსთან", ["7"], 0))
            src(cid, "A9 r7", window_has(30, "ევროპის საბჭოსთან", ["7", "1950"], 0))
            src(cid, "A7 r6 seq", has_sequence(23, ["6", "864", "1025", "1265", "1344", "1504", "1663"]))
        elif cid == "T-DATA-INST-04":
            src(cid, "A10 r8", row_window_has(32, 8, "2250"))
            src(cid, "A10 r36", window_has(34, "ქ.ნიუ-იორკში", ["36", "2250"], 1))

    elif k == "data-baggage-spot":
        for r in exp["rows"]:
            src(cid, f"A{r['annex']} r{r['row']} {r['cap']}", row_window_has(r["page"], r["row"], r["cap"]))

    elif k == "data-note":
        if cid == "T-INS-DUP-01":
            toks = page_tokens(29)
            seq = exp["bands"]
            hits = sum(1 for i in range(len(toks) - 11) if toks[i:i + 12] == seq)
            check(cid, "Donetsk row printed twice in source", hits, 2)
        elif cid == "T-INS-ANNUAL-01":
            check(cid, "sum", sum((fr(x) for x in inp["caps"]), Fr(0)), fr(exp["sumOfCapsInformational"]))
        elif cid == "T-DATA-H-01":
            whole = " ".join(LAYOUT.read_text(encoding="utf-8").split())
            src(cid, "pt3 3100/3495", "3100 ევროსა და 3495 აშშ დოლარის" in whole)
            src(cid, "Q = 7", "(Q = 7)" in whole)
            src(cid, "690 EUR", "თვეში არაუმეტეს 690 ევრო" in whole)
            src(cid, "750 USD", "თვეში არაუმეტეს 750 აშშ დოლარი" in whole)
            src(cid, "pt33 80%", "ყოველთვიურ ლიმიტს შორის სხვაობის 80%" in whole)
            src(cid, "pt8 80/50", "მომსახურების ხარჯის 80%, ხოლო დანარჩენ მოსამსახურეებს – 50%" in whole)
            src(cid, "pt7 sixty", "სამოცმაგი ოდენობით" in whole)
            src(cid, "pt7 10%", "ოდენობის 10%" in whole)
        # other data-notes are descriptive only

    elif k == "data-count":
        # numbered rows 1..N present as line-leading numbers (values >= 100 ignored)
        import re
        spec = {"annex4Rows": ([15, 16, 17], 69), "a5": ([19, 20], 45), "annex6": ([21, 22], 38),
                "a7": ([23, 24, 25, 26], 45), "a8": ([27, 28, 29], 38), "annex9": ([30, 31], 44),
                "annex10": ([32, 33, 34], 38)}
        for name, (pgs, n) in spec.items():
            s = set()
            for p in pgs:
                for l in PAGES[p - 1].splitlines():
                    m = re.match(r"^\s*(\d+)\.?(\s|$)", l)
                    if m and 0 < int(m.group(1)) < 100:
                        s.add(int(m.group(1)))
            check(cid, f"{name} rows 1..{n}", s, set(range(1, n + 1)))
        removed5 = "(ამოღებულია - 14.09.2021, №01-166)" in " ".join((PAGES[19]).split())
        removed7 = "(ამოღებულია" in PAGES[25]
        src(cid, "A5 row 40 removed", removed5)
        src(cid, "A7 row 40 removed", removed7)
        check(cid, "annex5Active", 45 - 1, exp["annex5Active"])
        check(cid, "annex7Active", 45 - 1, exp["annex7Active"])
        check(cid, "institutionsTotal", (45 - 1) + 38, exp["institutionsTotal"])
        check(cid, "annex4Rows", 69, exp["annex4Rows"])
        check(cid, "annex9", 44, exp["annex9"])
        check(cid, "annex10", 38, exp["annex10"])
        check(cid, "annex8Distinct", 38, exp["annex8Distinct"])

    else:
        failures.append(f"{cid}: unknown kind {k}")


def main() -> int:
    data = json.loads(CASES.read_text(encoding="utf-8"))
    cases = data["cases"]
    ids = [c["id"] for c in cases]
    if len(ids) != len(set(ids)):
        failures.append("duplicate case ids")
    allowed = {"direct-rule", "interpretation", "technical-policy"}
    for c in cases:
        for f in ("id", "kind", "ruleRefs", "description", "expected", "derivation", "status"):
            if f not in c:
                failures.append(f"{c.get('id')}: missing field {f}")
        if c.get("status") not in allowed:
            failures.append(f"{c['id']}: bad status {c.get('status')}")
        try:
            run_case(c)
        except Exception as e:  # noqa: BLE001
            failures.append(f"{c['id']}: exception {type(e).__name__}: {e}")
    print(f"cases: {len(cases)}  checks: {checks}  failures: {len(failures)}")
    for f in failures:
        print("FAIL", f)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
