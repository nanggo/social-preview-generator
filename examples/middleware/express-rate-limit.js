/**
 * Express.js Rate Limiting Middleware for Social Preview Generator
 * 
 * Implements token bucket algorithm with concurrent request limiting
 * to prevent DoS attacks on image generation endpoints.
 * 
 * Features:
 * - IP-based rate limiting with token bucket
 * - Concurrent request limiting per IP
 * - Cost-based limiting (complex operations cost more)
 * - Configurable windows and limits
 * - Memory-based storage (use redis-backed-rate-limit.js for distributed systems)
 */

const crypto = require('crypto');

class TokenBucket {
  constructor(capacity, refillRate, refillInterval = 1000) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillRate = refillRate;
    this.refillInterval = refillInterval;
    this.lastRefill = Date.now();
  }

  refill() {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    const tokensToAdd = Math.floor((timePassed / this.refillInterval) * this.refillRate);
    
    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  consume(tokens = 1) {
    this.refill();
    
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    
    return false;
  }

  getStatus() {
    this.refill();
    return {
      tokens: this.tokens,
      capacity: this.capacity,
      nextRefill: this.lastRefill + this.refillInterval
    };
  }
}

class ConcurrencyLimiter {
  constructor(maxConcurrent, maxQueueSize = 100, timeoutMs = 30000) {
    this.maxConcurrent = maxConcurrent;
    this.maxQueueSize = maxQueueSize;
    this.timeoutMs = timeoutMs;
    this.active = new Map(); // IP -> count
    this.queues = new Map(); // IP -> queue of pending requests
  }

  async acquire(key, requestId = crypto.randomUUID()) {
    return new Promise((resolve, reject) => {
      const currentActive = this.active.get(key) || 0;
      
      if (currentActive < this.maxConcurrent) {
        // Can proceed immediately
        this.active.set(key, currentActive + 1);
        resolve(() => this.release(key));
      } else {
        // Check queue size limit
        if (!this.queues.has(key)) {
          this.queues.set(key, []);
        }
        
        const queue = this.queues.get(key);
        if (queue.length >= this.maxQueueSize) {
          reject(new Error(`Queue capacity exceeded (max: ${this.maxQueueSize})`));
          return;
        }
        
        // Add to queue with timeout
        const queueEntry = {
          requestId,
          resolve: (release) => resolve(release),
          reject,
          timestamp: Date.now()
        };

        // Set timeout to remove from queue and reject
        const timeoutHandle = setTimeout(() => {
          this.removeFromQueue(key, requestId);
          reject(new Error(`Concurrency slot acquire timeout after ${this.timeoutMs}ms`));
        }, this.timeoutMs);

        queueEntry.timeoutHandle = timeoutHandle;
        queue.push(queueEntry);
      }
    });
  }

  /**
   * Remove a specific request from the queue (used for timeout cleanup)
   */
  removeFromQueue(key, requestId) {
    const queue = this.queues.get(key);
    if (!queue) return;

    const index = queue.findIndex(entry => entry.requestId === requestId);
    if (index !== -1) {
      const entry = queue[index];
      // Clear timeout handle
      if (entry.timeoutHandle) {
        clearTimeout(entry.timeoutHandle);
      }
      // Remove from queue
      queue.splice(index, 1);
      
      // Clean up empty queue
      if (queue.length === 0) {
        this.queues.delete(key);
      }
    }
  }

  release(key) {
    const currentActive = this.active.get(key) || 0;
    const newActive = Math.max(0, currentActive - 1);
    
    if (newActive === 0) {
      this.active.delete(key);
    } else {
      this.active.set(key, newActive);
    }

    // Process queue
    const queue = this.queues.get(key);
    if (queue && queue.length > 0 && newActive < this.maxConcurrent) {
      const next = queue.shift();
      
      // Clear timeout handle since we're processing this request
      if (next.timeoutHandle) {
        clearTimeout(next.timeoutHandle);
      }
      
      if (queue.length === 0) {
        this.queues.delete(key);
      }
      
      this.active.set(key, newActive + 1);
      next.resolve(() => this.release(key));
    }
  }

  getStatus(key) {
    return {
      active: this.active.get(key) || 0,
      queued: this.queues.get(key)?.length || 0,
      maxConcurrent: this.maxConcurrent
    };
  }

  /**
   * Clean shutdown - clear all timeouts and reject pending requests
   */
  destroy() {
    // Clear all timeout handles and reject pending requests
    for (const [key, queue] of this.queues.entries()) {
      for (const entry of queue) {
        if (entry.timeoutHandle) {
          clearTimeout(entry.timeoutHandle);
        }
        entry.reject(new Error('ConcurrencyLimiter is being destroyed'));
      }
    }
    
    // Clear all data
    this.active.clear();
    this.queues.clear();
  }
}

/**
 * Calculate the computational cost of an image generation request
 */
function defaultCostFunction(options = {}) {
  let cost = 1;
  
  // Higher cost for larger images
  if (options.dimensions) {
    const pixels = options.dimensions.width * options.dimensions.height;
    if (pixels > 1000000) cost += 3; // > 1MP
    else if (pixels > 500000) cost += 2; // > 0.5MP
    else if (pixels > 100000) cost += 1; // > 0.1MP
  }
  
  // Higher cost for image effects
  if (options.effects) {
    if (options.effects.blur > 0) cost += 2;
    if (options.effects.brightness !== undefined && options.effects.brightness !== 1) cost += 1;
    if (options.effects.saturation !== undefined && options.effects.saturation !== 1) cost += 1;
  }
  
  // Higher cost for custom templates or complex operations
  if (options.template === 'custom') cost += 3;
  if (options.backgroundImage) cost += 2; // Background processing
  
  return Math.min(cost, 10); // Cap at 10x base cost
}

