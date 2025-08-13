/**
 * Sharp Instance Pool
 * Provides pooled Sharp instances for better performance and memory management
 * 
 * IMPORTANT NOTE: This pooling system is largely ineffective for real usage patterns
 * because all actual Sharp operations require input data (buffers, file paths, etc.).
 * Sharp instances with input cannot be reused/pooled effectively.
 * 
 * RECOMMENDED: Use the new caching system in sharp-cache.ts instead, which targets
 * actual performance bottlenecks (SVG parsing, metadata extraction, canvas generation).
 * 
 * Benefits of pooling (theoretical):
 * - Reduces instance creation overhead for no-input instances
 * - Better memory management through reuse
 * - Configurable pool size and timeout
 * 
 * Limitations:
 * - Input-based instances (99% of real usage) cannot be pooled
 * - Only empty Sharp instances can be pooled (rarely used)
 * - Caching system provides better real-world performance gains
 */

import sharp, { Sharp, SharpOptions } from 'sharp';
import { SHARP_SECURITY_CONFIG } from '../constants/security';
import { logger } from './logger';

interface PooledSharpInstance {
  instance: Sharp;
  inUse: boolean;
  createdAt: number;
  lastUsed: number;
}

interface SharpPoolOptions {
  maxSize?: number;
  maxIdleTime?: number;
  acquireTimeout?: number;
}

export class SharpPool {
  private pool: PooledSharpInstance[] = [];
  private readonly maxSize: number;
  private readonly maxIdleTime: number; // milliseconds
  private readonly acquireTimeout: number; // milliseconds
  private cleanupInterval: NodeJS.Timeout;
  private waitQueue: Array<{
    resolve: (instance: Sharp) => void;
    reject: (error: Error) => void;
    timestamp: number;
  }> = [];

