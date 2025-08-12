import { extractMetadata, validateMetadata, applyFallbacks, fetchImage } from '../../src/core/metadata-extractor';
import { ExtractedMetadata } from '../../src/types';
import { mockHtmlWithOg, mockHtmlMinimal, mockHtmlWithTwitter } from '../fixtures/mock-html';
import axios from 'axios';
import ogs from 'open-graph-scraper';
import * as imageSecurity from '../../src/utils/image-security';

jest.mock('axios');
jest.mock('open-graph-scraper');
jest.mock('../../src/utils/image-security');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedOgs = ogs as jest.MockedFunction<typeof ogs>;
const mockedImageSecurity = imageSecurity as jest.Mocked<typeof imageSecurity>;

describe('Metadata Extractor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock validateImageBuffer to resolve successfully for tests
    mockedImageSecurity.validateImageBuffer = jest.fn().mockResolvedValue(undefined);
  });

  describe('extractMetadata', () => {
    it('should extract Open Graph metadata successfully', async () => {
      const testUrl = 'https://example.com';
      
      mockedAxios.get.mockResolvedValueOnce({
        data: mockHtmlWithOg,
      });

      mockedOgs.mockResolvedValueOnce({
        error: false,
        result: {
          ogTitle: 'Test OG Title',
          ogDescription: 'Test OG Description',
          ogImage: [{ url: 'https://example.com/image.jpg' }],
          ogSiteName: 'Test Site',
          favicon: '/favicon.ico',
        },
        html: mockHtmlWithOg,
        response: {} as any,
      });

      const result = await extractMetadata(testUrl);

      expect(result).toEqual({
        title: 'Test OG Title',
        description: 'Test OG Description',
        image: 'https://example.com/image.jpg',
        siteName: 'Test Site',
        favicon: 'https://example.com/favicon.ico',
        url: 'https://example.com/',
        domain: 'example.com',
        locale: 'en_US',
        author: undefined,
        publishedDate: undefined,
      });
    });

    it('should handle Twitter Card metadata', async () => {
      const testUrl = 'https://twitter-example.com';
      
      mockedAxios.get.mockResolvedValueOnce({
        data: mockHtmlWithTwitter,
      });

      mockedOgs.mockResolvedValueOnce({
        error: false,
        result: {
          twitterTitle: 'Twitter Title',
          twitterDescription: 'Twitter Description',
          twitterImage: [{ url: 'https://example.com/twitter-image.jpg' }],
          twitterSite: '@testsite',
        },
        html: mockHtmlWithTwitter,
        response: {} as any,
      });

      const result = await extractMetadata(testUrl);

      expect(result.title).toBe('Twitter Title');
      expect(result.description).toBe('Twitter Description');
      expect(result.image).toBe('https://example.com/twitter-image.jpg');
    });

    it('should handle minimal metadata', async () => {
      const testUrl = 'https://minimal.com';
      
      mockedAxios.get.mockResolvedValueOnce({
        data: mockHtmlMinimal,
      });

      mockedOgs.mockResolvedValueOnce({
        error: false,
        result: {
          dcTitle: 'Minimal Page',
        },
        html: mockHtmlMinimal,
        response: {} as any,
      });

      const result = await extractMetadata(testUrl);

      expect(result.title).toBe('Minimal Page');
      expect(result.domain).toBe('minimal.com');
      expect(result.favicon).toBe('https://minimal.com/favicon.ico');
    });

    it('should throw error for invalid URL', async () => {
      const invalidUrl = 'not-a-url';

      await expect(extractMetadata(invalidUrl)).rejects.toThrow();
    });

    it('should handle network errors with fallback', async () => {
      const testUrl = 'https://error-example.com';
      
      mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));
      
      mockedOgs.mockResolvedValueOnce({
        error: false,
        result: {
          dcTitle: 'Fallback Title',
        },
        html: '<html></html>',
        response: {} as any,
      });

      const result = await extractMetadata(testUrl);
      expect(result.title).toBe('Fallback Title');
    });
  });

  describe('validateMetadata', () => {
    it('should return true for valid metadata', () => {
      const validMetadata: ExtractedMetadata = {
        title: 'Valid Title',
        url: 'https://example.com',
        domain: 'example.com',
      };

      expect(validateMetadata(validMetadata)).toBe(true);
    });

    it('should return false for metadata without title', () => {
      const invalidMetadata: ExtractedMetadata = {
        title: '',
        url: 'https://example.com',
        domain: 'example.com',
      };

      expect(validateMetadata(invalidMetadata)).toBe(false);
    });
  });

  describe('applyFallbacks', () => {
    it('should apply fallbacks for missing metadata', () => {
      const incompleteMetadata = {
        description: 'Some description',
      };
      const url = 'https://test.com/page';

      const result = applyFallbacks(incompleteMetadata, url);

      expect(result.title).toBe('test.com');
      expect(result.siteName).toBe('test.com');
      expect(result.favicon).toBe('https://test.com/favicon.ico');
      expect(result.url).toBe(url);
      expect(result.domain).toBe('test.com');
      expect(result.locale).toBe('en_US');
    });
  });

  describe('fetchImage', () => {
    it('should fetch image successfully', async () => {
      const imageUrl = 'https://example.com/image.jpg';
      // Mock JPEG image data with proper magic bytes
      const mockImageData = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, ...Array(100).fill(0)]);

      mockedAxios.get.mockResolvedValueOnce({
        data: mockImageData,
      });

      const result = await fetchImage(imageUrl);

      expect(result).toEqual(mockImageData);
      expect(mockedAxios.get).toHaveBeenCalledWith(imageUrl, expect.objectContaining({
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SocialPreviewBot/1.0)',
        },
        timeout: 12000,
        maxRedirects: 3,
        maxContentLength: 15 * 1024 * 1024,
        maxBodyLength: 15 * 1024 * 1024,
      }));
    });

    it('should throw error on fetch failure', async () => {
      const imageUrl = 'https://example.com/invalid-image.jpg';

      mockedAxios.get.mockRejectedValueOnce(new Error('Image not found'));

      await expect(fetchImage(imageUrl)).rejects.toThrow();
    });
  });
});