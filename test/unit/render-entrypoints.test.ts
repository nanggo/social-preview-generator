import { vi } from 'vitest';

const renderMocks = vi.hoisted(() => {
  const withRenderSlot = vi.fn(async <T>(operation: () => Promise<T>): Promise<T> => operation());
  const withPreparedRenderSlot = vi.fn(
    async <Prepared, Result>(
      prepare: () => Promise<Prepared>,
      render: (prepared: Prepared) => Promise<Result>
    ): Promise<Result> => {
      const prepared = await prepare();
      return withRenderSlot(() => render(prepared));
    }
  );
  const extractMetadata = vi.fn();
  const validateMetadata = vi.fn(() => true);
  const fetchImage = vi.fn().mockResolvedValue(Buffer.from('image'));

  const sharpInstance = {
    timeout: vi.fn().mockReturnThis(),
    resize: vi.fn().mockReturnThis(),
    blur: vi.fn().mockReturnThis(),
    modulate: vi.fn().mockReturnThis(),
    composite: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    withMetadata: vi.fn().mockReturnThis(),
    metadata: vi.fn().mockResolvedValue({ width: 320, height: 168, format: 'png' }),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('rendered')),
  };
  const sharp = Object.assign(vi.fn(() => sharpInstance), {
    concurrency: vi.fn(),
    simd: vi.fn(),
    cache: vi.fn(),
  });

  return {
    withRenderSlot,
    withPreparedRenderSlot,
    extractMetadata,
    validateMetadata,
    fetchImage,
    sharp,
  };
});

vi.mock('../../src/utils/render-limiter', () => ({
  withRenderSlot: renderMocks.withRenderSlot,
  withPreparedRenderSlot: renderMocks.withPreparedRenderSlot,
}));
vi.mock('sharp', () => ({ default: renderMocks.sharp }));
vi.mock('../../src/core/metadata-extractor', () => ({
  extractMetadata: renderMocks.extractMetadata,
  validateMetadata: renderMocks.validateMetadata,
  applyFallbacks: vi.fn((metadata) => metadata),
  fetchImage: renderMocks.fetchImage,
  clearInflightRequests: vi.fn(),
  getInflightRequestStats: vi.fn(() => ({ active: 0 })),
}));

import {
  generateImageWithTemplate,
  generatePreview,
  generatePreviewFromMetadata,
  generatePreviewFromMetadataWithDetails,
  generatePreviewWithDetails,
} from '../../src/index';
import { createFallbackImage, generateImage } from '../../src/core/image-generator';
import { clearAllCaches } from '../../src/utils/sharp-cache';
import { previewCache, stopCacheCleanup } from '../../src/utils/cache';
import { setCachedPreview } from '../../src/utils/preview-cache';
import {
  ErrorType,
  PreviewGeneratorError,
  type ExtractedMetadata,
  type PreviewMetadataInput,
  type TemplateConfig,
} from '../../src/types';
import { createSecurityPolicyError } from '../../src/utils/security-policy-error';

const metadata: ExtractedMetadata = {
  title: 'Limiter test',
  url: 'https://example.com/limiter',
};

const template: TemplateConfig = {
  name: 'limiter-test',
  layout: { padding: 20, imagePosition: 'none' },
  typography: { title: { fontSize: 32 } },
};

