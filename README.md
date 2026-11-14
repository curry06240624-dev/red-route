# Red Route: a Marswalk planner for Jezero Crater

NASA Space Apps Challenge 2026 · Challenge: **Interplanetary Survival Guide: Martian Map** · Team **Red Route** (Taipei)

Red Route is a map an astronaut crew could use to plan and run a walking EVA (a "Marswalk") in Jezero Crater.
It layers NASA terrain, imagery, rover photos, weather and space weather into one view. It then finds the
safest walking route between science stops and checks the plan against a **walk-back rule**: at every point
of the walk, the crew must be able to get back to base camp inside the EVA time budget.

## The mission in the demo: "Delta Front Sample Run"
| Stop | Where (Perseverance waypoint) | Why go there |
|---|---|---|
| B | Base camp on the crater floor (sol 395) | Flat, open landing zone |
| 1 | Three Forks sample depot (sol 670) | Retrieve the sample tubes Perseverance cached |
| 2 | Hawksbill Gap outcrop (sol 477) | Layered sedimentary rocks of the delta front |
| 3 | Delta top overlook (sol 736) | Upper fan deposits and a view over the crater |

## Layers
- **Optical:** HiRISE 25 cm orthomosaic of Jezero (USGS, served by NASA JPL Mars Trek), plus CTX, MOLA and Viking backgrounds.
- **Topographic:** slope and rough ground computed from the 1 m HiRISE elevation model (USGS Mars 2020 TRN DTM).
- **Safety:** walk-back time to base camp from every point, and the planned route coloured by slope.
- **Surface view:** Perseverance Navcam, Mastcam-Z and Hazcam images taken at each stop, so the crew knows what to expect.
- **Conditions:** NASA DONKI space-weather notices (live) and Perseverance MEDA weather summaries.
- **Context:** Perseverance's real traverse.

## How the route is found
1. Slope and roughness come from the HiRISE DTM on a 2 m grid, corrected for the equirectangular projection (x is stretched by 1/cos(latitude)).
2. Each cell gets a walking time from a Tobler-style hiking function scaled to suited walking (0.85 m/s on flat ground).
3. Ground steeper than 15° is no-go. Rough ground (local relief above 0.35 m) takes 3× longer.
4. A least-cost path search (scikit-image `MCP_Geometric`) links the stops. A second search from base camp gives the walk-back time from every cell.
5. The plan passes if elapsed time + walk-back time stays inside the EVA budget (8 h, with 30 % reserve) at every point.

These are planning assumptions for a hackathon prototype, not NASA flight rules. They are listed in the app under "How it works".

## Run it
```bash
# 1. data (see DATA.md for sources)
curl -L -o raw/JEZ_HiRISE_DTM_1m.tif https://planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif
curl -L -o raw/M20_waypoints.json https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json
curl -L -o raw/M20_traverse.json https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json
# 2. build layers + route, then photos/weather/space weather
python tools/build_layers.py --dtm hirise --res 2
python tools/fetch_context.py
# 3. serve the web app
python -m http.server 8765 --directory docs
```
Python packages: numpy, scipy, scikit-image, rasterio, pillow.

## Use of AI tools
The code was written with help from an AI coding assistant (Claude by Anthropic). Claude also suggested the
first version of the site, the science stops and the route rules; the team reviewed and approved them and
asked for later changes. All data shown in the app come from NASA, USGS and ESA. The app itself uses no
AI-generated images.

## License
Apache-2.0 (see LICENSE). NASA and USGS data keep their own terms; see DATA.md.
