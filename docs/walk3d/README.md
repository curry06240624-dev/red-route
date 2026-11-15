# Red Route · 3D walk (add-on)

The planned Marswalk in 3D on the real terrain of Jezero Crater, with the hurt-crewmate drill.
It is a separate page next to the main app (`walk3d/`). It reads the main app's data files and uses its route engine.

## What it shows

- **Third person (the lead).** EV1 and EV2 walk the planned route. The green area on the ground is where a hurt crewmate could still be helped home at half speed in the time left; it shrinks as the clock runs.
- **Crewmate hurt here.** EV2 goes down, EV1 helps them home at half speed, and a clock runs the walk home against the time left. It ends with the verdict the main app's drill card gives.
- **What if: add a third stop, Tenby.** The plan is re-made by the app's own route engine. It fails, and the view shows TURN BACK.
- **Helmet view.** First person at eye height, inside a helmet rim drawn in code, with our own read-outs: status word, time to spare, the hurt-crewmate margin, leave-by, must-be-home-by, the walk home against the 50 min of backup oxygen, time outside, height and slope, and the three checks. Drag to look.
- **Whole walk.** The route and the green area from above.

## The numbers are the main app's numbers

The page reads the same files (`docs/data`), uses the same route engine (`docs/router.js`, as a web worker) and the same rules (`plan.js`, copied from `docs/app.js`). For the default walk it shows the stored plan, like the app does.

## Run it

```
py -3.12 -m http.server 8077 --directory docs
```

Then open `http://localhost:8077/walk3d/`. Nothing is loaded from another site: three.js and the fonts are stored in `vendor/`.

Add `?mesh=2` (or 3, 4) for a lighter ground mesh. Phones use 2 by default.

## Files

| File | What it does |
|---|---|
| `index.html`, `walk3d.css` | The page and its look (the main app's look: Barlow, route red, thin panels). |
| `main.js` | Scene, crew, clock, drill, cameras, panels. |
| `terrain.js` | The ground mesh from `grid_dem.i16`, its colour, the green area. |
| `crew.js` | EV1, EV2 and the base-camp module, built from simple shapes in code. |
| `plan.js` | The plan maths, copied from `docs/app.js`. |
| `vendor/` | three.js r169 (MIT) and the Barlow fonts (SIL OFL), with their licences. |

## Credits and limits

- Terrain: HiRISE digital terrain model of Jezero, 1 m (USGS Astrogeology, Mars 2020 landing products). Credit: NASA/JPL/University of Arizona/USGS. Shown on the app's 4 m grid at true vertical scale.
- Software: three.js r169, MIT licence. Barlow fonts, SIL Open Font License.
- Ground picture: the real HiRISE 25 cm orbital photo of Jezero (NASA/JPL/University of Arizona, mosaic by USGS Astrogeology), tiles from NASA JPL Mars Trek, stitched to the terrain grid (`img/photo_*.jpg`).
- Drawn by our code, not data: the two crew figures, the base-camp module, the sky and sun, the fine ground grain, and the flat ground outside the mapped area (4.7 km by 2.1 km).
- No AI-made images or models. The helmet rim in the helmet view is drawn by our code (CSS).
- The clock runs fast; the label next to the play button gives the speed.
- AI use: the code was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in the repo's README.md.
