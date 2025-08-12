/**
 * Redis-Backed Distributed Rate Limiter for Social Preview Generator
 * 
 * Provides distributed rate limiting using Redis for multi-instance deployments.
 * Uses Lua scripts for atomic operations to prevent race conditions.
 */

// Lua script for atomic sliding window rate limiting
const slidingWindowScript = `
local key = KEYS[1]
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local now = tonumber(ARGV[4])

-- Remove expired entries
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

-- Count current requests
local current = redis.call('ZCARD', key)

-- Check if adding this request would exceed limit
if current + cost > limit then
    -- Get the reset time (oldest entry + window)
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local resetTime = now + window
    if next(oldest) then
        resetTime = oldest[2] + window
    end
    
    return {0, current, limit - current, resetTime}
end

-- Add current request
redis.call('ZADD', key, now, now .. ':' .. cost)

-- Set expiration
redis.call('EXPIRE', key, math.ceil(window / 1000))

-- Return success with updated counts
return {1, current + cost, limit - current - cost, now + window}
`;

// Lua script for atomic concurrent request management
const concurrencyScript = `
local activeKey = KEYS[1]
local queueKey = KEYS[2]
local maxConcurrent = tonumber(ARGV[1])
local requestId = ARGV[2]
local now = tonumber(ARGV[3])

-- Get current active count
local activeCount = redis.call('SCARD', activeKey)

if activeCount < maxConcurrent then
    -- Can proceed immediately
    redis.call('SADD', activeKey, requestId)
    redis.call('EXPIRE', activeKey, 300) -- 5 minutes
    return {1, activeCount + 1, 0}
else
    -- Add to queue
    redis.call('ZADD', queueKey, now, requestId)
    redis.call('EXPIRE', queueKey, 300) -- 5 minutes
    local queueLength = redis.call('ZCARD', queueKey)
    return {0, activeCount, queueLength}
end
`;

// Lua script for releasing concurrent request slot
const releaseScript = `
local activeKey = KEYS[1]
local queueKey = KEYS[2]
local requestId = ARGV[1]
local maxConcurrent = tonumber(ARGV[2])

-- Remove from active set
local removed = redis.call('SREM', activeKey, requestId)

if removed == 1 then
    -- Check if we can promote from queue
    local nextRequest = redis.call('ZPOPMIN', queueKey)
    if next(nextRequest) then
        local nextId = nextRequest[1]
        redis.call('SADD', activeKey, nextId)
        return {1, nextId}
    end
end

return {0, nil}
`;

class RedisRateLimiter {
  constructor(redisClient, options = {}) {
    this.redis = redisClient;
    this.options = {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 100,
      maxConcurrent: 5,
      keyPrefix: 'spg:rate_limit:',
      costFunction: (requestData) => 1,
      keyGenerator: (requestData) => requestData.ip || 'unknown',
      onLimitReached: (key, current, limit, resetTime) => {
        console.warn(`Rate limit reached for ${key}: ${current}/${limit}, resets at ${new Date(resetTime)}`);
      },
      ...options
    };

    // Load Lua scripts
    this.slidingWindowSHA = null;
    this.concurrencySHA = null;
    this.releaseSHA = null;
    this._loadScripts();
  }

  async _loadScripts() {
    try {
      this.slidingWindowSHA = await this.redis.script('LOAD', slidingWindowScript);
      this.concurrencySHA = await this.redis.script('LOAD', concurrencyScript);
      this.releaseSHA = await this.redis.script('LOAD', releaseScript);
    } catch (error) {
      console.error('Failed to load Redis Lua scripts:', error);
    }
  }

  /**
   * Check and consume rate limit
   */
  async checkRateLimit(requestData) {
    const key = this.options.keyGenerator(requestData);
    const redisKey = `${this.options.keyPrefix}window:${key}`;
    const cost = this.options.costFunction(requestData);
    const now = Date.now();

    const maxRequests = typeof this.options.maxRequests === 'function'
      ? this.options.maxRequests(requestData)
      : this.options.maxRequests;

    try {
      const result = await this.redis.evalsha(
        this.slidingWindowSHA,
        1,
        redisKey,
        this.options.windowMs,
        maxRequests,
        cost,
        now
      );

      const [allowed, current, remaining, resetTime] = result;

      if (!allowed) {
        this.options.onLimitReached(key, current, maxRequests, resetTime);
      }

      return {
        allowed: !!allowed,
        current,
        remaining,
        resetTime,
        limit: maxRequests,
        cost
      };
    } catch (error) {
      console.error('Rate limit check failed:', error);
      // Fail open in case of Redis errors
      return {
        allowed: true,
        current: 0,
        remaining: maxRequests,
        resetTime: now + this.options.windowMs,
        limit: maxRequests,
        cost,
        error: error.message
      };
    }
  }

