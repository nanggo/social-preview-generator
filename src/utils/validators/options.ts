import { PreviewGeneratorError, ErrorType, PreviewOptions, SanitizedOptions } from '../../types';
import {
  ALLOWED_TEMPLATES,
  DIMENSION_LIMITS,
  QUALITY_LIMITS,
} from '../../constants/security';
import { validateColor } from './color';
import { validateDimension, validateDimensions } from './dimensions';
import { validateTextInput } from './text';

const MIN_REQUEST_TIMEOUT_MS = 1;
const MAX_REQUEST_TIMEOUT_MS = 30_000;
const MIN_REDIRECTS = 0;
const MAX_REDIRECTS = 10;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Validates all preview options including dimensions, quality, and colors.
 */
export function validateOptions(options: PreviewOptions): void {
  // Use the centralized sanitization - this ensures all validation paths converge
  sanitizeOptions(options);
}

// =============================================================================
// BRAND TYPE VALIDATORS - Phase 1.5 Advanced Security
// =============================================================================

/**
 * Central validation gateway - all external input must pass through this.
 */
export function sanitizeOptions(options: PreviewOptions): SanitizedOptions {
  const sanitized: PreviewOptions = {
    ...options,
  };

  // Copy nested objects before normalizing so validation never mutates caller-owned options.
  if (options.colors) {
    sanitized.colors = { ...options.colors };
  }
  if (options.fallback !== undefined && !isPlainObject(options.fallback)) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      'Fallback options must be a plain object'
    );
  }
  if (options.fallback) {
    const fallback = options.fallback as Record<string, unknown>;
    for (const field of ['image', 'category', 'backgroundColor'] as const) {
      if (Object.hasOwn(fallback, field)) {
        throw new PreviewGeneratorError(
          ErrorType.VALIDATION_ERROR,
          `Removed fallback option is not supported: fallback.${field}`
        );
      }
    }

    if (
      fallback.strategy !== undefined &&
      fallback.strategy !== 'auto' &&
      fallback.strategy !== 'generate'
    ) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        `Fallback strategy must be "auto" or "generate", got: ${String(fallback.strategy)}`
      );
    }

    const knownFallback: Record<string, unknown> = {};
    for (const field of ['strategy', 'text'] as const) {
      if (Object.hasOwn(fallback, field)) {
        knownFallback[field] = fallback[field];
      }
    }
    sanitized.fallback = knownFallback as PreviewOptions['fallback'];
  }
  if (options.security !== undefined && !isPlainObject(options.security)) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      'Security options must be a plain object'
    );
  }
  if (options.security) {
    // Keep only the documented security surface. Unknown runtime keys must not
    // become part of metadata cache keys or retain attacker-controlled data.
    const knownSecurity: Record<string, unknown> = {};
    for (const field of ['httpsOnly', 'allowSvg', 'maxRedirects', 'timeout'] as const) {
      if (Object.hasOwn(options.security, field)) {
        knownSecurity[field] = options.security[field];
      }
    }
    sanitized.security = knownSecurity as PreviewOptions['security'];
  }
  if (options.fonts !== undefined) {
    if (!Array.isArray(options.fonts)) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        `Fonts option must be an array, got: ${typeof options.fonts}`
      );
    }

    sanitized.fonts = options.fonts.map((font, index) => {
      if (!font || typeof font !== 'object' || Array.isArray(font)) {
        throw new PreviewGeneratorError(
          ErrorType.VALIDATION_ERROR,
          `Font configuration at index ${index} must be an object`
        );
      }

      return { ...font };
    });
  }

  // Validate colors if present - ALL color properties must be validated
  if (sanitized.colors) {
    if (sanitized.colors.background) {
      // Note: validateColor now returns SanitizedColor, but we need to store as string
      // This maintains type safety at validation boundaries while preserving runtime compatibility
      sanitized.colors.background = validateColor(sanitized.colors.background);
    }
    if (sanitized.colors.text) {
      sanitized.colors.text = validateColor(sanitized.colors.text);
    }
    if (sanitized.colors.accent) {
      sanitized.colors.accent = validateColor(sanitized.colors.accent);
    }
    // Critical security fix: validate previously missing color properties
    if (sanitized.colors.primary) {
      sanitized.colors.primary = validateColor(sanitized.colors.primary);
    }
    if (sanitized.colors.secondary) {
      sanitized.colors.secondary = validateColor(sanitized.colors.secondary);
    }
    if (sanitized.colors.overlay) {
      sanitized.colors.overlay = validateColor(sanitized.colors.overlay);
    }
  }

  // Validate dimensions
  if (sanitized.width !== undefined || sanitized.height !== undefined) {
    validateDimensions(
      sanitized.width ?? DIMENSION_LIMITS.MIN_WIDTH,
      sanitized.height ?? DIMENSION_LIMITS.MIN_HEIGHT
    );
  }

  if (sanitized.width !== undefined) {
    sanitized.width = validateDimension(sanitized.width);
  }
  if (sanitized.height !== undefined) {
    sanitized.height = validateDimension(sanitized.height);
  }

  // Validate quality
  if (sanitized.quality !== undefined) {
    if (
      typeof sanitized.quality !== 'number' ||
      !Number.isFinite(sanitized.quality) ||
      !Number.isInteger(sanitized.quality)
    ) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        'Quality must be a finite integer'
      );
    }

    if (sanitized.quality < QUALITY_LIMITS.MIN || sanitized.quality > QUALITY_LIMITS.MAX) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        `Quality must be between ${QUALITY_LIMITS.MIN} and ${QUALITY_LIMITS.MAX}`
      );
    }
  }

  // Bound the total request deadline so invalid timer values cannot disable or
  // unexpectedly truncate outbound-request protection.
  if (sanitized.security?.timeout !== undefined) {
    const timeout = sanitized.security.timeout;
    if (
      typeof timeout !== 'number' ||
      !Number.isFinite(timeout) ||
      !Number.isInteger(timeout)
    ) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        'Security timeout must be a finite integer in milliseconds'
      );
    }

    if (timeout < MIN_REQUEST_TIMEOUT_MS || timeout > MAX_REQUEST_TIMEOUT_MS) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        `Security timeout must be between ${MIN_REQUEST_TIMEOUT_MS} and ${MAX_REQUEST_TIMEOUT_MS} milliseconds`
      );
    }
  }

  for (const field of ['allowSvg', 'httpsOnly'] as const) {
    const value = sanitized.security?.[field];
    if (value !== undefined && typeof value !== 'boolean') {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        `Security ${field} must be boolean, got: ${typeof value}`
      );
    }
  }

  if (sanitized.security?.maxRedirects !== undefined) {
    const maxRedirects = sanitized.security.maxRedirects;
    if (
      typeof maxRedirects !== 'number' ||
      !Number.isFinite(maxRedirects) ||
      !Number.isInteger(maxRedirects) ||
      maxRedirects < MIN_REDIRECTS ||
      maxRedirects > MAX_REDIRECTS
    ) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        `Security maxRedirects must be a finite integer between ${MIN_REDIRECTS} and ${MAX_REDIRECTS}`
      );
    }
  }

  // Validate template type
  if (sanitized.template !== undefined) {
    if (!ALLOWED_TEMPLATES.includes(sanitized.template)) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        `Invalid template type: ${sanitized.template}. Allowed templates: ${ALLOWED_TEMPLATES.join(', ')}`
      );
    }
  }

  // Validate cache option
  if (sanitized.cache !== undefined && typeof sanitized.cache !== 'boolean') {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `Cache option must be boolean, got: ${typeof sanitized.cache}`
    );
  }

  // Validate text inputs from fallback
  if (sanitized.fallback?.text) {
    sanitized.fallback = {
      ...sanitized.fallback,
      text: validateTextInput(sanitized.fallback.text, 'fallback text'),
    };
  }

  return sanitized as SanitizedOptions;
}
