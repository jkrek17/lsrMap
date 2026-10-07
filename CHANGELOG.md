# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.0] - 2026-10-07

### Added
- Playback & Live page (`playback.html`): a timeline with a report-count
  histogram, play/pause/step/speed, cumulative reports with the most recent
  highlighted, IEM archived radar synced to the clock, and the storm-based
  warnings in effect at each moment. The URL keeps range, filters and playhead.
- Live mode now lives on that page (window ending at now, refreshed every
  minute, LIVE badge, last-hour radar loop). The main map's Live and Playback
  buttons open it with the current filters.
- Smooth playback: the clock runs every animation frame (speed in weather
  minutes per second); reports and warnings change through MapLibre feature
  state, so only the features that change are updated (no tile rebuilds); new
  reports fade in with a settling halo.
- Radar: crossfades between frames, loads ahead with a "Buffering radar…"
  hold, requests tiles only inside the composite's extent, thins frames when
  playing fast; opacity slider (default 70%), dBZ legend with IEM's N0Q
  colors, radar frame time in the readout, warning outlines drawn above it.

### Changed
- Map creation and click routing are shared (`js/map/mapSetup.js`).

### Removed
- The main map's built-in live mode and radar loop (moved to the new page).

### Fixed
- Share links never included the selected weather types.

## [3.0.0] - 2026-10-07

### Changed
- Map rendering moved from Leaflet to MapLibre GL JS (WebGL). All reports are drawn
  as one symbol layer, so 10,000+ reports display at once; the 5,000-marker cap,
  zoom-based limits and viewport filtering are off by default (still configurable).
- Basemap is self-hosted: OpenStreetMap vector tiles in `basemap/us-core.pmtiles`
  (states, counties, coastlines, interstates, cities), muted light and dark styles.
  No external tile servers (fixes the OpenStreetMap "Access blocked" 403 tiles).
- Optional street-level detail from a PMTiles file on the web server
  (`CONFIG.BASEMAP.STREETS_URL`, built with `tools/basemap/build-streets.sh`), with
  automatic fallback to the core basemap.
- Severe report types and larger magnitudes draw on top of overlapping icons.
- Automatic refreshes (live mode, auto refresh) and filter changes no longer
  re-zoom the map.
- Zoom levels follow MapLibre (one lower than Leaflet's): `MAP_INITIAL.zoom` is 3.

### Fixed
- Warnings / watches layers never loaded: the request allowlist blocked the IEM
  warnings endpoint.

### Removed
- Leaflet, the Esri basemap tiles and their CSP entries.

## [2.0.0] - 2024-01-15

### Added
- ES6 module architecture with clear separation of concerns
- Client-side caching with localStorage (5-minute TTL, 10MB limit)
- Request management with deduplication and cancellation
- Comprehensive error handling with retry logic
- Offline detection and notifications
- Production-ready error logging (development-only)
- Centralized state management
- Performance optimizations (zoom-based limits, viewport filtering)
- Export functionality (CSV, JSON, GeoJSON)
- Keyboard shortcuts (G, C, S, E, ?)
- Help modal with documentation
- Shareable URLs with state persistence
- Public Information Statements (PNS) integration
- Top 10 reports by type feature
- Quick filter buttons (Severe, Winter, Precipitation)
- Date presets for common queries
- Progress indicators for large datasets
- Performance feedback banner
- Empty state messages
- Tooltips for improved discoverability

### Changed
- Refactored from monolithic file to modular architecture
- Improved popup design with better visual hierarchy
- Enhanced marker icon system with color coding
- Better error messages with retry functionality
- Improved mobile responsiveness
- Optimized marker rendering with batch processing

### Fixed
- Duplicate function declarations
- Zoom-out marker disclosure bug
- Export menu UX issues
- Filter state management
- Memory leaks in marker management

### Security
- Added HTML escaping in popup content (XSS protection)
- Added Subresource Integrity (SRI) for CDN resources
- Production-safe error logging

## [1.0.0] - Initial Release

### Added
- Basic map functionality with Leaflet.js
- Report filtering by type, date, and region
- Interactive markers with popups
- Basic data export
- Responsive design

---

[2.0.0]: https://github.com/yourusername/nws-lsr-map/releases/tag/v2.0.0
[1.0.0]: https://github.com/yourusername/nws-lsr-map/releases/tag/v1.0.0