/**
 * Create Express.js rate limiting middleware
 */
function createRateLimiter(config = {}) {
  const options = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 100, // per window
    maxConcurrent: 5, // concurrent requests
    costFunction: defaultCostFunction,
    keyGenerator: (req) => req.ip || req.connection.remoteAddress || 'unknown',
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
    onLimitReached: (key, bucket, concurrent) => {
      console.warn(`Rate limit reached for ${key}`, { bucket, concurrent });
    },
    onRequest: (key, cost, bucket, concurrent) => {
      // Default: no logging (can be overridden)
    },
    ...config
  };

  // Storage for token buckets and concurrency limiters
  const buckets = new Map();
  const concurrencyLimiters = new Map();
  
  // Track all active limiters for cleanup
  const activeLimiters = new Set();

  // Cleanup interval to remove expired buckets
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    const expiredKeys = [];
    
    buckets.forEach((bucket, key) => {
      // Remove buckets that haven't been used for 2x the window
      if (now - bucket.lastRefill > options.windowMs * 2) {
        expiredKeys.push(key);
      }
    });
    
    expiredKeys.forEach(key => {
      buckets.delete(key);
      const limiter = concurrencyLimiters.get(key);
      if (limiter) {
        activeLimiters.delete(limiter);
        limiter.destroy();
        concurrencyLimiters.delete(key);
      }
    });
  }, Math.max(options.windowMs, 60000)); // Clean up every minute minimum

  // Cleanup on process exit
  const cleanup = () => {
    clearInterval(cleanupInterval);
    // Destroy all active limiters to clear timeouts and reject pending requests
    activeLimiters.forEach(limiter => limiter.destroy());
    activeLimiters.clear();
    buckets.clear();
    concurrencyLimiters.clear();
  };

  const middleware = async (req, res, next) => {
    const key = typeof options.keyGenerator === 'function' 
      ? options.keyGenerator(req) 
      : options.keyGenerator;

    // Get or create token bucket for this key
    if (!buckets.has(key)) {
      const tokensPerWindow = typeof options.maxRequests === 'function'
        ? options.maxRequests(req)
        : options.maxRequests;
      
      buckets.set(key, new TokenBucket(
        tokensPerWindow,
        tokensPerWindow / (options.windowMs / 1000), // tokens per second
        1000 // refill every second
      ));
    }

    // Get or create concurrency limiter
    if (!concurrencyLimiters.has(key)) {
      const maxConcurrent = typeof options.maxConcurrent === 'function'
        ? options.maxConcurrent(req)
        : options.maxConcurrent;
        
      const limiter = new ConcurrencyLimiter(maxConcurrent);
      concurrencyLimiters.set(key, limiter);
      activeLimiters.add(limiter);
    }

    const bucket = buckets.get(key);
    const concurrencyLimiter = concurrencyLimiters.get(key);

    // Calculate cost for this request
    const cost = options.costFunction(req.body || req.query);

    // Check token bucket
    if (!bucket.consume(cost)) {
      const bucketStatus = bucket.getStatus();
      const concurrentStatus = concurrencyLimiter.getStatus(key);
      
      options.onLimitReached(key, bucketStatus, concurrentStatus);
      
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil((bucketStatus.nextRefill - Date.now()) / 1000),
        limits: {
          requests: {
            remaining: bucketStatus.tokens,
            capacity: bucketStatus.capacity,
            cost: cost,
            resetAt: new Date(bucketStatus.nextRefill).toISOString()
          },
          concurrent: {
            active: concurrentStatus.active,
            queued: concurrentStatus.queued,
            max: concurrentStatus.maxConcurrent
          }
        }
      });
    }

    // Acquire concurrency slot
    let releaseSlot;
    try {
      releaseSlot = await concurrencyLimiter.acquire(key);
    } catch (error) {
      return res.status(503).json({
        error: 'Service temporarily unavailable',
        message: 'Too many concurrent requests. Please try again later.'
      });
    }

    // Add rate limit headers
    const bucketStatus = bucket.getStatus();
    const concurrentStatus = concurrencyLimiter.getStatus(key);
    
    res.set({
      'X-RateLimit-Limit': bucketStatus.capacity,
      'X-RateLimit-Remaining': bucketStatus.tokens,
      'X-RateLimit-Reset': Math.ceil(bucketStatus.nextRefill / 1000),
      'X-RateLimit-Cost': cost,
      'X-Concurrent-Limit': concurrentStatus.maxConcurrent,
      'X-Concurrent-Active': concurrentStatus.active,
      'X-Concurrent-Queued': concurrentStatus.queued
    });

    // Log request if configured
    options.onRequest(key, cost, bucketStatus, concurrentStatus);

    // Override res.end to handle cleanup and logging
    const originalEnd = res.end;
    let endCalled = false;
    
    res.end = function(...args) {
      if (!endCalled) {
        endCalled = true;
        
        // Release concurrency slot
        if (releaseSlot) {
          releaseSlot();
        }

        // Handle skip logic
        const shouldSkip = (res.statusCode >= 200 && res.statusCode < 300 && options.skipSuccessfulRequests) ||
                          (res.statusCode >= 400 && options.skipFailedRequests);

        if (shouldSkip && bucket.tokens < bucket.capacity) {
          // Return tokens if we're skipping this request
          bucket.tokens = Math.min(bucket.capacity, bucket.tokens + cost);
        }
      }
      
      return originalEnd.apply(this, args);
    };

    next();
  };

  // Return both middleware and cleanup function
  // Applications should call cleanup during graceful shutdown
  return { middleware, cleanup };
}

module.exports = {
  createRateLimiter,
  TokenBucket,
  ConcurrencyLimiter,
  defaultCostFunction
};