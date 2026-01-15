// ============================================================================
// ICON SERVICE - Map marker icon creation
// ============================================================================

/**
 * Create a generic icon based on configuration
 */
export function createIcon(config, fillColor, strokeColor, emoji = null, iconSize) {
    const borderRadius = config.type === "rect" ? "0%" : "50%";
    const emojiHTML = emoji ? `<span style="font-size: 16px;">${emoji}</span>` : '';
    
    return L.divIcon({
        className: 'custom-weather-icon',
        html: `<div style="
            width: ${iconSize}px;
            height: ${iconSize}px;
            background-color: ${fillColor};
            border: 2px solid ${strokeColor};
            border-radius: ${borderRadius};
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
        ">${emojiHTML}</div>`,
        iconSize: [iconSize, iconSize],
        iconAnchor: [iconSize/2, iconSize/2],
        popupAnchor: [0, -iconSize/2]
    });
}

/**
 * Get icon based on report type and magnitude
 */
export function getIconForReport(rtype, magnitude, remark, iconConfig, iconSize, extractWindSpeedFn) {
    const mag = parseFloat(magnitude) || 0;
    const config = iconConfig[rtype];
    
    if (!config) {
        return createIcon({ type: "circle" }, "#1f2937", "#fff", "⚠️", iconSize);
    }
    
    // Special cases with fixed icons
    if (config.fill && !config.thresholds) {
        return createIcon(config, config.fill, config.stroke, config.emoji, iconSize);
    }
    
    // Cases with magnitude-based thresholds
    if (config.thresholds) {
        let magnitudeToUse = mag;
        
        // Extract wind speed from remark for tropical storms
        if (config.extractWindFromRemark) {
            magnitudeToUse = extractWindSpeedFn(remark, mag);
        }
        
        // Find the appropriate threshold
        for (const threshold of config.thresholds) {
            if (magnitudeToUse < threshold.max) {
                return createIcon(config, threshold.fill, threshold.stroke, config.emoji, iconSize);
            }
        }
    }
    
    // Fallback
    return createIcon(config, "#1f2937", "#fff", "⚠️", iconSize);
}
