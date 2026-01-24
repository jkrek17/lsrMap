// ============================================================================
// REQUEST MANAGER - Request deduplication, cancellation, and retry logic
// ============================================================================

import { errorHandler, ERROR_TYPES } from '../errors/errorHandler.js';

class RequestManager {
    constructor() {
        this.pendingRequests = new Map(); // url -> { abortController, promise }
        this.retryConfig = {
            maxRetries: 3,
            baseDelay: 1000, // 1 second
            maxDelay: 10000 // 10 seconds
        };
    }

    /**
     * Generate request key from parameters
     */
    generateRequestKey(url, options = {}) {
        return `${url}_${JSON.stringify(options)}`;
    }

    /**
     * Exponential backoff delay
     */
    getRetryDelay(attempt) {
        const delay = Math.min(
            this.retryConfig.baseDelay * Math.pow(2, attempt),
            this.retryConfig.maxDelay
        );
        // Add jitter
        return delay + Math.random() * 1000;
    }

    /**
     * Check if request should be retried
     */
    shouldRetry(error, attempt) {
        if (attempt >= this.retryConfig.maxRetries) return false;
        
        // Retry on network errors and timeouts
        if (error.type === ERROR_TYPES.NETWORK || error.type === ERROR_TYPES.TIMEOUT) {
            return true;
        }
        
        // Retry on 5xx server errors
        if (error.originalError && error.originalError.status >= 500) {
            return true;
        }
        
        return false;
    }

    /**
     * Fetch with retry logic
     */
    async fetchWithRetry(url, options = {}, attempt = 0) {
        const abortController = new AbortController();
        const requestKey = this.generateRequestKey(url, options);
        
        // Check for duplicate request
        if (this.pendingRequests.has(requestKey)) {
            const pending = this.pendingRequests.get(requestKey);
            return pending.promise.then(response => response.clone());
        }

        const fetchPromise = (async () => {
            try {
                const response = await fetch(url, {
                    ...options,
                    signal: abortController.signal
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                // Remove from pending on success
                this.pendingRequests.delete(requestKey);
                return response;
            } catch (error) {
                // Handle abort
                if (error.name === 'AbortError') {
                    this.pendingRequests.delete(requestKey);
                    throw error;
                }

                const handledError = errorHandler.handleError(error, `Request attempt ${attempt + 1}`);
                
                // Retry logic
                if (this.shouldRetry(handledError, attempt)) {
                    const delay = this.getRetryDelay(attempt);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return this.fetchWithRetry(url, options, attempt + 1);
                }

                // Remove from pending on final failure
                this.pendingRequests.delete(requestKey);
                throw handledError;
            }
        })();

        // Store request for deduplication
        this.pendingRequests.set(requestKey, {
            abortController,
            promise: fetchPromise
        });

        return fetchPromise.then(response => response.clone());
    }

    /**
     * Cancel pending request
     */
    cancelRequest(url, options = {}) {
        const requestKey = this.generateRequestKey(url, options);
        const pending = this.pendingRequests.get(requestKey);
        
        if (pending) {
            pending.abortController.abort();
            this.pendingRequests.delete(requestKey);
            return true;
        }
        
        return false;
    }

    /**
     * Cancel all pending requests
     */
    cancelAll() {
        this.pendingRequests.forEach(({ abortController }) => {
            abortController.abort();
        });
        this.pendingRequests.clear();
    }

    /**
     * Get pending request count
     */
    getPendingCount() {
        return this.pendingRequests.size;
    }
}

export const requestManager = new RequestManager();
