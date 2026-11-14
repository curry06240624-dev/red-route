"""Fetch the context data Red Route shows next to the map.

- Perseverance raw images from the sols the rover spent at each stop (NASA/JPL-Caltech raw image API)
- Perseverance MEDA weather summaries (NASA/JPL-Caltech weather feed)
- Space-weather notifications from NASA's DONKI service (api.nasa.gov)
- A simplified Perseverance traverse line (NASA/JPL-Caltech MMGIS)

Run after build_layers.py:  py -3.12 tools/fetch_context.py
"""
import json
import os
import urllib.request
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw")
OUT = os.path.join(ROOT, "docs", "data")
UA = {"User-Agent": "red-route-hackathon/1.0"}
CAMERAS = ("NAVCAM_LEFT", "MCZ_LEFT", "FRONT_HAZCAM_LEFT_A", "MCZ_RIGHT", "NAVCAM_RIGHT")


def get_json(url):
    req = urllib.request.Request(url, headers=UA)
    return json.load(urllib.request.urlopen(req, timeout=60))


def raw_images(sol, want=6):
    picks = []
    for page in range(4):
        d = get_json(f"https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json"
                     f"&sol={sol}&num=100&page={page}")
        for im in d.get("images", []):
            cam = im.get("camera", {}).get("instrument", "")
            files = im.get("image_files", {})
            if cam in CAMERAS and files.get("medium") and "_THM" not in files.get("medium", ""):
                picks.append(dict(cam=cam, title=im.get("title", ""), small=files.get("small"),
                                  medium=files.get("medium"), large=files.get("large") or files.get("full_res"),
                                  date=im.get("date_taken_utc", ""), sol=sol, link=im.get("link", "")))
        if len(d.get("images", [])) < 100:
            break
    # prefer a mix of cameras, colour Mastcam-Z first
    picks.sort(key=lambda p: (CAMERAS.index(p["cam"]), p["date"]))
    seen, out = set(), []
    for p in picks:
        key = (p["cam"], p["title"][:40])
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
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


def main():
    mission_path = os.path.join(OUT, "mission.json")
    mission = json.load(open(mission_path, encoding="utf-8"))

    # Local copies of the photos for the team (kept outside the repo, next to red-route/).
    archive = os.path.join(os.path.dirname(ROOT), "nasa_data", "rover_photos")
    for st in mission["stops"]:
        sols = [st["rover_sol"] + k for k in (0, -1, 1, -2, 2)]
        pics = []
        for s in sols:
            if len(pics) >= 6:
                break
            try:
                pics += raw_images(s, 6 - len(pics))
            except Exception as e:  # keep going; the app shows what it has
                print("raw images failed for sol", s, e)
        st["photos"] = pics
        folder = os.path.join(archive, f"{st['id']}_sol{st['rover_sol']}")
        os.makedirs(folder, exist_ok=True)
        for p in pics:
            dest = os.path.join(folder, os.path.basename(p["medium"]))
            if not os.path.exists(dest):
                try:
                    req = urllib.request.Request(p["medium"], headers=UA)
                    open(dest, "wb").write(urllib.request.urlopen(req, timeout=60).read())
                except Exception as e:
                    print("photo download failed", p["medium"], e)
        json.dump(pics, open(os.path.join(folder, "photos.json"), "w"), indent=1)
        print(st["name"], "sol", st["rover_sol"], "photos", len(pics))
    json.dump(mission, open(mission_path, "w"), separators=(",", ":"))

    try:
        wx = get_json("https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json")
        sols = [s for s in wx.get("sols", []) if s.get("max_temp") not in ("--", None, "")]
        json.dump(dict(source="NASA/JPL-Caltech Perseverance MEDA", sols=sols[-14:]),
                  open(os.path.join(OUT, "meda.json"), "w"), separators=(",", ":"))
        print("MEDA sols with temps:", len(sols), "latest", sols[-1]["terrestrial_date"] if sols else None)
    except Exception as e:
        print("MEDA failed", e)

    try:
        end = date.today()
        start = end - timedelta(days=30)
        notes = get_json(f"https://api.nasa.gov/DONKI/notifications?startDate={start}&endDate={end}"
                         f"&type=all&api_key=DEMO_KEY")
        slim = [dict(type=n.get("messageType"), id=n.get("messageID"), issued=n.get("messageIssueTime"),
                     url=n.get("messageURL"), body=(n.get("messageBody") or "")[:1200]) for n in notes]
        json.dump(dict(source="NASA DONKI (CCMC)", fetched=str(end), notes=slim),
                  open(os.path.join(OUT, "donki.json"), "w"), separators=(",", ":"))
        print("DONKI notifications:", len(slim))
    except Exception as e:
        print("DONKI failed", e)

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
