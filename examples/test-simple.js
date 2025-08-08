/**
 * Simple test to debug the issue
 */

const { generatePreview } = require('../dist/index.js');
const fs = require('fs').promises;

async function test() {
  try {
    console.log('Testing with a simple URL...');
    
    // Test with a simple URL that should have minimal metadata
    const buffer = await generatePreview('https://example.com', {
      fallback: {
        strategy: 'generate',
        text: 'Test Preview'
      }
    });
    
    await fs.writeFile('test-output.jpg', buffer);
    console.log('✅ Success! Saved to test-output.jpg');
    console.log(`Size: ${(buffer.length / 1024).toFixed(2)} KB`);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
    if (error.details) {
      console.error('Details:', error.details);
    }
  }
}

test();