# LSR Cache System Setup

> **Note:** This is an optional server-side caching system. The application works without it, but caching significantly improves performance for recent data queries.

This caching system stores the last 30 days of NWS Local Storm Reports data in daily GeoJSON files for improved performance. See the main [README.md](README.md) for general project information.

## Directory Structure

```
/
├── api/
│   ├── config.php          # Configuration
│   ├── cache.php           # API endpoint to serve cached data
│   ├── update-cache.php    # Script to update cache (run via cron)
│   └── cleanup-cache.php   # Script to clean up old files (run via cron)
├── data/                   # GeoJSON cache files (one per day)
│   ├── reports-2024-01-15.geojson
│   ├── reports-2024-01-16.geojson
│   └── ...
├── app.js                  # Frontend (updated to use cached API)
└── index.html
```

## Setup

1. **Ensure data directory is writable:**
   ```bash
   chmod 755 data/
   ```

2. **Initial cache population:**
   Run the update script to fetch the last 30 days of data:
   ```bash
   php api/update-cache.php --all
   ```

3. **Set up cron jobs:**

   **Update cache after 00 UTC (to get previous day's complete data):**
   ```bash
   5 0 * * * /usr/bin/php /path/to/api/update-cache.php >> /path/to/cache-update.log 2>&1
   ```
   Note: Runs at 00:05 UTC to ensure the previous day's data is complete

   **Cleanup old files daily at 2 AM UTC:**
   ```bash
   0 2 * * * /usr/bin/php /path/to/api/cleanup-cache.php >> /path/to/cache-cleanup.log 2>&1
   ```
   
   Note: Cache maintains 30 days of data (~12 MB, ~13,000 reports)

## How It Works

1. **Cache Update (`update-cache.php`):**
   - Designed to run after 00 UTC via cron
   - Fetches the previous day's complete data from Iowa State Mesonet API
   - Saves to `data/reports-YYYY-MM-DD.geojson`
   - Merges with existing data (avoids duplicates)

2. **Cache Serving (`cache.php`):**
   - API endpoint: `api/cache.php?start=YYYY-MM-DD&end=YYYY-MM-DD`
   - **Real-time queries (last 24 hours):** Fetches directly from source API for current data
   - **Historical queries (2-30 days old):** Serves from cache files
   - Falls back to source API for older dates or missing cache

3. **Cache Cleanup (`cleanup-cache.php`):**
   - Removes files older than 30 days
   - Maintains rolling 30-day window

## Performance

- **Cached queries:** ~50-200ms (database/file read)
- **Source API:** ~500-2000ms (external API call)
- **Improvement:** ~5-10x faster for cached queries

## Testing

1. **Test cache update:**
   ```bash
   php api/update-cache.php
   ```

2. **Test cache cleanup:**
   ```bash
   php api/cleanup-cache.php
   ```

3. **Test API endpoint:**
   ```bash
   curl "http://localhost/api/cache.php?start=2024-01-20&end=2024-01-21"
   ```

## Notes

- Cache files are in GeoJSON format (same as source API)
- One file per day for efficient management
- Automatic cleanup maintains 30-day rolling window
- Storage: ~12 MB for 30 days (~13,000 reports, ~434 reports/day average)
- Frontend automatically uses cache for last 30 days, falls back to source API for older dates
