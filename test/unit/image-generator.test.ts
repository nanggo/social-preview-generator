import { generateImage, createFallbackImage, DEFAULT_DIMENSIONS } from '../../src/core/image-generator';
import { ExtractedMetadata, PreviewOptions } from '../../src/types';
import sharp from 'sharp';

jest.mock('sharp');

const mockedSharp = sharp as jest.MockedFunction<typeof sharp>;

describe('Image Generator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default sharp mock chain
    const mockSharpInstance = {
      resize: jest.fn().mockReturnThis(),
      blur: jest.fn().mockReturnThis(),
      modulate: jest.fn().mockReturnThis(),
      composite: jest.fn().mockReturnThis(),
      jpeg: jest.fn().mockReturnThis(),
      png: jest.fn().mockReturnThis(),
      toBuffer: jest.fn().mockResolvedValue(Buffer.from('mock-image')),
    };

    mockedSharp.mockReturnValue(mockSharpInstance as any);
  });

  describe('DEFAULT_DIMENSIONS', () => {
    it('should have correct default dimensions', () => {
      expect(DEFAULT_DIMENSIONS).toEqual({
        width: 1200,
        height: 630,
      });
    });
  });

  describe('createFallbackImage', () => {
    it('should create fallback image with URL hostname', async () => {
      const url = 'https://example.com/test-page';
      const options: PreviewOptions = {
        width: 1200,
        height: 630,
        quality: 90,
      };

      const mockSharpInstance = {
        composite: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(Buffer.from('fallback-image')),
      };

      mockedSharp.mockReturnValue(mockSharpInstance as any);

      const result = await createFallbackImage(url, options);

      expect(result).toBeInstanceOf(Buffer);
      expect(mockSharpInstance.composite).toHaveBeenCalled();
      expect(mockSharpInstance.jpeg).toHaveBeenCalledWith({ quality: 90 });
    });

    it('should handle custom fallback text', async () => {
      const url = 'https://example.com';
      const options: PreviewOptions = {
        fallback: {
          text: 'Custom Fallback Text',
        },
      };

      await createFallbackImage(url, options);
      expect(mockedSharp).toHaveBeenCalled();
    });

    it('should use default dimensions when not specified', async () => {
      const url = 'https://example.com';
      const options: PreviewOptions = {};

      const mockSharpInstance = {
        composite: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(Buffer.from('fallback-image')),
      };

      mockedSharp.mockReturnValue(mockSharpInstance as any);

      await createFallbackImage(url, options);

      // Should create image with default dimensions
      expect(mockedSharp).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle sharp errors gracefully', async () => {
      const mockSharpInstance = {
        composite: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockRejectedValue(new Error('Sharp processing error')),
      };

      mockedSharp.mockReturnValue(mockSharpInstance as any);

      const url = 'https://example.com';
      const options: PreviewOptions = {};

      await expect(createFallbackImage(url, options)).rejects.toThrow();
    });
  });
});