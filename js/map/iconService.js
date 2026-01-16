// ============================================================================
// ICON SERVICE - Map marker icon creation
// ============================================================================

/**
 * Create a generic icon based on configuration
 */
export function createIcon(config, fillColor, strokeColor, emoji = null, iconSize, borderColor = null) {
    const borderRadius = config.type === "rect" ? "0%" : "50%";
    const emojiHTML = emoji ? `<span style="font-size: 16px;">${emoji}</span>` : '';
    // Use borderColor if provided, otherwise use strokeColor
    const finalBorderColor = borderColor || strokeColor;
    // If borderColor is provided, use a thicker border (3px) to make it more visible
    const borderWidth = borderColor ? 3 : 2;
    
    return L.divIcon({
        className: 'custom-weather-icon',
        html: `<div style="
            width: ${iconSize}px;
            height: ${iconSize}px;
            background-color: ${fillColor};
            border: ${borderWidth}px solid ${finalBorderColor};
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
export function getIconForReport(rtype, magnitude, remark, iconConfig, iconSize, extractWindSpeedFn, typetext = '') {
    const mag = parseFloat(magnitude) || 0;
    const config = iconConfig[rtype];
    
    // Check if this is freezing rain (differentiate from sleet)
    const isFreezingRain = typetext && typetext.toUpperCase().includes('FREEZING RAIN');
    const borderColor = isFreezingRain ? '#dc2626' : null; // Red border for freezing rain
    
    if (!config) {
        return createIcon({ type: "circle" }, "#1f2937", "#fff", "⚠️", iconSize, borderColor);
    }
    
    // Special cases with fixed icons
    if (config.fill && !config.thresholds) {
        return createIcon(config, config.fill, config.stroke, config.emoji, iconSize, borderColor);
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
                return createIcon(config, threshold.fill, threshold.stroke, config.emoji, iconSize, borderColor);
            }
        }
    }
    
    // Fallback
    return createIcon(config, "#1f2937", "#fff", "⚠️", iconSize, borderColor);
}
