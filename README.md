# Red Route: a Marswalk planner for Jezero Crater

NASA Space Apps Challenge 2026 · Challenge: **Interplanetary Survival Guide: Martian Map** · Team **Red Route** (Kaohsiung)

Red Route is a map an astronaut crew could use to plan and run a walking EVA (a "Marswalk") in Jezero Crater.
It layers NASA terrain, imagery, rover photos, weather and space weather into one view. It then finds the
safest walking route between science stops and checks the plan against a **walk-back rule**: at every point
of the walk, the crew must be able to get back to base camp inside the EVA time budget.

## The mission in the demo: "Delta Front Sample Run"
| Stop | Where (Perseverance waypoint) | Why go there |
|---|---|---|
| B | Base camp on the upper fan (sol 715) | Flat ground on top of the delta |
| 1 | Three Forks sample depot (sol 670) | Retrieve the sample tubes Perseverance cached |
| 2 | Hawksbill Gap, Skinner Ridge (sol 477) | Layered sedimentary rocks of the delta front |
| optional | Tenby, upper fan (sol 736) | The curvilinear unit on top of the delta fan. Not on the default walk: with it the plan fails the time checks once the airlock time is counted. It can be ticked on in the app. |

Base camp was placed on top of the delta so that the loop fits the time rules. It is not checked as a landing site:
within 100 m the ground reaches 19.5° on our 2 m slope grid, and the Artemis III EVA study we cite draws a 100 m
landing circle with slopes under 5°.

