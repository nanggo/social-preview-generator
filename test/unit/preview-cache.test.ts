import {
  LRUCache,
  PREVIEW_CACHE_MAX_BYTES,
  PREVIEW_CACHE_MAX_ENTRY_BYTES,
  previewCache,
  stopCacheCleanup,
} from '../../src/utils/cache';
import { getCachedPreview, setCachedPreview } from '../../src/utils/preview-cache';
import type { GeneratedPreview } from '../../src/types';

function preview(buffer: Buffer): GeneratedPreview {
  return {
    buffer,
    format: 'jpeg',
    dimensions: { width: 1200, height: 630 },
    metadata: { title: 'Cache test', url: 'https://example.com/' },
    template: 'modern',
    cached: false,
  };
}

describe('weighted preview cache', () => {
  beforeEach(() => previewCache.clear());
  afterAll(() => stopCacheCleanup());

  it('accounts for replacement, multi-eviction, delete, expiry, and clear', () => {
    vi.useFakeTimers();
    try {
      const cache = new LRUCache<Buffer>(10, 100, {
        maxWeight: 10,
        maxEntryWeight: 8,
        sizeOf: value => value.byteLength,
      });

      expect(cache.set('a', Buffer.alloc(5))).toBe(true);
      expect(cache.set('a', Buffer.alloc(2))).toBe(true);
      expect(cache.getStats().currentWeight).toBe(2);

      cache.set('b', Buffer.alloc(3));
      cache.set('c', Buffer.alloc(3));
      cache.set('d', Buffer.alloc(7));
      expect(cache.getStats()).toMatchObject({ size: 2, currentWeight: 10 });
      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(false);

      expect(cache.delete('c')).toBe(true);
      expect(cache.getStats().currentWeight).toBe(7);
      cache.set('short', Buffer.alloc(1), 10);
      vi.advanceTimersByTime(11);
      expect(cache.cleanup()).toBe(1);
      expect(cache.getStats().currentWeight).toBe(7);

      cache.clear();
      expect(cache.getStats()).toMatchObject({ size: 0, currentWeight: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips oversized entries before cloning and preserves successful results', () => {
    const oversized = preview(Buffer.alloc(PREVIEW_CACHE_MAX_ENTRY_BYTES + 1));
    expect(() => setCachedPreview('https://example.com/', { cache: true }, oversized)).not.toThrow();
    expect(previewCache.getStats()).toMatchObject({ size: 0, currentWeight: 0 });
  });

  it('never retains more than 64 MiB and preserves cache-hit cloning', () => {
    const sharedBuffer = Buffer.alloc(PREVIEW_CACHE_MAX_ENTRY_BYTES, 1);
    for (let index = 0; index < 5; index += 1) {
      previewCache.set(`key-${index}`, preview(sharedBuffer));
    }
    expect(previewCache.getStats()).toMatchObject({
      size: 4,
      currentWeight: PREVIEW_CACHE_MAX_BYTES,
      maxWeight: PREVIEW_CACHE_MAX_BYTES,
      maxEntryWeight: PREVIEW_CACHE_MAX_ENTRY_BYTES,
    });

    const original = preview(Buffer.from('original'));
    setCachedPreview('https://clone.example/', { cache: true }, original);
    const first = getCachedPreview('https://clone.example/', { cache: true })!;
    first.buffer.fill(0);
    expect(getCachedPreview('https://clone.example/', { cache: true })!.buffer.toString()).toBe(
      'original'
    );
  });
});
