/**
 * Tests for validation utilities
 */

import { validateDimensions } from '../../../src/utils/validation';
import { PreviewGeneratorError, ErrorType } from '../../../src/types';

describe('Validation utilities', () => {
  describe('validateDimensions', () => {
    test('should pass for valid dimensions', () => {
      expect(() => validateDimensions(1200, 630)).not.toThrow();
      expect(() => validateDimensions(100, 100)).not.toThrow();
      expect(() => validateDimensions(10000, 10000)).not.toThrow();
    });

    test('should throw for dimensions too small', () => {
      expect(() => validateDimensions(50, 100)).toThrow(PreviewGeneratorError);
      expect(() => validateDimensions(100, 50)).toThrow(PreviewGeneratorError);
      expect(() => validateDimensions(0, 0)).toThrow(PreviewGeneratorError);
      
      try {
        validateDimensions(50, 50);
      } catch (error) {
        expect(error).toBeInstanceOf(PreviewGeneratorError);
        expect((error as PreviewGeneratorError).type).toBe(ErrorType.VALIDATION_ERROR);
        expect((error as PreviewGeneratorError).message).toBe('Minimum dimensions: 100x100');
      }
    });

    test('should throw for dimensions too large', () => {
      expect(() => validateDimensions(15000, 1000)).toThrow(PreviewGeneratorError);
      expect(() => validateDimensions(1000, 15000)).toThrow(PreviewGeneratorError);
      expect(() => validateDimensions(20000, 20000)).toThrow(PreviewGeneratorError);
      
      try {
        validateDimensions(15000, 15000);
      } catch (error) {
        expect(error).toBeInstanceOf(PreviewGeneratorError);
        expect((error as PreviewGeneratorError).type).toBe(ErrorType.VALIDATION_ERROR);
        expect((error as PreviewGeneratorError).message).toBe('Maximum dimensions: 10000x10000');
      }
    });

    test('should handle edge cases', () => {
      expect(() => validateDimensions(99, 100)).toThrow();
      expect(() => validateDimensions(100, 99)).toThrow();
      expect(() => validateDimensions(10001, 10000)).toThrow();
      expect(() => validateDimensions(10000, 10001)).toThrow();
    });
  });
});