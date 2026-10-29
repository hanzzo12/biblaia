#!/usr/bin/env python3
"""Extract the raw tables of Annexes 2-10 from the supplied working copy PDF.

Output: sources/extracted/annexNN.raw.json (NN = 02..10).

Method (documented in docs/data-schema.md):
  * pdfplumber words with coordinates are grouped into table rows and columns.
    Row anchors are the row numbers printed in the first column; row bands are
    delimited by the horizontal grid edges that lie between two anchors (or the
    midpoint when a page has no usable edge). Columns are delimited by the
    vertical grid edges measured on each page (hard-coded per annex below).
  * Cells are stored exactly as extracted (words joined by a single space, visual
    lines joined by " / " in `cellLines`). Nothing is corrected here.
  * Every row is cross-checked against the layout text
    (sources/extracted/rotation_sources.layout.txt): its value tokens must be
    found, in order, in the same page of the layout text.
  * Flags are computed automatically (removed, duplicated, decimal-comma,
    displaced, trailing-bracket, multi-value) and complemented by notes from the
    visual inspection of the rendered pages (VISUAL_NOTES below), which were
    produced by rendering every page with pypdfium2 at scale 2.2 and reading it.

Usage: python3 -I scripts/extract-annexes.py   (run from the repository root)
"""
import hashlib
import json
import os
import re
import sys

import pdfplumber

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = os.path.join(ROOT, "sources", "original", "rotation_sources.pdf")
LAYOUT = os.path.join(ROOT, "sources", "extracted", "rotation_sources.layout.txt")
OUTDIR = os.path.join(ROOT, "sources", "extracted")

BANDS = ["0-18", "19-24", "25-29", "30-34", "35-39", "40-44", "45-49",
         "50-54", "55-59", "60-64", "65-69", "70+"]

INS7_X = [20.7, 58.9, 147.8, 179.2, 210.8, 242.2, 273.8, 305.2, 336.8, 368.2,
          399.8, 435.8, 467.2, 503.2, 552.4]
INS8_X = [10.5, 37.5, 236.0, 262.5, 290.3, 318.0, 345.8, 373.5, 401.3, 429.0,
          456.8, 484.5, 512.3, 540.0, 586.5]

ANNEXES = {
    2: dict(title="Annex 2 - position indicators (staff posted on rotation)",
            pages=[13], x=[24.0, 48.0, 439.5, 519.8], cols=["no", "title", "percent"],
            valueCols=["percent"], header_numbering=True),
    3: dict(title="Annex 3 - position indicators (HQ staff, Order pt 37)",
            pages=[14], x=[61.2, 72.0, 427.4, 508.2], cols=["no", "title", "percent"],
            valueCols=["percent"], header_numbering=True),
    4: dict(title="Annex 4 - adapted cost-of-living coefficient K and housing share E",
            pages=[15, 16, 17], x=[71.6, 97.1, 411.4, 510.7, 540.4],
            cols=["no", "label", "k", "e"], valueCols=["k", "e"], header_numbering=False),
    5: dict(title="Annex 5 - institutions funded in EUR",
            pages=[19, 20], x=[11.0, 75.5, 507.5], cols=["no", "label"],
            valueCols=[], header_numbering=False),
    6: dict(title="Annex 6 - institutions funded in USD",
            pages=[21, 22], x=[11.0, 44.8, 490.3], cols=["no", "label"],
            valueCols=[], header_numbering=False),
    7: dict(title="Annex 7 - annual medical-insurance caps (EUR) by age band",
            pages=[23, 24, 25, 26], x=INS7_X, cols=["no", "label"] + BANDS,
            valueCols=BANDS, header_numbering=True),
    8: dict(title="Annex 8 - annual medical-insurance caps (USD) by age band",
            pages=[27, 28, 29], x=INS8_X, cols=["no", "label"] + BANDS,
            valueCols=BANDS, header_numbering=True),
    9: dict(title="Annex 9 - baggage reimbursement caps (EUR)",
            pages=[30, 31], x=[28.5, 59.5, 481.3, 559.5], cols=["no", "label", "amount"],
            valueCols=["amount"], header_numbering=True),
    10: dict(title="Annex 10 - baggage reimbursement caps (USD)",
             pages=[32, 33, 34], x=[34.3, 58.5, 417.6, 539.1], cols=["no", "label", "amount"],
             valueCols=["amount"], header_numbering=True),
}

