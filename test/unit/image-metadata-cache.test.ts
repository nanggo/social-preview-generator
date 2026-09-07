import sharp from 'sharp';
import { validateImageBuffer } from '../../src/utils/image-security';
import { clearAllCaches, getCacheStats, metadataCache } from '../../src/utils/sharp-cache';

describe('image validation metadata retention', () => {
  beforeEach(clearAllCaches);
  afterEach(clearAllCaches);

  it('accepts small PNGs with compressed XMP without retaining the expanded profiles', async () => {
    const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:test="https://example.test/ns/" test:payload="${'A'.repeat(1024 * 1024)}"/></rdf:RDF></x:xmpmeta>`;

    for (let index = 0; index < 3; index++) {
      const input = await sharp({
        create: { width: 16, height: 16, channels: 3, background: { r: index, g: 0, b: 0 } },
      })
        .withXmp(xmp)
        .png()
        .toBuffer();
      const originalMetadata = await sharp(input).metadata();
      expect(input.length).toBeLessThan(4096);
      expect(originalMetadata.xmp!.byteLength).toBeGreaterThan(1024 * 1024);
      expect(originalMetadata.xmpAsString!.length).toBeGreaterThan(1024 * 1024);

      await expect(validateImageBuffer(input)).resolves.toBe(input);
      const cached = metadataCache.getCachedMetadata(input)!;
      expect(Object.keys(cached).sort()).toEqual(['density', 'format', 'height', 'width']);
      expect(cached).toMatchObject({ width: 16, height: 16, format: 'png' });
      expect(Object.isFrozen(cached)).toBe(true);
      await expect(validateImageBuffer(input)).resolves.toBe(input);
    }

    expect(getCacheStats().metadata.size).toBe(3);
  });

  it('discards EXIF and ICC while preserving normal raster validation', async () => {
    const input = await sharp({
      create: { width: 32, height: 24, channels: 3, background: '#4488aa' },
    })
      .withExif({ IFD0: { Artist: 'Profile payload '.repeat(1000) } })
      .withIccProfile('srgb')
      .jpeg()
      .toBuffer();
    const original = await sharp(input).metadata();
    expect(original.exif!.byteLength).toBeGreaterThan(1000);
    expect(original.icc!.byteLength).toBeGreaterThan(100);

    await expect(validateImageBuffer(input)).resolves.toBe(input);
    expect(metadataCache.getCachedMetadata(input)).toEqual({
      width: 32,
      height: 24,
      format: 'jpeg',
      density: original.density,
    });
  });

  it('does not cache an image rejected after native metadata extraction', async () => {
    const input = await sharp({
      create: { width: 16, height: 16, channels: 3, background: '#ffffff' },
    })
      .withMetadata({ density: 1200 })
      .png()
      .toBuffer();

    await expect(validateImageBuffer(input)).rejects.toThrow('DPI too high');
    expect(metadataCache.getCachedMetadata(input)).toBeUndefined();
    expect(getCacheStats().metadata.size).toBe(0);
  });

  it('preserves cache-hit diagnostics across repeated successful validation', async () => {
    const input = await sharp({
      create: { width: 16, height: 16, channels: 3, background: '#334455' },
    })
      .png()
      .toBuffer();
    await validateImageBuffer(input);
    expect(getCacheStats().metadata.totalHits).toBe(0);
    await validateImageBuffer(input);
    await validateImageBuffer(input);
    expect(getCacheStats().metadata.totalHits).toBe(2);
    expect(getCacheStats().metadata.size).toBe(1);
  });
});
