// ============================================================================
// MARKER SERVICE - Marker creation and batch processing
// ============================================================================

import { createPopupContent } from './popupService.js';

/**
 * Add markers in batches for better performance
 */
export function addMarkersInBatches(reports, markersLayer, batchSize, onProgress, onPopupOpen) {
    let index = 0;
    const totalReports = reports.length;
    const progressEl = document.getElementById('loadingProgress');
    const progressFill = document.getElementById('loadingProgressFill');
    const progressText = document.getElementById('loadingProgressText');
    
    // Show progress indicator for large datasets
    if (totalReports > 100 && progressEl) {
        progressEl.style.display = 'block';
    }
    
    function processBatch() {
        const endIndex = Math.min(index + batchSize, reports.length);
        
        for (let i = index; i < endIndex; i++) {
            const report = reports[i];
            let marker = report.marker;
            if (!marker) {
                marker = L.marker([report.lat, report.lon], { icon: report.icon });
                report.marker = marker;
                marker._lsrReport = report;
                marker.bindPopup(() => createPopupContent(report), {
                    maxWidth: 350,
                    className: 'custom-popup'
                });
                if (onPopupOpen) {
                    marker.on('popupopen', () => {
                        onPopupOpen(report);
                    });
                }
            } else if (report.icon) {
                marker.setIcon(report.icon);
            }
            marker.addTo(markersLayer);
        }
        
        index = endIndex;
        
        // Update progress
        if (progressEl && totalReports > 100) {
            const percent = Math.min(100, Math.round((index / totalReports) * 100));
            if (progressFill) progressFill.style.width = `${percent}%`;
            if (progressText) {
                progressText.textContent = `Loading ${index.toLocaleString()} of ${totalReports.toLocaleString()} reports...`;
            }
        }
        
        // Call progress callback if provided
        if (onProgress) {
            onProgress(index, totalReports);
        }
        
        if (index < reports.length) {
            requestAnimationFrame(processBatch);
        } else {
            // Hide progress when done
            if (progressEl) {
                setTimeout(() => {
                    progressEl.style.display = 'none';
                }, 300);
            }
        }
    }
    
    processBatch();
}

/**
 * Null out marker refs after layer.clearLayers() so reused report objects get fresh markers.
 */
export function clearReportMarkerRefs(reports) {
    if (!reports || !reports.length) {
        return;
    }
    for (const r of reports) {
        if (r.marker) {
            r.marker._lsrReport = undefined;
            r.marker = null;
        }
    }
}

/**
 * Pan/zoom refresh: remove markers not in desired list; add batches only for new ones.
 * Assumes report objects are stable across calls (same references when GeoJSON unchanged).
 */
export function syncLsrMarkersIncremental(desiredReports, markersLayer, batchSize, onPopupOpen) {
    const desiredSet = new Set(desiredReports);
    const toRemove = [];
    markersLayer.eachLayer((layer) => {
        const rep = layer._lsrReport;
        if (!rep || !desiredSet.has(rep)) {
            toRemove.push(layer);
        }
    });
    for (const layer of toRemove) {
        const rep = layer._lsrReport;
        markersLayer.removeLayer(layer);
        if (rep && rep.marker === layer) {
            rep.marker = null;
        }
        layer._lsrReport = undefined;
    }

    const toAdd = desiredReports.filter((r) => !r.marker || !markersLayer.hasLayer(r.marker));
    if (toAdd.length > 0) {
        addMarkersInBatches(toAdd, markersLayer, batchSize, null, onPopupOpen);
    }
}
