// ============================================================================
// MODULE IMPORTS
// ============================================================================

import { formatDateForAPI, extractWindSpeed, getUnitForReportType, getReportTypeName } from './js/utils/formatters.js';
import { errorHandler, ERROR_TYPES } from './js/errors/errorHandler.js';
import { cacheService } from './js/cache/cacheService.js';
import { requestManager } from './js/api/requestManager.js';
import LSRService from './js/api/lsrService.js';
import { offlineDetector } from './js/utils/offlineDetector.js';
import { appState } from './js/state/appState.js';
import { createIcon, getIconForReport } from './js/map/iconService.js';
import { addMarkersInBatches } from './js/map/markerService.js';
import { showStatusToast } from './js/ui/toastService.js';
import WarningsService from './js/api/warningsService.js';

// ============================================================================
// MAP INITIALIZATION
// ============================================================================

// Map will be initialized in DOMContentLoaded
let map = null;
let baseTileLayer = null; // Base map tile layer
let markersLayer = null;
let heatMapLayer = null; // Heat map layer
let heatMapMode = false; // Whether heat map mode is active
let pnsLayer = null; // Layer for Public Information Statements
let showPNS = false; // Toggle for PNS display
let warningsLayer = null; // Layer for NWS warnings/alerts
let showWarnings = false; // Toggle for warnings display
let warningsService = null; // Warnings service instance
let userArea = null;
let radarLayer = null; // Legacy - keeping for compatibility
let radarLayers = []; // Array of tile layers for animation
let radarLayerGroup = null; // Layer group to hold all radar layers
let liveModeActive = false;
let liveModeInterval = null;
let lastUpdateTime = null;
let radarTimestamps = [];
let radarAnimationIndex = 0;
let radarAnimationInterval = null;
let radarAnimationPlaying = false;
let radarRefreshInterval = null;

// Initialize LSR Service
let lsrService = null;

// ============================================================================
// ICON CREATION (wrapper functions for compatibility)
// ============================================================================

// Wrapper to maintain compatibility with existing code
function createIconWrapper(config, fillColor, strokeColor, emoji = null) {
    if (typeof CONFIG === 'undefined') {
        console.error('CONFIG not available');
        return null;
    }
    return createIcon(config, fillColor, strokeColor, emoji, CONFIG.ICON_SIZE);
}

// Wrapper for getIconForReport
function getIconForReportWrapper(rtype, magnitude, remark) {
    if (typeof CONFIG === 'undefined' || typeof ICON_CONFIG === 'undefined') {
        console.error('CONFIG or ICON_CONFIG not available');
        return null;
    }
    return getIconForReport(rtype, magnitude, remark, ICON_CONFIG, CONFIG.ICON_SIZE, extractWindSpeed);
}

// ============================================================================
// API FETCHING - Now using LSRService module
// ============================================================================

// ============================================================================
// STATUS TOAST - Now using toastService module (imported above)
// ============================================================================

// ============================================================================
// FILTER SUMMARY
// ============================================================================

function updateFilterSummary() {
    const summary = document.getElementById('filterSummary');
    const summaryDate = document.getElementById('summaryDate');
    const summaryLocation = document.getElementById('summaryLocation');
    const summaryTypes = document.getElementById('summaryTypes');
    
    if (!summary || !summaryDate || !summaryLocation || !summaryTypes) return;
    
    // Update date summary
    const activePreset = document.querySelector('.btn-preset.active');
    if (activePreset) {
        const preset = activePreset.dataset.preset;
        if (preset === 'custom') {
            const startDate = document.getElementById('startDate').value;
            const endDate = document.getElementById('endDate').value;
            if (startDate && endDate) {
                summaryDate.textContent = `${startDate} to ${endDate}`;
            } else {
                summaryDate.textContent = 'Custom';
            }
        } else {
            summaryDate.textContent = activePreset.textContent.trim();
        }
    }
    
    // Update location summary
    const regionSelect = document.getElementById('regionSelect');
    const selectedRegion = regionSelect.value;
    if (selectedRegion) {
        if (CONFIG.STATES[selectedRegion]) {
            summaryLocation.textContent = CONFIG.STATES[selectedRegion].name;
        } else if (CONFIG.REGIONS[selectedRegion]) {
            summaryLocation.textContent = CONFIG.REGIONS[selectedRegion].name;
        } else {
            summaryLocation.textContent = selectedRegion;
        }
    } else {
        summaryLocation.textContent = 'All US';
    }
    
    // Update types summary
    const activeTypes = Array.from(document.querySelectorAll('input[id^="hidden-filter-"]:checked'));
    if (activeTypes.length === CONFIG.WEATHER_TYPES.length) {
        summaryTypes.textContent = 'All types';
    } else if (activeTypes.length === 0) {
        summaryTypes.textContent = 'No types';
    } else {
        summaryTypes.textContent = `${activeTypes.length} type${activeTypes.length > 1 ? 's' : ''}`;
    }
    
    // Show summary
    summary.style.display = 'flex';
}

// ============================================================================
// FETCH DATA
// ============================================================================

// Fetch NWS Local Storm Reports data
async function fetchLSRData() {
    // Ensure CONFIG is available
    if (typeof CONFIG === 'undefined') {
        showStatusToast('Configuration error. Please refresh the page.', 'error');
        return;
    }
    
    const fetchBtn = document.getElementById('fetchData');
    const btnText = fetchBtn?.querySelector('.btn-text');
    const btnLoading = fetchBtn?.querySelector('.btn-loading');
    
    // Check offline status
    if (!offlineDetector.checkOnline()) {
        showStatusToast('You are currently offline. Please check your internet connection.', 'error');
        return;
    }
    
    // Show loading state
    showStatusToast('Loading data...', 'loading');
    if (fetchBtn) fetchBtn.disabled = true;
    if (btnText) btnText.style.display = 'none';
    if (btnLoading) btnLoading.style.display = 'inline-flex';
    
    markersLayer.clearLayers();
    userArea.clearLayers();
    
    const startDate = document.getElementById('startDate').value;
    const startHour = document.getElementById('startHour').value;
    const endDate = document.getElementById('endDate').value;
    const endHour = document.getElementById('endHour').value;
    
    // Get selected region/state
    const regionSelect = document.getElementById('regionSelect');
    const selectedRegion = regionSelect.value;
    
    let south, north, east, west;
    let hasBounds = false;
    
    if (selectedRegion) {
        // Check if it's a state
        if (CONFIG.STATES[selectedRegion]) {
            const stateBounds = CONFIG.STATES[selectedRegion].bounds;
            south = stateBounds[0];
            north = stateBounds[1];
            east = stateBounds[2];
            west = stateBounds[3];
            hasBounds = true;
        } 
        // Check if it's a region
        else if (CONFIG.REGIONS[selectedRegion]) {
            const regionBounds = CONFIG.REGIONS[selectedRegion].bounds;
            south = regionBounds[0];
            north = regionBounds[1];
            east = regionBounds[2];
            west = regionBounds[3];
            hasBounds = true;
        }
    }
    
    // Use default bounds if no selection
    if (!hasBounds) {
        south = CONFIG.DEFAULT_BOUNDS.south;
        north = CONFIG.DEFAULT_BOUNDS.north;
        east = CONFIG.DEFAULT_BOUNDS.east;
        west = CONFIG.DEFAULT_BOUNDS.west;
    } else {
        // Draw rectangle and zoom to bounds
        userArea.clearLayers();
        const bounds = [[south, west], [north, east]];
        L.rectangle(bounds, {color: "red", fill: false, weight: 2, dashArray: '5, 5'}).addTo(userArea);
        map.fitBounds(bounds, { padding: [50, 50] });
    }
    
    // Fetch LSR data
    try {
        if (!lsrService) {
            lsrService = new LSRService(CONFIG);
        }
        
        const data = await lsrService.fetchLSRData({
            startDate,
            startHour,
            endDate,
            endHour,
            useCache: true
        });
        
        if (fetchBtn) fetchBtn.disabled = false;
        if (btnText) btnText.style.display = '';
        if (btnLoading) btnLoading.style.display = 'none';
        
        if (data && data.features) {
            displayReports(data, south, north, east, west);
            showStatusToast(`Loaded ${data.features.length} reports`, 'success');
            // Fetch PNS data if enabled
            fetchPNSData();
        } else {
            showStatusToast('No reports found for the selected criteria', 'info');
            updateReportCount(0);
            showEmptyState('No reports found for the selected criteria. Try adjusting your date range or filters.');
        }
    } catch (error) {
        if (fetchBtn) fetchBtn.disabled = false;
        if (btnText) btnText.style.display = '';
        if (btnLoading) btnLoading.style.display = 'none';
        
        const handledError = errorHandler.handleError(error, 'Fetch LSR Data');
        const retryAction = () => fetchLSRData();
        showStatusToast(handledError.message, 'error', retryAction);
        updateReportCount(0);
    }
}

// ============================================================================
// REPORT DISPLAY
// ============================================================================

// State is now managed through appState module, but keeping these for backward compatibility
let allFilteredReports = [];
let lastGeoJsonData = null; // Store last fetched data for viewport refresh
let topReportsByType = {}; // Store top 10 reports by type

// Sync with appState
appState.set('allFilteredReports', allFilteredReports);
appState.set('lastGeoJsonData', lastGeoJsonData);
appState.set('topReportsByType', topReportsByType);

