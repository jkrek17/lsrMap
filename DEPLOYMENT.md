# Deployment Guide

## Quick Deployment

Yes! You can drop these files onto your server root and everything will work. Here's what you need to know:

## File Structure

```
your-server-root/
├── index.html          # Main application file
├── playback.html       # Playback & Live page (+ playback.js, playback.css)
├── app.js              # Main JavaScript (ES6 modules)
├── config.js           # Configuration
├── styles.css          # Styles
├── lib/                # Local libraries (MapLibre GL, PMTiles, Protomaps style layers, FontAwesome)
├── basemap/            # Self-hosted basemap (us-core.pmtiles, county GeoJSON, fonts, sprites)
├── tools/basemap/      # Basemap build scripts (not needed on the server)
├── js/                 # JavaScript modules
│   ├── api/
│   ├── cache/
│   ├── errors/
│   ├── map/
│   ├── state/
│   ├── ui/
│   └── utils/
├── api/                # PHP cache API (OPTIONAL)
│   ├── cache.php
│   ├── config.php
│   ├── update-cache.php
│   └── cleanup-cache.php
└── data/               # Cache data directory (OPTIONAL)
    └── reports-*.geojson
```

## Deployment Steps

### Option 1: Simple Static Deployment (No PHP Required)

1. **Upload all files** to your web server's document root (or a subdirectory)
2. **Set file permissions:**
   ```bash
   # On Linux/Mac (before upload)
   chmod +x set-permissions.sh
   ./set-permissions.sh
   
   # Or on the server after upload
   php set-permissions.php
   ```
   Or manually:
   ```bash
   chmod 644 *.html *.js *.css
   chmod 755 js/ api/ js/*/
   ```
3. **Access the application:**
   - If in root: `https://yourdomain.com/index.html` or `https://yourdomain.com/`
   - If in subdirectory: `https://yourdomain.com/subdirectory/index.html`

**That's it!** The application will work perfectly using the source API directly.

### Option 2: With PHP Caching (Optional Performance Boost)

If you want to use server-side caching for better performance:

1. **Upload all files** (same as Option 1)
2. **Ensure PHP is installed** on your server (PHP 7.4+)
3. **Set file permissions:**
   ```bash
   # On the server after upload
   php set-permissions.php --cache
   ```
   Or manually:
   ```bash
   chmod 755 api/
   chmod 777 data/  # Must be writable for cache files
   ```
4. **Configure your web server** to execute PHP files:
   - **Apache**: Usually works automatically if `mod_php` is enabled
   - **Nginx**: Requires PHP-FPM configuration
5. **Set up cron jobs** (see [CACHE-SETUP.md](CACHE-SETUP.md))

## What Works Without PHP

✅ **Everything!** The application is designed to work without PHP:
- Map display
- Data fetching from source API
- All filtering and features
- Export functionality
- Client-side caching (localStorage)

## What Requires PHP

❌ **Only server-side caching** requires PHP:
- Faster responses for queries 2-7 days old
- Reduced load on source API
- Better performance for historical data

**Note:** If PHP isn't configured, the app automatically falls back to the source API. No errors, no problems!

## Server Requirements

### Minimum (Static Files Only)
- Any web server (Apache, Nginx, IIS, etc.)
- Modern browser support
- No server-side requirements

### Recommended (With Caching)
- PHP 7.4 or higher
- Write permissions on `data/` directory
- Cron job capability (for cache updates)

## Path Considerations

### Root Directory Deployment
If deploying to the root directory (`/` or `/public_html/`):
- Everything works as-is
- Access via: `https://yourdomain.com/`

### Subdirectory Deployment
If deploying to a subdirectory (e.g., `/lsr/` or `/weather/`):
- Everything still works as-is
- Access via: `https://yourdomain.com/lsr/`
- All relative paths will work correctly

### No Configuration Changes Needed
- All paths are relative
- No hardcoded URLs
- Works in any directory structure

## Basemap

