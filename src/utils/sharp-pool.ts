/**
 * Sharp Instance Pool
 * Provides pooled Sharp instances for better performance and memory management
 * 
 * Benefits:
 * - Reduces instance creation overhead
 * - Better memory management through reuse
 * - Configurable pool size and timeout
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
   */
  async acquire(input?: string | Buffer, options?: SharpOptions): Promise<Sharp> {
    // If input or create options are provided, create a new instance directly without pooling
    // These instances are not statefully reusable in the pool
    if (input || options?.create) {
      return sharp(input, { ...SHARP_SECURITY_CONFIG, ...options });
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
 * Convenience function to get a Sharp instance from the pool
 * Automatically handles security configuration
 */
export async function createPooledSharp(input?: string | Buffer, options?: SharpOptions): Promise<Sharp> {
  return sharpPool.acquire(input, options);
}

/**
 * Wraps Sharp operations to automatically handle pool release
 * Use this for operations that need automatic cleanup
 */
export async function withPooledSharp<T>(
  operation: (sharp: Sharp) => Promise<T>,
  input?: string | Buffer,
  options?: SharpOptions
): Promise<T> {
  const sharpInstance = await sharpPool.acquire(input, options);
  try {
    return await operation(sharpInstance);
  } finally {
    // Only release if it's a pooled instance (no input and no create options)
    if (!input && !options?.create) {
      sharpPool.release(sharpInstance);
    }
    // Input-based and create-based instances are not pooled and will be garbage collected
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

// Auto-register by default but allow opt-out
registerShutdownHandlers();