function displayReports(geoJsonData, south, north, east, west) {
    // Ensure CONFIG is available
    if (typeof CONFIG === 'undefined' || typeof REPORT_TYPE_MAP === 'undefined') {
        console.error('CONFIG or REPORT_TYPE_MAP not available');
        return;
    }
    
    markersLayer.clearLayers();
    
    // Store for viewport refresh
    lastGeoJsonData = geoJsonData;
    appState.set('lastGeoJsonData', geoJsonData);
    
    const activeFilters = Array.from(document.querySelectorAll('input[id^="hidden-filter-"]:checked'))
        .map(cb => cb.value);
    
    allFilteredReports = [];
    topReportsByType = {}; // Reset top reports when loading new data
    appState.set('allFilteredReports', allFilteredReports);
    appState.set('topReportsByType', topReportsByType);
    
    // Get current zoom level for performance optimization
    const currentZoom = map.getZoom();
    const zoomLimit = getZoomBasedLimit(currentZoom);
    
    // Get viewport bounds if viewport filtering is enabled
    let viewportBounds = null;
    if (CONFIG.VIEWPORT_ONLY && currentZoom >= CONFIG.MIN_ZOOM_FOR_VIEWPORT) {
        viewportBounds = map.getBounds();
    }
    
    geoJsonData.features.forEach(feature => {
        const props = feature.properties || {};
        const lat = parseFloat(props.lat);
        const lon = parseFloat(props.lon);
        
        if (isNaN(lat) || isNaN(lon)) return;
        
        // Filter by bounding box
        // Note: For US, west is more negative than east, so lon must be between west and east
        if (lat < south || lat > north) return;
        if (lon < west || lon > east) return; // west < east for US (both negative)
        
        // Filter by viewport if enabled and zoomed in
        if (viewportBounds && !viewportBounds.contains([lat, lon])) {
            return;
        }
        
        const rtype = props.type || props.rtype || '';
        const filterType = getReportTypeName(rtype, REPORT_TYPE_MAP);
        
        if (!activeFilters.includes(filterType)) return;
        
        const magnitude = props.magnitude || 0;
        const remark = props.remark || '';
        const valid = (props.valid || '').replace('T', ' ');
        const city = props.city || '';
        const state = props.st || props.state || '';
        // Use REPORT_TYPE_MAP for consistent naming, but prefer typetext if it's more descriptive
        let category = getReportTypeName(rtype, REPORT_TYPE_MAP);
        const typetext = props.typetext || '';
        
        // Normalize "Tropical Cyclone" to "Tropical" for consistency
        if (typetext.toLowerCase().includes('tropical')) {
            category = 'Tropical';
        } else if (typetext && !typetext.toLowerCase().includes('unknown')) {
            // Use typetext if it's meaningful and not "unknown"
            category = typetext;
        }
        const unit = getUnitForReportType(rtype);
        
        const icon = getIconForReportWrapper(rtype, magnitude, remark);
        
        const locationStr = city + (state ? ', ' + state : '');
        
        const reportData = {
            lat: lat,
            lon: lon,
            icon: icon,
            type: category,
            magnitude: magnitude,
            unit: unit,
            location: locationStr,
            time: valid,
            remark: remark,
            rtype: rtype,
            category: category // For popup service
        };
        
        allFilteredReports.push(reportData);
        
        // Track top reports by type
        if (magnitude > 0) {
            if (!topReportsByType[category]) {
                topReportsByType[category] = [];
            }
            topReportsByType[category].push(reportData);
            // Keep only top 10 per type
            topReportsByType[category].sort((a, b) => b.magnitude - a.magnitude);
            if (topReportsByType[category].length > 10) {
                topReportsByType[category] = topReportsByType[category].slice(0, 10);
            }
        }
    });
    
    // Update appState after processing all reports
    appState.set('allFilteredReports', allFilteredReports);
    appState.set('topReportsByType', topReportsByType);
    
    // Apply zoom-based limits
    let reportsToDisplay = allFilteredReports;
    let hiddenCount = 0;
    
    if (zoomLimit !== undefined && allFilteredReports.length > zoomLimit) {
        // Sample markers if over limit (prioritize by keeping first N)
        reportsToDisplay = allFilteredReports.slice(0, zoomLimit);
        hiddenCount = allFilteredReports.length - zoomLimit;
    } else if (allFilteredReports.length > CONFIG.MAX_MARKERS) {
        // Hard limit to prevent performance issues
        reportsToDisplay = allFilteredReports.slice(0, CONFIG.MAX_MARKERS);
        hiddenCount = allFilteredReports.length - CONFIG.MAX_MARKERS;
    }
    
    updateReportCount(reportsToDisplay.length, allFilteredReports.length, hiddenCount);
    updateStatistics(allFilteredReports);
    updateFeatureBadges(); // Update feature discoverability badges
    updateFilterSummary();
    updateExportCount(); // Update export count in modal
    updateHeatMapButtonState(); // Update heat map button state based on active filters
    if (liveModeActive) {
        updateLastUpdateTime();
    }
    
    // Check if heat map mode is active and only one report type is selected
    if (heatMapMode && activeFilters.length === 1) {
        // Remove existing heat map layer
        if (heatMapLayer) {
            map.removeLayer(heatMapLayer);
        }
        
        // Create heat map data points weighted by magnitude
        const magnitudes = allFilteredReports
            .map(r => parseFloat(r.magnitude) || 0)
            .filter(m => m > 0);
        
        if (magnitudes.length > 0) {
            // Find min and max for normalization
            const minMag = Math.min(...magnitudes);
            const maxMag = Math.max(...magnitudes);
            const range = maxMag - minMag || 1; // Avoid division by zero
            
            // Create heat map data with normalized intensity (0.1 to 1.0)
            const heatMapData = allFilteredReports.map(report => {
                const mag = parseFloat(report.magnitude) || 0;
                // Normalize to 0.1-1.0 range, with minimum of 0.1 for visibility
                const normalizedIntensity = range > 0 
                    ? 0.1 + ((mag - minMag) / range) * 0.9 
                    : 0.5; // Default if all magnitudes are the same
                return [report.lat, report.lon, normalizedIntensity];
            });
            
            // Create heat map layer with appropriate settings
            heatMapLayer = L.heatLayer(heatMapData, {
                radius: 25, // Blur radius in pixels
                maxZoom: 18,
                max: 1.0, // Maximum intensity (normalized)
                gradient: {
                    0.0: 'blue',
                    0.2: 'cyan',
                    0.4: 'lime',
                    0.6: 'yellow',
                    0.8: 'orange',
                    1.0: 'red'
                },
                blur: 15, // Blur amount
                minOpacity: 0.05 // Minimum opacity
            });
            
            heatMapLayer.addTo(map);
        }
    } else {
        // Normal marker mode
        // Remove heat map if it exists
        if (heatMapLayer) {
            map.removeLayer(heatMapLayer);
            heatMapLayer = null;
        }
        
        // Add markers
        addMarkersInBatches(reportsToDisplay, markersLayer, CONFIG.BATCH_SIZE);
    }
    
    if (reportsToDisplay.length > 0) {
        setTimeout(() => {
            if (markersLayer && markersLayer.getBounds && markersLayer.getBounds().isValid()) {
                // Only auto-fit if not using viewport filtering or at low zoom
                if (!viewportBounds || currentZoom < CONFIG.MIN_ZOOM_FOR_VIEWPORT) {
                    map.fitBounds(markersLayer.getBounds(), { padding: [50, 50] });
                }
            }
        }, 100);
    }
}

/**
 * Get marker limit based on current zoom level
 */
function getZoomBasedLimit(zoom) {
    // Check exact zoom level
    if (CONFIG.ZOOM_BASED_LIMITS[zoom] !== undefined) {
        return CONFIG.ZOOM_BASED_LIMITS[zoom];
    }
    
    // Find closest lower zoom level limit
    for (let z = zoom - 1; z >= 3; z--) {
        if (CONFIG.ZOOM_BASED_LIMITS[z] !== undefined) {
            return CONFIG.ZOOM_BASED_LIMITS[z];
        }
    }
    
    // No limit for high zoom levels (uses MAX_MARKERS instead)
    return undefined;
}

// ============================================================================
// WARNINGS DATA FETCHING
// ============================================================================

/**
 * Fetch active NWS warnings/alerts and display on map
 */
