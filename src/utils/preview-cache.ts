import crypto from 'crypto';
import { GeneratedPreview, PreviewOptions } from '../types';
import { previewCache } from './cache';

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry !== undefined).map(stripUndefined);
  }

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      if (entryValue === undefined) continue;
      output[key] = stripUndefined(entryValue);
    }
    return output;
  }

  return value;
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }

  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}

function createPreviewCacheKey(url: string, options: PreviewOptions): string {
  const optionsWithoutCache: PreviewOptions = { ...options };
  delete optionsWithoutCache.cache;
  const normalized = stripUndefined({ url, options: optionsWithoutCache });
  const serialized = stableStringify(normalized);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

export function getCachedPreview(url: string, options: PreviewOptions): GeneratedPreview | undefined {
  return previewCache.get(createPreviewCacheKey(url, options));
}

export function setCachedPreview(url: string, options: PreviewOptions, preview: GeneratedPreview): void {
  previewCache.set(createPreviewCacheKey(url, options), preview);
}
