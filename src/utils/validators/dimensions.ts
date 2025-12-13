import { PreviewGeneratorError, ErrorType, ValidatedDimension } from '../../types';
import { DIMENSION_LIMITS } from '../../constants/security';

/**
 * Validates image dimensions.
 */
export function validateDimensions(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, 'Dimensions must be finite numbers');
  }

  if (width < DIMENSION_LIMITS.MIN_WIDTH || height < DIMENSION_LIMITS.MIN_HEIGHT) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `Minimum dimensions: ${DIMENSION_LIMITS.MIN_WIDTH}x${DIMENSION_LIMITS.MIN_HEIGHT}`
    );
  }

  if (width > DIMENSION_LIMITS.MAX_WIDTH || height > DIMENSION_LIMITS.MAX_HEIGHT) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `Image dimensions cannot exceed ${DIMENSION_LIMITS.MAX_WIDTH}x${DIMENSION_LIMITS.MAX_HEIGHT} pixels`
    );
  }
}

/**
 * Validate dimension values.
 */
export function validateDimension(value: number): ValidatedDimension {
  if (typeof value !== 'number' || isNaN(value) || value <= 0) {
    throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, 'Dimension must be a positive number');
  }

  // Reasonable limits for image dimensions
  if (value > DIMENSION_LIMITS.MAX_WIDTH) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `Dimension exceeds maximum allowed size of ${DIMENSION_LIMITS.MAX_WIDTH} pixels`
    );
  }

  return value as ValidatedDimension;
}

