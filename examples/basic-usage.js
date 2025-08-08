/**
 * Basic usage example for Social Preview Generator
 */

const { generatePreview } = require('../dist/index.js');
const fs = require('fs').promises;
const path = require('path');

async function main() {
  console.log('🚀 Social Preview Generator - Basic Usage Example\n');

  // Test URLs
  const testUrls = [
    'https://github.com',
    'https://www.npmjs.com',
    'https://developer.mozilla.org'
  ];

  // Create output directory
  const outputDir = path.join(__dirname, 'output');
  try {
    await fs.mkdir(outputDir, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }

  for (const url of testUrls) {
    console.log(`📸 Generating preview for: ${url}`);
    
    try {
      // Generate preview with default options
      const imageBuffer = await generatePreview(url);
      
      // Save to file
      const filename = `preview-${url.replace(/[^a-z0-9]/gi, '-')}.jpg`;
      const outputPath = path.join(outputDir, filename);
      await fs.writeFile(outputPath, imageBuffer);
      
      console.log(`✅ Saved to: ${outputPath}`);
      console.log(`   Size: ${(imageBuffer.length / 1024).toFixed(2)} KB\n`);
    } catch (error) {
      console.error(`❌ Failed to generate preview for ${url}:`);
      console.error(`   ${error.message}`);
      console.error(`   Stack: ${error.stack}\n`);
    }
  }

  // Test with custom options
  console.log('📸 Generating preview with custom options...');
  try {
    const customBuffer = await generatePreview('https://example.com', {
      template: 'modern',
      width: 1200,
      height: 630,
      quality: 95,
      colors: {
        background: '#2c3e50',
        accent: '#3498db',
        text: '#ffffff'
      },
      fallback: {
        strategy: 'auto'
      }
    });

    const customPath = path.join(outputDir, 'preview-custom.jpg');
    await fs.writeFile(customPath, customBuffer);
    console.log(`✅ Custom preview saved to: ${customPath}`);
    console.log(`   Size: ${(customBuffer.length / 1024).toFixed(2)} KB`);
  } catch (error) {
    console.error(`❌ Failed to generate custom preview:`);
    console.error(`   ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
  }

  console.log('\n✨ Example completed!');
  console.log(`📁 Check the output directory: ${outputDir}`);
}

// Run the example
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});