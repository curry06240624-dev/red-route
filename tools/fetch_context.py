"""Fetch the context data Red Route shows next to the map.

AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md.

- Perseverance raw images from the sols the rover spent at each stop (NASA/JPL-Caltech raw image API)
- Perseverance MEDA weather summaries (NASA/JPL-Caltech weather feed)
- Space-weather notifications from NASA's DONKI service (CCMC web service; api.nasa.gov as a second try)
- A simplified Perseverance traverse line (NASA/JPL-Caltech MMGIS)

Run after build_layers.py:  py -3.12 tools/fetch_context.py
Space weather only:          py -3.12 tools/fetch_context.py donki
"""
import io
import json
import os
import sys
import urllib.request
from datetime import date, timedelta

from PIL import Image, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw")
OUT = os.path.join(ROOT, "docs", "data")
UA = {"User-Agent": "red-route-hackathon/1.0"}
# Left eyes only: the right Mastcam-Z / Navcam frames are near copies of the left ones.
CAMERAS = ("MCZ_LEFT", "NAVCAM_LEFT", "FRONT_HAZCAM_LEFT_A", "SUPERCAM_RMI", "REAR_HAZCAM_LEFT", "SHERLOC_WATSON")
PHOTOS_PER_STOP = 16


def useful(data):
    """Skip dark frames (sun pointing, night) and flat frames (sky, calibration); return a 16x16 hash for duplicates."""
    im = Image.open(io.BytesIO(data)).convert("L")
    st = ImageStat.Stat(im)
    px = list(im.resize((16, 16), Image.BILINEAR).tobytes())
    avg = sum(px) / len(px)
    return st.mean[0] >= 50 and st.stddev[0] >= 20, tuple(p > avg for p in px)


def near_copy(bits, kept):
    return any(sum(a != b for a, b in zip(bits, k)) < 26 for k in kept)   # under ~10 % of the hash differs

# What Perseverance did at each stop, written from NASA/JPL sources (checked 2026-11-14).
NOTES = {
    "base": dict(text="Perseverance stopped here on sol 715, after climbing back onto the delta through Jenkins Gap "
                      "(it left Jenkins Gap on sol 710) on its way to Tenby during the Upper Fan campaign.",
                 sources=[["NASA blog: Journey to Tenby!", "https://science.nasa.gov/blogs/journey-to-tenby"]]),
    "depot": dict(text="Perseverance left 10 sample tubes here between sol 653 (21 Dec 2022) and sol 690 (28 Jan 2023), "
                       "laid in a zigzag 5-15 m apart on flat ground near the base of the delta, as a backup cache for sample return.",
                  sources=[["JPL: Perseverance completes Mars sample depot", "https://www.jpl.nasa.gov/news/nasas-perseverance-rover-completes-mars-sample-depot/"],
                           ["NASA: Three Forks sample depot map", "https://science.nasa.gov/resource/perseverances-three-forks-sample-depot-map/"]]),
    "gap": dict(text="Hawksbill Gap was the rover's way up the layered rocks of the delta front during the Delta Front Campaign "
                     "(from sol 415). It tried an abrasion at Hogwallow Flats on sol 471 and worked at Skinner Ridge over sols 477-496.",
                sources=[["NASA blog: Next stop, Hawksbill Gap", "https://science.nasa.gov/blog/next-stop-hawksbill-gap"],
                         ["Williams et al., LPSC 2023: Delta Front Campaign overview", "https://ntrs.nasa.gov/api/citations/20230000588/downloads/Williams%20et%20al_LPSC%202023%20Delta%20Front%20Overview%20abstract_v5.pdf"]]),
    "top": dict(text="Perseverance reached Tenby on sol 733 (13 Mar 2023) to study the curvilinear unit on top of the fan, "
                     "part of the Upper Fan campaign.",
                sources=[["NASA blog: Journey to Tenby!", "https://science.nasa.gov/blogs/journey-to-tenby"],
                         ["NASA blog: Exploring the upper fan", "https://science.nasa.gov/blogs/up-and-soon-away-perseverance-continues-exploring-the-upper-fan/"]]),
}


def get_json(url):
    req = urllib.request.Request(url, headers=UA)
    return json.load(urllib.request.urlopen(req, timeout=60))


