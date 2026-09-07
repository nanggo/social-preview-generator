/**
 * Complete example server with rate limiting for Social Preview Generator
 * 
 * Demonstrates different rate limiting strategies:
 * - Basic Express middleware
 * - Redis-backed distributed limiting
 * - Cost-based limiting for different operations
 * - User tier-based limits
 */

const express = require('express');
const Redis = require('ioredis');
const { generatePreviewWithDetails } = require('@nanggo/social-preview');

// Import rate limiters
const { createRateLimiter } = require('./middleware/express-rate-limit');
const { createRedisRateLimiter } = require('./middleware/redis-backed-rate-limit');

const app = express();
app.use(express.json());

// Memory limiting is the default. Set REDIS_URL or REDIS_HOST to opt in.
// If configured Redis becomes unavailable, the Redis middleware fails closed.
let redisClient = null;
if (process.env.REDIS_URL || process.env.REDIS_HOST) {
  const connectionOptions = {
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    lazyConnect: true,
  };
  redisClient = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, connectionOptions)
    : new Redis({
        ...connectionOptions,
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT || 6379),
        password: process.env.REDIS_PASSWORD,
        db: 0,
      });
  redisClient.on('error', () => {
    console.warn('Configured Redis is unavailable; preview requests will fail closed.');
  });
}

/**
 * Cost calculation for different image generation operations
 */
function calculateCost(options = {}) {
  if (!options || typeof options !== 'object') return 1;
  let cost = 1;
  const pixels = (options.width ?? 1200) * (options.height ?? 630);
  if (pixels > 2000000) cost += 5;
  else if (pixels > 1000000) cost += 3;
  else if (pixels > 500000) cost += 2;
  else if (pixels > 100000) cost += 1;

  const template = options.template ?? 'modern';
  if (template === 'modern') cost += 2;
  else if (template === 'classic') cost += 1;
  if ((options.quality ?? 90) > 80) cost += 1;

  return Math.min(cost, 15);
}

/**
 * User tier-based rate limits
 */
function getUserLimits(req) {
  const userTier = req.user?.tier || 'free';
  
  const tierLimits = {
    free: {
      requests: 50,    // 50 requests per 15 minutes
      concurrent: 2,   // 2 concurrent requests
      window: 15 * 60 * 1000
    },
    basic: {
      requests: 200,   // 200 requests per 15 minutes
      concurrent: 5,   // 5 concurrent requests
      window: 15 * 60 * 1000
    },
    premium: {
      requests: 1000,  // 1000 requests per 15 minutes
      concurrent: 10,  // 10 concurrent requests
      window: 15 * 60 * 1000
    },
    enterprise: {
      requests: 5000,  // 5000 requests per 15 minutes
      concurrent: 25,  // 25 concurrent requests
      window: 15 * 60 * 1000
    }
  };
  
  return tierLimits[userTier] || tierLimits.free;
}

/**
 * Create rate limiter based on available infrastructure
 */
function createAppRateLimiter() {
  if (redisClient) {
    console.log('Using Redis-backed distributed rate limiting');
    const middleware = createRedisRateLimiter(redisClient, {
      windowMs: 15 * 60 * 1000,
      maxRequests: (req) => getUserLimits(req).requests,
      maxConcurrent: (req) => getUserLimits(req).concurrent,
      costFunction: (requestData) => calculateCost(requestData.body?.options),
      keyGenerator: (requestData) => {
        // Use user ID if authenticated, otherwise IP
        return requestData.user?.id || requestData.ip;
      },
      onLimitReached: (key, current, limit, resetTime) => {
        console.warn(`Rate limit exceeded for ${key}: ${current}/${limit}, resets at ${new Date(resetTime)}`);
        
        // Optional: Send to monitoring/alerting system
        // metrics.increment('rate_limit.exceeded', { key });
      }
    });
    
    // Redis limiter returns just middleware, so create consistent interface
    return {
      middleware,
      cleanup: () => {
        // Redis cleanup is handled by connection close
        console.log('Redis rate limiter cleanup - connection will be closed separately');
      }
    };
  } else {
    console.log('Using memory-based rate limiting');
    return createRateLimiter({
      windowMs: 15 * 60 * 1000,
      maxRequests: (req) => getUserLimits(req).requests,
      maxConcurrent: (req) => getUserLimits(req).concurrent,
      costFunction: (body) => calculateCost(body?.options),
      keyGenerator: (req) => req.user?.id || req.ip,
      onLimitReached: (key, bucket, concurrent) => {
        console.warn(`Rate limit exceeded for ${key}`, { bucket, concurrent });
      }
    });
  }
}

