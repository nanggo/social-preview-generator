/**
 * Cache Lifecycle Management Tests
 * Tests for cache cleanup timer management functions
 */

import { 
  startCacheCleanup, 
  stopCacheCleanup, 
  isCacheCleanupRunning,
  metadataCache 
} from '../../src/utils/cache';

describe('Cache Lifecycle Management', () => {
  // Clean up after each test
  afterEach(() => {
    stopCacheCleanup();
  });

  describe('startCacheCleanup', () => {
    it('should start cleanup when not already running', () => {
      // Stop any existing cleanup first
      stopCacheCleanup();
      expect(isCacheCleanupRunning()).toBe(false);
      
      startCacheCleanup();
      expect(isCacheCleanupRunning()).toBe(true);
    });

    it('should not start multiple cleanup intervals', () => {
      stopCacheCleanup();
      
      startCacheCleanup();
      expect(isCacheCleanupRunning()).toBe(true);
      
      // Calling again should not change state
      startCacheCleanup();
      expect(isCacheCleanupRunning()).toBe(true);
    });

    it('should accept custom interval', () => {
      stopCacheCleanup();
      
      startCacheCleanup(5000); // 5 seconds
      expect(isCacheCleanupRunning()).toBe(true);
    });
  });

  describe('stopCacheCleanup', () => {
    it('should stop running cleanup', () => {
      startCacheCleanup();
      expect(isCacheCleanupRunning()).toBe(true);
      
      stopCacheCleanup();
      expect(isCacheCleanupRunning()).toBe(false);
    });

    it('should be safe to call when not running', () => {
      stopCacheCleanup();
      expect(isCacheCleanupRunning()).toBe(false);
      
      // Should not throw
      expect(() => stopCacheCleanup()).not.toThrow();
      expect(isCacheCleanupRunning()).toBe(false);
    });
  });

  describe('isCacheCleanupRunning', () => {
    it('should correctly report cleanup status', () => {
      stopCacheCleanup();
      expect(isCacheCleanupRunning()).toBe(false);
      
      startCacheCleanup();
      expect(isCacheCleanupRunning()).toBe(true);
      
      stopCacheCleanup();
      expect(isCacheCleanupRunning()).toBe(false);
    });
  });

  describe('integration with cache', () => {
    it('should allow cache operations regardless of cleanup status', () => {
      const testKey = 'test-key';
      const testValue = {
        title: 'Test Title',
        url: 'https://example.com',
        domain: 'example.com'
      } as any;

      // Test with cleanup running
      startCacheCleanup();
      metadataCache.set(testKey, testValue);
      expect(metadataCache.get(testKey)).toEqual(testValue);
      
      // Test with cleanup stopped
      stopCacheCleanup();
      metadataCache.set(testKey, testValue);
      expect(metadataCache.get(testKey)).toEqual(testValue);
    });
  });

  describe('graceful shutdown scenario', () => {
    it('should support typical server shutdown pattern', () => {
      // Simulate server startup
      startCacheCleanup();
      expect(isCacheCleanupRunning()).toBe(true);
      
      // Simulate graceful shutdown
      const cleanup = () => {
        stopCacheCleanup();
      };
      
      cleanup();
      expect(isCacheCleanupRunning()).toBe(false);
    });
  });
});