import sharp from 'sharp';
import { generateImageWithTemplate, generatePreviewFromMetadata } from '../../src/index';
import type { ExtractedMetadata, TemplateConfig } from '../../src/types';

const directMetadata: ExtractedMetadata = {
  title: 'Render dimensions',
  description: 'Generated without a remote background image.',
  siteName: 'Example',
  url: 'https://example.com/render-dimensions',
};

async function expectImageDimensions(buffer: Buffer, width: number, height: number): Promise<void> {
  const metadata = await sharp(buffer).metadata();

  expect(metadata.width).toBe(width);
  expect(metadata.height).toBe(height);
}

describe('generated image dimensions with real Sharp', () => {
  it.each([
    { width: 320, height: 168 },
    { width: 1200, height: 630 },
  ])('renders a modern no-image preview at $width x $height', async ({ width, height }) => {
    const buffer = await generatePreviewFromMetadata(directMetadata, {
      template: 'modern',
      width,
      height,
    });

    await expectImageDimensions(buffer, width, height);
  });

  it.each(['classic', 'minimal'] as const)(
    'keeps the %s template at the requested dimensions',
    async (template) => {
      const width = 320;
      const height = 168;
      const buffer = await generatePreviewFromMetadata(directMetadata, {
        template,
        width,
        height,
      });

      await expectImageDimensions(buffer, width, height);
    }
  );

  it('renders a custom template through the default overlay at the requested dimensions', async () => {
    const width = 320;
    const height = 168;
    const customTemplate: TemplateConfig = {
      name: 'custom-default-overlay',
      layout: {
        padding: 24,
        imagePosition: 'none',
      },
      typography: {
        title: {
          fontSize: 32,
          fontWeight: '700',
          lineHeight: 1.2,
          maxLines: 2,
        },
        description: {
          fontSize: 18,
          lineHeight: 1.3,
          maxLines: 2,
        },
      },
      imageProcessing: {
        requiresTransparentCanvas: true,
      },
    };

    const buffer = await generateImageWithTemplate(directMetadata, customTemplate, {
      width,
      height,
    });

    await expectImageDimensions(buffer, width, height);
  });
});