def raw_images(sol, want=6):
    picks = []
    for page in range(8):
        d = get_json(f"https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json"
                     f"&sol={sol}&num=100&page={page}")
        for im in d.get("images", []):
            cam = im.get("camera", {}).get("instrument", "")
            files = im.get("image_files", {})
            if cam in CAMERAS and files.get("medium") and "_THM" not in files.get("medium", ""):
                picks.append(dict(cam=cam, title=im.get("title", ""), small=files.get("small"),
                                  medium=files.get("medium"), large=files.get("large") or files.get("full_res"),
                                  date=im.get("date_taken_utc", ""), sol=sol, link=im.get("link", ""),
                                  credit=im.get("credit") or "NASA/JPL-Caltech"))   # the feed gives each image its own credit
        if len(d.get("images", [])) < 100:
            break
    # round-robin over cameras so the gallery mixes Navcam, Mastcam-Z, Hazcam and close-ups
    by_cam = {}
    for p in sorted(picks, key=lambda p: p["date"]):
        by_cam.setdefault(p["cam"], []).append(p)
    for cam in by_cam:   # spread picks across the sol instead of taking a burst of near-identical frames
        lst = by_cam[cam]
        step = max(1, len(lst) // 6)
        by_cam[cam] = lst[::step]
    out = []
    while len(out) < want and any(by_cam.values()):
        for cam in CAMERAS:
            if by_cam.get(cam):
                out.append(by_cam[cam].pop(0))
                if len(out) >= want:
                    break
    return out


def simplify(coords, tol=1e-5):
    if len(coords) < 3:
        return coords
    out = [coords[0]]
    for p in coords[1:-1]:
        if abs(p[0] - out[-1][0]) > tol or abs(p[1] - out[-1][1]) > tol:
            out.append(p)
    out.append(coords[-1])
    return out


def fetch_donki():
    """Save the last 30 days of DONKI notices. The whole text is kept: the Mars arrival time is near the end."""
    end = date.today()
    start = end - timedelta(days=30)
    q = f"startDate={start}&endDate={end}&type=all"
    for url in (f"https://ccmc.gsfc.nasa.gov/DONKI/WS/get/notifications?{q}",        # NASA CCMC, no key needed
                f"https://api.nasa.gov/DONKI/notifications?{q}&api_key=DEMO_KEY"):    # rate-limited demo key
        try:
            notes = get_json(url)
            slim = [dict(type=n.get("messageType"), id=n.get("messageID"), issued=n.get("messageIssueTime"),
                         url=n.get("messageURL"), body=(n.get("messageBody") or "")[:8000]) for n in notes]
            json.dump(dict(source="NASA DONKI (CCMC)", fetched=str(end), notes=slim),
                      open(os.path.join(OUT, "donki.json"), "w"), separators=(",", ":"))
            print("DONKI notifications:", len(slim), "from", url.split("/")[2])
            return
        except Exception as e:
            print("DONKI failed", url.split("/")[2], e)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "donki":
        fetch_donki()
        return
    mission_path = os.path.join(OUT, "mission.json")
    mission = json.load(open(mission_path, encoding="utf-8"))

    # Local copies of the photos for the team (kept outside the repo, next to red-route/).
    archive = os.path.join(os.path.dirname(ROOT), "nasa_data", "rover_photos")
    for st in mission["stops"]:
        sols = [st["rover_sol"] + k for k in (0, -1, 1, -2, 2, -3, 3)]
        folder = os.path.join(archive, f"{st['id']}_sol{st['rover_sol']}")
        os.makedirs(folder, exist_ok=True)
        pics, hashes, skipped = [], [], 0
        for s in sols:
            if len(pics) >= PHOTOS_PER_STOP:
                break
            try:
                cands = raw_images(s, 48)
            except Exception as e:  # keep going; the app shows what it has
                print("raw images failed for sol", s, e)
                continue
            for p in cands:
                if len(pics) >= PHOTOS_PER_STOP:
                    break
                dest = os.path.join(folder, os.path.basename(p["medium"]))
                try:
                    if os.path.exists(dest):
                        data = open(dest, "rb").read()
                    else:
                        data = urllib.request.urlopen(urllib.request.Request(p["medium"], headers=UA), timeout=60).read()
                    ok, bits = useful(data)
                except Exception as e:
                    print("photo check failed", p["medium"], e)
                    continue
                if not ok or near_copy(bits, hashes):
                    skipped += 1
                    continue
                if not os.path.exists(dest):
                    open(dest, "wb").write(data)
                pics.append(p)
                hashes.append(bits)
        # Small thumbnails go in the site itself, so the stop panel shows them at once even if NASA's server is slow.
        tdir = os.path.join(ROOT, "docs", "photos", st["id"])
        os.makedirs(tdir, exist_ok=True)
        keep = set()
        for p in pics:
            name = os.path.basename(p["small"] or "")
            if not name:
                continue
            dest = os.path.join(tdir, name)
            if not os.path.exists(dest):
                try:
                    data = urllib.request.urlopen(urllib.request.Request(p["small"], headers=UA), timeout=60).read()
                    open(dest, "wb").write(data)
                except Exception as e:
                    print("thumbnail failed", p["small"], e)
                    continue
            p["thumb"] = f"photos/{st['id']}/{name}"
            keep.add(name)
        for name in os.listdir(tdir):   # drop thumbnails of photos no longer picked
            if name not in keep:
                os.remove(os.path.join(tdir, name))
        st["photos"] = pics
        st["notes"] = NOTES.get(st["id"])
        json.dump(pics, open(os.path.join(folder, "photos.json"), "w"), indent=1)
        print(st["name"], "sol", st["rover_sol"], "photos", len(pics), "skipped (dark, flat or repeat)", skipped)
    json.dump(mission, open(mission_path, "w"), separators=(",", ":"))

    try:
        wx = get_json("https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json")
        sols = [s for s in wx.get("sols", []) if s.get("max_temp") not in ("--", None, "")]
        json.dump(dict(source="NASA/JPL-Caltech Perseverance MEDA", sols=sols[-14:]),
                  open(os.path.join(OUT, "meda.json"), "w"), separators=(",", ":"))
        print("MEDA sols with temps:", len(sols), "latest", sols[-1]["terrestrial_date"] if sols else None)
    except Exception as e:
        print("MEDA failed", e)

    fetch_donki()

    t = json.load(open(os.path.join(RAW, "M20_traverse.json"), encoding="utf-8"))
    feats = []
    for f in t["features"]:
        c = simplify([[round(x, 6), round(y, 6)] for x, y, *_ in f["geometry"]["coordinates"]])
        feats.append(dict(type="Feature", properties=dict(sol=f["properties"].get("sol")),
                          geometry=dict(type="LineString", coordinates=c)))
    json.dump(dict(type="FeatureCollection", features=feats),
              open(os.path.join(OUT, "m20_traverse.json"), "w"), separators=(",", ":"))
    print("traverse segments:", len(feats))


if __name__ == "__main__":
    main()