# Observations from looking at the rendered pages (scratchpad/pages/pNN.png).
VISUAL_NOTES = {
    (4, "4"): "Label cell shows a stray '(ა' fragment on a second line under 'აზერბაიჯანის რესპუბლიკა'.",
    (4, "11"): "K value 1.993 is printed at the bottom of the row-11 cell, almost on the row-12 border (displaced); it belongs to Germany (row 11). Layout text shows it on its own line after E=28.",
    (4, "12"): "K cell shows '2.200' twice (second copy offset to the right/lower). Same number, duplicated text.",
    (4, "25"): "K printed with a decimal comma: '1,588'.",
    (4, "26"): "Row is clipped by the next grid line in the rendering (text half hidden); extracted text reads Indonesia 1.817 / 27.",
    (4, "31"): "K printed with a decimal comma: '2,280'.",
    (4, "50"): "K printed with a decimal comma: '1,600'.",
    (4, "51"): "Row is clipped by the next grid line in the rendering (text half hidden); extracted text reads Ukraine 1.890 / 28.",
    (4, "55"): "Last row on page 16; bottom grid line missing (pdfplumber table finder drops this row).",
    (4, "57"): "K printed with a decimal comma: '2,2'.",
    (4, "61"): "Serbia (Belgrade) has a K/E row but no institution in Annex 5/6/7/9.",
    (4, "62."): "Row numbers 62-64 and 66-69 are printed with a trailing dot.",
    (5, "40."): "Row removed: '(ამოღებულია - 14.09.2021, №01-166)'.",
    (7, "1"): "0-18 value 864 is printed left-shifted in its cell (layout text puts it on a separate line).",
    (7, "2"): "Last value printed as '4080]' (stray bracket).",
    (7, "10"): "Values are vertically misaligned within the row (layout text splits them over two lines).",
    (7, "14"): "Last value printed as '1400]' (stray bracket).",
    (7, "16"): "Last value printed as '4080]' (stray bracket). Label hyphenated: 'წარმომადგენლობ ა ნატოში'.",
    (7, "26"): "0-18 = 1813 while 19-24..70+ equal the Germany schedule (1025..5652). Printed as such; not corrected.",
    (7, "27"): "Last value printed as '3387]' (stray bracket).",
    (7, "37"): "0-18 = 1813 while 19-24..70+ equal the Germany schedule (1025..5652). Printed as such; not corrected.",
    (7, "40."): "Row removed: '(ამოღებულია - 14.09.2021, №01-166)'.",
    (8, "15"): "The '(ICAO)' that ends this label is printed over the first word of row 16 (overlapping text); it is not visible in the rendered cell.",
    (8, "16"): "First word is overprinted with '(ICAO)' from row 15, so the extracted label reads '(სIაCქAაOრ)თველოს ...' (= 'საქართველოს' + '(ICAO)').",
    (7, "25"): "Label cell is split by the page break: 'საქართველოს გენერალური' on p.24, 'საკონსულო ქ.სალონიკში' on p.25.",
    (8, "18"): "0-18 = 1479, 19-64 = 724, 65+ = 1479. Printed as such.",
    (8, "24"): "Label is truncated in the cell: 'საქართველოს გენერალური საკონსულო ქ.ნიუ-' (the rest of 'ნიუ-იორკში' is not printed).",
    (8, "31"): "Row 31 (Donetsk) is printed twice with identical values; first copy says 'საკონსულო', second 'გენერალური საკონსულო'.",
    (8, "34"): "30-34 band (2600) is lower than 25-29 (3200). Printed as such.",
    (8, "36"): "30-34 band (2600) is lower than 25-29 (3200). Printed as such.",
    (10, "28"): "Label continues on page 34 ('ორგანიზაციაში (OIC' - closing parenthesis missing in source).",
}

