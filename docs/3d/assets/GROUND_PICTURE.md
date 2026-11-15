# The ground picture (NASA data)

`jezero_hirise_ortho.jpg` is the **HiRISE orthomosaic of Jezero Crater**, cut to the area of the Red Route terrain grid.

| | |
|---|---|
| Data | HiRISE orthomosaic, layer `JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd` |
| Credit | NASA/JPL/University of Arizona (HiRISE); mosaic by USGS for the Mars 2020 landing site |
| From | NASA JPL Mars Trek map tiles (https://trek.nasa.gov/mars/), zoom level 15, about 1.27 m per pixel |
| Area | longitude 77.3720 to 77.4559 E, latitude 18.4440 to 18.4800 N (the same box as `docs/data/grid_dem.i16`) |
| Made | 15 November 2026: 128 tiles downloaded, joined, cut to the box, saved as one 4096 x 1850 JPEG |

It is the same imagery the main app shows as its "HiRISE 25 cm" base map. Nothing was drawn on it and no AI was used on it.
The camera band is grey. In the 3D walk, `world.js` gives it Mars colours with a fixed colour ramp and adds a fine
grain close to the viewer. The shape of the ground comes from the HiRISE elevation model, not from this picture.
