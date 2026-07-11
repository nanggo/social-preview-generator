import type { Sharp } from 'sharp';
import { PROCESSING_TIMEOUT } from '../constants/security';

const SHARP_PROCESSING_TIMEOUT_SECONDS = Math.ceil(PROCESSING_TIMEOUT / 1000);

/**
 * Attach Sharp's native libvips timeout to an output-capable pipeline.
 *
 * Unlike a Promise race, this stops the underlying native work rather than
 * merely releasing the JavaScript caller while libvips keeps processing.
 */
export function applySharpProcessingTimeout(sharpInstance: Sharp): Sharp {
  return sharpInstance.timeout({ seconds: SHARP_PROCESSING_TIMEOUT_SECONDS });
}

/**
 * Detect the timeout error emitted by Sharp/libvips, including errors wrapped
 * by this package's PreviewGeneratorError details/cause chains.
 */
export function isSharpProcessingTimeout(error: unknown): boolean {
  const pending: unknown[] = [error];
  const visited = new Set<unknown>();

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);

    if (current instanceof Error && /(?:^|\s)timeout:\s*\d+% complete\b/i.test(current.message)) {
      return true;
    }

    if (typeof current === 'object') {
      const record = current as { cause?: unknown; details?: unknown };
      if (record.cause !== undefined) {
        pending.push(record.cause);
      }
      if (record.details !== undefined) {
        pending.push(record.details);
      }
    }
  }

  return false;
}
