/**
 * Tests for validation utilities
 */

import {
  validateColor,
  validateDimensions,
  createTransparentCanvas,
  sanitizeOptions,
} from '../../../src/utils/validators';
import { PreviewGeneratorError, ErrorType, PreviewOptions } from '../../../src/types';

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
      expect(() => validateDimensions(Infinity, 100)).toThrow(PreviewGeneratorError);
      expect(() => validateDimensions(1200.5, 630)).toThrow(PreviewGeneratorError);
    });
  });

  describe('sanitizeOptions', () => {
    test('should not mutate nested caller options while normalizing values', () => {
      const options: PreviewOptions = {
        colors: {
          text: 'WHITE',
          background: 'DarkSlateBlue',
          accent: '#4a9eff',
        },
        fallback: {
          text: '  fallback text  ',
        },
        security: {
          timeout: 1234,
        },
        fonts: [
          {
            family: 'Inter',
            weight: '700',
          },
        ],
      };
      const originalColors = options.colors;
      const originalFallback = options.fallback;
      const originalSecurity = options.security;
      const originalFonts = options.fonts;

      const sanitized = sanitizeOptions(options);

      expect(sanitized.colors?.text).toBe('white');
      expect(sanitized.colors?.background).toBe('darkslateblue');
      expect(sanitized.fallback?.text).toBe('fallback text');

      expect(options.colors).toBe(originalColors);
      expect(options.fallback).toBe(originalFallback);
      expect(options.security).toBe(originalSecurity);
      expect(options.fonts).toBe(originalFonts);
      expect(options.colors?.text).toBe('WHITE');
      expect(options.colors?.background).toBe('DarkSlateBlue');
      expect(options.fallback?.text).toBe('  fallback text  ');

      expect(sanitized.colors).not.toBe(originalColors);
      expect(sanitized.fallback).not.toBe(originalFallback);
      expect(sanitized.security).not.toBe(originalSecurity);
      expect(sanitized.fonts).not.toBe(originalFonts);
      expect(sanitized.fonts?.[0]).not.toBe(originalFonts?.[0]);
    });

    test.each(['auto', 'generate'] as const)(
      'should preserve the supported fallback strategy %s',
      strategy => {
        expect(sanitizeOptions({ fallback: { strategy } }).fallback?.strategy).toBe(strategy);
      }
    );

    test('should reject the removed custom fallback strategy with VALIDATION_ERROR', () => {
      try {
        sanitizeOptions({
          fallback: { strategy: 'custom' },
        } as unknown as PreviewOptions);
        throw new Error('Expected sanitizeOptions to reject fallback.strategy');
      } catch (error) {
        expect(error).toBeInstanceOf(PreviewGeneratorError);
        expect((error as PreviewGeneratorError).type).toBe(ErrorType.VALIDATION_ERROR);
        expect((error as PreviewGeneratorError).message).toContain('Fallback strategy');
      }
    });

    test.each([
      ['image', 'fallback.png'],
      ['category', 'tech'],
      ['backgroundColor', undefined],
    ] as const)(
      'should reject the removed fallback option %s with VALIDATION_ERROR',
      (field, value) => {
        try {
          sanitizeOptions({
            fallback: { [field]: value },
          } as unknown as PreviewOptions);
          throw new Error(`Expected sanitizeOptions to reject fallback.${field}`);
        } catch (error) {
          expect(error).toBeInstanceOf(PreviewGeneratorError);
          expect((error as PreviewGeneratorError).type).toBe(ErrorType.VALIDATION_ERROR);
          expect((error as PreviewGeneratorError).message).toContain(`fallback.${field}`);
        }
      }
    );

    test.each([null, [], 'generate', new Date()] as const)(
      'should reject non-plain fallback options %# with VALIDATION_ERROR',
      fallback => {
        expect(() =>
          sanitizeOptions({ fallback } as unknown as PreviewOptions)
        ).toThrowError(/Fallback options must be a plain object/);
      }
    );

    test('should discard unknown runtime fallback keys', () => {
      const sanitized = sanitizeOptions({
        fallback: {
          strategy: 'generate',
          text: '  fallback text  ',
          padding: 'x'.repeat(20_000),
        },
      } as unknown as PreviewOptions);

      expect(sanitized.fallback).toEqual({
        strategy: 'generate',
        text: 'fallback text',
      });
    });

    test('should reject invalid font option shapes with validation errors', () => {
      expect(() =>
        sanitizeOptions({
          fonts: { family: 'Inter' },
        } as unknown as PreviewOptions)
      ).toThrow(PreviewGeneratorError);

      expect(() =>
        sanitizeOptions({
          fonts: [null],
        } as unknown as PreviewOptions)
      ).toThrow(PreviewGeneratorError);

      try {
        sanitizeOptions({
          fonts: { family: 'Inter' },
        } as unknown as PreviewOptions);
      } catch (error) {
        expect(error).toBeInstanceOf(PreviewGeneratorError);
        expect((error as PreviewGeneratorError).type).toBe(ErrorType.VALIDATION_ERROR);
        expect((error as PreviewGeneratorError).message).toContain('Fonts option must be an array');
      }
    });

    test.each([
      { width: 1200.5 },
      { height: 630.5 },
      { width: NaN },
      { height: Infinity },
    ])('should reject non-integer or non-finite dimensions: %o', options => {
      expect(() => sanitizeOptions(options)).toThrow(PreviewGeneratorError);
    });

    test.each([
      { quality: 90.5 },
      { quality: NaN },
      { quality: Infinity },
      { quality: '90' as unknown as number },
    ])('should reject invalid quality values: %o', options => {
      expect(() => sanitizeOptions(options)).toThrow(PreviewGeneratorError);
    });

    test.each([1, 90, 100])('should accept integer quality %i', quality => {
      expect(sanitizeOptions({ quality }).quality).toBe(quality);
    });

    test.each([true, false])('should preserve mobilePreview=%s', mobilePreview => {
      const sanitized = sanitizeOptions({ mobilePreview });

      expect(sanitized.mobilePreview).toBe(mobilePreview);
    });

    test('should accept the article template', () => {
      expect(sanitizeOptions({ template: 'article' }).template).toBe('article');
    });

    test.each(['false', 0, 1, null, {}, []])(
      'should reject non-boolean mobilePreview=%# with VALIDATION_ERROR',
      mobilePreview => {
        try {
          sanitizeOptions({ mobilePreview } as unknown as PreviewOptions);
          throw new Error('Expected sanitizeOptions to reject mobilePreview');
        } catch (error) {
          expect(error).toBeInstanceOf(PreviewGeneratorError);
          expect((error as PreviewGeneratorError).type).toBe(ErrorType.VALIDATION_ERROR);
          expect((error as PreviewGeneratorError).message).toMatch(/mobile preview/i);
        }
      }
    );

    test.each([
      NaN,
      Infinity,
      -Infinity,
      0,
      -1,
      1.5,
      30_001,
      '1000' as unknown as number,
    ])('should reject invalid security timeout %s with VALIDATION_ERROR', timeout => {
      try {
        sanitizeOptions({ security: { timeout } });
        throw new Error('Expected sanitizeOptions to reject the timeout');
      } catch (error) {
        expect(error).toBeInstanceOf(PreviewGeneratorError);
        expect((error as PreviewGeneratorError).type).toBe(ErrorType.VALIDATION_ERROR);
        expect((error as PreviewGeneratorError).message).toContain('Security timeout');
      }
    });

    test.each([1, 8000, 12000, 30_000])(
      'should preserve valid security timeout %i',
      timeout => {
        expect(sanitizeOptions({ security: { timeout } }).security?.timeout).toBe(timeout);
      }
    );

    test.each([
      ['allowSvg', 'false'],
      ['allowSvg', 1],
      ['httpsOnly', 'false'],
      ['httpsOnly', 0],
    ] as const)(
      'should reject non-boolean security option %s=%s with VALIDATION_ERROR',
      (field, value) => {
        try {
          sanitizeOptions({
            security: { [field]: value },
          } as unknown as PreviewOptions);
          throw new Error(`Expected sanitizeOptions to reject security.${field}`);
        } catch (error) {
          expect(error).toBeInstanceOf(PreviewGeneratorError);
          expect((error as PreviewGeneratorError).type).toBe(ErrorType.VALIDATION_ERROR);
          expect((error as PreviewGeneratorError).message).toContain(`Security ${field}`);
        }
      }
    );

    test.each([NaN, Infinity, -1, 1.5, 11, '3' as unknown as number])(
      'should reject invalid maxRedirects %s with VALIDATION_ERROR',
      maxRedirects => {
        try {
          sanitizeOptions({ security: { maxRedirects } });
          throw new Error('Expected sanitizeOptions to reject security.maxRedirects');
        } catch (error) {
          expect(error).toBeInstanceOf(PreviewGeneratorError);
          expect((error as PreviewGeneratorError).type).toBe(ErrorType.VALIDATION_ERROR);
          expect((error as PreviewGeneratorError).message).toContain('Security maxRedirects');
        }
      }
    );

    test.each([0, 3, 10])('should preserve valid maxRedirects %i', maxRedirects => {
      expect(sanitizeOptions({ security: { maxRedirects } }).security?.maxRedirects).toBe(
        maxRedirects
      );
    });

    test('should preserve valid boolean security options', () => {
      expect(
        sanitizeOptions({ security: { allowSvg: false, httpsOnly: true } }).security
      ).toMatchObject({ allowSvg: false, httpsOnly: true });
    });

    test('should discard unknown runtime security keys', () => {
      const sanitized = sanitizeOptions({
        security: {
          timeout: 1000,
          padding: 'x'.repeat(20_000),
        },
      } as unknown as PreviewOptions);

      expect(sanitized.security).toEqual({ timeout: 1000 });
    });

    test.each([null, [], 'unsafe', new Date()] as const)(
      'should reject non-plain security options %# with VALIDATION_ERROR',
      security => {
        expect(() =>
          sanitizeOptions({ security } as unknown as PreviewOptions)
        ).toThrowError(/Security options must be a plain object/);
      }
    );
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
