// Test with Sharp-generated real images
const fs = require('fs');
const { validateImageBuffer } = require('./dist/utils/image-security');

async function testWithSharpImages() {
  console.log('🧪 Testing hybrid validation with Sharp-generated images...\n');
  
  // Load real images
  const jpegBuffer = fs.readFileSync('test-1x1.jpg');
  const pngBuffer = fs.readFileSync('test-1x1.png');
  
  const testCases = [
    {
      name: 'Sharp-generated JPEG (1x1px)',
      buffer: jpegBuffer,
      shouldPass: true
    },
    {
      name: 'Sharp-generated PNG (1x1px)', 
      buffer: pngBuffer,
      shouldPass: true
    },
    {
      name: 'Invalid binary data',
      buffer: Buffer.from([0x00, 0x01, 0x02, 0x03, ...Array(100).fill(0xFF)]),
      shouldPass: false
    },
    {
      name: 'Fake JPEG header (magic bytes only)',
      buffer: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, ...Array(50).fill(0)]),
      shouldPass: false
    },
    {
      name: 'Fake PNG header (magic bytes only)',
      buffer: Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...Array(50).fill(0)]),
      shouldPass: false
    }
  ];

  let passed = 0;
  let failed = 0;

  console.log('📋 Test Details:');
  console.log(`JPEG buffer size: ${jpegBuffer.length} bytes`);
  console.log(`PNG buffer size: ${pngBuffer.length} bytes`);
  console.log();

  for (const testCase of testCases) {
    try {
      await validateImageBuffer(testCase.buffer, false);
      
      if (testCase.shouldPass) {
        console.log(`✅ ${testCase.name}: PASS (correctly accepted)`);
        passed++;
      } else {
        console.log(`❌ ${testCase.name}: FAIL (should have been rejected)`);
        failed++;
      }
    } catch (error) {
      if (!testCase.shouldPass) {
        console.log(`✅ ${testCase.name}: PASS (correctly rejected)`);
        passed++;
      } else {
        console.log(`❌ ${testCase.name}: FAIL (should have been accepted)`);
        console.log(`   Error: ${error.message}`);
        failed++;
      }
    }
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  
  return failed === 0;
}

async function testFileTypeVsFallback() {
  console.log('\n🔍 Testing file-type vs magic bytes behavior...\n');
  
  const jpegBuffer = fs.readFileSync('test-1x1.jpg');
  const fakeJpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, ...Array(50).fill(0)]);
  
  console.log('Real JPEG test (should use file-type):');
  try {
    await validateImageBuffer(jpegBuffer, false);
    console.log('✅ Real JPEG passed validation');
  } catch (error) {
    console.log(`❌ Real JPEG failed: ${error.message}`);
  }
  
  console.log('\\nFake JPEG test (file-type should catch this):');
  try {
    await validateImageBuffer(fakeJpegBuffer, false);
    console.log('❌ Fake JPEG incorrectly passed validation');
  } catch (error) {
    console.log(`✅ Fake JPEG correctly rejected: ${error.message.slice(0, 80)}...`);
  }
}

async function runTests() {
  try {
    const mainTests = await testWithSharpImages();
    await testFileTypeVsFallback();
    
    if (mainTests) {
      console.log('\\n🎉 All hybrid validation tests passed!');
    } else {
      console.log('\\n⚠️  Some tests failed.');
      process.exit(1);
    }
  } catch (error) {
    console.error('Test error:', error);
    process.exit(1);
  } finally {
    // Cleanup test files
    try {
      fs.unlinkSync('test-1x1.jpg');
      fs.unlinkSync('test-1x1.png');
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

runTests();