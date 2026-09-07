const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Exercise the HTTP integration without contacting user-selected remote URLs.
delete process.env.REDIS_URL;
delete process.env.REDIS_HOST;
const library = require('@nanggo/social-preview');
const originalGenerate = library.generatePreviewWithDetails;
const calls = [];
library.generatePreviewWithDetails = async (url, options) => {
  calls.push({ url, options });
  return {
    buffer: Buffer.from('test-jpeg'),
    format: 'jpeg',
    dimensions: { width: options.width ?? 1200, height: options.height ?? 630 },
  };
};
const app = require('./rate-limiting-server');
library.generatePreviewWithDetails = originalGenerate;
let server;
let origin;

before(async () => {
  server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await app.locals.cleanup();
});

test('the example starts against the linked package with Redis disabled by default', async () => {
  const response = await fetch(`${origin}/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.redis, 'not configured');
  assert.equal(body.rateLimiter, 'memory-based');
});

test('nested public width/height options determine both cost and returned dimensions', async () => {
  const options = { width: 2048, height: 1024, quality: 95, template: 'modern', format: 'png' };
  const response = await fetch(`${origin}/api/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.test/article', options }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(calls.at(-1), { url: 'https://example.test/article', options });
  assert.deepEqual(body.preview.metadata, {
    width: 2048,
    height: 1024,
    format: 'jpeg',
    quality: 95,
  });
  assert.equal(Number(response.headers.get('x-ratelimit-cost')), body.cost);
  assert.ok(
    body.cost >
      app.locals.calculateCost({ width: 320, height: 168, quality: 95, template: 'modern' })
  );
});

test('response defaults come from the current details API', async () => {
  const response = await fetch(`${origin}/api/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.test/defaults' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).preview.metadata, {
    width: 1200,
    height: 630,
    format: 'jpeg',
    quality: 90,
  });
});
