# Data and credits for Red Route

## NASA and USGS data

| Dataset | Provider and credit | Link | How Red Route uses it |
|---|---|---|---|
| Mars 2020 Terrain Relative Navigation HiRISE DTM Mosaic, 1 m/px (`JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40`) | USGS Astrogeology, for NASA's Mars 2020 mission | https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_hirise_dtm_mosaic (DOI: https://doi.org/10.5066/P9REJ9JN) | Slope, roughness, walking cost, walk-home time, elevation profile |
| Mars 2020 Terrain Relative Navigation HiRISE Orthorectified Image Mosaic, 25 cm/px (Mars Trek layer `JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd`) | USGS; HiRISE images NASA/JPL/University of Arizona; tiles from NASA JPL Mars Trek | https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_hirise_orthorectified_image_mosaic | Main map background |
| Mars 2020 Terrain Relative Navigation CTX DTM Mosaic, 20 m/px | USGS Astrogeology | https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_ctx_dtm_mosaic | Coarse fallback for quick tests only |
| CTX Jezero mosaic (Mars Trek layer `Jezero_CTX_BlockAdj_dd`) | NASA/JPL/MSSS, via NASA JPL Mars Trek | https://trek.nasa.gov/mars/ | Background option |
| MGS MOLA colour shaded relief, 463 m/px (Mars Trek layer `Mars_MGS_MOLA_ClrShade_merge_global_463m`) | NASA (Mars Global Surveyor MOLA), via NASA JPL Mars Trek | https://trek.nasa.gov/mars/ | Background option |
| THEMIS night-time infrared controlled mosaic, 100 m/px (Mars Trek layer `THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018`) | Mars Odyssey THEMIS: NASA/JPL-Caltech/Arizona State University; tiles from NASA JPL Mars Trek | https://trek.nasa.gov/mars/ | Optional "Night heat" layer: rock stays warmer at night, loose sand and dust cool faster. Context only; not used in the route. |
| Perseverance waypoints and traverse (MMGIS) | NASA/JPL-Caltech | https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json and https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json | Stop locations, the rover's real path, and the rover's own tilt and elevation for the two tests |
| Perseverance raw images (Mastcam-Z, Navcam, Hazcam, SuperCam RMI) | NASA/JPL-Caltech. Mastcam-Z: NASA/JPL-Caltech/ASU. SuperCam: NASA/JPL-Caltech/LANL/CNES/IRAP. The app shows each photo's own credit. | https://mars.nasa.gov/mars2020/multimedia/raw-images/ | 16 photos per stop (dark, flat and repeated frames skipped) |
| Perseverance MEDA weather summaries | NASA/JPL-Caltech/CAB | https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json | Latest available summaries (sol 1133, April 2024; not live): temperatures, sunrise and sunset for the daylight check |
| DONKI space-weather notifications | NASA Community Coordinated Modeling Center (CCMC) | https://ccmc.gsfc.nasa.gov/tools/DONKI/ | Space-weather go/watch/shelter check, read live from the CCMC web service. If it does not answer, the app says NOT CHECKED and gives the date of its saved copy. A notice counts only when Mars is in its target list. |
| Curiosity RAD surface radiation (published values, not a data file) | NASA/JPL-Caltech/SwRI. Hassler et al. (2014), *Mars' Surface Radiation Environment Measured with the Mars Science Laboratory's Curiosity Rover*, Science 343, 1244797. Storm value: NASA/JPL news release, 10 June 2024. | https://doi.org/10.1126/science.1244797 and https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm/ | A quiet-day dose for the walk's time outside (0.21 mGy a day at Gale Crater) and, for scale, the 8,100 microgray NASA reported for a person next to Curiosity in the May 2024 solar storm (quoted, not computed with). Shown for scale only; no dose limit is checked. |
| Curiosity RAD dose rates, 16 to 23 May 2024 (data set `MSL-M-RAD-3-RDR-V1.0`, release 37, sols 4187 to 4193; the storm is in product `RAD_RDR_2024_140_18_30_4190_V00`; field `TOT_DOSE_E`, micrograys per hour) | NASA Planetary Data System, Planetary Plasma Interactions node (UCLA). RAD: NASA/JPL-Caltech/SwRI | https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/ | The storm drill's "Real storm" choice replays the solar storm of 20 May 2024: normal level 5.54 micrograys an hour, the first reading above 1.5 times that (our alarm line), the strongest reading 37 minutes later (351 micrograys an hour), and the dose on the walk home. `validation/rad_storm_2024-05/` holds the script that read the archive and its 692 readings; `docs/extra/storm-replay.js` holds the 32 readings the app uses. The alarm line and every sum are ours. |

