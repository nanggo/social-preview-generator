import { vi } from 'vitest';
import sharp from 'sharp';
import { generateImageWithTemplate } from '../../src';
import { fetchImage } from '../../src/core/metadata-extractor';
import type { TemplateConfig } from '../../src/types';

vi.mock('../../src/core/metadata-extractor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/core/metadata-extractor')>()),
  fetchImage: vi.fn(),
}));

const metadata = {
  title: 'Image effects',
  url: 'https://example.com',
  image: 'https://example.com/image.png',
};
const template: TemplateConfig = {
  name: 'image-effects',
  layout: { padding: 0, imagePosition: 'background' },
  typography: { title: { fontSize: 24 } },
  overlayGenerator: (_metadata, width, height) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"/>`,
};
const options = { width: 320, height: 168, quality: 100 };

describe('public custom-template image processing', () => {
  beforeEach(async () => {
    const pixels = Buffer.alloc(options.width * options.height * 3);
    for (let y = 0; y < options.height; y++) {
      for (let x = 0; x < options.width; x++) {
        const value = Math.floor(x / 4) % 2 === 0 ? 32 : 224;
        pixels.fill(value, (y * options.width + x) * 3, (y * options.width + x) * 3 + 3);
      }
    }
    vi.mocked(fetchImage).mockResolvedValue(
      await sharp(pixels, {
        raw: { width: options.width, height: options.height, channels: 3 },
      })
        .png()
        .toBuffer()
    );
  });

  it('applies contrast to pixels and preserves the neutral setting', async () => {
    const baseline = await generateImageWithTemplate(metadata, template, options);
    const neutral = await generateImageWithTemplate(
      metadata,
      {
        ...template,
        imageProcessing: { contrast: 1 },
      },
      options
    );
    expect(neutral).toEqual(baseline);

    const flat = await generateImageWithTemplate(
      metadata,
      {
        ...template,
        imageProcessing: { contrast: 0 },
      },
      options
    );
    const stats = await sharp(flat).stats();
    for (const channel of stats.channels) {
      expect(channel.mean).toBeCloseTo(128, 0);
      expect(channel.stdev).toBeLessThan(1);
    }

    const stronger = await generateImageWithTemplate(
      metadata,
      {
        ...template,
        imageProcessing: { contrast: 2 },
      },
      options
    );
    expect((await sharp(stronger).stats()).channels[0].stdev).toBeGreaterThan(
      (await sharp(baseline).stats()).channels[0].stdev
    );
  });

  it('applies imageProcessing.blur and lets explicit zero override effects blur', async () => {
    const baseline = await generateImageWithTemplate(metadata, template, options);
    const blurred = await generateImageWithTemplate(
      metadata,
      {
        ...template,
        imageProcessing: { blur: 3 },
      },
      options
    );
    expect((await sharp(blurred).stats()).channels[0].stdev).toBeLessThan(
      (await sharp(baseline).stats()).channels[0].stdev / 2
    );

    const disabled = await generateImageWithTemplate(
      metadata,
      {
        ...template,
        effects: { blur: { radius: 3 } },
        imageProcessing: { blur: 0 },
      },
      options
    );
    expect(disabled).toEqual(baseline);
    expect(await sharp(blurred).metadata()).toMatchObject({
      width: 320,
      height: 168,
      format: 'jpeg',
    });
  });

  it('uses the same middle gray for 16-bit background images', async () => {
    const input = await sharp({
      create: { width: 320, height: 168, channels: 3, background: '#447788' },
    })
      .toColourspace('rgb16')
      .png()
      .toBuffer();
    expect((await sharp(input).metadata()).depth).toBe('ushort');
    vi.mocked(fetchImage).mockResolvedValue(input);
    const result = await generateImageWithTemplate(
      metadata,
      {
        ...template,
        imageProcessing: { contrast: 0 },
      },
      options
    );
    for (const channel of (await sharp(result).stats()).channels) {
      expect(channel.mean).toBeCloseTo(128, 0);
    }
  });

  it.each([0, 0.5, 2])(
    'preserves foreground colours with background contrast %s',
    async (contrast) => {
      const result = await generateImageWithTemplate(
        metadata,
        {
          ...template,
          imageProcessing: { contrast },
          overlayGenerator: (_metadata, width, height) =>
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="80" height="80" fill="red"/></svg>`,
        },
        options
      );
      const pixel = await sharp(result)
        .extract({ left: 20, top: 20, width: 1, height: 1 })
        .removeAlpha()
        .raw()
        .toBuffer();
      expect(pixel[0]).toBeGreaterThan(250);
      expect(pixel[1]).toBeLessThan(5);
      expect(pixel[2]).toBeLessThan(5);
    }
  );

  it('keeps the default text visible when the background becomes flat gray', async () => {
    const result = await generateImageWithTemplate(
      metadata,
      {
        ...template,
        overlayGenerator: undefined,
        imageProcessing: { contrast: 0 },
      },
      options
    );
    expect((await sharp(result).stats()).channels[0].max).toBeGreaterThan(245);
  });

  it('does not retry a native timeout while materializing the adjusted background', async () => {
    const output = vi
      .spyOn(sharp.prototype, 'toBuffer')
      .mockRejectedValueOnce(new Error('timeout: 27% complete'));
    try {
      await expect(
        generateImageWithTemplate(
          metadata,
          {
            ...template,
            imageProcessing: { contrast: 0.5 },
          },
          options
        )
      ).rejects.toMatchObject({ type: 'IMAGE_ERROR' });
      expect(output).toHaveBeenCalledOnce();
    } finally {
      output.mockRestore();
    }
  });

  it('rejects unsupported fractional blur before fetching the background', async () => {
    await expect(
      generateImageWithTemplate(
        metadata,
        {
          ...template,
          imageProcessing: { blur: 0.1 },
        },
        options
      )
    ).rejects.toMatchObject({ type: 'VALIDATION_ERROR' });
    expect(fetchImage).not.toHaveBeenCalled();
  });
});
