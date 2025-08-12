/**
 * Sharp Instance Pool
 * Manages a pool of reusable Sharp instances to reduce memory usage and initialization overhead
 */

import { Sharp } from 'sharp';
import { createSecureSharpInstance } from './image-security';

interface PooledSharpInstance {
  instance: Sharp;
  inUse: boolean;
  lastUsed: number;
}

export class SharpPool {
  private pool: PooledSharpInstance[] = [];
  private maxPoolSize: number;
  private idleTimeout: number;

  constructor(maxPoolSize: number = 10, idleTimeoutMs: number = 5 * 60 * 1000) { // 5 minutes idle timeout
    this.maxPoolSize = maxPoolSize;
    this.idleTimeout = idleTimeoutMs;

    // Cleanup idle instances every minute
    setInterval(() => {
      this.cleanupIdleInstances();
    }, 60 * 1000);
  }

  /**
   * Acquire a Sharp instance from the pool
   */
  acquire(): Sharp {
    const now = Date.now();
    
    // Find an available instance
    for (const pooled of this.pool) {
      if (!pooled.inUse) {
        pooled.inUse = true;
        pooled.lastUsed = now;
        return pooled.instance;
      }
    }

    // No available instance, create new one if pool isn't full
    if (this.pool.length < this.maxPoolSize) {
      const instance = createSecureSharpInstance(Buffer.alloc(0));
      const pooled: PooledSharpInstance = {
        instance,
        inUse: true,
        lastUsed: now
      };
      this.pool.push(pooled);
      return instance;
    }

    // Pool is full, create a temporary instance (not pooled)
    return createSecureSharpInstance(Buffer.alloc(0));
  }

  /**
   * Release a Sharp instance back to the pool
   */
  release(instance: Sharp): void {
    const pooled = this.pool.find(p => p.instance === instance);
    if (pooled) {
      pooled.inUse = false;
      pooled.lastUsed = Date.now();
      
      // Reset the instance for reuse
      try {
        // Clear any pending operations
        instance.clone();
      } catch {
        // If reset fails, remove from pool
        this.removeFromPool(instance);
      }
    }
    // If instance is not in pool (temporary), let it be garbage collected
  }

  /**
   * Remove an instance from the pool
   */
  private removeFromPool(instance: Sharp): void {
    const index = this.pool.findIndex(p => p.instance === instance);
    if (index !== -1) {
      this.pool.splice(index, 1);
    }
  }

  /**
   * Clean up idle instances to free memory
   */
  private cleanupIdleInstances(): void {
    const now = Date.now();
    const toRemove: number[] = [];

    for (let i = 0; i < this.pool.length; i++) {
      const pooled = this.pool[i];
      if (!pooled.inUse && (now - pooled.lastUsed) > this.idleTimeout) {
        toRemove.push(i);
      }
    }

    // Remove from end to beginning to maintain indices
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.pool.splice(toRemove[i], 1);
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): { total: number; inUse: number; available: number; maxSize: number } {
    const total = this.pool.length;
    const inUse = this.pool.filter(p => p.inUse).length;
    const available = total - inUse;

    return {
      total,
      inUse,
      available,
      maxSize: this.maxPoolSize
    };
  }

  /**
   * Clear all instances from the pool
   */
  clear(): void {
    this.pool = [];
  }
}

// Global Sharp pool instance
export const sharpPool = new SharpPool(10, 5 * 60 * 1000); // 10 instances, 5 minutes idle timeout

/**
 * Convenience function to acquire and auto-release Sharp instance
 */
export async function withSharpInstance<T>(
  operation: (sharp: Sharp) => Promise<T>
): Promise<T> {
  const instance = sharpPool.acquire();
  try {
    return await operation(instance);
  } finally {
    sharpPool.release(instance);
  }
}

/**
 * Create a pooled Sharp instance from input
 */
export function createPooledSharp(input?: string | Buffer): Sharp {
  const instance = sharpPool.acquire();
  
  if (input) {
    return createSecureSharpInstance(input instanceof Buffer ? input : Buffer.from(input));
  }
  
  return instance;
}