async function fetchWarnings() {
    if (!showWarnings || !warningsService || !map || !warningsLayer) {
        return;
    }
    
    try {
        const bounds = map.getBounds();
        const alerts = await warningsService.fetchActiveWarnings({
            north: bounds.getNorth(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            west: bounds.getWest()
        });
        
        // Clear existing warnings
        warningsLayer.clearLayers();
        
        if (alerts.length === 0) {
            // Update count to show zero
            const warningsCountEl = document.getElementById('warningsCount');
            if (warningsCountEl) {
                warningsCountEl.textContent = '0';
                warningsCountEl.style.display = 'inline';
            }
            return; // No active warnings
        }
        
        // Add each alert to the map
        alerts.forEach(alert => {
            const props = alert.properties || {};
            const severity = props.severity || 'Unknown';
            const category = props.category || 'Other';
            const event = props.event || 'Alert';
            const headline = props.headline || '';
            const description = props.description || '';
            const instruction = props.instruction || '';
            const effective = props.effective ? new Date(props.effective).toLocaleString() : '';
            const expires = props.expires ? new Date(props.expires).toLocaleString() : '';
            const areaDesc = props.areaDesc || '';
            
            const color = warningsService.getSeverityColor(severity);
            const icon = warningsService.getCategoryIcon(category);
            
            // Create popup content
            const popupContent = `
                <div class="warning-popup">
                    <div class="warning-header" style="border-left: 4px solid ${color};">
                        <div class="warning-title">
                            <span class="warning-icon">${icon}</span>
                            <strong>${event}</strong>
                        </div>
                        <div class="warning-severity" style="color: ${color};">
                            ${severity} - ${category}
                        </div>
                    </div>
                    <div class="warning-body">
                        ${headline ? `<div class="warning-headline"><strong>${headline}</strong></div>` : ''}
                        ${areaDesc ? `<div class="warning-area"><i class="fas fa-map-marker-alt"></i> ${areaDesc}</div>` : ''}
                        ${effective ? `<div class="warning-time"><i class="fas fa-clock"></i> Effective: ${effective}</div>` : ''}
                        ${expires ? `<div class="warning-time"><i class="fas fa-hourglass-end"></i> Expires: ${expires}</div>` : ''}
                        ${description ? `<div class="warning-description">${description}</div>` : ''}
                        ${instruction ? `<div class="warning-instruction"><strong>Instructions:</strong> ${instruction}</div>` : ''}
                    </div>
                </div>
            `;
            
            // Handle different geometry types
            const geom = alert.geometry;
            if (!geom) return;
            
            if (geom.type === 'Point') {
                const [lon, lat] = geom.coordinates;
                const marker = L.marker([lat, lon], {
                    icon: L.divIcon({
                        className: 'warning-marker',
                        html: `<div style="
                            background-color: ${color};
                            color: white;
                            border-radius: 50%;
                            width: 24px;
                            height: 24px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 14px;
                            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                        ">${icon}</div>`,
                        iconSize: [24, 24],
                        iconAnchor: [12, 12]
                    })
                });
                marker.bindPopup(popupContent, { maxWidth: 400, className: 'warning-popup-container' });
                marker.addTo(warningsLayer);
            } else if (geom.type === 'Polygon') {
                const coords = geom.coordinates[0].map(([lon, lat]) => [lat, lon]);
                const polygon = L.polygon(coords, {
                    color: color,
                    fillColor: color,
                    fillOpacity: 0.2,
                    weight: 2,
                    opacity: 0.7
                });
                polygon.bindPopup(popupContent, { maxWidth: 400, className: 'warning-popup-container' });
                polygon.addTo(warningsLayer);
            } else if (geom.type === 'MultiPolygon') {
                geom.coordinates.forEach(polygonCoords => {
                    const coords = polygonCoords[0].map(([lon, lat]) => [lat, lon]);
                    const polygon = L.polygon(coords, {
                        color: color,
                        fillColor: color,
                        fillOpacity: 0.2,
                        weight: 2,
                        opacity: 0.7
                    });
                    polygon.bindPopup(popupContent, { maxWidth: 400, className: 'warning-popup-container' });
                    polygon.addTo(warningsLayer);
                });
            }
        });
        
        // Update warnings count if element exists
        const warningsCountEl = document.getElementById('warningsCount');
        if (warningsCountEl) {
            warningsCountEl.textContent = alerts.length;
            warningsCountEl.style.display = alerts.length > 0 ? 'inline' : 'inline';
        }
        
    } catch (error) {
        errorHandler.handleError(error, 'Fetch Warnings');
    }
}

// ============================================================================
// PNS DATA FETCHING
// ============================================================================

/**
 * Fetch Public Information Statements from NWS
 * Displays PNS at the issuing WFO office location with a formatted popup
 */
async function fetchPNSData() {
    if (!showPNS) {
        if (pnsLayer) {
            pnsLayer.clearLayers();
        }
        return;
    }
    
    try {
        const url = 'https://api.weather.gov/products/types/PNS';
        const response = await fetch(url, {
            headers: {
                'User-Agent': '(LSR Map App, contact@example.com)'
            }
        });
        
        if (!response.ok) {
            errorHandler.log('Failed to fetch PNS data', new Error(response.statusText), ERROR_TYPES.API);
            return;
        }
        
        const data = await response.json();
        
        if (!data || !data['@graph'] || data['@graph'].length === 0) {
            if (pnsLayer) pnsLayer.clearLayers();
            // No PNS found - not an error, just informational
            return;
        }
        
        if (pnsLayer) pnsLayer.clearLayers();
        
        // Get recent PNS (last 24 hours only)
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const recentPNS = data['@graph'].filter(product => {
            const issueTime = new Date(product.issuanceTime);
            return issueTime >= oneDayAgo;
        }).slice(0, 50);
        
        if (recentPNS.length === 0) {
            // No recent PNS found - not an error
            return;
        }
        
        // WFO office coordinates
        const wfoCoords = {
            'KABQ': [35.04, -106.62], 'KABR': [45.45, -98.41], 'KAMA': [35.23, -101.71],
            'KAPX': [44.90, -84.72], 'KARX': [43.82, -91.19], 'KBGM': [42.20, -75.98],
            'KBIS': [46.77, -100.75], 'KBMX': [33.17, -86.77], 'KBOI': [43.56, -116.21],
            'KBOU': [39.75, -105.00], 'KBOX': [41.95, -71.14], 'KBRO': [25.91, -97.42],
            'KBTV': [44.47, -73.15], 'KBUF': [42.94, -78.72], 'KBYZ': [45.75, -108.57],
            'KCAE': [33.95, -81.12], 'KCAR': [46.87, -68.02], 'KCHS': [32.90, -80.04],
            'KCLE': [41.41, -81.85], 'KCRP': [27.78, -97.51], 'KCTP': [40.79, -77.86],
            'KCYS': [41.15, -104.81], 'KDDC': [37.76, -99.97], 'KDLH': [46.84, -92.21],
            'KDMX': [41.73, -93.72], 'KDTX': [42.70, -83.47], 'KDVN': [41.61, -90.58],
            'KEAX': [38.81, -94.26], 'KEKA': [40.80, -124.16], 'KEPZ': [31.87, -106.70],
            'KEWX': [29.70, -98.03], 'KFFC': [33.36, -84.57], 'KFGF': [47.92, -97.09],
            'KFGZ': [35.23, -111.82], 'KFSD': [43.59, -96.73], 'KFWD': [32.83, -97.30],
            'KGGW': [48.21, -106.62], 'KGID': [40.97, -98.38], 'KGJT': [39.12, -108.53],
            'KGLD': [39.37, -101.70], 'KGRB': [44.48, -88.13], 'KGRR': [42.89, -85.54],
            'KGSP': [34.88, -82.22], 'KGYX': [43.89, -70.26], 'KHGX': [29.47, -95.08],
            'KHNX': [36.31, -119.63], 'KHUN': [34.72, -86.66], 'KICT': [37.65, -97.43],
            'KILM': [34.27, -77.91], 'KILN': [39.42, -83.82], 'KIND': [39.71, -86.28],
            'KIWX': [41.36, -85.70], 'KJAN': [32.32, -90.08], 'KJAX': [30.48, -81.70],
            'KJKL': [37.59, -83.31], 'KKEY': [24.56, -81.78], 'KLBF': [41.13, -100.68],
            'KLCH': [30.13, -93.22], 'KLIX': [30.34, -89.83], 'KLKN': [40.87, -117.80],
            'KLMK': [38.23, -85.66], 'KLOT': [41.60, -88.08], 'KLOX': [34.20, -119.18],
            'KLUB': [33.65, -101.82], 'KLWX': [38.97, -77.48], 'KLZK': [34.84, -92.26],
            'KMAF': [31.94, -102.19], 'KMEG': [35.05, -89.99], 'KMFL': [25.75, -80.38],
            'KMFR': [42.37, -122.87], 'KMHX': [34.78, -76.88], 'KMKX': [42.97, -88.55],
            'KMLB': [28.11, -80.65], 'KMOB': [30.68, -88.24], 'KMPX': [44.85, -93.57],
            'KMQT': [46.53, -87.55], 'KMRX': [36.17, -83.40], 'KMSO': [46.92, -114.09],
            'KMTR': [36.60, -121.90], 'KOAX': [41.32, -96.37], 'KOHX': [36.25, -86.56],
            'KOKX': [40.87, -72.86], 'KOTX': [47.68, -117.63], 'KOUN': [35.24, -97.46],
            'KPAH': [37.07, -88.77], 'KPBZ': [40.53, -80.22], 'KPDT': [45.69, -118.85],
            'KPHI': [39.87, -75.01], 'KPIH': [42.91, -112.60], 'KPQR': [45.56, -122.54],
            'KPSR': [33.43, -112.02], 'KPUB': [38.28, -104.52], 'KRAH': [35.87, -78.79],
            'KREV': [39.57, -119.80], 'KRIW': [43.06, -108.48], 'KRLX': [38.31, -81.72],
            'KRNK': [37.21, -80.41], 'KSEW': [47.69, -122.26], 'KSGF': [37.24, -93.40],
            'KSGX': [32.73, -117.18], 'KSHV': [32.45, -93.84], 'KSJT': [31.37, -100.49],
            'KSLC': [40.77, -111.95], 'KSTO': [38.60, -121.38], 'KTAE': [30.45, -84.30],
            'KTBW': [27.70, -82.40], 'KTFX': [47.46, -111.38], 'KTOP': [39.07, -95.63],
            'KTSA': [36.15, -95.86], 'KTWC': [32.23, -110.95], 'KUNR': [41.14, -104.24],
            'KVEF': [36.05, -115.18]
        };
        
        let displayedCount = 0;
        const processedOffices = new Set();
        
        for (const product of recentPNS) {
            try {
                // Get WFO code from issuing office (e.g., "KICT" from "NWS Wichita KS")
                const wfoCode = product.issuingOffice?.match(/K[A-Z]{2,3}/)?.[0];
                
                // Skip if we've already processed this office or don't have coordinates
                if (!wfoCode || processedOffices.has(wfoCode) || !wfoCoords[wfoCode]) {
                    continue;
                }
                
                // Fetch full product text
                const productUrl = `https://api.weather.gov/products/${product.id}`;
                const productResponse = await fetch(productUrl, {
                    headers: { 'User-Agent': '(LSR Map App, contact@example.com)' }
                });
                
                if (!productResponse.ok) continue;
                
                const productData = await productResponse.json();
                const productText = productData.productText || '';
                
                if (!productText.trim()) continue;
                
                processedOffices.add(wfoCode);
                
                // Store PNS data for modal
                const pnsData = {
                    office: product.issuingOffice || wfoCode,
                    time: new Date(product.issuanceTime),
                    text: productText,
                    productId: product.id
                };
                
                // Create custom PNS icon
                const pnsIcon = L.divIcon({
                    className: 'pns-marker',
                    html: '<div class="pns-marker-inner">📋</div>',
                    iconSize: [32, 32],
                    iconAnchor: [16, 16]
                });
                
                const [lat, lon] = wfoCoords[wfoCode];
                const marker = L.marker([lat, lon], { icon: pnsIcon });
                
                // Open modal on click instead of popup
                marker.on('click', () => openPnsModal(pnsData));
                marker.addTo(pnsLayer);
                displayedCount++;
                
            } catch (error) {
                errorHandler.log(`Error processing PNS product ${product.id}`, error, ERROR_TYPES.API);
            }
        }
        
        if (displayedCount > 0) {
            // Successfully loaded PNS data
                    showStatusToast(`Loaded ${displayedCount} PNS from ${displayedCount} office${displayedCount !== 1 ? 's' : ''}`, 'info');
        }
    } catch (error) {
        errorHandler.handleError(error, 'Fetch PNS Data');
    }
}

// Show empty state with message
function showEmptyState(message) {
    const emptyState = document.getElementById('emptyState');
    const emptyStateMessage = document.querySelector('.empty-state-message');
    if (emptyState) {
        if (emptyStateMessage && message) {
            emptyStateMessage.textContent = message;
        }
        emptyState.style.display = 'flex';
    }
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Helper function to get relative time
function getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    
    if (diffMins < 60) {
        return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
        return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    } else {
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    }
}

// Open PNS modal with statement content
function openPnsModal(pnsData) {
    const modal = document.getElementById('pnsModal');
    const officeEl = document.getElementById('pnsModalOffice');
    const timeEl = document.getElementById('pnsModalTime');
    const textEl = document.getElementById('pnsModalText');
    const linkEl = document.getElementById('pnsModalLink');
    
    if (!modal) return;
    
    // Populate modal content
    officeEl.textContent = pnsData.office;
    timeEl.innerHTML = `<i class="far fa-clock"></i> ${getTimeAgo(pnsData.time)} &nbsp;•&nbsp; ${pnsData.time.toLocaleString()}`;
    textEl.textContent = pnsData.text;
    linkEl.href = `https://api.weather.gov/products/${pnsData.productId}`;
    
    // Show modal
    modal.classList.add('show');
}

// addMarkersInBatches is now imported from markerService module

function updateReportCount(count, totalCount = null, hiddenCount = 0) {
    const countEl = document.getElementById('reportCount');
    const performanceBanner = document.getElementById('performanceBanner');
    const performanceBannerText = document.getElementById('performanceBannerText');
    const currentZoom = map ? map.getZoom() : 4;
    const zoomLimit = getZoomBasedLimit(currentZoom);
    
    // Hide empty state if we have reports
    const emptyState = document.getElementById('emptyState');
    if (count > 0 && emptyState) {
        emptyState.style.display = 'none';
    }
    
    if (hiddenCount > 0) {
        // Show warning when markers are limited
        countEl.textContent = `${count.toLocaleString()} displayed`;
        countEl.title = `${hiddenCount.toLocaleString()} markers hidden for performance (zoom in to see more)`;
        countEl.style.color = count >= CONFIG.MAX_MARKERS_WARNING ? '#f59e0b' : 'inherit';
        
        // Show persistent performance banner
        if (performanceBanner && performanceBannerText) {
            const reason = zoomLimit !== undefined 
                ? `Zoom level ${currentZoom} limit: ${zoomLimit.toLocaleString()} markers`
                : `Maximum limit: ${CONFIG.MAX_MARKERS.toLocaleString()} markers`;
            
            performanceBannerText.innerHTML = `
                <strong>Showing ${count.toLocaleString()} of ${totalCount.toLocaleString()} reports.</strong>
                ${hiddenCount.toLocaleString()} hidden for performance (${reason}). 
                <strong>Zoom in to see more markers.</strong>
            `;
            performanceBanner.style.display = 'block';
            performanceBanner.className = 'performance-banner performance-banner-warning';
        }
    } else {
        countEl.textContent = count.toLocaleString();
        countEl.title = '';
        countEl.style.color = 'inherit';
        
        // Hide performance banner when no markers are hidden
        if (performanceBanner) {
            performanceBanner.style.display = 'none';
        }
    }
    
    // Store total count for reference
    if (totalCount !== null) {
        countEl.dataset.totalCount = totalCount;
    }
}

// Update feature badges for discoverability
function updateFeatureBadges() {
    // Show badge on Top Reports button when data is available
    const showTopReportsBtn = document.getElementById('showTopReports');
    const topReportsBadge = showTopReportsBtn?.querySelector('.feature-badge');
    
    if (Object.keys(topReportsByType).length > 0) {
        if (showTopReportsBtn) {
            showTopReportsBtn.style.display = 'block';
            if (!topReportsBadge) {
                const badge = document.createElement('span');
                badge.className = 'feature-badge';
                badge.textContent = 'New';
                showTopReportsBtn.appendChild(badge);
                setTimeout(() => {
                    if (badge.parentNode) badge.remove();
                }, 10000); // Remove badge after 10 seconds
            }
        }
    }
    
    // Show badge on Data Insights panel when it appears
    const dataInsightsPanel = document.getElementById('dataInsightsPanel');
    if (dataInsightsPanel && allFilteredReports.length > 0) {
        dataInsightsPanel.style.display = 'block';
    }
}

// ============================================================================
// STATISTICS
// ============================================================================

function updateStatistics(reports) {
    const statsContent = document.getElementById('statisticsContent');
    const dataInsightsPanel = document.getElementById('dataInsightsPanel');
    
    if (!reports || reports.length === 0) {
        if (dataInsightsPanel) dataInsightsPanel.style.display = 'none';
        return;
    }
    
    if (dataInsightsPanel) dataInsightsPanel.style.display = 'block';
    
    // Calculate statistics
    const stats = {
        total: reports.length,
        byType: {},
        maxMagnitude: {},
        tornadoCount: 0,
        maxWindSpeed: 0,
        maxHail: 0,
        maxRain: 0
    };
    
    reports.forEach(report => {
        const type = report.type || 'Other';
        const magnitude = parseFloat(report.magnitude) || 0;
        
        stats.byType[type] = (stats.byType[type] || 0) + 1;
        
        // Check for tornado
        if (type === 'Tornado') {
            stats.tornadoCount++;
        }
        
        // Track max values by type
        if (type === 'Wind' || type === 'Thunderstorm') {
            stats.maxWindSpeed = Math.max(stats.maxWindSpeed, magnitude);
        } else if (type === 'Hail') {
            stats.maxHail = Math.max(stats.maxHail, magnitude);
        } else if (type === 'Rain') {
            stats.maxRain = Math.max(stats.maxRain, magnitude);
        }
        
        if (!stats.maxMagnitude[type] || magnitude > stats.maxMagnitude[type]) {
            stats.maxMagnitude[type] = magnitude;
        }
    });
    
    // Build statistics HTML
    const topTypes = Object.entries(stats.byType)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    
    let statsHTML = `
        <div class="stat-item">
            <div class="stat-label">Total Reports</div>
            <div class="stat-value">${stats.total.toLocaleString()}</div>
        </div>
    `;
    
    if (stats.tornadoCount > 0) {
        statsHTML += `
            <div class="stat-item">
                <div class="stat-label">Tornadoes</div>
                <div class="stat-value">${stats.tornadoCount}</div>
            </div>
        `;
    }
    
    if (stats.maxWindSpeed > 0) {
        statsHTML += `
            <div class="stat-item">
                <div class="stat-label">Max Wind</div>
                <div class="stat-value">${stats.maxWindSpeed.toFixed(0)} mph</div>
            </div>
        `;
    }
    
    if (stats.maxHail > 0) {
        statsHTML += `
            <div class="stat-item">
                <div class="stat-label">Max Hail</div>
                <div class="stat-value">${stats.maxHail.toFixed(1)}"</div>
            </div>
        `;
    }
    
    if (topTypes.length > 0) {
        statsHTML += `
            <div class="stat-item" style="grid-column: 1 / -1;">
                <div class="stat-label">Top Types</div>
                <div class="stat-breakdown">
                    ${topTypes.map(([type, count]) => `<div>${type}: ${count}</div>`).join('')}
                </div>
            </div>
        `;
    }
    
    statsContent.innerHTML = statsHTML;
    
    // Show/hide Top Reports button based on data availability
    const showTopReportsBtn = document.getElementById('showTopReports');
    if (reports && reports.length > 0 && Object.keys(topReportsByType).length > 0) {
        if (showTopReportsBtn) showTopReportsBtn.style.display = 'block';
    } else {
        if (showTopReportsBtn) showTopReportsBtn.style.display = 'none';
    }
}

// ============================================================================
// TOP 10 REPORTS
// ============================================================================

function displayTopReports() {
    const content = document.getElementById('topReportsContent');
    
    if (Object.keys(topReportsByType).length === 0) {
        content.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 2rem;">No reports with magnitude data available.</p>';
        return;
    }
    
    // Sort types by highest magnitude in their top report
    const sortedTypes = Object.keys(topReportsByType)
        .map(type => ({
            type,
            reports: topReportsByType[type],
            maxMagnitude: topReportsByType[type][0]?.magnitude || 0
        }))
        .sort((a, b) => b.maxMagnitude - a.maxMagnitude);
    
    let html = '';
    
    sortedTypes.forEach(({ type, reports }) => {
        const typeIcon = getTypeIcon(type);
        html += `
            <div class="top-reports-section">
                <div class="top-reports-section-title">
                    ${typeIcon}
                    <span>${type}</span>
                </div>
                <div class="top-reports-list">
        `;
        
        reports.forEach((report, index) => {
            html += `
                <div class="top-report-item">
                    <div class="top-report-rank">#${index + 1}</div>
                    <div class="top-report-magnitude">${report.magnitude}${report.unit || ''}</div>
                    <div class="top-report-details">
                        ${report.location ? `
                            <div class="top-report-location">
                                <i class="fas fa-map-marker-alt"></i>
                                ${report.location}
                            </div>
                        ` : ''}
                        ${report.time ? `
                            <div class="top-report-time">
                                <i class="fas fa-clock"></i>
                                ${report.time}
                            </div>
                        ` : ''}
                        ${report.remark ? `
                            <div class="top-report-remark">
                                <i class="fas fa-comment-alt"></i>
                                ${report.remark}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        });
        
        html += `
                </div>
            </div>
        `;
    });
    
    content.innerHTML = html;
}

function getTypeIcon(type) {
    const iconMap = {
        'Tornado': '<i class="fas fa-tornado" style="color: #dc2626;"></i>',
        'Thunderstorm': '<i class="fas fa-bolt" style="color: #f59e0b;"></i>',
        'Hail': '<i class="fas fa-circle" style="color: #3b82f6;"></i>',
        'Wind': '<i class="fas fa-wind" style="color: #8b5cf6;"></i>',
        'Snow': '<i class="fas fa-snowflake" style="color: #60a5fa;"></i>',
        'Ice': '<i class="fas fa-icicles" style="color: #34d399;"></i>',
        'Rain': '<i class="fas fa-cloud-rain" style="color: #3b82f6;"></i>',
        'Flood': '<i class="fas fa-water" style="color: #2563eb;"></i>',
        'Tropical': '<i class="fas fa-hurricane" style="color: #ef4444;"></i>',
        'Other': '<i class="fas fa-cloud" style="color: #6b7280;"></i>'
    };
    return iconMap[type] || '<i class="fas fa-cloud" style="color: #6b7280;"></i>';
}

function clearMap() {
    // Disable live mode when clearing map
    if (liveModeActive) {
        toggleLiveMode();
    }
    
    markersLayer.clearLayers();
    userArea.clearLayers();
    allFilteredReports = [];
    topReportsByType = {};
    updateReportCount(0);
    updateStatistics([]);
    showStatusToast('Map cleared', 'info');
    updateFilterSummary();
}

// Reset map to default US view
function resetView() {
    console.log('resetView called');
    if (!map) {
        console.warn('Map not initialized');
        showStatusToast('Map not ready', 'error');
        return;
    }
    
    map.setView(
        [CONFIG.MAP_INITIAL.lat, CONFIG.MAP_INITIAL.lon],
        CONFIG.MAP_INITIAL.zoom
    );
    showStatusToast('Map reset to default view', 'success');
}

// Center map on user's location
function centerOnMyLocation() {
    console.log('centerOnMyLocation called');
    if (!map) {
        console.warn('Map not initialized');
        showStatusToast('Map not ready', 'error');
        return;
    }
    
    if (!navigator.geolocation) {
        showStatusToast('Geolocation is not supported by your browser', 'error');
        return;
    }
    
    showStatusToast('Locating...', 'loading');
    
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            map.setView([latitude, longitude], 10);
            showStatusToast('Map centered on your location', 'success');
        },
        (error) => {
            let message = 'Unable to get your location';
            if (error.code === error.PERMISSION_DENIED) {
                message = 'Location permission denied. Please enable location access.';
            } else if (error.code === error.POSITION_UNAVAILABLE) {
                message = 'Location information unavailable';
            } else if (error.code === error.TIMEOUT) {
                message = 'Location request timed out';
            }
            showStatusToast(message, 'error');
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

// ============================================================================
// LIVE MODE
// ============================================================================

// ============================================================================
// HEAT MAP
// ============================================================================

function updateHeatMapButtonState() {
    const activeFilters = Array.from(document.querySelectorAll('input[id^="hidden-filter-"]:checked'))
        .map(cb => cb.value);
    const toggleBtn = document.getElementById('toggleHeatMap');
    
    if (!toggleBtn) return;
    
    // Disable heat map if not exactly one type selected
    if (activeFilters.length !== 1) {
        if (heatMapMode) {
            // Auto-disable heat map mode
            heatMapMode = false;
            if (heatMapLayer) {
                map.removeLayer(heatMapLayer);
                heatMapLayer = null;
            }
            if (markersLayer) {
                map.addLayer(markersLayer);
            }
            // Refresh to show markers
            if (lastGeoJsonData) {
                const bounds = map.getBounds();
                displayReports(lastGeoJsonData, bounds.getSouth(), bounds.getNorth(), bounds.getEast(), bounds.getWest());
            }
        }
        toggleBtn.classList.add('disabled');
        toggleBtn.disabled = true;
        toggleBtn.title = 'Heat map requires exactly one weather type selected';
    } else {
        toggleBtn.classList.remove('disabled');
        toggleBtn.disabled = false;
        if (heatMapMode) {
            toggleBtn.title = 'Switch back to marker view';
        } else {
            toggleBtn.title = 'Switch to heat map view (weighted by magnitude)';
        }
    }
}

function toggleHeatMap() {
    const activeFilters = Array.from(document.querySelectorAll('input[id^="hidden-filter-"]:checked'))
        .map(cb => cb.value);
    
    // Heat map only works with exactly one report type selected
    if (activeFilters.length !== 1) {
        showStatusToast('Heat map requires exactly one weather type to be selected.', 'warning');
        return;
    }
    
    heatMapMode = !heatMapMode;
    const toggleBtn = document.getElementById('toggleHeatMap');
    
    if (heatMapMode) {
        toggleBtn.classList.add('active');
        toggleBtn.innerHTML = '<i class="fas fa-map-marker-alt"></i> Markers';
        toggleBtn.title = 'Switch back to marker view';
        
        // Hide markers layer
        if (markersLayer) {
            map.removeLayer(markersLayer);
        }
        
        // Refresh data to show heat map
        if (lastGeoJsonData) {
            const bounds = map.getBounds();
            displayReports(lastGeoJsonData, bounds.getSouth(), bounds.getNorth(), bounds.getEast(), bounds.getWest());
        }
    } else {
        toggleBtn.classList.remove('active');
        toggleBtn.innerHTML = '<i class="fas fa-fire"></i> Heat Map';
        toggleBtn.title = 'Switch to heat map view (weighted by magnitude)';
        
        // Remove heat map layer
        if (heatMapLayer) {
            map.removeLayer(heatMapLayer);
            heatMapLayer = null;
        }
        
        // Show markers layer
        if (markersLayer) {
            map.addLayer(markersLayer);
        }
        
        // Refresh data to show markers
        if (lastGeoJsonData) {
            const bounds = map.getBounds();
            displayReports(lastGeoJsonData, bounds.getSouth(), bounds.getNorth(), bounds.getEast(), bounds.getWest());
        }
    }
}

function toggleLiveMode() {
    liveModeActive = !liveModeActive;
    const toggleBtn = document.getElementById('toggleLiveMode');
    const liveIndicator = document.getElementById('liveModeIndicator');
    const liveInfo = document.getElementById('liveModeInfo');
    
    if (liveModeActive) {
        // Enable live mode
        toggleBtn.classList.add('active');
        toggleBtn.innerHTML = '<i class="fas fa-satellite-dish"></i> Live ON';
        if (liveIndicator) liveIndicator.style.display = 'flex';
        if (liveInfo) liveInfo.style.display = 'block';
        
        // Set date to last 24h and fetch current data
        setDatePreset('24h');
        
        // Add radar layer (NWS WMS - will refresh automatically)
        addRadarLayer();
        
        // Enable and fetch warnings
        showWarnings = true;
        fetchWarnings();
        
        // Start auto-refresh
        startLiveModeRefresh();
        
        showStatusToast('Live mode enabled - Auto-refreshing reports and warnings', 'success');
    } else {
        // Disable live mode
        toggleBtn.classList.remove('active');
        toggleBtn.innerHTML = '<i class="fas fa-satellite-dish"></i> Live';
        if (liveIndicator) liveIndicator.style.display = 'none';
        if (liveInfo) liveInfo.style.display = 'none';
        
        // Remove radar layer
        removeRadarLayer();
        
        // Clear warnings
        showWarnings = false;
        if (warningsLayer) warningsLayer.clearLayers();
        
        // Stop auto-refresh
        stopLiveModeRefresh();
        
        showStatusToast('Live mode disabled', 'info');
    }
}

function addRadarLayer() {
    if (!map || radarLayerGroup) return;
    
    // Use NWS radar via Iowa Environmental Mesonet
    // This allows us to animate through historical radar frames
    try {
        // Create a layer group to hold all radar tile layers
        radarLayerGroup = L.layerGroup();
        
        // Load timestamps and create tile layers for each frame
        loadRadarTimestamps();
        
        // NWS radar layers initialized successfully
    } catch (error) {
        errorHandler.handleError(error, 'Create NWS Radar Layers');
        showStatusToast('Could not load NWS radar layers', 'error');
    }
}

function loadRadarTimestamps() {
    // IEM NEXRAD updates approximately every 5 minutes
    // Create timestamps for the last hour (every 5 minutes = 12 frames for smoother animation)
    const now = new Date();
    radarTimestamps = [];
    radarLayers = [];
    
    // Generate timestamps going back 1 hour, every 5 minutes (12 frames total)
    for (let i = 0; i <= 11; i++) {
        const timestamp = new Date(now.getTime() - (i * 5 * 60 * 1000));
        radarTimestamps.push(timestamp);
    }
    
    // Reverse to go from oldest to newest
    radarTimestamps.reverse();
    
    // Create a tile layer for each timestamp using IEM's tile cache
    radarTimestamps.forEach((timestamp, index) => {
        const year = timestamp.getFullYear().toString();
        const month = String(timestamp.getMonth() + 1).padStart(2, '0');
        const day = String(timestamp.getDate()).padStart(2, '0');
        const hour = String(timestamp.getHours()).padStart(2, '0');
        const minute = String(timestamp.getMinutes()).padStart(2, '0');
        
        // Format: YYYYMMDDHHmm (e.g., "202601141200")
        const timeStr = year + month + day + hour + minute;
        
        // IEM radar tile URL format
        const tileUrl = `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-${timeStr}/{z}/{x}/{y}.png`;
        
        // Create tile layer for this timestamp
        const layer = L.tileLayer(tileUrl, {
            opacity: 0, // Start hidden
            attribution: 'Radar data &copy; <a href="https://mesonet.agron.iastate.edu">Iowa Environmental Mesonet / NWS</a>',
            maxZoom: 10
        });
        
        radarLayers[index] = layer;
        radarLayerGroup.addLayer(layer);
    });
    
    // Add the layer group to the map
    radarLayerGroup.addTo(map);
    
    // Start animation if we have layers
    if (radarLayers.length > 0) {
        radarAnimationIndex = radarLayers.length - 1; // Start at most recent
        startRadarAnimation();
    }
}

function startRadarAnimation() {
    if (!radarLayers || radarLayers.length === 0) return;
    
    // Stop any existing animation
    stopRadarAnimation();
    
    radarAnimationPlaying = true;
    
    // Animate through radar frames by changing opacity
    // Performance optimization: Only update opacity for layers that need to change
    let previousIndex = -1;
    
    function animateFrame() {
        if (!liveModeActive || !radarLayers || radarLayers.length === 0) {
            stopRadarAnimation();
            return;
        }
        
        // Only hide the previous layer if it's different from current
        if (previousIndex >= 0 && previousIndex < radarLayers.length && previousIndex !== radarAnimationIndex) {
            const prevLayer = radarLayers[previousIndex];
            if (prevLayer && prevLayer.setOpacity) {
                prevLayer.setOpacity(0);
            }
        } else if (previousIndex !== radarAnimationIndex && radarAnimationIndex === 0) {
            // If we're looping back to start, hide the last layer
            const lastIndex = radarLayers.length - 1;
            if (lastIndex >= 0) {
                const lastLayer = radarLayers[lastIndex];
                if (lastLayer && lastLayer.setOpacity) {
                    lastLayer.setOpacity(0);
                }
            }
        }
        
        // Show current frame
        const currentLayer = radarLayers[radarAnimationIndex];
        if (currentLayer && currentLayer.setOpacity) {
            currentLayer.setOpacity(0.4); // Lighter opacity for better visibility of underlying map
        }
        
        // Update frame info
        updateRadarFrameInfo();
        
        // Check if we're at the last frame (most recent)
        const isLastFrame = radarAnimationIndex === radarLayers.length - 1;
        
        // Store current index for next iteration
        previousIndex = radarAnimationIndex;
        
        // Move to next frame
        if (isLastFrame) {
            // Pause longer on the last frame (1.5 seconds) before looping back
            setTimeout(() => {
                if (liveModeActive && radarLayers.length > 0) {
                    radarAnimationIndex = 0; // Loop back to start
                    previousIndex = -1; // Reset for loop
                    animateFrame();
                }
            }, 1500); // 1.5 second pause on last frame
        } else {
            // Normal progression to next frame - faster animation
            radarAnimationIndex++;
            radarAnimationInterval = setTimeout(animateFrame, 500); // 0.5 seconds between frames for faster animation
        }
    }
    
    // Start the animation
    animateFrame();
}

function updateRadarFrameInfo() {
    const frameInfoEl = document.getElementById('radarFrameInfo');
    if (frameInfoEl && radarTimestamps.length > 0 && radarAnimationIndex < radarTimestamps.length) {
        const totalFrames = radarTimestamps.length;
        const currentFrame = radarAnimationIndex + 1;
        const timestamp = radarTimestamps[radarAnimationIndex];
        const timeStr = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const isLastFrame = radarAnimationIndex === radarTimestamps.length - 1;
        const status = isLastFrame ? ' (Current - NWS)' : '';
        frameInfoEl.textContent = `Frame ${currentFrame}/${totalFrames} (${timeStr})${status}`;
    }
}

function stopRadarAnimation() {
    if (radarAnimationInterval) {
        clearTimeout(radarAnimationInterval);
        radarAnimationInterval = null;
    }
    radarAnimationPlaying = false;
    
    // Hide all radar layers when stopped
    if (radarLayers) {
        radarLayers.forEach(layer => {
            if (layer && layer.setOpacity) {
                layer.setOpacity(0);
            }
        });
    }
}

function removeRadarLayer() {
    stopRadarAnimation();
    if (radarRefreshInterval) {
        clearInterval(radarRefreshInterval);
        radarRefreshInterval = null;
    }
    if (radarLayerGroup && map) {
        map.removeLayer(radarLayerGroup);
        radarLayerGroup = null;
    }
    if (radarLayer && map) {
        map.removeLayer(radarLayer);
        radarLayer = null;
    }
    radarLayers = [];
    radarTimestamps = [];
    radarAnimationIndex = 0;
}

function startLiveModeRefresh() {
    // Clear any existing interval
    stopLiveModeRefresh();
    
    // Get refresh interval from config (default 60 seconds)
    const interval = CONFIG.LIVE_MODE_REFRESH_INTERVAL || 60000;
    const intervalSeconds = interval / 1000;
    
    // Update display
    const intervalEl = document.getElementById('refreshInterval');
    if (intervalEl) {
        intervalEl.textContent = intervalSeconds;
    }
    
    // Fetch immediately
    fetchLSRData();
    if (showWarnings) {
        fetchWarnings();
    }
    updateLastUpdateTime();
    
    // Set up interval
    liveModeInterval = setInterval(() => {
        if (liveModeActive) {
            fetchLSRData();
            if (showWarnings) {
                fetchWarnings();
            }
            updateLastUpdateTime();
        }
    }, interval);
    
    // Also refresh warnings when map moves/zooms in live mode
    if (showWarnings) {
        map.on('moveend', refreshWarningsOnMove);
        map.on('zoomend', refreshWarningsOnMove);
    }
}

function stopLiveModeRefresh() {
    if (liveModeInterval) {
        clearInterval(liveModeInterval);
        liveModeInterval = null;
    }
    
    // Remove move/zoom listeners
    if (map) {
        map.off('moveend', refreshWarningsOnMove);
        map.off('zoomend', refreshWarningsOnMove);
    }
}

function refreshWarningsOnMove() {
    if (liveModeActive && showWarnings) {
        fetchWarnings();
    }
}

function updateLastUpdateTime() {
    lastUpdateTime = new Date();
    const timeEl = document.getElementById('lastUpdateTime');
    if (timeEl) {
        timeEl.textContent = lastUpdateTime.toLocaleTimeString();
    }
}

// ============================================================================
// AUTO REFRESH
// ============================================================================

let autoRefreshInterval = null;

function toggleAutoRefresh() {
    // If live mode is active, disable it first
    if (liveModeActive) {
        toggleLiveMode();
    }
    
    const btn = document.getElementById('autoRefresh');
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
        btn.classList.remove('active');
        btn.innerHTML = '<i class="fas fa-sync-alt"></i> Auto Refresh';
    } else {
        autoRefreshInterval = setInterval(fetchLSRData, CONFIG.AUTO_REFRESH_INTERVAL);
        btn.classList.add('active');
        btn.innerHTML = '<i class="fas fa-sync-alt"></i> Auto Refresh ON';
        fetchLSRData();
    }
}

// ============================================================================
// DATE PRESETS
// ============================================================================

function setDatePreset(preset) {
    const today = new Date();
    const startDateEl = document.getElementById('startDate');
    const startHourEl = document.getElementById('startHour');
    const endDateEl = document.getElementById('endDate');
    const endHourEl = document.getElementById('endHour');
    const customDateFields = document.getElementById('customDateFields');
    const actionButtons = document.getElementById('actionButtons');
    
    endDateEl.value = today.toISOString().split('T')[0];
    endHourEl.value = '23:59';
    
    switch(preset) {
        case '24h':
            const yesterday24h = new Date(today);
            yesterday24h.setHours(today.getHours() - 24);
            startDateEl.value = yesterday24h.toISOString().split('T')[0];
            startHourEl.value = yesterday24h.toTimeString().slice(0, 5);
            customDateFields.style.display = 'none';
            actionButtons.style.display = 'none';
            // Auto-load data (unless live mode is active, it will handle its own refresh)
            if (!liveModeActive) {
                setTimeout(() => {
                    fetchLSRData();
                    updateFilterSummary();
                }, 100);
            }
            break;
        case '48h':
            const yesterday48h = new Date(today);
            yesterday48h.setHours(today.getHours() - 48);
            startDateEl.value = yesterday48h.toISOString().split('T')[0];
            startHourEl.value = yesterday48h.toTimeString().slice(0, 5);
            customDateFields.style.display = 'none';
            actionButtons.style.display = 'none';
            // Disable live mode if switching to 48h
            if (liveModeActive) {
                toggleLiveMode();
            }
            // Auto-load data
            setTimeout(() => {
                fetchLSRData();
                updateFilterSummary();
            }, 100);
            break;
        case 'week':
            const lastWeek = new Date(today);
            lastWeek.setDate(lastWeek.getDate() - 7);
            startDateEl.value = lastWeek.toISOString().split('T')[0];
            startHourEl.value = '00:00';
            customDateFields.style.display = 'none';
            actionButtons.style.display = 'none';
            // Disable live mode if switching to week
            if (liveModeActive) {
                toggleLiveMode();
            }
            // Auto-load data
            setTimeout(() => {
                fetchLSRData();
                updateFilterSummary();
            }, 100);
            break;
        case 'custom':
            // Show custom date fields and action buttons
            customDateFields.style.display = 'block';
            actionButtons.style.display = 'block';
            // Disable live mode if switching to custom
            if (liveModeActive) {
                toggleLiveMode();
            }
            break;
    }
    
    // Update active preset button
    document.querySelectorAll('.btn-preset').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`.btn-preset[data-preset="${preset}"]`)?.classList.add('active');
}