  /**
   * Acquire concurrency slot
   */
  async acquireConcurrencySlot(requestData, requestId = Math.random().toString(36)) {
    const key = this.options.keyGenerator(requestData);
    const activeKey = `${this.options.keyPrefix}active:${key}`;
    const queueKey = `${this.options.keyPrefix}queue:${key}`;
    const now = Date.now();

    const maxConcurrent = typeof this.options.maxConcurrent === 'function'
      ? this.options.maxConcurrent(requestData)
      : this.options.maxConcurrent;

    try {
      const result = await this.redis.evalsha(
        this.concurrencySHA,
        2,
        activeKey,
        queueKey,
        maxConcurrent,
        requestId,
        now
      );

      const [allowed, activeCount, queueLength] = result;

      return {
        allowed: !!allowed,
        activeCount,
        queueLength,
        maxConcurrent,
        requestId
      };
    } catch (error) {
      console.error('Concurrency slot acquisition failed:', error);
      // Fail open in case of Redis errors
      return {
        allowed: true,
        activeCount: 0,
        queueLength: 0,
        maxConcurrent,
        requestId,
        error: error.message
      };
    }
  }

  /**
   * Release concurrency slot
   */
  async releaseConcurrencySlot(requestData, requestId) {
    const key = this.options.keyGenerator(requestData);
    const activeKey = `${this.options.keyPrefix}active:${key}`;
    const queueKey = `${this.options.keyPrefix}queue:${key}`;

    const maxConcurrent = typeof this.options.maxConcurrent === 'function'
      ? this.options.maxConcurrent(requestData)
      : this.options.maxConcurrent;

    try {
      const result = await this.redis.evalsha(
        this.releaseSHA,
        2,
        activeKey,
        queueKey,
        requestId,
        maxConcurrent
      );

      const [promoted, nextRequestId] = result;
      
      return {
        released: true,
        promoted: !!promoted,
        nextRequestId: nextRequestId || null
      };
    } catch (error) {
      console.error('Concurrency slot release failed:', error);
      return {
        released: false,
        error: error.message
      };
    }
  }

  /**
   * Wait for concurrency slot with timeout
   */
  async waitForConcurrencySlot(requestData, timeout = 30000) {
    const requestId = Math.random().toString(36);
    const startTime = Date.now();
    
    // Try to acquire immediately
    let slotStatus = await this.acquireConcurrencySlot(requestData, requestId);
    
    if (slotStatus.allowed) {
      return {
        success: true,
        requestId,
        waitTime: 0
      };
    }

    // Set up polling for queue promotion
    const pollInterval = Math.min(1000, timeout / 10); // Poll every second or 1/10th of timeout
    const key = this.options.keyGenerator(requestData);
    const activeKey = `${this.options.keyPrefix}active:${key}`;
    
    return new Promise((resolve, reject) => {
      const pollTimer = setInterval(async () => {
        try {
          const now = Date.now();
          
          if (now - startTime >= timeout) {
            clearInterval(pollTimer);
            reject(new Error('Timeout waiting for concurrency slot'));
            return;
          }

          // Check if we've been promoted to active
          const isActive = await this.redis.sismember(activeKey, requestId);
          
          if (isActive) {
            clearInterval(pollTimer);
            resolve({
              success: true,
              requestId,
              waitTime: now - startTime
            });
          }
        } catch (error) {
          clearInterval(pollTimer);
          reject(error);
        }
      }, pollInterval);
    });
  }

  /**
   * Get current status for a key
   */
  async getStatus(requestData) {
    const key = this.options.keyGenerator(requestData);
    const windowKey = `${this.options.keyPrefix}window:${key}`;
    const activeKey = `${this.options.keyPrefix}active:${key}`;
    const queueKey = `${this.options.keyPrefix}queue:${key}`;
    const now = Date.now();

    try {
      const [windowCount, activeCount, queueCount] = await Promise.all([
        this.redis.zcard(windowKey),
        this.redis.scard(activeKey),
        this.redis.zcard(queueKey)
      ]);

      const maxRequests = typeof this.options.maxRequests === 'function'
        ? this.options.maxRequests(requestData)
        : this.options.maxRequests;

      const maxConcurrent = typeof this.options.maxConcurrent === 'function'
        ? this.options.maxConcurrent(requestData)
        : this.options.maxConcurrent;

      return {
        key,
        rate: {
          current: windowCount,
          limit: maxRequests,
          remaining: Math.max(0, maxRequests - windowCount),
          windowMs: this.options.windowMs
        },
        concurrency: {
          active: activeCount,
          queued: queueCount,
          limit: maxConcurrent
        }
      };
    } catch (error) {
      console.error('Status check failed:', error);
      return {
        key,
        error: error.message,
        rate: { current: 0, limit: this.options.maxRequests, remaining: this.options.maxRequests },
        concurrency: { active: 0, queued: 0, limit: this.options.maxConcurrent }
      };
    }
  }

