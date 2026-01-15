// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    ICON_SIZE: 28,
    BATCH_SIZE: 200,
    AUTO_REFRESH_INTERVAL: 300000, // 5 minutes
    LIVE_MODE_REFRESH_INTERVAL: 60000, // 1 minute for live mode
    DEFAULT_BOUNDS: {
        south: 17.9,   // Puerto Rico southernmost point (includes Hawaii at 18.91)
        north: 71.60,  // Alaska northernmost point
        east: -65,     // Puerto Rico easternmost point (includes East coast)
        west: -179.15  // Alaska westernmost point (Aleutian Islands)
    },
    MAP_INITIAL: {
        lat: 39.8283,
        lon: -98.5795,
        zoom: 4
    },
    WEATHER_TYPES: ['Rain', 'Flood', 'Snow', 'Ice', 'Hail', 'Wind', 'Thunderstorm', 'Tornado', 'Tropical', 'Other'],
    // State and Region bounding boxes [south, north, east, west]
    STATES: {
        'AL': { name: 'Alabama', bounds: [30.14, 35.01, -84.89, -88.47] },
        'AK': { name: 'Alaska', bounds: [51.21, 71.60, -130.05, -179.15] },
        'AZ': { name: 'Arizona', bounds: [31.33, 37.00, -109.04, -114.82] },
        'AR': { name: 'Arkansas', bounds: [33.00, 36.50, -89.64, -94.62] },
        'CA': { name: 'California', bounds: [32.53, 42.01, -114.13, -124.41] },
        'CO': { name: 'Colorado', bounds: [36.99, 41.00, -102.04, -109.06] },
        'CT': { name: 'Connecticut', bounds: [40.98, 42.05, -71.79, -73.73] },
        'DE': { name: 'Delaware', bounds: [38.45, 39.72, -75.05, -75.79] },
        'FL': { name: 'Florida', bounds: [24.52, 31.00, -80.03, -87.63] },
        'GA': { name: 'Georgia', bounds: [30.36, 35.00, -80.84, -85.61] },
        'HI': { name: 'Hawaii', bounds: [18.91, 22.24, -154.81, -160.25] },
        'ID': { name: 'Idaho', bounds: [41.99, 49.00, -111.04, -117.24] },
        'IL': { name: 'Illinois', bounds: [36.97, 42.51, -87.49, -91.51] },
        'IN': { name: 'Indiana', bounds: [37.77, 41.76, -84.78, -88.10] },
        'IA': { name: 'Iowa', bounds: [40.38, 43.50, -90.14, -96.64] },
        'KS': { name: 'Kansas', bounds: [36.99, 40.00, -94.62, -102.05] },
        'KY': { name: 'Kentucky', bounds: [36.50, 39.15, -81.97, -89.57] },
        'LA': { name: 'Louisiana', bounds: [28.93, 33.02, -88.82, -94.04] },
        'ME': { name: 'Maine', bounds: [43.06, 47.46, -66.95, -71.08] },
        'MD': { name: 'Maryland', bounds: [37.91, 39.72, -75.05, -79.49] },
        'MA': { name: 'Massachusetts', bounds: [41.24, 42.89, -69.93, -73.51] },
        'MI': { name: 'Michigan', bounds: [41.70, 48.31, -82.13, -90.42] },
        'MN': { name: 'Minnesota', bounds: [43.50, 49.38, -89.53, -97.24] },
        'MS': { name: 'Mississippi', bounds: [30.14, 35.00, -88.10, -91.65] },
        'MO': { name: 'Missouri', bounds: [35.99, 40.61, -89.10, -95.77] },
        'MT': { name: 'Montana', bounds: [44.36, 49.00, -104.04, -116.05] },
        'NE': { name: 'Nebraska', bounds: [39.99, 43.00, -95.31, -104.05] },
        'NV': { name: 'Nevada', bounds: [35.00, 42.00, -114.04, -120.00] },
        'NH': { name: 'New Hampshire', bounds: [42.70, 45.31, -70.61, -72.56] },
        'NJ': { name: 'New Jersey', bounds: [38.93, 41.36, -73.90, -75.56] },
        'NM': { name: 'New Mexico', bounds: [31.33, 37.00, -103.00, -109.05] },
        'NY': { name: 'New York', bounds: [40.48, 45.02, -71.86, -79.76] },
        'NC': { name: 'North Carolina', bounds: [33.84, 36.59, -75.46, -84.32] },
        'ND': { name: 'North Dakota', bounds: [45.93, 49.00, -96.55, -104.05] },
        'OH': { name: 'Ohio', bounds: [38.40, 41.98, -80.52, -84.82] },
        'OK': { name: 'Oklahoma', bounds: [33.62, 37.00, -94.43, -103.00] },
        'OR': { name: 'Oregon', bounds: [41.99, 46.29, -116.47, -124.57] },
        'PA': { name: 'Pennsylvania', bounds: [39.72, 42.27, -74.69, -80.52] },
        'RI': { name: 'Rhode Island', bounds: [41.15, 42.02, -71.12, -71.89] },
        'SC': { name: 'South Carolina', bounds: [32.03, 35.21, -78.54, -83.35] },
        'SD': { name: 'South Dakota', bounds: [42.48, 45.94, -96.45, -104.06] },
        'TN': { name: 'Tennessee', bounds: [34.98, 36.68, -81.65, -90.31] },
        'TX': { name: 'Texas', bounds: [25.84, 36.50, -93.51, -106.65] },
        'UT': { name: 'Utah', bounds: [36.99, 42.00, -109.04, -114.05] },
        'VT': { name: 'Vermont', bounds: [42.73, 45.02, -71.46, -73.44] },
        'VA': { name: 'Virginia', bounds: [36.54, 39.47, -75.24, -83.68] },
        'WA': { name: 'Washington', bounds: [45.54, 49.00, -116.92, -124.79] },
        'WV': { name: 'West Virginia', bounds: [37.20, 40.64, -77.72, -82.65] },
        'WI': { name: 'Wisconsin', bounds: [42.49, 47.31, -86.25, -92.89] },
        'WY': { name: 'Wyoming', bounds: [40.99, 45.01, -104.05, -111.05] },
        'PR': { name: 'Puerto Rico', bounds: [17.9, 18.5, -65.2, -67.9] }
    },
    REGIONS: {
        'northeast': { name: 'Northeast', bounds: [38.79, 47.46, -66.95, -80.52] },
        'southeast': { name: 'Southeast', bounds: [24.52, 39.72, -75.05, -91.65] },
        'midwest': { name: 'Midwest', bounds: [36.97, 49.38, -80.52, -104.06] },
        'southwest': { name: 'Southwest', bounds: [31.33, 37.00, -103.00, -124.41] },
        'west': { name: 'West', bounds: [32.53, 49.00, -102.04, -124.79] },
        'pacific': { name: 'Pacific', bounds: [32.53, 49.00, -116.47, -124.79] },
        'central': { name: 'Central', bounds: [25.84, 49.0, -90.0, -106.65] }, // All of Texas + Mississippi Valley to Canada
        'east': { name: 'East', bounds: [25.0, 47.0, -67.0, -90.0] } // Atlantic coast to Mississippi River
    },
    // Performance settings
    MAX_MARKERS: 5000, // Maximum markers to display (prevents performance issues)
    MAX_MARKERS_WARNING: 3000, // Show warning when approaching limit
    VIEWPORT_ONLY: true, // Only show markers in current viewport when zoomed in
    MIN_ZOOM_FOR_VIEWPORT: 6, // Minimum zoom level to enable viewport filtering
    ZOOM_BASED_LIMITS: {
        // Max markers per zoom level (undefined = no limit)
        3: 500,   // Increased from 100 - show more at continent view
        4: 1000,  // Increased from 300 - show more at country view
        5: 2000,  // Increased from 500 - show more at regional view
        6: 3500,  // Increased from 1000 - show more at state view
        7: 4500,  // Increased from 2000 - show more at local view
        8: 5000,  // Increased from 3000 - matches MAX_MARKERS
        // 9+: no limit (uses MAX_MARKERS)
    }
};

