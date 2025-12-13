import { PreviewGeneratorError, ErrorType, PreviewOptions, SanitizedOptions } from '../../types';
import { ALLOWED_TEMPLATES, QUALITY_LIMITS } from '../../constants/security';
import { validateColor } from './color';
import { validateDimension, validateDimensions } from './dimensions';
import { validateTextInput } from './text';

/**
 * Validates all preview options including dimensions, quality, and colors.
 */
export function validateOptions(options: PreviewOptions): void {
  // Use the new centralized sanitization - this ensures all validation paths converge
  sanitizeOptions(options);
}

// Legacy function maintained for backward compatibility
export function validateOptionsLegacy(options: PreviewOptions): void {
  // Validate dimensions if provided
  if (options.width !== undefined || options.height !== undefined) {
    const width = options.width || 1200;
    const height = options.height || 630;
    validateDimensions(width, height);
  }

  // Validate quality if provided
  if (options.quality !== undefined) {
    if (
      !Number.isFinite(options.quality) ||
      options.quality < QUALITY_LIMITS.MIN ||
      options.quality > QUALITY_LIMITS.MAX
    ) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        `Quality must be between ${QUALITY_LIMITS.MIN} and ${QUALITY_LIMITS.MAX}, got: ${options.quality}`
      );
    }
  }

  // Validate colors if provided
  if (options.colors) {
    const colors = options.colors;

    // Validate each color property if it exists
    if (colors.primary) validateColor(colors.primary);
    if (colors.secondary) validateColor(colors.secondary);
    if (colors.background) validateColor(colors.background);
    if (colors.text) validateColor(colors.text);
    if (colors.accent) validateColor(colors.accent);
    if (colors.overlay) validateColor(colors.overlay);
  }

  // Validate template type if provided
  if (options.template !== undefined) {
    if (!ALLOWED_TEMPLATES.includes(options.template)) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        `Invalid template type: ${options.template}. Allowed templates: ${ALLOWED_TEMPLATES.join(', ')}`
      );
    }
  }

  // Validate cache option if provided
  if (options.cache !== undefined && typeof options.cache !== 'boolean') {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `Cache option must be boolean, got: ${typeof options.cache}`
    );
  }

  // Validate text inputs if provided
  if (options.fallback?.text) {
    validateTextInput(options.fallback.text, 'fallback text');
  }
}

// =============================================================================
// BRAND TYPE VALIDATORS - Phase 1.5 Advanced Security
// =============================================================================

/**
 * Central validation gateway - all external input must pass through this.
 */
export function sanitizeOptions(options: PreviewOptions): SanitizedOptions {
  // Deep validation of all nested properties
  const sanitized: PreviewOptions = {
    ...options,
  };

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
  if (sanitized.width !== undefined) {
    sanitized.width = validateDimension(sanitized.width);
  }
  if (sanitized.height !== undefined) {
    sanitized.height = validateDimension(sanitized.height);
  }

  // Validate quality
  if (sanitized.quality !== undefined) {
    if (sanitized.quality < QUALITY_LIMITS.MIN || sanitized.quality > QUALITY_LIMITS.MAX) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        `Quality must be between ${QUALITY_LIMITS.MIN} and ${QUALITY_LIMITS.MAX}`
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