// ============================================================================
// WEATHER TYPE TOGGLE
// ============================================================================

function toggleAllWeatherTypes(selectAll) {
    const chips = document.querySelectorAll('.weather-chip');
    const hiddenCheckboxes = document.querySelectorAll('input[id^="hidden-filter-"]');
    
    chips.forEach(chip => {
        if (selectAll) {
            chip.classList.add('active');
        } else {
            chip.classList.remove('active');
        }
    });
    
    hiddenCheckboxes.forEach(cb => {
        cb.checked = selectAll;
    });
    
    // Update heat map button state
    updateHeatMapButtonState();
    
    // If heat map is active, refresh data
    if (heatMapMode && lastGeoJsonData) {
        const bounds = map.getBounds();
        displayReports(lastGeoJsonData, bounds.getSouth(), bounds.getNorth(), bounds.getEast(), bounds.getWest());
    }
    
    // Auto-fetch data after toggling
    fetchLSRData();
    updateFilterSummary();
}

// ============================================================================
// MAP CLICK TO SET BOUNDS
// ============================================================================

let boundsClickMode = false;
let boundsCorners = [];

function enableBoundsClickMode() {
    boundsClickMode = true;
    boundsCorners = [];
    map.getContainer().style.cursor = 'crosshair';
    
    // Show instruction
    showStatusToast('Click two corners on the map to set bounds', 'info');
}

