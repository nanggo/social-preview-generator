/**
 * Validation utilities for Social Preview Generator
 */

import { PreviewGeneratorError, ErrorType } from '../types';

/**
 * Validate image dimensions
 */
export function validateDimensions(width: number, height: number): void {
  if (width < 100 || height < 100) {
    throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, 'Minimum dimensions: 100x100');
  }
  if (width > 10000 || height > 10000) {
    throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, 'Maximum dimensions: 10000x10000');
  }
}