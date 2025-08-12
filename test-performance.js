// Performance test for hybrid validation
const { validateImageBuffer } = require('./dist/utils/image-security');
const fs = require('fs');

// Create test image
const sharp = require('sharp');

async function createTestImage() {
  return await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r: 255, g: 0, b: 0 }
    }
  }).jpeg({ quality: 80 }).toBuffer();
}

async function performanceTest() {
  console.log('🏃‍♂️ Performance Testing Hybrid Validation...\n');
  
  const testImage = await createTestImage();
  console.log(`Test image size: ${testImage.length} bytes`);
  
  // Warmup
  for (let i = 0; i < 5; i++) {
    try {
      await validateImageBuffer(testImage, false);
    } catch (e) {
      // Ignore errors during warmup
    }
  }
  
  // Performance test
  const iterations = 100;
  const startTime = process.hrtime.bigint();
  
  let successes = 0;
  let failures = 0;
  
  for (let i = 0; i < iterations; i++) {
    try {
      await validateImageBuffer(testImage, false);
      successes++;
    } catch (error) {
      failures++;
    }
  }
  
  const endTime = process.hrtime.bigint();
  const totalTimeMs = Number(endTime - startTime) / 1_000_000; // Convert to milliseconds
  const avgTimeMs = totalTimeMs / iterations;
  
  console.log(`\n📊 Performance Results:`);
  console.log(`Total iterations: ${iterations}`);
  console.log(`Successes: ${successes}`);
  console.log(`Failures: ${failures}`);
  console.log(`Total time: ${totalTimeMs.toFixed(2)}ms`);
  console.log(`Average time per validation: ${avgTimeMs.toFixed(2)}ms`);
  console.log(`Throughput: ${((iterations / totalTimeMs) * 1000).toFixed(0)} validations/second`);
  
  // Memory test
  const memBefore = process.memoryUsage();
  
  // Validate larger image
  const largeImage = await sharp({
    create: {
      width: 1000,
      height: 1000,
      channels: 3,
      background: { r: 0, g: 255, b: 0 }
    }
  }).jpeg({ quality: 90 }).toBuffer();
  
  try {
    await validateImageBuffer(largeImage, false);
    console.log(`\n✅ Large image validation (${largeImage.length} bytes): PASSED`);
  } catch (error) {
    console.log(`\n❌ Large image validation failed: ${error.message}`);
  }
  
  const memAfter = process.memoryUsage();
  
  console.log(`\n💾 Memory Usage:`);
  console.log(`Heap used delta: ${((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024).toFixed(2)}MB`);
  console.log(`RSS delta: ${((memAfter.rss - memBefore.rss) / 1024 / 1024).toFixed(2)}MB`);
  
  // Test fallback specifically
  console.log(`\n🔄 Testing Fallback Behavior:`);
  console.log('In Node.js environment, file-type should work...');
  console.log('(In Jest environment, it would fallback to magic bytes)');
  
  const fallbackTestStart = process.hrtime.bigint();
  try {
    await validateImageBuffer(testImage, false);
    const fallbackTestEnd = process.hrtime.bigint();
    const fallbackTimeMs = Number(fallbackTestEnd - fallbackTestStart) / 1_000_000;
    console.log(`✅ Validation completed in ${fallbackTimeMs.toFixed(2)}ms`);
  } catch (error) {
    console.log(`❌ Validation failed: ${error.message}`);
  }
  
  return {
    avgTimeMs,
    throughput: (iterations / totalTimeMs) * 1000,
    successRate: (successes / iterations) * 100
  };
}

performanceTest()
  .then((results) => {
    console.log(`\n🎯 Final Results:`);
    console.log(`Average validation time: ${results.avgTimeMs.toFixed(2)}ms`);
    console.log(`Throughput: ${results.throughput.toFixed(0)} validations/second`);
    console.log(`Success rate: ${results.successRate.toFixed(1)}%`);
    
    if (results.avgTimeMs < 50 && results.throughput > 20) {
      console.log(`\n🎉 Performance test PASSED! Hybrid validation is efficient.`);
    } else {
      console.log(`\n⚠️  Performance concerns detected. Consider optimization.`);
    }
  })
  .catch(console.error);