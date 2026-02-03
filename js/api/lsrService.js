// ============================================================================
// LSR SERVICE - NWS Local Storm Reports API service
// ============================================================================

import { requestManager } from './requestManager.js';
import { cacheService } from '../cache/cacheService.js';
import { errorHandler, ERROR_TYPES } from '../errors/errorHandler.js';
import { formatDateForAPI } from '../utils/formatters.js';

class LSRService {
    constructor(config) {
        this.config = config;
        this.sourceAPIBase = 'https://mesonet.agron.iastate.edu/geojson/lsr.php';
        this.cacheAPIBase = 'api/cache.php';
    }

    /**
     * JSONP implementation with error handling
     */
    jsonp(url, timeout = 30000) {
        return new Promise((resolve, reject) => {
            // Use crypto.getRandomValues() for secure random callback name generation
            const randomArray = new Uint32Array(1);
            crypto.getRandomValues(randomArray);
            const callbackName = 'jsonp_callback_' + randomArray[0];
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
        // 2. End date is within last CACHE_DAYS (matches api/config.php and cache.php)
        // 3. Query does NOT include last 24 hours (cache.php proxies to source anyway)
        const cacheDays = (this.config && this.config.CACHE_DAYS) || 30;
        const cacheCutoff = new Date();
        cacheCutoff.setDate(cacheCutoff.getDate() - cacheDays);
        const shouldUseCache = useCache && endDateTime >= cacheCutoff && !includesLast24Hours;

        // Generate cache key
        const cacheKey = cacheService.generateCacheKey({
            type: 'lsr',
            startString,
            endString,
            useCache: shouldUseCache
        });

        // Check cache first
        const cached = cacheService.get(cacheKey);
        if (cached) {
            cached._cached = true; // Mark as cached
            return cached;
        }

        // Fetch from API
        let data;
        if (shouldUseCache) {
            // Use cached API
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
                
                // Check if server is telling us to use JSONP fallback
                if (data.useJsonp) {
                    errorHandler.log('Cache API recommends JSONP fallback', data.error);
                    return this.fetchFromSourceAPI(startString, endString, cacheKey);
                }
                
                // Check if response has an error but no features
                if (data.error && (!data.features || data.features.length === 0)) {
                    errorHandler.log('Cache API error, using JSONP fallback', data.error);
                    return this.fetchFromSourceAPI(startString, endString, cacheKey);
                }
            } catch (error) {
                // Fallback to source API
                // Silently fall back - this is expected behavior when cache isn't available
                const isPHPError = error.message && error.message.includes('PHP');
                if (!isPHPError) {
                    // Log non-PHP errors for debugging, but don't show to user
                    errorHandler.log('Data fetch failed, using alternative source', error);
                }
                return this.fetchFromSourceAPI(startString, endString, cacheKey);
            }
        } else {
            // Use source API
            return this.fetchFromSourceAPI(startString, endString, cacheKey);
        }

        // Cache successful response
        if (data && data.features) {
            cacheService.set(cacheKey, data, 5 * 60 * 1000); // 5 minute TTL
        }

        return data;
    }

    /**
     * Fetch from source API using JSONP
     */
    async fetchFromSourceAPI(startString, endString, cacheKey) {
        const url = `${this.sourceAPIBase}?sts=${startString}&ets=${endString}&wfos=`;
        
        try {
            const data = await this.jsonp(url, 30000);
            
            // Cache successful response
            if (data && data.features) {
                cacheService.set(cacheKey, data, 5 * 60 * 1000);
            }
            
            return data;
        } catch (error) {
            const handledError = errorHandler.handleError(error, 'Source API fetch');
            throw handledError;
        }
    }
}

export default LSRService;
