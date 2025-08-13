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
    this.maxSize = options.maxSize || 10;
    this.maxIdleTime = options.maxIdleTime || 5 * 60 * 1000; // 5 minutes
    this.acquireTimeout = options.acquireTimeout || 10000; // 10 seconds

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
    // Try to get an available instance from pool
    const pooledInstance = this.findAvailableInstance();
    if (pooledInstance) {
      pooledInstance.inUse = true;
      pooledInstance.lastUsed = Date.now();
      
      // Configure the instance with new input if provided
      if (input) {
        return sharp(input, { ...SHARP_SECURITY_CONFIG, ...options });
      } else {
        return sharp({ ...SHARP_SECURITY_CONFIG, ...options });
      }
    }

    // If pool is not full, create new instance
    if (this.pool.length < this.maxSize) {
      const instance = this.createInstance(input, options);
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
      pooledInstance.inUse = false;
      pooledInstance.lastUsed = Date.now();

      // Process wait queue if any
      const waiter = this.waitQueue.shift();
      if (waiter) {
        pooledInstance.inUse = true;
        // Create new configured instance for the waiter
        try {
          const newInstance = sharp({ ...SHARP_SECURITY_CONFIG });
          waiter.resolve(newInstance);
        } catch (error) {
          waiter.reject(error instanceof Error ? error : new Error('Failed to create Sharp instance'));
        }
      }
    } else {
      // Instance not from pool, just let it be garbage collected
      logger?.debug?.('Sharp instance not from pool, releasing manually');
    }
  }

  /**
   * Create a properly configured Sharp instance
   */
  private createInstance(input?: string | Buffer, options?: SharpOptions): Sharp {
    if (input) {
      return sharp(input, { ...SHARP_SECURITY_CONFIG, ...options });
    } else {
      return sharp({ ...SHARP_SECURITY_CONFIG, ...options });
    }
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
    
    this.pool = this.pool.filter(pooledInstance => {
      const isIdle = !pooledInstance.inUse && (now - pooledInstance.lastUsed) > this.maxIdleTime;
      if (isIdle) {
        try {
          // Sharp instances don't have explicit cleanup, but we can destroy them
          pooledInstance.instance.destroy();
        } catch (error) {
          logger?.warn?.('Error destroying idle Sharp instance:', { error: error instanceof Error ? error : String(error) });
        }
      }
      return !isIdle;
    });

    const removedCount = initialSize - this.pool.length;
    if (removedCount > 0) {
      logger?.debug?.(`Sharp pool cleanup: removed ${removedCount} idle instances`);
    }

    // Clean up expired waiters
    const expiredWaiters = this.waitQueue.filter(waiter => 
      now - waiter.timestamp > this.acquireTimeout
    );
    
    expiredWaiters.forEach(waiter => {
      waiter.reject(new Error('Sharp pool acquire timeout during cleanup'));
    });
    
    this.waitQueue = this.waitQueue.filter(waiter => 
      now - waiter.timestamp <= this.acquireTimeout
    );
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
  async drain(): Promise<void> {
    // Clear cleanup interval
    clearInterval(this.cleanupInterval);

    // Reject all waiting requests
    this.waitQueue.forEach(waiter => {
      waiter.reject(new Error('Sharp pool is being drained'));
    });
    this.waitQueue = [];

    // Destroy all instances
    for (const pooledInstance of this.pool) {
      try {
        pooledInstance.instance.destroy();
      } catch (error) {
        logger?.warn?.('Error destroying Sharp instance during drain:', { error: error instanceof Error ? error : String(error) });
      }
    }
    
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
export async function shutdownSharpPool(): Promise<void> {
  await sharpPool.drain();
}

// Register cleanup handlers
if (typeof process !== 'undefined') {
  process.on('SIGTERM', shutdownSharpPool);
  process.on('SIGINT', shutdownSharpPool);
  process.on('exit', shutdownSharpPool);
}