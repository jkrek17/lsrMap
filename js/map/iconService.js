// ============================================================================
// ICON SERVICE - Map marker icon creation
// ============================================================================

import { isCoastalFlood } from '../utils/formatters.js';

const iconCache = new Map();

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
    const upperTypetext = (typetext || '').toUpperCase();
    const isCoastalFloodReport = ['F', 'E', 'v'].includes(rtype) && isCoastalFlood(typetext, remark);
    const emojiOverride = isCoastalFloodReport ? '🌊' : null;
    
    // Differentiate freezing rain from ice/sleet
    const isFreezingRain = upperTypetext.includes('FREEZING RAIN') ||
        upperTypetext.includes('FREEZING_RAIN') ||
        upperTypetext.includes('FREEZING DRIZZLE') ||
        upperTypetext.includes('FREEZING_DRIZZLE') ||
        upperTypetext.includes('FZRA');
    const borderColor = isFreezingRain ? '#2563eb' : null; // Blue border for freezing rain
    const configToUse = isFreezingRain && config
        ? { ...config, type: 'rect', emoji: '🌧️' }
        : config;
    
    if (!configToUse) {
        const fallbackKey = `unknown|${iconSize}|${borderColor || 'none'}|circle|⚠️`;
        if (iconCache.has(fallbackKey)) {
            return iconCache.get(fallbackKey);
        }
        const fallbackIcon = createIcon({ type: "circle" }, "#1f2937", "#fff", "⚠️", iconSize, borderColor);
        iconCache.set(fallbackKey, fallbackIcon);
        return fallbackIcon;
    }

    const emojiToUse = emojiOverride || configToUse.emoji;
    
    // Special cases with fixed icons
    if (configToUse.fill && !configToUse.thresholds) {
        const fixedKey = [
            rtype || 'unknown',
            iconSize,
            borderColor || 'none',
            configToUse.type,
            configToUse.fill,
            configToUse.stroke,
            emojiToUse || ''
        ].join('|');
        if (iconCache.has(fixedKey)) {
            return iconCache.get(fixedKey);
        }
        const fixedIcon = createIcon(configToUse, configToUse.fill, configToUse.stroke, emojiToUse, iconSize, borderColor);
        iconCache.set(fixedKey, fixedIcon);
        return fixedIcon;
    }
    
    // Cases with magnitude-based thresholds
    if (configToUse.thresholds) {
        let magnitudeToUse = mag;
        
        // Extract wind speed from remark for tropical storms
        if (configToUse.extractWindFromRemark) {
            magnitudeToUse = extractWindSpeedFn(remark, mag);
        }
        
        // Find the appropriate threshold
        for (let i = 0; i < configToUse.thresholds.length; i++) {
            const threshold = configToUse.thresholds[i];
            if (magnitudeToUse < threshold.max) {
                const thresholdKey = [
                    rtype || 'unknown',
                    iconSize,
                    borderColor || 'none',
                    configToUse.type,
                    emojiToUse || '',
                    i,
                    threshold.fill,
                    threshold.stroke
                ].join('|');
                if (iconCache.has(thresholdKey)) {
                    return iconCache.get(thresholdKey);
                }
                const thresholdIcon = createIcon(configToUse, threshold.fill, threshold.stroke, emojiToUse, iconSize, borderColor);
                iconCache.set(thresholdKey, thresholdIcon);
                return thresholdIcon;
            }
        }
    }
    
    // Fallback
    const fallbackKey = [
        rtype || 'unknown',
        iconSize,
        borderColor || 'none',
        configToUse.type,
        'fallback'
    ].join('|');
    if (iconCache.has(fallbackKey)) {
        return iconCache.get(fallbackKey);
    }
    const fallbackIcon = createIcon(configToUse, "#1f2937", "#fff", "⚠️", iconSize, borderColor);
    iconCache.set(fallbackKey, fallbackIcon);
    return fallbackIcon;
}
