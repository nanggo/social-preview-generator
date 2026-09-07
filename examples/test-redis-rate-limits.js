const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const Redis = require('ioredis');
const { RedisRateLimiter } = require('./middleware/redis-backed-rate-limit');

if (!process.env.REDIS_URL && !process.env.REDIS_SOCKET) {
  throw new Error('Set REDIS_URL or REDIS_SOCKET to a local test Redis instance.');
}
const redis = process.env.REDIS_SOCKET
  ? new Redis({ path: process.env.REDIS_SOCKET, maxRetriesPerRequest: 1 })
  : new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
const suitePrefix = `spg:test:${randomUUID()}:`;
const request = { ip: 'test-client' };

before(async () => {
  await redis.ping();
});
after(async () => {
  // Delete only this suite's private namespace; never flush a shared database.
  const keys = await redis.keys(`${suitePrefix}*`);
  if (keys.length) await redis.del(...keys);
  await redis.quit();
});

async function createLimiter(maxConcurrent) {
  const limiter = new RedisRateLimiter(redis, {
    keyPrefix: `${suitePrefix}${randomUUID()}:`,
    maxConcurrent,
    concurrencyExpireSeconds: 10,
  });
  await limiter.scriptsReady;
  return limiter;
}

function key(limiter, kind) {
  return `${limiter.options.keyPrefix}${kind}:${request.ip}`;
}

async function waitForQueue(limiter, count) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if ((await redis.zcard(key(limiter, 'queue'))) === count) return;
    await delay(5);
  }
  throw new Error(`Queue did not reach ${count} entries`);
}

test('a promoted waiter with limit one retains its permit and lease until release', async () => {
  const limiter = await createLimiter(1);
  const active = await limiter.waitForConcurrencySlot(request);
  const pending = limiter.waitForConcurrencySlot(request);
  await waitForQueue(limiter, 1);
  await limiter.releaseConcurrencySlot(request, active.requestId);
  const admitted = await pending;

  assert.equal(await redis.sismember(key(limiter, 'active'), admitted.requestId), 1);
  assert.equal(await redis.zcard(key(limiter, 'queue')), 0);
  assert.ok((await redis.ttl(key(limiter, 'active'))) > 0);
  assert.equal((await limiter.acquireConcurrencySlot(request, 'next')).allowed, false);
  await limiter.releaseConcurrencySlot(request, 'next');
  await limiter.releaseConcurrencySlot(request, admitted.requestId);
  assert.equal(await redis.scard(key(limiter, 'active')), 0);
});

test('queued handlers remain counted when multiple slots become available', async () => {
  const limiter = await createLimiter(2);
  const first = await limiter.waitForConcurrencySlot(request);
  const second = await limiter.waitForConcurrencySlot(request);
  const pending = limiter.waitForConcurrencySlot(request);
  await waitForQueue(limiter, 1);
  await limiter.releaseConcurrencySlot(request, first.requestId);
  await limiter.releaseConcurrencySlot(request, second.requestId);
  const queued = await pending;

  assert.equal(await redis.sismember(key(limiter, 'active'), queued.requestId), 1);
  assert.equal((await limiter.acquireConcurrencySlot(request, 'fresh-one')).allowed, true);
  assert.equal((await limiter.acquireConcurrencySlot(request, 'fresh-two')).allowed, false);
  assert.equal(await redis.scard(key(limiter, 'active')), 2);
});

test('timeout removes a queued ID without releasing another handler', async () => {
  const limiter = await createLimiter(1);
  const active = await limiter.waitForConcurrencySlot(request);
  await assert.rejects(limiter.waitForConcurrencySlot(request, 30), /Timeout waiting/);
  assert.equal(await redis.zcard(key(limiter, 'queue')), 0);
  assert.equal(await redis.sismember(key(limiter, 'active'), active.requestId), 1);
});

test('a late promotion is released when acquisition exceeds the wait deadline', async () => {
  const limiter = await createLimiter(1);
  const acquire = limiter.acquireConcurrencySlot.bind(limiter);
  limiter.acquireConcurrencySlot = async (...args) => {
    const result = await acquire(...args);
    await delay(30);
    return result;
  };
  await assert.rejects(limiter.waitForConcurrencySlot(request, 10), /Timeout waiting/);
  assert.equal(await redis.scard(key(limiter, 'active')), 0);
  assert.equal(await redis.zcard(key(limiter, 'queue')), 0);
});

test('duplicate release does not promote additional waiters or the releasing ID', async () => {
  const limiter = await createLimiter(1);
  await limiter.acquireConcurrencySlot(request, 'active');
  await limiter.acquireConcurrencySlot(request, 'first');
  await delay(2);
  await limiter.acquireConcurrencySlot(request, 'second');
  await limiter.releaseConcurrencySlot(request, 'active');
  await limiter.releaseConcurrencySlot(request, 'active');
  assert.deepEqual(await redis.smembers(key(limiter, 'active')), ['first']);
  assert.equal((await limiter.acquireConcurrencySlot(request, 'first')).allowed, true);
  assert.equal(await redis.zscore(key(limiter, 'queue'), 'first'), null);
  await limiter.releaseConcurrencySlot(request, 'first');
  assert.deepEqual(await redis.smembers(key(limiter, 'active')), ['second']);
});

test('contended handlers never exceed the configured concurrency', async () => {
  const limiter = await createLimiter(2);
  let active = 0;
  let peak = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      const permit = await limiter.acquireSlotForRequest(request);
      active++;
      peak = Math.max(peak, active);
      try {
        await delay(20);
      } finally {
        active--;
        await permit.releaseSlot();
      }
    })
  );
  assert.equal(peak, 2);
  assert.equal(active, 0);
  assert.equal(await redis.scard(key(limiter, 'active')), 0);
  assert.equal(await redis.zcard(key(limiter, 'queue')), 0);
});
