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
| Curiosity RAD surface radiation (published values, not a data file) | NASA/JPL-Caltech/SwRI. Hassler et al. (2014), *Mars' Surface Radiation Environment Measured with the Mars Science Laboratory's Curiosity Rover*, Science 343, 1244797. Storm value: NASA/JPL news release, 10 June 2024. | https://doi.org/10.1126/science.1244797 and https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm/ | A quiet-day dose for the walk's time outside (0.21 mGy a day at Gale Crater) and, for scale, the 8,100 microgray RAD measured in the May 2024 solar storm. Shown for scale only; no dose limit is checked. |

Citation for the three Mars 2020 Terrain Relative Navigation products: Fergason, R. L., Hare, T. M., Mayer, D. P.,
Galuszka, D. M., Redding, B. L., Smith, E. D., Shinaman, J. R., Cheng, Y., Otero, R. E. (2020). *Mars 2020 Terrain
Relative Navigation Flight Product Generation: Digital Terrain Model and Orthorectified Image Mosaics.* 51st Lunar and
Planetary Science Conference.

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
| NumPy, SciPy, scikit-image, rasterio, Pillow | The Python build (`tools/`) | Open source (BSD-style licences; Pillow: MIT-CMU) | https://pypi.org/ |

The logo in the page header and the browser-tab icon are drawn by `tools/make_logo.py` from our own terrain shading
(HiRISE elevation model) and the planned walk. Until 14 Nov 2026 the site used an AI-generated badge (Higgsfield),
labelled as AI-generated; it was replaced and is still in the git history. No AI-generated images are used in the app now.

Base camp is not a checked landing site. It was placed on top of the delta so that the loop fits the time rules.
Within 100 m the ground reaches 19.5° on our 2 m slope grid; the Artemis III EVA study
(https://ntrs.nasa.gov/citations/20210026296) draws a 100 m landing circle with slopes under 5°.

NASA imagery and data are generally free to use with credit. USGS data are in the public domain.
Red Route does not use NASA logos or branding.
