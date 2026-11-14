"""Build the Red Route terrain layers and the default Marswalk route.

Data (all from NASA / USGS, see DATA.md):
  raw/JEZ_HiRISE_DTM_1m.tif  USGS Astrogeology, Mars 2020 TRN HiRISE DTM (1 m/px, Jezero crater)
  raw/JEZ_CTX_DTM_20m.tif    USGS Astrogeology, Mars 2020 TRN CTX DTM (20 m/px), coarse fallback
  raw/M20_waypoints.json     NASA/JPL-Caltech, Perseverance rover waypoints (MMGIS)

Run:  py -3.12 tools/build_layers.py --dtm hirise --res 2
Writes docs/data/: slope.png, hazard.png, returntime.png, hillshade.png, mission.json, route.geojson
"""
import argparse
import json
import math
import os
from datetime import datetime, timezone

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.windows import from_bounds
from scipy import ndimage
from skimage.graph import MCP_Geometric

R = 3396190.0  # Mars 2000 sphere radius in metres, the same sphere the DTM projection uses
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw")
OUT = os.path.join(ROOT, "docs", "data")

# Area of interest: the western Jezero crater floor and the delta front Perseverance explored (2022-2023).
AOI = dict(lon0=77.372, lon1=77.456, lat0=18.444, lat1=18.480)

# Stops sit on Perseverance waypoints (lat/lon from NASA's waypoint file), picked by sol.
STOPS = [
    dict(id="base", name="Base camp", sol=395, dwell_min=0,
         role="Landing zone on the flat crater floor, east of the delta."),
    dict(id="depot", name="Three Forks sample depot", sol=670, dwell_min=40,
         role="Retrieve sample tubes Perseverance cached on the crater floor."),
    dict(id="gap", name="Hawksbill Gap outcrop", sol=477, dwell_min=45,
         role="Inspect the layered sedimentary rocks of the delta front."),
    dict(id="top", name="Delta top overlook", sol=736, dwell_min=30,
         role="Survey the upper fan deposits and photograph the crater floor."),
]
ROUTE_ORDER = ["base", "depot", "gap", "top", "base"]

# Walking model. These are planning assumptions and are shown in the app next to the results.
V_FLAT = 0.85         # m/s, suited walking speed on flat ground
MAX_SLOPE = 15.0      # degrees; steeper ground is treated as impassable
ROUGH_M = 0.35        # metres of local relief (boulders, ridges) that counts as rough ground
ROUGH_PENALTY = 3.0   # rough ground takes 3x longer to cross
VALIDATION_SOLS = (690, 736)  # Perseverance's climb up the delta front, used as a real-world check
BAD_DAY_FACTOR = 2.0  # "if something goes wrong": walk home at half speed (a hurt or helping crewmate)...
                      # ...and that contingency return may use the reserve, i.e. the full EVA limit
EVA_LIMIT_H = 8.0     # hours available for one EVA
RESERVE = 0.30        # share of the EVA kept in reserve for the walk back


def lonlat_to_xy(lon, lat):
    return R * math.radians(lon), R * math.radians(lat)


def xy_to_lonlat(x, y):
    return math.degrees(x / R), math.degrees(y / R)


