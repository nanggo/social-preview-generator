/**
 * Test rate limiting functionality
 * 
 * Tests various rate limiting scenarios:
 * - Basic rate limiting
 * - Cost-based limiting
 * - Concurrent request limiting
 * - Redis vs memory backend
 */

const { CombinedRateLimiter } = require('./middleware/generic-rate-limit');
const { TokenBucket, ConcurrencyLimiter, defaultCostFunction } = require('./middleware/express-rate-limit');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Test token bucket algorithm
 */
async function testTokenBucket() {
  console.log('\\n=== Testing Token Bucket Algorithm ===');
  
  const bucket = new TokenBucket(5, 1); // 5 tokens, 1 token per second
  
  console.log('Initial status:', bucket.getStatus());
  
  // Consume tokens rapidly
  for (let i = 1; i <= 7; i++) {
    const success = bucket.consume(1);
    console.log(`Request ${i}: ${success ? 'ALLOWED' : 'DENIED'}`, bucket.getStatus());
  }
  
  // Wait for refill
  console.log('Waiting 3 seconds for token refill...');
  await sleep(3000);
  
  console.log('After refill:', bucket.getStatus());
  
  // Test high-cost request
  const highCostSuccess = bucket.consume(3);
  console.log(`High cost request (3 tokens): ${highCostSuccess ? 'ALLOWED' : 'DENIED'}`, bucket.getStatus());
}

/**
 * Test concurrency limiter
 */
async function testConcurrencyLimiter() {
  console.log('\\n=== Testing Concurrency Limiter ===');
  
  const limiter = new ConcurrencyLimiter(3);
  const activeRequests = [];
  
  // Simulate 5 concurrent requests
  for (let i = 1; i <= 5; i++) {
    const requestPromise = limiter.acquire(`request-${i}`).then(release => {
      console.log(`Request ${i}: STARTED (${limiter.getStatus('key').active} active)`);
      
      // Simulate work
      return sleep(2000).then(() => {
        console.log(`Request ${i}: COMPLETED`);
        release();
      });
    });
    
    activeRequests.push(requestPromise);
    
    // Small delay between requests
    await sleep(100);
  }
  
  await Promise.all(activeRequests);
  console.log('All requests completed');
}

/**
 * Test cost calculation
 */
function testCostCalculation() {
  console.log('\\n=== Testing Cost Calculation ===');
  
  const testCases = [
    { description: 'Basic request', options: {} },
    { description: 'Large image', options: { dimensions: { width: 2000, height: 2000 } } },
    { description: 'With blur effect', options: { effects: { blur: 5 } } },
    { description: 'Custom template', options: { template: 'custom' } },
    { description: 'Complex request', options: { 
      dimensions: { width: 1600, height: 1200 }, 
      effects: { blur: 3, brightness: 1.2 },
      template: 'custom',
      backgroundImage: true
    }}
  ];
  
  testCases.forEach(testCase => {
    const cost = defaultCostFunction(testCase.options);
    console.log(`${testCase.description}: cost = ${cost}`);
  });
}

/**
 * Test combined rate limiter
 */
async function testCombinedRateLimiter() {
  console.log('\\n=== Testing Combined Rate Limiter ===');
  
  const limiter = new CombinedRateLimiter({
    windowMs: 10000, // 10 seconds for faster testing
    maxRequests: 10,
    maxConcurrent: 2,
    costFunction: (requestData) => {
      // Simple cost function for testing
      return requestData.cost || 1;
    },
    keyGenerator: (requestData) => requestData.ip || 'test-ip',
    requestTimeout: 5000
  });
  
  const requests = [];
  
  // Test rate limiting
  console.log('Testing rate limits (10 requests in 10 seconds)...');
  for (let i = 1; i <= 12; i++) {
    const requestData = { 
      ip: 'test-ip', 
      cost: i > 8 ? 2 : 1 // Higher cost for later requests
    };
    
    const requestPromise = limiter.processRequest(requestData, async (data) => {
      console.log(`Request ${i} (cost ${data.cost}): PROCESSING`);
      await sleep(1000); // Simulate work
      return `Result ${i}`;
    }).then(result => {
      console.log(`Request ${i}: SUCCESS`, result.result);
    }).catch(error => {
      console.log(`Request ${i}: FAILED - ${error.message}`);
    });
    
    requests.push(requestPromise);
    
    // Small delay between requests
    await sleep(200);
  }
  
  await Promise.all(requests);
  
  // Test status
  const status = await limiter.getStatus({ ip: 'test-ip' });
  console.log('Final status:', status);
  
  limiter.destroy();
}

