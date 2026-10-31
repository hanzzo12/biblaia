#!/usr/bin/env python3
"""Extract Annex №1 ("სადღეღამისო ნორმები") of Government Decree №211 (2017-04-25).

Input : sources/original/decree211-matsne-3649787-28.pdf (matsne doc 3649787, consolidated preview)
        sources/extracted/decree211.layout.txt (cross-check)
Output: sources/extracted/decree211-annex1.raw.json

Method: pdfplumber words grouped into cells by the table grid (vertical lines = columns,
horizontal lines = row borders). The text band above a page's first grid line and below its
last one belongs to a row split by the page break; such parts are joined. pdfplumber's
extract_tables() is NOT used: it drops the 8 rows that are split by page breaks
(Bangladesh, Grenada, Iran, Lesotho, Monaco, Samoa, Togo, Haiti).
Values are stored exactly as printed (strings). No normalisation here.

Usage: python3 -I scripts/extract-decree211.py   (from the repository root)
"""
import hashlib
import json
import os
import re
import sys

import pdfplumber

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = os.path.join(ROOT, "sources", "original", "decree211-matsne-3649787-28.pdf")
LAYOUT = os.path.join(ROOT, "sources", "extracted", "decree211.layout.txt")
OUT = os.path.join(ROOT, "sources", "extracted", "decree211-annex1.raw.json")
PAGES = range(8, 17)
COLS = [18.9, 156.9, 241.6, 319.6, 421.6, 498.9]
NAMES = ["country", "currency", "c3_shortTrip", "c4_staffInHostState", "c5_accommodation"]
NUM = re.compile(r"^\d+(?:[.,]\d+)?$")


def cluster(vals, tol):
    out = []
    for v in sorted(vals):
        if not out or v - out[-1] > tol:
            out.append(v)
    return out


def col_of(xc):
    for i in range(len(COLS) - 1):
        if COLS[i] - 2 <= xc < COLS[i + 1] + 2:
            return i
    return None


def join_lines(ws):
    ws = sorted(ws, key=lambda w: (round(w["top"]), w["x0"]))
    lines = []
    for w in ws:
        if lines and abs(w["top"] - lines[-1][0]) <= 3:
            lines[-1][1].append(w)
        else:
            lines.append([w["top"], [w]])
    return [" ".join(x["text"] for x in sorted(l[1], key=lambda w: w["x0"])) for l in lines]