// Weather category mappings
const WEATHER_CATEGORIES = {
    WINTER: ['Snow', 'Ice'],
    SEVERE: ['Tornado', 'Thunderstorm', 'Hail'],
    PRECIP: ['Rain', 'Snow', 'Ice']
};

// Report type mapping: rtype codes -> display names
const REPORT_TYPE_MAP = {
    "R": "Rain",
    "F": "Flood", "E": "Flood", "v": "Flood",
    "S": "Snow", "Z": "Snow",
    "5": "Ice", "s": "Ice",
    "H": "Hail",
    "O": "Wind", "N": "Wind",
    "D": "Thunderstorm", "G": "Thunderstorm", "M": "Thunderstorm",
    "T": "Tornado", "C": "Tornado", "W": "Tornado",
    "0": "Tropical", "Q": "Tropical"
};

// Icon configuration by report type and magnitude thresholds
const ICON_CONFIG = {
    "R": { // Rain
        type: "circle",
        emoji: "🌧️",
        thresholds: [
            { max: 1, fill: "#b2f7b3", stroke: "black" },
            { max: 2, fill: "#5CBD5F", stroke: "black" },
            { max: 3, fill: "#27822E", stroke: "black" },
            { max: 4, fill: "#6BD7CB", stroke: "black" },
            { max: 5, fill: "#4B66B4", stroke: "black" },
            { max: 6, fill: "#513EA4", stroke: "black" },
            { max: 8, fill: "#6E3192", stroke: "black" },
            { max: Infinity, fill: "#F122E3", stroke: "black" }
        ]
    },
    "O": { // Non-thunderstorm wind
        type: "circle",
        emoji: "💨",
        thresholds: [
            { max: 35, fill: "#FFEDCC", stroke: "#333" },
            { max: 57, fill: "#FFB266", stroke: "#333" },
            { max: 75, fill: "#FF8000", stroke: "#333" },
            { max: Infinity, fill: "#996300", stroke: "#333" }
        ]
    },
    "N": { // Non-thunderstorm wind
        type: "circle",
        emoji: "💨",
        thresholds: [
            { max: 35, fill: "#FFEDCC", stroke: "#333" },
            { max: 57, fill: "#FFB266", stroke: "#333" },
            { max: 75, fill: "#FF8000", stroke: "#333" },
            { max: Infinity, fill: "#996300", stroke: "#333" }
        ]
    },
    "S": { // Snow
        type: "circle",
        emoji: "❄️",
        thresholds: [
            { max: 2, fill: "#e5e8ff", stroke: "black" },
            { max: 4, fill: "#b2bbff", stroke: "black" },
            { max: 6, fill: "#6678ff", stroke: "black" },
            { max: 8, fill: "#1934ff", stroke: "black" },
            { max: 12, fill: "#001eff", stroke: "black" },
            { max: 18, fill: "#37007f", stroke: "black" },
            { max: 24, fill: "#7d19ff", stroke: "black" },
            { max: 30, fill: "#c900ff", stroke: "black" },
            { max: 36, fill: "#ff00db", stroke: "black" },
            { max: 48, fill: "#ff0000", stroke: "black" },
            { max: 60, fill: "#ff9999", stroke: "black" },
            { max: Infinity, fill: "#000000", stroke: "white" }
        ]
    },
    "Z": { // Blizzard
        type: "circle",
        emoji: "❄️",
        fill: "#ffffff",
        stroke: "red"
    },
    "D": { // Thunderstorm wind
        type: "rect",
        emoji: "⛈️",
        thresholds: [
            { max: 50, fill: "yellow", stroke: "#333" },
            { max: 75, fill: "orange", stroke: "#333" },
            { max: Infinity, fill: "red", stroke: "#333" }
        ]
    },
    "G": { // Thunderstorm wind
        type: "rect",
        emoji: "⛈️",
        thresholds: [
            { max: 50, fill: "yellow", stroke: "#333" },
            { max: 75, fill: "orange", stroke: "#333" },
            { max: Infinity, fill: "red", stroke: "#333" }
        ]
    },
    "M": { // Thunderstorm wind
        type: "rect",
        emoji: "⛈️",
        thresholds: [
            { max: 50, fill: "yellow", stroke: "#333" },
            { max: 75, fill: "orange", stroke: "#333" },
            { max: Infinity, fill: "red", stroke: "#333" }
        ]
    },
    "0": { // Tropical
        type: "circle",
        emoji: "🌀",
        extractWindFromRemark: true,
        thresholds: [
            { max: 75, fill: "#FFFFFF", stroke: "red" },
            { max: 100, fill: "#808080", stroke: "red" },
            { max: Infinity, fill: "#000000", stroke: "red" }
        ]
    },
    "Q": { // Tropical
        type: "circle",
        emoji: "🌀",
        extractWindFromRemark: true,
        thresholds: [
            { max: 75, fill: "#FFFFFF", stroke: "red" },
            { max: 100, fill: "#808080", stroke: "red" },
            { max: Infinity, fill: "#000000", stroke: "red" }
        ]
    },
    "T": { // Tornado
        type: "rect", // Square to match severe weather markers
        emoji: "🌪️",
        fill: "#dc2626",
        stroke: "#fff"
    },
    "C": { // Tornado
        type: "rect", // Square to match severe weather markers
        emoji: "🌪️",
        fill: "#dc2626",
        stroke: "#fff"
    },
    "W": { // Tornado
        type: "rect", // Square to match severe weather markers
        emoji: "🌪️",
        fill: "#dc2626",
        stroke: "#fff"
    },
    "H": { // Hail
        type: "rect", // Rectangle/square to match severe thunderstorm style
        emoji: "💎", // Diamond/gem to represent hailstones
        thresholds: [
            { max: 1, fill: "#FF99FF", stroke: "#333" },
            { max: 2, fill: "#FF3399", stroke: "#333" },
            { max: Infinity, fill: "#990099", stroke: "#333" }
        ]
    },
    "5": { // Ice
        type: "circle",
        emoji: "🧊",
        thresholds: [
            { max: 0.10, fill: "#999999", stroke: "#333" },
            { max: 0.25, fill: "#FF99FF", stroke: "#333" },
            { max: 0.50, fill: "#FF3399", stroke: "#333" },
            { max: Infinity, fill: "#990099", stroke: "#333" }
        ]
    },
    "s": { // Ice
        type: "circle",
        emoji: "🧊",
        fill: "#93c5fd",
        stroke: "#fff"
    },
    "F": { // Flood
        type: "circle",
        emoji: "🌊",
        fill: "#b2f7b3",
        stroke: "red"
    },
    "E": { // Flood
        type: "circle",
        emoji: "🌊",
        fill: "#b2f7b3",
        stroke: "red"
    },
    "v": { // Flood
        type: "circle",
        emoji: "🌊",
        fill: "#b2f7b3",
        stroke: "red"
    }
};

const LEGEND_ITEMS = [
    { name: 'Rain', color: '#5CBD5F', emoji: '🌧️', shape: 'circle' },
    { name: 'Flood', color: '#b2f7b3', emoji: '🌊', shape: 'circle' },
    { name: 'Snow', color: '#e5e8ff', emoji: '❄️', shape: 'circle' },
    { name: 'Ice', color: '#999999', emoji: '🧊', shape: 'circle' },
    { name: 'Hail', color: '#FF99FF', emoji: '💎', shape: 'square' },
    { name: 'Wind', color: '#FFEDCC', emoji: '💨', shape: 'circle' },
    { name: 'Thunderstorm', color: 'yellow', emoji: '⛈️', shape: 'square' },
    { name: 'Tornado', color: '#dc2626', emoji: '🌪️', shape: 'square' },
    { name: 'Tropical', color: '#FFFFFF', emoji: '🌀', shape: 'circle' },
    { name: 'Other', color: '#1f2937', emoji: '⚠️', shape: 'circle' }
];
