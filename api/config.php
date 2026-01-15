<?php
// Configuration for LSR Cache System

define('CACHE_DIR', __DIR__ . '/../data/');
define('CACHE_DAYS', 30); // Cache 30 days of data (~12 MB, ~13,000 reports)
define('SOURCE_API_URL', 'https://mesonet.agron.iastate.edu/geojson/lsr.php');
define('CACHE_FILE_PREFIX', 'reports-');
define('CACHE_FILE_EXT', '.geojson');

// Ensure cache directory exists
if (!is_dir(CACHE_DIR)) {
    mkdir(CACHE_DIR, 0755, true);
}
?>