// Create the rate limiter
const { middleware: rateLimiter, cleanup: cleanupRateLimiter } = createAppRateLimiter();

// Middleware for authentication (mock implementation)
app.use((req, res, next) => {
  // In real implementation, verify JWT token, API key, etc.
  const apiKey = req.headers['x-api-key'];
  
  if (apiKey === 'premium-key-123') {
    req.user = { id: 'user-123', tier: 'premium' };
  } else if (apiKey === 'basic-key-456') {
    req.user = { id: 'user-456', tier: 'basic' };
  } else if (apiKey) {
    req.user = { id: 'unknown', tier: 'free' };
  }
  // No API key = anonymous with IP-based limiting
  
  next();
});

// Apply rate limiting to preview generation endpoints
app.use('/api/preview', rateLimiter);

/**
 * Generate social preview - main endpoint
 */
app.post('/api/preview', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { url, options = {} } = req.body;
    
    if (!url) {
      return res.status(400).json({
        error: 'Missing required parameter: url'
      });
    }
    
    // Validate URL
    try {
      new URL(url);
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid URL format'
      });
    }
    
    console.log(`Generating preview (tier: ${req.user?.tier || 'anonymous'})`);
    
    // Generate preview
    const result = await generatePreviewWithDetails(url, options);
    
    const processingTime = Date.now() - startTime;
    
    res.json({
      success: true,
      url,
      preview: {
        buffer: result.buffer.toString('base64'),
        metadata: {
          width: result.dimensions.width,
          height: result.dimensions.height,
          format: result.format,
          quality: options.quality ?? 90
        }
      },
      processing_time_ms: processingTime,
      cost: calculateCost(options)
    });
    
    console.log(`Preview generated in ${processingTime}ms`);
    
  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    console.error('Preview generation failed:', error);
    
    res.status(error.type === 'VALIDATION_ERROR' ? 400 : 500).json({
      error: 'Preview generation failed',
      message: error.message,
      processing_time_ms: processingTime
    });
  }
});

/**
 * Get rate limit status
 */
app.get('/api/status', async (req, res) => {
  try {
    let status;
    
    if (redisClient && rateLimiter.getStatus) {
      const requestData = {
        ip: req.ip,
        user: req.user,
        body: {},
        query: req.query,
        headers: req.headers
      };
      status = await rateLimiter.getStatus(requestData);
    } else {
      // For memory-based limiter, provide basic status
      const limits = getUserLimits(req);
      status = {
        rate: {
          limit: limits.requests,
          windowMs: limits.window,
          // Can't get current usage from memory limiter without request
          current: 'unknown',
          remaining: 'unknown'
        },
        concurrency: {
          limit: limits.concurrent,
          active: 'unknown',
          queued: 'unknown'
        }
      };
    }
    
    res.json({
      success: true,
      user: {
        id: req.user?.id || req.ip,
        tier: req.user?.tier || 'anonymous'
      },
      limits: status
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get status',
      message: error.message
    });
  }
});

/**
 * Health check endpoint (not rate limited)
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    redis: redisClient?.status === 'ready' ? 'connected' : redisClient ? 'unavailable' : 'not configured',
    rateLimiter: redisClient ? 'redis-backed' : 'memory-based'
  });
});

/**
 * Error handler
 */
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

/**
 * Start server
 */
const PORT = process.env.PORT || 3000;

async function cleanup() {
  cleanupRateLimiter();
  if (redisClient) await redisClient.quit();
}
app.locals.cleanup = cleanup;
app.locals.calculateCost = calculateCost;

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`Social Preview Generator listening on port ${server.address().port}`);
    console.log(`Rate limiting: ${redisClient ? 'Redis-backed' : 'memory-based'}`);
  });
  const shutdown = () => {
    server.close(async () => {
      await cleanup();
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

module.exports = app;