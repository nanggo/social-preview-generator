/**
 * Cache Stampede Prevention Tests
 * Tests for in-flight request management to prevent duplicate concurrent requests
 */

import { 
  extractMetadata,
  getInflightRequestStats,
  clearInflightRequests 
} from '../../src/core/metadata-extractor';
import { metadataCache } from '../../src/utils/cache';

// Mock the actual metadata fetching to control timing
jest.mock('../../src/core/metadata-extractor', () => {
  const actual = jest.requireActual('../../src/core/metadata-extractor');
  return {
    ...actual,
    // We'll override extractMetadata in individual tests
  };
});

describe('Cache Stampede Prevention', () => {
  beforeEach(() => {
    // Clear cache and in-flight requests before each test
    metadataCache.clear();
    clearInflightRequests();
  });

  afterEach(() => {
    clearInflightRequests();
  });

  describe('In-flight request management', () => {
    it('should prevent multiple concurrent requests for the same URL', async () => {
      const testUrl = 'https://example.com';
      let callCount = 0;
      
      // Mock a slow metadata extraction
      const originalExtractMetadata = jest.requireActual('../../src/core/metadata-extractor').extractMetadata;
      const mockExtractMetadata = jest.fn().mockImplementation(async (url: string) => {
        callCount++;
        // Simulate slow network request
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          title: 'Test Title',
          url: testUrl,
          domain: 'example.com'
        };
      });

      // Replace the function temporarily
      const metadataExtractor = require('../../src/core/metadata-extractor');
      const originalFn = metadataExtractor.extractMetadata;
      metadataExtractor.extractMetadata = mockExtractMetadata;

      try {
        // Start multiple concurrent requests
        const promises = Array(5).fill(null).map(() => 
          metadataExtractor.extractMetadata(testUrl)
        );

        // Check in-flight requests during execution
        expect(getInflightRequestStats().count).toBe(1);
        expect(getInflightRequestStats().keys).toContain(`${testUrl}:{}`);

        // Wait for all requests to complete
        const results = await Promise.all(promises);

        // All requests should return the same result
        results.forEach(result => {
          expect(result.title).toBe('Test Title');
          expect(result.url).toBe(testUrl);
        });

        // But the actual extraction should only happen once
        expect(callCount).toBe(1);

        // In-flight requests should be cleared
        expect(getInflightRequestStats().count).toBe(0);
      } finally {
        // Restore original function
        metadataExtractor.extractMetadata = originalFn;
      }
    });

    it('should handle different URLs independently', async () => {
      const url1 = 'https://example1.com';
      const url2 = 'https://example2.com';
      let callCount = 0;

      const mockExtractMetadata = jest.fn().mockImplementation(async (url: string) => {
        callCount++;
        await new Promise(resolve => setTimeout(resolve, 50));
        return {
          title: `Title for ${url}`,
          url,
          domain: new URL(url).hostname
        };
      });

      const metadataExtractor = require('../../src/core/metadata-extractor');
      const originalFn = metadataExtractor.extractMetadata;
      metadataExtractor.extractMetadata = mockExtractMetadata;

      try {
        // Start concurrent requests for different URLs
        const promises = [
          metadataExtractor.extractMetadata(url1),
          metadataExtractor.extractMetadata(url1), // Same as first
          metadataExtractor.extractMetadata(url2),
          metadataExtractor.extractMetadata(url2), // Same as third
        ];

        // Should have 2 in-flight requests (one per unique URL)
        expect(getInflightRequestStats().count).toBe(2);

        const results = await Promise.all(promises);

        // Should have called extraction twice (once per unique URL)
        expect(callCount).toBe(2);

        // Results should match URLs
        expect(results[0].url).toBe(url1);
        expect(results[1].url).toBe(url1);
        expect(results[2].url).toBe(url2);
        expect(results[3].url).toBe(url2);
      } finally {
        metadataExtractor.extractMetadata = originalFn;
      }
    });

    it('should handle failures properly without blocking future requests', async () => {
      const testUrl = 'https://failing-example.com';
      let callCount = 0;

      const mockExtractMetadata = jest.fn().mockImplementation(async () => {
        callCount++;
        await new Promise(resolve => setTimeout(resolve, 50));
        throw new Error('Network error');
      });

      const metadataExtractor = require('../../src/core/metadata-extractor');
      const originalFn = metadataExtractor.extractMetadata;
      metadataExtractor.extractMetadata = mockExtractMetadata;

      try {
        // Start multiple concurrent requests that will fail
        const promises = Array(3).fill(null).map(() =>
          metadataExtractor.extractMetadata(testUrl).catch((e: Error) => e.message)
        );

        const results = await Promise.all(promises);

        // All should have failed with the same error
        results.forEach(result => {
          expect(result).toBe('Network error');
        });

        // Should have called extraction only once
        expect(callCount).toBe(1);

        // In-flight requests should be cleared after failure
        expect(getInflightRequestStats().count).toBe(0);

        // Subsequent request should work (not blocked by previous failure)
        await expect(metadataExtractor.extractMetadata(testUrl)).rejects.toThrow();
        expect(callCount).toBe(2); // Called again
      } finally {
        metadataExtractor.extractMetadata = originalFn;
      }
    });
  });

  describe('Utility functions', () => {
    it('should provide accurate in-flight request statistics', () => {
      const stats = getInflightRequestStats();
      expect(stats).toHaveProperty('count');
      expect(stats).toHaveProperty('keys');
      expect(Array.isArray(stats.keys)).toBe(true);
      expect(typeof stats.count).toBe('number');
    });

    it('should clear in-flight requests when requested', () => {
      // This is tested indirectly in other tests through beforeEach/afterEach
      expect(() => clearInflightRequests()).not.toThrow();
    });
  });
});