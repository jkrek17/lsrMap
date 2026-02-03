<?php
/**
 * Update Cache Script
 * Fetches data from source API and saves to daily GeoJSON files
 * 
 * Designed to run after 00 UTC to cache the previous day's complete data
 * 
 * Usage:
 *   php update-cache.php           - Update previous day (for cron after 00 UTC)
 *   php update-cache.php --all     - Update last CACHE_DAYS (default 30) for initial setup
 *   php update-cache.php --days N  - Update last N days (e.g. --days 30 for one month)
 *   php update-cache.php --today   - Update today only (for testing)
 */

require_once 'config.php';

/**
 * Fetch URL via cURL (preferred) or file_get_contents. Returns response string or false.
 */
function fetchSourceUrl($url) {
    if (function_exists('curl_init')) {
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 60,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_USERAGENT => 'LSR-Update-Cache/1.0'
        ]);
        $response = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($response !== false && $code >= 200 && $code < 300) {
            return $response;
        }
    }
    if (ini_get('allow_url_fopen')) {
        $ctx = stream_context_create([
            'http' => ['timeout' => 60, 'user_agent' => 'LSR-Update-Cache/1.0']
        ]);
        $r = @file_get_contents($url, false, $ctx);
        return $r !== false ? $r : false;
    }
    return false;
}

$updateAll = isset($argv[1]) && $argv[1] === '--all';
$updateToday = isset($argv[1]) && $argv[1] === '--today';
$updateDays = null;
if (isset($argv[1]) && $argv[1] === '--days' && isset($argv[2]) && ctype_digit($argv[2])) {
    $updateDays = (int) $argv[2];
}

