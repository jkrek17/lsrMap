<?php
/**
 * Update Cache Script
 * Fetches data from source API and saves to daily GeoJSON files
 * 
 * Designed to run after 00 UTC to cache the previous day's complete data
 * 
 * Usage:
 *   php update-cache.php          - Update previous day (for cron after 00 UTC)
 *   php update-cache.php --all   - Update last 7 days (for initial setup)
 *   php update-cache.php --today - Update today only (for testing)
 */

require_once 'config.php';

$updateAll = isset($argv[1]) && $argv[1] === '--all';
$updateToday = isset($argv[1]) && $argv[1] === '--today';

if ($updateToday) {
    // Update today only (for testing)
    $targetDate = new DateTime();
    $dateKey = $targetDate->format('Y-m-d');
    $startFormatted = $targetDate->format('Ymd') . '0000';
    $endFormatted = $targetDate->format('Ymd') . '2359';
    
    // Fetch data from source API
    $url = SOURCE_API_URL . '?sts=' . $startFormatted . '&ets=' . $endFormatted . '&wfos=';
    echo "Fetching data for {$dateKey}...\n";
    
    $response = @file_get_contents($url);
    
    if ($response === false) {
        echo "Error: Failed to fetch data from source API\n";
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
        
        $response = @file_get_contents($url);
        
        if ($response === false) {
            echo "  Error: Failed to fetch data from source API\n";
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

$response = @file_get_contents($url);

if ($response === false) {
    echo "Error: Failed to fetch data from source API\n";
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
    
    return !empty($idParts) ? md5(implode('|', $idParts)) : null;
}
?>
