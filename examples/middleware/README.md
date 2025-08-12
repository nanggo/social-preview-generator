# Rate Limiting Middleware Examples

This directory contains middleware implementations for rate limiting the Social Preview Generator to prevent DoS attacks.

## Available Examples

- `express-rate-limit.js` - Express.js middleware with token bucket algorithm
- `fastify-rate-limit.js` - Fastify plugin implementation  
- `generic-rate-limit.js` - Framework-agnostic rate limiter
- `redis-backed-rate-limit.js` - Redis-backed distributed rate limiting

## Quick Start

### Express.js

```javascript
const express = require('express');
const { createRateLimiter } = require('./middleware/express-rate-limit');
const { generatePreview } = require('social-preview-generator');

const app = express();
const rateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 100, // per IP
  maxConcurrent: 5  // concurrent requests per IP
});

app.use('/api/preview', rateLimiter);

app.post('/api/preview', async (req, res) => {
  try {
    const preview = await generatePreview(req.body.url, req.body.options);
    res.json({ success: true, preview });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `windowMs` | 900000 (15min) | Time window in milliseconds |
| `maxRequests` | 100 | Maximum requests per IP per window |
| `maxConcurrent` | 5 | Maximum concurrent requests per IP |
| `costFunction` | `(options) => 1` | Calculate request cost based on options |
| `skipSuccessfulRequests` | false | Don't count successful requests |
| `skipFailedRequests` | false | Don't count failed requests |
| `keyGenerator` | `(req) => req.ip` | Generate unique identifier for client |

### Cost-Based Rate Limiting

Different image generation operations have different computational costs:

```javascript
const costFunction = (options) => {
  let cost = 1;
  
  // Higher cost for larger images
  if (options.dimensions) {
    const pixels = options.dimensions.width * options.dimensions.height;
    cost += Math.floor(pixels / 100000); // +1 cost per 100k pixels
  }
  
  // Higher cost for effects
  if (options.effects?.blur) cost += 2;
  if (options.effects?.brightness !== 1) cost += 1;
  if (options.effects?.saturation !== 1) cost += 1;
  
  // Higher cost for custom templates
  if (options.template === 'custom') cost += 3;
  
  return Math.min(cost, 10); // Cap at 10x cost
};
```

## Advanced Features

### Priority Queuing

Premium users can bypass rate limits or get higher priority:

```javascript
const rateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: (req) => {
    return req.user?.tier === 'premium' ? 1000 : 100;
  },
  priority: (req) => {
    return req.user?.tier === 'premium' ? 1 : 0;
  }
});
```

### Monitoring and Alerts

```javascript
const rateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 100,
  onLimitReached: (key, hits, resetTime) => {
    console.warn(`Rate limit exceeded for ${key}: ${hits} hits`);
    // Send to monitoring system
    metrics.increment('rate_limit.exceeded', { key });
  },
  onRequest: (key, hits, remaining) => {
    // Track usage patterns
    metrics.histogram('rate_limit.usage', hits, { key });
  }
});
```