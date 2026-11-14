"""Draw the rover-path check map shown in the app's "How it works" page.

Perseverance's climb to the delta top (the validation sols in mission.json): the rover's real path,
the walk Red Route plans between the same two points, and a straight line (no planner), over the
ground steeper than the no-go slope. The numbers (metres of steep ground crossed) come from
build_layers.py, which measures them on the full-resolution slope grid.

Run after build_layers.py:  py -3.12 -I tools/rover_check.py
Writes docs/img/rover_check.jpg. Colours match the app: our walk orange, the rover blue.
Based on the team's validation script.

AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md.
"""
import json
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "docs", "data")
RAW = os.path.join(ROOT, "raw")
OUT = os.path.join(ROOT, "docs", "img", "rover_check.jpg")
OURS, ROVER, LINE, STEEP = (255, 106, 61), (56, 189, 248), (255, 255, 255), (220, 38, 38)


def font(size, bold=False):
    for name in (("segoeuib.ttf" if bold else "segoeui.ttf"), ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf")):
        for folder in ("C:/Windows/Fonts", ""):
            try:
                return ImageFont.truetype(os.path.join(folder, name) if folder else name, size)
            except OSError:
                pass
    return ImageFont.load_default()


def main():
    m = json.load(open(os.path.join(DATA, "mission.json"), encoding="utf-8"))
    v = m["validation"]
    sa, sb = v["sols"]
    ours = np.array(v["ours"], float)   # [lon, lat]
    trav = json.load(open(os.path.join(RAW, "M20_traverse.json"), encoding="utf-8"))["features"]
    rover = np.array([c[:2] for f in trav if sa <= (f["properties"].get("sol") or -1) <= sb
                      for c in f["geometry"]["coordinates"]], float)

    (lat0, lon0), (lat1, lon1) = m["overlay_bounds"]
    hs = Image.open(os.path.join(DATA, "hillshade.png")).convert("RGB")
    W, H = hs.size
    a = np.array(Image.open(os.path.join(DATA, "slope.png")).convert("RGBA").resize((W, H)))
    nogo = (a[..., 0] > 200) & (a[..., 1] < 80) & (a[..., 3] > 100)   # the app's red "steeper than the limit" pixels
    base = np.array(hs).astype(float) * 0.85 + 20
    base[nogo] = base[nogo] * 0.45 + np.array(STEEP) * 0.55
    img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))

    def px(p):
        return ((p[0] - lon0) / (lon1 - lon0) * W, (lat1 - p[1]) / (lat1 - lat0) * H)

    xs, ys = zip(*[px(p) for p in np.concatenate([ours, rover])])
    pad = 60
    box = (max(0, int(min(xs)) - pad), max(0, int(min(ys)) - pad), min(W, int(max(xs)) + pad), min(H, int(max(ys)) + pad))
    img = img.crop(box)
    scale = 2 if img.size[0] < 900 else 1
    img = img.resize((img.size[0] * scale, img.size[1] * scale), Image.LANCZOS)
    d = ImageDraw.Draw(img)

    def P(p):
        x, y = px(p)
        return ((x - box[0]) * scale, (y - box[1]) * scale)

    d.line([P(p) for p in rover], fill=(10, 10, 10), width=9)
    d.line([P(p) for p in rover], fill=ROVER, width=5)
    lp = [P(ours[0]), P(ours[-1])]
    n = 40
    for i in range(0, n, 2):   # dashed straight line
        t0, t1 = i / n, (i + 1) / n
        d.line([(lp[0][0] + t0 * (lp[1][0] - lp[0][0]), lp[0][1] + t0 * (lp[1][1] - lp[0][1])),
                (lp[0][0] + t1 * (lp[1][0] - lp[0][0]), lp[0][1] + t1 * (lp[1][1] - lp[0][1]))], fill=LINE, width=3)
    d.line([P(p) for p in ours], fill=(10, 10, 10), width=9)
    d.line([P(p) for p in ours], fill=OURS, width=5)
    for p, col in ((ours[0], (34, 197, 94)), (ours[-1], (239, 68, 68))):
        x, y = P(p)
        d.ellipse([x - 9, y - 9, x + 9, y + 9], fill=col, outline=(255, 255, 255), width=2)

    f, fb, fs = font(22), font(24, True), font(16)
    Wi, Hi = img.size
    st = v.get("steep")
    panel_h = 190 if st else 150
    out = Image.new("RGB", (Wi, Hi + panel_h), (17, 17, 20))
    out.paste(img, (0, 0))
    d = ImageDraw.Draw(out)
    y = Hi + 12
    d.text((16, y), f"Rover-path check: Perseverance's climb to the delta top (sols {sa}-{sb}), Jezero Crater", font=fb, fill=(255, 255, 255))
    y += 36
    lim = int(st["limit_deg"]) if st else 15
    items = [(ROVER, "Perseverance's real path"), (OURS, "Red Route's planned walk"),
             (LINE, "Straight line (no planner)"), (STEEP, f"Steeper than {lim}° (no-go for walking)")]
    x = 16
    for col, label in items:
        d.rectangle([x, y + 8, x + 26, y + 16], fill=col)
        d.text((x + 34, y), label, font=f, fill=(230, 230, 230))
        x += 44 + int(d.textlength(label, font=f)) + 24
    y += 40
    if st:
        d.text((16, y), f"Ground steeper than {lim}° crossed: straight line {st['line']['steep_m']} m, "
                        f"rover {st['rover']['steep_m']} m, Red Route {st['ours']['steep_m']} m.", font=f, fill=(230, 230, 230))
        y += 40
    d.text((16, y), "Data: HiRISE DTM (USGS Astrogeology), Perseverance traverse (NASA/JPL-Caltech). "
                    "Map drawn by code written with AI help (Claude).", font=fs, fill=(170, 170, 170))
    if out.size[0] > 1200:
        out = out.resize((1200, round(out.size[1] * 1200 / out.size[0])), Image.LANCZOS)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    out.save(OUT, quality=86, optimize=True)
    print("wrote", os.path.relpath(OUT, ROOT), out.size, "steep:", st)


if __name__ == "__main__":
    main()
