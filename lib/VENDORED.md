# Vendored libraries

Served from this directory so the app needs no CDN (the CSP allows scripts from `'self'` only).
Source-map comments were removed so browsers do not request maps that are not shipped.

| Directory | Package | Version | License |
|---|---|---|---|
| `maplibre/` | [maplibre-gl](https://github.com/maplibre/maplibre-gl-js) (`dist/maplibre-gl.mjs`, `maplibre-gl-worker.mjs`, `maplibre-gl.css`) | 6.13.0 | BSD-3-Clause (`maplibre/LICENSE.txt`) |
| `pmtiles/` | [pmtiles](https://github.com/protomaps/PMTiles) (`dist/pmtiles.js`, IIFE build, global `pmtiles`) | 4.5.0 | BSD-3-Clause |
| `protomaps-basemaps/` | [@protomaps/basemaps](https://github.com/protomaps/basemaps) (`dist/esm/index.js`) | 5.7.2 | BSD-3-Clause |
| `fontawesome/` | Font Awesome Free | | Icons CC BY 4.0, fonts SIL OFL 1.1, code MIT |

The MapLibre worker (`maplibre-gl-worker.mjs`) must stay next to `maplibre-gl.mjs`; MapLibre finds it relative to its own URL.

To update: `npm pack <package>@<version>`, copy the same files, remove the `//# sourceMappingURL=` line, and update this table.
The `@protomaps/basemaps` major version must match the tile schema of `basemap/us-core.pmtiles` (v4 tiles ↔ 5.x package).
