/**
 * Redis-Backed Distributed Rate Limiter for Social Preview Generator
 * 
 * Provides distributed rate limiting using Redis for multi-instance deployments.
 * Uses Lua scripts for atomic operations to prevent race conditions.
 */

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

// Lua script for atomic sliding window rate limiting with race condition protection
const slidingWindowScript = `
local requestKey = KEYS[1]
local totalKey = KEYS[2]  -- Separate key for total cost counter
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local requestId = ARGV[5]

-- Get expired timestamp for cleanup
local expiredBefore = now - window

-- First, get all current members before any modifications for validation
local currentMembers = redis.call('ZRANGEBYSCORE', requestKey, expiredBefore, '+inf', 'WITHSCORES')

-- Calculate actual total from current valid entries for verification
local actualTotal = 0
for i = 1, #currentMembers, 2 do
    local member = currentMembers[i]
    local member_cost = tonumber(string.match(member, '^%d+:(%d+):'))
    if member_cost then
        actualTotal = actualTotal + member_cost
    end
end

-- Get expired entries that will be removed
local expiredMembers = redis.call('ZRANGEBYSCORE', requestKey, 0, expiredBefore - 0.001)
local expiredCost = 0
for _, member in ipairs(expiredMembers) do
    local member_cost = tonumber(string.match(member, '^%d+:(%d+):'))
    if member_cost then
        expiredCost = expiredCost + member_cost
    end
end

-- Remove expired entries atomically
redis.call('ZREMRANGEBYSCORE', requestKey, 0, expiredBefore - 0.001)

-- Get current total cost counter
local current_total_cost = tonumber(redis.call('GET', totalKey))

-- Validate and recalculate if counter is inconsistent or missing
if current_total_cost == nil or math.abs(current_total_cost - actualTotal) > 0.1 then
    -- Counter is missing or inconsistent - recalculate from actual data
    current_total_cost = actualTotal
    redis.call('SET', totalKey, current_total_cost)
else
    -- Counter exists and is consistent - just subtract expired costs
    if expiredCost > 0 then
        current_total_cost = math.max(0, current_total_cost - expiredCost)
        redis.call('SET', totalKey, current_total_cost)
    end
end

-- Ensure total doesn't go negative (additional safety)
if current_total_cost < 0 then
    current_total_cost = 0
    redis.call('SET', totalKey, 0)
end

-- Check if adding this request would exceed limit
if current_total_cost + cost > limit then
    local oldest = redis.call('ZRANGE', requestKey, 0, 0, 'WITHSCORES')
    local resetTime = now + window
    if next(oldest) then
        resetTime = oldest[2] + window
    end
    
    return {0, current_total_cost, limit - current_total_cost, resetTime}
end

-- Add current request with unique member atomically
redis.call('ZADD', requestKey, now, now .. ':' .. cost .. ':' .. requestId)

-- Update total cost atomically
local new_total = current_total_cost + cost
redis.call('SET', totalKey, new_total)

-- Set expiration for both keys (use higher value to prevent premature expiry)
local expireTime = math.ceil(window / 1000) + 10
redis.call('EXPIRE', requestKey, expireTime)
redis.call('EXPIRE', totalKey, expireTime)

-- Return success with updated counts
return {1, new_total, limit - new_total, now + window}
`;

