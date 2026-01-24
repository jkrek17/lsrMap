// ============================================================================
// MODULE IMPORTS
// ============================================================================

import { formatDateForAPI, extractWindSpeed, getUnitForReportType, getReportTypeName, isCoastalFlood } from './js/utils/formatters.js';
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
import PNSService from './js/api/pnsService.js';
import StatisticsService from './js/ui/statisticsService.js';
import ReportCountService from './js/ui/reportCountService.js';
import FilterService from './js/filter/filterService.js';

// ============================================================================
// MAP INITIALIZATION
// ============================================================================

// Map will be initialized in DOMContentLoaded
let map = null;
let baseTileLayer = null; // Base map tile layer
let markersLayer = null;
let pnsLayer = null; // Layer for Public Information Statements
let showPNS = false; // Toggle for PNS display
let warningsLayer = null; // Layer for NWS warnings/alerts
let showWarnings = false; // Toggle for warnings display
let showAllWarningsLayer = false;
let showAllWatchesLayer = false;
let warningsService = null; // Warnings service instance
let allWarningsLayer = null;
let allWatchesLayer = null;
let warningsListenersAttached = false;
let userArea = null;
let radarLayer = null; // Legacy - keeping for compatibility
let radarLayers = []; // Array of tile layers for animation
let radarLayerGroup = null; // Layer group to hold all radar layers
let liveModeActive = false;
let liveModeInterval = null;
let liveModeRangeHours = 24;
let lastUpdateTime = null;
let radarTimestamps = [];
let radarAnimationIndex = 0;
let radarAnimationInterval = null;
let radarAnimationPlaying = false;
let radarRefreshInterval = null;

// Initialize LSR Service
let lsrService = null;

// Initialize PNS Service
let pnsService = null;

// Initialize Statistics Service
let statisticsService = null;

// Initialize Report Count Service
let reportCountService = null;

// Initialize Filter Service
let filterService = null;

// ============================================================================
// ICON CREATION (wrapper functions for compatibility)
// ============================================================================

// Wrapper to maintain compatibility with existing code
function createIconWrapper(config, fillColor, strokeColor, emoji = null) {
    if (typeof CONFIG === 'undefined') {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.error('CONFIG not available');
        }
        return null;
    }
    return createIcon(config, fillColor, strokeColor, emoji, CONFIG.ICON_SIZE);
}

// Wrapper for getIconForReport
function getIconForReportWrapper(rtype, magnitude, remark, typetext = '') {
    if (typeof CONFIG === 'undefined' || typeof ICON_CONFIG === 'undefined') {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.error('CONFIG or ICON_CONFIG not available');
        }
        return null;
    }
    return getIconForReport(rtype, magnitude, remark, ICON_CONFIG, CONFIG.ICON_SIZE, extractWindSpeed, typetext);
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

function getWeatherTypeId(type) {
    return String(type).toLowerCase().replace(/\s+/g, '-');
}

function getActiveWeatherFilters() {
    return Array.from(document.querySelectorAll('input[id^="hidden-filter-"]:checked'))
        .map(cb => cb.value);
}

function updateFilterSummary() {
    const summary = document.getElementById('filterSummary');
    const summaryDate = document.getElementById('summaryDate');
    const summaryLocation = document.getElementById('summaryLocation');
    const summaryTypes = document.getElementById('summaryTypes');
    
    if (!summary || !summaryDate || !summaryLocation || !summaryTypes) return;
    
    // Update date summary
    if (liveModeActive) {
        summaryDate.textContent = `Live (Last ${liveModeRangeHours}h)`;
    } else {
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

function normalizeTimeInputValue(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
        return null;
    }
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
        return null;
    }
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
    }
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function isValid24HourTime(value) {
    return normalizeTimeInputValue(value) !== null;
}

function parseDateInputToUTC(dateStr) {
    if (typeof dateStr !== 'string') {
        return null;
    }
    const match = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        return null;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return null;
    }
    return new Date(Date.UTC(year, month - 1, day));
}

function formatDateInputValue(date) {
    if (!(date instanceof Date)) {
        return '';
    }
    return date.toISOString().split('T')[0];
}

function shiftCustomDateRange(days) {
    const startDateEl = document.getElementById('startDate');
    const endDateEl = document.getElementById('endDate');
    const startHourEl = document.getElementById('startHour');
    const endHourEl = document.getElementById('endHour');

    if (!startDateEl || !endDateEl || !startHourEl || !endHourEl) {
        return;
    }

    const startDate = parseDateInputToUTC(startDateEl.value);
    const endDate = parseDateInputToUTC(endDateEl.value);
    if (!startDate || !endDate) {
        showStatusToast('Please select a valid start and end date.', 'error');
        return;
    }

    const normalizedStartHour = normalizeTimeInputValue(startHourEl.value);
    const normalizedEndHour = normalizeTimeInputValue(endHourEl.value);
    if (!normalizedStartHour || !normalizedEndHour) {
        showStatusToast('Please enter time in 24-hour format (HH:MM).', 'error');
        return;
    }

    startDate.setUTCDate(startDate.getUTCDate() + days);
    endDate.setUTCDate(endDate.getUTCDate() + days);

    startDateEl.value = formatDateInputValue(startDate);
    endDateEl.value = formatDateInputValue(endDate);
    startHourEl.value = normalizedStartHour;
    endHourEl.value = normalizedEndHour;

    updateFilterSummary();
    fetchLSRData();
}

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
    
    const startDate = document.getElementById('startDate').value;
    const startHourInput = document.getElementById('startHour');
    const startHourRaw = startHourInput ? startHourInput.value : '';
    const endDate = document.getElementById('endDate').value;
    const endHourInput = document.getElementById('endHour');
    const endHourRaw = endHourInput ? endHourInput.value : '';

    const normalizedStartHour = normalizeTimeInputValue(startHourRaw);
    const normalizedEndHour = normalizeTimeInputValue(endHourRaw);

    if (!normalizedStartHour || !normalizedEndHour) {
        showStatusToast('Please enter time in 24-hour format (HH:MM).', 'error');
        return;
    }

    if (startHourInput) startHourInput.value = normalizedStartHour;
    if (endHourInput) endHourInput.value = normalizedEndHour;
    const startHour = normalizedStartHour;
    const endHour = normalizedEndHour;

    // Show loading state
    showStatusToast('Loading data...', 'loading');
    if (fetchBtn) fetchBtn.disabled = true;
    if (btnText) btnText.style.display = 'none';
    if (btnLoading) btnLoading.style.display = 'inline-flex';
    
    markersLayer.clearLayers();
    userArea.clearLayers();
    
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
let normalizedLsrReports = [];
let lastNormalizedGeoJson = null;
let topReportsByType = {}; // Store top 10 reports by type
let allPNSReports = []; // All PNS reports (filtered and processed for performance)

