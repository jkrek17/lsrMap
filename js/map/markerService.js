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
