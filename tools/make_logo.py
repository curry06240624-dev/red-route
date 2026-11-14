"""Draw the Red Route logo from the project's own data. No AI image is used.

The logo is a round crop of our terrain shading (docs/data/hillshade.png, which build_layers.py makes from the
USGS HiRISE elevation model of Jezero) with the planned walk (docs/data/route.geojson) and its stops drawn on
it in the app's route colour.

Run after build_layers.py:  py -3.12 -I tools/make_logo.py
Writes docs/logo_96.png, docs/logo_192.png, docs/favicon_64.png and docs/apple-touch-icon.png.

AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md.
"""
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
DATA = os.path.join(DOCS, "data")
ROUTE, CASING, DOT = (255, 106, 61), (11, 11, 11), (255, 255, 255)   # the app's route orange, its dark outline, stop dots
DARK, LIGHT = np.array([38, 18, 12]), np.array([226, 150, 104])       # shaded and sunlit ground
SS = 1024   # drawing size; the files are scaled down from it


def main():
    m = json.load(open(os.path.join(DATA, "mission.json"), encoding="utf-8"))
    route = json.load(open(os.path.join(DATA, "route.geojson"), encoding="utf-8"))
    (lat0, lon0), (lat1, lon1) = m["overlay_bounds"]
    hs = Image.open(os.path.join(DATA, "hillshade.png")).convert("L")
    W, H = hs.size
    kx = math.cos(math.radians((lat0 + lat1) / 2))   # the map image is stretched east-west by 1/cos(latitude): undo it
    hs = hs.resize((round(W * kx), H), Image.LANCZOS)

    def px(lon, lat):
        return (lon - lon0) / (lon1 - lon0) * W * kx, (lat1 - lat) / (lat1 - lat0) * H

    legs = [[px(*c[:2]) for c in f["geometry"]["coordinates"]] for f in route["features"]]
    pts = np.array([p for leg in legs for p in leg])
    cx, cy = (pts.min(0) + pts.max(0)) / 2
    half = max(np.ptp(pts[:, 0]), np.ptp(pts[:, 1])) / 2 * 1.45   # the walk fills about two thirds of the circle
    box = [int(round(v)) for v in (cx - half, cy - half, cx + half, cy + half)]
    g = np.asarray(hs.crop(box).resize((SS, SS), Image.LANCZOS), float) / 255   # outside the map the crop is black
    lo, hi = np.percentile(g[g > 0], [2, 98])
    g = np.clip((g - lo) / (hi - lo), 0, 1)
    img = Image.fromarray((DARK + (LIGHT - DARK) * g[..., None]).astype(np.uint8)).convert("RGBA")

    k = SS / (box[2] - box[0])
    d = ImageDraw.Draw(img)

    def P(p):
        return (p[0] - box[0]) * k, (p[1] - box[1]) * k

    for colour, width in ((CASING, 0.07), (ROUTE, 0.04)):
        for leg in legs:
            d.line([P(p) for p in leg], fill=colour, width=round(SS * width), joint="curve")
    stops = {s["id"]: s for s in m["stops"]}
    for sid in m["order"][:-1]:
        x, y = P(px(stops[sid]["lon"], stops[sid]["lat"]))
        r = SS * (0.058 if sid == "base" else 0.042)   # base camp is the bigger dot
        d.ellipse([x - r, y - r, x + r, y + r], fill=DOT, outline=CASING, width=round(SS * 0.014))

    mask = Image.new("L", (SS, SS), 0)
    ImageDraw.Draw(mask).ellipse([2, 2, SS - 3, SS - 3], fill=255)
    d.ellipse([2, 2, SS - 3, SS - 3], outline=(255, 255, 255, 235), width=round(SS * 0.022))
    img.putalpha(mask)

    for name, size in (("logo_96.png", 96), ("logo_192.png", 192), ("favicon_64.png", 64)):
        img.resize((size, size), Image.LANCZOS).save(os.path.join(DOCS, name), optimize=True)
    touch = Image.new("RGBA", (180, 180), CASING + (255,))   # phone home-screen icon: no see-through corners
    small = img.resize((156, 156), Image.LANCZOS)
    touch.paste(small, (12, 12), small)
    touch.convert("RGB").save(os.path.join(DOCS, "apple-touch-icon.png"), optimize=True)
    print("wrote logo_96.png, logo_192.png, favicon_64.png, apple-touch-icon.png from", len(pts), "route points")


if __name__ == "__main__":
    main()
