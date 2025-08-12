import { minimalTemplate, generateMinimalOverlay } from '../../../src/templates/minimal';
import { ExtractedMetadata, PreviewOptions } from '../../../src/types';

describe('Minimal Template', () => {
  describe('minimalTemplate config', () => {
    it('should have correct template configuration', () => {
      expect(minimalTemplate.name).toBe('minimal');
      expect(minimalTemplate.layout.padding).toBe(100);
      expect(minimalTemplate.layout.titlePosition).toBe('center');
      expect(minimalTemplate.typography.title.fontSize).toBe(64);
      expect(minimalTemplate.typography.description?.fontSize).toBe(26);
    });

    it('should have minimalist design characteristics', () => {
      expect(minimalTemplate.effects?.borderRadius).toBe(0);
      expect(minimalTemplate.effects?.shadow?.box).toBe(false);
      expect(minimalTemplate.effects?.shadow?.text).toBe(false);
      expect(minimalTemplate.effects?.gradient?.type).toBe('none');
      expect(minimalTemplate.typography.title.fontWeight).toBe('300'); // Light weight
    });

    it('should prioritize readability with proper line heights', () => {
      expect(minimalTemplate.typography.title.lineHeight).toBe(1.1);
      expect(minimalTemplate.typography.description?.lineHeight).toBe(1.6);
      expect(minimalTemplate.typography.title.maxLines).toBe(2);
    });
  });

  describe('generateMinimalOverlay', () => {
    const mockMetadata: ExtractedMetadata = {
      title: 'Clean Design Principles',
      description: 'Exploring the power of minimalism in modern digital design',
      siteName: 'Design Studio',
      url: 'https://example.com',
      domain: 'example.com',
    };

    it('should generate SVG overlay with minimal styling', () => {
      const width = 1200;
      const height = 630;
      const options: PreviewOptions = {};

      const svg = generateMinimalOverlay(mockMetadata, width, height, options);

      expect(svg).toContain('<svg');
      expect(svg).toContain('Clean Design Principles');
      expect(svg).toContain('Exploring the power of minimalism');
      expect(svg).toContain('DESIGN STUDIO');
      expect(svg).toContain(`width="${width}"`);
      expect(svg).toContain(`height="${height}"`);
    });

    it('should use light typography for minimal aesthetic', () => {
      const svg = generateMinimalOverlay(mockMetadata, 1200, 630, {});

      expect(svg).toContain('font-weight: 300');
      expect(svg).toContain('class="minimal-title"');
      expect(svg).toContain('class="minimal-description"');
      expect(svg).toContain('-apple-system');
    });

    it('should center all content', () => {
      const svg = generateMinimalOverlay(mockMetadata, 1200, 630, {});

      // All text should be center-aligned
      expect(svg).toContain('text-anchor="middle"');
      expect(svg).toContain('x="600"'); // width/2 for centering
    });

    it('should apply monochromatic color scheme by default', () => {
      const svg = generateMinimalOverlay(mockMetadata, 1200, 630, {});

      expect(svg).toContain('#000000'); // Default text color
      expect(svg).toContain('#ffffff'); // Default background
    });

    it('should handle custom colors', () => {
      const options: PreviewOptions = {
        colors: {
          text: '#2c2c2c',
          accent: '#1a1a1a',
          background: '#fafafa',
        },
      };

      const svg = generateMinimalOverlay(mockMetadata, 1200, 630, options);

      expect(svg).toContain('#2c2c2c');
      expect(svg).toContain('#1a1a1a');
      expect(svg).toContain('#fafafa');
    });

    it('should handle long titles with minimal wrapping', () => {
      const longTitleMetadata: ExtractedMetadata = {
        ...mockMetadata,
        title: 'This is an exceptionally long title that demonstrates how the minimal template handles text wrapping with generous spacing',
      };

      const svg = generateMinimalOverlay(longTitleMetadata, 1200, 630, {});

      expect(svg).toContain('This is an exceptionally');
      // Should wrap to max 2 lines
      const titleElements = svg.match(/class="minimal-title"/g);
      expect(titleElements).toHaveLength(2);
    });

    it('should handle missing description gracefully', () => {
      const noDescMetadata: ExtractedMetadata = {
        title: 'Simple Title',
        url: 'https://example.com',
        domain: 'example.com',
      };

      const svg = generateMinimalOverlay(noDescMetadata, 1200, 630, {});

      expect(svg).toContain('Simple Title');
      expect(svg).not.toContain('class="minimal-description"');
    });

    it('should include minimal geometric accents', () => {
      const svg = generateMinimalOverlay(mockMetadata, 1200, 630, {});

      // Should include subtle circles as accent elements
      expect(svg).toContain('<circle');
      expect(svg).toContain('Minimal geometric accent');
      expect(svg).toContain('r="1.5"');
    });

    it('should include subtle corner elements', () => {
      const svg = generateMinimalOverlay(mockMetadata, 1200, 630, {});

      expect(svg).toContain('Subtle corner elements');
      expect(svg).toContain('opacity="0.1"');
      // Should have corner rectangles
      expect(svg).toContain('x="40" y="40"');
    });

    it('should handle missing site name', () => {
      const noSiteMetadata: ExtractedMetadata = {
        title: 'Clean Title',
        description: 'Clean description',
        url: 'https://example.com',
        domain: 'example.com',
      };

      const svg = generateMinimalOverlay(noSiteMetadata, 1200, 630, {});

      expect(svg).toContain('Clean Title');
      expect(svg).not.toContain('class="minimal-sitename"');
      expect(svg).toContain('example.com'); // Should still show domain
    });

    it('should include divider line when branding present', () => {
      const svg = generateMinimalOverlay(mockMetadata, 1200, 630, {});

      expect(svg).toContain('Optional divider line');
      expect(svg).toContain('<line');
      expect(svg).toContain('stroke-width="1"');
    });

    it('should use generous white space', () => {
      const svg = generateMinimalOverlay(mockMetadata, 1200, 630, {});

      // Should have large padding (100px)
      expect(svg).toContain('Clean Design Principles');
      // Content should be vertically centered with spacing
      expect(svg).toContain('text-anchor="middle"');
    });

    it('should handle different dimensions proportionally', () => {
      const width = 800;
      const height = 400;

      const svg = generateMinimalOverlay(mockMetadata, width, height, {});

      expect(svg).toContain(`width="${width}"`);
      expect(svg).toContain(`height="${height}"`);
      expect(svg).toContain('x="400"'); // width/2 for centering
    });

    it('should escape XML special characters', () => {
      const xmlMetadata: ExtractedMetadata = {
        title: 'Title & <symbols>',
        description: 'Description with "quotes" & <tags>',
        siteName: 'Site & Co',
        url: 'https://example.com',
        domain: 'example.com',
      };

      const svg = generateMinimalOverlay(xmlMetadata, 1200, 630, {});

      expect(svg).toContain('&amp;');
      expect(svg).toContain('&lt;symbols&gt;');
      expect(svg).toContain('&quot;quotes&quot;');
      expect(svg).toContain('SITE &amp; CO');
    });

    it('should maintain minimal opacity hierarchy', () => {
      const svg = generateMinimalOverlay(mockMetadata, 1200, 630, {});

      expect(svg).toContain('opacity: 0.7'); // Description
      expect(svg).toContain('opacity: 0.6'); // Site name  
      expect(svg).toContain('opacity: 0.4'); // Domain
      expect(svg).toContain('opacity="0.3"'); // Accent circles
      expect(svg).toContain('opacity="0.1"'); // Corner elements
    });

    it('should work without any branding elements', () => {
      const minimalMetadata: ExtractedMetadata = {
        title: 'Pure Content',
        url: 'https://example.com',
      };

      const svg = generateMinimalOverlay(minimalMetadata, 1200, 630, {});

      expect(svg).toContain('Pure Content');
      expect(svg).not.toContain('class="minimal-sitename"');
      expect(svg).not.toContain('class="minimal-domain"');
      // Should still include geometric accents
      expect(svg).toContain('<circle');
    });

  });
});