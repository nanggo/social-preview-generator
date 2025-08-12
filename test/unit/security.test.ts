/**
 * Security validation tests
 */

import { validateColor, validateUrlInput, validateTextInput, validateImageUrl } from '../../src/utils/validators';
import { PreviewGeneratorError, ErrorType } from '../../src/types';

describe('Security Validation Tests', () => {
  describe('validateColor security', () => {
    it('should reject CSS injection attempts', () => {
      const maliciousColors = [
        'red; background-image: url(javascript:alert(1))',
        'blue<script>alert(1)</script>',
        'green; @import url(evil.css)',
        'yellow/* comment */ ; background: url(data:)',
        'rgba(255,0,0,1); eval(malicious)',
        'hsl(0,100%,50%); document.write("hack")',
        '#ff0000; expression(alert(1))',
        'transparent url(javascript:void(0))',
      ];

      maliciousColors.forEach(color => {
        expect(() => validateColor(color)).toThrow(PreviewGeneratorError);
        try {
          validateColor(color);
        } catch (error) {
          expect(error).toBeInstanceOf(PreviewGeneratorError);
          expect((error as PreviewGeneratorError).type).toBe(ErrorType.VALIDATION_ERROR);
          expect((error as PreviewGeneratorError).message).toMatch(/dangerous/i);
        }
      });
    });

    it('should reject colors with suspicious patterns', () => {
      const suspiciousColors = [
        'red script alert',
        'blue eval function',
        'green window object',
        'yellow document write',
        'orange xhr fetch',
        'purple console log',
      ];

      suspiciousColors.forEach(color => {
        expect(() => validateColor(color)).toThrow(PreviewGeneratorError);
      });
    });

    it('should reject excessively long colors (DoS protection)', () => {
      const longColor = 'red'.repeat(50); // 150 characters
      expect(() => validateColor(longColor)).toThrow(PreviewGeneratorError);
    });

    it('should accept valid colors', () => {
      const validColors = [
        '#ff0000',
        '#f00',  // Changed from '#rgb' which is invalid
        'rgb(255, 0, 0)',
        'rgba(255, 0, 0, 1)',
        'hsl(0, 100%, 50%)',
        'hsla(0, 100%, 50%, 1)',
        'red',
        'transparent',
      ];

      validColors.forEach(color => {
        expect(() => validateColor(color)).not.toThrow();
      });
    });
  });

  describe('validateUrlInput security', () => {
    it('should reject dangerous protocols', () => {
      const dangerousUrls = [
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox(1)',
        'file:///etc/passwd',
        'ftp://example.com/file.txt',
      ];

      dangerousUrls.forEach(url => {
        expect(() => validateUrlInput(url)).toThrow(PreviewGeneratorError);
      });
    });

    it('should reject URLs with script injection attempts', () => {
      const maliciousUrls = [
        'https://example.com/<script>alert(1)</script>',
        'https://example.com/%3Cscript%3Ealert(1)%3C/script%3E',
        'https://example.com/javascript%3Aalert(1)',
        'https://example.com/eval(malicious)',
        'https://example.com/expression(alert)',
      ];

      maliciousUrls.forEach(url => {
        expect(() => validateUrlInput(url)).toThrow(PreviewGeneratorError);
      });
    });

    it('should reject URLs with control characters', () => {
      const urlsWithControlChars = [
        'https://example.com/\x00path',
        'https://example.com/\x1fpath',  
        // Note: \n, \r, \t are handled by URL constructor and may be normalized
      ];

      urlsWithControlChars.forEach(url => {
        expect(() => validateUrlInput(url)).toThrow(PreviewGeneratorError);
      });
    });

    it('should reject overly long URLs', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2050);
      expect(() => validateUrlInput(longUrl)).toThrow(PreviewGeneratorError);
    });

    it('should accept valid URLs', () => {
      const validUrls = [
        'https://example.com',
        'http://example.com/path',
        'https://subdomain.example.com/path?query=value',
        'https://example.com:8080/path#fragment',
      ];

      validUrls.forEach(url => {
        expect(() => validateUrlInput(url)).not.toThrow();
        const result = validateUrlInput(url);
        // URLs may be normalized by the URL constructor
        expect(result).toMatch(/^https?:\/\/.+/);
      });
    });
  });

  describe('validateTextInput security', () => {
    it('should reject script injection attempts', () => {
      const maliciousTexts = [
        '<script>alert(1)</script>',
        '</script><script>alert(1)</script>',
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'vbscript:msgbox(1)',
      ];

      maliciousTexts.forEach(text => {
        expect(() => validateTextInput(text)).toThrow(PreviewGeneratorError);
      });
    });

    it('should reject HTML injection attempts', () => {
      const htmlInjections = [
        '<iframe src="javascript:alert(1)"></iframe>',
        '<object data="javascript:alert(1)"></object>',
        '<embed src="javascript:alert(1)">',
        '<applet code="malicious"></applet>',
        '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
        '<link rel="stylesheet" href="javascript:alert(1)">',
        '<style>body{background:url(javascript:alert(1))}</style>',
      ];

      htmlInjections.forEach(text => {
        expect(() => validateTextInput(text)).toThrow(PreviewGeneratorError);
      });
    });

    it('should reject event handler injection', () => {
      const eventHandlers = [
        'onclick=alert(1)',
        'onload=alert(1)',
        'onerror=alert(1)',
        'onmouseover=alert(1)',
        'onfocus=alert(1)',
      ];

      eventHandlers.forEach(text => {
        expect(() => validateTextInput(text)).toThrow(PreviewGeneratorError);
      });
    });

    it('should reject dangerous function patterns', () => {
      const dangerousFunctions = [
        'eval(malicious)',
        'function(){alert(1)}',
        'expression(alert(1))',
      ];

      dangerousFunctions.forEach(text => {
        expect(() => validateTextInput(text)).toThrow(PreviewGeneratorError);
      });
    });

    it('should reject control characters (except allowed)', () => {
      const controlChars = [
        'text\x00with\x01null',
        'text\x08with\x0ccontrol',
        'text\x0ewith\x1fchars',
        'text\x7fwith\x80extended',
      ];

      controlChars.forEach(text => {
        expect(() => validateTextInput(text)).toThrow(PreviewGeneratorError);
      });
    });

    it('should reject excessively long text (DoS protection)', () => {
      const longText = 'a'.repeat(10001);
      expect(() => validateTextInput(longText)).toThrow(PreviewGeneratorError);
    });

    it('should accept safe text with allowed characters', () => {
      const safeTexts = [
        'Normal text content',
        'Text with números 123',
        'Text with symbols !@#$%^&*()',
        'Multi-line\ntext\nwith\nbreaks',
        'Text\twith\ttabs',
        'Text\rwith\rcarriage\rreturns',
        'Unicode text: 你好 こんにちは',
        'Emoji text: 🚀 ⭐ 💯',
      ];

      safeTexts.forEach(text => {
        expect(() => validateTextInput(text)).not.toThrow();
        expect(validateTextInput(text)).toBe(text);
      });
    });
  });

  describe('validateImageUrl security', () => {
    it('should reject image URLs with suspicious parameters', () => {
      const suspiciousImageUrls = [
        'https://example.com/image.jpg?callback=alert',
        'https://example.com/image.png?jsonp=malicious',
        'https://example.com/image.gif?eval=function',
        'https://example.com/image.webp?script=code',
      ];

      suspiciousImageUrls.forEach(url => {
        expect(() => validateImageUrl(url)).toThrow(PreviewGeneratorError);
      });
    });

    it('should accept safe image URLs', () => {
      const safeImageUrls = [
        'https://example.com/image.jpg',
        'https://example.com/path/image.png',
        'https://example.com/image.gif?width=100&height=100',
        'https://example.com/image.webp?format=auto&quality=80',
      ];

      safeImageUrls.forEach(url => {
        expect(() => validateImageUrl(url)).not.toThrow();
        expect(validateImageUrl(url)).toBe(url);
      });
    });

    it('should inherit URL validation security checks', () => {
      // Should reject dangerous protocols even for image URLs
      expect(() => validateImageUrl('javascript:alert(1)')).toThrow(PreviewGeneratorError);
      expect(() => validateImageUrl('data:image/png,malicious')).toThrow(PreviewGeneratorError);
    });
  });

  describe('Edge cases and boundary conditions', () => {
    it('should handle empty and null inputs safely', () => {
      // URL validation
      expect(() => validateUrlInput('')).toThrow(PreviewGeneratorError);
      expect(() => validateUrlInput(' ')).toThrow(PreviewGeneratorError);

      // Text validation  
      expect(() => validateTextInput('')).not.toThrow(); // Empty text should be allowed
      expect(validateTextInput('')).toBe('');

      // Color validation
      expect(() => validateColor('')).toThrow(PreviewGeneratorError);
      expect(() => validateColor('   ')).toThrow(PreviewGeneratorError);
    });

    it('should handle whitespace correctly', () => {
      // Color with whitespace should be trimmed and validated
      expect(validateColor('  red  ')).toBe('red');
      expect(validateColor(' #ff0000 ')).toBe('#ff0000');

      // URL with whitespace should be trimmed
      expect(validateUrlInput(' https://example.com ')).toBe('https://example.com/');

      // Text with whitespace should be preserved
      expect(validateTextInput('  text with spaces  ')).toBe('  text with spaces  ');
    });

    it('should validate type checking', () => {
      // Non-string inputs should be rejected
      expect(() => validateTextInput(123 as any)).toThrow(PreviewGeneratorError);
      expect(() => validateTextInput(null as any)).toThrow(PreviewGeneratorError);
      expect(() => validateTextInput(undefined as any)).toThrow(PreviewGeneratorError);
    });
  });
});