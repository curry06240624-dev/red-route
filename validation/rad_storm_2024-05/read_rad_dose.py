#!/usr/bin/env python3
# AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md.
"""
read_rad_dose.py  -  pull Curiosity RAD total dose rates (detector B = silicon,
detector E = plastic scintillator, the tissue-like one) for 16-23 May 2024
straight from NASA's public archive, WITHOUT downloading the big data files.

Source archive (NASA PDS, Planetary Plasma Interactions node, UCLA):
  https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/DATA/SOL_04134_04257/
  (data set MSL-M-RAD-3-RDR-V1.0, release 37, sols 4134-4257)

Each sol has one .TXT data file (65-91 MB) and one PDS3 label .LBL (1.1-1.7 MB).
The label gives the byte position of every object in the .TXT file, including
  OBSnnn_TOT_DOSE_B_ELEMENT  (unit "microGray / Hour")
  OBSnnn_TOT_DOSE_E_ELEMENT  (unit "microGray / Hour")
This script downloads only the labels, then asks the server for just those few
bytes (HTTP multi-range request), plus ~1.5 kB in front of each observation's
first object, where the observation header sits:
  [OBSERVATION: nn]  START_OBS_UTC="2024-141 05:40:23"  OBS_DURATION=961
PDS3 <BYTES> pointers are 1-based, so byte N is index N-1 here.

Usage (run with -I; labels go to a separate cache folder):
  python -I read_rad_dose.py fetch   --cache <label dir> --out rad_dose_2024-05-16_to_23.csv
  python -I read_rad_dose.py analyze --csv rad_dose_2024-05-16_to_23.csv
"""
import argparse
import csv
import datetime as dt
import os
import re
import sys
import urllib.request

BASE = "https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/DATA/SOL_04134_04257/"
FILES = {  # sol -> product id (file names listed on the PDS PPI page)
    4187: "RAD_RDR_2024_137_16_39_4187_V00",
    4188: "RAD_RDR_2024_138_17_05_4188_V00",
    4189: "RAD_RDR_2024_139_17_46_4189_V00",
    4190: "RAD_RDR_2024_140_18_30_4190_V00",
    4191: "RAD_RDR_2024_141_19_08_4191_V00",
    4192: "RAD_RDR_2024_142_19_51_4192_V00",
    4193: "RAD_RDR_2024_143_20_35_4193_V00",
}
UA = {"User-Agent": "rad-dose-reader/1.0 (research script)"}
PTR = re.compile(r'\^OBS(\d+)_(\w+?)\s*=\s*\(\s*"([^"]+)"\s*,\s*(\d+)\s*<BYTES>\s*\)')
HEADER_WINDOW = 1500


def http_get(url, rng=None):
    hdr = dict(UA)
    if rng:
        hdr["Range"] = rng
    req = urllib.request.Request(url, headers=hdr)
    r = urllib.request.urlopen(req, timeout=180)
    if rng and r.status != 206:
        r.close()
        raise RuntimeError("server ignored the Range header; not downloading the whole file")
    return r.status, r.headers, r.read()


def get_label(sol, cache):
    name = FILES[sol] + ".LBL"
    path = os.path.join(cache, name)
    if not os.path.exists(path):
        _, _, data = http_get(BASE + name)
        with open(path, "wb") as f:
            f.write(data)
    with open(path, "rb") as f:
        return f.read().decode("ascii", "replace")


def parse_label(text):
    obs = {}
    for m in PTR.finditer(text):
        n, kind, off = int(m.group(1)), m.group(2), int(m.group(4))
        o = obs.setdefault(n, {"first": off, "B": None, "E": None})
        o["first"] = min(o["first"], off)
        if kind == "TOT_DOSE_B_ELEMENT":
            o["B"] = off
        elif kind == "TOT_DOSE_E_ELEMENT":
            o["E"] = off
    return obs


