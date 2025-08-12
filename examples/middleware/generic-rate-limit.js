/**
 * Generic Rate Limiter for Social Preview Generator
 * 
 * Framework-agnostic rate limiting that can be adapted to any HTTP framework.
 * Uses sliding window log with memory storage.
 */

class SlidingWindowRateLimiter {
  constructor(options = {}) {
    this.options = {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 100,
      costFunction: (requestData) => 1,
      keyGenerator: (requestData) => requestData.ip || 'unknown',
      storage: new Map(), // Can be overridden with Redis, etc.
      onLimitReached: (key, requestCount, resetTime) => {
        console.warn(`Rate limit exceeded for ${key}: ${requestCount} requests`);
      },
      ...options
    };

    // Cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanup(), Math.max(this.options.windowMs / 4, 30000));
  }

  /**
   * Check if request should be allowed
   * @param {Object} requestData - Request information (ip, body, headers, etc.)
   * @returns {Promise<Object>} - { allowed: boolean, resetTime: number, remaining: number }
   */
  async checkLimit(requestData) {
    const key = this.options.keyGenerator(requestData);
    const cost = this.options.costFunction(requestData);
    const now = Date.now();
    const windowStart = now - this.options.windowMs;

    // Get existing requests for this key
    let requests = this.options.storage.get(key) || [];
    
    // Remove expired requests
    requests = requests.filter(timestamp => timestamp > windowStart);

    // Calculate current usage
    const currentRequests = requests.reduce((total, entry) => {
      return total + (typeof entry === 'object' ? entry.cost : 1);
    }, 0);

    const maxRequests = typeof this.options.maxRequests === 'function'
      ? this.options.maxRequests(requestData)
      : this.options.maxRequests;

    const allowed = currentRequests + cost <= maxRequests;
    const resetTime = windowStart + this.options.windowMs;
    const remaining = Math.max(0, maxRequests - currentRequests - (allowed ? cost : 0));

    if (allowed) {
      // Add this request to the log
      requests.push({
        timestamp: now,
        cost: cost
      });
      this.options.storage.set(key, requests);
    } else {
      // Rate limit exceeded
      this.options.onLimitReached(key, currentRequests, resetTime);
    }

    return {
      allowed,
      resetTime,
      remaining,
      cost,
      totalRequests: currentRequests + (allowed ? cost : 0),
      limit: maxRequests
    };
  }

  /**
   * Clean up expired entries
   */
  cleanup() {
    const now = Date.now();
    const windowStart = now - this.options.windowMs;

    for (const [key, requests] of this.options.storage.entries()) {
      const validRequests = requests.filter(entry => {
        const timestamp = typeof entry === 'object' ? entry.timestamp : entry;
        return timestamp > windowStart;
      });

      if (validRequests.length === 0) {
        this.options.storage.delete(key);
      } else {
        this.options.storage.set(key, validRequests);
      }
    }
  }

  /**
   * Get current status for a key
   */
  async getStatus(requestData) {
    const key = this.options.keyGenerator(requestData);
    const now = Date.now();
    const windowStart = now - this.options.windowMs;

    const requests = (this.options.storage.get(key) || [])
      .filter(entry => {
        const timestamp = typeof entry === 'object' ? entry.timestamp : entry;
        return timestamp > windowStart;
      });

    const currentRequests = requests.reduce((total, entry) => {
      return total + (typeof entry === 'object' ? entry.cost : 1);
    }, 0);

    const maxRequests = typeof this.options.maxRequests === 'function'
      ? this.options.maxRequests(requestData)
      : this.options.maxRequests;

    return {
      key,
      requests: currentRequests,
      limit: maxRequests,
      remaining: Math.max(0, maxRequests - currentRequests),
      resetTime: windowStart + this.options.windowMs,
      windowMs: this.options.windowMs
    };
  }

  /**
   * Reset limits for a key
   */
  reset(key) {
    if (key) {
      this.options.storage.delete(key);
    } else {
      this.options.storage.clear();
    }
  }

  /**
   * Shutdown cleanup
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

/**
 * Concurrent request limiter
 */
class ConcurrentRequestLimiter {
  constructor(maxConcurrent = 5) {
    this.maxConcurrent = maxConcurrent;
    this.active = new Map(); // key -> Set of request IDs
    this.queues = new Map(); // key -> Array of pending promises
  }