def load_dem(path, res):
    x0, y0 = lonlat_to_xy(AOI["lon0"], AOI["lat0"])
    x1, y1 = lonlat_to_xy(AOI["lon1"], AOI["lat1"])
    with rasterio.open(path) as src:
        win = from_bounds(x0, y0, x1, y1, transform=src.transform).round_offsets().round_lengths()
        native = abs(src.res[0])
        step = max(1, int(round(res / native)))
        out_h, out_w = int(win.height // step), int(win.width // step)
        dem = src.read(1, window=win, out_shape=(out_h, out_w), resampling=Resampling.average).astype("float64")
        nodata = src.nodata
        wt = src.window_transform(win)
    dem[(dem < -1e20) | (dem == nodata)] = np.nan
    px_x = (win.width * native) / out_w   # projected metres per output pixel
    px_y = (win.height * native) / out_h
    left, top = wt.c, wt.f
    return dem, px_x, px_y, left, top


def colorize(mask_rgba_list, shape):
    img = np.zeros(shape + (4,), dtype=np.uint8)
    for mask, rgba in mask_rgba_list:
        img[mask] = rgba
    return Image.fromarray(img, "RGBA")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dtm", choices=["hirise", "ctx"], default="hirise")
    ap.add_argument("--res", type=float, default=2.0, help="grid size in metres for layers and routing")
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)

    dtm_path = os.path.join(RAW, "JEZ_HiRISE_DTM_1m.tif" if a.dtm == "hirise" else "JEZ_CTX_DTM_20m.tif")
    dem, px_x, px_y, left, top = load_dem(dtm_path, a.res if a.dtm == "hirise" else 20.0)
    h, w = dem.shape
    lat_mid = math.radians((AOI["lat0"] + AOI["lat1"]) / 2)
    gx, gy = px_x * math.cos(lat_mid), px_y  # true ground size of a pixel (equirectangular x is stretched)
    print(f"DEM {w}x{h}, ground pixel {gx:.2f} x {gy:.2f} m, elev {np.nanmin(dem):.0f}..{np.nanmax(dem):.0f} m")

    filled = np.where(np.isnan(dem), np.nanmean(dem), dem)
    dzdy, dzdx = np.gradient(filled, gy, gx)
    slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
    slope[np.isnan(dem)] = np.nan

    sigma = max(1.0, 6.0 / a.res)
    detr = filled - ndimage.gaussian_filter(filled, sigma)
    rough = np.sqrt(ndimage.uniform_filter(detr ** 2, size=max(3, int(10 / a.res) | 1)))
    rough[np.isnan(dem)] = np.nan

    # Seconds per metre, from a Tobler-style hiking function scaled to suited walking.
    speed = V_FLAT * np.exp(-3.5 * np.tan(np.radians(np.nan_to_num(slope, nan=89.0))))
    cost = 1.0 / speed
    cost = np.where(rough > ROUGH_M, cost * ROUGH_PENALTY, cost)
    blocked = np.isnan(dem) | (slope > MAX_SLOPE)
    cost[blocked] = np.inf

    def rc_of(lon, lat):
        x, y = lonlat_to_xy(lon, lat)
        return int(round((top - y) / px_y)), int(round((x - left) / px_x))

    def lonlat_of(r, c):
        return xy_to_lonlat(left + (c + 0.5) * px_x, top - (r + 0.5) * px_y)

    way = json.load(open(os.path.join(RAW, "M20_waypoints.json"), encoding="utf-8"))["features"]
    stops = {}
    for s in STOPS:
        p = min(way, key=lambda f: abs(f["properties"]["sol"] - s["sol"]))["properties"]
        r, c = rc_of(p["lon"], p["lat"])
        if not np.isfinite(cost[r, c]):  # snap to the nearest walkable cell within ~40 m
            rr, cc = np.nonzero(np.isfinite(cost[max(0, r - 20):r + 21, max(0, c - 20):c + 21]))
            k = np.argmin((rr - min(r, 20)) ** 2 + (cc - min(c, 20)) ** 2)
            r, c = max(0, r - 20) + rr[k], max(0, c - 20) + cc[k]
        lon, lat = lonlat_of(r, c)
        stops[s["id"]] = dict(s, rc=(r, c), lon=round(lon, 6), lat=round(lat, 6), elev_m=round(float(dem[r, c]), 1),
                              rover_sol=p["sol"], rover_lat=p["lat"], rover_lon=p["lon"])

    mcp = MCP_Geometric(cost, fully_connected=True, sampling=(gy, gx))

    legs, coords_all, profile = [], [], []
    t_walk, dist_total = 0.0, 0.0
    for a_id, b_id in zip(ROUTE_ORDER[:-1], ROUTE_ORDER[1:]):
        A, B = stops[a_id], stops[b_id]
        cum, _ = mcp.find_costs([A["rc"]], [B["rc"]])
        path = mcp.traceback(B["rc"])
        secs = float(cum[B["rc"]])
        dist = gain = loss = 0.0
        max_s = 0.0
        prev = None
        for (r, c) in path:
            z = float(dem[r, c])
            max_s = max(max_s, float(slope[r, c]))
            if prev:
                pr, pc, pz = prev
                d = math.sqrt(((c - pc) * gx) ** 2 + ((r - pr) * gy) ** 2 + (z - pz) ** 2)
                dist += d
                gain += max(0.0, z - pz)
                loss += max(0.0, pz - z)
            profile.append(dict(d=round(dist_total + dist, 1), z=round(z, 1), s=round(float(slope[r, c]), 1), leg=len(legs)))
            prev = (r, c, z)
        coords = [[round(v, 6) for v in lonlat_of(r, c)] for (r, c) in path]
        coords_all.append(coords)
        legs.append(dict(frm=a_id, to=b_id, dist_m=round(dist), walk_min=round(secs / 60, 1),
                         gain_m=round(gain), loss_m=round(loss), max_slope=round(max_s, 1)))
        t_walk += secs
        dist_total += dist

    # Real-world check: Perseverance's climb from the crater floor to the delta top (sols 690-736).
    # Plan our own walking route between the rover's start and end points (the planner never sees the
    # rover track) and measure how far it strays from the path the rover drivers actually chose.
    validation = None
    try:
        sa, sb = VALIDATION_SOLS
        pa = min(way, key=lambda f: abs(f["properties"]["sol"] - sa))["properties"]
        pb = min(way, key=lambda f: abs(f["properties"]["sol"] - sb))["properties"]
        ra, rb = rc_of(pa["lon"], pa["lat"]), rc_of(pb["lon"], pb["lat"])
        vcum, _ = mcp.find_costs([ra], [rb])
        vpath = mcp.traceback(rb)
        ours = np.array([lonlat_of(r, c) for r, c in vpath])
        trav = json.load(open(os.path.join(RAW, "M20_traverse.json"), encoding="utf-8"))["features"]
        rover = np.array([c[:2] for f in trav if sa <= (f["properties"].get("sol") or -1) <= sb
                          for c in f["geometry"]["coordinates"]])
        k_x = R * math.cos(lat_mid) * math.pi / 180
        k_y = R * math.pi / 180
        tx, ty = [], []
        for i in range(len(rover) - 1):   # densify the rover track to ~1 m so distances are fair
            n = max(1, int(math.hypot((rover[i + 1, 0] - rover[i, 0]) * k_x, (rover[i + 1, 1] - rover[i, 1]) * k_y)))
            t = np.linspace(0, 1, n, endpoint=False)
            tx.append((rover[i, 0] + t * (rover[i + 1, 0] - rover[i, 0])) * k_x)
            ty.append((rover[i, 1] + t * (rover[i + 1, 1] - rover[i, 1])) * k_y)
        tx, ty = np.concatenate(tx), np.concatenate(ty)
        d = np.array([np.min(np.hypot(tx - x * k_x, ty - y * k_y)) for x, y in ours])
        vlen = sum(math.hypot((ours[i + 1, 0] - ours[i, 0]) * k_x, (ours[i + 1, 1] - ours[i, 1]) * k_y) for i in range(len(ours) - 1))
        validation = dict(
            what="Perseverance climb from the crater floor to the delta top",
            sols=[pa["sol"], pb["sol"]], our_len_m=round(vlen), our_walk_min=round(float(vcum[rb]) / 60, 1),
            median_m=round(float(np.median(d)), 1), p90_m=round(float(np.percentile(d, 90)), 1), max_m=round(float(d.max()), 1),
            within_25m_pct=round(float((d <= 25).mean() * 100), 1), within_50m_pct=round(float((d <= 50).mean() * 100), 1),
            within_100m_pct=round(float((d <= 100).mean() * 100), 1),
            ours=[[round(x, 6), round(y, 6)] for x, y in ours[::2]],
            rover=[[round(x, 6), round(y, 6)] for x, y in rover[::2]],
        )
        print("validation:", {k: v for k, v in validation.items() if k not in ("ours", "rover")})
    except Exception as e:
        print("validation skipped:", e)

    # Check the terrain model against Perseverance's own measurements at its waypoints in the area:
    # elevation (rover localisation) vs our DTM, and the rover's tilt (IMU) vs our slope.
    zm, zr, sm, tl = [], [], [], []
    for f in way:
        p = f["properties"]
        if not (AOI["lon0"] < p["lon"] < AOI["lon1"] and AOI["lat0"] < p["lat"] < AOI["lat1"]):
            continue
        r, c = rc_of(p["lon"], p["lat"])
        if not (1 <= r < h - 1 and 1 <= c < w - 1) or np.isnan(dem[r, c]) or p.get("tilt") in (None, -9999.0):
            continue
        zm.append(float(dem[r, c])); zr.append(float(p["elev_geoid"]))
        sm.append(float(np.nanmean(slope[r - 1:r + 2, c - 1:c + 2]))); tl.append(float(p["tilt"]))
    rover_check = None
    if len(zm) >= 10:
        zm, zr, sm, tl = map(np.array, (zm, zr, sm, tl))
        dz, ds = zm - zr, sm - tl
        rover_check = dict(
            n=int(len(zm)),
            elev_bias_m=round(float(np.median(dz)), 2), elev_mae_m=round(float(np.mean(np.abs(dz - np.median(dz)))), 2),
            slope_mae_deg=round(float(np.mean(np.abs(ds))), 2), slope_bias_deg=round(float(np.mean(ds)), 2),
            slope_r=round(float(np.corrcoef(sm, tl)[0, 1]), 3), within_3deg_pct=round(float((np.abs(ds) <= 3).mean() * 100), 1),
            pairs=[[round(a, 1), round(b, 1)] for a, b in zip(sm, tl)],
        )
        print("rover check:", {k: v for k, v in rover_check.items() if k != "pairs"})

    # Return-to-base time from every cell (costs are symmetric, so base->cell == cell->base).
    back = MCP_Geometric(cost, fully_connected=True, sampling=(gy, gx))
    ret, _ = back.find_costs([stops["base"]["rc"]])
    ret_min = ret / 60.0

    # Walk-back check along the planned EVA: elapsed time + time to get home must stay inside the budget.
    budget_min = EVA_LIMIT_H * 60 * (1 - RESERVE)
    elapsed = 0.0
    worst = dict(margin_min=1e9)
    leg_start = 0.0
    for i, (a_id, b_id) in enumerate(zip(ROUTE_ORDER[:-1], ROUTE_ORDER[1:])):
        leg_pts = [p for p in profile if p["leg"] == i]
        leg_t = legs[i]["walk_min"]
        for j, p in enumerate(leg_pts):
            frac = j / max(1, len(leg_pts) - 1)
            p["t"] = round(leg_start + frac * leg_t, 1)
        leg_start += leg_t + stops[b_id]["dwell_min"]
    bad_budget = EVA_LIMIT_H * 60
    worst_bad = dict(margin_min=1e9)
    for i, coords in enumerate(coords_all):
        leg_pts = [p for p in profile if p["leg"] == i]
        for p, (lon, lat) in zip(leg_pts, coords):
            r, c = rc_of(lon, lat)
            back_min = float(ret_min[r, c]) if np.isfinite(ret_min[r, c]) else 1e9
            p["back"] = round(back_min, 1)
            margin = budget_min - (p["t"] + back_min)
            if margin < worst["margin_min"]:
                worst = dict(margin_min=round(margin, 1), lon=lon, lat=lat, t=p["t"], back=round(back_min, 1))
            margin_bad = bad_budget - (p["t"] + BAD_DAY_FACTOR * back_min)
            if margin_bad < worst_bad["margin_min"]:
                worst_bad = dict(margin_min=round(margin_bad, 1), lon=lon, lat=lat, t=p["t"],
                                 back=round(BAD_DAY_FACTOR * back_min, 1), leg=i)

    # Turn-back time at each stop: the latest moment the crew can leave and still get home inside the budget.
    timeline, t = [], 0.0
    for i, sid in enumerate(ROUTE_ORDER):
        st = stops[sid]
        if i > 0:
            t += legs[i - 1]["walk_min"]
        arrive = t
        depart = arrive + (st["dwell_min"] if 0 < i < len(ROUTE_ORDER) - 1 else 0)
        back_min = float(ret_min[st["rc"]])
        bad_leave = bad_budget - BAD_DAY_FACTOR * back_min
        timeline.append(dict(id=sid, arrive_min=round(arrive, 1), depart_min=round(depart, 1),
                             back_min=round(back_min, 1), leave_by_min=round(budget_min - back_min, 1),
                             spare_min=round(budget_min - back_min - depart, 1),
                             bad_leave_by_min=round(bad_leave, 1), bad_spare_min=round(bad_leave - depart, 1)))
        t = depart

    dwell = sum(s["dwell_min"] for s in STOPS)
    total_min = t_walk / 60 + dwell

    # ---- images (north-up, pixel grid = the DEM grid) ----
    s = np.nan_to_num(slope, nan=0.0)
    colorize([(s >= 8, (250, 204, 21, 55)), (s >= 12, (249, 115, 22, 120)), (s > MAX_SLOPE, (220, 38, 38, 165))],
             s.shape).save(os.path.join(OUT, "slope.png"), optimize=True)
    rg = np.nan_to_num(rough, nan=0.0)
    colorize([(rg > ROUGH_M, (168, 85, 247, 150)), (rg > ROUGH_M * 2, (126, 34, 206, 190))],
             rg.shape).save(os.path.join(OUT, "hazard.png"), optimize=True)
    rm = np.where(np.isfinite(ret_min), ret_min, np.nan)
    bands = [(15, (34, 197, 94, 70)), (30, (132, 204, 22, 70)), (60, (234, 179, 8, 80)), (90, (249, 115, 22, 90)),
             (1e9, (239, 68, 68, 90))]
    img = np.zeros(rm.shape + (4,), dtype=np.uint8)
    lo = 0
    for hi, rgba in bands:
        img[(rm >= lo) & (rm < hi)] = rgba
        lo = hi
    edge = np.zeros(rm.shape, bool)
    for t in (15, 30, 60, 90):
        b = np.nan_to_num(rm, nan=1e9) < t
        edge |= b ^ ndimage.binary_erosion(b)
    img[edge] = (255, 255, 255, 200)
    Image.fromarray(img, "RGBA").save(os.path.join(OUT, "returntime.png"), optimize=True)
    az, alt = math.radians(315), math.radians(35)
    nx, ny = -dzdx, dzdy
    shade = (np.sin(alt) + np.cos(alt) * (nx * np.sin(az) + ny * np.cos(az))) / np.sqrt(1 + nx ** 2 + ny ** 2)
    Image.fromarray(np.clip(shade * 255, 0, 255).astype(np.uint8), "L").save(os.path.join(OUT, "hillshade.png"), optimize=True)

    lon0, lat1 = xy_to_lonlat(left, top)
    lon1, lat0 = xy_to_lonlat(left + w * px_x, top - h * px_y)
    bounds = [[round(lat0, 6), round(lon0, 6)], [round(lat1, 6), round(lon1, 6)]]

    # Compact coarser grid for re-routing in the browser (drag stops, change the safety rules).
    k = 2 if a.dtm == "hirise" else 1
    H2, W2 = (h // k) * k, (w // k) * k
    blk = lambda arr: arr[:H2, :W2].reshape(H2 // k, k, W2 // k, k)
    dem_k = blk(filled).mean(axis=(1, 3))
    nan_k = blk(np.isnan(dem)).any(axis=(1, 3))
    dky, dkx = np.gradient(dem_k, gy * k, gx * k)
    slope_k = np.degrees(np.arctan(np.hypot(dkx, dky)))
    rough_k = blk(np.nan_to_num(rough, nan=0.0)).max(axis=(1, 3))
    slope_u8 = np.clip(np.round(slope_k * 4), 0, 254).astype(np.uint8)
    slope_u8[nan_k] = 255
    rough_u8 = np.clip(np.round(rough_k * 100), 0, 255).astype(np.uint8)          # centimetres
    dem_i16 = np.round((dem_k + 3000.0) * 10).astype("<i2")                        # decimetres above -3000 m
    slope_u8.tofile(os.path.join(OUT, "grid_slope.u8"))
    rough_u8.tofile(os.path.join(OUT, "grid_rough.u8"))
    dem_i16.tofile(os.path.join(OUT, "grid_dem.i16"))
    grid = dict(w=W2 // k, h=H2 // k, gx=round(gx * k, 4), gy=round(gy * k, 4),
                lon0=lon0, lat1=lat1, dlon=math.degrees(px_x * k / R), dlat=math.degrees(px_y * k / R),
                slope_scale=0.25, rough_scale=0.01, z_offset=-3000.0, z_scale=0.1)

    route = dict(type="FeatureCollection", features=[
        dict(type="Feature", properties=dict(leg=i, **legs[i]), geometry=dict(type="LineString", coordinates=c))
        for i, c in enumerate(coords_all)])
    json.dump(route, open(os.path.join(OUT, "route.geojson"), "w"), separators=(",", ":"))

    step = max(1, len(profile) // 600)
    mission = dict(
        generated=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        dtm=os.path.basename(dtm_path), grid_m=round(gx, 2), aoi=AOI, overlay_bounds=bounds, grid=grid,
        stops=[{k: v for k, v in st.items() if k != "rc"} for st in stops.values()],
        order=ROUTE_ORDER, legs=legs,
        totals=dict(dist_km=round(dist_total / 1000, 2), walk_h=round(t_walk / 3600, 2), dwell_min=dwell,
                    eva_h=round(total_min / 60, 2), gain_m=sum(l["gain_m"] for l in legs),
                    loss_m=sum(l["loss_m"] for l in legs), max_slope=max(l["max_slope"] for l in legs)),
        walkback=dict(budget_min=round(budget_min), worst=worst, eva_limit_h=EVA_LIMIT_H, reserve=RESERVE,
                      bad=dict(factor=BAD_DAY_FACTOR, budget_min=round(bad_budget), worst=worst_bad)),
        assumptions=dict(v_flat_ms=V_FLAT, max_slope_deg=MAX_SLOPE, rough_m=ROUGH_M, rough_penalty=ROUGH_PENALTY,
                         eva_limit_h=EVA_LIMIT_H, reserve=RESERVE, bad_day_factor=BAD_DAY_FACTOR),
        profile=profile[::step],
        validation=validation, rover_check=rover_check, timeline=timeline,
    )
    json.dump(mission, open(os.path.join(OUT, "mission.json"), "w"), separators=(",", ":"))
    print(json.dumps(dict(totals=mission["totals"], legs=legs, walkback=mission["walkback"]), indent=1))


if __name__ == "__main__":
    main()