def fetch_ranges(url, ranges):
    """ranges: list of (a, b) zero-based inclusive. Returns {(a, b): bytes}."""
    out = {}
    ranges = sorted(set(ranges))
    for i in range(0, len(ranges), 80):
        chunk = ranges[i:i + 80]
        spec = "bytes=" + ",".join("%d-%d" % ab for ab in chunk)
        _, headers, data = http_get(url, spec)
        ctype = headers.get("Content-Type", "")
        if "multipart/byteranges" in ctype:
            for m in re.finditer(rb"Content-range: bytes (\d+)-(\d+)/\d+\r?\n\r?\n", data, re.I):
                a, b = int(m.group(1)), int(m.group(2))
                out[(a, b)] = data[m.end():m.end() + (b - a + 1)]
        else:
            m = re.search(r"bytes (\d+)-(\d+)/", headers.get("Content-Range", ""))
            out[(int(m.group(1)), int(m.group(2)))] = data
    return out


def num_at(text, pos):
    m = re.match(r"\s*([-+0-9.eE]+)", text[pos:])
    return float(m.group(1)) if m else None


def cmd_fetch(args):
    os.makedirs(args.cache, exist_ok=True)
    rows = []
    total_bytes = 0
    for sol in sorted(FILES):
        lbl = get_label(sol, args.cache)
        obs = parse_label(lbl)
        url = BASE + FILES[sol] + ".TXT"
        want = {}
        for n, o in obs.items():
            if o["B"] is None or o["E"] is None:
                continue
            f0 = o["first"] - 1
            hdr = (max(0, f0 - HEADER_WINDOW), f0 - 1)
            dose = (o["B"] - 1, o["E"] - 1 + 14)
            want[n] = (hdr, dose)
        got = fetch_ranges(url, [r for pair in want.values() for r in pair])
        total_bytes += sum(len(v) for v in got.values())
        for n, (hdr, dose) in sorted(want.items()):
            htxt = got[hdr].decode("ascii", "replace")
            dtxt = got[dose].decode("ascii", "replace")
            blocks = re.findall(r"\[OBSERVATION: (\d+)\](.*?)(?=\n\[|\Z)", htxt, re.S)
            blk = [b for (k, b) in blocks if int(k) == n]
            if not blk:
                print("sol %d obs %d: header not found" % (sol, n), file=sys.stderr)
                continue
            b = blk[-1]
            t = re.search(r'START_OBS_UTC="(\d{4})-(\d{3}) (\d\d):(\d\d):(\d\d)"', b)
            dur = re.search(r"OBS_DURATION=(\d+)", b)
            start = dt.datetime(int(t.group(1)), 1, 1) + dt.timedelta(
                days=int(t.group(2)) - 1, hours=int(t.group(3)),
                minutes=int(t.group(4)), seconds=int(t.group(5)))
            if "DOSIMETRY_TOTAL_DOSE_E" not in dtxt:
                print("sol %d obs %d: dose E marker missing" % (sol, n), file=sys.stderr)
                continue
            vb = num_at(dtxt, 0)
            ve = num_at(dtxt, o_E_rel(obs[n]))
            d = int(dur.group(1)) if dur else None
            mid = start + dt.timedelta(seconds=(d or 0) / 2)
            rows.append([sol, n, start.strftime("%Y-%m-%dT%H:%M:%SZ"), d,
                         mid.strftime("%Y-%m-%dT%H:%M:%SZ"), vb, ve])
    rows.sort(key=lambda r: r[2])
    with open(args.out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["sol", "obs", "start_utc", "obs_duration_s", "mid_utc",
                    "dose_rate_B_silicon_uGy_per_h", "dose_rate_E_plastic_uGy_per_h"])
        w.writerows(rows)
    print("wrote %d rows to %s; fetched %d bytes of .TXT data in byte ranges"
          % (len(rows), args.out, total_bytes))


def o_E_rel(o):
    return o["E"] - o["B"]


def load(csv_path):
    out = []
    with open(csv_path) as f:
        for r in csv.DictReader(f):
            out.append({
                "start": dt.datetime.strptime(r["start_utc"], "%Y-%m-%dT%H:%M:%SZ"),
                "dur": int(r["obs_duration_s"]),
                "B": float(r["dose_rate_B_silicon_uGy_per_h"]),
                "E": float(r["dose_rate_E_plastic_uGy_per_h"]),
            })
    return out


def fmt(t):
    return t.strftime("%d %b %H:%M:%S")


