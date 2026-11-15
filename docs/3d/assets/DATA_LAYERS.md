# Data layers of the 3D walk (all NASA data, made on 15 November 2026)

These files sit next to the pictures described in `GROUND_PICTURE.md`. None of them was made or changed by AI.
They change how the 3D picture looks. They never change a time or a margin: those come from the planner's own files in `docs/data/`.

| File | What it is | Made from |
|---|---|---|
| `jezero_far_dem.i16` + `jezero_far.json` | Height of the ground far around the walk (crater floor, delta, crater rim), 420 x 400 cells of about 75 m. 16-bit little-endian; metres = value x 0.25 - 4000. | CTX elevation model of Jezero, 20 m (USGS Astrogeology, Mars 2020 TRN CTX DTM), averaged down |
| `jezero_ctx_far.jpg` | Picture of that far ground, 2048 x 1940 | CTX mosaic of Jezero (NASA/JPL/MSSS; layer `Jezero_CTX_BlockAdj_dd` from NASA Mars Trek, zoom 12), 156 tiles joined and cut |
| `jezero_relief_1m.jpg` | Which way the ground faces (a normal map), 1 m per pixel, for the box around the route (grid columns 373 to 577, rows 129 to 444). Red = east, green = up, blue = south. | HiRISE elevation model of Jezero, 1 m (USGS Astrogeology, Mars 2020 TRN HiRISE DTM), lightly smoothed |
| `jezero_sun_shadow.png` | Where hills hide the 3D page's sun (white = sunlit, black = in shadow), 2 m per pixel over the whole terrain grid | The same HiRISE 1 m elevation model, by following a line toward the sun from every cell |

Notes:

- The sun of the 3D page is fixed for the picture: low in the west-north-west, about 14 degrees above the horizon. It is not worked
  out from a date or a time. The shadow layer was made for exactly that direction (`SUN_DIR` in `world.js`).
- Longitude 77.165 to 77.695 E and latitude 18.215 to 18.717 N for the far ground. Inside the walk's own grid the far ground is left
  out, and it is set 8 m lower than the CTX model says so that it stays under the HiRISE ground where the two overlap
  (CTX reads 1.3 m higher than HiRISE there on average).
- Credits: HiRISE: NASA/JPL/University of Arizona. CTX: NASA/JPL/MSSS. Elevation models and mosaics: USGS Astrogeology Science Center,
  Mars 2020 landing-site products. Map tiles: NASA JPL Mars Trek.