  async acquire(key, requestId = Math.random().toString(36)) {
    return new Promise((resolve, reject) => {
      // Initialize tracking for this key if needed
      if (!this.active.has(key)) {
        this.active.set(key, new Set());
      }

      const activeSet = this.active.get(key);

      if (activeSet.size < this.maxConcurrent) {
        // Can proceed immediately
        activeSet.add(requestId);
        resolve(() => this.release(key, requestId));
      } else {
        // Add to queue
        if (!this.queues.has(key)) {
          this.queues.set(key, []);
        }

        this.queues.get(key).push({
          requestId,
          resolve: (release) => resolve(release),
          reject,
          timestamp: Date.now()
        });
      }
    });
  }

  release(key, requestId) {
    const activeSet = this.active.get(key);
    if (activeSet) {
      activeSet.delete(requestId);
      
      if (activeSet.size === 0) {
        this.active.delete(key);
      }
    }

    // Process queue
    const queue = this.queues.get(key);
    if (queue && queue.length > 0) {
      const next = queue.shift();
      
      if (queue.length === 0) {
        this.queues.delete(key);
      }

      // Add to active set
      const currentActiveSet = this.active.get(key) || new Set();
      currentActiveSet.add(next.requestId);
      this.active.set(key, currentActiveSet);
      
      next.resolve(() => this.release(key, next.requestId));
    }
  }

  getStatus(key) {
    const active = this.active.get(key)?.size || 0;
    const queued = this.queues.get(key)?.length || 0;
    
    return {
      active,
      queued,
      maxConcurrent: this.maxConcurrent
    };
  }
}

/**
 * Combined rate limiter with both request rate and concurrency limits
 */
class CombinedRateLimiter {
  constructor(options = {}) {
    this.rateLimiter = new SlidingWindowRateLimiter({
      windowMs: 15 * 60 * 1000,
      maxRequests: 100,
      costFunction: (requestData) => {
        // Default cost function for image generation
        let cost = 1;
        const options = requestData.body || requestData.query || {};
        
        if (options.dimensions) {
          const pixels = options.dimensions.width * options.dimensions.height;
          cost += Math.floor(pixels / 100000); // +1 per 100k pixels
        }
        
        if (options.effects?.blur) cost += 2;
        if (options.template === 'custom') cost += 3;
        
        return Math.min(cost, 10);
      },
      ...options
    });

    this.concurrencyLimiter = new ConcurrentRequestLimiter(options.maxConcurrent || 5);
    
    this.options = {
      onRateLimitExceeded: (key, status) => {
        console.warn(`Rate limit exceeded for ${key}`, status);
      },
      onConcurrencyLimitExceeded: (key, status) => {
        console.warn(`Concurrency limit exceeded for ${key}`, status);
      },
      requestTimeout: 30000, // 30 seconds
      ...options
    };
  }

  /**
   * Process a request through both rate and concurrency limits
   */
  async processRequest(requestData, handler) {
    const key = this.rateLimiter.options.keyGenerator(requestData);
    
    // Check rate limit first
    const rateStatus = await this.rateLimiter.checkLimit(requestData);
    
    if (!rateStatus.allowed) {
      this.options.onRateLimitExceeded(key, rateStatus);
      const error = new Error('Rate limit exceeded');
      error.code = 'RATE_LIMIT_EXCEEDED';
      error.retryAfter = Math.ceil((rateStatus.resetTime - Date.now()) / 1000);
      error.status = rateStatus;
      throw error;
    }

    // Acquire concurrency slot
    let releaseSlot;
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('Request timeout while waiting for concurrency slot'));
      }, this.options.requestTimeout);
    });

    try {
      releaseSlot = await Promise.race([
        this.concurrencyLimiter.acquire(key),
        timeoutPromise
      ]);
    } catch (error) {
      const concurrencyStatus = this.concurrencyLimiter.getStatus(key);
      this.options.onConcurrencyLimitExceeded(key, concurrencyStatus);
      
      const err = new Error('Concurrency limit exceeded or timeout');
      err.code = 'CONCURRENCY_LIMIT_EXCEEDED';
      err.status = concurrencyStatus;
      throw err;
    }

    // Execute handler with proper cleanup
    try {
      const result = await handler(requestData);
      return {
        success: true,
        result,
        rateStatus,
        concurrencyStatus: this.concurrencyLimiter.getStatus(key)
      };
    } finally {
      if (releaseSlot) {
        releaseSlot();
      }
    }
  }

  /**
   * Get combined status
   */
  async getStatus(requestData) {
    const rateStatus = await this.rateLimiter.getStatus(requestData);
    const concurrencyStatus = this.concurrencyLimiter.getStatus(rateStatus.key);
    
    return {
      rate: rateStatus,
      concurrency: concurrencyStatus
    };
  }

  /**
   * Clean shutdown
   */
  destroy() {
    this.rateLimiter.destroy();
  }
}

module.exports = {
  SlidingWindowRateLimiter,
  ConcurrentRequestLimiter,
  CombinedRateLimiter
};