Citation for the three Mars 2020 Terrain Relative Navigation products: Fergason, R. L., Hare, T. M., Mayer, D. P.,
Galuszka, D. M., Redding, B. L., Smith, E. D., Shinaman, J. R., Cheng, Y., Otero, R. E. (2020). *Mars 2020 Terrain
Relative Navigation Flight Product Generation: Digital Terrain Model and Orthorectified Image Mosaics.* 51st Lunar and
Planetary Science Conference.

## Methods and reference values

| What | From | Link | How Red Route uses it |
|---|---|---|---|
| Mars24 Sunclock algorithm and technical notes (after Allison and McEwen 2000, Planet. Space Sci. 48, 215-235) | NASA Goddard Institute for Space Studies | https://www.giss.nasa.gov/tools/mars24/help/algorithm.html and https://www.giss.nasa.gov/tools/mars24/help/notes.html | Mars local solar time, sunrise and sunset for the daylight block. Our code is tested against the page's worked example. |
| Life Support Baseline Values and Assumptions Document, NASA/TP-2015-218570 Rev 2 (February 2022), Table 4-70 | NASA | https://ntrs.nasa.gov/citations/20210024855 | The oxygen line under Conditions: 0.086 kg of oxygen per crew member per hour of spacewalk (an average workload of 295 W), times the time outside. For scale only. |
| Löwe et al. (2025), *Nowcasting Solar Energetic Particle Events for Mars Missions*, Space Weather 23, e2025SW004372 (open access, CC BY 4.0) | Kiel University, Southwest Research Institute and others (the team behind Curiosity's RAD) | https://doi.org/10.1029/2025SW004372 | For comparison only. Its 25 % warning rule, applied by us to the same RAD readings, picks the same reading as our own alarm line. Its advice to stay within 30 minutes of shelter is shown as an optional map layer and as a check the default walk fails. No check in the app uses it. |
| NASA/TP-2017-219457, *Operational Assessment of Apollo Lunar Surface Extravehicular Activity* (Miller et al., 2017), Appendix A, Tables A32 to A53 | NASA | https://ntrs.nasa.gov/citations/20170007261 | The Apollo case of the 1,000-walk simulation: travel time between stops, performed against planned, on 8 Apollo moonwalks (0.69 to 1.83 times the plan). The ratios are our own sums of the report's rows; `validation/apollo_traverse/` holds the rows and the script that read them, and a test re-does the sums. Moon, not Mars; 6 of the 8 moonwalks drove a rover. |
| NASA/TP-2009-214796, *Feasibility of Performing a Suited 10-km Ambulation on the Moon: Final Report of the EVA Walkback Test* (Norcross et al., 2009) | NASA (archived copy) | https://web.archive.org/web/20170503083749/https://ston.jsc.nasa.gov/collections/TRS//_techrep/TP-2009-214796.pdf | Why the oxygen line is a rate per hour and not per metre: NASA's suited walking tests in Mars gravity ran at 1.07 to 1.53 m/s, about twice our planning pace and faster. No number from it is used in the app. |
| "Speaking Percy's Language: How to Talk so Perseverance Will Listen" (NASA Science blog, 2021) | NASA | https://science.nasa.gov/blog/speaking-percys-language-how-to-talk-so-perseverance-will-listen/ | One sentence in "How it works": a radio signal takes 3 to 22 minutes each way between Earth and Mars, so the turn-back call has to be made on Mars. |
| Mars Fact Sheet | NASA NSSDC | https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html | The planet's shape, to turn the plan's latitude into the latitude Mars24 uses. |
| Apollo 11 glove checklists (a historical note on the printable cuff card) | NASA Apollo Lunar Surface Journal, "EVA Preparations" | https://www.nasa.gov/wp-content/uploads/static/history/alsj/a11/a11.evaprep.html | One sentence on the cuff card: Apollo crews wore a checklist page on the glove. |
| Leap seconds (Bulletin C) | IERS, Paris Observatory | https://hpiers.obspm.fr/iers/bul/bulc/Leap_Second.dat | The difference between atomic time and UTC, needed by the Mars24 method. |

## Space agency partner data

| Dataset | Provider and credit | Link | How Red Route uses it |
|---|---|---|---|
| Mars MGS MOLA - MEX HRSC Blended DEM Global 200 m, colour hillshade (Mars Trek layer `Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw`) | HRSC: ESA/DLR/FU Berlin (CC BY-SA 3.0 IGO). MOLA: NASA. Blended by USGS, served by NASA JPL Mars Trek. | https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m | Zoomed-out relief under the map, and a background option |

Citation: Fergason, R. L., Hare, T. M., Laura, J. (2018). *HRSC and MOLA Blended Digital Elevation Model at 200m v2.*
Astrogeology PDS Annex, U.S. Geological Survey.

## Software and fonts

| What | Used for | Licence | Link |
|---|---|---|---|
| Leaflet 1.9.4 | The map in the web app (loaded from cdnjs) | BSD 2-Clause | https://leafletjs.com/ |
| Barlow and Barlow Semi Condensed, by Jeremy Tribby | Fonts (loaded from Google Fonts) | SIL Open Font License 1.1 | https://fonts.google.com/specimen/Barlow |
| three.js r169 | The 3D walk page (bundled in `docs/3d/vendor/`) | MIT | https://threejs.org/ |
| NumPy, SciPy, scikit-image, rasterio, Pillow | The Python build (`tools/`) | Open source (BSD-style licences; Pillow: MIT-CMU) | https://pypi.org/ |

The logo in the page header and the browser-tab icon are drawn by `tools/make_logo.py` from our own terrain shading
(HiRISE elevation model) and the planned walk. Until 14 Nov 2026 the site used an AI-generated badge (Higgsfield),
labelled as AI-generated; it was replaced and is still in the git history. The planner itself uses no AI-generated images.

The 3D walk page (`docs/3d/`) shows one AI-generated 3D astronaut model (Higgsfield, Meshy 6 text-to-3D), with an
"AI-generated" label on screen. `docs/3d/assets/ASTRONAUT_MODEL.md` gives the prompt and what was changed afterwards;
`docs/3d/assets/GROUND_PICTURE.md` describes the two HiRISE ground pictures used there (`jezero_hirise_ortho.jpg`, the whole
grid at about 1.2 m per pixel, and `jezero_hirise_corridor.jpg`, a box around the route at about 0.3 m per pixel; both are
the HiRISE orthomosaic from NASA JPL Mars Trek tiles, NASA/JPL/University of Arizona and USGS, joined and cut, with
nothing drawn on them and no AI). On that page the Mars colours, the rocks (their places follow our rough-ground grid,
their shapes are made up), footprints, dust, the sky, the sun position, the habitat shape, the film look and the sound
are an illustration made by our code; the sound is not a recording. The astronaut model is the only AI-made thing there.

`docs/3d/assets/DATA_LAYERS.md` lists the page's other picture layers, all made from NASA data with no AI: the far ground and
crater rim on the horizon (CTX elevation model of Jezero, 20 m, USGS Astrogeology; CTX mosaic, NASA/JPL/MSSS, from NASA JPL
Mars Trek) and two layers worked out from the 1 m HiRISE elevation model (which way the ground faces, and where hills hide
the page's sun). The sun on the 3D page is fixed for the picture (low in the west-north-west); it is not the Mars24 daylight
of the planner. These layers change how the 3D picture looks and never change a time or a margin.

The second 3D page (`docs/walk3d/`, the hurt-crewmate drill) uses four ground pictures (`img/photo_*.jpg`): the HiRISE 25 cm
orthomosaic of Jezero (NASA/JPL/University of Arizona; mosaic by USGS Astrogeology) from NASA JPL Mars Trek tiles, joined, cut
to the terrain grid and tinted by the page (`docs/walk3d/img/photo.json`, `docs/walk3d/README.md`). Its figures, base camp, sky
and helmet rim are drawn by code: nothing on that page is AI-made. It uses three.js r169 (MIT) and Barlow (OFL), stored in
`docs/walk3d/vendor/`. Both 3D pages read the planner's own data files and route engine and change none of them.

Base camp is not a checked landing site. It was placed on top of the delta so that the loop fits the time rules.
Within 100 m the ground reaches 19.5° on our 2 m slope grid; the Artemis III EVA study
(https://ntrs.nasa.gov/citations/20210026296) draws a 100 m landing circle with slopes under 5°.

NASA imagery and data are generally free to use with credit. USGS data are in the public domain.
Red Route does not use NASA logos or branding.
