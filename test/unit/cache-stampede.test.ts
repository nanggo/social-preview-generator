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
      expect(Array.isArray(stats.keys)).toBe(true);
      expect(typeof stats.count).toBe('number');
    });

    it('should clear in-flight requests when requested', () => {
      // This is tested indirectly in other tests through beforeEach/afterEach
      expect(() => clearInflightRequests()).not.toThrow();
    });
  });
});