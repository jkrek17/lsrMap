<?php
/**
 * LSR Cache API Endpoint
 * Serves cached GeoJSON data for the last 30 days (configurable via CACHE_DAYS)
 * Falls back to source API for real-time data (last 24h), older dates, or missing cache
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');

require_once 'config.php';

// Get parameters
$startDate = isset($_GET['start']) ? $_GET['start'] : null;
$startHour = isset($_GET['startHour']) ? $_GET['startHour'] : '00:00';
$endDate = isset($_GET['end']) ? $_GET['end'] : null;
$endHour = isset($_GET['endHour']) ? $_GET['endHour'] : '23:59';

// Default to last 24 hours if not specified
if (!$startDate || !$endDate) {
    $endDate = date('Y-m-d');
    $endHour = '23:59';
    $startDateObj = new DateTime($endDate);
    $startDateObj->modify('-1 day');
    $startDate = $startDateObj->format('Y-m-d');
    $startHour = '00:00';
}

// Parse date/time with validation
$now = new DateTime();
$endDateTime = DateTime::createFromFormat('Y-m-d H:i:s', $endDate . ' ' . $endHour . ':00');
$startDateTime = DateTime::createFromFormat('Y-m-d H:i:s', $startDate . ' ' . $startHour . ':00');

// If date parsing fails, fall back to source API
if (!$endDateTime || !$startDateTime) {
    serveFromSourceAPI($startDate, $startHour, $endDate, $endHour);
    exit;
}

// Calculate hours difference
$hoursDiff = ($now->getTimestamp() - $startDateTime->getTimestamp()) / 3600;

// If query includes recent data (end date is within last 24 hours), fetch from source API for real-time data
$oneDayAgo = (clone $now)->modify('-1 day');
if ($endDateTime >= $oneDayAgo) {
    serveFromSourceAPI($startDate, $startHour, $endDate, $endHour);
    exit;
}

// Check if query is within cacheable range (last 30 days, but not last 24 hours)
$cacheCutoff = new DateTime();
$cacheCutoff->modify('-' . CACHE_DAYS . ' days');

// If query is older than cache period, fall back to source API
if ($endDateTime < $cacheCutoff) {
    serveFromSourceAPI($startDate, $startHour, $endDate, $endHour);
    exit;
}

// Try to serve from cache
$cachedData = loadFromCache($startDate, $startHour, $endDate, $endHour);

if ($cachedData !== null) {
    echo json_encode($cachedData);
} else {
    // Fallback to source API if cache is missing
    serveFromSourceAPI($startDate, $startHour, $endDate, $endHour);
}

/**
 * Load GeoJSON data from cache files with time filtering
 */
function loadFromCache($startDate, $startHour, $endDate, $endHour) {
    $allFeatures = [];
    
    try {
        $current = new DateTime($startDate);
        $end = new DateTime($endDate);
    } catch (Exception $e) {
        return null; // Invalid dates, fall back to source API
    }
    
    // Build full datetime range for filtering
    $filterStart = DateTime::createFromFormat('Y-m-d H:i', $startDate . ' ' . $startHour);
    $filterEnd = DateTime::createFromFormat('Y-m-d H:i', $endDate . ' ' . $endHour);
    
    // If filter dates couldn't be parsed, skip time filtering
    $useTimeFilter = ($filterStart !== false && $filterEnd !== false);
    
    // Check if we have all required files
    $missingFiles = [];
    $checkDate = clone $current;
    while ($checkDate <= $end) {
        $dateKey = $checkDate->format('Y-m-d');
        $file = CACHE_DIR . CACHE_FILE_PREFIX . $dateKey . CACHE_FILE_EXT;
        
        if (!file_exists($file)) {
            $missingFiles[] = $dateKey;
        }
        
        $checkDate->modify('+1 day');
    }
    
    // If any files are missing, return null to fall back to source API
    if (!empty($missingFiles)) {
        return null;
    }
    
    // Load all files and merge features
    while ($current <= $end) {
        $dateKey = $current->format('Y-m-d');
        $file = CACHE_DIR . CACHE_FILE_PREFIX . $dateKey . CACHE_FILE_EXT;
        
        if (file_exists($file)) {
            $fileContent = file_get_contents($file);
            $dayData = json_decode($fileContent, true);
            
            if ($dayData && isset($dayData['features']) && is_array($dayData['features'])) {
                // Filter features by time range if we have valid filter dates
                foreach ($dayData['features'] as $feature) {
                    if (!$useTimeFilter || isFeatureInTimeRange($feature, $filterStart, $filterEnd)) {
                        $allFeatures[] = $feature;
                    }
                }
            }
        }
        
        $current->modify('+1 day');
    }
    
    return [
        'type' => 'FeatureCollection',
        'features' => $allFeatures
    ];
}

/**
 * Check if a feature falls within the requested time range
 */
function isFeatureInTimeRange($feature, $filterStart, $filterEnd) {
    // Safety check for invalid filter parameters
    if (!$filterStart || !$filterEnd) {
        return true;
    }
    
    // If no valid timestamp, include the feature (conservative approach)
    if (!isset($feature['properties']['valid'])) {
        return true;
    }
    
    $validTime = $feature['properties']['valid'];
    
    // Parse the valid timestamp (format: 2026-01-14T01:22:00Z)
    $featureTime = DateTime::createFromFormat('Y-m-d\TH:i:s\Z', $validTime);
    
    // Try alternate format without Z suffix
    if (!$featureTime) {
        $featureTime = DateTime::createFromFormat('Y-m-d\TH:i:s', $validTime);
    }
    
    // If we can't parse the time, include the feature
    if (!$featureTime) {
        return true;
    }
    
    // Check if feature time is within the requested range
    return $featureTime >= $filterStart && $featureTime <= $filterEnd;
}

/**
 * Serve data from source API (fallback)
 */
function serveFromSourceAPI($startDate, $startHour, $endDate, $endHour) {
    // Format dates for API (YYYYMMDDHHMM - 12 characters)
    // Input: startDate = "2026-01-14", startHour = "00:00"
    // Output: "202601140000"
    $startFormatted = str_replace(['-', ':'], '', $startDate . $startHour);
    $endFormatted = str_replace(['-', ':'], '', $endDate . $endHour);
    
    $url = SOURCE_API_URL . '?sts=' . $startFormatted . '&ets=' . $endFormatted . '&wfos=';
    
    // Fetch from source API
    $response = @file_get_contents($url);
    
    if ($response === false) {
        http_response_code(500);
        echo json_encode([
            'type' => 'FeatureCollection',
            'features' => [],
            'error' => 'Failed to fetch from source API'
        ]);
        return;
    }
    
    // Handle JSONP callback if present
    if (isset($_GET['callback'])) {
        header('Content-Type: application/javascript');
        echo $_GET['callback'] . '(' . $response . ');';
    } else {
        echo $response;
    }
}
?>