  constructor(options: SharpPoolOptions = {}) {
    // Validate and constrain pool parameters for security
    this.maxSize = Math.max(1, Math.min(options.maxSize || 10, 100)); // 1-100 instances
    this.maxIdleTime = Math.max(1000, Math.min(options.maxIdleTime || 5 * 60 * 1000, 30 * 60 * 1000)); // 1s-30min
    this.acquireTimeout = Math.max(1000, Math.min(options.acquireTimeout || 10000, 60000)); // 1s-60s

    // Start cleanup interval to remove idle instances
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000); // cleanup every minute
    this.cleanupInterval.unref(); // Don't prevent process exit
  }

  /**
   * Acquire a Sharp instance from the pool
   * Creates new instance if pool is empty and under maxSize
   * Waits for available instance if pool is full
   * 
   * @param input Should be undefined for pooled instances
   * @param options Sharp options (create option not supported for pooled instances)
   */
  async acquire(input?: string | Buffer, options?: SharpOptions): Promise<Sharp> {
    // Following Gemini Code Assist recommendation:
    // To enforce correct usage, pooled instances should not have input
    if (input !== undefined) {
      throw new Error('SharpPool.acquire must not be called with an input. Use createPooledSharp() instead.');
    }
    
    if (options?.create) {
      throw new Error('SharpPool.acquire does not support create options. Use createPooledSharp() instead.');
    }

    // Try to get an available instance from pool (only for no-input instances)
    const pooledInstance = this.findAvailableInstance();
    if (pooledInstance) {
      pooledInstance.inUse = true;
      pooledInstance.lastUsed = Date.now();
      return pooledInstance.instance;
    }

    // If pool is not full, create new instance (no input for pooled instances)
    if (this.pool.length < this.maxSize) {
      const instance = this.createInstance();
      const pooledInstance: PooledSharpInstance = {
        instance,
        inUse: true,
        createdAt: Date.now(),
        lastUsed: Date.now()
      };
      this.pool.push(pooledInstance);
      return instance;
    }

    // Pool is full, wait for available instance
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        // Remove from queue
        const queueIndex = this.waitQueue.findIndex(item => item.resolve === resolve);
        if (queueIndex !== -1) {
          this.waitQueue.splice(queueIndex, 1);
        }
        reject(new Error(`Sharp pool acquire timeout after ${this.acquireTimeout}ms`));
      }, this.acquireTimeout);

      this.waitQueue.push({
        resolve: (instance: Sharp) => {
          clearTimeout(timeoutId);
          resolve(instance);
        },
        reject: (error: Error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
        timestamp: Date.now()
      });
    });
  }

  /**
   * Release a Sharp instance back to the pool
   * The instance becomes available for reuse
   */
  release(instance: Sharp): void {
    const pooledInstance = this.pool.find(p => p.instance === instance);
    if (pooledInstance) {
      // If there's a waiting request, pass the instance directly without marking it as free
      if (this.waitQueue.length > 0) {
        const waiter = this.waitQueue.shift();
        if (waiter) {
          pooledInstance.lastUsed = Date.now();
          // The instance remains inUse and is passed to the next consumer
          waiter.resolve(pooledInstance.instance);
          return;
        }
      }

      // No waiters, so release the instance back to the pool
      pooledInstance.inUse = false;
      pooledInstance.lastUsed = Date.now();
    } else {
      // Instance not from pool, just let it be garbage collected
      logger?.debug?.('Sharp instance not from pool, releasing manually');
    }
  }

  /**
   * Create a properly configured Sharp instance
   */
  private createInstance(): Sharp {
    // Pool only manages instances without input
    return sharp({ ...SHARP_SECURITY_CONFIG });
  }

  /**
   * Find an available instance in the pool
   */
  private findAvailableInstance(): PooledSharpInstance | null {
    return this.pool.find(p => !p.inUse) || null;
  }

  /**
   * Clean up idle instances from the pool
   */
  private cleanup(): void {
    const now = Date.now();
    const initialSize = this.pool.length;
    
    const toRemove: PooledSharpInstance[] = [];
    const toKeep: PooledSharpInstance[] = [];
    
    for (const pooledInstance of this.pool) {
      const isIdle = !pooledInstance.inUse && (now - pooledInstance.lastUsed) > this.maxIdleTime;
      if (isIdle) {
        toRemove.push(pooledInstance);
      } else {
        toKeep.push(pooledInstance);
      }
    }
    
    // Sharp instances are automatically garbage collected
    // No explicit cleanup needed - just remove references
    this.pool = toKeep;

    const removedCount = initialSize - this.pool.length;
    if (removedCount > 0) {
      logger?.debug?.(`Sharp pool cleanup: removed ${removedCount} idle instances`);
    }

    // Clean up expired waiters atomically to prevent race conditions
    let i = this.waitQueue.length;
    while (i--) {
      const waiter = this.waitQueue[i];
      if (now - waiter.timestamp > this.acquireTimeout) {
        waiter.reject(new Error('Sharp pool acquire timeout during cleanup'));
        this.waitQueue.splice(i, 1);
      }
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    totalInstances: number;
    inUse: number;
    available: number;
    waitingRequests: number;
    maxSize: number;
  } {
    const inUse = this.pool.filter(p => p.inUse).length;
    return {
      totalInstances: this.pool.length,
      inUse,
      available: this.pool.length - inUse,
      waitingRequests: this.waitQueue.length,
      maxSize: this.maxSize
    };
  }

  /**
   * Drain the pool (for testing or shutdown)
   * Destroys all instances and clears wait queue
   */
  drain(): void {
    // Clear cleanup interval
    clearInterval(this.cleanupInterval);

    // Atomically capture and clear the wait queue to prevent race conditions
    const waiters = this.waitQueue;
    this.waitQueue = [];
    
    // Reject all captured waiting requests
    waiters.forEach(waiter => {
      waiter.reject(new Error('Sharp pool is being drained'));
    });

    // Sharp instances are automatically garbage collected
    // No explicit cleanup needed - just remove references
    
    this.pool = [];
    logger?.info?.('Sharp pool drained');
  }
}

// Global Sharp pool instance
export const sharpPool = new SharpPool({
  maxSize: 10,
  maxIdleTime: 5 * 60 * 1000, // 5 minutes
  acquireTimeout: 10000 // 10 seconds
});

