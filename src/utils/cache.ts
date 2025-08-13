/**
 * LRU Cache implementation with TTL support
 * Used for caching metadata extraction results
 * 
 * @example
 * ```typescript
 * import { metadataCache, stopCacheCleanup, startCacheCleanup } from './cache';
 * 
 * // For graceful server shutdown
 * process.on('SIGTERM', () => {
 *   stopCacheCleanup();
 *   // ... other cleanup
 * });
 * 
 * // For testing environments
 * afterAll(() => {
 *   stopCacheCleanup();
 * });
 * 
 * // Custom cleanup interval (5 minutes)
 * stopCacheCleanup();
 * startCacheCleanup(5 * 60 * 1000);
 * ```
 */

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
}

export class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxSize: number;
  private defaultTTL: number;

  constructor(maxSize: number = 100, defaultTTL: number = 5 * 60 * 1000) { // 5 minutes default
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
  }

  set(key: string, value: T, ttl?: number): void {
    const now = Date.now();
    const entryTTL = ttl ?? this.defaultTTL;

    // Remove existing entry if present (for LRU ordering)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Remove oldest entries if cache is full
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    // Add new entry (will be most recently used)
    this.cache.set(key, {
      value,
      timestamp: now,
      ttl: entryTTL
    });
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return undefined;
    }

    const now = Date.now();
    
    // Check if entry has expired
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  // Clean expired entries
  cleanup(): number {
    const now = Date.now();
    let removedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
        removedCount++;
      }
    }

    return removedCount;
  }

  // Get cache statistics
  getStats(): { size: number; maxSize: number; defaultTTL: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      defaultTTL: this.defaultTTL
    };
  }
}

// Global metadata cache instance
import { ExtractedMetadata } from '../types';

export const metadataCache = new LRUCache<ExtractedMetadata>(100, 5 * 60 * 1000); // 100 entries, 5 minutes TTL

// Cache cleanup management
let cleanupInterval: NodeJS.Timeout | null = null;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Starts automatic cache cleanup if not already running.
 * @param intervalMs - Cleanup interval in milliseconds (default: 10 minutes)
 */
export function startCacheCleanup(intervalMs: number = CLEANUP_INTERVAL_MS): void {
  if (cleanupInterval) {
    return; // Already running
  }
  
  cleanupInterval = setInterval(() => {
    metadataCache.cleanup();
  }, intervalMs);
  
  // Don't prevent Node.js process from exiting
  cleanupInterval.unref();
}

/**
 * Stops the automatic cache cleanup interval.
 * Useful for graceful shutdown in applications and testing environments.
 */
export function stopCacheCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

/**
 * Checks if automatic cache cleanup is currently running.
 * @returns true if cleanup interval is active
 */
export function isCacheCleanupRunning(): boolean {
  return cleanupInterval !== null;
}

// Start automatic cleanup by default
startCacheCleanup();