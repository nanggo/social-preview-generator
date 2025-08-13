/**
 * Cache Stampede Prevention Tests
 * Tests for in-flight request management to prevent duplicate concurrent requests
 */

import { 
  extractMetadata,
  getInflightRequestStats,
  clearInflightRequests,
  __test_inflightRequests
} from '../../src/core/metadata-extractor';
import { metadataCache } from '../../src/utils/cache';
import axios from 'axios';
import ogs from 'open-graph-scraper';

// Mock external dependencies to control timing and behavior
jest.mock('axios');
jest.mock('open-graph-scraper');
jest.mock('../../src/utils/enhanced-secure-agent', () => ({
  getEnhancedSecureAgentForUrl: jest.fn(() => null),
  validateRequestSecurity: jest.fn(() => Promise.resolve({ allowed: true }))
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedOgs = ogs as jest.MockedFunction<typeof ogs>;

describe('Cache Stampede Prevention', () => {
  beforeEach(() => {
    // Clear cache and in-flight requests before each test
    metadataCache.clear();
    clearInflightRequests();
    
    // Reset all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    clearInflightRequests();
  });

  describe('In-flight request management', () => {
    it('should prevent multiple concurrent requests for the same URL', async () => {
      const testUrl = 'https://example.com';
      let axiosCallCount = 0;
      let ogsCallCount = 0;
      
      // Mock axios.get to simulate slow network request
      mockedAxios.get.mockImplementation(async () => {
        axiosCallCount++;
        // Simulate slow network request
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          data: '<html><head><title>Test Title</title></head></html>',
          headers: { 'content-type': 'text/html' }
        };
      });

      // Mock ogs to return successful metadata
      mockedOgs.mockImplementation(async () => {
        ogsCallCount++;
        return {
          error: false,
          result: {
            ogTitle: 'Test Title',
            ogDescription: 'Test Description',
            url: testUrl
          },
          html: '<html></html>',
          response: {} as any
        } as any;
      });

      // Start multiple concurrent requests
      const promises = Array(5).fill(null).map(() => 
        extractMetadata(testUrl)
      );

      // Check in-flight requests during execution
      // Wait a bit to let the first request start
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(getInflightRequestStats().count).toBe(1);
      expect(getInflightRequestStats().keys).toContain(`${testUrl}:{}`);

      // Wait for all requests to complete
      const results = await Promise.all(promises);

      // All requests should return the same result
      results.forEach(result => {
        expect(result.title).toBe('Test Title');
        expect(result.url).toBe('https://example.com/'); // URL gets normalized
        expect(result.domain).toBe('example.com');
      });

      // But the actual network requests should only happen once
      expect(axiosCallCount).toBe(1);
      expect(ogsCallCount).toBe(1);

      // In-flight requests should be cleared
      expect(getInflightRequestStats().count).toBe(0);
    });

    it('should handle different URLs independently', async () => {
      const url1 = 'https://example1.com';
      const url2 = 'https://example2.com';
      let axiosCallCount = 0;

      // Mock axios.get to track calls per URL
      mockedAxios.get.mockImplementation(async (url) => {
        axiosCallCount++;
        await new Promise(resolve => setTimeout(resolve, 50));
        const hostname = new URL(url).hostname;
        return {
          data: `<html><head><title>Title for ${hostname}</title></head></html>`,
          headers: { 'content-type': 'text/html' }
        };
      });

      // Mock ogs to return URL-specific metadata
      mockedOgs.mockImplementation(async (options: any) => {
        const hostname = new URL(options.url).hostname;
        return {
          error: false,
          result: {
            ogTitle: `Title for ${hostname}`,
            url: options.url
          },
          html: '<html></html>',
          response: {} as any
        } as any;
      });

      // Start concurrent requests for different URLs
      const promises = [
        extractMetadata(url1),
        extractMetadata(url1), // Same as first
        extractMetadata(url2),
        extractMetadata(url2), // Same as third
      ];

      // Wait a bit to let requests start
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Should have 2 in-flight requests (one per unique URL)
      expect(getInflightRequestStats().count).toBe(2);

      const results = await Promise.all(promises);

      // Should have called axios twice (once per unique URL)
      expect(axiosCallCount).toBe(2);

      // Results should match URLs (normalized)
      expect(results[0].url).toBe('https://example1.com/');
      expect(results[1].url).toBe('https://example1.com/');
      expect(results[2].url).toBe('https://example2.com/');
      expect(results[3].url).toBe('https://example2.com/');
      
      // Domain should be extracted correctly
      expect(results[0].domain).toBe('example1.com');
      expect(results[2].domain).toBe('example2.com');
    });

    it('should handle failures properly without blocking future requests', async () => {
      const testUrl = 'https://failing-example.com';
      let axiosCallCount = 0;

      // Mock axios.get to simulate network failure
      mockedAxios.get.mockImplementation(async () => {
        axiosCallCount++;
        await new Promise(resolve => setTimeout(resolve, 50));
        throw new Error('Network error');
      });

      // Mock ogs to also fail (to prevent fallback)
      mockedOgs.mockImplementation(async () => {
        throw new Error('OGS also failed');
      });

      // Start multiple concurrent requests that will fail
      const promises = Array(3).fill(null).map(() =>
        extractMetadata(testUrl).catch((e: Error) => e)
      );

      const results = await Promise.all(promises);

      // All should have failed with similar error messages (wrapped in PreviewGeneratorError)
      results.forEach(result => {
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toMatch(/Network error|Failed to fetch data|OGS also failed/);
      });

      // Should have called axios only once (all requests shared the same promise)
      expect(axiosCallCount).toBe(1);

      // In-flight requests should be cleared after failure
      expect(getInflightRequestStats().count).toBe(0);

      // Subsequent request should work (not blocked by previous failure)
      await expect(extractMetadata(testUrl)).rejects.toThrow();
      expect(axiosCallCount).toBe(2); // Called again
    });
  });

  describe('Utility functions', () => {
    it('should provide accurate in-flight request statistics', () => {
      const stats = getInflightRequestStats();
      expect(stats).toHaveProperty('count');
      expect(stats).toHaveProperty('keys');
      expect(stats).toHaveProperty('maxLimit');
      expect(stats).toHaveProperty('utilizationPercent');
      expect(Array.isArray(stats.keys)).toBe(true);
      expect(typeof stats.count).toBe('number');
      expect(typeof stats.maxLimit).toBe('number');
      expect(typeof stats.utilizationPercent).toBe('number');
      expect(stats.maxLimit).toBe(1000);
    });

    it('should clear in-flight requests when requested', () => {
      // This is tested indirectly in other tests through beforeEach/afterEach
      expect(() => clearInflightRequests()).not.toThrow();
    });
  });

  describe('DoS Protection', () => {
    it('should reject requests when at capacity limit', async () => {
      // Mock axios for the one request that should succeed
      mockedAxios.get.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return {
          data: '<html><head><title>Test</title></head></html>',
          headers: { 'content-type': 'text/html' }
        };
      });

      mockedOgs.mockImplementation(async () => ({
        error: false,
        result: { ogTitle: 'Test Title' },
        html: '<html></html>',
        response: {} as any
      } as any));

      // Clear any existing requests
      clearInflightRequests();

      // Simulate reaching capacity by directly setting requests in the map
      const mockPromise = new Promise<any>(resolve => 
        setTimeout(() => resolve({ title: 'Mock', url: 'mock', domain: 'mock' }), 200)
      );

      // Fill up to just under the limit
      for (let i = 0; i < 999; i++) {
        const fakeKey = `fake-url-${i}:{}`;
        __test_inflightRequests!.set(fakeKey, mockPromise);
      }

      // This request should still work (at 999/1000)
      const result1 = await extractMetadata('https://test1.com');
      expect(result1.title).toBe('Test Title');
      
      // Add one more to reach exactly 1000
      __test_inflightRequests!.set('fake-url-999:{}', mockPromise);

      // This request should be rejected (at 1000/1000)
      await expect(extractMetadata('https://test2.com')).rejects.toThrow(
        'In-flight requests limit reached (1000). Server is busy, please try again later.'
      );

      // Clean up
      clearInflightRequests();
    });

    it('should timeout stuck in-flight requests', async () => {
      // Mock axios to create a request that never resolves (stuck)
      mockedAxios.get.mockImplementation(() => 
        new Promise(() => {}) // Never resolves or rejects
      );

      // Start a request that will get stuck
      const stuckPromise = extractMetadata('https://stuck-server.com');

      // The request should timeout after the configured timeout period (1s in test mode)
      await expect(stuckPromise).rejects.toThrow(
        'In-flight request timeout after 1000ms for URL: https://stuck-server.com'
      );

      // After timeout, the in-flight requests should be cleaned up
      expect(getInflightRequestStats().count).toBe(0);
    }, 5000); // Test timeout longer than the in-flight timeout

    it('should handle multiple stuck requests independently', async () => {
      // Mock axios to create stuck requests
      mockedAxios.get.mockImplementation(() => 
        new Promise(() => {}) // Never resolves
      );

      // Start multiple stuck requests
      const stuckPromise1 = extractMetadata('https://stuck1.com');
      const stuckPromise2 = extractMetadata('https://stuck2.com');

      // Both should timeout independently
      await expect(Promise.all([
        stuckPromise1.catch(e => e),
        stuckPromise2.catch(e => e)
      ])).resolves.toEqual([
        expect.objectContaining({
          message: expect.stringContaining('In-flight request timeout')
        }),
        expect.objectContaining({
          message: expect.stringContaining('In-flight request timeout')
        })
      ]);

      // All requests should be cleaned up
      expect(getInflightRequestStats().count).toBe(0);
    }, 5000);
  });
});