## Layers
- **Optical:** HiRISE 25 cm orthomosaic of Jezero (USGS, served by NASA JPL Mars Trek), plus CTX, MOLA and ESA Mars Express HRSC backgrounds.
- **Topographic:** slope and rough ground computed from the 1 m HiRISE elevation model (USGS Mars 2020 TRN DTM).
- **Thermal:** an optional night-time infrared layer from Mars Odyssey THEMIS (100 m pixels, via Mars Trek): rock stays warmer at night, loose sand and dust cool faster. Context only; not used in the route.
- **Safety:** three get-home checks, each with its breaking point (how much slower the walk can be before it fails), a leave-by time for every stop, an EVA clock with a shrinking "can still get home" zone, the 50-minute backup-oxygen line, and bad-day drill buttons (crewmate hurt, suit alarm, storm warning, running late) that answer from the crew's position.
- **Start screen and tour:** the first visit opens with the question the app answers ("If a crewmate gets hurt out here, can you still get home?") and a one-minute guided tour of seven steps that drives the real app: the plan, the walk, a hurt crewmate at the worst moment, the real solar storm, one stop too many, "What we checked, and what failed", and the 3D walk. The tour uses the same functions as the buttons and the stored default plan; the "?" button brings it back.
- **3D walk:** a "3D walk" link beside the Astronaut view opens `3d/`: the planned walk at true scale on the HiRISE terrain, with the same get-home numbers, leave-by times and two drills. The astronaut figure is an AI-generated 3D model, labelled on screen. The ground there is the NASA HiRISE picture and elevation model; its Mars colours, the rocks, footprints, dust, sky, sun position, habitat shape, film look and sound are an illustration made by our code (the sound is not a recording), and the page's menu says so. A second 3D page (`walk3d/`, reached from the 3D walk's menu) shows the hurt-crewmate drill in third person; its two figures, base camp, sky and helmet rim are drawn by code, and nothing on it is AI-made.
- **Surface view:** 16 Perseverance photos per stop (Mastcam-Z, Navcam, Hazcam, SuperCam), what the rover did there with NASA sources, and the terrain within 50 m.
- **Conditions:** NASA DONKI space-weather notices (read live from NASA's CCMC service; NOT CHECKED if it does not answer), the latest available Perseverance MEDA weather summaries (sol 1133, April 2024; not live), and a quiet-day radiation dose for the walk from Curiosity RAD's published average at Gale Crater (for scale only). An oxygen line gives NASA's planning rate for a spacewalk (0.086 kg per crew member per hour) times the time outside, about 0.25 kg each on the default walk; it is not a per-metre model, because we found no NASA measurement of suited walking at this pace in Mars gravity. The storm drill can replay the solar storm of 20 May 2024 from Curiosity RAD's archived readings (NASA PDS): 37 minutes from the alarm to the strongest reading, and the dose on the walk home. The 25 % warning rule the RAD team published (Löwe et al. 2025, Space Weather), applied by us to the same readings, picks the same reading as our own alarm line. The same paper advises staying within 30 minutes of shelter; the default walk goes further (53 minutes to be inside from its farthest point), the app says so, and an optional map layer draws the 30-minute line.
- **Deciding check:** the checks panel names the one check that decides the plan, where and when (default walk: the suit-failure check at Three Forks, about 8 min of backup oxygen to spare), and pins it on the map.
- **Straight lines:** a layer that draws straight lines between our own stops and marks where they cross no-go ground (default walk: 58 m; the planned route crosses none).
- **What if here?:** a map button; with it on, a click anywhere gives the walk home from that spot, the latest time to leave it (half-speed rule), and whether it is inside the 50-minute backup-oxygen line. Read from the walk-home layer.
- **Spoken alerts:** in the Astronaut view, off by default. The browser's own voice reads the status when it changes. It is not AI-generated audio.
- **Take it with you:** a one-page printable cuff card made from the current plan (our own sketch of the walk, stops with arrive and leave-by times, the three checks, the turn-back rules, the planning numbers and their sources) and a GeoJSON download of the route.
- **Daylight:** the walk day worked out with the NASA GISS Mars24 method: pick a start time in local solar time and see when the crew is back, when the Sun sets, and whether oxygen or daylight sets each leave-by time (flat horizon, no twilight margin).
- **Context:** Perseverance's real traverse.

## How the route is found
1. Slope and roughness come from the HiRISE DTM on a 2 m grid, corrected for the equirectangular projection (x is stretched by 1/cos(latitude)).
2. Each cell gets a walking time from a Tobler-style hiking function scaled to suited walking (0.56 m/s, NASA's 2 km/h planning pace, on flat ground).
3. Ground steeper than 15° is no-go. Rough ground (local relief above 0.35 m) takes 1.7× longer.
4. A least-cost path search (scikit-image `MCP_Geometric`) links the stops. A second search from base camp gives the walk-home time from every cell.
5. The plan must pass three checks at every point of the walk:
   - **Plan fits:** time so far + walk home at normal pace ≤ 8 h minus a 30 % reserve minus 2 h of airlock time
     (45 min to get out, 30 min of dust removal and 45 min to get back in, as in the Artemis III EVA study timeline).
   - **If something goes wrong:** time so far + walk home at half speed must fit the same time. The reserve stays untouched.
   - **Suit failure:** walk home ≤ 50 min (1 h of backup oxygen).

## Real-world checks
- Our slope map agrees with Perseverance's own tilt sensor at 189 rover stops: 1.33° average difference, 93 % within 3°.
- On the rover's climb to the delta top (sols 693–736), a straight line would cross 154 m of slopes steeper than 15°; our planned walk crosses none (`tools/rover_check.py` draws the map).

- In the same 1,000 simulated walks (each up to 20 % slower than planned, a crewmate hurt at a random moment), three plans on the same stops needed the reserve this often: planned with the usual walk-back rule, 320 times; planned with our rule, using all the time it allows, 111 times; our own plan, which also keeps 14 min spare, 18 times. Our rule costs 29 min at the stops. The first two plans are our own constructions, and the 0 to 20 % range is our assumption. With the slowdown drawn from NASA's Apollo records instead (travel time between stops, performed against planned, on 8 moonwalks: 0.69 to 1.83 times the plan; our sums of Appendix A of NASA/TP-2017-219457), the three numbers are 368, 256 and 224: the Apollo spread is harsher, and even our plan then needs its reserve in about one walk in five. Nobody went past the suit limit in any run. Re-run: `node validation/bad_day_simulation.mjs docs`.
- "How it works" in the app has a table, "What we checked, and what failed", with a limit next to every claim. Two limits to know: the walking time uses how steep the ground is, not which way the crew walks on it (uphill, downhill and across a slope cost the same); and the rover tilt test only covers ground the rover drove on, which is mostly gentle, so it says little about ground close to the 15° line.

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
python tools/rover_check.py
python tools/make_logo.py
# 3. serve the web app
python -m http.server 8765 --directory docs
```
Python packages: numpy, scipy, scikit-image, rasterio, pillow. The web app uses the Leaflet map library and the Barlow fonts.
All data, software and font credits are in DATA.md.

## Tests
Automated tests with Node's built-in test runner (no packages to install; checked with Node 24). From the repo folder:
```bash
node --test
```
90 tests pass (62 for the plan and the route engine, 8 for the Mars daylight method, 6 that re-run the 1,000-walk simulation, 2 that re-do the Apollo sums, 12 for the storm replay). They check the stored default plan (+43.2 min, +13.8 min, 42.4 of 50 min, home by T+3:36, leave by
T+2:11 and T+2:37), recompute it from the stored walk profile, check that no point of the walk is steeper than 15°,
recount the rover tilt test from its stored pairs, and run the browser's route engine (`docs/router.js`) on the 4 m
grid: the default walk comes out close to the stored 2 m plan, and with Tenby added both time checks fail (57 and 95 min).
The daylight tests reproduce the worked example on the NASA GISS Mars24 page for 6 January 2000.

## Use of AI tools
The code was written with help from an AI coding assistant (Claude by Anthropic). Claude also suggested the
first version of the site, the science stops and the route rules; the team reviewed and approved them and
asked for later changes. All data shown in the app come from NASA, USGS and ESA. The logo is drawn by our
code (`tools/make_logo.py`) from our own terrain map and the planned walk. Until 14 Nov 2026 the site used an
AI-generated badge (Higgsfield), labelled as AI-generated; it was replaced and is still in the git history. The
planner itself uses no AI-generated images. The 3D walk page (`docs/3d/`, opened by the "3D walk" link) shows one
AI-generated 3D astronaut model (Higgsfield, Meshy 6 text-to-3D) with an "AI-generated" label on screen;
`docs/3d/assets/ASTRONAUT_MODEL.md` gives the prompt and what was changed afterwards.

## License
Apache-2.0 (see LICENSE). NASA and USGS data keep their own terms; see DATA.md.
