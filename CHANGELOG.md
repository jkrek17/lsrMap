# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