const backgroundTemplate: TemplateConfig = {
  ...template,
  layout: { ...template.layout, imagePosition: 'left' },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('render limiter entrypoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderMocks.withRenderSlot.mockImplementation(async <T>(operation: () => Promise<T>) =>
      operation()
    );
    renderMocks.withPreparedRenderSlot.mockImplementation(
      async <Prepared, Result>(
        prepare: () => Promise<Prepared>,
        render: (prepared: Prepared) => Promise<Result>
      ) => {
        const prepared = await prepare();
        return renderMocks.withRenderSlot(() => render(prepared));
      }
    );
    renderMocks.extractMetadata.mockResolvedValue({ ...metadata });
    renderMocks.validateMetadata.mockReturnValue(true);
    renderMocks.fetchImage.mockResolvedValue(Buffer.from('image'));
    previewCache.clear();
    clearAllCaches();
  });

  afterAll(() => {
    stopCacheCleanup();
  });

  it.each([
    ['generateImageWithTemplate', () => generateImageWithTemplate(metadata, template, {})],
    ['generatePreviewFromMetadata delegate', () => generatePreviewFromMetadata(metadata)],
    ['generatePreview delegate', () => generatePreview(metadata.url)],
    ['core generateImage', () => generateImage(metadata, template)],
    ['fallback delegate', () => createFallbackImage(metadata.url)],
  ] as const)('acquires exactly once for %s', async (_name, render) => {
    await render();

    expect(renderMocks.withRenderSlot).toHaveBeenCalledOnce();
  });

  it('acquires exactly once for the URL fallback render path', async () => {
    renderMocks.extractMetadata.mockRejectedValueOnce(new Error('metadata unavailable'));

    await generatePreviewWithDetails(metadata.url, { fallback: { strategy: 'generate' } });

    expect(renderMocks.withRenderSlot).toHaveBeenCalledOnce();
  });

  it('does not acquire a render slot for a preview cache hit', async () => {
    await generatePreviewFromMetadataWithDetails(metadata, { cache: true });
    expect(renderMocks.withRenderSlot).toHaveBeenCalledOnce();

    renderMocks.withRenderSlot.mockClear();
    await generatePreviewFromMetadataWithDetails(metadata, { cache: true });

    expect(renderMocks.withRenderSlot).not.toHaveBeenCalled();
  });

  it('validates and canonicalizes URL input before preview cache lookup', async () => {
    const credentialUrl = 'https://user:secret@example.com/private';
    setCachedPreview(credentialUrl, { cache: true }, {
      buffer: Buffer.from('unsafe-cache-hit'),
      format: 'jpeg',
      dimensions: { width: 1200, height: 630 },
      metadata,
      template: 'modern',
      cached: false,
    });

    await expect(generatePreviewWithDetails(credentialUrl, { cache: true })).rejects.toMatchObject({
      type: ErrorType.VALIDATION_ERROR,
    });
    expect(renderMocks.extractMetadata).not.toHaveBeenCalled();
    expect(renderMocks.withRenderSlot).not.toHaveBeenCalled();
  });

  it('uses the same preview cache entry for fragment-only URL differences', async () => {
    renderMocks.extractMetadata.mockResolvedValue({
      ...metadata,
      url: 'https://example.com/article',
    });
    await generatePreviewWithDetails('https://example.com/article#one', { cache: true });
    renderMocks.withRenderSlot.mockClear();
    renderMocks.extractMetadata.mockClear();

    const cached = await generatePreviewWithDetails('https://example.com/article#two', { cache: true });
    expect(cached.cached).toBe(true);
    expect(renderMocks.extractMetadata).not.toHaveBeenCalled();
    expect(renderMocks.withRenderSlot).not.toHaveBeenCalled();
  });

  it.each([
    [
      'public template renderer',
      () =>
        generateImageWithTemplate(
          { ...metadata, image: 'https://example.com/background.jpg' },
          backgroundTemplate,
          {}
        ),
    ],
    [
      'core renderer',
      () =>
        generateImage(
          { ...metadata, image: 'https://example.com/background.jpg' },
          backgroundTemplate
        ),
    ],
  ] as const)('does not acquire a render slot while %s waits for image fetch', async (_name, render) => {
    const pendingImage = deferred<Buffer>();
    renderMocks.fetchImage.mockReturnValueOnce(pendingImage.promise);

    const rendering = render();
    await Promise.resolve();
    await Promise.resolve();

    expect(renderMocks.fetchImage).toHaveBeenCalledOnce();
    expect(renderMocks.withPreparedRenderSlot).toHaveBeenCalledOnce();
    expect(renderMocks.withRenderSlot).not.toHaveBeenCalled();

    pendingImage.resolve(Buffer.from('fetched-image'));
    await rendering;
    expect(renderMocks.withRenderSlot).toHaveBeenCalledOnce();
  });

  it('propagates background-image security policy violations', async () => {
    renderMocks.fetchImage.mockRejectedValueOnce(
      createSecurityPolicyError(
        'Image redirect blocked by HTTPS-only mode'
      )
    );

    await expect(
      generateImageWithTemplate(
        { ...metadata, image: 'https://example.com/background.jpg' },
        backgroundTemplate,
        { security: { httpsOnly: true } }
      )
    ).rejects.toMatchObject({ type: ErrorType.VALIDATION_ERROR });
    expect(renderMocks.withRenderSlot).not.toHaveBeenCalled();
  });

  it('renders without a malformed scraped background image', async () => {
    renderMocks.fetchImage.mockRejectedValueOnce(
      new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, 'Invalid URL: https://')
    );

    await expect(
      generateImageWithTemplate(
        { ...metadata, image: 'https://' },
        backgroundTemplate,
        {}
      )
    ).resolves.toEqual(Buffer.from('rendered'));
    expect(renderMocks.fetchImage).not.toHaveBeenCalled();
    expect(renderMocks.withRenderSlot).toHaveBeenCalledOnce();
  });

  it('rejects unsafe template input before render admission', async () => {
    await expect(
      generateImageWithTemplate(
        metadata,
        {
          ...template,
          typography: {
            title: { fontSize: 32, fontWeight: '700;}</style><script>' },
          },
        },
        {}
      )
    ).rejects.toMatchObject({ type: ErrorType.VALIDATION_ERROR });
    expect(renderMocks.withRenderSlot).not.toHaveBeenCalled();
    expect(renderMocks.sharp).not.toHaveBeenCalled();
  });

  it('rejects oversized optional metadata text before render admission', async () => {
    await expect(
      generateImageWithTemplate(
        { ...metadata, description: 'x'.repeat(10_001) },
        template,
        {}
      )
    ).rejects.toMatchObject({ type: ErrorType.VALIDATION_ERROR });
    expect(renderMocks.withRenderSlot).not.toHaveBeenCalled();
  });

  it('does not expose raw custom overlay errors', async () => {
    const secret = 'never-expose-render-secret';
    const error = await generateImageWithTemplate(
      metadata,
      {
        ...template,
        overlayGenerator: () => {
          throw new Error(secret);
        },
      },
      {}
    ).catch(value => value as PreviewGeneratorError);
    const serialized = JSON.stringify({ message: error.message, details: error.details });

    expect(error).toMatchObject({
      type: ErrorType.IMAGE_ERROR,
      message: 'Failed to generate image with template',
    });
    expect(serialized).not.toContain(secret);
  });

  it.each([
    [
      'custom error fields',
      () => Object.assign(new Error('callback failed'), {
        name: 'never-expose-error-name',
        code: 'never-expose-error-code',
      }),
      'never-expose-error',
    ],
    [
      'nested PreviewGeneratorError',
      () => new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        'never-expose-preview-message',
        { nested: 'never-expose-preview-details' }
      ),
      'never-expose-preview',
    ],
  ])('redacts %s thrown by a custom overlay', async (_label, createError, secretPrefix) => {
    const error = await generateImageWithTemplate(
      metadata,
      {
        ...template,
        overlayGenerator: () => {
          throw createError();
        },
      },
      {}
    ).catch(value => value as PreviewGeneratorError);
    const serialized = JSON.stringify({ message: error.message, details: error.details });

    expect(error).toMatchObject({
      type: ErrorType.IMAGE_ERROR,
      message: 'Failed to generate image with template',
    });
    expect(serialized).not.toContain(secretPrefix);
  });

  it('consumes rejected async custom overlays without exposing the rejection', async () => {
    const secret = 'never-expose-async-overlay-secret';
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      const error = await generateImageWithTemplate(
        metadata,
        {
          ...template,
          overlayGenerator: (async () => {
            throw new Error(secret);
          }) as unknown as NonNullable<TemplateConfig['overlayGenerator']>,
        },
        {}
      ).catch(value => value as PreviewGeneratorError);
      await new Promise(resolve => setImmediate(resolve));
      const serialized = JSON.stringify({ message: error.message, details: error.details });

      expect(error).toMatchObject({
        type: ErrorType.IMAGE_ERROR,
        message: 'Failed to generate image with template',
      });
      expect(serialized).not.toContain(secret);
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('does not expose error identifiers thrown by metadata accessors', async () => {
    const secret = 'never-expose-accessor-error-identifier';
    const metadataWithThrowingAccessor = new Proxy(
      { title: 'Accessor metadata' } as PreviewMetadataInput,
      {
        get(target, property, receiver) {
          if (property === 'url') {
            throw Object.assign(new Error('metadata accessor failed'), {
              name: secret,
              code: secret,
              status: 999,
              response: { status: 777 },
            });
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );

    const error = await generatePreviewFromMetadataWithDetails(
      metadataWithThrowingAccessor
    ).catch(value => value as PreviewGeneratorError);
    const serialized = JSON.stringify({ message: error.message, details: error.details });

    expect(error).toMatchObject({
      type: ErrorType.IMAGE_ERROR,
      message: 'Failed to generate preview from metadata',
      details: { name: 'Error' },
    });
    expect(error.details).not.toHaveProperty('code');
    expect(error.details).not.toHaveProperty('status');
    expect(serialized).not.toContain(secret);
  });

});
