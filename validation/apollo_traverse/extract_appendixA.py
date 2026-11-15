# AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md.
# Source report: NASA/TP-2017-219457, https://ntrs.nasa.gov/citations/20170007261 (download the PDF from that page). Needs: pip install pdfplumber
"""Pull the Appendix A planned-vs-performed rows (Tables A32-A53) out of NASA/TP-2017-219457
with pdfplumber. The tables have horizontal rules only, so the column edges are taken from the
dark "Source" header band (one filled rectangle per column) on the first page of each table,
and reused on that table's continuation pages. Rows drawn with a grey fill (rows the report
could not compare) are flagged.
Usage: py -3.12 -I extract_appendixA.py <in.pdf> <out.csv>
"""
import csv
import re
import sys
import pdfplumber

src, dst = sys.argv[1], sys.argv[2]


def is_grey(color):
    if color is None:
        return False
    if isinstance(color, (int, float)):
        color = (color,)
    color = tuple(color)
    if len(color) == 1:
        return 0.5 < color[0] < 0.95
    if len(color) == 3:
        return max(color) - min(color) < 0.05 and 0.5 < color[0] < 0.95
    return False


def header_edges(page):
    """Column edges from the header words (each header word starts 6 pt right of its column
    edge, checked against the filled header-band rectangles on PDF page 89), plus the right
    end of the table rules."""
    words = page.extract_words()
    src_w = [w for w in words if w["text"] == "Source"]
    if not src_w:
        return None
    top = src_w[0]["top"]
    hdr = [w for w in words if top < w["top"] < top + 30]
    def xs(text):
        return sorted(w["x0"] for w in hdr if w["text"] == text)
    durs, starts = xs("Dur"), xs("Start")
    names = sorted(w["x0"] for w in hdr if w["text"] in ("CDR", "LMP"))
    task = xs("Task")
    if len(durs) != 2 or len(starts) != 2 or len(names) != 2 or len(task) != 1:
        return None
    right = max(l["x1"] for l in page.lines)
    edges = [108.0, durs[0] - 6, starts[0] - 6, names[0] - 6, durs[1] - 6, starts[1] - 6,
             names[1] - 6, task[0] - 6, right]
    # cross-check against the filled header-band rectangles where they exist
    band = sorted({round(r["x0"], 1) for r in page.rects if r["top"] - 3 <= top <= r["bottom"] + 3})
    for b in band:
        if min(abs(b - e) for e in edges) > 1.0:
            print(f"NOTE header band edge {b} not matched by word edges {[round(e, 1) for e in edges]}")
    return [round(e, 1) for e in edges]


rows_out = []
table, edges = None, None
warnings = []
with pdfplumber.open(src) as pdf:
    for pno in range(89, 128):  # PDF pages 89..127 hold Appendix A
        page = pdf.pages[pno - 1]
        text = (page.extract_text() or "").replace("T able", "Table")
        m = re.findall(r"Table A(\d+)", text)
        if m:
            table = "A" + m[0]
            e = header_edges(page)
            if e:
                edges = e
        if edges is None or len(edges) != 9:
            warnings.append(f"page {pno}: bad edges {edges}")
            continue
        right = max((l["x1"] for l in page.lines), default=None)
        if right is not None and abs(right - edges[-1]) > 1.5:
            warnings.append(f"page {pno} ({table}): line right edge {right:.1f} vs header {edges[-1]:.1f}")
        settings = {
            "vertical_strategy": "explicit",
            "explicit_vertical_lines": edges,
            "horizontal_strategy": "lines",
            "intersection_tolerance": 5,
            "snap_tolerance": 3,
        }
        grey_rects = [r for r in page.rects if r.get("fill") and is_grey(r.get("non_stroking_color"))]
        for t in page.find_tables(settings):
            data = t.extract()
            for row_obj, r in zip(t.rows, data):
                cells = [(c or "").replace("\n", " ").strip() for c in r]
                if len(cells) != 8:
                    continue
                x0, top, x1, bottom = row_obj.bbox
                mid = (top + bottom) / 2
                grey = any(g["top"] <= mid <= g["bottom"] and g["x0"] < edges[2] for g in grey_rects)
                rows_out.append([pno, table, int(grey)] + cells)
with open(dst, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["pdf_page", "table", "grey", "mins_behind", "plan_dur", "plan_start", "plan_task",
                "perf_dur", "perf_start", "perf_task", "task_type"])
    w.writerows(rows_out)
print(len(rows_out), "rows ->", dst)
for wmsg in warnings:
    print("WARN", wmsg)
