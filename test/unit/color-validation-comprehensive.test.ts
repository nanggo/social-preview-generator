/**
 * Comprehensive Color Validation Tests - Gemini PR Review Fix
 * Tests for complete color property validation in sanitizeOptions
 */

import { sanitizeOptions } from '../../src/utils/validators';
import { PreviewGeneratorError, ErrorType, PreviewOptions } from '../../src/types';

describe('Complete Color Validation in sanitizeOptions', () => {
  describe('All color properties validation', () => {
    it('should validate all color properties: background, text, accent, primary, secondary, overlay', () => {
      const validOptions: PreviewOptions = {
        colors: {
          background: '#ffffff',
          text: '#000000',
          accent: '#ff6b35',
          primary: 'blue',
          secondary: 'rgb(255, 0, 0)',
          overlay: 'rgba(0, 0, 0, 0.5)',
        }
      };

      // Should not throw - all colors are valid
      expect(() => sanitizeOptions(validOptions)).not.toThrow();
    });

    it('should reject invalid background color', () => {
      const invalidOptions: PreviewOptions = {
        colors: {
          background: 'javascript:alert(1)',
        }
      };

      expect(() => sanitizeOptions(invalidOptions)).toThrow(PreviewGeneratorError);
      expect(() => sanitizeOptions(invalidOptions)).toThrow(/Invalid color value/);
    });

    it('should reject invalid text color', () => {
      const invalidOptions: PreviewOptions = {
        colors: {
          text: '<script>alert(1)</script>',
        }
      };

      expect(() => sanitizeOptions(invalidOptions)).toThrow(PreviewGeneratorError);
    });

    it('should reject invalid accent color', () => {
      const invalidOptions: PreviewOptions = {
        colors: {
          accent: 'url(evil.com)',
        }
      };

      expect(() => sanitizeOptions(invalidOptions)).toThrow(PreviewGeneratorError);
    });

    it('should reject invalid primary color (CRITICAL FIX)', () => {
      const invalidOptions: PreviewOptions = {
        colors: {
          primary: 'expression(alert(1))',
        }
      };

      expect(() => sanitizeOptions(invalidOptions)).toThrow(PreviewGeneratorError);
      expect(() => sanitizeOptions(invalidOptions)).toThrow(/Invalid color value/);
    });

    it('should reject invalid secondary color (CRITICAL FIX)', () => {
      const invalidOptions: PreviewOptions = {
        colors: {
          secondary: 'data:text/html,<script>alert(1)</script>',
        }
      };

      expect(() => sanitizeOptions(invalidOptions)).toThrow(PreviewGeneratorError);
    });

    it('should reject invalid overlay color (CRITICAL FIX)', () => {
      const invalidOptions: PreviewOptions = {
        colors: {
          overlay: '@import url(evil.css)',
        }
      };

      expect(() => sanitizeOptions(invalidOptions)).toThrow(PreviewGeneratorError);
    });
  });

  describe('Mixed valid and invalid colors', () => {
    it('should accept valid colors and reject on first invalid color', () => {
      const mixedOptions: PreviewOptions = {
        colors: {
          background: '#ffffff',  // Valid
          text: '#000000',       // Valid
          primary: 'javascript:alert(1)',  // Invalid - should fail here
          secondary: 'blue',     // Would be valid if we got here
        }
      };

      expect(() => sanitizeOptions(mixedOptions)).toThrow(PreviewGeneratorError);
    });
  });

  describe('Edge cases', () => {
    it('should handle undefined colors gracefully', () => {
      const optionsWithUndefinedColors: PreviewOptions = {
        colors: {
          background: '#ffffff',
          // Other colors undefined
        }
      };

      expect(() => sanitizeOptions(optionsWithUndefinedColors)).not.toThrow();
    });

    it('should handle empty colors object', () => {
      const optionsWithEmptyColors: PreviewOptions = {
        colors: {}
      };

      expect(() => sanitizeOptions(optionsWithEmptyColors)).not.toThrow();
    });

    it('should handle no colors property', () => {
      const optionsWithoutColors: PreviewOptions = {
        width: 1200,
        height: 630
      };

      expect(() => sanitizeOptions(optionsWithoutColors)).not.toThrow();
    });
  });

  describe('Security regression prevention', () => {
    it('should prevent CSS injection through primary color', () => {
      const maliciousOptions: PreviewOptions = {
        colors: {
          primary: 'red; background: url(evil.com); color: ',
        }
      };

      expect(() => sanitizeOptions(maliciousOptions)).toThrow(PreviewGeneratorError);
    });

    it('should prevent script injection through secondary color', () => {
      const maliciousOptions: PreviewOptions = {
        colors: {
          secondary: 'red</style><script>alert("XSS")</script><style>',
        }
      };

      expect(() => sanitizeOptions(maliciousOptions)).toThrow(PreviewGeneratorError);
    });

    it('should prevent function injection through overlay color', () => {
      const maliciousOptions: PreviewOptions = {
        colors: {
          overlay: 'rgba(eval(malicious_code()), 0, 0, 0.5)',
        }
      };

      expect(() => sanitizeOptions(maliciousOptions)).toThrow(PreviewGeneratorError);
    });
  });
});