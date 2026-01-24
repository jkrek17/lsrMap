<?php
/**
 * LSR Cache API Endpoint
 * Serves cached GeoJSON data for the last 7 days
 * Falls back to source API for older dates or missing cache
 */

// Error handling - convert errors to exceptions for cleaner handling
set_error_handler(function($severity, $message, $file, $line) {
    // Don't throw for suppressed errors (@)
    if (!(error_reporting() & $severity)) {
        return false;
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');

try {
    require_once 'config.php';

    // Get parameters with sanitization
    $startDate = isset($_GET['start']) ? preg_replace('/[^0-9\-]/', '', $_GET['start']) : null;
    $startHour = isset($_GET['startHour']) ? preg_replace('/[^0-9:]/', '', $_GET['startHour']) : '00:00';
    $endDate = isset($_GET['end']) ? preg_replace('/[^0-9\-]/', '', $_GET['end']) : null;
    $endHour = isset($_GET['endHour']) ? preg_replace('/[^0-9:]/', '', $_GET['endHour']) : '23:59';

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
    $endDateTime = DateTime::createFromFormat('Y-m-d H:i', $endDate . ' ' . $endHour);
    $startDateTime = DateTime::createFromFormat('Y-m-d H:i', $startDate . ' ' . $startHour);

    // Validate date parsing
    if (!$endDateTime || !$startDateTime) {
        throw new Exception('Invalid date format');
    }

    // Calculate hours difference
    $hoursDiff = ($now->getTimestamp() - $startDateTime->getTimestamp()) / 3600;

    // If query is within last 24 hours, fetch from source API for real-time data
    if ($hoursDiff <= 24 && $endDateTime >= (clone $now)->modify('-1 day')) {
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
    $cachedData = loadFromCache($startDate, $endDate);

    if ($cachedData !== null) {
        echo json_encode($cachedData);
    } else {
        // Fallback to source API if cache is missing
        serveFromSourceAPI($startDate, $startHour, $endDate, $endHour);
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'type' => 'FeatureCollection',
        'features' => [],
        'error' => 'Server error: ' . $e->getMessage()
    ]);
}

/**
 * Load GeoJSON data from cache files
 */
function loadFromCache($startDate, $endDate) {
    $allFeatures = [];
    $current = new DateTime($startDate);
    $end = new DateTime($endDate);
    
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
                $allFeatures = array_merge($allFeatures, $dayData['features']);
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
 * Serve data from source API (fallback)
 */
function serveFromSourceAPI($startDate, $startHour, $endDate, $endHour) {
    // Format dates for API (YYYYMMDDHHMM - 12 characters)
    // Input: $startDate = "2026-01-17", $startHour = "00:00"
    // Output: "202601170000"
    $startFormatted = str_replace(['-', ':'], '', $startDate . $startHour);
    $endFormatted = str_replace(['-', ':'], '', $endDate . $endHour);
    
    $url = SOURCE_API_URL . '?sts=' . $startFormatted . '&ets=' . $endFormatted . '&wfos=';
    
    // Try to fetch using cURL first (more reliable), then fall back to file_get_contents
    $response = fetchUrl($url);
    
    if ($response === false) {
        // Return 200 with useJsonp flag instead of 502
        // This tells the client to use JSONP fallback without triggering error retries
        echo json_encode([
            'type' => 'FeatureCollection',
            'features' => [],
            'useJsonp' => true,
            'error' => 'Server cannot proxy to source API - use JSONP fallback',
            'sourceUrl' => $url
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
