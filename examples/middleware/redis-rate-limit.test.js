const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { RedisRateLimiter } = require('./redis-backed-rate-limit');

function waiter(acquire) {
  const limiter = Object.create(RedisRateLimiter.prototype);
  limiter.acquireConcurrencySlot = acquire;
  limiter.releaseCount = 0;
  limiter.releaseConcurrencySlot = async () => {
    limiter.releaseCount++;
  };
  return limiter;
}

test('a queued success transfers its permit without releasing it', async () => {
  let attempts = 0;
  const limiter = waiter(async () => ({ allowed: ++attempts > 1 }));
  assert.equal((await limiter.waitForConcurrencySlot({}, 200)).success, true);
  assert.equal(attempts, 2);
  assert.equal(limiter.releaseCount, 0);
});

test('an immediate success also transfers its permit', async () => {
  const limiter = waiter(async () => ({ allowed: true }));
  assert.equal((await limiter.waitForConcurrencySlot({}, 200)).success, true);
  assert.equal(limiter.releaseCount, 0);
});

test('a failed first acquisition cleans up a possibly committed permit', async () => {
  const originalError = new Error('reply lost after Redis mutation');
  const limiter = waiter(async () => {
    throw originalError;
  });
  await assert.rejects(limiter.waitForConcurrencySlot({}, 200), (error) => error === originalError);
  assert.equal(limiter.releaseCount, 1);
});

test('a late successful acquisition is released rather than transferred', async () => {
  const limiter = waiter(async () => {
    await delay(30);
    return { allowed: true };
  });
  await assert.rejects(limiter.waitForConcurrencySlot({}, 10), /Timeout waiting/);
  assert.equal(limiter.releaseCount, 1);
});

test('an expired queued wait is cleaned up once', async () => {
  const limiter = waiter(async () => ({ allowed: false }));
  await assert.rejects(limiter.waitForConcurrencySlot({}, 20), /Timeout waiting/);
  assert.equal(limiter.releaseCount, 1);
});