function disableBoundsClickMode() {
    boundsClickMode = false;
    map.getContainer().style.cursor = '';
}

function handleMapClick(e) {
    if (!boundsClickMode) return;
    
    boundsCorners.push([e.latlng.lat, e.latlng.lng]);
    
    if (boundsCorners.length === 1) {
        // First click - show marker
        userArea.clearLayers();
        L.marker(e.latlng, {
            icon: L.divIcon({
                className: 'bounds-marker',
                html: '<div style="background: #dc2626; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
                iconSize: [12, 12],
                iconAnchor: [6, 6]
            })
        }).addTo(userArea);
    } else if (boundsCorners.length >= 2) {
        // Second click - set custom bounds
        const lat1 = boundsCorners[0][0];
        const lon1 = boundsCorners[0][1];
        const lat2 = boundsCorners[1][0];
        const lon2 = boundsCorners[1][1];
        
        const south = Math.min(lat1, lat2);
        const north = Math.max(lat1, lat2);
        const west = Math.min(lon1, lon2);
        const east = Math.max(lon1, lon2);
        
        // Draw rectangle
        userArea.clearLayers();
        const bounds = [[south, west], [north, east]];
        L.rectangle(bounds, {color: "red", fill: false, weight: 2, dashArray: '5, 5'}).addTo(userArea);
        map.fitBounds(bounds, { padding: [50, 50] });
        
        disableBoundsClickMode();
        
        showStatusToast('Custom area selected. Select a state/region from dropdown to filter data.', 'info');
    }
}

