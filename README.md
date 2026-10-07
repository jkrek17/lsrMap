# NWS Local Storm Reports - Interactive Map

A modern, interactive web application for visualizing National Weather Service (NWS) Local Storm Reports (LSR) on an interactive map. Built with vanilla JavaScript, MapLibre GL JS (WebGL), and ES6 modules, on a self-hosted vector basemap (no external tile servers).

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-yellow.svg)
![MapLibre](https://img.shields.io/badge/MapLibre_GL-6.13-green.svg)

## Features

- 🗺️ **Interactive Map** - WebGL map (MapLibre GL JS) that draws 10,000+ storm reports at once, with warnings, radar and boundary layers
- 🧭 **Self-Hosted Basemap** - OpenStreetMap vector tiles (states, counties, coastlines, interstates, cities) served from this site as PMTiles; optional street-level detail file on the server; light and dark styles
- 🔍 **Advanced Filtering** - Filter by report type, date range, and geographic region with real-time map updates
- 📊 **Real-time Data** - Live mode with automatic refresh for current conditions
- 💾 **Client-side Caching** - Intelligent caching with localStorage for improved performance
- 🔄 **Request Management** - Automatic retry logic with exponential backoff
- 📱 **Responsive Design** - Works seamlessly on desktop, tablet, and mobile devices
- ⌨️ **Keyboard Shortcuts** - Power user features for quick navigation
- 📤 **Data Export** - Export filtered data as CSV, JSON, or GeoJSON (includes both LSR and PNS reports)
- 🌐 **Offline Detection** - Automatic detection and notification of network status
- 🎯 **Performance Optimized** - WebGL rendering, request caching and deduplication
- 📋 **Public Information Statements (PNS)** - View and filter NWS PNS statements with metadata parsing
- 🌡️ **Temperature Reports** - Specialized icons for temperature reports (extreme cold, heat index, wind chill)
- ❄️ **Weather Differentiation** - Visual distinction between freezing rain (red border) and sleet
- 📈 **Statistics & Insights** - View top reports by type, magnitude statistics, and comprehensive report counts
- 🔄 **Unified Filtering** - Weather type filters work seamlessly with both LSR and PNS reports
- ⏳ **Loading Indicators** - Clear feedback during data fetching and PNS processing

## Demo

[Live Demo](https://your-domain.com) *(Update with your deployment URL)*

## Screenshots

*Add screenshots of your application here*

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Usage](#usage)
- [Architecture](#architecture)
- [API Documentation](#api-documentation)
- [Deployment](#deployment)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Installation

### Prerequisites

- A modern web browser (Chrome, Firefox, Safari, Edge)
- A web server (Apache, Nginx, or any static file server)
- PHP 7.4+ (optional, for server-side caching)

### Quick Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/nws-lsr-map.git
   cd nws-lsr-map
   ```

2. **Set file permissions (recommended):**
   ```bash
   # Linux/Mac
   chmod +x set-permissions.sh
   ./set-permissions.sh
   
   # Or with PHP cache support
   ./set-permissions.sh --cache
   
   # Or run PHP version (works on server)
   php set-permissions.php --cache
   ```

3. **Serve the application:**
   
   **Option A: Using PHP built-in server (for development):**
   ```bash
   php -S localhost:8000
   ```
   Then open `http://localhost:8000` in your browser.

   **Option B: Using a static file server (no PHP required):**
   ```bash
   # Using Python
   python -m http.server 8000
   
   # Using Node.js http-server
   npx http-server -p 8000
   
   # Using any static file server
   ```
   The application works perfectly without PHP - it will automatically use the source API directly.

   **Option C: Using a web server with PHP (for caching):**
   - Copy all files to your web server's document root
   - Run `php set-permissions.php --cache` on the server (or use FTP client)
   - Ensure the server can serve static files and execute PHP (for optional caching)

3. **Configure caching (optional but recommended):**
   
   See [CACHE-SETUP.md](CACHE-SETUP.md) for detailed instructions on setting up the server-side cache system. 
   
   **Note:** The application works perfectly without server-side caching. If PHP is not configured, the application automatically falls back to the source API. Queries for the last 24 hours always use the source API directly for real-time data, regardless of cache configuration.

## Quick Start

1. Open `index.html` in a web browser or serve via a web server
2. Select a date range using the date pickers or preset buttons
3. Optionally select a geographic region (state or region)
4. Click "Fetch Data" or press `G` to load storm reports
5. Click on markers to view detailed report information
6. Use filters to narrow down results by report type

## Configuration

Configuration is managed in `config.js`. Key settings include:

### Map Settings
```javascript
CONFIG = {
    ICON_SIZE: 28,                    // Marker icon size in pixels
    MAP_INITIAL: {
        lat: 39.8283,                 // Initial map center latitude
        lon: -98.5795,                // Initial map center longitude
        zoom: 3                       // Initial zoom level (MapLibre levels: Leaflet level - 1)
    },
    BASEMAP: {
        CORE_URL: 'basemap/us-core.pmtiles', // In-repo US basemap (max zoom 7, overzoomed)
        STREETS_URL: ''                      // Optional street-detail PMTiles on the server
    }
}
```

### Performance Settings
```javascript
CONFIG = {
    MAX_MARKERS: 100000,              // Safety valve; WebGL draws all reports at once
    VIEWPORT_ONLY: false,             // true: only count/show reports in the viewport when zoomed in
    MIN_ZOOM_FOR_VIEWPORT: 5,         // Minimum zoom for viewport filtering
    ZOOM_BASED_LIMITS: {}             // Optional marker limits by zoom level, e.g. { 3: 20000 }
}
```

### Cache Settings
Client-side caching is configured in `js/cache/cacheService.js`:
- Default TTL: 5 minutes
- Max cache size: 10MB
- Automatic cleanup of expired entries

## Usage

### Basic Operations

- **Load Data**: Click "Fetch Data" button or press `G`
- **Clear Map**: Click "Clear Map" button or press `C`
- **Share Link**: Click "Share Link" button or press `S` to generate a shareable URL
- **Export Data**: Click "Export Data" button or press `E` to export filtered data
- **Help**: Click "Help" button or press `?` to view keyboard shortcuts

### Filtering

1. **By Report Type**: Check/uncheck report type chips in the filter panel (applies to both LSR and PNS reports)
   - Clicking a weather type button immediately updates the map without needing to click "Get Data"
   - All filters active = show all reports
   - No filters active = hide all reports
   - Some filters active = show only matching reports
2. **By Date Range**: Use date pickers or preset buttons (Last 24h, Last 48h, Last Week, Custom)
3. **By Region**: Select a state or region from the dropdown to automatically filter and zoom
4. **Quick Filters**: Use preset buttons for:
   - **Severe**: Tornado, Hail, Wind, Thunderstorm
   - **Winter**: Snow, Ice
   - **Precipitation**: Rain, Flood, Coastal Flooding
   - **Tropical**: Rain, Flood, Coastal Flooding, Tropical

### PNS (Public Information Statements)

PNS reports are automatically parsed from NWS products:
- **Metadata Parsing**: Automatically extracts location, type, magnitude, and description from PNS text
- **Fallback Locations**: Uses WFO office coordinates when metadata is unavailable
- **Type Matching**: Intelligently matches PNS types to weather filters (Snow, Rain, Wind, Temperature, etc.)
- **Filtering**: PNS markers respect the same weather type filters as LSR reports
- **Performance**: Same performance optimizations apply (viewport filtering, zoom limits, MAX_MARKERS)
- **Integration**: Included in report counts, statistics, and data exports

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `G` | Fetch/Refresh data |
| `C` | Clear map |
| `S` | Share link |
| `E` | Export data |
| `?` | Show help |

### Export Options

The application supports exporting filtered data in three formats:

- **CSV**: Comma-separated values for spreadsheet applications
- **JSON**: JavaScript Object Notation for data processing
- **GeoJSON**: Geographic JSON format for GIS applications

## Architecture

The application is built with a modular architecture using ES6 modules:

```
/
├── index.html              # Main HTML file
├── app.js                  # Main application entry point
├── config.js               # Configuration file
├── styles.css              # Application styles
├── basemap/                # Self-hosted basemap: us-core.pmtiles, county GeoJSON, fonts, sprites
├── lib/                    # Vendored MapLibre GL, PMTiles, Protomaps style layers, Font Awesome
├── tools/basemap/          # Scripts that rebuild the basemap and the optional street-detail file
├── js/
│   ├── api/                # API services
│   │   ├── lsrService.js   # LSR API service
│   │   ├── pnsService.js   # PNS (Public Information Statements) API service
│   │   ├── warningsService.js # NWS warnings service
│   │   └── requestManager.js # Request management & retry logic
│   ├── cache/              # Caching services
│   │   └── cacheService.js # Client-side caching
│   ├── errors/             # Error handling
│   │   └── errorHandler.js # Centralized error handling
│   ├── filter/             # Filtering services
│   │   └── filterService.js # Marker filtering & performance optimization
│   ├── map/                # Map-related services
│   │   ├── basemap.js      # Self-hosted basemap style, light/dark themes, street-detail fallback
│   │   ├── boundaryOverlays.js # NWS state / CWA / region polygons
│   │   ├── iconService.js  # Weather-specific icons, drawn once per style for WebGL
│   │   ├── overlayLayers.js # Area outline, warnings/watches, radar frames
│   │   ├── reportLayer.js  # LSR / PNS reports as a WebGL symbol layer with popups
│   │   └── popupService.js # Popup content generation
│   ├── state/              # State management
│   │   └── appState.js     # Application state
│   ├── ui/                 # UI services
│   │   ├── toastService.js # Status notifications
│   │   ├── statisticsService.js # Statistics calculation and display
│   │   └── reportCountService.js # Report count and performance messaging
│   └── utils/              # Utilities
│       ├── formatters.js   # Data formatting and unit conversion
│       └── offlineDetector.js # Network status detection
└── api/                    # Server-side API (optional)
    ├── cache.php           # Cache API endpoint
    ├── update-cache.php    # Cache update script
    └── cleanup-cache.php   # Cache cleanup script
```

### Key Components

- **LSR Service**: Handles LSR API communication with automatic caching and fallback
- **PNS Service**: Fetches and parses NWS Public Information Statements with metadata extraction
- **Warnings Service**: Manages NWS weather warnings overlay
- **Request Manager**: Manages request deduplication, cancellation, and retry logic
- **Filter Service**: Handles marker filtering for both LSR and PNS with performance optimizations
- **Statistics Service**: Calculates and displays weather statistics and top reports
- **Report Count Service**: Manages report counts and performance warnings
- **Cache Service**: Client-side caching with localStorage
- **Error Handler**: Centralized error handling with production-safe logging
- **State Management**: Centralized application state with change listeners
- **Icon Service**: Creates weather-specific icons with color coding and special borders

## API Documentation

### Data Sources

The application fetches data from:
- **LSR Primary**: Iowa State Mesonet API (`https://mesonet.agron.iastate.edu/geojson/lsr.php`)
- **Cache API**: Local cache endpoint (`api/cache.php`) for recent data (last 7 days)
- **PNS Data**: NWS API for Public Information Statements (`https://api.weather.gov/products/types/PNS`)
- **Warnings**: NWS API for active weather warnings (`https://api.weather.gov/alerts/active`)

### Report Types Supported

The application supports filtering and displaying the following report types:
- **Rain** - Precipitation reports
- **Flood** - Flooding events (non-coastal)
- **Coastal Flooding** - Coastal flood and storm surge events
- **Snow** - Snowfall and snow accumulation (including snow squalls)
- **Ice** - Ice accumulation, freezing rain (red border), sleet
- **Hail** - Hail size reports
- **Wind** - Wind speed and gust reports
- **Thunderstorm** - Thunderstorm activity
- **Tornado** - Tornado reports
- **Tropical** - Tropical storm and hurricane reports
- **Temperature** - Extreme cold, heat index, wind chill, temperature extremes
- **Other** - Miscellaneous weather reports

### API Endpoints

#### LSR Data
```
GET /api/cache.php?start=YYYY-MM-DD&startHour=HH:MM&end=YYYY-MM-DD&endHour=HH:MM
```

Returns GeoJSON format:
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [lon, lat]
      },
      "properties": {
        "type": "report_type_code",
        "magnitude": 1.5,
        "remark": "Report description",
        "city": "City Name",
        "st": "ST",
        "valid": "2024-01-15T12:00:00Z"
      }
    }
  ]
}
```

## Deployment

### Production Checklist

- [ ] Update API endpoints in `js/api/lsrService.js` if needed
- [ ] Configure server-side caching (see [CACHE-SETUP.md](CACHE-SETUP.md))
- [ ] Set up HTTPS for secure connections
- [ ] Configure CORS headers if serving from different domain
- [ ] Enable gzip compression for static assets
- [ ] Set appropriate cache headers
- [ ] Test offline functionality
- [ ] Verify error handling and logging

### Server Configuration

#### Apache (.htaccess)
```apache
# Enable CORS
Header set Access-Control-Allow-Origin "*"

# Enable compression
<IfModule mod_deflate.c>
    AddOutputFilterByType DEFLATE text/html text/plain text/xml text/css text/javascript application/javascript application/json
</IfModule>

# Cache static assets
<IfModule mod_expires.c>
    ExpiresActive On
    ExpiresByType text/css "access plus 1 year"
    ExpiresByType application/javascript "access plus 1 year"
</IfModule>
```

#### Nginx
```nginx
# Enable gzip
gzip on;
gzip_types text/css application/javascript application/json;

# Cache static assets
location ~* \.(css|js)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

## Development

### Project Structure

The codebase follows a modular architecture with clear separation of concerns:

- **Modules**: Each module has a single responsibility
- **Services**: Reusable services for common functionality
- **Error Handling**: Centralized error handling throughout
- **State Management**: Centralized state with change listeners

### Adding New Features

1. Create a new module in the appropriate directory
2. Export functions/classes from the module
3. Import and use in `app.js` or other modules
4. Update configuration in `config.js` if needed
5. Add tests if applicable

### Code Style

- Use ES6+ features (modules, arrow functions, destructuring)
- Follow existing code patterns
- Add JSDoc comments for public functions
- Keep functions focused and single-purpose

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Performance

The application includes several performance optimizations:

- **Client-side caching**: Reduces API calls
- **Request deduplication**: Prevents duplicate requests
- **WebGL rendering**: All reports are one MapLibre symbol layer; each distinct icon is drawn once and shared, so tens of thousands of reports stay smooth
- **Vector basemap from one file**: PMTiles read with HTTP range requests; only the visible tiles are downloaded
- **Optional limits**: Viewport filtering and zoom-based limits remain available in `config.js` but are off by default

## Troubleshooting

### Map Not Loading
- Check browser console for errors
- Open `test-data.html`: it checks that MapLibre loads and that the server answers range requests for the basemap
- The browser must support WebGL (any current desktop or mobile browser)
- Ensure `CONFIG` is defined in `config.js`

### Data Not Loading
- Check network connectivity
- Verify API endpoints are accessible
- Check browser console for API errors
- Try disabling browser extensions

### Performance Issues
- Reduce `MAX_MARKERS` in config
- Enable `VIEWPORT_ONLY` filtering
- Adjust `ZOOM_BASED_LIMITS` for your use case

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Setup

1. Clone the repository
2. Serve using a local web server
3. Make changes and test in browser
4. Ensure no console errors
5. Test on multiple browsers

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Iowa State Mesonet](https://mesonet.agron.iastate.edu/) for providing the LSR API
- [MapLibre GL JS](https://maplibre.org/) for the WebGL map
- [Protomaps](https://protomaps.com/) for the basemap tiles, style layers and PMTiles format
- [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) for the basemap data
- US Census Bureau for county boundaries
- [Font Awesome](https://fontawesome.com/) for icons
- National Weather Service for the data

## Support

For issues, questions, or contributions:
- Open an issue on GitHub
- Check existing issues for solutions
- Review the documentation

## Changelog

### Version 2.1.0 (Current)
- Added comprehensive PNS (Public Information Statements) support with metadata parsing
- Refactored filtering, statistics, and report counting into dedicated services
- Added temperature report detection (extreme cold, heat index, wind chill)
- Added freezing rain visual differentiation (red border)
- Added snow squall support with proper icon mapping
- Improved weather type filtering with real-time map updates
- Added loading indicators for PNS processing
- Enhanced PNS type matching for better filter integration
- Unified filtering system for LSR and PNS reports
- Improved statistics and report count services
- Better error handling and user feedback

### Version 2.0.0
- Refactored to ES6 modules
- Added client-side caching
- Implemented request management and retry logic
- Added comprehensive error handling
- Improved offline detection
- Enhanced performance optimizations
- Added PNS basic integration
- Top 10 reports by type feature
- Quick filter buttons
- Date presets
- Shareable URLs with state persistence

### Version 1.0.0
- Initial release
- Basic map functionality
- Report filtering
- Data export

---

**Made with ❤️ for weather enthusiasts and developers**
