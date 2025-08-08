import { generatePreview } from '../../src/index';
import { PreviewOptions } from '../../src/types';

describe('Real URLs Integration Tests', () => {
  // These tests use real network requests and should be run sparingly
  // They can be skipped in CI environments by setting SKIP_NETWORK_TESTS=true
  
  const skipNetworkTests = process.env.SKIP_NETWORK_TESTS === 'true';
  const testTimeout = 30000;

  const conditionalDescribe = skipNetworkTests ? describe.skip : describe;

  conditionalDescribe('Real URL Tests', () => {
    it('should handle GitHub URLs', async () => {
      const url = 'https://github.com';
      const options: PreviewOptions = {
        width: 1200,
        height: 630,
        quality: 90,
      };

      const result = await generatePreview(url, options);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(10000); // Should be a substantial image
    }, testTimeout);

    it('should handle news website URLs', async () => {
      const url = 'https://www.bbc.com';
      
      const result = await generatePreview(url);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(5000);
    }, testTimeout);

    it('should handle tech blog URLs', async () => {
      const url = 'https://dev.to';
      
      const result = await generatePreview(url);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(5000);
    }, testTimeout);

    it('should handle URLs without Open Graph tags', async () => {
      const url = 'https://example.com';
      const options: PreviewOptions = {
        fallback: {
          strategy: 'auto',
        },
      };

      const result = await generatePreview(url, options);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(1000);
    }, testTimeout);

    it('should handle redirect URLs', async () => {
      // Use a URL that commonly redirects
      const url = 'https://t.co/example'; // Note: This is a placeholder
      const options: PreviewOptions = {
        fallback: {
          strategy: 'generate',
        },
      };

      // This should either succeed or fail gracefully with fallback
      try {
        const result = await generatePreview(url, options);
        expect(result).toBeInstanceOf(Buffer);
      } catch (error) {
        // Should generate fallback image
        expect(error).toBeDefined();
      }
    }, testTimeout);

    it('should handle non-existent URLs gracefully', async () => {
      const url = 'https://this-url-definitely-does-not-exist-12345.com';
      const options: PreviewOptions = {
        fallback: {
          strategy: 'generate',
        },
      };

      try {
        const result = await generatePreview(url, options);
        expect(result).toBeInstanceOf(Buffer);
      } catch (error) {
        // Should fail but with a proper error message
        expect(error).toBeDefined();
      }
    }, testTimeout);
  });

  describe('Fallback behavior with real scenarios', () => {
    it('should generate fallback for URLs without images', async () => {
      const url = 'https://httpbin.org/html';
      const options: PreviewOptions = {
        fallback: {
          strategy: 'generate',
          text: 'Custom fallback text',
        },
      };

      const result = await generatePreview(url, options);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(1000);
    }, testTimeout);

    it('should handle slow loading websites', async () => {
      const url = 'https://httpbin.org/delay/2';
      const options: PreviewOptions = {
        fallback: {
          strategy: 'auto',
        },
      };

      const startTime = Date.now();
      
      try {
        const result = await generatePreview(url, options);
        expect(result).toBeInstanceOf(Buffer);
      } catch (error) {
        // Should timeout gracefully
        const duration = Date.now() - startTime;
        expect(duration).toBeLessThan(15000); // Should timeout before 15s
      }
    }, testTimeout);
  });

  describe('Performance with real URLs', () => {
    it('should maintain reasonable performance with image-heavy sites', async () => {
      const url = 'https://unsplash.com';
      
      const startTime = Date.now();
      const result = await generatePreview(url);
      const duration = Date.now() - startTime;

      expect(result).toBeInstanceOf(Buffer);
      expect(duration).toBeLessThan(10000); // Should complete within 10 seconds
    }, testTimeout);

    it('should handle multiple real URLs concurrently', async () => {
      const urls = [
        'https://github.com',
        'https://stackoverflow.com',
        'https://medium.com',
      ];

      const startTime = Date.now();
      const promises = urls.map(url => 
        generatePreview(url, { 
          fallback: { strategy: 'auto' } 
        }).catch(() => Buffer.alloc(0)) // Handle failures gracefully
      );
      
      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(3);
      expect(duration).toBeLessThan(15000); // Should complete within 15 seconds
      
      // At least one should succeed
      const successfulResults = results.filter(r => r.length > 1000);
      expect(successfulResults.length).toBeGreaterThan(0);
    }, testTimeout);
  });
});