function clearBounds() {
    document.getElementById('regionSelect').value = '';
    userArea.clearLayers();
    disableBoundsClickMode();
    
    // Reset map to default view
    map.setView([CONFIG.MAP_INITIAL.lat, CONFIG.MAP_INITIAL.lon], CONFIG.MAP_INITIAL.zoom);
}

// ============================================================================
// UI INITIALIZATION
// ============================================================================

function initializeUI() {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Set default dates
    document.getElementById('startDate').value = yesterday.toISOString().split('T')[0];
    document.getElementById('startHour').value = '00:00';
    document.getElementById('endDate').value = today.toISOString().split('T')[0];
    document.getElementById('endHour').value = '23:59';
    
    const filterContainer = document.getElementById('weatherTypeFilters');
    const typeIcons = {
        'Rain': 'fa-cloud-rain',
        'Flood': 'fa-water',
        'Snow': 'fa-snowflake',
        'Ice': 'fa-icicles',
        'Hail': 'fa-circle',
        'Wind': 'fa-wind',
        'Thunderstorm': 'fa-bolt',
        'Tornado': 'fa-tornado',
        'Tropical': 'fa-hurricane',
        'Other': 'fa-cloud'
    };
    
    CONFIG.WEATHER_TYPES.forEach(type => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'weather-chip active';
        chip.id = `filter-${type}`;
        chip.dataset.type = type;
        chip.innerHTML = `
            <i class="fas ${typeIcons[type] || 'fa-cloud'}"></i>
            <span>${type}</span>
        `;
        chip.addEventListener('click', () => {
            chip.classList.toggle('active');
            // Update hidden checkbox for compatibility
            const hiddenCheckbox = document.getElementById(`hidden-filter-${type}`);
            if (hiddenCheckbox) {
                hiddenCheckbox.checked = chip.classList.contains('active');
            }
            // Update heat map button state
            updateHeatMapButtonState();
            // Refresh data if heat map is active
            if (heatMapMode && lastGeoJsonData) {
                const bounds = map.getBounds();
                displayReports(lastGeoJsonData, bounds.getSouth(), bounds.getNorth(), bounds.getEast(), bounds.getWest());
            }
        });
        filterContainer.appendChild(chip);
        
        // Create hidden checkbox for compatibility with existing code
        const hiddenCheckbox = document.createElement('input');
        hiddenCheckbox.type = 'checkbox';
        hiddenCheckbox.id = `hidden-filter-${type}`;
        hiddenCheckbox.value = type;
        hiddenCheckbox.checked = true;
        hiddenCheckbox.style.display = 'none';
        document.body.appendChild(hiddenCheckbox);
    });
    
    
    // Check for URL parameters on load (before setting default preset)
    const hasURLParams = window.location.search.length > 0;
    if (hasURLParams) {
        loadStateFromURL();
    } else {
        // Set default date preset (will auto-load data)
        setDatePreset('24h');
    }
    
    const legendContainer = document.getElementById('legend');
    const legendTooltips = {
        'Rain': 'Rainfall reports measured in inches. Color intensity indicates amount.',
        'Flood': 'Flooding reports. Green indicates flood conditions.',
        'Snow': 'Snowfall reports measured in inches. Color changes with accumulation.',
        'Ice': 'Ice accumulation reports. Gray to purple indicates severity.',
        'Hail': 'Hail size reports in inches. Pink to purple indicates larger hail.',
        'Wind': 'Wind speed reports in mph. Yellow to brown indicates stronger winds.',
        'Thunderstorm': 'Thunderstorm wind reports. Yellow to red indicates severity.',
        'Tornado': 'Tornado reports. Red markers indicate confirmed tornadoes.',
        'Tropical': 'Tropical storm/hurricane reports. White to black indicates intensity.',
        'Other': 'Other weather phenomena not categorized above.'
    };
    
    LEGEND_ITEMS.forEach(item => {
        const div = document.createElement('div');
        div.className = 'legend-item';
        div.title = legendTooltips[item.name] || `${item.name} weather reports`;
        const borderRadius = item.shape === 'square' ? '0%' : '50%';
        div.innerHTML = `
            <div class="legend-icon" style="background-color: ${item.color}; border-radius: ${borderRadius};" title="${legendTooltips[item.name] || ''}">
                ${item.emoji ? `<span class="legend-emoji">${item.emoji}</span>` : ''}
            </div>
            <div class="legend-text">${item.name}</div>
        `;
        legendContainer.appendChild(div);
    });
    
}

// ============================================================================
// SHAREABLE URL
// ============================================================================

function generateShareableURL() {
    const params = new URLSearchParams();
    
    // Date range
    const startDate = document.getElementById('startDate').value;
    const startHour = document.getElementById('startHour').value;
    const endDate = document.getElementById('endDate').value;
    const endHour = document.getElementById('endHour').value;
    
    if (startDate && endDate) {
        params.set('start', `${startDate}T${startHour}`);
        params.set('end', `${endDate}T${endHour}`);
    }
    
    // Region/State
    const region = document.getElementById('regionSelect').value;
    if (region) {
        params.set('region', region);
    }
    
    // Weather types
    const activeTypes = Array.from(document.querySelectorAll('#weatherTypeFilters input:checked'))
        .map(cb => cb.value);
    if (activeTypes.length > 0 && activeTypes.length < CONFIG.WEATHER_TYPES.length) {
        params.set('types', activeTypes.join(','));
    }
    
    return window.location.origin + window.location.pathname + '?' + params.toString();
}

function loadStateFromURL() {
    const params = new URLSearchParams(window.location.search);
    let shouldFetch = false;
    
    // Load date range
    if (params.has('start') && params.has('end')) {
        const start = params.get('start').split('T');
        const end = params.get('end').split('T');
        if (start[0] && end[0]) {
            document.getElementById('startDate').value = start[0];
            document.getElementById('startHour').value = start[1] || '00:00';
            document.getElementById('endDate').value = end[0];
            document.getElementById('endHour').value = end[1] || '23:59';
            setDatePreset('custom');
            shouldFetch = true;
        }
    } else {
        // No date params, use default
        setDatePreset('24h');
    }
    
    // Load region
    if (params.has('region')) {
        document.getElementById('regionSelect').value = params.get('region');
        // Trigger change event to zoom and fetch
        const event = new Event('change', { bubbles: true });
        document.getElementById('regionSelect').dispatchEvent(event);
        shouldFetch = true;
    }
    
    // Load weather types
    if (params.has('types')) {
        const types = params.get('types').split(',');
        document.querySelectorAll('input[id^="hidden-filter-"]').forEach(cb => {
            const isActive = types.includes(cb.value);
            cb.checked = isActive;
            const chip = document.getElementById(`filter-${cb.value}`);
            if (chip) {
                if (isActive) {
                    chip.classList.add('active');
                } else {
                    chip.classList.remove('active');
                }
            }
        });
    }
    
    // If we loaded from URL and it's custom, fetch data
    if (shouldFetch && document.querySelector('.btn-preset.active')?.dataset.preset === 'custom') {
        setTimeout(() => fetchLSRData(), 500);
    }
}

// ============================================================================
// EXPORT DATA
// ============================================================================

function convertToCSV(reports) {
    // Extract data from reports
    const rows = [];
    rows.push('Type,Magnitude,Latitude,Longitude,Location,Time,Remarks');
    
    reports.forEach(report => {
        const type = report.type || 'Other';
        const magnitude = report.magnitude ? `${report.magnitude}${report.unit || ''}` : '';
        const location = report.location || '';
        const time = report.time || '';
        const remarks = (report.remark || '').replace(/"/g, '""');
        
        const row = [
            `"${type}"`,
            `"${magnitude}"`,
            report.lat,
            report.lon,
            `"${location.replace(/"/g, '""')}"`,
            `"${time.replace(/"/g, '""')}"`,
            `"${remarks}"`
        ].join(',');
        
        rows.push(row);
    });
    
    return rows.join('\n');
}

function convertToJSON(reports) {
    return JSON.stringify(reports.map(report => ({
        type: report.type || 'Other',
        magnitude: report.magnitude || null,
        unit: report.unit || '',
        latitude: report.lat,
        longitude: report.lon,
        location: report.location || '',
        time: report.time || '',
        remark: report.remark || ''
    })), null, 2);
}

function convertToGeoJSON(reports) {
    return JSON.stringify({
        type: 'FeatureCollection',
        features: reports.map(report => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [report.lon, report.lat]
            },
            properties: {
                type: report.type || 'Other',
                magnitude: report.magnitude || null,
                unit: report.unit || '',
                location: report.location || '',
                time: report.time || '',
                remark: report.remark || ''
            }
        }))
    }, null, 2);
}

function showExportOptions() {
    if (allFilteredReports.length === 0) {
        showStatusToast('No data to export. Please load data first.', 'info');
        return;
    }
    
    // Show export modal with format options
    const exportModal = document.getElementById('exportModal');
    if (exportModal) {
        exportModal.classList.add('show');
    }
}

function downloadFile(data, filename, mimeType) {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showStatusToast(`Exported ${allFilteredReports.length} reports as ${filename.split('.').pop().toUpperCase()}`, 'success');
}

// Update export count in modal
function updateExportCount() {
    const exportCountEl = document.getElementById('exportCount');
    if (exportCountEl) {
        exportCountEl.textContent = allFilteredReports.length.toLocaleString();
    }
}

function handleExport(format) {
    if (allFilteredReports.length === 0) {
        showStatusToast('No data to export. Please load data first.', 'info');
        return;
    }
    
    let data, filename, mimeType;
    const dateStr = new Date().toISOString().split('T')[0];
    
    switch(format) {
        case 'csv':
            data = convertToCSV(allFilteredReports);
            filename = `storm-reports-${dateStr}.csv`;
            mimeType = 'text/csv';
            break;
        case 'json':
            data = convertToJSON(allFilteredReports);
            filename = `storm-reports-${dateStr}.json`;
            mimeType = 'application/json';
            break;
        case 'geojson':
            data = convertToGeoJSON(allFilteredReports);
            filename = `storm-reports-${dateStr}.geojson`;
            mimeType = 'application/geo+json';
            break;
        default:
            return;
    }
    
    downloadFile(data, filename, mimeType);
    
    // Close export modal
    const exportModal = document.getElementById('exportModal');
    if (exportModal) {
        exportModal.classList.remove('show');
    }
}

// ============================================================================
// KEYBOARD SHORTCUTS
// ============================================================================

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Don't trigger shortcuts when typing in inputs
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable) {
            return;
        }
        
        // Don't trigger if modifier keys are pressed (except for help)
        if (e.ctrlKey || e.metaKey || e.altKey) {
            // Allow Ctrl/Cmd + ? for help
            if ((e.ctrlKey || e.metaKey) && e.key === '?') {
                e.preventDefault();
                showHelpModal();
            }
            return;
        }
        
        switch(e.key.toLowerCase()) {
            case 'g':
                e.preventDefault();
                document.getElementById('fetchData')?.click();
                break;
            case 'c':
                e.preventDefault();
                document.getElementById('clearMap')?.click();
                break;
            case 's':
                e.preventDefault();
                document.getElementById('shareLink')?.click();
                break;
            case 'e':
                e.preventDefault();
                document.getElementById('exportData')?.click();
                break;
            case '?':
                e.preventDefault();
                showHelpModal();
                break;
        }
    });
}

