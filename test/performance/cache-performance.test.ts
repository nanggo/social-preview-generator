/**
 * Sharp Caching Performance Tests
 * Verifies that the new caching system provides performance benefits
 */

import { generatePreview, getCacheStats, clearAllCaches } from '../../src/index';
import { PreviewOptions } from '../../src/types';
import axios from 'axios';
import ogs from 'open-graph-scraper';
import sharp from 'sharp';

jest.mock('axios');
jest.mock('open-graph-scraper');
jest.mock('sharp');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedOgs = ogs as jest.MockedFunction<typeof ogs>;
const mockedSharp = sharp as jest.MockedFunction<typeof sharp>;

describe('Sharp Caching Performance Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearAllCaches();
    
    // Setup default mocks
    const mockSharpInstance = {
      resize: jest.fn().mockReturnThis(),
      blur: jest.fn().mockReturnThis(),
      modulate: jest.fn().mockReturnThis(),
      composite: jest.fn().mockReturnThis(),
      jpeg: jest.fn().mockReturnThis(),
      png: jest.fn().mockReturnThis(),
      toBuffer: jest.fn().mockResolvedValue(Buffer.from('generated-image')),
    };

    mockedSharp.mockReturnValue(mockSharpInstance as any);
    
    // Setup default axios response
    mockedAxios.get.mockResolvedValue({
      data: `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Test Page</title>
          <meta property="og:title" content="Test OG Title" />
          <meta property="og:description" content="Test description for performance testing with caching system" />
          <meta property="og:siteName" content="Test Site" />
        </head>
        <body></body>
        </html>
      `,
    });

    // Setup default OGS response
    mockedOgs.mockResolvedValue({
      error: false,
      result: {
        ogTitle: 'Test OG Title',
        ogDescription: 'Test description for performance testing with caching system',
        ogSiteName: 'Test Site',
      },
      html: '<html></html>',
      response: {} as any,
    });
  });

  describe('SVG Caching Performance', () => {
    it('should cache SVG overlays for repeated identical content', async () => {
      const url = 'https://example.com';
      const options: PreviewOptions = {
        template: 'modern',
        width: 1200,
        height: 630,
        colors: {
          text: '#ffffff',
          background: '#000000',
        },
      };

      // Generate same preview multiple times
      await generatePreview(url, options);
      await generatePreview(url, options);
      await generatePreview(url, options);

      const stats = getCacheStats();
      
      // Verify SVG cache has entries
      expect(stats.svg.size).toBeGreaterThan(0);
      expect(stats.svg.totalHits).toBeGreaterThan(0);
      
      console.log('SVG Cache Stats:', stats.svg);
    });

    it('should cache canvas backgrounds for repeated dimensions and colors', async () => {
      const options1: PreviewOptions = {
        template: 'modern',
        width: 1200,
        height: 630,
        colors: { background: '#1a1a2e', accent: '#16213e' },
      };

      const options2: PreviewOptions = {
        ...options1,
        template: 'classic', // Different template, same colors and dimensions
      };

      // Generate previews with same dimensions/colors
      await generatePreview('https://example1.com', options1);
      await generatePreview('https://example2.com', options2);

      const stats = getCacheStats();
      
      // Canvas cache should have entries
      expect(stats.canvas.size).toBeGreaterThan(0);
      
      console.log('Canvas Cache Stats:', stats.canvas);
    });

    it('should show cache hit ratio improvement with repeated usage', async () => {
      const baseOptions: PreviewOptions = {
        template: 'modern',
        width: 1200,
        height: 630,
      };

      // Generate multiple previews
      const urls = [
        'https://example1.com',
        'https://example2.com', 
        'https://example3.com',
        'https://example1.com', // Repeat
        'https://example2.com', // Repeat
      ];

      for (const url of urls) {
        await generatePreview(url, baseOptions);
      }

      const finalStats = getCacheStats();
      
      // Should have cache hits from repeated generation
      expect(finalStats.svg.totalHits).toBeGreaterThan(0);
      
      const hitRatio = finalStats.svg.totalHits / (finalStats.svg.size + finalStats.svg.totalHits);
      console.log('Cache Hit Ratio:', hitRatio);
      console.log('Final Cache Stats:', finalStats);
      
      // Expect some level of cache efficiency
      expect(hitRatio).toBeGreaterThan(0);
    });
  });

  describe('Memory Efficiency', () => {
    it('should maintain reasonable cache sizes', async () => {
      // Generate many different previews to test cache size management
      const previews = [];
      for (let i = 0; i < 20; i++) {
        previews.push(generatePreview(`https://example${i}.com`, {
          template: 'modern',
          width: 1200 + (i % 3) * 100, // Vary dimensions slightly
          height: 630 + (i % 2) * 50,
          colors: {
            background: `#${i.toString(16).padStart(6, '0')}`, // Different colors
          },
        }));
      }

      await Promise.all(previews);

      const stats = getCacheStats();
      
      // Cache sizes should be reasonable (not unlimited growth)
      expect(stats.svg.size).toBeLessThan(200); // Max size configured as 200
      expect(stats.canvas.size).toBeLessThan(50); // Max size configured as 50
      expect(stats.metadata.size).toBeLessThan(500); // Max size configured as 500
      
      console.log('Memory efficiency stats:', stats);
    });
  });

  describe('Performance Metrics', () => {
    it('should track cache age and usage patterns', async () => {
      const options: PreviewOptions = {
        template: 'modern',
        width: 1200,
        height: 630,
      };

      // Generate preview
      await generatePreview('https://example.com', options);

      // Wait a bit for age tracking
      await new Promise(resolve => setTimeout(resolve, 10));

      // Generate again (should hit cache)
      await generatePreview('https://example.com', options);

      const stats = getCacheStats();
      
      // Should have age information
      expect(stats.svg.averageAge).toBeGreaterThan(0);
      expect(stats.canvas.averageAge).toBeGreaterThan(0);
      
      console.log('Age tracking stats:', {
        svgAvgAge: stats.svg.averageAge,
        canvasAvgAge: stats.canvas.averageAge,
        metadataAvgAge: stats.metadata.averageAge,
      });
    });
  });
});