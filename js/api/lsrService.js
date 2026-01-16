// ============================================================================
// LSR SERVICE - NWS Local Storm Reports API service
// ============================================================================

import { requestManager } from './requestManager.js';
import { cacheService } from '../cache/cacheService.js';
import { errorHandler, ERROR_TYPES } from '../errors/errorHandler.js';
import { formatDateForAPI } from '../utils/formatters.js';

// Console logging styles for data fetching feedback
const LOG_STYLES = {
    cache: 'background: #10b981; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
    serverCache: 'background: #3b82f6; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
    api: 'background: #f59e0b; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
    fallback: 'background: #ef4444; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
    info: 'color: #6b7280;',
    count: 'color: #8b5cf6; font-weight: bold;',
    time: 'color: #06b6d4;'
};

class LSRService {
    constructor(config) {
        this.config = config;
        this.sourceAPIBase = 'https://mesonet.agron.iastate.edu/geojson/lsr.php';
        this.cacheAPIBase = 'api/cache.php';
        this.enableLogging = true; // Set to false to disable console output
    }

    /**
     * Log data fetch information to console
     */
    logFetch(source, details = {}) {
        if (!this.enableLogging) return;

        const { features = 0, duration = 0, dateRange = '', reason = '', fallbackFrom = '' } = details;
        
        const sourceLabels = {
            'localStorage': ['📦 LOCALSTORAGE', LOG_STYLES.cache],
            'serverCache': ['🗄️ SERVER CACHE', LOG_STYLES.serverCache],
            'sourceAPI': ['🌐 SOURCE API', LOG_STYLES.api],
            'fallback': ['⚠️ FALLBACK', LOG_STYLES.fallback]
        };

        const [label, style] = sourceLabels[source] || ['❓ UNKNOWN', LOG_STYLES.info];

        console.groupCollapsed(`%c${label}%c ${features} reports ${duration ? `(${duration}ms)` : ''}`, style, LOG_STYLES.count);
        
        if (dateRange) {
            console.log(`%c📅 Date range:%c ${dateRange}`, LOG_STYLES.info, '');
        }
        if (reason) {
            console.log(`%c💡 Reason:%c ${reason}`, LOG_STYLES.info, '');
        }
        if (fallbackFrom) {
            console.log(`%c🔄 Fallback from:%c ${fallbackFrom}`, LOG_STYLES.info, '');
        }
        if (duration) {
            console.log(`%c⏱️ Duration:%c ${duration}ms`, LOG_STYLES.info, LOG_STYLES.time);
        }
        
        console.groupEnd();
    }

    /**
     * JSONP implementation with error handling
     */
    jsonp(url, timeout = 30000) {
        return new Promise((resolve, reject) => {
            const callbackName = 'jsonp_callback_' + Math.round(100000 * Math.random());
            const script = document.createElement('script');
            let timeoutId;

            // Set up timeout
            timeoutId = setTimeout(() => {
                cleanup();
                reject(errorHandler.handleError(
                    new Error('Request timeout'),
                    'JSONP request'
                ));
            }, timeout);

            // Cleanup function
            const cleanup = () => {
                if (window[callbackName]) {
                    delete window[callbackName];
                }
                if (script.parentNode) {
                    document.body.removeChild(script);
                }
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
            };

            // Success callback
            window[callbackName] = (data) => {
                cleanup();
                resolve(data);
            };

            // Error handling
            script.onerror = () => {
                cleanup();
                reject(errorHandler.handleError(
                    new Error('JSONP script load failed'),
                    'JSONP request'
                ));
            };

            // Build URL
            const separator = url.indexOf('?') >= 0 ? '&' : '?';
            script.src = `${url}${separator}callback=${callbackName}`;
            
            document.body.appendChild(script);
        });
    }

