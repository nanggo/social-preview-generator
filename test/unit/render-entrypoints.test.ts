import { vi } from 'vitest';

const renderMocks = vi.hoisted(() => {
  const withRenderSlot = vi.fn(async <T>(operation: () => Promise<T>): Promise<T> => operation());
  const extractMetadata = vi.fn();
  const validateMetadata = vi.fn(() => true);

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

  return { withRenderSlot, extractMetadata, validateMetadata, sharp };
});

vi.mock('../../src/utils/render-limiter', () => ({
  withRenderSlot: renderMocks.withRenderSlot,
}));
vi.mock('sharp', () => ({ default: renderMocks.sharp }));
vi.mock('../../src/core/metadata-extractor', () => ({
  extractMetadata: renderMocks.extractMetadata,
  validateMetadata: renderMocks.validateMetadata,
  applyFallbacks: vi.fn((metadata) => metadata),
  fetchImage: vi.fn().mockResolvedValue(Buffer.from('image')),
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
import { type ExtractedMetadata, type TemplateConfig } from '../../src/types';

const metadata: ExtractedMetadata = {
  title: 'Limiter test',
  url: 'https://example.com/limiter',
};

const template: TemplateConfig = {
  name: 'limiter-test',
  layout: { padding: 20, imagePosition: 'none' },
  typography: { title: { fontSize: 32 } },
};

describe('render limiter entrypoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderMocks.withRenderSlot.mockImplementation(async <T>(operation: () => Promise<T>) =>
      operation()
    );
    renderMocks.extractMetadata.mockResolvedValue({ ...metadata });
    renderMocks.validateMetadata.mockReturnValue(true);
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

});
