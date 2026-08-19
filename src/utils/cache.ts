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
  weight: number;
}

interface CacheWeightOptions<T> {
  maxWeight: number;
  maxEntryWeight?: number;
  sizeOf: (value: T) => number;
}

export class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxSize: number;
  private defaultTTL: number;
  private currentWeight = 0;
  private readonly weightOptions?: CacheWeightOptions<T>;

  constructor(
    maxSize: number = 100,
    defaultTTL: number = 5 * 60 * 1000,
    weightOptions?: CacheWeightOptions<T>
  ) { // 5 minutes default
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
    this.weightOptions = weightOptions;
  }

  private removeEntry(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    this.currentWeight = Math.max(0, this.currentWeight - entry.weight);
    return this.cache.delete(key);
  }

  set(key: string, value: T, ttl?: number): boolean {
    const now = Date.now();
    const entryTTL = ttl ?? this.defaultTTL;
    const weight = this.weightOptions?.sizeOf(value) ?? 0;
    const maxEntryWeight = this.weightOptions?.maxEntryWeight ?? this.weightOptions?.maxWeight;
    if (
      !Number.isFinite(weight) ||
      weight < 0 ||
      (maxEntryWeight !== undefined && weight > maxEntryWeight) ||
      (this.weightOptions && weight > this.weightOptions.maxWeight)
    ) {
      return false;
    }

    // Remove existing entry if present (for LRU ordering)
    if (this.cache.has(key)) {
      this.removeEntry(key);
    }

    // Remove oldest entries until both count and byte budgets can accept the entry.
    while (
      this.cache.size >= this.maxSize ||
      (this.weightOptions && this.currentWeight + weight > this.weightOptions.maxWeight)
    ) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey === undefined) break;
      this.removeEntry(firstKey);
    }

    // Add new entry (will be most recently used)
    this.cache.set(key, {
      value,
      timestamp: now,
      ttl: entryTTL,
      weight,
    });
    this.currentWeight += weight;
    return true;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return undefined;
    }

    const now = Date.now();
    
    // Check if entry has expired
    if (now - entry.timestamp > entry.ttl) {
      this.removeEntry(key);
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
    return this.removeEntry(key);
  }

  clear(): void {
    this.cache.clear();
    this.currentWeight = 0;
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
        this.removeEntry(key);
        removedCount++;
      }
    }

    return removedCount;
  }

  // Get cache statistics
  getStats(): {
    size: number;
    maxSize: number;
    defaultTTL: number;
    currentWeight: number;
    maxWeight?: number;
    maxEntryWeight?: number;
  } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      defaultTTL: this.defaultTTL,
      currentWeight: this.currentWeight,
      maxWeight: this.weightOptions?.maxWeight,
      maxEntryWeight: this.weightOptions?.maxEntryWeight,
    };
  }
}

// Global metadata cache instance
import { ExtractedMetadata, GeneratedPreview } from '../types';

export const metadataCache = new LRUCache<ExtractedMetadata>(100, 5 * 60 * 1000); // 100 entries, 5 minutes TTL
export const PREVIEW_CACHE_MAX_ENTRY_BYTES = 16 * 1024 * 1024;
export const PREVIEW_CACHE_MAX_BYTES = 64 * 1024 * 1024;
export const previewCache = new LRUCache<GeneratedPreview>(50, 5 * 60 * 1000, {
  maxWeight: PREVIEW_CACHE_MAX_BYTES,
  maxEntryWeight: PREVIEW_CACHE_MAX_ENTRY_BYTES,
  sizeOf: preview => preview.buffer.byteLength,
}); // 50 entries, 64 MiB retained buffers, 5 minutes TTL

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
    previewCache.cleanup();
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

// Auto-start disabled to avoid side effects on import for library consumers.
// Call startCacheCleanup() explicitly if automatic cleanup is needed.