    /**
     * Fetch LSR data with caching and retry logic
     */
    async fetchLSRData(params) {
        const {
            startDate,
            startHour,
            endDate,
            endHour,
            useCache = true
        } = params;

        const startTime = performance.now();
        const dateRange = `${startDate} ${startHour} → ${endDate} ${endHour}`;
        const startString = formatDateForAPI(startDate, startHour);
        const endString = formatDateForAPI(endDate, endHour);

        // Determine which API to use
        const endDateTime = new Date(endDate + 'T' + endHour);
        const startDateTime = new Date(startDate + 'T' + startHour);
        const now = new Date();
        
        // Calculate hours difference from start to now
        const hoursDiff = (now.getTime() - startDateTime.getTime()) / (1000 * 60 * 60);
        
        // If query includes last 24 hours, use source API directly for real-time data
        // This matches the cache.php logic and avoids unnecessary cache API calls
        const includesLast24Hours = hoursDiff <= 24 && endDateTime >= new Date(now.getTime() - 24 * 60 * 60 * 1000);
        
        // Use cache API only if:
        // 1. Cache is enabled
        // 2. End date is within last 30 days (matches server cache retention)
        // 3. Query does NOT include last 24 hours (cache.php proxies to source anyway)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const shouldUseCache = useCache && endDateTime >= thirtyDaysAgo && !includesLast24Hours;

        // Determine reason for cache decision
        let cacheDecisionReason = '';
        if (!useCache) {
            cacheDecisionReason = 'Cache disabled by caller';
        } else if (includesLast24Hours) {
            cacheDecisionReason = 'Query includes last 24 hours (real-time data needed)';
        } else if (endDateTime < thirtyDaysAgo) {
            cacheDecisionReason = 'Query older than 30 days (outside cache window)';
        } else if (shouldUseCache) {
            cacheDecisionReason = 'Historical data within 30-day cache window';
        }

        // Generate cache key
        const cacheKey = cacheService.generateCacheKey({
            type: 'lsr',
            startString,
            endString,
            useCache: shouldUseCache
        });

        // Check localStorage cache first
        const cached = cacheService.get(cacheKey);
        if (cached) {
            cached._cached = true;
            const duration = Math.round(performance.now() - startTime);
            this.logFetch('localStorage', {
                features: cached.features?.length || 0,
                duration,
                dateRange,
                reason: 'Found in browser localStorage (5-min TTL)'
            });
            return cached;
        }

        // Fetch from API
        let data;
        if (shouldUseCache) {
            // Use server cache API
            const url = `${this.cacheAPIBase}?start=${startDate}&startHour=${startHour}&end=${endDate}&endHour=${endHour}`;
            
            try {
                const response = await requestManager.fetchWithRetry(url, {
                    headers: { 'Accept': 'application/json' }
                });

                const contentType = response.headers.get('content-type') || '';
                if (contentType.includes('text/html') || contentType.includes('text/plain')) {
                    throw new Error('Cache API returned non-JSON response');
                }

                const text = await response.text();
                
                // Check for PHP execution issues
                if (text.trim().startsWith('<?php')) {
                    throw new Error('PHP cache endpoint not executing');
                }

                data = JSON.parse(text);
                
                const duration = Math.round(performance.now() - startTime);
                this.logFetch('serverCache', {
                    features: data.features?.length || 0,
                    duration,
                    dateRange,
                    reason: cacheDecisionReason
                });
            } catch (error) {
                // Fallback to source API
                const isPHPError = error.message && error.message.includes('PHP');
                if (!isPHPError) {
                    errorHandler.log('Data fetch failed, using alternative source', error);
                }
                return this.fetchFromSourceAPI(startString, endString, cacheKey, {
                    dateRange,
                    fallbackFrom: 'Server cache',
                    fallbackReason: error.message
                });
            }
        } else {
            // Use source API directly
            return this.fetchFromSourceAPI(startString, endString, cacheKey, {
                dateRange,
                reason: cacheDecisionReason
            });
        }

        // Cache successful response in localStorage
        if (data && data.features) {
            cacheService.set(cacheKey, data, 5 * 60 * 1000); // 5 minute TTL
        }

        return data;
    }

    /**
     * Fetch from source API using JSONP
     */
    async fetchFromSourceAPI(startString, endString, cacheKey, logDetails = {}) {
        const url = `${this.sourceAPIBase}?sts=${startString}&ets=${endString}&wfos=`;
        const startTime = performance.now();
        
        try {
            const data = await this.jsonp(url, 30000);
            const duration = Math.round(performance.now() - startTime);
            
            // Log the fetch
            if (logDetails.fallbackFrom) {
                this.logFetch('fallback', {
                    features: data.features?.length || 0,
                    duration,
                    dateRange: logDetails.dateRange,
                    reason: logDetails.fallbackReason || 'Server cache unavailable',
                    fallbackFrom: logDetails.fallbackFrom
                });
            } else {
                this.logFetch('sourceAPI', {
                    features: data.features?.length || 0,
                    duration,
                    dateRange: logDetails.dateRange,
                    reason: logDetails.reason || 'Direct API fetch'
                });
            }
            
            // Cache successful response in localStorage
            if (data && data.features) {
                cacheService.set(cacheKey, data, 5 * 60 * 1000);
            }
            
            return data;
        } catch (error) {
            const handledError = errorHandler.handleError(error, 'Source API fetch');
            console.error('❌ LSR fetch failed:', handledError.message);
            throw handledError;
        }
    }

    /**
     * Enable or disable console logging
     */
    setLogging(enabled) {
        this.enableLogging = enabled;
    }
}

export default LSRService;