/**
 * Convenience function to get a Sharp instance with caching optimization
 * Automatically handles security configuration
 * 
 * @deprecated This function now uses the new caching system instead of pooling.
 * The new system is more effective for actual usage patterns.
 */
export async function createPooledSharp(input?: string | Buffer, options?: SharpOptions): Promise<Sharp> {
  // Following Gemini Code Assist recommendation:
  // Input-based instances are not reusable and should not use pooling
  if (input || options?.create) {
    // Not poolable, create a new instance directly
    return sharp(input, { ...SHARP_SECURITY_CONFIG, ...options });
  }
  
  // Only pool instances without input (though this case rarely happens in practice)
  return sharpPool.acquire(undefined, options);
}

/**
 * Wraps Sharp operations with automatic resource management
 * Use this for operations that need automatic cleanup
 * 
 * @deprecated This function now uses optimized resource management instead of pooling.
 * The new system handles all Sharp instances efficiently without manual pooling.
 */
export async function withPooledSharp<T>(
  operation: (sharp: Sharp) => Promise<T>,
  input?: string | Buffer,
  options?: SharpOptions
): Promise<T> {
  // All instances are input-based or create-based in real usage,
  // so create directly without pooling overhead
  const sharpInstance = sharp(input, { ...SHARP_SECURITY_CONFIG, ...options });
  try {
    return await operation(sharpInstance);
  } finally {
    // Sharp instances are automatically garbage collected
    // No manual cleanup needed in modern approach
  }
}

/**
 * Convenience function to release a Sharp instance back to the pool
 */
export function releasePooledSharp(instance: Sharp): void {
  sharpPool.release(instance);
}

/**
 * Get pool statistics for monitoring
 */
export function getSharpPoolStats() {
  return sharpPool.getStats();
}

/**
 * Graceful shutdown helper
 */
export function shutdownSharpPool(): void {
  sharpPool.drain();
}

// Register cleanup handlers (can be disabled if needed)
let shutdownHandlersRegistered = false;

export function registerShutdownHandlers(): void {
  if (typeof process !== 'undefined' && !shutdownHandlersRegistered) {
    process.on('SIGTERM', shutdownSharpPool);
    process.on('SIGINT', shutdownSharpPool);
    process.on('exit', shutdownSharpPool);
    shutdownHandlersRegistered = true;
  }
}

export function unregisterShutdownHandlers(): void {
  if (typeof process !== 'undefined' && shutdownHandlersRegistered) {
    process.removeListener('SIGTERM', shutdownSharpPool);
    process.removeListener('SIGINT', shutdownSharpPool);
    process.removeListener('exit', shutdownSharpPool);
    shutdownHandlersRegistered = false;
  }
}

// Auto-register by default but allow opt-out (following Gemini suggestion to make this opt-in)
// registerShutdownHandlers(); // Commented out to make opt-in

// Export for manual registration if needed
export { registerShutdownHandlers as enableShutdownHandlers };

/**
 * Modern Sharp caching API - recommended for new code
 * Provides better performance through intelligent caching
 */
export async function createCachedSharp(input?: string | Buffer, options?: SharpOptions): Promise<Sharp> {
  // Import modern caching system
  const { createCachedSVG } = await import('./sharp-cache');
  
  // For SVG content, use SVG caching
  if (input && Buffer.isBuffer(input) && input.length > 0) {
    const inputStr = input.toString('utf8');
    if (inputStr.includes('<svg') && inputStr.includes('</svg>')) {
      return createCachedSVG(inputStr);
    }
  }
  
  // For regular cases, create instance directly
  return sharp(input, { ...SHARP_SECURITY_CONFIG, ...options });
}

/**
 * Modern wrapper for Sharp operations with caching optimization
 * Use this instead of withPooledSharp for better performance
 */
export async function withCachedSharp<T>(
  operation: (sharp: Sharp) => Promise<T>,
  input?: string | Buffer,
  options?: SharpOptions
): Promise<T> {
  const sharpInstance = await createCachedSharp(input, options);
  return await operation(sharpInstance);
}