def integrate(rows, key, t0, t1, minus=0.0):
    """Dose in microgray between t0 and t1. Each reading's rate is held from
    its start until the next reading's start (gaps of ~1 min are bridged; a
    gap longer than 2x the reading's own duration is NOT bridged)."""
    tot = 0.0
    for i, r in enumerate(rows):
        a = r["start"]
        nxt = rows[i + 1]["start"] if i + 1 < len(rows) else a + dt.timedelta(seconds=r["dur"])
        if (nxt - a).total_seconds() > 2 * max(r["dur"], 1):
            nxt = a + dt.timedelta(seconds=r["dur"])
        lo, hi = max(a, t0), min(nxt, t1)
        if hi > lo:
            tot += (r[key] - minus) * (hi - lo).total_seconds() / 3600.0
    return tot


def cmd_analyze(args):
    rows = load(args.csv)
    first_rise = None
    # quiet level = median of the 24 h before the first reading above 1.25x
    # a provisional baseline (median of all readings before 20 May 05:00)
    pre = [r for r in rows if r["start"] < dt.datetime(2024, 5, 20, 5, 0)]
    med = lambda xs: sorted(xs)[len(xs) // 2] if len(xs) % 2 else sum(sorted(xs)[len(xs) // 2 - 1:len(xs) // 2 + 1]) / 2
    for key in ("B", "E"):
        prov = med([r[key] for r in pre])
        for i, r in enumerate(rows):
            if r[key] > 1.25 * prov and rows[i + 1][key] > 1.25 * prov and r["start"] > dt.datetime(2024, 5, 20):
                first_rise = r["start"] if first_rise is None else min(first_rise, r["start"])
                break
    q0 = first_rise - dt.timedelta(hours=24)
    quiet_rows = [r for r in rows if q0 <= r["start"] < first_rise]
    print("QUIET window: %s to %s UTC, %d readings" % (fmt(q0), fmt(first_rise), len(quiet_rows)))
    out = {}
    for key, name in (("B", "B (silicon)"), ("E", "E (plastic, tissue-like)")):
        xs = [r[key] for r in quiet_rows]
        quiet = med(xs)
        mean = sum(xs) / len(xs)
        print("\n=== Detector %s ===" % name)
        print("quiet: median %.2f uGy/h (mean %.2f, min %.2f, max %.2f) = %.0f uGy/day"
              % (quiet, mean, min(xs), max(xs), quiet * 24))
        pk = max(rows, key=lambda r: r[key])
        pk_end = pk["start"] + dt.timedelta(seconds=pk["dur"])
        pk_mid = pk["start"] + dt.timedelta(seconds=pk["dur"] / 2)
        print("peak reading: %.1f uGy/h = %.0fx quiet, interval %s-%s UTC (%d s)"
              % (pk[key], pk[key] / quiet, fmt(pk["start"]), pk_end.strftime("%H:%M:%S"), pk["dur"]))
        for k in (1.25, 1.5, 2.0):
            pre_hits = sum(1 for r in rows if r["start"] < first_rise and r[key] > k * quiet)
            npre = sum(1 for r in rows if r["start"] < first_rise)
            c = next(r for r in rows if r["start"] >= first_rise - dt.timedelta(hours=1) and r[key] > k * quiet)
            c_end = c["start"] + dt.timedelta(seconds=c["dur"])
            m = lambda a, b: (b - a).total_seconds() / 60
            print("  %.2fx (%.2f uGy/h): first reading above = %s-%s (%.2f uGy/h); "
                  "minutes to peak: start->start %.1f, end of alarm reading->start of peak reading %.1f, "
                  "end->mid of peak %.1f, end->end %.1f; readings above this level in the %d readings before onset: %d"
                  % (k, k * quiet, fmt(c["start"]), c_end.strftime("%H:%M:%S"), c[key],
                     m(c["start"], pk["start"]), m(c_end, pk["start"]), m(c_end, pk_mid), m(c_end, pk_end), npre, pre_hits))
        # how long it stayed high
        for k in (2.0, 1.25):
            above = [r for r in rows if r["start"] >= first_rise and r[key] > k * quiet]
            # last time it was above k*quiet before first sustained drop (3 readings in a row below)
            last = None
            run = 0
            for r in rows:
                if r["start"] < first_rise:
                    continue
                if r[key] > k * quiet:
                    last, run = r, 0
                else:
                    run += 1
                    if run >= 3 and last is not None:
                        break
            if last is not None:
                end = last["start"] + dt.timedelta(seconds=last["dur"])
                print("  stayed above %.2fx quiet until %s UTC (%.1f h after first rise; data end %s)"
                      % (k, fmt(end), (end - first_rise).total_seconds() / 3600, fmt(rows[-1]["start"])))
        t_end = rows[-1]["start"] + dt.timedelta(seconds=rows[-1]["dur"])
        for label, t1 in (("first rise -> +24 h", first_rise + dt.timedelta(hours=24)),
                          ("first rise -> +48 h", first_rise + dt.timedelta(hours=48)),
                          ("first rise -> end of data", t_end)):
            tot = integrate(rows, key, first_rise, t1)
            extra = integrate(rows, key, first_rise, t1, minus=quiet)
            print("  dose %s (%s): total %.0f uGy, above quiet %.0f uGy" % (label, fmt(t1), tot, extra))
        # worst 42-minute walk, and a walk that starts when each alarm fires
        best = (0, None)
        t = first_rise - dt.timedelta(hours=1)
        while t < first_rise + dt.timedelta(hours=12):
            d = integrate(rows, key, t, t + dt.timedelta(minutes=42))
            if d > best[0]:
                best = (d, t)
            t += dt.timedelta(minutes=1)
        print("  worst 42 min: %.0f uGy, from %s UTC (quiet 42 min = %.1f uGy)"
              % (best[0], fmt(best[1]), quiet * 42 / 60))
        for k in (1.25, 1.5, 2.0):
            c = next(r for r in rows if r["start"] >= first_rise - dt.timedelta(hours=1) and r[key] > k * quiet)
            c_end = c["start"] + dt.timedelta(seconds=c["dur"])
            d = integrate(rows, key, c_end, c_end + dt.timedelta(minutes=42))
            print("  42-min walk starting when the %.2fx reading ends (%s): %.0f uGy" % (k, fmt(c_end), d))
        best60 = max(integrate(rows, key, first_rise + dt.timedelta(minutes=j), first_rise + dt.timedelta(minutes=j + 60))
                     for j in range(0, 600))
        print("  highest 60-min mean rate: %.1f uGy/h (x24 = %.0f uGy/day)" % (best60, best60 * 24))
        print("  peak reading x24 = %.0f uGy/day" % (pk[key] * 24))
    # table
    print("\nTABLE (start UTC, length s, B uGy/h, E uGy/h)")
    marks = []
    for r in rows:
        if dt.datetime(2024, 5, 20, 4, 0) <= r["start"] < dt.datetime(2024, 5, 20, 8, 0):
            marks.append(r)
    t = dt.datetime(2024, 5, 18, 0, 0)
    while t <= dt.datetime(2024, 5, 23, 0, 0):
        if not (dt.datetime(2024, 5, 20, 4, 0) <= t < dt.datetime(2024, 5, 20, 8, 0)):
            step = 1 if dt.datetime(2024, 5, 20, 8) <= t < dt.datetime(2024, 5, 20, 12) else (3 if t < dt.datetime(2024, 5, 21, 12) and t >= dt.datetime(2024, 5, 20) else 6)
            if (t.hour % step) == 0:
                r = min(rows, key=lambda r: abs((r["start"] - t).total_seconds()))
                if r not in marks:
                    marks.append(r)
        t += dt.timedelta(hours=1)
    for r in sorted(marks, key=lambda r: r["start"]):
        print("| %s | %d | %.2f | %.2f |" % (r["start"].strftime("%d May %H:%M:%S"), r["dur"], r["B"], r["E"]))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch")
    f.add_argument("--cache", required=True)
    f.add_argument("--out", required=True)
    a = sub.add_parser("analyze")
    a.add_argument("--csv", required=True)
    args = ap.parse_args()
    if args.cmd == "fetch":
        cmd_fetch(args)
    else:
        cmd_analyze(args)