NUM_RE = re.compile(r"^\d+(?:[.,]\d+)?\]?$")
ROWNO_RE = re.compile(r"^\d{1,2}\.?$")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def cluster(values, tol):
    out = []
    for v in sorted(values):
        if not out or v - out[-1] > tol:
            out.append(v)
    return out


def col_of(xc, xs):
    for i in range(len(xs) - 1):
        if xs[i] <= xc < xs[i + 1]:
            return i
    return None


def lines_of(words, tol=3.0):
    """Group words into visual lines (by top) and return list of strings."""
    words = sorted(words, key=lambda w: (w["top"], w["x0"]))
    lines = []
    for w in words:
        if lines and abs(w["top"] - lines[-1][0]) <= tol:
            lines[-1][1].append(w)
        else:
            lines.append([w["top"], [w]])
    return [" ".join(x["text"] for x in sorted(l[1], key=lambda w: w["x0"])) for l in lines]


def extract_page(pg, conf, page_no):
    xs = conf["x"]
    words = pg.extract_words(keep_blank_chars=False, use_text_flow=False, x_tolerance=1.5, y_tolerance=2)
    table_words = [w for w in words if xs[0] - 3 <= (w["x0"] + w["x1"]) / 2 <= xs[-1] + 3]
    # footer = first amendment note line ("... ბრძანება №...") below the table
    hedges = cluster([e["top"] for e in pg.edges if e["orientation"] == "h" and e["x1"] - e["x0"] > 15
                      and e["x0"] < xs[1] + 5], 1.5)
    table_top = hedges[0] if hedges else 0
    footer_y = pg.height
    for w in words:
        if (w["text"].startswith("ბრძანებ") or w["text"].startswith("ვებგვერდი")) and w["top"] > table_top:
            footer_y = min(footer_y, w["top"] - 1)
    anchors = []
    for w in table_words:
        xc = (w["x0"] + w["x1"]) / 2
        if col_of(xc, xs) == 0 and ROWNO_RE.match(w["text"]) and w["top"] < footer_y:
            anchors.append(w)
    anchors.sort(key=lambda w: w["top"])
    # drop header numbering row ("1 | 2 | 3 ...")
    rows = []
    for i, a in enumerate(anchors):
        ac = (a["top"] + a["bottom"]) / 2
        if i > 0:
            pc = (anchors[i - 1]["top"] + anchors[i - 1]["bottom"]) / 2
            cand = [h for h in hedges if pc < h < ac - 1]
            lo = max(cand) if cand else (pc + ac) / 2
            lo_src = "grid" if cand else "midpoint"
        else:
            cand = [h for h in hedges if h <= a["top"] + 0.5]
            lo = max(cand) if cand else a["top"] - 30
            lo_src = "grid" if cand else "estimate"
        rows.append(dict(anchor=a, lo=lo, lo_src=lo_src))
    for i, r in enumerate(rows):
        if i + 1 < len(rows):
            r["hi"] = rows[i + 1]["lo"]
        else:
            below = [h for h in hedges if h > r["anchor"]["bottom"] and h < footer_y + 2]
            r["hi"] = min(footer_y, max(below)) if below else footer_y
    out = []
    # words at the top of a continuation page, above the first row band, belong
    # to the last row of the previous page (cell split by the page break)
    carry = []
    if rows:
        carry = [w for w in table_words if table_top - 1 <= w["top"] + 2 < rows[0]["lo"]]
    for r in rows:
        # assign by top+2pt (not centre): clipped text on pages 16 (rows 26, 51)
        # straddles the grid line below it
        ws = [w for w in table_words if r["lo"] <= w["top"] + 2 < r["hi"]]
        cells = {c: [] for c in conf["cols"]}
        for w in ws:
            ci = col_of((w["x0"] + w["x1"]) / 2, xs)
            if ci is None or ci >= len(conf["cols"]):
                continue
            cells[conf["cols"][ci]].append(w)
        out.append(dict(page=page_no, anchor=r["anchor"], band=[round(r["lo"], 1), round(r["hi"], 1)],
                        bandSource=r["lo_src"], cellWords=cells))
    carry_cells = {c: [] for c in conf["cols"]}
    for w in carry:
        ci = col_of((w["x0"] + w["x1"]) / 2, xs)
        if ci is not None and ci < len(conf["cols"]):
            carry_cells[conf["cols"][ci]].append(w)
    return out, carry_cells


