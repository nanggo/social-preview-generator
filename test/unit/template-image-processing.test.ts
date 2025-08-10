/**
 * Tests for template-specific image processing
 */

import { generatePreview } from '../../src';
import { classicTemplate } from '../../src/templates/classic';
import { minimalTemplate } from '../../src/templates/minimal';
import { modernTemplate } from '../../src/templates/modern';

// Mock sharp to test configuration without actual image processing
jest.mock('sharp', () => {
  const mockSharp = {
    resize: jest.fn().mockReturnThis(),
    blur: jest.fn().mockReturnThis(),
    modulate: jest.fn().mockReturnThis(),
    composite: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('fake-image-data')),
    metadata: jest.fn().mockResolvedValue({ width: 1200, height: 630 }),
  };

  return jest.fn(() => mockSharp);
});

// Mock metadata extractor
jest.mock('../../src/core/metadata-extractor', () => ({
  extractMetadata: jest.fn().mockResolvedValue({
    title: 'Test Page',
    description: 'Test description',
    url: 'https://example.com',
    domain: 'example.com',
    image: 'https://example.com/image.jpg',
  }),
  fetchImage: jest.fn().mockResolvedValue(Buffer.from('fake-image-buffer')),
  validateMetadata: jest.fn().mockReturnValue(true),
  applyFallbacks: jest.fn(),
}));

describe('Template-specific image processing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Template effects configuration', () => {
    test('modern template should have blur radius 3', () => {
      expect(modernTemplate.effects?.blur?.radius).toBe(3);
    });

    test('classic template should have blur radius 0', () => {
      expect(classicTemplate.effects?.blur?.radius).toBe(0);
    });

    test('minimal template should have no image position', () => {
      expect(minimalTemplate.layout.imagePosition).toBe('none');
    });
  });

  describe('Image processing respects template configuration', () => {
    test('should process modern template with blur', async () => {
      const sharp = require('sharp');
      
      await generatePreview('https://example.com', { template: 'modern' });
      
      const mockInstance = sharp();
      expect(mockInstance.blur).toHaveBeenCalledWith(3);
    });

    test('should process classic template without blur', async () => {
      const sharp = require('sharp');
      
      await generatePreview('https://example.com', { template: 'classic' });
      
      const mockInstance = sharp();
      expect(mockInstance.blur).not.toHaveBeenCalled();
    });

    test('minimal template with imagePosition none should skip image processing', async () => {
      const { fetchImage } = require('../../src/core/metadata-extractor');
      
      await generatePreview('https://example.com', { template: 'minimal' });
      
      // fetchImage should not be called for minimal template due to imagePosition: 'none'
      expect(fetchImage).not.toHaveBeenCalled();
    });
  });

  describe('Brightness adjustments per template', () => {
    test('modern template should use darker brightness for contrast', async () => {
      const sharp = require('sharp');
      
      await generatePreview('https://example.com', { template: 'modern' });
      
      const mockInstance = sharp();
      expect(mockInstance.modulate).toHaveBeenCalledWith({ brightness: 0.7 });
    });

    test('classic template should use subtle brightness adjustment', async () => {
      const sharp = require('sharp');
      
      await generatePreview('https://example.com', { template: 'classic' });
      
      const mockInstance = sharp();
      expect(mockInstance.modulate).toHaveBeenCalledWith({ brightness: 0.9 });
    });

    test('minimal template should not adjust brightness', async () => {
      // Minimal template skips image processing entirely due to imagePosition: 'none'
      const sharp = require('sharp');
      
      await generatePreview('https://example.com', { template: 'minimal' });
      
      const mockInstance = sharp();
      expect(mockInstance.modulate).not.toHaveBeenCalled();
    });
  });
});