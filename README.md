# off-grid-data-center

An interactive site model of an off-grid data center that runs on sun-tracking solar, a 15 MWh battery and rice-husk biomass.

**Live:** open `docs/index.html`, or the GitHub Pages site for this repo.

## What it shows

- **A simulated day.** The sun crosses the sky, 77 single-axis tracker tables follow it, and power flows from the field, the battery and the biomass engine into the building. The strip at the bottom shows what powered the load every 15 minutes.
- **What happens when things go wrong.** Switch the weather to cloudy or overcast, take the biomass plant or the battery offline, or run on solar and battery alone, and watch when the site runs out of energy.
- **A year, hour by hour.** 8,760 hours for the designed plant and for solar and battery alone, with the uptime of each and the solar and battery size that 99.9 % would need without biomass.
- **Every part, up close.** Click any part to fly to it and read its data sheet: real dimensions, live values and the equation behind each one. Turn the whole site in 3D, or lift the data hall apart layer by layer.

## Controls

| Key | Action |
|---|---|
| Click a part | Fly to it and open its data sheet |
| ← → | Previous / next part |
| Esc | Back to the whole site |
| Space | Pause or play the day |
| ↑ ↓ | Raise or lower the IT load |
| V | Drawing / 3D |
| Y | The year |
| A | Lift the hall apart |
| T | Light / dark theme |

## Build

```sh
npm run build   # writes docs/index.html (follows the system theme), docs/light.html and docs/dark.html
npm run serve   # http://localhost:8137
```

Node 20 or later. `build.mjs` draws the site, `model.mjs` is the plant physics (cooling, pumps, UPS), `microgrid.mjs` the sun, trackers, battery, biomass dispatch and the annual simulation, `sheets.mjs` the data sheets and `live.mjs` the page's live code.

## Credits

The isometric drawing kit in `kit/` and the checking scripts in `scripts/` come from [Anatomy](https://github.com/wheresryan22/anatomy) (MIT, see `LICENSE-anatomy`). The 3D view uses [three.js](https://threejs.org) from cdnjs.

The weather year is a seeded synthetic series matched to monthly irradiance averages, not a bankable P50/P90 time series.
