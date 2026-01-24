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

2. **Initial cache population (e.g. one month of data):**
   From the project root, run:
   ```bash
   php api/update-cache.php --all
   ```
   This fetches the last **30 days** (or `CACHE_DAYS` in `api/config.php`) and writes one GeoJSON file per day under `data/`.

   To fetch an explicit number of days:
   ```bash
   php api/update-cache.php --days 30
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

## Troubleshooting

### "Having to fall back to JSONP" / cache API not used

The app uses the **cache API** (`api/cache.php`) when the query is within the last 30 days and not "last 24h". The cache API either serves from `data/*.geojson` or **proxies** to the Iowa State Mesonet API. If the server **cannot proxy** (no cURL, `allow_url_fopen` off, firewall, SSL issues), `cache.php` returns `useJsonp: true` and the **browser** fetches directly from Mesonet via JSONP.

**To reduce JSONP fallback:**

1. **Populate the cache** so 2–30 day queries are served from files (no proxy):
   ```bash
   php api/update-cache.php --all
   # or: php api/update-cache.php --days 30
   ```

2. **Ensure the server can proxy** when cache files are missing or for "last 24h":
   - **cURL:** `php -r "var_dump(function_exists('curl_init'));"` → should be `true`.
   - **allow_url_fopen:** if cURL is missing, `php -r "var_dump(ini_get('allow_url_fopen'));"` should be `1` or `On`.
   - **Connectivity:** from the server, `curl -sI "https://mesonet.agron.iastate.edu/geojson/lsr.php?sts=202601010000&ets=202601012359&wfos="` should return `200`.

3. **Confirm `api/cache.php` is reachable** from the app (correct path, PHP executed, no 404/500). If the cache API fails, the app falls back to JSONP.

4. **Subdirectory deploy:** If the app lives in e.g. `/lsr/`, the app requests `api/cache.php` relative to the page, so the API must be at `/lsr/api/cache.php`.

### Cache API returns HTML or "PHP not executing"

- Verify the web server runs PHP for `api/*.php` and that the document root (or subdirectory) contains the `api/` folder.
- Check file permissions: `api/` 755, `data/` 755 or 777 if PHP writes cache files there.

## Notes

- Cache files are in GeoJSON format (same as source API)
- One file per day for efficient management
- Automatic cleanup maintains 30-day rolling window
- Storage: ~12 MB for 30 days (~13,000 reports, ~434 reports/day average)
- Frontend automatically uses cache for last 30 days, falls back to source API for older dates
- `update-cache.php` fetches from the Mesonet API via **cURL** (preferred) or **allow_url_fopen**. Ensure at least one is available on the server when running `--all` or `--days N`.
