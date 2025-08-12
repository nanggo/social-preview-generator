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
const { generatePreview } = require('social-preview-generator');

// Import rate limiters
const { createRateLimiter } = require('./middleware/express-rate-limit');
const { createRedisRateLimiter } = require('./middleware/redis-backed-rate-limit');

const app = express();
app.use(express.json());

// Initialize Redis (optional - falls back to memory-based limiting)
let redisClient = null;
try {
  redisClient = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
    db: 0,
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
    lazyConnect: true
  });
  
  redisClient.on('error', (err) => {
    console.warn('Redis connection error, falling back to memory-based rate limiting:', err.message);
    redisClient = null;
  });
} catch (error) {
  console.warn('Redis not available, using memory-based rate limiting:', error.message);
}

/**
 * Cost calculation for different image generation operations
 */
function calculateCost(options = {}) {
  let cost = 1;
  
  // Size-based cost
  if (options.dimensions) {
    const pixels = options.dimensions.width * options.dimensions.height;
    if (pixels > 2000000) cost += 5; // > 2MP
    else if (pixels > 1000000) cost += 3; // > 1MP
    else if (pixels > 500000) cost += 2; // > 0.5MP
    else if (pixels > 100000) cost += 1; // > 0.1MP
  }
  
  // Template-based cost
  if (options.template === 'custom') cost += 4;
  else if (options.template === 'modern') cost += 2;
  else if (options.template === 'classic') cost += 1;
  
  // Effect-based cost
  if (options.effects) {
    if (options.effects.blur > 0) cost += 3;
    if (options.effects.brightness !== 1) cost += 1;
    if (options.effects.saturation !== 1) cost += 1;
  }
  
  // Background image processing
  if (options.backgroundImage) cost += 3;
  
  // Quality settings
  if (options.quality && options.quality > 80) cost += 1;
  
  return Math.min(cost, 15); // Cap at 15x base cost
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
    return createRedisRateLimiter(redisClient, {
      windowMs: 15 * 60 * 1000,
      maxRequests: (req) => getUserLimits(req).requests,
      maxConcurrent: (req) => getUserLimits(req).concurrent,
      costFunction: (requestData) => calculateCost(requestData.body),
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
  } else {
    console.log('Using memory-based rate limiting');
    return createRateLimiter({
      windowMs: 15 * 60 * 1000,
      maxRequests: (req) => getUserLimits(req).requests,
      maxConcurrent: (req) => getUserLimits(req).concurrent,
      costFunction: (options) => calculateCost(options),
      keyGenerator: (req) => req.user?.id || req.ip,
      onLimitReached: (key, bucket, concurrent) => {
        console.warn(`Rate limit exceeded for ${key}`, { bucket, concurrent });
      }
    });
  }
}

// Create the rate limiter
const rateLimiter = createAppRateLimiter();

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
    
    console.log(`Generating preview for ${url} (user: ${req.user?.id || req.ip}, tier: ${req.user?.tier || 'anonymous'})`);
    
    // Generate preview
    const result = await generatePreview(url, options);
    
    const processingTime = Date.now() - startTime;
    
    res.json({
      success: true,
      url,
      preview: {
        buffer: result.toString('base64'),
        metadata: {
          width: options.dimensions?.width || 1200,
          height: options.dimensions?.height || 630,
          format: options.format || 'jpeg',
          quality: options.quality || 80
        }
      },
      processing_time_ms: processingTime,
      cost: calculateCost(options)
    });
    
    console.log(`Preview generated in ${processingTime}ms for ${url}`);
    
  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    console.error('Preview generation failed:', error);
    
    res.status(500).json({
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
    redis: redisClient ? 'connected' : 'not available',
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

app.listen(PORT, () => {
  console.log(`Social Preview Generator server running on port ${PORT}`);
  console.log(`Rate limiting: ${redisClient ? 'Redis-backed (distributed)' : 'Memory-based (single instance)'}`);
  console.log('\\nEndpoints:');
  console.log(`  POST /api/preview - Generate social preview`);
  console.log(`  GET  /api/status  - Get rate limit status`);
  console.log(`  GET  /health     - Health check`);
  console.log('\\nExample usage:');
  console.log(`  curl -X POST http://localhost:${PORT}/api/preview \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -H "X-API-Key: premium-key-123" \\`);
  console.log(`    -d '{"url": "https://example.com", "options": {"template": "modern"}}'`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  
  if (redisClient) {
    await redisClient.quit();
  }
  
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  
  if (redisClient) {
    await redisClient.quit();
  }
  
  process.exit(0);
});

module.exports = app;