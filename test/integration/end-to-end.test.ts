import { vi } from 'vitest';
import {
  clearAllCaches,
  clearInflightRequests,
  generatePreview,
  generatePreviewFromMetadata,
  generatePreviewFromMetadataWithDetails,
  generatePreviewWithDetails,
} from '../../src/index';
import { ErrorType, PreviewOptions, TemplateType } from '../../src/types';
import axios from 'axios';
import ogs from 'open-graph-scraper';
import sharp from 'sharp';
import { metadataCache } from '../../src/utils/cache';
import { templates } from '../../src/templates/registry';
import { validateRequestSecurity } from '../../src/utils/enhanced-secure-agent';

vi.mock('axios');
vi.mock('open-graph-scraper');
vi.mock('sharp');
vi.mock('../../src/utils/enhanced-secure-agent', () => ({
  getEnhancedSecureAgentForUrl: vi.fn(() => undefined),
  getEnhancedSecureHttpAgent: vi.fn(() => undefined),
  getEnhancedSecureHttpsAgent: vi.fn(() => undefined),
  validateRequestSecurity: vi.fn().mockResolvedValue({
    allowed: true,
    blockedIPs: [],
    allowedIPs: [],
  }),
}));

const mockedAxios = axios as vi.Mocked<typeof axios>;
const mockedOgs = ogs as vi.MockedFunction<typeof ogs>;
const mockedSharp = sharp as vi.MockedFunction<typeof sharp>;
const mockedValidateRequestSecurity = vi.mocked(validateRequestSecurity);

