// Test hybrid validation in Node.js environment
const { validateImageBuffer } = require('./dist/utils/image-security');

async function testHybridValidation() {
  console.log('🧪 Testing hybrid image validation...\n');
  
  // Test cases with different image formats
  const testCases = [
    {
      name: 'Valid JPEG',
      buffer: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, ...Array(100).fill(0)]),
      shouldPass: true
    },
    {
      name: 'Valid PNG', 
      buffer: Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...Array(100).fill(0)]),
      shouldPass: true
    },
    {
      name: 'Valid GIF',
      buffer: Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...Array(100).fill(0)]),
      shouldPass: true
    },
    {
      name: 'Valid WebP',
      buffer: Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, ...Array(100).fill(0)]),
      shouldPass: true
    },
    {
      name: 'Valid BMP',
      buffer: Buffer.from([0x42, 0x4D, ...Array(100).fill(0)]),
      shouldPass: true
    },
    {
      name: 'Valid TIFF (Intel)',
      buffer: Buffer.from([0x49, 0x49, 0x2A, 0x00, ...Array(100).fill(0)]),
      shouldPass: true
    },
    {
      name: 'Valid TIFF (Motorola)', 
      buffer: Buffer.from([0x4D, 0x4D, 0x00, 0x2A, ...Array(100).fill(0)]),
      shouldPass: true
    },
    {
      name: 'Invalid format',
      buffer: Buffer.from([0x00, 0x01, 0x02, 0x03, ...Array(100).fill(0xFF)]),
      shouldPass: false
    },
    {
      name: 'SVG (should fail - not allowed without allowSvg)',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'),
      shouldPass: false
    }
  ];

  let passed = 0;
  let failed = 0;

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
        console.log(`✅ ${testCase.name}: PASS (correctly rejected - ${error.message.slice(0, 80)}...)`);
        passed++;
      } else {
        console.log(`❌ ${testCase.name}: FAIL (should have been accepted - ${error.message})`);
        failed++;
      }
    }
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log('🎉 All tests passed in Node.js environment!');
  } else {
    console.log('⚠️  Some tests failed. Check implementation.');
    process.exit(1);
  }
}

testHybridValidation().catch(console.error);