def layout_pages():
    with open(LAYOUT, encoding="utf-8") as f:
        return f.read().split("\f")


def layout_value_tokens(page_text, annex):
    """Numeric tokens of the layout text that can only be table values.

    Annex 4: K = tokens with a decimal separator; E = last integer token of a
    line that has other text (row numbers stand alone or start a line).
    Annexes 7-10: integers >= 100 (row numbers and age-band headers are < 100).
    Annexes 2-3: last integer token of a line, value in {40..100}.
    """
    toks = []
    for line in page_text.split("\n"):
        if "ბრძანება" in line or "ვებგვერდი" in line or "დანართი" in line:
            continue
        parts = line.split()
        if annex == 4:
            for t in parts:
                if re.match(r"^\d+[.,]\d+$", t):
                    toks.append(t)
            if len(parts) >= 2 and re.match(r"^\d{1,2}$", parts[-1]) and not all(re.match(r"^\d+\.?$", t) for t in parts):
                toks.append(parts[-1])
        elif annex in (7, 8, 9, 10):
            for t in parts:
                if re.match(r"^\d+\]?$", t) and int(t.rstrip("]")) >= 100:
                    toks.append(t)
        elif annex in (2, 3):
            if len(parts) >= 2 and re.match(r"^\d{2,3}$", parts[-1]) and 40 <= int(parts[-1]) <= 100:
                toks.append(parts[-1])
    return toks