  /**
   * Reset limits for a key
   */
  async reset(requestData) {
    const key = this.options.keyGenerator(requestData);
    const keys = [
      `${this.options.keyPrefix}window:${key}`,
      `${this.options.keyPrefix}active:${key}`,
      `${this.options.keyPrefix}queue:${key}`
    ];

    try {
      await this.redis.del(...keys);
      return { success: true };
    } catch (error) {
      console.error('Reset failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Acquire concurrency slot and return release function for Express middleware
   * This is compatible with Express middleware lifecycle
   */
  async acquireSlotForRequest(requestData) {
    // Check rate limit first
    const rateStatus = await this.checkRateLimit(requestData);
    
    if (!rateStatus.allowed) {
      const error = new Error('Rate limit exceeded');
      error.code = 'RATE_LIMIT_EXCEEDED';
      error.retryAfter = Math.ceil((rateStatus.resetTime - Date.now()) / 1000);
      error.status = rateStatus;
      throw error;
    }

    // Wait for concurrency slot
    let slotInfo;
    try {
      slotInfo = await this.waitForConcurrencySlot(requestData);
    } catch (error) {
      const err = new Error('Concurrency limit exceeded or timeout');
      err.code = 'CONCURRENCY_LIMIT_EXCEEDED';
      err.originalError = error;
      throw err;
    }

    // Return release function for middleware to call on request completion
    const releaseSlot = async () => {
      try {
        await this.releaseConcurrencySlot(requestData, slotInfo.requestId);
      } catch (error) {
        console.error('Error releasing concurrency slot:', error);
      }
    };

    return {
      releaseSlot,
      rateStatus,
      concurrencyStatus: slotInfo
    };
  }

  /**
   * @deprecated Use acquireSlotForRequest instead for Express middleware compatibility
   * Complete request processing with rate and concurrency limiting
   */
  async processRequest(requestData, handler) {
    console.warn('processRequest is deprecated. Use acquireSlotForRequest for Express middleware compatibility.');
    
    const slotInfo = await this.acquireSlotForRequest(requestData);
    
    // Execute handler with proper cleanup
    try {
      const result = await handler(requestData);
      return {
        success: true,
        result,
        rateStatus: slotInfo.rateStatus,
        concurrencyStatus: slotInfo.concurrencyStatus
      };
    } finally {
      // Always release the slot
      await slotInfo.releaseSlot();
    }
  }
}

/**
 * Create Express middleware using Redis-backed rate limiter
 */
function createRedisRateLimiter(redisClient, options = {}) {
  const limiter = new RedisRateLimiter(redisClient, options);
  
  return async (req, res, next) => {
    try {
      const requestData = {
        ip: req.ip || req.connection.remoteAddress,
        body: req.body,
        query: req.query,
        headers: req.headers,
        user: req.user // For user-based limits
      };

      await limiter.processRequest(requestData, async () => {
        // Request is allowed, continue to next middleware
        next();
      });

      // Add headers for monitoring
      const status = await limiter.getStatus(requestData);
      res.set({
        'X-RateLimit-Limit': status.rate.limit,
        'X-RateLimit-Remaining': status.rate.remaining,
        'X-RateLimit-Reset': Math.ceil((Date.now() + options.windowMs) / 1000),
        'X-Concurrent-Limit': status.concurrency.limit,
        'X-Concurrent-Active': status.concurrency.active,
        'X-Concurrent-Queued': status.concurrency.queued
      });

    } catch (error) {
      if (error.code === 'RATE_LIMIT_EXCEEDED') {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: 'Too many requests. Please try again later.',
          retryAfter: error.retryAfter,
          status: error.status
        });
      } else if (error.code === 'CONCURRENCY_LIMIT_EXCEEDED') {
        return res.status(503).json({
          error: 'Service temporarily unavailable',
          message: 'Too many concurrent requests. Please try again later.'
        });
      }
      
      // Unknown error - log and fail open
      console.error('Rate limiter error:', error);
      next();
    }
  };
}

module.exports = {
  RedisRateLimiter,
  createRedisRateLimiter,
  slidingWindowScript,
  concurrencyScript,
  releaseScript
};