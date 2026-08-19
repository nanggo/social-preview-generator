import { MAX_SVG_SIZE, MAX_TEXT_LENGTH } from '../../src/constants/security';
import { clearAllCaches, createCachedSVG, getCacheStats } from '../../src/utils/sharp-cache';
import {
  normalizeMetadataForRendering,
  validateTemplateConfig,
} from '../../src/utils/validators';
import { ErrorType, type ExtractedMetadata, type TemplateConfig } from '../../src/types';

const metadata: ExtractedMetadata = {
  title: 'Safe title',
  description: 'Safe description',
  image: 'https://example.com/image.jpg',
  favicon: 'https://example.com/favicon.ico',
  url: 'https://example.com/post',
};

const template: TemplateConfig = {
  name: 'safe-template',
  layout: { padding: 60, imagePosition: 'none' },
  typography: {
    title: { fontSize: 48, fontWeight: '700', lineHeight: 1.2, maxLines: 2 },
    description: { fontSize: 24, fontWeight: '400', lineHeight: 1.4, maxLines: 2 },
  },
};

describe('render input validation', () => {
  afterEach(() => clearAllCaches());

  it('keeps API-specific optional URL failure policies', () => {
    expect(() =>
      normalizeMetadataForRendering({ ...metadata, image: 'https://' }, 'direct')
    ).toThrow();
    expect(
      normalizeMetadataForRendering(
        { ...metadata, image: 'https://', favicon: 'not-a-url' },
        'custom'
      )
    ).toMatchObject({ image: undefined, favicon: undefined });
    expect(
      normalizeMetadataForRendering(
        { ...metadata, image: 'https://', favicon: 'not-a-url' },
        'scraped'
      )
    ).toMatchObject({ image: undefined, favicon: undefined });
  });

  it.each(['description', 'siteName', 'domain', 'locale', 'author', 'publishedDate'] as const)(
    'rejects invalid or oversized metadata.%s',
    field => {
      expect(() =>
        normalizeMetadataForRendering({ ...metadata, [field]: 42 } as never, 'custom')
      ).toThrow(`${field} must be a string`);
      expect(() =>
        normalizeMetadataForRendering(
          { ...metadata, [field]: 'x'.repeat(MAX_TEXT_LENGTH + 1) },
          'custom'
        )
      ).toThrow('exceeds maximum length');
    }
  );

  it('preserves caller-owned metadata fields while replacing normalized fields', () => {
    const extendedMetadata = {
      ...metadata,
      title: '  Safe\n title  ',
      analytics: { campaign: 'release' },
    } as ExtractedMetadata & { analytics: { campaign: string } };

    const normalized = normalizeMetadataForRendering(
      extendedMetadata,
      'custom'
    ) as typeof extendedMetadata;

    expect(normalized.analytics).toEqual({ campaign: 'release' });
    expect(normalized.title).toBe('Safe title');
    expect(normalized).not.toBe(extendedMetadata);
  });

  it('preserves an arbitrary caller overlay callback', () => {
    const callback = () => '<svg />';
    const validated = validateTemplateConfig({ ...template, overlayGenerator: callback });
    expect(validated.overlayGenerator).toBe(callback);
  });

  it('preserves caller-owned extension fields while replacing validated fields', () => {
    const extendedTemplate = {
      ...template,
      brand: { label: 'NANGGO' },
      layout: { ...template.layout, extensionLayoutValue: 'keep-layout' },
      typography: {
        ...template.typography,
        title: { ...template.typography.title, extensionTitleValue: 'keep-title' },
      },
    } as TemplateConfig & {
      brand: { label: string };
      layout: TemplateConfig['layout'] & { extensionLayoutValue: string };
      typography: TemplateConfig['typography'] & {
        title: TemplateConfig['typography']['title'] & { extensionTitleValue: string };
      };
    };

    const validated = validateTemplateConfig(extendedTemplate) as typeof extendedTemplate;

    expect(validated.brand).toEqual({ label: 'NANGGO' });
    expect(validated.layout.extensionLayoutValue).toBe('keep-layout');
    expect(validated.typography.title.extensionTitleValue).toBe('keep-title');
    expect(validated.layout).not.toBe(extendedTemplate.layout);
  });

  it.each([
    ['layout.padding', { layout: { ...template.layout, padding: -1 } }],
    ['title.fontSize', { typography: { ...template.typography, title: { fontSize: Infinity } } }],
    ['title.lineHeight', { typography: { ...template.typography, title: { fontSize: 48, lineHeight: 0.1 } } }],
    ['title.maxLines', { typography: { ...template.typography, title: { fontSize: 48, maxLines: 1.5 } } }],
    ['blur.radius', { effects: { blur: { radius: 101 } } }],
    ['brightness', { imageProcessing: { brightness: Number.NaN } }],
  ])('rejects out-of-range %s', (_field, override) => {
    expect(() => validateTemplateConfig({ ...template, ...override } as TemplateConfig)).toThrow();
  });

  it('rejects unsafe CSS font weight and excessive gradient colors', () => {
    expect(() =>
      validateTemplateConfig({
        ...template,
        typography: {
          title: { fontSize: 48, fontWeight: '700;}</style><image href="https://x">' },
        },
      })
    ).toThrow('unsafe CSS token');
    expect(() =>
      validateTemplateConfig({
        ...template,
        effects: {
          gradient: { type: 'linear', colors: Array(17).fill('#fff') },
        },
      })
    ).toThrow('at most 16 colors');
  });

  it('caps generated SVGs by UTF-8 bytes before hashing or Sharp', async () => {
    const oversizedUnicode = 'é'.repeat(Math.floor(MAX_SVG_SIZE / 2) + 1);
    await expect(createCachedSVG(oversizedUnicode)).rejects.toMatchObject({
      type: ErrorType.VALIDATION_ERROR,
    });
    expect(getCacheStats().svg).toMatchObject({ size: 0, currentWeight: 0 });

    const prefix = '<svg xmlns="http://www.w3.org/2000/svg"><!--';
    const suffix = '--></svg>';
    const exact = `${prefix}${'a'.repeat(MAX_SVG_SIZE - prefix.length - suffix.length)}${suffix}`;
    await expect(createCachedSVG(exact)).resolves.toBeDefined();
    expect(getCacheStats().svg.currentWeight).toBe(MAX_SVG_SIZE);
  });

  it('keeps retained SVG bytes within the independent 16 MiB budget', async () => {
    const prefix = '<svg xmlns="http://www.w3.org/2000/svg"><!--';
    const suffix = '--></svg>';
    for (let index = 0; index < 17; index += 1) {
      const marker = String(index).padStart(2, '0');
      const svg = `${prefix}${marker}${'a'.repeat(MAX_SVG_SIZE - prefix.length - suffix.length - marker.length)}${suffix}`;
      await createCachedSVG(svg);
    }

    expect(getCacheStats().svg).toMatchObject({
      size: 16,
      currentWeight: 16 * 1024 * 1024,
      maxWeight: 16 * 1024 * 1024,
      maxEntryWeight: MAX_SVG_SIZE,
    });
  });
});