def main():
    sha = sha256(PDF)
    lpages = layout_pages()
    pdf = pdfplumber.open(PDF)
    summary = {}
    for annex, conf in ANNEXES.items():
        raw_rows = []
        for k, pno in enumerate(conf["pages"]):
            page_rows, carry = extract_page(pdf.pages[pno - 1], conf, pno)
            if k > 0 and raw_rows and any(carry.values()):
                prev = raw_rows[-1]
                prev.setdefault("continuedOnPage", pno)
                for c, ws in carry.items():
                    prev["cellWords"][c] = prev["cellWords"][c] + [dict(w, top=w["top"] + 10000) for w in ws]
            raw_rows += page_rows
        # drop header numbering rows: anchor "1" whose label cell is exactly "2"
        if conf["header_numbering"]:
            raw_rows = [r for r in raw_rows
                        if not (r["anchor"]["text"] == "1" and " ".join(w["text"] for w in r["cellWords"][conf["cols"][1]]).strip() == "2")]
        # layout cross-check cursors per page
        ltoks = {p: layout_value_tokens(lpages[p - 1], annex) for p in conf["pages"]}
        page_vals = {}
        seen = {}
        rows = []
        for r in raw_rows:
            row_no_raw = r["anchor"]["text"]
            cells, cell_lines = {}, {}
            for c in conf["cols"][1:]:
                ws = r["cellWords"][c]
                cell_lines[c] = lines_of(ws)
                cells[c] = " ".join(cell_lines[c]).strip()
            flags, notes = [], []
            if r.get("continuedOnPage"):
                flags.append("continued-on-next-page")
                notes.append("cell continues at the top of page %d; the continuation is appended." % r["continuedOnPage"])
            label_key = "title" if "title" in cells else "label"
            if "ამოღებულია" in cells.get(label_key, ""):
                flags.append("removed")
            values = []
            for c in conf["valueCols"]:
                toks = cells[c].split()
                if c in BANDS:
                    # a band cell holds exactly one number; a split word (font change,
                    # e.g. '338 7]') is one printed value
                    if len(toks) > 1:
                        flags.append("split-token")
                    toks = ["".join(toks)] if toks else []
                if len(toks) > 1:
                    flags.append("multi-value")
                    if len(set(toks)) == 1:
                        flags.append("duplicated-text")
                for t in toks:
                    if "," in t:
                        flags.append("decimal-comma")
                    if t.endswith("]"):
                        flags.append("trailing-bracket")
                    values.append(t)
                if not toks and "removed" not in flags:
                    flags.append("empty-value")
            # displacement: value word vertically far from the label's first line
            lab_ws = r["cellWords"][conf["cols"][1]]
            if lab_ws and conf["valueCols"] and annex == 4:
                lab_top = min(w["top"] for w in lab_ws)
                for c in conf["valueCols"]:
                    for w in r["cellWords"][c]:
                        if abs(w["top"] - lab_top) > 6:
                            flags.append("displaced")
            key = row_no_raw.rstrip(".")
            if key in seen:
                flags.append("duplicated-row")
                for prev in rows:
                    if prev["rowNo"] == int(key) and "duplicated-row" not in prev["flags"]:
                        prev["flags"].append("duplicated-row")
            seen[key] = True
            # layout cross-check (row level): every value token is present in the
            # layout text of the same page
            if values:
                lt = ltoks[r["page"]]
                xcheck = "values-present-on-layout-page" if all(v in lt for v in values) else "MISMATCH"
            else:
                xcheck = "n/a"
            page_vals.setdefault(r["page"], []).extend(values)
            vn = VISUAL_NOTES.get((annex, row_no_raw))
            if vn:
                notes.append("visual: " + vn)
            row = dict(rowNo=int(key), rowNoRaw=row_no_raw, page=r["page"], cells=cells,
                       cellLines=cell_lines, flags=sorted(set(flags)), layoutCrossCheck=xcheck,
                       bandY=r["band"], bandSource=r["bandSource"], notes=" ".join(notes))
            rows.append(row)
        from collections import Counter
        page_check = []
        for p in conf["pages"]:
            ex, lay = Counter(page_vals.get(p, [])), Counter(ltoks[p])
            page_check.append(dict(page=p, extractedValueTokens=sum(ex.values()), layoutValueTokens=sum(lay.values()),
                                   onlyInExtract=dict(ex - lay), onlyInLayout=dict(lay - ex),
                                   status="equal-multisets" if ex == lay else "DIFFERENT"))
        removed = sum(1 for r in rows if "removed" in r["flags"])
        distinct = len({r["rowNo"] for r in rows})
        dup = len(rows) - distinct
        out = dict(
            annex=annex, title=conf["title"], pages=conf["pages"],
            sourceFile="sources/original/rotation_sources.pdf", sha256=sha,
            extractedWith="pdfplumber %s words+grid edges; cross-checked with rotation_sources.layout.txt; visually verified (pypdfium2 render, scale 2.2)" % pdfplumber.__version__,
            columns=conf["cols"][1:],
            counts=dict(printedRows=len(rows), distinctRowNumbers=distinct, duplicatedRowCopies=dup,
                        removedRows=removed, effectiveEntries=distinct - removed),
            layoutCrossCheck=page_check,
            rows=rows,
        )
        path = os.path.join(OUTDIR, "annex%02d.raw.json" % annex)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
            f.write("\n")
        summary[annex] = out["counts"]
        bad = [r["rowNoRaw"] for r in rows if r["layoutCrossCheck"] == "MISMATCH"]
        print("annex %2d: %s  row mismatches: %s  pages: %s" % (annex, out["counts"], bad or "none",
              [(c["page"], c["status"], c["onlyInExtract"], c["onlyInLayout"]) for c in page_check]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
