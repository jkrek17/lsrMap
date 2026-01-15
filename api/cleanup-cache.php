<?php
/**
 * Cleanup Cache Script
 * Removes cache files older than 7 days
 * Should be run daily via cron
 */

require_once 'config.php';

$cutoffDate = new DateTime();
$cutoffDate->modify('-' . CACHE_DAYS . ' days');
$cutoffKey = $cutoffDate->format('Y-m-d');

echo "Cleaning up cache files older than {$cutoffKey}...\n";

// Get all cache files
$files = glob(CACHE_DIR . CACHE_FILE_PREFIX . '*.geojson');

$deletedCount = 0;
$keptCount = 0;

foreach ($files as $file) {
    // Extract date from filename: reports-YYYY-MM-DD.geojson
    $filename = basename($file);
    if (preg_match('/reports-(\d{4}-\d{2}-\d{2})\.geojson/', $filename, $matches)) {
        $fileDate = $matches[1];
        
        if ($fileDate < $cutoffKey) {
            unlink($file);
            $deletedCount++;
            echo "Deleted: {$filename}\n";
        } else {
            $keptCount++;
        }
    }
}

echo "Cleanup complete: {$deletedCount} files deleted, {$keptCount} files kept\n";
?>
