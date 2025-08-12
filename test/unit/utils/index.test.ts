import {
  escapeXml,
  adjustBrightness,
  wrapText,
  generateSvgGradient,
  createSvgText,
  truncateText,
} from '../../../src/utils';

describe('Utility Functions', () => {
  describe('escapeXml', () => {
    it('should escape XML special characters', () => {
      const input = 'Test <script>alert("xss")</script> & "quotes" & \'apostrophes\'';
      const expected = 'Test &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &quot;quotes&quot; &amp; &apos;apostrophes&apos;';
      
      expect(escapeXml(input)).toBe(expected);
    });

    it('should handle empty string', () => {
      expect(escapeXml('')).toBe('');
    });

    it('should handle string with no special characters', () => {
      const input = 'Normal text with no special characters';
      expect(escapeXml(input)).toBe(input);
    });
  });

  describe('adjustBrightness', () => {
    it('should brighten hex colors', () => {
      const result = adjustBrightness('#000000', 50);
      expect(result).toBe('#7f7f7f');
    });

    it('should darken hex colors', () => {
      const result = adjustBrightness('#ffffff', -50);
      expect(result).toBe('#808080');
    });

    it('should handle RGB/RGBA colors by converting to hex and adjusting brightness', () => {
      const result = adjustBrightness('rgba(255,0,0,0.5)', 50);
      expect(result).toBe('#ff7f7f'); // rgb(255,0,0) + 50% brightness -> #ff7f7f
    });

    it('should handle named colors', () => {
      const result = adjustBrightness('red', 20);
      expect(result).toBe('#ff3333'); // red (255,0,0) + 20% brightness
    });

    it('should handle HSL colors', () => {
      const result = adjustBrightness('hsl(0, 100%, 50%)', 25); 
      expect(result).toBe('#ff4040'); // hsl(0,100%,50%) = rgb(255,0,0) + 25% brightness
    });

    it('should return original color for unparseable formats', () => {
      const invalidColor = 'invalid-color';
      expect(adjustBrightness(invalidColor, 50)).toBe(invalidColor);
    });

    it('should clamp values to valid ranges', () => {
      const result = adjustBrightness('#ffffff', 100);
      expect(result).toBe('#ffffff'); // Should stay white
    });

    it('should handle extreme negative values', () => {
      const result = adjustBrightness('#000000', -100);
      expect(result).toBe('#000000'); // Should stay black
    });
  });

  describe('wrapText', () => {
    it('should wrap text to multiple lines', () => {
      const text = 'This is a very long line that should be wrapped';
      const result = wrapText(text, 200, 20, 3);
      
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(1);
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it('should respect max lines limit', () => {
      const text = 'This is a very long line of text that should definitely be wrapped across multiple lines and then truncated with ellipsis when it exceeds the maximum number of lines allowed';
      const result = wrapText(text, 200, 20, 2);
      
      expect(result.length).toBeLessThanOrEqual(2);
      if (result.length === 2) {
        expect(result[1]).toContain('...');
      }
    });

    it('should handle single word longer than line width', () => {
      const text = 'SuperLongWordThatExceedsLineWidth';
      const result = wrapText(text, 50, 20, 2);
      
      expect(result.length).toBe(1);
      expect(result[0]).toContain('...');
    });

    it('should handle empty text', () => {
      const result = wrapText('', 100, 20, 2);
      expect(result).toEqual([]);
    });

    it('should use different font multipliers', () => {
      const text = 'Test text for font comparison';
      const interResult = wrapText(text, 200, 20, 2, 'inter');
      const defaultResult = wrapText(text, 200, 20, 2, 'default');
      
      expect(Array.isArray(interResult)).toBe(true);
      expect(Array.isArray(defaultResult)).toBe(true);
      // Inter font should potentially fit more text per line (lower multiplier)
    });
  });

  describe('generateSvgGradient', () => {
    it('should generate linear gradient SVG', () => {
      const colors = [
        { offset: '0%', color: '#ff0000' },
        { offset: '100%', color: '#0000ff' },
      ];
      
      const result = generateSvgGradient('testGradient', colors);
      
      expect(result).toContain('<linearGradient id="testGradient"');
      expect(result).toContain('stop-color:#ff0000');
      expect(result).toContain('stop-color:#0000ff');
      expect(result).toContain('offset="0%"');
      expect(result).toContain('offset="100%"');
    });

    it('should handle vertical direction', () => {
      const colors = [{ offset: '0%', color: '#000000' }];
      const result = generateSvgGradient('verticalGrad', colors, 'vertical');
      
      expect(result).toContain('y2="100%"');
    });

    it('should handle opacity values', () => {
      const colors = [
        { offset: '0%', color: '#ff0000', opacity: 0.5 },
      ];
      
      const result = generateSvgGradient('opacityGrad', colors);
      expect(result).toContain('stop-opacity:0.5');
    });
  });

  describe('createSvgText', () => {
    it('should create SVG text element', () => {
      const result = createSvgText('Hello World', 100, 200, 'title-class');
      
      expect(result).toContain('<text');
      expect(result).toContain('x="100"');
      expect(result).toContain('y="200"');
      expect(result).toContain('class="title-class"');
      expect(result).toContain('Hello World');
      expect(result).toContain('</text>');
    });

    it('should escape XML in content', () => {
      const result = createSvgText('Test <script>', 0, 0);
      expect(result).toContain('Test &lt;script&gt;');
    });

    it('should handle additional attributes', () => {
      const result = createSvgText('Text', 0, 0, 'class', {
        'text-anchor': 'middle',
        'font-size': 16,
      });
      
      expect(result).toContain('text-anchor="middle"');
      expect(result).toContain('font-size="16"');
    });

    it('should work without className', () => {
      const result = createSvgText('Text', 50, 75);
      expect(result).toContain('<text x="50" y="75"');
      expect(result).not.toContain('class=');
    });
  });

  describe('truncateText', () => {
    it('should truncate long text', () => {
      const text = 'This is a very long text that should be truncated';
      const result = truncateText(text, 20);
      
      expect(result.length).toBe(20);
      expect(result).toContain('...');
    });

    it('should not truncate short text', () => {
      const text = 'Short text';
      const result = truncateText(text, 20);
      
      expect(result).toBe(text);
    });

    it('should handle custom ellipsis', () => {
      const text = 'Long text here';
      const result = truncateText(text, 10, ' [more]');
      
      expect(result).toContain('[more]');
    });

    it('should handle edge case where max length equals text length', () => {
      const text = 'Exact length';
      const result = truncateText(text, text.length);
      
      expect(result).toBe(text);
    });
  });
});