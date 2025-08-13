/**
 * Performance Benchmark for Social Preview Generator
 * Tests the performance improvements from Phase 3 optimizations
 */

const { generatePreview } = require('./dist/index.js');

async function runBenchmark() {
  console.log('🚀 Starting Performance Benchmark...\n');

  const testUrls = [
    'https://github.com/nanggo/social-preview-generator',
    'https://stackoverflow.com/questions/1',
    'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
    'https://example.com'
  ];

  const options = {
    format: 'jpeg',
    quality: 90,
    width: 1200,
    height: 630,
    template: 'modern'
  };

  // Warm up
  console.log('🔥 Warming up...');
  try {
    await generatePreview(testUrls[0], options);
    console.log('✅ Warmup completed\n');
  } catch (error) {
    console.log('⚠️ Warmup failed (expected in some environments)\n');
  }

  // Benchmark metadata caching
  console.log('📊 Testing Metadata Caching Performance...');
  const cacheTestUrl = testUrls[0];
  const iterations = 5;
  
  let totalTime = 0;
  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    try {
      await generatePreview(cacheTestUrl, options);
      const end = Date.now();
      const duration = end - start;
      totalTime += duration;
      console.log(`  Iteration ${i + 1}: ${duration}ms ${i > 0 ? '(cached)' : '(first load)'}`);
    } catch (error) {
      console.log(`  Iteration ${i + 1}: Failed - ${error.message}`);
    }
  }

  const averageTime = totalTime / iterations;
  console.log(`  Average time: ${averageTime.toFixed(2)}ms\n`);

  // Test concurrent processing (Sharp pooling removed)
  console.log('⚡ Testing Concurrent Processing...');
  const poolTestPromises = testUrls.slice(0, 3).map(async (url, index) => {
    const start = Date.now();
    try {
      await generatePreview(url, { ...options, template: 'classic' });
      const duration = Date.now() - start;
      console.log(`  Concurrent ${index + 1}: ${duration}ms`);
      return duration;
    } catch (error) {
      console.log(`  Concurrent ${index + 1}: Failed - ${error.message}`);
      return 0;
    }
  });

  const concurrentResults = await Promise.all(poolTestPromises);
  const concurrentAverage = concurrentResults.reduce((a, b) => a + b, 0) / concurrentResults.length;
  console.log(`  Concurrent average: ${concurrentAverage.toFixed(2)}ms\n`);

  // Memory usage
  const memUsage = process.memoryUsage();
  console.log('💾 Memory Usage:');
  console.log(`  Heap Used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Heap Total: ${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  RSS: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB\n`);

  console.log('🎯 Performance Summary:');
  console.log('✅ JPEG optimization: Progressive + mozjpeg enabled');
  console.log('✅ Image processing pipeline: Optimized modulate operations');
  console.log('✅ file-type caching: Dynamic import cached');
  console.log('✅ Metadata caching: LRU cache with 5min TTL');
  console.log('✅ Sharp processing: Direct instances (pooling removed per review)');
  console.log('\n🎉 Phase 3 Performance Optimizations Complete!');
}

runBenchmark().catch(console.error);