def main():
    sha = hashlib.sha256(open(PDF, "rb").read()).hexdigest()
    pdf = pdfplumber.open(PDF)
    rows, carry = [], None
    header_done = False
    for pno in PAGES:
        pg = pdf.pages[pno - 1]
        words = pg.extract_words(x_tolerance=1.5, y_tolerance=2)
        footer = min([w["top"] for w in words if "matsne" in w["text"]] + [pg.height])
        bottom = footer - 1
        if pno == 16:  # Annex 2 starts below the end of Annex 1 on this page
            tops = [w["top"] for w in words if w["text"].startswith("დანართი")]
            ann2 = [w["top"] for w in words if w["text"] == "თანამდებობის"]
            bottom = min([bottom] + tops + ann2) - 1
        hs = cluster([e["top"] for e in pg.edges if e["orientation"] == "h" and e["x1"] - e["x0"] > 30 and e["top"] < bottom], 2)
        bounds = [0.0] + hs + [bottom]
        for bi in range(len(bounds) - 1):
            lo, hi = bounds[bi], bounds[bi + 1]
            ws = [w for w in words if lo <= w["top"] + 2 < hi and w["top"] < bottom]
            cells = {k: [] for k in NAMES}
            for w in ws:
                c = col_of((w["x0"] + w["x1"]) / 2)
                if c is not None:
                    cells[NAMES[c]].append(w)
            text = {k: " ".join(join_lines(v)) for k, v in cells.items()}
            if not any(text.values()):
                continue
            if not header_done:
                if text["country"] == "1" and text["currency"] == "2":
                    header_done = True
                continue
            has_num = bool(text["c3_shortTrip"])
            if not has_num:
                # continuation of a row split by the page break (name / currency words only)
                if rows and (bi == 0 or bi == len(bounds) - 2):
                    prev = rows[-1]
                    for k in ("country", "currency"):
                        if text[k]:
                            prev["cells"][k] = (prev["cells"][k] + " " + text[k]).strip()
                    prev["flags"].append("split-by-page-break")
                    prev["pages"] = sorted(set(prev["pages"] + [pno]))
                    continue
                raise SystemExit(f"unexpected text-only band on page {pno}: {text}")
            rows.append({"row": len(rows) + 1, "page": pno, "pages": [pno], "cells": text, "flags": [],
                         "bandY": [round(lo, 1), round(hi, 1)]})
    # duplicates / anomalies
    seen = {}
    for r in rows:
        n = r["cells"]["country"]
        if n in seen:
            r["flags"].append("duplicate-country-name")
            rows[seen[n] - 1]["flags"].append("duplicate-country-name")
        seen[n] = r["row"]
        for k in NAMES[2:]:
            if not NUM.match(r["cells"][k] or ""):
                r["flags"].append(f"non-numeric-{k}")
        if not r["cells"]["currency"]:
            r["flags"].append("empty-currency")
    # cross-check with the layout text: every numeric triple appears, in order
    lay = open(LAYOUT, encoding="utf-8").read()
    start = lay.index("სადღეღამისო ნორმები")
    end = lay.index("დანართი №2", start)
    toks = [t for t in re.findall(r"\S+", lay[start:end]) if NUM.match(t)]
    pos, mism = 0, []
    for r in rows:
        trip = [r["cells"][k] for k in NAMES[2:]]
        ok = False
        for i in range(pos, len(toks) - 2):
            if toks[i:i + 3] == trip:
                pos, ok = i + 3, True
                break
        r["layoutCrossCheck"] = "match-in-order" if ok else "MISMATCH"
        if not ok:
            mism.append(r["row"])
    # amendment citations printed on the annex pages
    cites = sorted(set(re.findall(r"საქართველოს მთავრობის (\d{4}) წლის ([^№]+?) დადგენილება №\s*(\d+)\s*–\s*ვებგვერდი,\s*([\d.]+)", lay[lay.index("დანართი №1"):end])))
    out = {
        "source": "Government of Georgia Decree №211 of 2017-04-25, Annex №1 (სადღეღამისო ნორმები)",
        "file": "sources/original/decree211-matsne-3649787-28.pdf", "sha256": sha,
        "edition": {"matsneDocumentId": "3649787", "consolidationLabel": "28 (from the file name)",
                    "pdfCreationDate": "2026-07-16 (PDF metadata, PD4ML 'Preview')",
                    "effectiveDate": None,
                    "note": "Consolidated preview downloaded from matsne by the user; the effective date of the printed text is not stated and is not inferred."},
        "amendmentCitationsOnAnnex": [{"year": c[0], "date_ka": c[1].strip(), "number": c[2], "published": c[3]} for c in cites],
        "columns": {"country": "1 ქვეყნის დასახელება", "currency": "2 უცხოური ვალუტის დასახელება",
                    "c3_shortTrip": "3 მოკლევადიანი მივლინებისას",
                    "c4_staffInHostState": "4 საზღვარგარეთ საქ. დაწესებულების მოსამსახურეთათვის მოკლევადიანი მივლინებისას იმ სახელმწიფოს შიგნით, სადაც მდებარეობს ეს დაწესებულება",
                    "c5_accommodation": "5 საცხოვრებელი ფართობის დაქირავების ხარჯების ანაზღაურების სადღეღამისო ნორმა"},
        "extractedWith": f"pdfplumber {pdfplumber.__version__}: words + grid lines; page-break rows joined; cross-checked with decree211.layout.txt; pages rendered (pypdfium2) and inspected",
        "counts": {"rows": len(rows), "layoutMismatches": len(mism)},
        "rows": rows,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"rows {len(rows)}; layout mismatches {mism or 'none'}; citations {out['amendmentCitationsOnAnnex']}")
    print("flags:", [(r["row"], r["cells"]["country"], r["flags"]) for r in rows if r["flags"]])
    return 0


if __name__ == "__main__":
    sys.exit(main())
