import crypto from 'crypto';
import { GeneratedPreview, PreviewOptions } from '../types';
import { previewCache } from './cache';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeForCache(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    // Keep array length stable; `JSON.stringify` will convert `undefined` entries to `null`.
    return value.map(normalizeForCache);
  }

  // Preserve non-plain objects so `JSON.stringify` can apply `toJSON` (e.g. Date -> ISO string).
  if (!isPlainObject(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const normalized = normalizeForCache(record[key]);
    if (normalized === undefined) continue;
    output[key] = normalized;
  }
  return output;
}

function createPreviewCacheKey(url: string, options: PreviewOptions): string | undefined {
  try {
    const optionsWithoutCache: PreviewOptions = { ...options };
    delete optionsWithoutCache.cache;
    const normalized = normalizeForCache({ url, options: optionsWithoutCache });
    const serialized = JSON.stringify(normalized) ?? 'null';
    return crypto.createHash('sha256').update(serialized).digest('hex');
  } catch {
    return undefined;
  }
}

export function getCachedPreview(url: string, options: PreviewOptions): GeneratedPreview | undefined {
  const key = createPreviewCacheKey(url, options);
  if (!key) return undefined;
  return previewCache.get(key);
}

export function setCachedPreview(
  url: string,
  options: PreviewOptions,
  preview: GeneratedPreview,
  ttlMs?: number
): void {
  const key = createPreviewCacheKey(url, options);
  if (!key) return;
  previewCache.set(key, preview, ttlMs);
}
