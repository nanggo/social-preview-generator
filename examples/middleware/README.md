# Rate Limiting Middleware Examples

These examples support the current `@nanggo/social-preview` API on Node.js 22.13+ (22.x)
or Node.js 24+. Authentication in the example server is deliberately mocked; replace it
before exposing the server to other users.

## Run from this repository

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm --dir examples install --frozen-lockfile
pnpm --dir examples start
```

The examples package links to the repository root. Rebuild the root after editing `src/`.
Memory limiting is the default. Set `REDIS_URL=redis://127.0.0.1:6379` to opt into Redis.
Configured Redis failures reject requests rather than silently resetting quotas in memory.

```sh
curl http://localhost:3000/api/preview \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","options":{"width":1200,"height":630,"template":"modern"}}'
```

## Available implementations

- `express-rate-limit.js`: token bucket and per-key concurrency control.
- `generic-rate-limit.js`: framework-independent sliding-window and concurrency limiters.
- `redis-backed-rate-limit.js`: Redis Lua quota and concurrency operations.

## Express integration

```javascript
const express = require('express');
const { createRateLimiter } = require('./middleware/express-rate-limit');
const { generatePreviewWithDetails } = require('@nanggo/social-preview');

const app = express();
app.use(express.json());
const { middleware, cleanup } = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 100,
  maxConcurrent: 5,
  costFunction: (body) => {
    const options = body.options ?? {};
    const pixels = (options.width ?? 1200) * (options.height ?? 630);
    return Math.min(10, 1 + Math.ceil(pixels / 1_000_000));
  },
});
app.use('/api/preview', middleware);
app.post('/api/preview', async (req, res) => {
  try {
    const preview = await generatePreviewWithDetails(req.body.url, req.body.options);
    res.json({
      buffer: preview.buffer.toString('base64'),
      dimensions: preview.dimensions,
      format: preview.format,
    });
  } catch (error) {
    res.status(error.type === 'VALIDATION_ERROR' ? 400 : 500).json({ error: error.message });
  }
});
const server = app.listen(3000);
process.once('SIGTERM', () => server.close(cleanup));
```

`createRateLimiter` returns `{ middleware, cleanup }`; `createRedisRateLimiter` returns
its middleware function. The Express cost callback receives the request body, while the
Redis callback receives `{ body, query, headers, user, ip }`. Read public preview options
from `body.options` in both cases. Width and height are top-level preview options, not
`options.dimensions`. Query format or effects fields are not part of `PreviewOptions`.

## Limits and lifecycle

`maxRequests` and `maxConcurrent` accept numbers or request callbacks for tier-based limits.
Keys default to the client IP; a real authentication layer can supply a stable user ID.
There is no priority-queue option. Call the memory limiter's `cleanup` during shutdown and
close the Redis connection separately.

A queued Redis waiter owns its permit after successful admission, including when another
request promoted it. Release the permit only after the handler completes. Timeout/error
cleanup removes both queue membership and a concurrently promoted permit atomically.
The Redis active-set lease defaults to 600 seconds; configure it above the maximum handler
duration. These examples do not provide renewable per-request leases or a complete
cancellation policy for disconnected HTTP clients.

## Tests

```sh
pnpm --dir examples test
REDIS_URL=redis://127.0.0.1:6379 pnpm --dir examples run test:redis
```

The first command checks the HTTP adapter without remote URL requests and deterministic
waiter lifecycle cases. The second runs the actual Lua scripts against Redis, using a
unique key prefix and deleting only that test namespace. `REDIS_SOCKET` may be used instead
for a local Unix socket. The old console demonstration is available as `pnpm --dir examples
run demo:limits`; it is not the regression suite.