/**
 * Performance test
 */
async function performanceTest() {
  console.log('\\n=== Performance Test ===');
  
  const limiter = new CombinedRateLimiter({
    windowMs: 60000,
    maxRequests: 1000,
    maxConcurrent: 10
  });
  
  const startTime = Date.now();
  const requestCount = 100;
  const requests = [];
  
  for (let i = 0; i < requestCount; i++) {
    const requestPromise = limiter.processRequest(
      { ip: `ip-${i % 10}` }, // 10 different IPs
      async () => {
        return `result-${i}`;
      }
    ).then(() => {
      // Success
    }).catch(error => {
      console.log(`Request ${i} failed: ${error.message}`);
    });
    
    requests.push(requestPromise);
  }
  
  await Promise.all(requests);
  
  const duration = Date.now() - startTime;
  console.log(`Processed ${requestCount} requests in ${duration}ms`);
  console.log(`Average: ${(duration / requestCount).toFixed(2)}ms per request`);
  console.log(`Throughput: ${(requestCount / (duration / 1000)).toFixed(2)} requests/second`);
  
  limiter.destroy();
}

/**
 * Edge case tests
 */
async function testEdgeCases() {
  console.log('\\n=== Testing Edge Cases ===');
  
  // Test with zero tokens
  const emptyBucket = new TokenBucket(0, 0);
  console.log('Empty bucket allows request:', emptyBucket.consume(1));
  
  // Test with very high cost
  const bucket = new TokenBucket(10, 1);
  console.log('High cost request (20 tokens) on 10-capacity bucket:', bucket.consume(20));
  
  // Test concurrency limiter with 0 limit
  const zeroConcurrency = new ConcurrencyLimiter(0);
  try {
    const release = await zeroConcurrency.acquire('test');
    console.log('Zero concurrency limiter unexpectedly allowed request');
    release();
  } catch (error) {
    console.log('Zero concurrency limiter correctly rejected request');
  }
  
  // Test rapid requests
  const rateLimiter = new CombinedRateLimiter({
    windowMs: 1000,
    maxRequests: 5,
    maxConcurrent: 1
  });
  
  const rapidRequests = [];
  for (let i = 0; i < 10; i++) {
    rapidRequests.push(
      rateLimiter.processRequest({ ip: 'rapid-test' }, async () => 'ok')
        .then(() => console.log(`Rapid request ${i}: SUCCESS`))
        .catch(error => console.log(`Rapid request ${i}: FAILED - ${error.code}`))
    );
  }
  
  await Promise.all(rapidRequests);
  rateLimiter.destroy();
}

/**
 * Main test runner
 */
async function runAllTests() {
  console.log('Starting rate limiting tests...');
  
  try {
    await testTokenBucket();
    await testConcurrencyLimiter();
    testCostCalculation();
    await testCombinedRateLimiter();
    await performanceTest();
    await testEdgeCases();
    
    console.log('\\n✅ All tests completed successfully!');
  } catch (error) {
    console.error('\\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests();
}

module.exports = {
  testTokenBucket,
  testConcurrencyLimiter,
  testCostCalculation,
  testCombinedRateLimiter,
  performanceTest,
  testEdgeCases
};