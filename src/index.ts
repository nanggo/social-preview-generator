/**
 * Social Preview Generator
 * Generate beautiful social media preview images from any URL
 */

import {
  PreviewOptions,
  ExtractedMetadata,
  GeneratedPreview,
  TemplateConfig,
  ErrorType,
  PreviewGeneratorError,
} from './types';
import { extractMetadata, validateMetadata, applyFallbacks } from './core/metadata-extractor';
import { createFallbackImage, DEFAULT_DIMENSIONS } from './core/image-generator';
import { modernTemplate, generateModernOverlay } from './templates/modern';
import sharp from 'sharp';

// Re-export types
export {
  PreviewOptions,
  ExtractedMetadata,
  GeneratedPreview,
  TemplateConfig,
  ErrorType,
  PreviewGeneratorError,
};

/**
 * Template registry
 */
const templates: Record<string, TemplateConfig> = {
  modern: modernTemplate,
  // TODO: Add classic and minimal templates
};

/**
 * Generate a social preview image from a URL
 * @param url - The URL to generate preview for
 * @param options - Configuration options
 * @returns Buffer containing the generated image
 */
export async function generatePreview(url: string, options: PreviewOptions = {}): Promise<Buffer> {
  try {
    // Set default options
    const finalOptions: PreviewOptions = {
      template: 'modern',
      width: DEFAULT_DIMENSIONS.width,
      height: DEFAULT_DIMENSIONS.height,
      quality: 90,
      cache: true,
      ...options,
    };

    // Extract metadata from URL
    let metadata: ExtractedMetadata;
    try {
      metadata = await extractMetadata(url);

      // Validate metadata
      if (!validateMetadata(metadata)) {
        // Apply fallbacks if metadata is incomplete
        metadata = applyFallbacks(metadata, url);
      }
    } catch (error) {
      // If metadata extraction fails completely, use fallback
      if (
        finalOptions.fallback?.strategy === 'generate' ||
        finalOptions.fallback?.strategy === 'auto'
      ) {
        return await createFallbackImage(url, finalOptions);
      }
      throw error;
    }

    // Get template configuration
    const templateName = finalOptions.template || 'modern';
    const template = templates[templateName];

    if (!template && templateName !== 'custom') {
      throw new PreviewGeneratorError(
        ErrorType.TEMPLATE_ERROR,
        `Template "${templateName}" not found`
      );
    }

    // Generate image based on template
    const imageBuffer = await generateImageWithTemplate(
      metadata,
      template || modernTemplate,
      finalOptions
    );

    return imageBuffer;
  } catch (error) {
    if (error instanceof PreviewGeneratorError) {
      throw error;
    }
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      `Failed to generate preview for ${url}: ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }
}

/**
 * Generate image with specific template
 */
async function generateImageWithTemplate(
  metadata: ExtractedMetadata,
  template: TemplateConfig,
  options: PreviewOptions
): Promise<Buffer> {
  const width = options.width || DEFAULT_DIMENSIONS.width;
  const height = options.height || DEFAULT_DIMENSIONS.height;
  const quality = options.quality || 90;

  try {
    // Create base image
    let baseImage: sharp.Sharp;

    if (metadata.image) {
      // Use existing image as background
      const { fetchImage } = await import('./core/metadata-extractor');
      try {
        const imageBuffer = await fetchImage(metadata.image);
        baseImage = sharp(imageBuffer)
          .resize(width, height, {
            fit: 'cover',
            position: 'center',
          })
          .blur(3)
          .modulate({
            brightness: 0.7,
          });
      } catch (error) {
        // If image fetch fails, create blank canvas
        console.warn(`Failed to fetch image ${metadata.image}:`, error instanceof Error ? error.message : String(error));
        baseImage = await createBlankCanvas(width, height, options);
      }
    } else {
      // Create blank canvas with gradient
      baseImage = await createBlankCanvas(width, height, options);
    }

    // Generate overlay based on template
    let overlayBuffer: Buffer;

    if (template.name === 'modern') {
      const overlaySvg = generateModernOverlay(metadata, width, height, options);
      overlayBuffer = Buffer.from(overlaySvg);
    } else {
      // Default overlay generation
      overlayBuffer = await generateDefaultOverlay(metadata, template, width, height, options);
    }

    // Composite overlay on base image
    const finalImage = await baseImage
      .composite([
        {
          input: overlayBuffer,
          top: 0,
          left: 0,
        },
      ])
      .jpeg({ quality })
      .toBuffer();

    return finalImage;
  } catch (error) {
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      `Failed to generate image with template: ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }
}

/**
 * Create blank canvas with gradient background
 */
async function createBlankCanvas(
  width: number,
  height: number,
  options: PreviewOptions
): Promise<sharp.Sharp> {
  const backgroundColor = options.colors?.background || '#1a1a2e';
  const accentColor = options.colors?.accent || '#16213e';

  const gradientSvg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${backgroundColor};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${accentColor};stop-opacity:1" />
        </linearGradient>
        <pattern id="pattern" x="0" y="0" width="100" height="100" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1" fill="white" opacity="0.05"/>
        </pattern>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bgGradient)"/>
      <rect width="${width}" height="${height}" fill="url(#pattern)"/>
    </svg>
  `;

  return sharp(Buffer.from(gradientSvg));
}

/**
 * Generate default overlay for non-modern templates
 */
async function generateDefaultOverlay(
  metadata: ExtractedMetadata,
  template: TemplateConfig,
  width: number,
  height: number,
  options: PreviewOptions
): Promise<Buffer> {
  const padding = template.layout.padding || 60;
  const textColor = options.colors?.text || '#ffffff';

  // Simple default overlay
  const overlaySvg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          .title { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
            font-size: ${template.typography.title.fontSize}px; 
            font-weight: ${template.typography.title.fontWeight || '700'}; 
            fill: ${textColor};
          }
          .description { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
            font-size: ${template.typography.description?.fontSize || 24}px; 
            font-weight: ${template.typography.description?.fontWeight || '400'}; 
            fill: ${textColor};
            opacity: 0.9;
          }
        </style>
      </defs>
      
      <text x="${padding}" y="${height / 2}" class="title">
        ${escapeXml(metadata.title)}
      </text>
      
      ${
        metadata.description
          ? `
        <text x="${padding}" y="${height / 2 + 40}" class="description">
          ${escapeXml(metadata.description.substring(0, 100))}
        </text>
      `
          : ''
      }
    </svg>
  `;

  return Buffer.from(overlaySvg);
}

/**
 * Escape XML special characters
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate preview with full result details
 */
export async function generatePreviewWithDetails(
  url: string,
  options: PreviewOptions = {}
): Promise<GeneratedPreview> {
  const buffer = await generatePreview(url, options);
  const metadata = await extractMetadata(url);

  return {
    buffer,
    format: 'jpeg',
    dimensions: {
      width: options.width || DEFAULT_DIMENSIONS.width,
      height: options.height || DEFAULT_DIMENSIONS.height,
    },
    metadata,
    template: options.template || 'modern',
    cached: false, // TODO: Implement caching
  };
}
