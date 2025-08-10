import { generatePreview, generatePreviewWithDetails } from '../../src/index';
import { PreviewOptions } from '../../src/types';
import axios from 'axios';
import ogs from 'open-graph-scraper';
import sharp from 'sharp';

jest.mock('axios');
jest.mock('open-graph-scraper');
jest.mock('sharp');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedOgs = ogs as jest.MockedFunction<typeof ogs>;
const mockedSharp = sharp as jest.MockedFunction<typeof sharp>;

describe('End-to-End Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mocks
    const mockSharpInstance = {
      resize: jest.fn().mockReturnThis(),
      blur: jest.fn().mockReturnThis(),
      modulate: jest.fn().mockReturnThis(),
      composite: jest.fn().mockReturnThis(),
      jpeg: jest.fn().mockReturnThis(),
      png: jest.fn().mockReturnThis(),
      toBuffer: jest.fn().mockResolvedValue(Buffer.from('generated-image')),
    };

    mockedSharp.mockReturnValue(mockSharpInstance as any);
    
    // Setup default axios response
    mockedAxios.get.mockResolvedValue({
      data: `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Test Page</title>
          <meta property="og:title" content="Test OG Title" />
          <meta property="og:description" content="Test description" />
          <meta property="og:image" content="https://example.com/image.jpg" />
        </head>
        <body></body>
        </html>
      `,
    });

    // Setup default OGS response
    mockedOgs.mockResolvedValue({
      error: false,
      result: {
        ogTitle: 'Test OG Title',
        ogDescription: 'Test description',
        ogImage: [{ url: 'https://example.com/image.jpg' }],
        ogSiteName: 'Test Site',
      },
      html: '<html></html>',
      response: {} as any,
    });
  });

  describe('generatePreview', () => {
    it('should generate preview image successfully', async () => {
      const url = 'https://example.com';
      
      const result = await generatePreview(url);

      expect(result).toBeInstanceOf(Buffer);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://example.com/',
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': 'Mozilla/5.0 (compatible; SocialPreviewBot/1.0)',
          }),
        })
      );
      expect(mockedOgs).toHaveBeenCalled();
      expect(mockedSharp).toHaveBeenCalled();
    });

    it('should use custom options', async () => {
      const url = 'https://example.com';
      const options: PreviewOptions = {
        template: 'modern',
        width: 800,
        height: 400,
        quality: 85,
        colors: {
          text: '#ffffff',
          background: '#000000',
        },
      };

      const result = await generatePreview(url, options);

      expect(result).toBeInstanceOf(Buffer);
      
      const sharpInstance = mockedSharp.mock.results[0].value;
      expect(sharpInstance.jpeg).toHaveBeenCalledWith({ quality: 85 });
    });

    it('should handle fallback when metadata extraction fails', async () => {
      const url = 'https://example.com';
      const options: PreviewOptions = {
        fallback: {
          strategy: 'generate',
        },
      };

      // Mock metadata extraction failure
      mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));
      mockedOgs.mockRejectedValueOnce(new Error('OGS error'));

      const result = await generatePreview(url, options);

      expect(result).toBeInstanceOf(Buffer);
    });

    it('should handle image fetch failure gracefully', async () => {
      const url = 'https://example.com';

      // Mock successful metadata extraction
      mockedOgs.mockResolvedValueOnce({
        error: false,
        result: {
          ogTitle: 'Test Title',
          ogImage: [{ url: 'https://example.com/broken-image.jpg' }],
        },
        html: '<html></html>',
        response: {} as any,
      });

      // Mock image fetch failure
      mockedAxios.get
        .mockResolvedValueOnce({ data: '<html></html>' }) // HTML fetch
        .mockRejectedValueOnce(new Error('Image fetch failed')); // Image fetch

      const result = await generatePreview(url);

      expect(result).toBeInstanceOf(Buffer);
    });

    it('should throw error for invalid URL', async () => {
      const invalidUrl = 'not-a-url';

      await expect(generatePreview(invalidUrl)).rejects.toThrow();
    });

    it('should throw error for unsupported template', async () => {
      const url = 'https://example.com';
      const options: PreviewOptions = {
        template: 'unsupported' as any,
      };

      await expect(generatePreview(url, options)).rejects.toThrow();
    });
  });

  describe('generatePreviewWithDetails', () => {
    it('should return detailed preview information', async () => {
      const url = 'https://example.com';
      const options: PreviewOptions = {
        width: 800,
        height: 400,
        template: 'modern',
      };

      const result = await generatePreviewWithDetails(url, options);

      expect(result).toMatchObject({
        buffer: expect.any(Buffer),
        format: 'jpeg',
        dimensions: {
          width: 800,
          height: 400,
        },
        metadata: expect.objectContaining({
          title: expect.any(String),
          url: 'https://example.com/',
        }),
        template: 'modern',
        cached: false,
      });
    });
  });

  describe('error handling', () => {
    it('should handle complete service failure', async () => {
      const url = 'https://example.com';

      // Mock all external services to fail
      mockedAxios.get.mockRejectedValue(new Error('Network failure'));
      mockedOgs.mockRejectedValue(new Error('OGS failure'));

      await expect(generatePreview(url)).rejects.toThrow();
    });

    it('should handle sharp processing errors', async () => {
      const url = 'https://example.com';

      // Mock sharp to fail
      const mockSharpInstance = {
        resize: jest.fn().mockReturnThis(),
        blur: jest.fn().mockReturnThis(),
        modulate: jest.fn().mockReturnThis(),
        composite: jest.fn().mockReturnThis(),
        jpeg: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockRejectedValue(new Error('Sharp processing error')),
      };

      mockedSharp.mockReturnValue(mockSharpInstance as any);

      await expect(generatePreview(url)).rejects.toThrow();
    });
  });

  describe('performance', () => {
    it('should complete within reasonable time', async () => {
      const url = 'https://example.com';
      const startTime = Date.now();

      await generatePreview(url);

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should handle multiple concurrent requests', async () => {
      const urls = [
        'https://example1.com',
        'https://example2.com',
        'https://example3.com',
      ];

      const promises = urls.map(url => generatePreview(url));
      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result).toBeInstanceOf(Buffer);
      });
    });
  });
});