if ($updateDays !== null) {
    $endDate = new DateTime();
    $startDate = clone $endDate;
    $startDate->modify('-' . ($updateDays - 1) . ' days');
    $current = clone $startDate;
    $totalReports = 0;

    while ($current <= $endDate) {
        $dateKey = $current->format('Y-m-d');
        $startFormatted = $current->format('Ymd') . '0000';
        $endFormatted = $current->format('Ymd') . '2359';
        $url = SOURCE_API_URL . '?sts=' . $startFormatted . '&ets=' . $endFormatted . '&wfos=';
        echo "Fetching data for {$dateKey}...\n";

        $response = fetchSourceUrl($url);
        if ($response === false) {
            echo "  Error: Failed to fetch data from source API (check cURL / allow_url_fopen)\n";
            $current->modify('+1 day');
            continue;
        }
        $data = json_decode($response, true);
        if (!$data || !isset($data['features'])) {
            echo "  Warning: No data received or invalid format\n";
            $current->modify('+1 day');
            continue;
        }

        $cacheFile = CACHE_DIR . CACHE_FILE_PREFIX . $dateKey . CACHE_FILE_EXT;
        $existingFeatures = [];
        if (file_exists($cacheFile)) {
            $existingContent = file_get_contents($cacheFile);
            $existingData = json_decode($existingContent, true);
            if ($existingData && isset($existingData['features'])) {
                $existingFeatures = $existingData['features'];
            }
        }

        $featureMap = [];
        foreach ($existingFeatures as $feature) {
            $id = getFeatureId($feature);
            if ($id) $featureMap[$id] = $feature;
        }
        foreach ($data['features'] as $feature) {
            $id = getFeatureId($feature);
            if ($id) $featureMap[$id] = $feature;
            else $featureMap[] = $feature;
        }
        $mergedFeatures = array_values($featureMap);
        $geoJson = ['type' => 'FeatureCollection', 'features' => $mergedFeatures];
        file_put_contents($cacheFile, json_encode($geoJson, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        $reportCount = count($mergedFeatures);
        $totalReports += $reportCount;
        echo "  Cache updated: {$dateKey} - {$reportCount} reports saved\n";
        $current->modify('+1 day');
        usleep(500000);
    }
    echo "\nTotal: {$totalReports} reports cached across {$updateDays} days\n";
    exit(0);
}

if ($updateToday) {
    // Update today only (for testing)
    $targetDate = new DateTime();
    $dateKey = $targetDate->format('Y-m-d');
    $startFormatted = $targetDate->format('Ymd') . '0000';
    $endFormatted = $targetDate->format('Ymd') . '2359';
    
    // Fetch data from source API
    $url = SOURCE_API_URL . '?sts=' . $startFormatted . '&ets=' . $endFormatted . '&wfos=';
    echo "Fetching data for {$dateKey}...\n";
    
    $response = fetchSourceUrl($url);

    if ($response === false) {
        echo "Error: Failed to fetch data from source API (check cURL / allow_url_fopen)\n";
        exit(1);
    }

    $data = json_decode($response, true);

    if (!$data || !isset($data['features'])) {
        echo "Warning: No data received or invalid format\n";
        exit(0);
    }

    // Load existing cache file if it exists
    $cacheFile = CACHE_DIR . CACHE_FILE_PREFIX . $dateKey . CACHE_FILE_EXT;
    $existingFeatures = [];

    if (file_exists($cacheFile)) {
        $existingContent = file_get_contents($cacheFile);
        $existingData = json_decode($existingContent, true);
        
        if ($existingData && isset($existingData['features'])) {
            $existingFeatures = $existingData['features'];
        }
    }
    
    // Merge with new data (avoid duplicates by report ID)
    $featureMap = [];
    foreach ($existingFeatures as $feature) {
        $id = getFeatureId($feature);
        if ($id) {
            $featureMap[$id] = $feature;
        }
    }
    
    // Add new features
    foreach ($data['features'] as $feature) {
        $id = getFeatureId($feature);
        if ($id) {
            $featureMap[$id] = $feature; // Newer features overwrite older ones
        } else {
            $featureMap[] = $feature; // Add features without IDs
        }
    }
    
    // Rebuild feature array
    $mergedFeatures = array_values($featureMap);
    
    // Save to cache file
    $geoJson = [
        'type' => 'FeatureCollection',
        'features' => $mergedFeatures
    ];
    
    $jsonContent = json_encode($geoJson, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    file_put_contents($cacheFile, $jsonContent);
    
    echo "Cache updated: {$dateKey} - " . count($mergedFeatures) . " reports saved\n";
    exit(0);
}

if ($updateAll) {
    // Update last 30 days (or CACHE_DAYS)
    $endDate = new DateTime();
    $startDate = clone $endDate;
    $startDate->modify('-' . (CACHE_DAYS - 1) . ' days'); // CACHE_DAYS total (today + previous days)
    
    $current = clone $startDate;
    $totalReports = 0;
    
    while ($current <= $endDate) {
        $dateKey = $current->format('Y-m-d');
        $startFormatted = $current->format('Ymd') . '0000';
        $endFormatted = $current->format('Ymd') . '2359';
        
        // Fetch data from source API
        $url = SOURCE_API_URL . '?sts=' . $startFormatted . '&ets=' . $endFormatted . '&wfos=';
        echo "Fetching data for {$dateKey}...\n";
        
        $response = fetchSourceUrl($url);

        if ($response === false) {
            echo "  Error: Failed to fetch data from source API (check cURL / allow_url_fopen)\n";
            $current->modify('+1 day');
            continue;
        }
        
        $data = json_decode($response, true);
        
        if (!$data || !isset($data['features'])) {
            echo "  Warning: No data received or invalid format\n";
            $current->modify('+1 day');
            continue;
        }
        
        // Load existing cache file if it exists
        $cacheFile = CACHE_DIR . CACHE_FILE_PREFIX . $dateKey . CACHE_FILE_EXT;
        $existingFeatures = [];
        
        if (file_exists($cacheFile)) {
            $existingContent = file_get_contents($cacheFile);
            $existingData = json_decode($existingContent, true);
            
            if ($existingData && isset($existingData['features'])) {
                $existingFeatures = $existingData['features'];
            }
        }
        
        // Merge with new data (avoid duplicates by report ID)
        $featureMap = [];
        foreach ($existingFeatures as $feature) {
            $id = getFeatureId($feature);
            if ($id) {
                $featureMap[$id] = $feature;
            }
        }
        
        // Add new features
        foreach ($data['features'] as $feature) {
            $id = getFeatureId($feature);
            if ($id) {
                $featureMap[$id] = $feature; // Newer features overwrite older ones
            } else {
                $featureMap[] = $feature; // Add features without IDs
            }
        }
        
        // Rebuild feature array
        $mergedFeatures = array_values($featureMap);
        
        // Save to cache file
        $geoJson = [
            'type' => 'FeatureCollection',
            'features' => $mergedFeatures
        ];
        
        $jsonContent = json_encode($geoJson, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        file_put_contents($cacheFile, $jsonContent);
        
        $reportCount = count($mergedFeatures);
        $totalReports += $reportCount;
        echo "  Cache updated: {$dateKey} - {$reportCount} reports saved\n";
        
        $current->modify('+1 day');
        
        // Small delay to avoid overwhelming the API
        usleep(500000); // 0.5 seconds
    }
    
    echo "\nTotal: {$totalReports} reports cached across " . CACHE_DAYS . " days\n";
    exit(0);
}

// Default behavior: Update previous day (for cron after 00 UTC)
// This ensures we get the complete previous day's data after midnight UTC
$now = new DateTime();
$previousDay = clone $now;
$previousDay->modify('-1 day');
$dateKey = $previousDay->format('Y-m-d');

// Format dates for API (previous day's complete data)
$startFormatted = $previousDay->format('Ymd') . '0000';
$endFormatted = $previousDay->format('Ymd') . '2359';

// Fetch data from source API
$url = SOURCE_API_URL . '?sts=' . $startFormatted . '&ets=' . $endFormatted . '&wfos=';
echo "Fetching data for {$dateKey} (previous day)...\n";

$response = fetchSourceUrl($url);

if ($response === false) {
    echo "Error: Failed to fetch data from source API (check cURL / allow_url_fopen)\n";
    exit(1);
}

$data = json_decode($response, true);

if (!$data || !isset($data['features'])) {
    echo "Warning: No data received or invalid format\n";
    exit(0);
}

// Load existing cache file if it exists
$cacheFile = CACHE_DIR . CACHE_FILE_PREFIX . $dateKey . CACHE_FILE_EXT;
$existingFeatures = [];

if (file_exists($cacheFile)) {
    $existingContent = file_get_contents($cacheFile);
    $existingData = json_decode($existingContent, true);
    
    if ($existingData && isset($existingData['features'])) {
        $existingFeatures = $existingData['features'];
    }
}

// Merge with new data (avoid duplicates by report ID)
$featureMap = [];
foreach ($existingFeatures as $feature) {
    $id = getFeatureId($feature);
    if ($id) {
        $featureMap[$id] = $feature;
    }
}

// Add new features
foreach ($data['features'] as $feature) {
    $id = getFeatureId($feature);
    if ($id) {
        $featureMap[$id] = $feature; // Newer features overwrite older ones
    } else {
        $featureMap[] = $feature; // Add features without IDs
    }
}

// Rebuild feature array
$mergedFeatures = array_values($featureMap);

// Save to cache file
$geoJson = [
    'type' => 'FeatureCollection',
    'features' => $mergedFeatures
];

$jsonContent = json_encode($geoJson, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
file_put_contents($cacheFile, $jsonContent);

echo "Cache updated: {$dateKey} - " . count($mergedFeatures) . " reports saved\n";

/**
 * Get unique ID for a feature (use properties that identify the report)
 */
function getFeatureId($feature) {
    if (!isset($feature['properties'])) {
        return null;
    }
    
    $props = $feature['properties'];
    
    // Try to construct an ID from available properties
    $idParts = [];
    
    if (isset($props['valid'])) {
        $idParts[] = $props['valid'];
    }
    if (isset($props['lat'])) {
        $idParts[] = $props['lat'];
    }
    if (isset($props['lon'])) {
        $idParts[] = $props['lon'];
    }
    if (isset($props['type']) || isset($props['rtype'])) {
        $idParts[] = $props['type'] ?? $props['rtype'];
    }
    if (isset($props['magnitude'])) {
        $idParts[] = $props['magnitude'];
    }
    
    return !empty($idParts) ? hash('sha256', implode('|', $idParts)) : null;
}
?>
