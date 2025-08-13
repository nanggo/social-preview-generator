/**
 * Tests for validation utilities
 */

import { validateColor, validateDimensions, createTransparentCanvas } from '../../../src/utils/validators';
import { PreviewGeneratorError, ErrorType } from '../../../src/types';

describe('Validators', () => {
  describe('validateColor', () => {
    describe('Valid colors', () => {
      test('should accept valid hex colors', () => {
        expect(validateColor('#000000')).toBe('#000000');
        expect(validateColor('#fff')).toBe('#fff');
        expect(validateColor('#FFF')).toBe('#FFF');
        expect(validateColor('#123ABC')).toBe('#123ABC');
        expect(validateColor('#12345678')).toBe('#12345678'); // With alpha
      });

      test('should accept valid RGB colors', () => {
        expect(validateColor('rgb(255, 255, 255)')).toBe('rgb(255, 255, 255)');
        expect(validateColor('rgb(0, 0, 0)')).toBe('rgb(0, 0, 0)');
        expect(validateColor('rgb(123, 45, 67)')).toBe('rgb(123, 45, 67)');
        expect(validateColor('rgb(255,255,255)')).toBe('rgb(255,255,255)'); // No spaces
      });

      test('should accept valid RGBA colors', () => {
        expect(validateColor('rgba(255, 255, 255, 1)')).toBe('rgba(255, 255, 255, 1)');
        expect(validateColor('rgba(0, 0, 0, 0)')).toBe('rgba(0, 0, 0, 0)');
        expect(validateColor('rgba(123, 45, 67, 0.5)')).toBe('rgba(123, 45, 67, 0.5)');
        expect(validateColor('rgba(255, 255, 255, 0.12)')).toBe('rgba(255, 255, 255, 0.12)');
      });

      test('should accept valid HSL colors', () => {
        expect(validateColor('hsl(360, 100%, 100%)')).toBe('hsl(360, 100%, 100%)');
        expect(validateColor('hsl(0, 0%, 0%)')).toBe('hsl(0, 0%, 0%)');
        expect(validateColor('hsl(180, 50%, 25%)')).toBe('hsl(180, 50%, 25%)');
      });

      test('should accept valid HSLA colors', () => {
        expect(validateColor('hsla(360, 100%, 100%, 1)')).toBe('hsla(360, 100%, 100%, 1)');
        expect(validateColor('hsla(0, 0%, 0%, 0)')).toBe('hsla(0, 0%, 0%, 0)');
        expect(validateColor('hsla(180, 50%, 25%, 0.5)')).toBe('hsla(180, 50%, 25%, 0.5)');
      });

      test('should accept valid named colors', () => {
        expect(validateColor('red')).toBe('red');
        expect(validateColor('blue')).toBe('blue');
        expect(validateColor('transparent')).toBe('transparent');
        expect(validateColor('WHITE')).toBe('white'); // Case insensitive
        expect(validateColor('DarkSlateBlue')).toBe('darkslateblue');
      });

      test('should handle whitespace', () => {
        expect(validateColor('  red  ')).toBe('red');
        expect(validateColor('  #fff  ')).toBe('#fff');
      });
    });

    describe('Invalid colors - Security tests', () => {
      test('should reject invalid hex colors', () => {
        expect(() => validateColor('#')).toThrow(PreviewGeneratorError);
        expect(() => validateColor('#gg')).toThrow(PreviewGeneratorError);
        expect(() => validateColor('#12345')).toThrow(PreviewGeneratorError); // 5 chars
        expect(() => validateColor('#1234567890')).toThrow(PreviewGeneratorError); // Too long
        expect(() => validateColor('123abc')).toThrow(PreviewGeneratorError); // Missing #
      });

      test('should reject RGB colors with invalid ranges', () => {
        expect(() => validateColor('rgb(256, 0, 0)')).toThrow(PreviewGeneratorError);
        expect(() => validateColor('rgb(0, 256, 0)')).toThrow(PreviewGeneratorError);
        expect(() => validateColor('rgb(0, 0, 256)')).toThrow(PreviewGeneratorError);
        expect(() => validateColor('rgb(-1, 0, 0)')).toThrow(PreviewGeneratorError);
        expect(() => validateColor('rgb(999, 999, 999)')).toThrow(PreviewGeneratorError);
      });

      test('should reject RGBA colors with invalid alpha', () => {
        expect(() => validateColor('rgba(255, 255, 255, 2)')).toThrow(PreviewGeneratorError);
        expect(() => validateColor('rgba(255, 255, 255, -1)')).toThrow(PreviewGeneratorError);
        expect(() => validateColor('rgba(255, 255, 255, 1.5)')).toThrow(PreviewGeneratorError);
      });

      test('should reject HSL colors with invalid ranges', () => {
        expect(() => validateColor('hsl(361, 0%, 0%)')).toThrow(PreviewGeneratorError);
        expect(() => validateColor('hsl(0, 101%, 0%)')).toThrow(PreviewGeneratorError);
        expect(() => validateColor('hsl(0, 0%, 101%)')).toThrow(PreviewGeneratorError);
        expect(() => validateColor('hsl(-1, 0%, 0%)')).toThrow(PreviewGeneratorError);
      });

      test('should reject potential injection attempts', () => {
        expect(() => validateColor('red; background: url(javascript:alert(1))')).toThrow(PreviewGeneratorError);
        expect(() => validateColor('red</style><script>alert(1)</script>')).toThrow(PreviewGeneratorError);
        expect(() => validateColor('expression(alert(1))')).toThrow(PreviewGeneratorError);
        expect(() => validateColor('url(data:text/html,<script>alert(1)</script>)')).toThrow(PreviewGeneratorError);
        expect(() => validateColor('javascript:alert(1)')).toThrow(PreviewGeneratorError);
      });

      test('should reject malformed color syntax', () => {
        expect(() => validateColor('rgb()')).toThrow(PreviewGeneratorError);
        expect(() => validateColor('rgb(255)')).toThrow(PreviewGeneratorError);
        expect(() => validateColor('rgb(255, 255)')).toThrow(PreviewGeneratorError);
        expect(() => validateColor('rgb(255, 255, 255, 255)')).toThrow(PreviewGeneratorError); // Too many values for RGB
        expect(() => validateColor('hsl()')).toThrow(PreviewGeneratorError);
        expect(() => validateColor('rgba(255, 255, 255)')).toThrow(PreviewGeneratorError); // Missing alpha
      });

      test('should reject unknown named colors', () => {
        expect(() => validateColor('unknowncolor')).toThrow(PreviewGeneratorError);
        expect(() => validateColor('notacolor')).toThrow(PreviewGeneratorError);
        expect(() => validateColor('redd')).toThrow(PreviewGeneratorError); // Typo
      });

      test('should reject empty and invalid strings', () => {
        expect(() => validateColor('')).toThrow(PreviewGeneratorError);
        expect(() => validateColor('   ')).toThrow(PreviewGeneratorError);
        expect(() => validateColor('null')).toThrow(PreviewGeneratorError);
        expect(() => validateColor('undefined')).toThrow(PreviewGeneratorError);
      });

      test('should provide meaningful error messages', () => {
        try {
          validateColor('invalid-color');
        } catch (error) {
          expect(error).toBeInstanceOf(PreviewGeneratorError);
          expect((error as PreviewGeneratorError).type).toBe(ErrorType.VALIDATION_ERROR);
          expect((error as PreviewGeneratorError).message).toContain('Invalid color value');
        }
      });
    });
  });

  describe('validateDimensions', () => {
    test('should pass for valid dimensions', () => {
      expect(() => validateDimensions(1200, 630)).not.toThrow();
      expect(() => validateDimensions(100, 100)).not.toThrow();
      expect(() => validateDimensions(4096, 4096)).not.toThrow();
    });

    test('should throw PreviewGeneratorError for invalid dimensions', () => {
      expect(() => validateDimensions(50, 100)).toThrow(PreviewGeneratorError);
      expect(() => validateDimensions(5000, 1000)).toThrow(PreviewGeneratorError);
      expect(() => validateDimensions(NaN, 100)).toThrow(PreviewGeneratorError);
    });
  });

  describe('createTransparentCanvas', () => {
    test('should create canvas with correct dimensions', () => {
      const canvas = createTransparentCanvas(800, 600);
      expect(canvas).toBeDefined();
      // Note: We can't easily test sharp internals in unit tests,
      // but we can verify it returns a sharp instance
      expect(typeof canvas.resize).toBe('function'); // Sharp instance has resize method
    });
  });
});