// Sync with appState
appState.set('allFilteredReports', allFilteredReports);
appState.set('lastGeoJsonData', lastGeoJsonData);
appState.set('topReportsByType', topReportsByType);

function normalizeLSRReports(geoJsonData) {
    const features = geoJsonData?.features || [];
    const normalized = [];

    for (const feature of features) {
        const props = feature.properties || {};
        const lat = parseFloat(props.lat);
        const lon = parseFloat(props.lon);

        if (isNaN(lat) || isNaN(lon)) {
            continue;
        }

        let rtype = props.type || props.rtype || '';
        const typetext = props.typetext || '';
        const remark = props.remark || '';

        // Check if this is a snow squall - treat it as snow type for filtering and icon
        const upperTypetext = typetext ? typetext.toUpperCase() : '';
        const lowerTypetext = typetext ? typetext.toLowerCase() : '';
        const isSnowSquall = upperTypetext.includes('SNOW SQUALL');
        if (isSnowSquall) {
            rtype = 'S'; // Force snow type for snow squalls
        }

        // Check if this is a temperature-related report - use temperature icon but keep original category name
        // Look for temperature, extreme cold, wind chill, heat index, extreme heat, etc.
        const isTemperature = upperTypetext && (
            upperTypetext.includes('TEMPERATURE') ||
            upperTypetext.includes('EXTREME TEMP') ||
            upperTypetext.includes('EXTREME COLD') ||
            upperTypetext.includes('WIND CHILL') ||
            upperTypetext.includes('HEAT INDEX') ||
            upperTypetext.includes('EXTREME HEAT') ||
            (upperTypetext.includes('COLD') && (upperTypetext.includes('WARNING') || upperTypetext.includes('ADVISORY'))) ||
            (upperTypetext.includes('HEAT') && (upperTypetext.includes('WARNING') || upperTypetext.includes('ADVISORY')))
        );
        const isFreezingRain = upperTypetext.includes('FREEZING RAIN') ||
            upperTypetext.includes('FREEZING_RAIN') ||
            upperTypetext.includes('FREEZING DRIZZLE') ||
            upperTypetext.includes('FREEZING_DRIZZLE') ||
            upperTypetext.includes('FZRA');
        const isSleet = upperTypetext.includes('SLEET');
        const isCoastalFloodReport = ['F', 'E', 'v'].includes(rtype) && isCoastalFlood(typetext, remark);

        // Always use temperature icon (X) for temperature-related reports, regardless of original rtype
        let iconRtype = rtype;
        if (isSleet) {
            iconRtype = 's';
        }
        if (isTemperature) {
            iconRtype = 'X'; // Always use temperature icon configuration for temperature-related reports
        }

        // Determine filter type - use Temperature for filtering if it's a temperature-related report
        let filterType;
        if (isTemperature) {
            filterType = 'Temperature'; // Filter as Temperature
        } else if (isFreezingRain) {
            filterType = 'Freezing Rain';
        } else if (isSleet) {
            filterType = 'Sleet';
        } else if (isCoastalFloodReport) {
            filterType = 'Coastal Flooding';
        } else {
            filterType = getReportTypeName(rtype, REPORT_TYPE_MAP);
        }

        let magnitude = parseFloat(props.magnitude) || 0;
        const valid = (props.valid || '').replace('T', ' ');
        const city = props.city || '';
        const state = props.st || props.state || '';

        // Use REPORT_TYPE_MAP for consistent naming, but prefer typetext if it's more descriptive
        let category = getReportTypeName(rtype, REPORT_TYPE_MAP);
        if (isFreezingRain) {
            category = 'Freezing Rain';
        } else if (isSleet) {
            category = 'Sleet';
        } else if (isCoastalFloodReport) {
            category = 'Coastal Flooding';
        }

        // Check if this is a snow squall - set magnitude to 0 for display
        if (isSnowSquall) {
            magnitude = 0;
        }

        // Normalize "Tropical Cyclone" to "Tropical" for consistency
        if (lowerTypetext.includes('tropical')) {
            category = 'Tropical';
        } else if (typetext && !lowerTypetext.includes('unknown') && !isFreezingRain && !isSleet && !isCoastalFloodReport) {
            // Use typetext if it's meaningful and not "unknown"
            // This keeps original names like "EXTREME COLD", "WIND CHILL", etc.
            category = typetext;
        }

        // Use iconRtype for icon creation (allows temperature reports to use temp icon)
        // but keep original rtype for unit and category purposes
        const unit = getUnitForReportType(iconRtype);
        const iconMagnitude = isSnowSquall ? 0 : magnitude;
        const locationStr = city + (state ? ', ' + state : '');

        normalized.push({
            lat,
            lon,
            rtype,
            iconRtype,
            typetext,
            remark,
            magnitude,
            iconMagnitude,
            unit,
            location: locationStr,
            time: valid,
            type: category,
            category,
            filterType,
            isSnowSquall,
            isFreezingRain,
            isSleet,
            isCoastalFloodReport
        });
    }

    return normalized;
}