// Lua script for atomic concurrent request management
const concurrencyScript = `
local activeKey = KEYS[1]
local queueKey = KEYS[2]
local maxConcurrent = tonumber(ARGV[1])
local requestId = ARGV[2]
local now = tonumber(ARGV[3])
local expireSeconds = tonumber(ARGV[4])

-- Get current active count
local activeCount = redis.call('SCARD', activeKey)

if activeCount < maxConcurrent then
    -- Can proceed immediately - add to active set
    redis.call('SADD', activeKey, requestId)
    redis.call('EXPIRE', activeKey, expireSeconds)
    
    -- Get accurate count after adding
    local newActiveCount = redis.call('SCARD', activeKey)
    return {1, newActiveCount, 0}
else
    -- Add to queue only if not already queued (prevent duplicates)
    local addedToQueue = redis.call('ZADD', queueKey, 'NX', now, requestId)
    if addedToQueue == 1 then
        redis.call('EXPIRE', queueKey, expireSeconds)
    end
    
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

-- Remove from active set (idempotent operation)
local removed = redis.call('SREM', activeKey, requestId)

if removed == 1 then
    -- Successfully removed from active set
    -- Now try to promote from queue atomically
    local nextRequest = redis.call('ZPOPMIN', queueKey, 1)
    
    if next(nextRequest) then
        local nextId = nextRequest[1]
        -- Atomic promotion: add to active and verify we're still under limit
        local activeCount = redis.call('SCARD', activeKey)
        
        if activeCount < maxConcurrent then
            redis.call('SADD', activeKey, nextId)
            return {1, nextId}
        else
            -- Race condition: someone else filled the slot
            -- Put back in queue with original score
            local originalScore = nextRequest[2]
            redis.call('ZADD', queueKey, originalScore, nextId)
            return {0, nil}
        end
    end
    
    return {1, nil} -- Successfully released, no queue to process
end

-- Request was not in active set (duplicate release)
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
      concurrencyExpireSeconds: 600, // 10 minutes - should be longer than max expected request time
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
    const requestKey = `${this.options.keyPrefix}window:${key}`;
    const totalKey = `${this.options.keyPrefix}total:${key}`;
    const cost = this.options.costFunction(requestData);
    const now = Date.now();
    const requestId = uuidv4();

    const maxRequests = typeof this.options.maxRequests === 'function'
      ? this.options.maxRequests(requestData)
      : this.options.maxRequests;

    try {
      const result = await this.redis.evalsha(
        this.slidingWindowSHA,
        2,
        requestKey,
        totalKey,
        this.options.windowMs,
        maxRequests,
        cost,
        now,
        requestId
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
      // Fail-closed for security. Re-throw the error to be handled by the middleware.
      throw error;
    }
  }

  /**
   * Acquire concurrency slot
   */
  async acquireConcurrencySlot(requestData, requestId = uuidv4()) {
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
        now,
        this.options.concurrencyExpireSeconds
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
      // Fail-closed for security. Re-throw the error to be handled by the middleware.
      throw error;
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
   * Wait for concurrency slot with timeout (exponential backoff approach)
   * 
   * PRODUCTION NOTE: This exponential backoff approach reduces Redis load compared to
   * constant polling, but is still not optimal for high-concurrency scenarios.
   * For production systems, consider implementing:
   * 1. Redis Pub/Sub: Publish slot release events to waiting clients
   * 2. Blocking commands: Use BLPOP/BRPOP with queue lists for efficient waiting
   * These approaches eliminate polling entirely and provide better scalability.
   */
  async waitForConcurrencySlot(requestData, timeout = 30000) {
    const requestId = uuidv4();
    const startTime = Date.now();
    let originalQueueTimestamp = null;
    
    // Try to acquire immediately
    let slotStatus = await this.acquireConcurrencySlot(requestData, requestId);
    
    if (slotStatus.allowed) {
      return {
        success: true,
        requestId,
        waitTime: 0
      };
    }

    // Store original queue timestamp for fairness during re-queuing
    const key = this.options.keyGenerator(requestData);
    const queueKey = `${this.options.keyPrefix}queue:${key}`;
    originalQueueTimestamp = Date.now();
    
    // Calculate adaptive retry parameters based on queue position
    const initialDelay = Math.min(500, timeout / 20); // Start with smaller delay
    const maxDelay = Math.min(3000, timeout / 4); // Cap delay at 1/4 of timeout
    let currentDelay = initialDelay;
    let retryCount = 0;
    
    try {
      while (Date.now() - startTime < timeout) {
        await new Promise(resolve => setTimeout(resolve, currentDelay));
        
        // Check if we're still in queue (might have been processed by release event)
        const queuePosition = await this.redis.zrank(queueKey, requestId);
        if (queuePosition === null) {
          // No longer in queue - try to acquire directly
          slotStatus = await this.acquireConcurrencySlot(requestData, requestId);
          if (slotStatus.allowed) {
            return {
              success: true,
              requestId,
              waitTime: Date.now() - startTime
            };
          }
          // If not acquired but not in queue, we were skipped due to race condition
          // Re-add to queue with original timestamp to maintain fairness
          if (originalQueueTimestamp) {
            try {
              await this.redis.zadd(queueKey, originalQueueTimestamp, requestId);
              await this.redis.expire(queueKey, this.options.concurrencyExpireSeconds);
            } catch (error) {
              console.warn('Failed to re-queue request after race condition:', error);
            }
          }
        } else {
          // Still in queue - try to acquire again in case slot became available
          slotStatus = await this.acquireConcurrencySlot(requestData, requestId);
          
          if (slotStatus.allowed) {
            return {
              success: true,
              requestId,
              waitTime: Date.now() - startTime
            };
          }
        }
        
        // Adaptive backoff: increase delay but cap it
        currentDelay = Math.min(maxDelay, currentDelay * 1.5);
        retryCount++;
        
        // Safety check to prevent infinite loops
        if (retryCount > 50) {
          break;
        }
      }
    } finally {
      // Always cleanup queued request on exit (timeout or error)
      await this.redis.zrem(queueKey, requestId);
      
      // Check if we were promoted to active set during timeout and clean up if needed
      try {
        const key = this.options.keyGenerator(requestData);
        const activeKey = `${this.options.keyPrefix}active:${key}`;
        const wasPromoted = await this.redis.sismember(activeKey, requestId);
        
        if (wasPromoted) {
          // Release the slot if we were promoted but are timing out
          await this.releaseConcurrencySlot(requestData, requestId);
        }
      } catch (cleanupError) {
        console.warn('Failed to cleanup promoted slot during timeout:', cleanupError);
      }
    }
    
    throw new Error(`Timeout waiting for concurrency slot after ${timeout}ms (${retryCount} retries)`);
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
  
  const middleware = async (req, res, next) => {
    try {
      const requestData = {
        ip: req.ip || req.connection.remoteAddress,
        body: req.body,
        query: req.query,
        headers: req.headers,
        user: req.user // For user-based limits
      };

      // Acquire slot and get rate limiting info
      const { releaseSlot, rateStatus } = await limiter.acquireSlotForRequest(requestData);

      // Add headers for monitoring
      const status = await limiter.getStatus(requestData);
      res.set({
        'X-RateLimit-Limit': status.rate.limit,
        'X-RateLimit-Remaining': status.rate.remaining,
        'X-RateLimit-Reset': Math.ceil(rateStatus.resetTime / 1000),
        'X-Concurrent-Limit': status.concurrency.limit,
        'X-Concurrent-Active': status.concurrency.active,
        'X-Concurrent-Queued': status.concurrency.queued
      });

      // Override res.end to release slot only after response completes
      const originalEnd = res.end;
      let endCalled = false;
      res.end = function(...args) {
        if (!endCalled) {
          endCalled = true;
          // Release the concurrency slot when response actually ends
          releaseSlot().catch(err => {
            console.error('Failed to release concurrency slot:', err);
          });
        }
        return originalEnd.apply(this, args);
      };

      // Continue to next middleware
      next();

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
      
      // Fail-closed for any other errors (security-critical)
      console.error('Rate limiter error:', error);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Could not process request due to a rate limiting system error.'
      });
    }
  };

  // Attach methods to middleware for external access
  middleware.getStatus = (requestData) => limiter.getStatus(requestData);
  middleware.limiter = limiter; // Direct access to limiter instance

  return middleware;
}

module.exports = {
  RedisRateLimiter,
  createRedisRateLimiter,
  slidingWindowScript,
  concurrencyScript,
  releaseScript
};