function showHelpModal() {
    const helpModal = document.getElementById('helpModal');
    if (helpModal) {
        helpModal.classList.add('show');
    }
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

// Initialize offline detection
offlineDetector.addListener((isOnline) => {
    if (!isOnline) {
        showStatusToast('You are now offline. Some features may be limited.', 'warning');
    } else {
        showStatusToast('Connection restored.', 'success');
    }
});

document.addEventListener('DOMContentLoaded', () => {
    // Ensure CONFIG is loaded (it should be from script tag, but check anyway)
    if (typeof CONFIG === 'undefined') {
        console.error('CONFIG is not defined. Make sure config.js is loaded before app.js');
        showStatusToast('Configuration error. Please refresh the page.', 'error');
        return;
    }
    
    // Initialize map first
    map = L.map('map').setView([CONFIG.MAP_INITIAL.lat, CONFIG.MAP_INITIAL.lon], CONFIG.MAP_INITIAL.zoom);
    
    // Add base tile layer immediately
    updateMapTileLayer();
    
    // Initialize dark mode (after map is created so it can update tiles)
    initializeDarkMode();
    
    markersLayer = L.layerGroup().addTo(map);
    heatMapLayer = null; // Will be created when heat map mode is enabled
    pnsLayer = L.layerGroup().addTo(map);
    warningsLayer = L.layerGroup().addTo(map);
    userArea = L.layerGroup().addTo(map);
    
    // Initialize heat map button state
    setTimeout(() => updateHeatMapButtonState(), 100);
    
    // Initialize warnings service
    warningsService = new WarningsService();
    
    // Initialize radar layer (will be added when live mode is enabled)
    radarLayer = null;
    
    initializeUI();
    
    // Collapsible sections
    document.querySelectorAll('.control-group-header, .section-header').forEach(header => {
        header.addEventListener('click', () => {
            const section = header.closest('.control-group, .collapsible-section');
            if (section) {
                section.classList.toggle('collapsed');
            }
        });
    });
    
    // Dropdown menu for actions
    const moreActionsBtn = document.getElementById('moreActionsBtn');
    const moreActionsMenu = document.getElementById('moreActionsMenu');
    if (moreActionsBtn && moreActionsMenu) {
        moreActionsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const wrapper = moreActionsBtn.closest('.btn-dropdown-wrapper');
            wrapper.classList.toggle('active');
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!moreActionsBtn.contains(e.target) && !moreActionsMenu.contains(e.target)) {
                moreActionsBtn.closest('.btn-dropdown-wrapper')?.classList.remove('active');
            }
        });
    }
    
    // Clear all filters
    document.getElementById('clearAllFilters').addEventListener('click', () => {
        // Reset date to 24h
        setDatePreset('24h');
        // Reset location
        document.getElementById('regionSelect').value = '';
        document.getElementById('regionSelect').dispatchEvent(new Event('change'));
        // Reset weather types to all
        toggleAllWeatherTypes(true);
        // Clear PNS toggle
        const pnsCheckbox = document.getElementById('showPNS');
        if (pnsCheckbox) {
            pnsCheckbox.checked = false;
            showPNS = false;
        }
        // Clear map
        clearMap();
    });
    
    // PNS Toggle Logic
    const pnsCheckbox = document.getElementById('showPNS');
    if (pnsCheckbox) {
        pnsCheckbox.addEventListener('change', (e) => {
            showPNS = e.target.checked;
            if (showPNS) {
                fetchPNSData();
            } else {
                if (pnsLayer) {
                    pnsLayer.clearLayers();
                }
            }
        });
    }
    
    // Live mode toggle
    document.getElementById('toggleLiveMode').addEventListener('click', toggleLiveMode);
    
    // Heat map toggle
    document.getElementById('toggleHeatMap').addEventListener('click', toggleHeatMap);
    
    // Status toast close
    document.getElementById('closeStatusToast').addEventListener('click', () => {
        const toast = document.getElementById('statusToast');
        toast.style.display = 'none';
    });
    
    // Date presets
    document.querySelectorAll('.btn-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = btn.getAttribute('data-preset');
            setDatePreset(preset);
            updateFilterSummary();
        });
    });
    
    // Weather type toggles
    document.getElementById('selectAllTypes').addEventListener('click', () => toggleAllWeatherTypes(true));
    document.getElementById('selectNoneTypes').addEventListener('click', () => toggleAllWeatherTypes(false));
    
    
    
    // Map click for bounds (double-click on map to enable bounds mode)
    map.on('dblclick', (e) => {
        enableBoundsClickMode();
    });
    
    // Handle map clicks when in bounds mode
    map.on('click', (e) => {
        if (boundsClickMode) {
            handleMapClick(e);
        }
    });
    
    // Refresh markers when zoom/pan changes (for zoom-based limits and viewport filtering)
    let zoomMoveTimeout;
    const refreshMarkersOnZoomMove = () => {
        clearTimeout(zoomMoveTimeout);
        zoomMoveTimeout = setTimeout(() => {
            const currentZoom = map.getZoom();
            // Always refresh on zoom changes to apply zoom-based limits
            // Only apply viewport filtering when zoomed in enough
            if (lastGeoJsonData && allFilteredReports.length > 0) {
                // Get current bounds from selected region/state
                const regionSelect = document.getElementById('regionSelect');
                const selectedRegion = regionSelect.value;
                
                let southLat, northLat, eastLon, westLon;
                
                if (selectedRegion && CONFIG.STATES[selectedRegion]) {
                    const stateBounds = CONFIG.STATES[selectedRegion].bounds;
                    southLat = stateBounds[0];
                    northLat = stateBounds[1];
                    eastLon = stateBounds[2];
                    westLon = stateBounds[3];
                } else if (selectedRegion && CONFIG.REGIONS[selectedRegion]) {
                    const regionBounds = CONFIG.REGIONS[selectedRegion].bounds;
                    southLat = regionBounds[0];
                    northLat = regionBounds[1];
                    eastLon = regionBounds[2];
                    westLon = regionBounds[3];
                } else {
                    southLat = CONFIG.DEFAULT_BOUNDS.south;
                    northLat = CONFIG.DEFAULT_BOUNDS.north;
                    eastLon = CONFIG.DEFAULT_BOUNDS.east;
                    westLon = CONFIG.DEFAULT_BOUNDS.west;
                }
                
                // Re-display with current zoom level (applies zoom-based limits)
                // Viewport filtering is handled inside displayReports based on zoom level
                displayReports(lastGeoJsonData, southLat, northLat, eastLon, westLon);
            }
        }, 300); // Debounce for 300ms
    };
    
    // Always listen to zoom changes to update marker limits
    map.on('zoomend', refreshMarkersOnZoomMove);
    
    // Only listen to move events when viewport filtering is enabled
    if (CONFIG.VIEWPORT_ONLY) {
        map.on('moveend', refreshMarkersOnZoomMove);
    }
    
    // Region/State selector
    document.getElementById('regionSelect').addEventListener('change', (e) => {
        const selectedRegion = e.target.value;
        userArea.clearLayers();
        
        if (selectedRegion) {
            let bounds;
            if (CONFIG.STATES[selectedRegion]) {
                const stateBounds = CONFIG.STATES[selectedRegion].bounds;
                bounds = [[stateBounds[0], stateBounds[3]], [stateBounds[1], stateBounds[2]]];
                // Draw rectangle
                L.rectangle(bounds, {color: "red", fill: false, weight: 2, dashArray: '5, 5'}).addTo(userArea);
                map.fitBounds(bounds, { padding: [50, 50] });
                // Automatically fetch data for selected region
                setTimeout(() => {
                    fetchLSRData();
                    updateFilterSummary();
                }, 300); // Small delay to allow zoom animation
            } else if (CONFIG.REGIONS[selectedRegion]) {
                const regionBounds = CONFIG.REGIONS[selectedRegion].bounds;
                bounds = [[regionBounds[0], regionBounds[3]], [regionBounds[1], regionBounds[2]]];
                // Draw rectangle
                L.rectangle(bounds, {color: "red", fill: false, weight: 2, dashArray: '5, 5'}).addTo(userArea);
                map.fitBounds(bounds, { padding: [50, 50] });
                // Automatically fetch data for selected region
                setTimeout(() => {
                    fetchLSRData();
                    updateFilterSummary();
                }, 300); // Small delay to allow zoom animation
            }
        } else {
            // Reset to default view
            map.setView([CONFIG.MAP_INITIAL.lat, CONFIG.MAP_INITIAL.lon], CONFIG.MAP_INITIAL.zoom);
            // Fetch data for full US
            setTimeout(() => {
                fetchLSRData();
                updateFilterSummary();
            }, 300);
        }
    });
    
    // Update filter summary when weather types change
    document.getElementById('weatherTypeFilters').addEventListener('click', () => {
        setTimeout(updateFilterSummary, 100);
    });
    
    // Clear bounds button
    document.getElementById('clearBounds').addEventListener('click', clearBounds);
    
    // Action buttons
    document.getElementById('fetchData').addEventListener('click', () => {
        fetchLSRData();
        updateFilterSummary();
    });
    // clearMap and autoRefresh are now in dropdown menu
    
    // Mobile menu toggle
    const mobileMenuToggle = document.getElementById('mobileMenuToggle');
    const mobileMenuClose = document.getElementById('mobileMenuClose');
    const controlsPanel = document.querySelector('.controls-panel');
    
    function toggleMobileMenu() {
        controlsPanel.classList.toggle('open');
        if (mobileMenuToggle) {
            mobileMenuToggle.classList.toggle('active');
        }
    }
    
    function closeMobileMenu() {
        controlsPanel.classList.remove('open');
        if (mobileMenuToggle) {
            mobileMenuToggle.classList.remove('active');
        }
    }
    
    if (mobileMenuToggle) {
        mobileMenuToggle.addEventListener('click', toggleMobileMenu);
    }
    
    if (mobileMenuClose) {
        mobileMenuClose.addEventListener('click', closeMobileMenu);
    }
    
    // Close menu when clicking outside on mobile
    if (window.innerWidth <= 768) {
        document.addEventListener('click', (e) => {
            if (controlsPanel.classList.contains('open')) {
                // Check if click is outside the panel
                if (!controlsPanel.contains(e.target) && 
                    !mobileMenuToggle.contains(e.target) &&
                    !mobileMenuClose.contains(e.target)) {
                    closeMobileMenu();
                }
            }
        });
    }
    
    // Quick filter presets
    document.getElementById('quickFilterSevere').addEventListener('click', () => {
        toggleAllWeatherTypes(false);
        WEATHER_CATEGORIES.SEVERE.forEach(type => {
            const chip = document.getElementById(`filter-${type}`);
            const hiddenCheckbox = document.getElementById(`hidden-filter-${type}`);
            if (chip) chip.classList.add('active');
            if (hiddenCheckbox) hiddenCheckbox.checked = true;
        });
        if (document.querySelector('.btn-preset.active')?.dataset.preset !== 'custom') {
            fetchLSRData();
        }
    });
    
    document.getElementById('quickFilterWinter').addEventListener('click', () => {
        toggleAllWeatherTypes(false);
        WEATHER_CATEGORIES.WINTER.forEach(type => {
            const chip = document.getElementById(`filter-${type}`);
            const hiddenCheckbox = document.getElementById(`hidden-filter-${type}`);
            if (chip) chip.classList.add('active');
            if (hiddenCheckbox) hiddenCheckbox.checked = true;
        });
        if (document.querySelector('.btn-preset.active')?.dataset.preset !== 'custom') {
            fetchLSRData();
        }
    });
    
    document.getElementById('quickFilterPrecip').addEventListener('click', () => {
        toggleAllWeatherTypes(false);
        WEATHER_CATEGORIES.PRECIP.forEach(type => {
            const chip = document.getElementById(`filter-${type}`);
            const hiddenCheckbox = document.getElementById(`hidden-filter-${type}`);
            if (chip) chip.classList.add('active');
            if (hiddenCheckbox) hiddenCheckbox.checked = true;
        });
        if (document.querySelector('.btn-preset.active')?.dataset.preset !== 'custom') {
            fetchLSRData();
        }
    });
    
    // Share link functionality
    document.getElementById('shareLink').addEventListener('click', () => {
        const url = generateShareableURL();
        navigator.clipboard.writeText(url).then(() => {
            const btn = document.getElementById('shareLink');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
            btn.classList.add('active');
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.classList.remove('active');
            }, 2000);
        }).catch(() => {
            // Fallback for browsers without clipboard API
            const url = generateShareableURL();
            prompt('Copy this link:', url);
        });
    });
    
    // Export data functionality
    document.getElementById('exportData').addEventListener('click', () => {
        if (allFilteredReports.length === 0) {
            showStatusToast('No data to export. Please load data first.', 'info');
            return;
        }
        
        // Show export options
        showExportOptions();
    });
    
    // Top 10 Reports modal
    const topReportsModal = document.getElementById('topReportsModal');
    const showTopReportsBtn = document.getElementById('showTopReports');
    const closeTopReportsBtn = document.getElementById('closeTopReports');
    
    showTopReportsBtn.addEventListener('click', () => {
        displayTopReports();
        topReportsModal.classList.add('show');
    });
    
    closeTopReportsBtn.addEventListener('click', () => {
        topReportsModal.classList.remove('show');
    });
    
    // Close modal when clicking outside
    topReportsModal.addEventListener('click', (e) => {
        if (e.target === topReportsModal) {
            topReportsModal.classList.remove('show');
        }
    });
    
    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (topReportsModal.classList.contains('show')) {
                topReportsModal.classList.remove('show');
            }
            const pnsModal = document.getElementById('pnsModal');
            if (pnsModal && pnsModal.classList.contains('show')) {
                pnsModal.classList.remove('show');
            }
        }
    });
    
    // PNS Modal handlers
    const pnsModal = document.getElementById('pnsModal');
    const closePnsModalBtn = document.getElementById('closePnsModal');
    
    if (closePnsModalBtn) {
        closePnsModalBtn.addEventListener('click', () => {
            pnsModal.classList.remove('show');
        });
    }
    
    if (pnsModal) {
        pnsModal.addEventListener('click', (e) => {
            if (e.target === pnsModal) {
                pnsModal.classList.remove('show');
            }
        });
    }
    
    // Performance banner close button
    const closePerformanceBanner = document.getElementById('closePerformanceBanner');
    if (closePerformanceBanner) {
        closePerformanceBanner.addEventListener('click', () => {
            const banner = document.getElementById('performanceBanner');
            if (banner) banner.style.display = 'none';
        });
    }
    
    // Empty state action button
    const emptyStateGetData = document.getElementById('emptyStateGetData');
    if (emptyStateGetData) {
        emptyStateGetData.addEventListener('click', () => {
            document.getElementById('fetchData')?.click();
        });
    }
    
    // Performance banner updates are now handled in refreshMarkersOnZoomMove
    // which calls displayReports -> updateReportCount
    
    // Keyboard shortcuts
    setupKeyboardShortcuts();
    
    // Clickable summary items - scroll to relevant filter section
    document.querySelectorAll('.cv-clickable').forEach(btn => {
        btn.addEventListener('click', () => {
            const section = btn.dataset.section;
            const targetSection = document.querySelector(`.control-group[data-section="${section}"]`);
            if (targetSection) {
                // Expand if collapsed
                if (targetSection.classList.contains('collapsed')) {
                    targetSection.classList.remove('collapsed');
                }
                // Scroll to section
                targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                // Highlight briefly
                targetSection.style.transition = 'background-color 0.3s';
                targetSection.style.backgroundColor = 'rgba(37, 99, 235, 0.1)';
                setTimeout(() => {
                    targetSection.style.backgroundColor = '';
                }, 1000);
            }
        });
    });
    
    // Map controls - use setTimeout to ensure DOM is ready
    setTimeout(() => {
        const resetViewBtn = document.getElementById('resetView');
        if (resetViewBtn) {
            resetViewBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Reset View clicked');
                resetView();
            };
            console.log('Reset View button attached');
        } else {
            console.error('Reset View button not found in DOM');
        }
        
        const myLocationBtn = document.getElementById('myLocation');
        if (myLocationBtn) {
            myLocationBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('My Location clicked');
                centerOnMyLocation();
            };
            console.log('My Location button attached');
        } else {
            console.error('My Location button not found in DOM');
        }
        
        const clearMapBtn = document.getElementById('clearMapBtn');
        if (clearMapBtn) {
            clearMapBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Clear Map clicked');
                clearMap();
            };
            console.log('Clear Map button attached');
        } else {
            console.error('Clear Map button not found in DOM');
        }
    }, 100);
    
    // Dropdown clearMap button (also exists in More Actions menu)
    const dropdownClearMap = document.getElementById('clearMap');
    if (dropdownClearMap) {
        dropdownClearMap.addEventListener('click', clearMap);
    }
    
    // Help modal handlers
    const helpModal = document.getElementById('helpModal');
    const closeHelpModal = document.getElementById('closeHelpModal');
    const headerHelpBtn = document.getElementById('headerHelpBtn');
    
    // Show help from header button
    if (headerHelpBtn) {
        headerHelpBtn.addEventListener('click', () => {
            showHelpModal();
        });
    }
    
    if (closeHelpModal) {
        closeHelpModal.addEventListener('click', () => {
            if (helpModal) helpModal.classList.remove('show');
        });
    }
    
    if (helpModal) {
        helpModal.addEventListener('click', (e) => {
            if (e.target === helpModal) {
                helpModal.classList.remove('show');
            }
        });
    }
    
    // Export modal handlers
    const exportModal = document.getElementById('exportModal');
    const closeExportModal = document.getElementById('closeExportModal');
    
    // Export option buttons
    document.querySelectorAll('.export-option-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const format = btn.dataset.format;
            handleExport(format);
        });
    });
    
    if (closeExportModal) {
        closeExportModal.addEventListener('click', () => {
            if (exportModal) exportModal.classList.remove('show');
        });
    }
    
    if (exportModal) {
        exportModal.addEventListener('click', (e) => {
            if (e.target === exportModal) {
                exportModal.classList.remove('show');
            }
        });
    }
    
    // Update Escape key handler to include all modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (helpModal && helpModal.classList.contains('show')) {
                helpModal.classList.remove('show');
            }
            if (exportModal && exportModal.classList.contains('show')) {
                exportModal.classList.remove('show');
            }
            const topReportsModal = document.getElementById('topReportsModal');
            if (topReportsModal && topReportsModal.classList.contains('show')) {
                topReportsModal.classList.remove('show');
            }
            const pnsModal = document.getElementById('pnsModal');
            if (pnsModal && pnsModal.classList.contains('show')) {
                pnsModal.classList.remove('show');
            }
            const tutorialModal = document.getElementById('tutorialModal');
            if (tutorialModal && tutorialModal.classList.contains('show')) {
                tutorialModal.classList.remove('show');
                localStorage.setItem('lsr-tutorial-seen', 'true');
            }
        }
    });
    
    // Export count is updated in displayReports function
    
    // First Visit Tutorial
    setupTutorial();
    
    // Auto-load data for last 24 hours on page load (handled by setDatePreset)
});

