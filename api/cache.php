<?php
/**
 * LSR Cache API Endpoint
 * Serves cached GeoJSON data for the last 30 days
 * Falls back to source API for older dates or missing cache
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');

require_once 'config.php';

    // Get parameters with sanitization
    // Strip all non-digits from hour params (handles both HHMM and HH:MM input)
    $startDate = isset($_GET['start']) ? preg_replace('/[^0-9\-]/', '', $_GET['start']) : null;
    $startHour = isset($_GET['startHour']) ? preg_replace('/[^0-9]/', '', $_GET['startHour']) : '0000';
    $endDate = isset($_GET['end']) ? preg_replace('/[^0-9\-]/', '', $_GET['end']) : null;
    $endHour = isset($_GET['endHour']) ? preg_replace('/[^0-9]/', '', $_GET['endHour']) : '2359';

    // Ensure hour params are exactly 4 digits
    $startHour = str_pad(substr($startHour, 0, 4), 4, '0');
    $endHour = str_pad(substr($endHour, 0, 4), 4, '0');

    // Default to last 24 hours if not specified
    if (!$startDate || !$endDate) {
        $endDate = date('Y-m-d');
        $endHour = '2359';
        $startDateObj = new DateTime($endDate);
        $startDateObj->modify('-1 day');
        $startDate = $startDateObj->format('Y-m-d');
        $startHour = '0000';
    }

    // Parse date/time with validation (insert colon for DateTime parsing)
    $now = new DateTime();
    $endDateTime = DateTime::createFromFormat('Y-m-d H:i', $endDate . ' ' . substr($endHour, 0, 2) . ':' . substr($endHour, 2, 2));
    $startDateTime = DateTime::createFromFormat('Y-m-d H:i', $startDate . ' ' . substr($startHour, 0, 2) . ':' . substr($startHour, 2, 2));

// Calculate hours difference
$hoursDiff = ($now->getTimestamp() - $startDateTime->getTimestamp()) / 3600;

    // If query includes today or future dates, fetch from source API for real-time data
    // Today's data won't be in the cache (it's still accumulating)
    $today = $now->format('Y-m-d');
    if ($endDate >= $today) {
        serveFromSourceAPI($startDate, $startHour, $endDate, $endHour);
        exit;
    }

    // Check if query is within cacheable range (last 30 days)
    $cacheCutoff = new DateTime();
    $cacheCutoff->modify('-' . CACHE_DAYS . ' days');

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
    $current = new DateTime($startDate);
    $end = new DateTime($endDate);
    
    // Build full datetime range for filtering
    $filterStart = DateTime::createFromFormat('Y-m-d H:i', $startDate . ' ' . $startHour);
    $filterEnd = DateTime::createFromFormat('Y-m-d H:i', $endDate . ' ' . $endHour);
    
    // Check if we have all required files
    $missingFiles = [];
    while ($current <= $end) {
        $dateKey = $current->format('Y-m-d');
        $file = CACHE_DIR . CACHE_FILE_PREFIX . $dateKey . CACHE_FILE_EXT;
        
        if (!file_exists($file)) {
            $missingFiles[] = $dateKey;
        }
        
        $current->modify('+1 day');
    }
    
    // If any files are missing, return null to fall back to source API
    if (!empty($missingFiles)) {
        return null;
    }
    
    // Load all files and merge features
    $current = new DateTime($startDate);
    while ($current <= $end) {
        $dateKey = $current->format('Y-m-d');
        $file = CACHE_DIR . CACHE_FILE_PREFIX . $dateKey . CACHE_FILE_EXT;
        
        if (file_exists($file)) {
            $fileContent = file_get_contents($file);
            $dayData = json_decode($fileContent, true);
            
            if ($dayData && isset($dayData['features']) && is_array($dayData['features'])) {
                // Filter features by time range
                foreach ($dayData['features'] as $feature) {
                    if (isFeatureInTimeRange($feature, $filterStart, $filterEnd)) {
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
    // Input: $startDate = "2026-01-17", $startHour = "0000"
    // Output: "202601170000"
    $startFormatted = str_replace('-', '', $startDate) . $startHour;
    $endFormatted = str_replace('-', '', $endDate) . $endHour;
    
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

/**
 * Fetch URL content using cURL (preferred) or file_get_contents (fallback)
 */
function fetchUrl($url) {
    // Try cURL first (more reliable, doesn't require allow_url_fopen)
    if (function_exists('curl_init')) {
        try {
            $ch = curl_init();
            curl_setopt_array($ch, [
                CURLOPT_URL => $url,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 30,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_USERAGENT => 'LSR-Cache-API/1.0'
            ]);

            $response = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $error = curl_error($ch);
            curl_close($ch);

            if ($response !== false && $httpCode >= 200 && $httpCode < 300) {
                return $response;
            }

            // Log cURL error for debugging but continue to fallback
            error_log("cURL fetch failed: $error (HTTP $httpCode)");
        } catch (Exception $e) {
            // Catch warnings converted to exceptions (e.g. CURLOPT_FOLLOWLOCATION with open_basedir)
            error_log("cURL exception in fetchUrl: " . $e->getMessage());
            if (isset($ch) && (is_resource($ch) || $ch instanceof \CurlHandle)) {
                curl_close($ch);
            }
        }
    }

    // Fallback to file_get_contents
    if (ini_get('allow_url_fopen')) {
        $context = stream_context_create([
            'http' => [
                'timeout' => 30,
                'ignore_errors' => false,
                'user_agent' => 'LSR-Cache-API/1.0'
            ]
        ]);

        $response = @file_get_contents($url, false, $context);
        if ($response !== false) {
            return $response;
        }
    }

    return false;
}
?>
