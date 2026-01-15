<?php
/**
 * Set Permissions Script for NWS LSR Map
 * PHP version that can be run on the server after upload
 *
 * Usage:
 *   php set-permissions.php
 *   php set-permissions.php --cache
 */

$useCache = in_array('--cache', $argv);

echo "Setting file permissions for NWS LSR Map...\n\n";

// Set files to 644
echo "Setting file permissions to 644...\n";
$files = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator('.'),
    RecursiveIteratorIterator::SELF_FIRST
);

$excludeDirs = ['.git', 'node_modules', '.', '..'];
$fileCount = 0;
$dirCount = 0;

foreach ($files as $file) {
    $path = $file->getPathname();
    $relativePath = str_replace(getcwd() . DIRECTORY_SEPARATOR, '', $path);
    
    // Skip excluded directories
    $skip = false;
    foreach ($excludeDirs as $exclude) {
        if (strpos($relativePath, $exclude) === 0) {
            $skip = true;
            break;
        }
    }
    if ($skip) continue;
    
    if ($file->isFile()) {
        if (chmod($path, 0644)) {
            $fileCount++;
        }
    } elseif ($file->isDir() && !in_array($relativePath, $excludeDirs)) {
        if (chmod($path, 0755)) {
            $dirCount++;
        }
    }
}

echo "  ✓ Set permissions on {$fileCount} files\n";
echo "  ✓ Set permissions on {$dirCount} directories\n";

// Make scripts executable
echo "\nMaking scripts executable...\n";
$scripts = [
    'api/update-cache.php',
    'api/cleanup-cache.php'
];

foreach ($scripts as $script) {
    if (file_exists($script)) {
        chmod($script, 0755);
        echo "  ✓ {$script}\n";
    }
}

// Handle data directory for PHP cache
if ($useCache) {
    echo "\nSetting data/ directory to writable (for PHP cache)...\n";
    if (is_dir('data')) {
        if (chmod('data', 0777)) {
            echo "  ✓ data/ directory set to 777 (writable)\n";
        } else {
            echo "  ⚠ Could not set data/ to 777 (may need to set manually)\n";
        }
    } else {
        echo "  ⚠ data/ directory not found (will be created by PHP if needed)\n";
        // Try to create it
        if (mkdir('data', 0777, true)) {
            echo "  ✓ Created data/ directory\n";
        }
    }
} else {
    echo "\nNote: If using PHP cache, run with --cache flag:\n";
    echo "  php set-permissions.php --cache\n";
}

echo "\n✓ Permissions set successfully!\n\n";
echo "Summary:\n";
echo "  Files: 644 (readable by all)\n";
echo "  Directories: 755 (executable, readable by all)\n";
if ($useCache) {
    echo "  data/: 777 (writable for cache)\n";
}
echo "\n";
