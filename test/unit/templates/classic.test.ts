import { classicTemplate, generateClassicOverlay } from '../../../src/templates/classic';
import { ExtractedMetadata, PreviewOptions } from '../../../src/types';

describe('Classic Template', () => {
  describe('classicTemplate config', () => {
    it('should have correct template configuration', () => {
      expect(classicTemplate.name).toBe('classic');
      expect(classicTemplate.layout.padding).toBe(60);
      expect(classicTemplate.layout.titlePosition).toBe('left');
      expect(classicTemplate.typography.title.fontSize).toBe(48);
      expect(classicTemplate.typography.description?.fontSize).toBe(24);
    });

    it('should have traditional design characteristics', () => {
      expect(classicTemplate.effects?.borderRadius).toBe(8);
      expect(classicTemplate.effects?.shadow?.box).toBe(true);
      expect(classicTemplate.effects?.shadow?.text).toBe(false);
      expect(classicTemplate.typography.title.maxLines).toBe(3);
    });
  });

  describe('generateClassicOverlay', () => {
    const mockMetadata: ExtractedMetadata = {
      title: 'Traditional Business Article',
      description: 'This is a comprehensive business analysis with traditional values and conservative approach',
      siteName: 'Business Times',
      url: 'https://example.com',
      domain: 'example.com',
    };

    it('should generate SVG overlay with classic styling', () => {
      const width = 1200;
      const height = 630;
      const options: PreviewOptions = {};

      const svg = generateClassicOverlay(mockMetadata, width, height, options);

      expect(svg).toContain('<svg');
      expect(svg).toContain('Traditional Business');
      expect(svg).toContain('comprehensive business analysis');
      expect(svg).toContain('Business Times');
      expect(svg).toContain(`width="${width}"`);
      expect(svg).toContain(`height="${height}"`);
    });

    it('should use serif fonts for classic typography', () => {
      const svg = generateClassicOverlay(mockMetadata, 1200, 630, {});

      expect(svg).toContain('Georgia, \'Times New Roman\', serif');
      expect(svg).toContain('class="classic-title"');
      expect(svg).toContain('class="classic-description"');
    });

    it('should apply conservative color scheme', () => {
      const options: PreviewOptions = {
        colors: {
          text: '#1a1a1a',
          accent: '#2c5aa0',
          background: '#ffffff',
        },
      };

      const svg = generateClassicOverlay(mockMetadata, 1200, 630, options);

      expect(svg).toContain('#1a1a1a');
      expect(svg).toContain('#2c5aa0');
      expect(svg).toContain('#ffffff');
    });

    it('should handle long titles with proper wrapping', () => {
      const longTitleMetadata: ExtractedMetadata = {
        ...mockMetadata,
        title: 'This is an extremely long business title that should be properly wrapped across multiple lines according to classic template specifications',
      };

      const svg = generateClassicOverlay(longTitleMetadata, 1200, 630, {});

      expect(svg).toContain('This is an extremely');
      // Should create multiple text elements for wrapped lines
      const titleElements = svg.match(/class="classic-title"/g);
      expect(titleElements).toHaveLength(3); // Should wrap to max 3 lines
    });

    it('should handle missing description gracefully', () => {
      const noDescMetadata: ExtractedMetadata = {
        title: 'Business Title',
        url: 'https://example.com',
        domain: 'example.com',
      };

      const svg = generateClassicOverlay(noDescMetadata, 1200, 630, {});

      expect(svg).toContain('Business Title');
      expect(svg).not.toContain('class="classic-description"');
    });

    it('should include decorative elements', () => {
      const svg = generateClassicOverlay(mockMetadata, 1200, 630, {});

      // Should include accent line
      expect(svg).toContain('height="3"'); // Accent line
      expect(svg).toContain('Decorative element'); // Comment for decorative rect
      expect(svg).toContain('Corner accent'); // Comment for corner element
    });

    it('should position elements according to classic layout', () => {
      const svg = generateClassicOverlay(mockMetadata, 1200, 630, {});

      // Should use left alignment and proper spacing
      expect(svg).toContain('x="60"'); // Left padding
      expect(svg).toContain('text-anchor="middle"'); // For image placeholder
    });

    it('should include site name in header', () => {
      const svg = generateClassicOverlay(mockMetadata, 1200, 630, {});

      expect(svg).toContain('class="classic-sitename"');
      expect(svg).toContain('Business Times'); // Uppercase transformation
      expect(svg).toContain('text-transform: uppercase');
    });

    it('should handle missing site name', () => {
      const noSiteMetadata: ExtractedMetadata = {
        title: 'Business Title',
        description: 'Business description',
        url: 'https://example.com',
        domain: 'example.com',
      };

      const svg = generateClassicOverlay(noSiteMetadata, 1200, 630, {});

      expect(svg).toContain('Business Title');
      expect(svg).not.toContain('class="classic-sitename"');
    });

    it('should include image placeholder when no background image', () => {
      const svg = generateClassicOverlay(mockMetadata, 1200, 630, {});

      expect(svg).toContain('Image placeholder');
      expect(svg).toContain('Business Times'); // Site name in placeholder
    });

    it('should apply custom colors when provided', () => {
      const options: PreviewOptions = {
        colors: {
          text: '#2c3e50',
          accent: '#e74c3c',
          background: '#f8f9fa',
        },
      };

      const svg = generateClassicOverlay(mockMetadata, 1200, 630, options);

      expect(svg).toContain('#2c3e50');
      expect(svg).toContain('#e74c3c');
      expect(svg).toContain('#f8f9fa');
    });

    it('should handle different dimensions', () => {
      const width = 800;
      const height = 400;

      const svg = generateClassicOverlay(mockMetadata, width, height, {});

      expect(svg).toContain(`width="${width}"`);
      expect(svg).toContain(`height="${height}"`);
      
      // Should adjust layout proportions
      expect(svg).toContain('Traditional');
    });

    it('should escape XML special characters', () => {
      const xmlMetadata: ExtractedMetadata = {
        title: 'Title with <tags> & "quotes"',
        description: 'Description with <script>alert("xss")</script>',
        siteName: 'Site & Company',
        url: 'https://example.com',
        domain: 'example.com',
      };

      const svg = generateClassicOverlay(xmlMetadata, 1200, 630, {});

      expect(svg).toContain('&lt;tags&gt;');
      expect(svg).toContain('&amp;');
      expect(svg).toContain('&quot;quotes&quot;');
      expect(svg).toContain('&lt;script&gt;');
      expect(svg).toContain('Site &amp; Company');
    });

  });
});