function displayReports(geoJsonData, south, north, east, west, activeFiltersOverride) {
    // Ensure CONFIG is available
    if (typeof CONFIG === 'undefined' || typeof REPORT_TYPE_MAP === 'undefined') {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.error('CONFIG or REPORT_TYPE_MAP not available');
        }
        return;
    }
    
    markersLayer.clearLayers();
    
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const isNewData = geoJsonData !== lastGeoJsonData;
    
    // Store for viewport refresh
    if (isNewData) {
        lastGeoJsonData = geoJsonData;
        appState.set('lastGeoJsonData', geoJsonData);
    }
    
    let normalizeDuration = 0;
    if (isNewData || lastNormalizedGeoJson !== geoJsonData || normalizedLsrReports.length === 0) {
        const normalizeStart = isLocalhost ? performance.now() : 0;
        normalizedLsrReports = normalizeLSRReports(geoJsonData);
        lastNormalizedGeoJson = geoJsonData;
        if (isLocalhost) {
            normalizeDuration = performance.now() - normalizeStart;
        }
    }
    
    const activeFilters = activeFiltersOverride || getActiveWeatherFilters();
    
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
    
    const filterStart = isLocalhost ? performance.now() : 0;
    for (const report of normalizedLsrReports) {
        // Filter by bounding box
        // Note: For US, west is more negative than east, so lon must be between west and east
        if (report.lat < south || report.lat > north) {
            continue;
        }
        if (report.lon < west || report.lon > east) {
            continue;
        }
        
        // Filter by viewport if enabled and zoomed in
        if (viewportBounds && !viewportBounds.contains([report.lat, report.lon])) {
            continue;
        }
        
        if (!activeFilters.includes(report.filterType)) {
            continue;
        }
        
        if (!report.icon) {
            report.icon = getIconForReportWrapper(report.iconRtype, report.iconMagnitude, report.remark, report.typetext);
        }
        
        allFilteredReports.push(report);
        
        // Track top reports by type
        if (report.magnitude > 0) {
            if (!topReportsByType[report.category]) {
                topReportsByType[report.category] = [];
            }
            topReportsByType[report.category].push(report);
            // Keep only top 10 per type
            topReportsByType[report.category].sort((a, b) => b.magnitude - a.magnitude);
            if (topReportsByType[report.category].length > 10) {
                topReportsByType[report.category] = topReportsByType[report.category].slice(0, 10);
            }
        }
    }
    const filterDuration = isLocalhost ? performance.now() - filterStart : 0;
    
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
    if (isLocalhost && (normalizeDuration || filterDuration)) {
        console.log(`[Perf] LSR normalize ${normalizeDuration.toFixed(1)}ms, filter ${filterDuration.toFixed(1)}ms, filtered ${allFilteredReports.length}/${normalizedLsrReports.length}`);
    }
    updateStatistics(allFilteredReports);
    updateFeatureBadges(); // Update feature discoverability badges
    updateFilterSummary();
    updateExportCount(); // Update export count in modal
    if (liveModeActive) {
        updateLastUpdateTime();
    }
    
    // Add markers
    addMarkersInBatches(reportsToDisplay, markersLayer, CONFIG.BATCH_SIZE, null, updateMagnitudeLegendForReport);
    
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

function getAlertCodes(props) {
    const phSig = (props.ph_sig || '').split('.');
    const phenomena = (props.phenomena || phSig[0] || '').toUpperCase();
    const significance = (props.significance || phSig[1] || '').toUpperCase();
    return { phenomena, significance };
}

function updateWarningsCount(elementId, count, show) {
    const el = document.getElementById(elementId);
    if (!el) {
        return;
    }
    el.textContent = count.toString();
    el.style.display = show ? 'inline' : 'none';
}

function renderAlertsToLayer(alerts, layer) {
    if (!layer) {
        return;
    }
    alerts.forEach(alert => {
        const props = alert.properties || {};
        const significanceMap = {
            'W': 'Warning',
            'A': 'Watch',
            'Y': 'Advisory'
        };
        const severity = props.severity || (props.significance ? (significanceMap[props.significance] || props.significance) : 'Unknown');
        const category = props.category || props.phenomena || 'Other';
        const event = props.event || props.event_label || 'Alert';
        const headline = props.headline || props.event_label || '';
        const description = props.description || '';
        const instruction = props.instruction || '';
        const effectiveRaw = props.effective || props.utc_issue || props.utc_product_issue || '';
        const expiresRaw = props.expires || props.utc_expire || '';
        const effective = effectiveRaw ? new Date(effectiveRaw).toLocaleString() : '';
        const expires = expiresRaw ? new Date(expiresRaw).toLocaleString() : '';
        const areaDesc = props.areaDesc || props.ugc || '';
        const wfo = props.wfo || '';
        
        const color = props.nws_color || warningsService.getSeverityColor(severity);
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
                    ${wfo ? `<div class="warning-area"><i class="fas fa-broadcast-tower"></i> WFO: ${wfo}</div>` : ''}
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
                pane: 'warningsPane',
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
                        opacity: 0.85;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                    ">${icon}</div>`,
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                })
            });
            marker.bindPopup(popupContent, { maxWidth: 400, className: 'warning-popup-container' });
            marker.addTo(layer);
        } else if (geom.type === 'Polygon') {
            const coords = geom.coordinates[0].map(([lon, lat]) => [lat, lon]);
            const polygon = L.polygon(coords, {
                pane: 'warningsPane',
                color: color,
                fillColor: color,
                fillOpacity: 0.12,
                weight: 2,
                opacity: 0.5
            });
            polygon.bindPopup(popupContent, { maxWidth: 400, className: 'warning-popup-container' });
            polygon.addTo(layer);
        } else if (geom.type === 'MultiPolygon') {
            geom.coordinates.forEach(polygonCoords => {
                const coords = polygonCoords[0].map(([lon, lat]) => [lat, lon]);
                const polygon = L.polygon(coords, {
                    pane: 'warningsPane',
                    color: color,
                    fillColor: color,
                    fillOpacity: 0.12,
                    weight: 2,
                    opacity: 0.5
                });
                polygon.bindPopup(popupContent, { maxWidth: 400, className: 'warning-popup-container' });
                polygon.addTo(layer);
            });
        }
    });
}

function updateWarningsRefreshListeners() {
    if (!map) {
        return;
    }
    const shouldAttach = showWarnings || showAllWarningsLayer || showAllWatchesLayer;
    if (shouldAttach && !warningsListenersAttached) {
        map.on('moveend', refreshWarningsOnMove);
        map.on('zoomend', refreshWarningsOnMove);
        warningsListenersAttached = true;
    } else if (!shouldAttach && warningsListenersAttached) {
        map.off('moveend', refreshWarningsOnMove);
        map.off('zoomend', refreshWarningsOnMove);
        warningsListenersAttached = false;
    }
}

/**
 * Fetch active NWS warnings/alerts and display on map
 */
