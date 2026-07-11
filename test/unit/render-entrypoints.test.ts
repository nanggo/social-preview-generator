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
import {
  ErrorType,
  PreviewGeneratorError,
  type ExtractedMetadata,
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
    expect(renderMocks.withRenderSlot).toHaveBeenCalledOnce();
  });

});
