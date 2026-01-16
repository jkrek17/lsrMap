# Deployment Guide

## Quick Deployment

Yes! You can drop these files onto your server root and everything will work. Here's what you need to know:

## File Structure

```
your-server-root/
├── index.html          # Main application file
├── app.js              # Main JavaScript (ES6 modules)
├── config.js           # Configuration
├── styles.css          # Styles
├── lib/             # Local libraries (Leaflet, FontAwesome)
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
- **Cause:** Browser security feature blocking external resources (Leaflet, Font Awesome).
- **Solution:** We have added a permissive `<meta>` CSP tag to `index.html`. If errors persist, check if your web server sends a strict `Content-Security-Policy` header that overrides the meta tag. You may need to ask your server admin to allow:
  - `unpkg.com` (Leaflet)
  - `cdnjs.cloudflare.com` (Font Awesome)
  - `*.tile.openstreetmap.org` (Map tiles)

### Map not loading
- **Cause:** Leaflet.js CDN blocked or network issue
- **Solution:** Check browser console, verify CDN access

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
   - Update CDN URLs if needed (currently using `unpkg.com`)

3. **CORS Headers:**
   - Already configured in `api/cache.php`
   - Adjust if needed for your domain

## Performance Tips

1. **Enable Gzip compression** on your server
2. **Set cache headers** for static assets
3. **Use CDN** for Leaflet.js (already configured)
4. **Set up PHP caching** if serving many users
5. **Monitor API usage** to avoid rate limits

## Support

If you encounter issues:
1. Check browser console for errors
2. Verify file permissions
3. Test PHP separately if using cache
4. Review server error logs

---

**Bottom Line:** Yes, just drop the files and it works! PHP is completely optional.