The map draws its own basemap; no tile server or outside host is involved. It is
OpenStreetMap vector data in [PMTiles](https://docs.protomaps.com/pmtiles/) files that
the browser reads from this site with HTTP range requests, plus Census county lines.

| Tier | File | Size | Detail | In git |
|---|---|---|---|---|
| Core | `basemap/us-core.pmtiles` | 27 MB | States, counties, coastlines, interstates and major roads, cities. Max zoom 7, drawn larger beyond that | Yes |
| Streets (optional) | e.g. `basemap/us-streets.pmtiles` | 8.3 GB (z14) | Every street, building outlines, street names | No |

When `CONFIG.BASEMAP.STREETS_URL` is set and that file answers, the map uses it;
otherwise (unset, missing, or unreachable) it falls back to the core file and logs a
warning in the browser console.

### Server requirements

- **Range requests**: the server must answer `Range:` requests with `206 Partial Content`.
  Apache, nginx, IIS and GitHub Pages do this for static files by default.
- **No compression of `.pmtiles`**: compressing them breaks range requests (the tiles
  inside are already gzipped). The shipped `.htaccess` turns it off on Apache; on other
  servers exclude `.pmtiles` from gzip/brotli.
- Open `test-data.html` on the server: it checks the range request and that MapLibre
  loads, and reports the HTTP status if something is wrong.

### Adding street-level detail

1. On any machine with outbound HTTPS (it downloads from `build.protomaps.com`), install
   the pmtiles CLI (`go install github.com/protomaps/go-pmtiles@latest`, or a binary from
   https://github.com/protomaps/go-pmtiles/releases) and run:
   ```bash
   tools/basemap/build-streets.sh /path/to/us-streets.pmtiles   # MAXZOOM=14 by default
   ```
   Sizes: `MAXZOOM=13` 4.0 GB, `14` 8.3 GB, `15` 18 GB. z14 already shows every street at
   full zoom; z15 mainly adds points of interest and address labels.
2. Copy the file to the web server, e.g. next to the app as `basemap/us-streets.pmtiles`
   (it is in `.gitignore`, so a `git pull` will not touch it).
3. In `config.js` set `STREETS_URL: 'basemap/us-streets.pmtiles'`. A relative URL resolves
   against `index.html`. If the file lives on another host, add that host to `connect-src`
   in the CSP (`index.html` and `.htaccess`) and make sure it sends CORS headers.

The file covers the US states and territories plus a 60 km buffer
(`tools/basemap/region-streets.json`). Refresh it whenever you like; the data changes slowly.

### Rebuilding the core basemap

`tools/basemap/build.sh` re-extracts `basemap/us-core.pmtiles` from the latest Protomaps
build and refreshes the county files, fonts and sprites (`MAXZOOM=8` gives a sharper,
75 MB core). Commit the result. The `@protomaps/basemaps` style version in `lib/` must
match the tile schema (see `lib/VENDORED.md`).

## Public Test Site (GitHub Pages)

`.github/workflows/publish-test-site.yml` publishes a static copy of the app to
the `lsr/` folder of [jkrek17/web](https://github.com/jkrek17/web) on every push to
`main` or the current test branch:

- https://jkrek17.github.io/web/lsr/ — `main`
- https://jkrek17.github.io/web/lsr/next/ — the branch in `NEXT_BRANCH` (the WebGL refactor)

The tab title is prefixed with `[test: main]` or `[test: next]`. `api/` and `data/`
are left out because Pages cannot run PHP (`USE_SERVER_CACHE` is already `false`).

One-time setup: add a repository secret `WEB_TOKEN` (Settings > Secrets and
variables > Actions) holding a fine-grained token scoped to `jkrek17/web` with
Contents: read and write. Until it is set the workflow skips quietly. Run it by
hand from Actions > "Publish test site" > Run workflow.

`jkrek17/web` is rebuilt by `jkrek17/awips-tools`, which keeps `lsr/` through
`KEEP_FOLDERS` in its `site_publish.yml`. If the two publishes ever race and
`lsr/` comes back stale, re-run "Publish test site". Pages caches files for up
to 10 minutes, so hard-refresh after a publish.

## Testing After Deployment

1. **Open the application** in a browser
2. **Check browser console** for any errors
3. **Test data fetching:**
   - Select a date range
   - Click "Fetch Data"
   - Verify markers appear on map
4. **Test PHP (if configured):**
   - Visit: `https://yourdomain.com/api/cache.php?start=2026-01-10&end=2026-01-11`
   - Should return JSON (not PHP code)

## Common Issues

### "PHP cache endpoint not executing"
- **Cause:** PHP not configured or files served as static
- **Solution:** Either configure PHP or ignore (app works without it)

### "Refused to apply style..." or "Refused to execute script..." (MIME type mismatch)
- **Cause:** This is almost always caused by a **403 Forbidden** error. The server blocks access to the .css/.js file and serves an HTML error page instead. The browser expects CSS/JS but gets HTML, causing this error.
- **Solution:** Fix file permissions! Run `php set-permissions.php` on the server or manually set files to 644 and directories to 755.

### Content Security Policy (CSP) Violations
- **Cause:** Browser security feature blocking resources.
- **Solution:** All libraries, fonts and the basemap are served from this site. The `<meta>` CSP in `index.html` (and `.htaccess`) allows only these outside hosts, all for data:
  - `mesonet.agron.iastate.edu` (storm reports, warnings, radar tiles)
  - `api.weather.gov` (Public Information Statements)
  - `mapservices.weather.noaa.gov` (NWS boundary GeoJSON for state / CWA overlays)

  MapLibre also needs `worker-src 'self' blob:` and `img-src ... blob:`. If your web server sends its own stricter `Content-Security-Policy` header, it must include these.

### Map not loading / blank map
- **Cause:** The basemap file is not served with range requests, is compressed, or the browser has no WebGL.
- **Solution:** Open `test-data.html` on the server; it reports what fails. See "Basemap" above.

### CORS errors
- **Cause:** Source API blocking requests
- **Solution:** Usually not an issue, but may need proxy if it occurs

### 404 errors for modules
- **Cause:** Server not serving `.js` files correctly
- **Solution:** Check server MIME types, ensure `.js` files are served

## Security Considerations

1. **File Permissions:**
   - PHP files: `644` (readable, not executable directly)
   - Directories: `755`
   - `data/` directory: `755` or `777` (if using cache)

2. **HTTPS Recommended:**
   - Use HTTPS in production
   - No CDNs are used; every library is served from `lib/`

3. **CORS Headers:**
   - Already configured in `api/cache.php`
   - Adjust if needed for your domain

## Performance Tips

1. **Enable Gzip compression** on your server
2. **Set cache headers** for static assets
3. **Set up PHP caching** if serving many users
4. **Monitor API usage** to avoid rate limits

## Support

If you encounter issues:
1. Check browser console for errors
2. Verify file permissions
3. Test PHP separately if using cache
4. Review server error logs

---

**Bottom Line:** Yes, just drop the files and it works! PHP is completely optional.