describe('End-to-End Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset axios/ogs implementations to clear leftover once-mock queues from previous tests
    // (clearAllMocks only clears call data, not once-value queues)
    mockedAxios.get.mockReset();
    mockedOgs.mockReset();
    mockedValidateRequestSecurity.mockReset().mockResolvedValue({
      allowed: true,
      blockedIPs: [],
      allowedIPs: [],
    });
    clearAllCaches();
    clearInflightRequests();
    metadataCache.clear();

    // Setup default mocks
    const mockSharpInstance = {
      timeout: vi.fn().mockReturnThis(),
      resize: vi.fn().mockReturnThis(),
      blur: vi.fn().mockReturnThis(),
      modulate: vi.fn().mockReturnThis(),
      composite: vi.fn().mockReturnThis(),
      jpeg: vi.fn().mockReturnThis(),
      png: vi.fn().mockReturnThis(),
      metadata: vi.fn().mockResolvedValue({ width: 1200, height: 630, format: 'png' }),
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('generated-image')),
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
      expect(sharpInstance.jpeg).toHaveBeenCalledWith({
        quality: 85,
        progressive: true,
        mozjpeg: true,
      });
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

  describe('Template-specific generation', () => {
    it('should generate modern template successfully', async () => {
      const url = 'https://example.com';
      const options: PreviewOptions = { template: 'modern' };

      const result = await generatePreview(url, options);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(10);
    });

    it('should generate classic template successfully', async () => {
      const url = 'https://example.com';
      const options: PreviewOptions = { template: 'classic' };

      const result = await generatePreview(url, options);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(10);
    });

    it('should generate minimal template successfully', async () => {
      const url = 'https://example.com';
      const options: PreviewOptions = { template: 'minimal' };

      const result = await generatePreview(url, options);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(10);
    });

    it('should handle template-specific color options', async () => {
      const url = 'https://example.com';

      // Test each template with custom colors
      const templates: TemplateType[] = ['modern', 'classic', 'minimal', 'article'];

      for (const template of templates) {
        const options: PreviewOptions = {
          template,
          colors: {
            text: '#333333',
            accent: '#007acc',
            background: '#f5f5f5',
          },
        };

        const result = await generatePreview(url, options);

        expect(result).toBeInstanceOf(Buffer);
        expect(result.length).toBeGreaterThan(10);
      }
    });

    it('should handle long content across all templates', async () => {
      const url = 'https://example.com';

      // Mock long content metadata for all template iterations
      mockedOgs.mockResolvedValue({
        error: false,
        result: {
          ogTitle:
            'This is an extremely long title that should be properly handled by all template types with appropriate wrapping and truncation',
          ogDescription:
            "This is a very long description that contains a lot of text and should be properly wrapped and truncated according to each template's specific design requirements and text handling capabilities",
          ogSiteName: 'Very Long Site Name That Might Need Truncation',
        },
        html: '<html></html>',
        response: {} as any,
      });

      const templates: TemplateType[] = ['modern', 'classic', 'minimal', 'article'];

      for (const template of templates) {
        const result = await generatePreview(url, { template });

        expect(result).toBeInstanceOf(Buffer);
        expect(result.length).toBeGreaterThan(10);
      }
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

    it('removes a failed image from the overlay input and reported metadata', async () => {
      const originalTemplate = templates.modern;
      const overlayGenerator = vi.fn(
        () => '<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg" />'
      );
      templates.modern = { ...originalTemplate, overlayGenerator };
      mockedAxios.get.mockRejectedValueOnce(new Error('Image fetch failed'));

      try {
        const result = await generatePreviewFromMetadataWithDetails({
          title: 'Post With Broken Cover',
          url: 'https://blog.example.com/posts/broken-cover',
          image: 'https://cdn.example.com/covers/broken.png',
        });

        expect(overlayGenerator).toHaveBeenLastCalledWith(
          expect.objectContaining({ image: undefined }),
          expect.any(Number),
          expect.any(Number),
          expect.any(Object),
          expect.any(Object)
        );
        expect(result.metadata.image).toBeUndefined();
      } finally {
        templates.modern = originalTemplate;
      }
    });

    it('keeps a successfully processed image in the overlay input and reported metadata', async () => {
      const originalTemplate = templates.modern;
      const overlayGenerator = vi.fn(
        () => '<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg" />'
      );
      templates.modern = { ...originalTemplate, overlayGenerator };
      const imageUrl = 'https://cdn.example.com/covers/working.png';
      const pngImageBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        'base64'
      );
      mockedAxios.get.mockResolvedValueOnce({
        data: pngImageBuffer,
        headers: { 'content-type': 'image/png' },
      });

      try {
        const result = await generatePreviewFromMetadataWithDetails({
          title: 'Post With Working Cover',
          url: 'https://blog.example.com/posts/working-cover',
          image: imageUrl,
        });

        expect(overlayGenerator).toHaveBeenLastCalledWith(
          expect.objectContaining({ image: imageUrl }),
          expect.any(Number),
          expect.any(Number),
          expect.any(Object),
          expect.any(Object)
        );
        expect(result.metadata.image).toBe(imageUrl);
      } finally {
        templates.modern = originalTemplate;
      }
    });

    it('falls back to a blank canvas when image processing fails', async () => {
      const originalTemplate = templates.modern;
      const overlayGenerator = vi.fn(
        () => '<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg" />'
      );
      templates.modern = { ...originalTemplate, overlayGenerator };
      const imageUrl = 'https://cdn.example.com/covers/unprocessable.png';
      const pngImageBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        'base64'
      );
      mockedAxios.get.mockResolvedValueOnce({
        data: pngImageBuffer,
        headers: { 'content-type': 'image/png' },
      });
      const sharpInstance = mockedSharp();
      sharpInstance.toBuffer
        .mockResolvedValueOnce(Buffer.from('rasterized-overlay'))
        .mockRejectedValueOnce(new Error('Resize failed'))
        .mockResolvedValue(Buffer.from('generated-image'));

      try {
        const result = await generatePreviewFromMetadataWithDetails({
          title: 'Post With Unprocessable Cover',
          url: 'https://blog.example.com/posts/unprocessable-cover',
          image: imageUrl,
        });

        expect(overlayGenerator).toHaveBeenLastCalledWith(
          expect.objectContaining({ image: undefined }),
          expect.any(Number),
          expect.any(Number),
          expect.any(Object),
          expect.any(Object)
        );
        expect(result.metadata.image).toBeUndefined();
      } finally {
        templates.modern = originalTemplate;
      }
    });

    it('does not retry a blank canvas after a native Sharp timeout', async () => {
      const originalTemplate = templates.modern;
      const overlayGenerator = vi.fn(
        () => '<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg" />'
      );
      templates.modern = { ...originalTemplate, overlayGenerator };
      const pngImageBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        'base64'
      );
      mockedAxios.get.mockResolvedValueOnce({
        data: pngImageBuffer,
        headers: { 'content-type': 'image/png' },
      });
      const sharpInstance = mockedSharp();
      sharpInstance.toBuffer
        .mockResolvedValueOnce(Buffer.from('rasterized-overlay'))
        .mockRejectedValueOnce(new Error('timeout: 12% complete'))
        .mockResolvedValue(Buffer.from('unexpected-retry'));

      try {
        await expect(
          generatePreviewFromMetadataWithDetails({
            title: 'Post With Slow Cover',
            url: 'https://blog.example.com/posts/slow-cover',
            image: 'https://cdn.example.com/covers/slow-cover.png',
          })
        ).rejects.toMatchObject({
          type: ErrorType.IMAGE_ERROR,
          message: expect.stringContaining('timeout: 12% complete'),
        });
        expect(overlayGenerator).toHaveBeenCalledTimes(1);
        expect(sharpInstance.toBuffer).toHaveBeenCalledTimes(2);
      } finally {
        templates.modern = originalTemplate;
      }
    });

    it('does not treat a custom overlay error as an image processing fallback', async () => {
      const originalTemplate = templates.modern;
      const overlayGenerator = vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('Custom overlay failed');
        })
        .mockReturnValue(
          '<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg" />'
        );
      templates.modern = { ...originalTemplate, overlayGenerator };
      const pngImageBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        'base64'
      );
      mockedAxios.get.mockResolvedValueOnce({
        data: pngImageBuffer,
        headers: { 'content-type': 'image/png' },
      });

      try {
        await expect(
          generatePreviewFromMetadataWithDetails({
            title: 'Post With Custom Overlay',
            url: 'https://blog.example.com/posts/custom-overlay',
            image: 'https://cdn.example.com/covers/custom-overlay.png',
          })
        ).rejects.toMatchObject({
          type: ErrorType.IMAGE_ERROR,
          message: expect.stringContaining('Custom overlay failed'),
        });
        expect(overlayGenerator).toHaveBeenCalledTimes(1);
      } finally {
        templates.modern = originalTemplate;
      }
    });

    it('does not treat a malformed custom overlay as an image processing fallback', async () => {
      const originalTemplate = templates.modern;
      const overlayGenerator = vi
        .fn()
        .mockReturnValueOnce('<svg><broken></svg>')
        .mockReturnValue(
          '<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg" />'
        );
      templates.modern = { ...originalTemplate, overlayGenerator };
      const pngImageBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        'base64'
      );
      mockedAxios.get.mockResolvedValueOnce({
        data: pngImageBuffer,
        headers: { 'content-type': 'image/png' },
      });
      const sharpInstance = mockedSharp();
      sharpInstance.toBuffer
        .mockRejectedValueOnce(new Error('XML parse error'))
        .mockResolvedValue(Buffer.from('generated-image'));

      try {
        await expect(
          generatePreviewFromMetadataWithDetails({
            title: 'Post With Malformed Overlay',
            url: 'https://blog.example.com/posts/malformed-overlay',
            image: 'https://cdn.example.com/covers/malformed-overlay.png',
          })
        ).rejects.toMatchObject({
          type: ErrorType.IMAGE_ERROR,
          message: expect.stringContaining('XML parse error'),
        });
        expect(overlayGenerator).toHaveBeenCalledTimes(1);
      } finally {
        templates.modern = originalTemplate;
      }
    });

    it.each(['generate', 'auto'] as const)(
      'reports the rendered %s fallback template and metadata on misses and cache hits',
      async (strategy) => {
        const url = `https://${strategy}-fallback-contract.example/post`;
        mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));
        mockedOgs.mockRejectedValueOnce(new Error('OGS error'));

        const first = await generatePreviewWithDetails(url, {
          cache: true,
          fallback: {
            strategy,
            text: 'Rendered Fallback Title',
          },
        });
        const second = await generatePreviewWithDetails(url, {
          cache: true,
          fallback: {
            strategy,
            text: 'Rendered Fallback Title',
          },
        });

        expect(first).toMatchObject({
          template: 'fallback',
          cached: false,
          metadata: {
            title: 'Rendered Fallback Title',
            url,
            domain: `${strategy}-fallback-contract.example`,
            siteName: `${strategy}-fallback-contract.example`,
          },
        });
        expect(second).toMatchObject({
          template: 'fallback',
          cached: true,
          metadata: first.metadata,
        });
      }
    );

    it.each([NaN, Infinity, 0, 30_001])(
      'should reject unsafe public security timeout %s before network I/O',
      async timeout => {
        await expect(
          generatePreview('https://timeout-validation.example', {
            security: { timeout },
          })
        ).rejects.toMatchObject({
          type: ErrorType.VALIDATION_ERROR,
          message: expect.stringContaining('Security timeout'),
        });
        expect(mockedAxios.get).not.toHaveBeenCalled();
      }
    );

    it.each([
      { allowSvg: 'false' },
      { httpsOnly: 'false' },
      { maxRedirects: -1 },
      { maxRedirects: 11 },
    ])('should reject unsafe public security options before network I/O: %o', async security => {
      await expect(
        generatePreview('https://security-option-validation.example', {
          security,
        } as unknown as PreviewOptions)
      ).rejects.toMatchObject({
        type: ErrorType.VALIDATION_ERROR,
      });
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it.each(['auto', 'generate'] as const)(
      'should not turn an HTTPS-only policy violation into a %s fallback success',
      async strategy => {
        await expect(
          generatePreviewWithDetails('http://policy-violation.example/path', {
            fallback: { strategy },
            security: { httpsOnly: true },
          })
        ).rejects.toMatchObject({
          type: ErrorType.VALIDATION_ERROR,
        });
        expect(mockedAxios.get).not.toHaveBeenCalled();
      }
    );

    it.each(['auto', 'generate'] as const)(
      'should preserve the %s fallback for operational DNS failures',
      async strategy => {
        mockedValidateRequestSecurity.mockResolvedValueOnce({
          allowed: false,
          blockedIPs: [],
          allowedIPs: [],
          reason: 'Security validation error: getaddrinfo ENOTFOUND',
          failureKind: 'operational',
        } as Awaited<ReturnType<typeof validateRequestSecurity>>);

        const result = await generatePreviewWithDetails('https://dns-failure.example/path', {
          fallback: { strategy },
        });

        expect(result).toMatchObject({ template: 'fallback', cached: false });
        expect(mockedAxios.get).not.toHaveBeenCalled();
      }
    );

    it.each(['auto', 'generate'] as const)(
      'should not turn a wrapped HTTPS-only redirect violation into a %s fallback success',
      async strategy => {
        mockedAxios.get.mockImplementationOnce(async (_url, config) => {
          let policyError: unknown;
          try {
            config?.beforeRedirect?.(
              {
                protocol: 'http:',
                hostname: 'redirect.example',
                href: 'http://redirect.example/path',
              },
              { headers: {}, statusCode: 302 }
            );
          } catch (error) {
            policyError = error;
          }

          const redirectError = Object.assign(new Error('Redirected request failed'), {
            cause: policyError,
          });
          throw Object.assign(new Error('Axios request failed'), { cause: redirectError });
        });

        await expect(
          generatePreviewWithDetails('https://safe-origin.example/path', {
            fallback: { strategy },
            security: { httpsOnly: true },
          })
        ).rejects.toMatchObject({ type: ErrorType.VALIDATION_ERROR });
      }
    );
  });

  describe('generatePreviewFromMetadata', () => {
    it('should generate preview image without fetching page metadata', async () => {
      const result = await generatePreviewFromMetadata(
        {
          title: 'Static Blog Post',
          description: 'Generated while publishing the post.',
          siteName: 'Example Blog',
          url: 'https://blog.example.com/posts/static-blog-post',
        },
        {
          template: 'minimal',
          width: 800,
          height: 420,
        }
      );

      expect(result).toBeInstanceOf(Buffer);
      expect(mockedOgs).not.toHaveBeenCalled();
      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(mockedSharp).toHaveBeenCalled();
    });

    it('should return detailed preview information from direct metadata', async () => {
      const result = await generatePreviewFromMetadataWithDetails(
        {
          title: 'Direct Metadata Post',
          description: 'No crawler required.',
          url: 'https://blog.example.com/posts/direct-metadata-post',
        },
        {
          template: 'classic',
          width: 1000,
          height: 525,
        }
      );

      expect(result).toMatchObject({
        buffer: expect.any(Buffer),
        format: 'jpeg',
        dimensions: {
          width: 1000,
          height: 525,
        },
        metadata: expect.objectContaining({
          title: 'Direct Metadata Post',
          description: 'No crawler required.',
          url: 'https://blog.example.com/posts/direct-metadata-post',
          domain: 'blog.example.com',
          siteName: 'blog.example.com',
        }),
        template: 'classic',
        cached: false,
      });
      expect(mockedOgs).not.toHaveBeenCalled();
    });

    it('should fetch direct metadata image without scraping page metadata', async () => {
      const pngImageBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        'base64'
      );
      mockedAxios.get.mockResolvedValueOnce({
        data: pngImageBuffer,
        headers: {
          'content-type': 'image/png',
        },
      });

      const result = await generatePreviewFromMetadata({
        title: 'Post With Cover Image',
        description: 'Use the cover image as the preview background.',
        siteName: 'Example Blog',
        url: 'https://blog.example.com/posts/with-cover',
        image: 'https://cdn.example.com/covers/with-cover.png',
      });

      expect(result).toBeInstanceOf(Buffer);
      expect(mockedOgs).not.toHaveBeenCalled();
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://cdn.example.com/covers/with-cover.png',
        expect.objectContaining({
          responseType: 'arraybuffer',
          headers: expect.objectContaining({
            'User-Agent': 'Mozilla/5.0 (compatible; SocialPreviewBot/1.0)',
          }),
        })
      );
      expect(mockedSharp).toHaveBeenCalledWith(pngImageBuffer, expect.any(Object));
    });

    it('should cache direct metadata previews by metadata content', async () => {
      const metadata = {
        title: 'Cached Static Post',
        description: 'Generated once during publishing.',
        url: 'https://blog.example.com/posts/cached-static-post',
      };

      const first = await generatePreviewFromMetadataWithDetails(metadata, { cache: true });
      const second = await generatePreviewFromMetadataWithDetails(metadata, { cache: true });

      expect(first.cached).toBe(false);
      expect(second.cached).toBe(true);
      expect(second.buffer).toBeInstanceOf(Buffer);
    });

    it('should isolate cached previews from mutations to returned results', async () => {
      const metadata = {
        title: 'Immutable Cached Post',
        description: 'Cached results must not share mutable state.',
        url: 'https://blog.example.com/posts/immutable-cached-post',
      };

      const first = await generatePreviewFromMetadataWithDetails(metadata, { cache: true });
      const expectedBuffer = Buffer.from(first.buffer);
      const expectedDimensions = { ...first.dimensions };
      const expectedMetadata = { ...first.metadata };

      first.buffer.fill(0);
      first.dimensions.width = 1;
      first.metadata.title = 'poisoned after cache set';

      const second = await generatePreviewFromMetadataWithDetails(metadata, { cache: true });
      expect(second.buffer).toEqual(expectedBuffer);
      expect(second.dimensions).toEqual(expectedDimensions);
      expect(second.metadata).toEqual(expectedMetadata);

      second.buffer.fill(1);
      second.dimensions.height = 1;
      second.metadata.description = 'poisoned after cache get';

      const third = await generatePreviewFromMetadataWithDetails(metadata, { cache: true });
      expect(third.buffer).toEqual(expectedBuffer);
      expect(third.dimensions).toEqual(expectedDimensions);
      expect(third.metadata).toEqual(expectedMetadata);
    });

    it('should not expose metadata extraction cache objects when preview caching is disabled', async () => {
      const url = 'https://metadata-cache-isolation.example/post';
      const cachedMetadata = {
        title: 'Original Extracted Title',
        description: 'Original extracted description.',
        url,
        domain: 'metadata-cache-isolation.example',
      };
      metadataCache.set(`${url}:${JSON.stringify({})}`, cachedMetadata);

      const first = await generatePreviewWithDetails(url, { cache: false });
      first.metadata.title = 'mutated returned metadata';

      const second = await generatePreviewWithDetails(url, { cache: false });
      expect(second.metadata.title).toBe('Original Extracted Title');
      expect(cachedMetadata.title).toBe('Original Extracted Title');
    });

    it('should accept direct metadata text at the 10,000 character boundary', async () => {
      const title = 'a'.repeat(10_000);

      const result = await generatePreviewFromMetadataWithDetails({
        title,
        url: 'https://blog.example.com/posts/max-length-title',
      });

      expect(result.metadata.title).toHaveLength(10_000);
    });

    it('should reject direct metadata text above 10,000 raw characters', async () => {
      await expect(
        generatePreviewFromMetadataWithDetails({
          title: 'a'.repeat(10_001),
          url: 'https://blog.example.com/posts/oversized-title',
        })
      ).rejects.toMatchObject({
        type: ErrorType.VALIDATION_ERROR,
      });
    });

    it('should count direct metadata limits by Unicode code points', async () => {
      await expect(
        generatePreviewFromMetadataWithDetails({
          title: 'Unicode Length Boundary',
          description: '😀'.repeat(10_001),
          url: 'https://blog.example.com/posts/unicode-length-boundary',
        })
      ).rejects.toMatchObject({
        type: ErrorType.VALIDATION_ERROR,
      });
    });

    it('should report undersized dimensions as validation errors', async () => {
      await expect(
        generatePreviewFromMetadataWithDetails(
          {
            title: 'Undersized Preview',
            url: 'https://blog.example.com/posts/undersized-preview',
          },
          { width: 99 }
        )
      ).rejects.toMatchObject({
        type: ErrorType.VALIDATION_ERROR,
      });
    });

    it('should enforce the metadata text limit before whitespace normalization', async () => {
      await expect(
        generatePreviewFromMetadataWithDetails({
          title: 'Raw Length Boundary',
          description: ' '.repeat(10_001),
          url: 'https://blog.example.com/posts/raw-length-boundary',
        })
      ).rejects.toMatchObject({
        type: ErrorType.VALIDATION_ERROR,
        message: 'metadata.description exceeds maximum length of 10000 characters',
      });
    });

    it('should reject invalid canonical URLs', async () => {
      await expect(
        generatePreviewFromMetadata({
          title: 'Invalid URL Post',
          url: 'not-a-url',
        })
      ).rejects.toThrow();
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
        timeout: vi.fn().mockReturnThis(),
        resize: vi.fn().mockReturnThis(),
        blur: vi.fn().mockReturnThis(),
        modulate: vi.fn().mockReturnThis(),
        composite: vi.fn().mockReturnThis(),
        jpeg: vi.fn().mockReturnThis(),
        toBuffer: vi.fn().mockRejectedValue(new Error('Sharp processing error')),
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
      const urls = ['https://example1.com', 'https://example2.com', 'https://example3.com'];

      const promises = urls.map((url) => generatePreview(url));
      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result).toBeInstanceOf(Buffer);
      });
    });
  });
});
