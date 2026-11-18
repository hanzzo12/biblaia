#!/usr/bin/env python3
"""Extract the new Annexes №2 and №3 of Order №01-407 (2026-11-17, in force 2027-01-01) from the
user-supplied DOCX files into raw JSON (rows exactly as printed).

Input : sources/original/order-01-407-annex2.docx, sources/original/order-01-407-annex3.docx
Output: sources/extracted/order-01-407-annex2.raw.json, sources/extracted/order-01-407-annex3.raw.json
(Annex №4 is sources/extracted/order-01-407-annex4.raw.json — only the "დანართი N4" sheet of the
user's workbook; the workbook's other sheet holds personal data and is never read here.)

Usage: python3 -I scripts/extract-order-01-407.py   (from the repository root)
"""
import hashlib
import json
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def cell_text(xml):
    return re.sub(r"\s+", " ", "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", xml))).strip()


def extract(n):
    src = os.path.join(ROOT, "sources", "original", f"order-01-407-annex{n}.docx")
    doc = zipfile.ZipFile(src).read("word/document.xml").decode("utf-8")
    rows = []
    for tr in re.findall(r"<w:tr[ >].*?</w:tr>", doc, re.S):
        cells = [cell_text(c) for c in re.findall(r"<w:tc>.*?</w:tc>", tr, re.S)]
        if len(cells) != 3 or not re.fullmatch(r"\d+", cells[0]) or cells[1] == "2":
            continue  # header and column-numbering rows
        rows.append({"rowNo": int(cells[0]), "cells": {"title": cells[1], "percent": cells[2]}, "flags": [], "page": None})
    heading = [p for p in (cell_text(x) for x in re.findall(r"<w:p[ >].*?</w:p>", doc, re.S)) if p][:2]
    out = {"annex": n, "order": "№01-407 of 2026-11-17 (in force 2027-01-01)",
           "sourceFile": os.path.relpath(src, ROOT), "sha256": hashlib.sha256(open(src, "rb").read()).hexdigest(),
           "heading": heading, "extractedWith": "zipfile + word/document.xml table cells (w:tr/w:tc/w:t)",
           "counts": {"printedRows": len(rows), "distinctRowNumbers": len({r["rowNo"] for r in rows}), "removedRows": 0,
                      "effectiveEntries": len({r["rowNo"] for r in rows})},
           "rows": rows}
    dst = os.path.join(ROOT, "sources", "extracted", f"order-01-407-annex{n}.raw.json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"annex {n}: {len(rows)} rows → {os.path.relpath(dst, ROOT)}")


if __name__ == "__main__":
    for n in (2, 3):
        extract(n)
    sys.exit(0)