// ============================================================================
// DARK MODE
// ============================================================================

function initializeDarkMode() {
    const darkModeToggle = document.getElementById('darkModeToggle');
    const darkModeIcon = document.getElementById('darkModeIcon');
    const html = document.documentElement;
    
    // Check for saved theme preference or default to light mode
    const savedTheme = localStorage.getItem('lsr-theme') || 'light';
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    // Use saved preference, or system preference if no saved preference
    const currentTheme = savedTheme === 'auto' ? (prefersDark ? 'dark' : 'light') : savedTheme;
    
    function setTheme(theme) {
        const darkModeLabel = darkModeToggle?.querySelector('.header-action-label');
        
        if (theme === 'dark') {
            html.setAttribute('data-theme', 'dark');
            if (darkModeIcon) {
                darkModeIcon.className = 'fas fa-sun';
            }
            if (darkModeLabel) {
                darkModeLabel.textContent = 'Light Mode';
            }
            if (darkModeToggle) {
                darkModeToggle.title = 'Switch to light mode';
            }
            localStorage.setItem('lsr-theme', 'dark');
        } else {
            html.removeAttribute('data-theme');
            if (darkModeIcon) {
                darkModeIcon.className = 'fas fa-moon';
            }
            if (darkModeLabel) {
                darkModeLabel.textContent = 'Dark Mode';
            }
            if (darkModeToggle) {
                darkModeToggle.title = 'Switch to dark mode';
            }
            localStorage.setItem('lsr-theme', 'light');
        }
    }
    
    // Set initial theme (this will also initialize the map tile layer)
    setTheme(currentTheme);
    
    // Toggle theme on button click
    if (darkModeToggle) {
        darkModeToggle.addEventListener('click', () => {
            const isDark = html.getAttribute('data-theme') === 'dark';
            setTheme(isDark ? 'light' : 'dark');
            showStatusToast(isDark ? 'Switched to light mode' : 'Switched to dark mode', 'success');
        });
    }
    
    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        const savedTheme = localStorage.getItem('lsr-theme');
        if (savedTheme === 'auto' || !savedTheme) {
            setTheme(e.matches ? 'dark' : 'light');
        }
    });
}

// Update map tile layer based on current theme
function updateMapTileLayer() {
    if (!map) return;
    
    // Use same map tiles for both light and dark mode (no switching)
    // Only create if it doesn't exist
    if (!baseTileLayer) {
        baseTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19
        });
    }
    
    // Always ensure the layer is added to the map
    if (!map.hasLayer(baseTileLayer)) {
        baseTileLayer.addTo(map);
    }
}

// ============================================================================
// TUTORIAL MODAL
// ============================================================================

function setupTutorial() {
    const tutorialModal = document.getElementById('tutorialModal');
    const closeTutorialBtn = document.getElementById('closeTutorialModal');
    const tutorialSkipBtn = document.getElementById('tutorialSkip');
    const tutorialNextBtn = document.getElementById('tutorialNext');
    const tutorialPrevBtn = document.getElementById('tutorialPrev');
    const tutorialFinishBtn = document.getElementById('tutorialFinish');
    const tutorialSteps = document.querySelectorAll('.tutorial-step');
    const tutorialStepCount = document.getElementById('tutorialStepCount');
    const tutorialTotalSteps = document.getElementById('tutorialTotalSteps');
    
    if (!tutorialModal) return;
    
    let currentStep = 1;
    const totalSteps = tutorialSteps.length;
    tutorialTotalSteps.textContent = totalSteps;
    
    // Check if user has seen tutorial
    const hasSeenTutorial = localStorage.getItem('lsr-tutorial-seen') === 'true';
    
    if (!hasSeenTutorial) {
        // Show tutorial after a short delay
        setTimeout(() => {
            tutorialModal.classList.add('show');
        }, 500);
    }
    
    function updateTutorialStep() {
        // Hide all steps
        tutorialSteps.forEach(step => {
            step.classList.remove('active');
        });
        
        // Show current step
        const currentStepEl = document.querySelector(`.tutorial-step[data-step="${currentStep}"]`);
        if (currentStepEl) {
            currentStepEl.classList.add('active');
        }
        
        // Update step counter
        tutorialStepCount.textContent = currentStep;
        
        // Update button visibility
        tutorialPrevBtn.style.display = currentStep === 1 ? 'none' : 'inline-flex';
        tutorialNextBtn.style.display = currentStep === totalSteps ? 'none' : 'inline-flex';
        tutorialFinishBtn.style.display = currentStep === totalSteps ? 'inline-flex' : 'none';
        tutorialSkipBtn.style.display = currentStep === totalSteps ? 'none' : 'inline-flex';
    }
    
    function nextStep() {
        if (currentStep < totalSteps) {
            currentStep++;
            updateTutorialStep();
        }
    }
    
    function prevStep() {
        if (currentStep > 1) {
            currentStep--;
            updateTutorialStep();
        }
    }
    
    function closeTutorial() {
        tutorialModal.classList.remove('show');
        localStorage.setItem('lsr-tutorial-seen', 'true');
    }
    
    // Event listeners
    if (closeTutorialBtn) {
        closeTutorialBtn.addEventListener('click', closeTutorial);
    }
    
    if (tutorialSkipBtn) {
        tutorialSkipBtn.addEventListener('click', closeTutorial);
    }
    
    if (tutorialNextBtn) {
        tutorialNextBtn.addEventListener('click', nextStep);
    }
    
    if (tutorialPrevBtn) {
        tutorialPrevBtn.addEventListener('click', prevStep);
    }
    
    if (tutorialFinishBtn) {
        tutorialFinishBtn.addEventListener('click', closeTutorial);
    }
    
    // Close on backdrop click
    tutorialModal.addEventListener('click', (e) => {
        if (e.target === tutorialModal) {
            closeTutorial();
        }
    });
    
    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && tutorialModal.classList.contains('show')) {
            closeTutorial();
        }
    });
    
    // Initialize first step
    updateTutorialStep();
}