async function fetchWarnings() {
    if ((!showWarnings && !showAllWarningsLayer && !showAllWatchesLayer) || !warningsService || !map || !warningsLayer) {
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
        
        const shortFusePhenomena = ['TO', 'SV', 'FF', 'SQ'];
        const shortFuseAlerts = [];
        const allWarnings = [];
        const allWatches = [];

        alerts.forEach(alert => {
            const props = alert.properties || {};
            const { phenomena, significance } = getAlertCodes(props);
            if (significance === 'W') {
                allWarnings.push(alert);
                if (shortFusePhenomena.includes(phenomena)) {
                    shortFuseAlerts.push(alert);
                }
            } else if (significance === 'A') {
                allWatches.push(alert);
            }
        });

        // Clear existing warnings
        warningsLayer.clearLayers();
        if (allWarningsLayer) allWarningsLayer.clearLayers();
        if (allWatchesLayer) allWatchesLayer.clearLayers();
        
        if (alerts.length === 0) {
            updateWarningsCount('warningsCount', 0, showWarnings);
            updateWarningsCount('allWarningsCount', 0, showAllWarningsLayer);
            updateWarningsCount('allWatchesCount', 0, showAllWatchesLayer);
            return; // No active warnings
        }

        if (showWarnings) {
            renderAlertsToLayer(shortFuseAlerts, warningsLayer);
        }
        if (showAllWarningsLayer) {
            renderAlertsToLayer(allWarnings, allWarningsLayer);
        }
        if (showAllWatchesLayer) {
            renderAlertsToLayer(allWatches, allWatchesLayer);
        }

        updateWarningsCount('warningsCount', shortFuseAlerts.length, showWarnings);
        updateWarningsCount('allWarningsCount', allWarnings.length, showAllWarningsLayer);
        updateWarningsCount('allWatchesCount', allWatches.length, showAllWatchesLayer);
        
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
// Fetch PNS data using the service
async function fetchPNSData() {
    if (!pnsService) {
        pnsService = new PNSService();
    }

    // Clear previous PNS reports
    allPNSReports = [];

    if (!showPNS) {
        // If PNS is disabled, clear layer and update counts
        if (pnsLayer) {
            pnsLayer.clearLayers();
        }
        updateReportCountWithPNS();
        updateStatisticsWithPNS();
        return;
    }
    
    // Show loading indicator
    showStatusToast('Processing PNS reports...', 'loading');
    
    try {
        // Collect PNS marker data (without adding to layer yet)
        const pnsMarkerData = [];
        
        await pnsService.fetchPNSData(
            showPNS, 
            null, // Don't pass pnsLayer - we'll handle adding markers in filterPNSMarkers
            openPnsModal,
            getIconForReportWrapper,
            getReportTypeName,
            REPORT_TYPE_MAP,
            (markerData) => {
                // Callback to collect marker data instead of adding directly
                pnsMarkerData.push(markerData);
            },
            updateMagnitudeLegendForReport
        );
        
        // Store all PNS marker data for performance optimization
        allPNSReports = pnsMarkerData;
        
        // After fetching, apply current filters and performance optimizations to PNS markers
        filterPNSMarkers();
        
        // Show success message with count
        const pnsCount = pnsMarkerData.length;
        if (pnsCount > 0) {
            showStatusToast(`Loaded ${pnsCount} PNS report${pnsCount !== 1 ? 's' : ''}`, 'success');
        } else {
            showStatusToast('No PNS reports found', 'info');
        }
    } catch (error) {
        // Error handling - show error message
        const handledError = errorHandler.handleError(error, 'PNS Fetch');
        showStatusToast(handledError.message, 'error');
    }
}

/**
 * Collect PNS reports from visible markers for statistics and counting
 */
function getPNSReports(activeFiltersOverride) {
    if (!filterService) {
        return [];
    }
    return filterService.getFilteredPNSReports(
        showPNS,
        allPNSReports,
        allFilteredReports,
        map,
        CONFIG,
        getZoomBasedLimit,
        activeFiltersOverride
    );
}

/**
 * Apply performance optimizations and filter PNS markers
 */
function filterPNSMarkers(activeFiltersOverride) {
    if (!filterService) {
        return;
    }
    
    filterService.filterPNSMarkers(
        pnsLayer,
        showPNS,
        allPNSReports,
        allFilteredReports,
        map,
        CONFIG,
        getZoomBasedLimit,
        updateReportCountWithPNS,
        updateStatisticsWithPNS,
        activeFiltersOverride
    );
}

/**
 * Update report count including PNS reports
 */
function updateReportCountWithPNS() {
    // Get filtered PNS reports (before limits) for total count
    const currentZoom = map ? map.getZoom() : 4;
    const zoomLimit = getZoomBasedLimit(currentZoom);
    const viewportBounds = CONFIG.VIEWPORT_ONLY && currentZoom >= CONFIG.MIN_ZOOM_FOR_VIEWPORT 
        ? map.getBounds() 
        : null;
    
    // Get active filters
    const activeFilters = getActiveWeatherFilters();
    const allWeatherTypes = CONFIG.WEATHER_TYPES || [];
    const allFiltersActive = activeFilters.length === allWeatherTypes.length;
    const noFiltersActive = activeFilters.length === 0;
    
    // Filter PNS reports by active filters and viewport (before limits) - for total count
    let totalPNSReports = 0;
    if (showPNS && allPNSReports) {
        totalPNSReports = allPNSReports.filter(report => {
            // If no filters are active, hide all reports
            if (noFiltersActive) {
                return false;
            }
            
            // If all filters are active, show all reports (skip type filtering)
            // Otherwise, filter by weather type
            if (!allFiltersActive) {
                if (!report.filterType || !activeFilters.includes(report.filterType)) {
                    return false;
                }
            }
            
            // Filter by viewport if enabled
            if (viewportBounds && !viewportBounds.contains([report.lat, report.lon])) {
                return false;
            }
            
            return true;
        }).length;
    }
    
    // Get displayed PNS reports (after limits)
    const displayedPNSReports = getPNSReports(activeFilters);
    
    // Calculate totals
    const totalReports = allFilteredReports.length + totalPNSReports;
    
    // Calculate LSR displayed/hidden
    let displayedLSRCount = allFilteredReports.length;
    let hiddenLSRCount = 0;
    
    if (zoomLimit !== undefined && displayedLSRCount > zoomLimit) {
        hiddenLSRCount = displayedLSRCount - zoomLimit;
        displayedLSRCount = zoomLimit;
    } else if (displayedLSRCount > CONFIG.MAX_MARKERS) {
        hiddenLSRCount = displayedLSRCount - CONFIG.MAX_MARKERS;
        displayedLSRCount = CONFIG.MAX_MARKERS;
    }
    
    // Calculate total displayed and hidden (LSR + PNS)
    const displayedCount = displayedLSRCount + displayedPNSReports.length;
    const hiddenPNSCount = totalPNSReports - displayedPNSReports.length;
    const hiddenCount = hiddenLSRCount + hiddenPNSCount;
    
    updateReportCount(displayedCount, totalReports, hiddenCount);
}

/**
 * Update statistics including PNS reports
 */
function updateStatisticsWithPNS() {
    const pnsReports = getPNSReports();
    const allReports = [...allFilteredReports, ...pnsReports];
    
    updateStatistics(allReports);
}

// parsePNSMetadata is now in PNSService - removed from app.js

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
    if (officeEl) officeEl.textContent = pnsData.office;
    if (timeEl) timeEl.innerHTML = `<i class="far fa-clock"></i> ${getTimeAgo(pnsData.time)} &nbsp;•&nbsp; ${pnsData.time.toLocaleString()}`;
    if (textEl) textEl.textContent = pnsData.text;
    if (linkEl) linkEl.href = `https://api.weather.gov/products/${pnsData.productId}`;
    
    // Show modal
    modal.classList.add('show');
}

// Global function to open PNS modal from popup button (called from popup HTML)
window.openPnsModalFromMarker = function(productId) {
    if (!pnsLayer) return;
    
    // Find the marker with this product ID
    let foundPnsData = null;
    pnsLayer.eachLayer(layer => {
        if (layer instanceof L.Marker && layer.pnsData && layer.pnsData.productId === productId) {
            foundPnsData = layer.pnsData;
        }
    });
    
    if (foundPnsData) {
        openPnsModal(foundPnsData);
    }
};

// addMarkersInBatches is now imported from markerService module

function updateReportCount(count, totalCount = null, hiddenCount = 0) {
    if (!reportCountService) {
        return;
    }
    
    reportCountService.updateReportCount(
        count,
        totalCount,
        hiddenCount,
        getZoomBasedLimit,
        map,
        CONFIG
    );
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
    if (!statisticsService) {
        return;
    }
    
    statisticsService.updateStatistics(reports, topReportsByType);
}

// ============================================================================
// TOP 10 REPORTS
// ============================================================================

function displayTopReports() {
    if (!statisticsService) {
        return;
    }
    
    statisticsService.displayTopReports(topReportsByType);
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
    if (!map) {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.warn('Map not initialized');
        }
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
    if (!map) {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.warn('Map not initialized');
        }
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

function getUtcDateString(date) {
    return date.toISOString().split('T')[0];
}

function getUtcTimeString(date) {
    return date.toISOString().slice(11, 16);
}

function applyLiveModeRange(hours) {
    const startDateEl = document.getElementById('startDate');
    const startHourEl = document.getElementById('startHour');
    const endDateEl = document.getElementById('endDate');
    const endHourEl = document.getElementById('endHour');
    if (!startDateEl || !startHourEl || !endDateEl || !endHourEl) {
        return;
    }

    const now = new Date();
    const start = new Date(now.getTime() - (hours * 60 * 60 * 1000));

    startDateEl.value = getUtcDateString(start);
    startHourEl.value = getUtcTimeString(start);
    endDateEl.value = getUtcDateString(now);
    endHourEl.value = getUtcTimeString(now);
}

function setLiveModeRange(hours, shouldFetch = true) {
    if (!Number.isFinite(hours) || hours <= 0) {
        return;
    }
    liveModeRangeHours = hours;
    const rangeButtons = document.querySelectorAll('.btn-live-range');
    rangeButtons.forEach(btn => {
        const btnHours = Number(btn.dataset.hours);
        const isActive = btnHours === hours;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    if (!liveModeActive) {
        return;
    }

    applyLiveModeRange(hours);
    updateFilterSummary();
    if (shouldFetch) {
        fetchLSRData();
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
        
        // Set date range for live mode window
        setLiveModeRange(liveModeRangeHours, false);
        
        // Add radar layer (NWS WMS - will refresh automatically)
        addRadarLayer();
        
        // Enable and fetch warnings
        const shortFuseToggle = document.getElementById('toggleShortFuseWarnings');
        if (shortFuseToggle) {
            shortFuseToggle.checked = true;
        }
        const allWarningsToggle = document.getElementById('toggleAllWarnings');
        if (allWarningsToggle) {
            allWarningsToggle.checked = false;
        }
        const allWatchesToggle = document.getElementById('toggleAllWatches');
        if (allWatchesToggle) {
            allWatchesToggle.checked = false;
        }
        showWarnings = true;
        showAllWarningsLayer = false;
        showAllWatchesLayer = false;
        if (map.hasLayer(allWarningsLayer)) {
            map.removeLayer(allWarningsLayer);
        }
        if (map.hasLayer(allWatchesLayer)) {
            map.removeLayer(allWatchesLayer);
        }
        if (allWarningsLayer) allWarningsLayer.clearLayers();
        if (allWatchesLayer) allWatchesLayer.clearLayers();
        fetchWarnings();
        updateWarningsRefreshListeners();
        
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
        if (allWarningsLayer) {
            allWarningsLayer.clearLayers();
            if (map.hasLayer(allWarningsLayer)) {
                map.removeLayer(allWarningsLayer);
            }
        }
        if (allWatchesLayer) {
            allWatchesLayer.clearLayers();
            if (map.hasLayer(allWatchesLayer)) {
                map.removeLayer(allWatchesLayer);
            }
        }
        showAllWarningsLayer = false;
        showAllWatchesLayer = false;
        const shortFuseToggle = document.getElementById('toggleShortFuseWarnings');
        if (shortFuseToggle) shortFuseToggle.checked = false;
        const allWarningsToggle = document.getElementById('toggleAllWarnings');
        if (allWarningsToggle) allWarningsToggle.checked = false;
        const allWatchesToggle = document.getElementById('toggleAllWatches');
        if (allWatchesToggle) allWatchesToggle.checked = false;
        updateWarningsCount('warningsCount', 0, false);
        updateWarningsCount('allWarningsCount', 0, false);
        updateWarningsCount('allWatchesCount', 0, false);
        updateWarningsRefreshListeners();
        
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
            pane: 'radarPane',
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
    applyLiveModeRange(liveModeRangeHours);
    updateFilterSummary();
    fetchLSRData();
    if (showWarnings) {
        fetchWarnings();
    }
    updateLastUpdateTime();
    
    // Set up interval
    liveModeInterval = setInterval(() => {
        if (liveModeActive) {
            applyLiveModeRange(liveModeRangeHours);
            updateFilterSummary();
            fetchLSRData();
            if (showWarnings) {
                fetchWarnings();
            }
            updateLastUpdateTime();
        }
    }, interval);
    
    updateWarningsRefreshListeners();
}

function stopLiveModeRefresh() {
    if (liveModeInterval) {
        clearInterval(liveModeInterval);
        liveModeInterval = null;
    }
    
    updateWarningsRefreshListeners();
}

function refreshWarningsOnMove() {
    if (showWarnings || showAllWarningsLayer || showAllWatchesLayer) {
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
    
    updateFilterSummary();
    // Note: refreshMapWithCurrentFilters() is called from the button click handler
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
    const regionSelect = document.getElementById('regionSelect');
    if (regionSelect) {
        regionSelect.value = '';
    }
    userArea.clearLayers();
    disableBoundsClickMode();
    
    // Reset map to default view
    map.setView([CONFIG.MAP_INITIAL.lat, CONFIG.MAP_INITIAL.lon], CONFIG.MAP_INITIAL.zoom);
}

// ============================================================================
// UI INITIALIZATION
// ============================================================================

// Refresh map with current filters (called when weather type filters change)
// Defined before initializeUI so it's accessible when chip listeners are set up
function refreshMapWithCurrentFilters() {
    // Use a small timeout to ensure checkbox state is updated
    setTimeout(() => {
        const activeFilters = getActiveWeatherFilters();
        if (lastGeoJsonData) {
            // Get current bounds from selected region/state
            const regionSelect = document.getElementById('regionSelect');
            const selectedRegion = regionSelect ? regionSelect.value : '';
            
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
            
            // Re-display with current filters
            displayReports(lastGeoJsonData, southLat, northLat, eastLon, westLon, activeFilters);
        }
        
        // Also filter PNS markers (this updates counts and statistics)
        filterPNSMarkers(activeFilters);
    }, 10);
}

// ============================================================================
// MAGNITUDE LEGEND
// ============================================================================

function formatMagnitudeValue(value) {
    if (!Number.isFinite(value)) {
        return '';
    }
    const rounded = Math.round(value * 100) / 100;
    return Number.isInteger(rounded) ? `${rounded}` : `${rounded}`;
}

function formatMagnitudeRangeLabel(prevMax, max, unit) {
    const unitLabel = unit || '';
    if (max === Infinity) {
        return `> ${formatMagnitudeValue(prevMax)}${unitLabel}`;
    }
    if (prevMax === null) {
        return `\u2264 ${formatMagnitudeValue(max)}${unitLabel}`;
    }
    return `${formatMagnitudeValue(prevMax)}\u2013${formatMagnitudeValue(max)}${unitLabel}`;
}

function updateMagnitudeLegendForReport(report) {
    const legendBody = document.getElementById('magnitudeLegend');
    const legendTitle = document.getElementById('magnitudeLegendTitle');
    if (!legendBody) {
        return;
    }

    const rtype = report?.iconRtype || report?.rtype || '';
    const category = report?.category || getReportTypeName(rtype, REPORT_TYPE_MAP);
    const config = ICON_CONFIG[rtype];

    if (legendTitle) {
        legendTitle.textContent = category ? `Magnitude Scale - ${category}` : 'Magnitude Scale';
    }

    if (!config || !config.thresholds) {
        legendBody.innerHTML = `<div class="legend-magnitude-note">No magnitude scale available for this report type.</div>`;
        return;
    }

    const unit = getUnitForReportType(rtype);
    const borderRadius = config.type === 'rect' ? '0%' : '50%';
    let prevMax = null;

    const itemsHtml = config.thresholds.map((threshold) => {
        const label = formatMagnitudeRangeLabel(prevMax, threshold.max, unit);
        prevMax = threshold.max;
        const swatchBorder = threshold.stroke || '#333';
        return `
            <div class="legend-magnitude-item">
                <div class="legend-magnitude-swatch" style="background-color: ${threshold.fill}; border-color: ${swatchBorder}; border-radius: ${borderRadius};"></div>
                <div class="legend-magnitude-label">${label}</div>
            </div>
        `;
    }).join('');

    legendBody.innerHTML = itemsHtml;
}

function initializeUI() {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Set default dates
    document.getElementById('startDate').value = yesterday.toISOString().split('T')[0];
    document.getElementById('startHour').value = '00:00';
    document.getElementById('endDate').value = today.toISOString().split('T')[0];
    document.getElementById('endHour').value = '23:59';
    
    const startHourInput = document.getElementById('startHour');
    const endHourInput = document.getElementById('endHour');
    [startHourInput, endHourInput].forEach(input => {
        if (!input) {
            return;
        }
        input.addEventListener('blur', () => {
            const normalized = normalizeTimeInputValue(input.value);
            if (normalized) {
                input.value = normalized;
            }
        });
    });
    
    const filterContainer = document.getElementById('weatherTypeFilters');
    const typeIcons = {
        'Rain': 'fa-cloud-rain',
        'Flood': 'fa-water',
        'Coastal Flooding': 'fa-water',
        'Snow': 'fa-snowflake',
        'Sleet': 'fa-snowflake',
        'Freezing Rain': 'fa-cloud-rain',
        'Ice': 'fa-icicles',
        'Hail': 'fa-circle',
        'Wind': 'fa-wind',
        'Thunderstorm': 'fa-bolt',
        'Tornado': 'fa-tornado',
        'Tropical': 'fa-hurricane',
        'Temperature': 'fa-thermometer-half',
        'Other': 'fa-cloud'
    };
    
    CONFIG.WEATHER_TYPES.forEach(type => {
        const typeId = getWeatherTypeId(type);
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'weather-chip active';
        chip.id = `filter-${typeId}`;
        chip.dataset.type = type;
        chip.innerHTML = `
            <i class="fas ${typeIcons[type] || 'fa-cloud'}"></i>
            <span>${type}</span>
        `;
        chip.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent event bubbling
            chip.classList.toggle('active');
            // Update hidden checkbox for compatibility
            const hiddenCheckbox = document.getElementById(`hidden-filter-${typeId}`);
            if (hiddenCheckbox) {
                hiddenCheckbox.checked = chip.classList.contains('active');
            }
            // Update filter summary
            updateFilterSummary();
            // Always refresh map if data is loaded (will filter based on current checkbox states)
            refreshMapWithCurrentFilters();
        });
        filterContainer.appendChild(chip);
        
        // Create hidden checkbox for compatibility with existing code
        const hiddenCheckbox = document.createElement('input');
        hiddenCheckbox.type = 'checkbox';
        hiddenCheckbox.id = `hidden-filter-${typeId}`;
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
        'Flood': 'Flooding reports (non-coastal). Green indicates flood conditions.',
        'Coastal Flooding': 'Coastal flooding reports. Green indicates coastal flood conditions.',
        'Snow': 'Snowfall reports measured in inches. Color changes with accumulation.',
        'Sleet': 'Sleet reports measured in inches. Colors show 1-6 inches of accumulation.',
        'Freezing Rain': 'Freezing rain reports measured in inches. Blue outline distinguishes freezing rain.',
        'Ice': 'Ice accumulation reports. Gray to purple indicates severity.',
        'Hail': 'Hail size reports in inches. Pink to purple indicates larger hail.',
        'Wind': 'Wind speed reports in mph. Yellow to brown indicates stronger winds.',
        'Thunderstorm': 'Thunderstorm wind reports. Yellow to red indicates severity.',
        'Tornado': 'Tornado reports. Red markers indicate confirmed tornadoes.',
        'Tropical': 'Tropical storm/hurricane reports. White to black indicates intensity.',
        'Temperature': 'Temperature reports in °F. Blue to red indicates cold to hot.',
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
            const chip = document.getElementById(`filter-${getWeatherTypeId(cb.value)}`);
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
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.error('CONFIG is not defined. Make sure config.js is loaded before app.js');
        }
        showStatusToast('Configuration error. Please refresh the page.', 'error');
        return;
    }
    
    // Initialize map first
    map = L.map('map').setView([CONFIG.MAP_INITIAL.lat, CONFIG.MAP_INITIAL.lon], CONFIG.MAP_INITIAL.zoom);

    // Custom panes to control overlay stacking
    map.createPane('warningsPane');
    map.getPane('warningsPane').style.zIndex = 450;
    map.createPane('radarPane');
    map.getPane('radarPane').style.zIndex = 550;
    map.getPane('radarPane').style.pointerEvents = 'none';
    
    // Add base tile layer immediately
    updateMapTileLayer();
    
    // Initialize dark mode (after map is created so it can update tiles)
    initializeDarkMode();
    
    markersLayer = L.layerGroup().addTo(map);
    pnsLayer = L.layerGroup().addTo(map);
    warningsLayer = L.layerGroup().addTo(map);
    allWarningsLayer = L.layerGroup();
    allWatchesLayer = L.layerGroup();
    userArea = L.layerGroup().addTo(map);
    
    // Initialize warnings service
    warningsService = new WarningsService();
    
    // Initialize services
    statisticsService = new StatisticsService();
    reportCountService = new ReportCountService();
    filterService = new FilterService();

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
    const clearAllFiltersBtn = document.getElementById('clearAllFilters');
    if (clearAllFiltersBtn) {
        clearAllFiltersBtn.addEventListener('click', () => {
            // Reset date to 24h
            setDatePreset('24h');
            // Reset location
            const regionSelect = document.getElementById('regionSelect');
            if (regionSelect) {
                regionSelect.value = '';
                regionSelect.dispatchEvent(new Event('change'));
            }
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
    }
    
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
    const toggleLiveModeBtn = document.getElementById('toggleLiveMode');
    if (toggleLiveModeBtn) {
        toggleLiveModeBtn.addEventListener('click', toggleLiveMode);
    }

    const toggleShortFuseWarnings = document.getElementById('toggleShortFuseWarnings');
    if (toggleShortFuseWarnings) {
        toggleShortFuseWarnings.addEventListener('change', (e) => {
            showWarnings = e.target.checked;
            if (showWarnings && showAllWarningsLayer) {
                showAllWarningsLayer = false;
                const allWarningsToggle = document.getElementById('toggleAllWarnings');
                if (allWarningsToggle) allWarningsToggle.checked = false;
                if (map.hasLayer(allWarningsLayer)) {
                    map.removeLayer(allWarningsLayer);
                    allWarningsLayer.clearLayers();
                    updateWarningsCount('allWarningsCount', 0, false);
                }
            }
            if (!showWarnings && warningsLayer) {
                warningsLayer.clearLayers();
                updateWarningsCount('warningsCount', 0, false);
            }
            fetchWarnings();
            updateWarningsRefreshListeners();
        });
    }

    const toggleAllWarnings = document.getElementById('toggleAllWarnings');
    if (toggleAllWarnings) {
        toggleAllWarnings.addEventListener('change', (e) => {
            showAllWarningsLayer = e.target.checked;
            if (showAllWarningsLayer) {
                allWarningsLayer.addTo(map);
                showWarnings = false;
                const shortFuseToggle = document.getElementById('toggleShortFuseWarnings');
                if (shortFuseToggle) shortFuseToggle.checked = false;
                if (warningsLayer) {
                    warningsLayer.clearLayers();
                    updateWarningsCount('warningsCount', 0, false);
                }
            } else if (map.hasLayer(allWarningsLayer)) {
                map.removeLayer(allWarningsLayer);
                allWarningsLayer.clearLayers();
                updateWarningsCount('allWarningsCount', 0, false);
            }
            fetchWarnings();
            updateWarningsRefreshListeners();
        });
    }

    const toggleAllWatches = document.getElementById('toggleAllWatches');
    if (toggleAllWatches) {
        toggleAllWatches.addEventListener('change', (e) => {
            showAllWatchesLayer = e.target.checked;
            if (showAllWatchesLayer) {
                allWatchesLayer.addTo(map);
            } else if (map.hasLayer(allWatchesLayer)) {
                map.removeLayer(allWatchesLayer);
                allWatchesLayer.clearLayers();
                updateWarningsCount('allWatchesCount', 0, false);
            }
            fetchWarnings();
            updateWarningsRefreshListeners();
        });
    }

    document.querySelectorAll('.btn-live-range').forEach(btn => {
        btn.addEventListener('click', () => {
            const hours = Number(btn.dataset.hours);
            setLiveModeRange(hours);
        });
    });
    
    // Status toast close
    const closeStatusToastBtn = document.getElementById('closeStatusToast');
    if (closeStatusToastBtn) {
        closeStatusToastBtn.addEventListener('click', () => {
            const toast = document.getElementById('statusToast');
            if (toast) {
                toast.style.display = 'none';
            }
        });
    }
    
    // Date presets
    document.querySelectorAll('.btn-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = btn.getAttribute('data-preset');
            setDatePreset(preset);
            updateFilterSummary();
        });
    });

    const shiftDateBackwardBtn = document.getElementById('shiftDateBackward');
    if (shiftDateBackwardBtn) {
        shiftDateBackwardBtn.addEventListener('click', () => {
            shiftCustomDateRange(-1);
        });
    }

    const shiftDateForwardBtn = document.getElementById('shiftDateForward');
    if (shiftDateForwardBtn) {
        shiftDateForwardBtn.addEventListener('click', () => {
            shiftCustomDateRange(1);
        });
    }
    
    // Weather type toggles
    const selectAllTypesBtn = document.getElementById('selectAllTypes');
    if (selectAllTypesBtn) {
        selectAllTypesBtn.addEventListener('click', () => {
            toggleAllWeatherTypes(true);
            updateFilterSummary();
            if (lastGeoJsonData) {
                refreshMapWithCurrentFilters();
            }
        });
    }
    const selectNoneTypesBtn = document.getElementById('selectNoneTypes');
    if (selectNoneTypesBtn) {
        selectNoneTypesBtn.addEventListener('click', () => {
            toggleAllWeatherTypes(false);
            updateFilterSummary();
            if (lastGeoJsonData) {
                refreshMapWithCurrentFilters();
            }
        });
    }
    
    
    
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
            
            // Also refresh PNS markers to apply zoom-based limits and viewport filtering
            filterPNSMarkers();
        }, 300); // Debounce for 300ms
    };
    
    // Always listen to zoom changes to update marker limits
    map.on('zoomend', refreshMarkersOnZoomMove);
    
    // Only listen to move events when viewport filtering is enabled
    if (CONFIG.VIEWPORT_ONLY) {
        map.on('moveend', refreshMarkersOnZoomMove);
    }
    
    // Region/State selector
    const regionSelect = document.getElementById('regionSelect');
    if (regionSelect) {
        regionSelect.addEventListener('change', (e) => {
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
    }
    
    // Update filter summary when weather types change
    const weatherTypeFilters = document.getElementById('weatherTypeFilters');
    if (weatherTypeFilters) {
        weatherTypeFilters.addEventListener('click', () => {
            setTimeout(updateFilterSummary, 100);
        });
    }
    
    // Clear bounds button
    const clearBoundsBtn = document.getElementById('clearBounds');
    if (clearBoundsBtn) {
        clearBoundsBtn.addEventListener('click', clearBounds);
    }
    
    // Action buttons
    const fetchDataBtn = document.getElementById('fetchData');
    if (fetchDataBtn) {
        fetchDataBtn.addEventListener('click', () => {
            fetchLSRData();
            updateFilterSummary();
        });
    }
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
            const typeId = getWeatherTypeId(type);
            const chip = document.getElementById(`filter-${typeId}`);
            const hiddenCheckbox = document.getElementById(`hidden-filter-${typeId}`);
            if (chip) chip.classList.add('active');
            if (hiddenCheckbox) hiddenCheckbox.checked = true;
        });
        updateFilterSummary();
        if (document.querySelector('.btn-preset.active')?.dataset.preset !== 'custom') {
            fetchLSRData();
        } else {
            refreshMapWithCurrentFilters();
        }
    });
    
    document.getElementById('quickFilterWinter').addEventListener('click', () => {
        toggleAllWeatherTypes(false);
        WEATHER_CATEGORIES.WINTER.forEach(type => {
            const typeId = getWeatherTypeId(type);
            const chip = document.getElementById(`filter-${typeId}`);
            const hiddenCheckbox = document.getElementById(`hidden-filter-${typeId}`);
            if (chip) chip.classList.add('active');
            if (hiddenCheckbox) hiddenCheckbox.checked = true;
        });
        updateFilterSummary();
        if (document.querySelector('.btn-preset.active')?.dataset.preset !== 'custom') {
            fetchLSRData();
        } else {
            refreshMapWithCurrentFilters();
        }
    });
    
    document.getElementById('quickFilterPrecip').addEventListener('click', () => {
        toggleAllWeatherTypes(false);
        WEATHER_CATEGORIES.PRECIP.forEach(type => {
            const typeId = getWeatherTypeId(type);
            const chip = document.getElementById(`filter-${typeId}`);
            const hiddenCheckbox = document.getElementById(`hidden-filter-${typeId}`);
            if (chip) chip.classList.add('active');
            if (hiddenCheckbox) hiddenCheckbox.checked = true;
        });
        updateFilterSummary();
        if (document.querySelector('.btn-preset.active')?.dataset.preset !== 'custom') {
            fetchLSRData();
        } else {
            refreshMapWithCurrentFilters();
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
                resetView();
            };
        }
        
        const myLocationBtn = document.getElementById('myLocation');
        if (myLocationBtn) {
            myLocationBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                centerOnMyLocation();
            };
        }
        
        const clearMapBtn = document.getElementById('clearMapBtn');
        if (clearMapBtn) {
            clearMapBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                clearMap();
            };
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
