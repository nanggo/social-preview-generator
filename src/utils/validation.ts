/**
 * Validation utilities for Social Preview Generator
 */

import { PreviewGeneratorError, ErrorType } from '../types';

/**
 * Validate image dimensions
 */
export function validateDimensions(width: number, height: number): void {
  // Check for non-finite numbers (NaN, Infinity, -Infinity)
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      'Dimensions must be finite numbers'
    );
  }

  // Check for negative values
  if (width <= 0 || height <= 0) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      'Dimensions must be positive numbers'
    );
  }

  // Check minimum dimensions
  if (width < 100 || height < 100) {
    throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, 'Minimum dimensions: 100x100');
  }

  // Check maximum dimensions
  if (width > 10000 || height > 10000) {
    throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, 'Maximum dimensions: 10000x10000');
  }
}
