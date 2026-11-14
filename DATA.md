# Data used by Red Route

| Dataset | Provider | Link | How Red Route uses it |
|---|---|---|---|
| Mars 2020 TRN HiRISE DTM, 1 m/px (`JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40`) | USGS Astrogeology (Mars 2020 project) | https://planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/ | Slope, roughness, walking cost, elevation profile |
| Mars 2020 TRN CTX DTM, 20 m/px | USGS Astrogeology | https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ | Coarse fallback for quick tests |
| HiRISE Jezero orthomosaic, 25 cm/px (`JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd`) | USGS / NASA JPL Mars Trek tile service | https://trek.nasa.gov/mars/ | Main map background |
| CTX Jezero mosaic (`Jezero_CTX_BlockAdj_dd`) | NASA JPL Mars Trek | https://trek.nasa.gov/mars/ | Background option |
| MOLA colour shaded relief | NASA JPL Mars Trek | https://trek.nasa.gov/mars/ | Background option |
| Mars Express HRSC + MGS MOLA blended elevation, colour hillshade, 200 m/px (`Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw`) | ESA/DLR/FU Berlin (HRSC) + NASA (MOLA), blend by USGS, served by NASA JPL Mars Trek | https://trek.nasa.gov/mars/ | Zoomed-out context and background option (partner-agency data) |
| Perseverance waypoints + traverse (MMGIS) | NASA/JPL-Caltech | https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json | Stop locations, rover path layer |
| Perseverance raw images (Navcam, Mastcam-Z, Hazcam) | NASA/JPL-Caltech | https://mars.nasa.gov/mars2020/multimedia/raw-images/ | "What you'll see" photos at each stop |
| Perseverance MEDA weather summaries | NASA/JPL-Caltech | https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json | Temperature, pressure, sunrise/sunset |
| DONKI space-weather notifications | NASA CCMC via api.nasa.gov | https://api.nasa.gov/ | Live space-weather go/watch/shelter check |

NASA imagery and data are generally free to use with credit ("NASA/JPL-Caltech", "NASA/JPL/University of Arizona").
USGS data are in the public domain. Red Route does not use NASA logos or branding.
