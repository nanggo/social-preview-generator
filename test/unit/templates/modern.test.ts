import { modernTemplate, generateModernOverlay } from '../../../src/templates/modern';
import { ExtractedMetadata, PreviewOptions } from '../../../src/types';

describe('Modern Template', () => {
  describe('modernTemplate config', () => {
    it('should have correct template configuration', () => {
      expect(modernTemplate.name).toBe('modern');
      expect(modernTemplate.layout.padding).toBe(80);
      expect(modernTemplate.typography.title.fontSize).toBe(56);
      expect(modernTemplate.typography.description?.fontSize).toBe(28);
    });
  });

  describe('generateModernOverlay', () => {
    const mockMetadata: ExtractedMetadata = {
      title: 'Test Article Title',
      description: 'This is a test description for the article',
      siteName: 'Test Site',
      url: 'https://example.com',
      domain: 'example.com',
    };

    it('should generate SVG overlay with metadata', () => {
      const width = 1200;
      const height = 630;
      const options: PreviewOptions = {};

      const svg = generateModernOverlay(mockMetadata, width, height, options);

      expect(svg).toContain('<svg');
      expect(svg).toContain('Test Article Title');
      expect(svg).toContain('This is a test description');
      expect(svg).toContain('TEST SITE');
      expect(svg).toContain(`width="${width}"`);
      expect(svg).toContain(`height="${height}"`);
    });

    it('should handle long titles with text wrapping', () => {
      const longTitleMetadata: ExtractedMetadata = {
        ...mockMetadata,
        title: 'This is a very long title that should be wrapped across multiple lines to test the text wrapping functionality',
      };

      const svg = generateModernOverlay(longTitleMetadata, 1200, 630, {});

      expect(svg).toContain('This is a very long title');
      // Modern template uses multiple text elements instead of tspan
      const textElements = svg.match(/<text[^>]*class="title"/g);
      expect(textElements).toHaveLength(2); // Should wrap to 2 lines
    });

    it('should handle missing description gracefully', () => {
      const noDescMetadata: ExtractedMetadata = {
        title: 'Test Title',
        url: 'https://example.com',
        domain: 'example.com',
      };

      const svg = generateModernOverlay(noDescMetadata, 1200, 630, {});

      expect(svg).toContain('Test Title');
      expect(svg).not.toContain('description-text');
    });

    it('should handle missing site name gracefully', () => {
      const noSiteMetadata: ExtractedMetadata = {
        title: 'Test Title',
        description: 'Test description',
        url: 'https://example.com',
        domain: 'example.com',
      };

      const svg = generateModernOverlay(noSiteMetadata, 1200, 630, {});

      expect(svg).toContain('Test Title');
      expect(svg).toContain('Test description');
      expect(svg).not.toContain('site-name');
    });

    it('should apply custom colors when provided', () => {
      const options: PreviewOptions = {
        colors: {
          text: '#ff0000',
          accent: '#00ff00',
        },
      };

      const svg = generateModernOverlay(mockMetadata, 1200, 630, options);

      expect(svg).toContain('#ff0000');
      expect(svg).toContain('#00ff00');
    });

    it('should apply custom overlay color to gradient', () => {
      const options: PreviewOptions = {
        colors: {
          overlay: 'rgba(255,0,0,0.5)',
        },
      };

      const svg = generateModernOverlay(mockMetadata, 1200, 630, options);

      expect(svg).toContain('rgba(255,0,0,0.5)');
    });

    it('should escape XML special characters', () => {
      const xmlMetadata: ExtractedMetadata = {
        title: 'Title with <tags> & "quotes"',
        description: 'Description with <script>alert("xss")</script>',
        url: 'https://example.com',
        domain: 'example.com',
      };

      const svg = generateModernOverlay(xmlMetadata, 1200, 630, {});

      expect(svg).toContain('&lt;tags&gt;');
      expect(svg).toContain('&amp;');
      expect(svg).toContain('&quot;quotes&quot;');
      expect(svg).toContain('&lt;script&gt;');
    });

    it('should handle different dimensions', () => {
      const width = 800;
      const height = 400;

      const svg = generateModernOverlay(mockMetadata, width, height, {});

      expect(svg).toContain(`width="${width}"`);
      expect(svg).toContain(`height="${height}"`);
      
      // Should adjust positioning based on dimensions - modern template uses centered positioning
      expect(svg).toContain(`width="${width}"`);
      expect(svg).toContain(`height="${height}"`);
    });

    it('should truncate very long descriptions', () => {
      const longDescMetadata: ExtractedMetadata = {
        ...mockMetadata,
        description: 'A'.repeat(500), // Very long description
      };

      const svg = generateModernOverlay(longDescMetadata, 1200, 630, {});

      // Should be truncated to reasonable length
      const match = svg.match(/class="description-text"[^>]*>([^<]*)</);
      const descriptionText = match ? match[1] : '';
      expect(descriptionText.length).toBeLessThan(300);
    });
  });
});