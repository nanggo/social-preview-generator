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
import { classicTemplate, generateClassicOverlay } from './templates/classic';
import { minimalTemplate, generateMinimalOverlay } from './templates/minimal';
import { escapeXml, logImageFetchError, wrapText } from './utils';
import { createTransparentCanvas } from './utils/validators';
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
  classic: classicTemplate,
  minimal: minimalTemplate,
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
    // Create base image with template-specific processing
    const baseImage = await processImageForTemplate(metadata, template, width, height, options);

    // Generate overlay based on template
    let overlayBuffer: Buffer;

    switch (template.name) {
      case 'modern': {
        const modernOverlaySvg = generateModernOverlay(metadata, width, height, options);
        overlayBuffer = Buffer.from(modernOverlaySvg);
        break;
      }
      case 'classic': {
        const classicOverlaySvg = generateClassicOverlay(metadata, width, height, options);
        overlayBuffer = Buffer.from(classicOverlaySvg);
        break;
      }
      case 'minimal': {
        const minimalOverlaySvg = generateMinimalOverlay(metadata, width, height, options);
        overlayBuffer = Buffer.from(minimalOverlaySvg);
        break;
      }
      default:
        // Fallback to default overlay generation
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
 * Generate default overlay for non-modern templates with proper text wrapping
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

  // Typography settings
  const titleFontSize = template.typography.title.fontSize;
  const titleLineHeight = template.typography.title.lineHeight || 1.2;
  const descFontSize = template.typography.description?.fontSize || 24;
  const descLineHeight = template.typography.description?.lineHeight || 1.4;

  // Text wrapping similar to specific template generators
  const maxTextWidth = width - padding * 2;
  const titleLines = wrapText(
    metadata.title,
    maxTextWidth,
    titleFontSize,
    template.typography.title.maxLines || 2,
    'default'
  );
  const descLines = metadata.description
    ? wrapText(
        metadata.description,
        maxTextWidth,
        descFontSize,
        template.typography.description?.maxLines || 2,
        'default'
      )
    : [];

  // Calculate positions for proper vertical centering
  const titleHeight = titleLines.length * titleFontSize * titleLineHeight;
  const descHeight = descLines.length > 0 ? descLines.length * descFontSize * descLineHeight : 0;
  const gap = descLines.length > 0 ? 20 : 0;
  const totalContentHeight = titleHeight + gap + descHeight;

  const contentStartY = (height - totalContentHeight) / 2;
  const titleStartY = contentStartY + titleFontSize;
  const descStartY = titleStartY + titleHeight + gap;

  const overlaySvg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          .title { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
            font-size: ${titleFontSize}px; 
            font-weight: ${template.typography.title.fontWeight || '700'}; 
            fill: ${textColor};
          }
          .description { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
            font-size: ${descFontSize}px; 
            font-weight: ${template.typography.description?.fontWeight || '400'}; 
            fill: ${textColor};
            opacity: 0.9;
          }
        </style>
      </defs>
      
      <!-- Title with proper wrapping -->
      ${titleLines
        .map(
          (line: string, index: number) => `
      <text x="${padding}" y="${titleStartY + index * titleFontSize * titleLineHeight}" class="title">
        ${escapeXml(line)}
      </text>
      `
        )
        .join('')}
      
      <!-- Description with proper wrapping -->
      ${
        descLines.length > 0
          ? descLines
              .map(
                (line: string, index: number) => `
      <text x="${padding}" y="${descStartY + index * descFontSize * descLineHeight}" class="description">
        ${escapeXml(line)}
      </text>
      `
              )
              .join('')
          : ''
      }
    </svg>
  `;

  return Buffer.from(overlaySvg);
}

/**
 * Process image for template with template-specific configuration
 */
async function processImageForTemplate(
  metadata: ExtractedMetadata,
  template: TemplateConfig,
  width: number,
  height: number,
  options: PreviewOptions
): Promise<sharp.Sharp> {
  // Check if template wants no background image
  if (template.layout.imagePosition === 'none') {
    // For templates with custom backgrounds (minimal, classic), return transparent canvas
    // They will provide their own background in the SVG overlay
    if (template.name === 'minimal' || template.name === 'classic') {
      return createTransparentCanvas(width, height);
    }
    return await createBlankCanvas(width, height, options);
  }

  // If no image available, handle based on template
  if (!metadata.image) {
    // Templates with custom backgrounds should use transparent canvas
    if (template.name === 'minimal' || template.name === 'classic') {
      return createTransparentCanvas(width, height);
    }
    return await createBlankCanvas(width, height, options);
  }

  // Process background image with template-specific effects
  let fetchImage;
  try {
    const metadataModule = await import('./core/metadata-extractor');
    fetchImage = metadataModule.fetchImage;
  } catch (importError) {
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      `Failed to import metadata extractor module: ${importError instanceof Error ? importError.message : String(importError)}`,
      importError
    );
  }

  try {
    const imageBuffer = await fetchImage(metadata.image);
    let processedImage = sharp(imageBuffer).resize(width, height, {
      fit: 'cover',
      position: 'center',
    });

    // Apply template-specific blur
    const blurRadius = template.effects?.blur?.radius ?? 0;
    if (blurRadius > 0) {
      processedImage = processedImage.blur(blurRadius);
    }

    // Apply template-specific brightness/modulation
    const brightnessEffect = getBrightnessForTemplate(template);
    if (brightnessEffect !== 1.0) {
      processedImage = processedImage.modulate({
        brightness: brightnessEffect,
      });
    }

    return processedImage;
  } catch (fetchError) {
    // If image fetch fails, create appropriate canvas based on template
    logImageFetchError(
      metadata.image,
      fetchError instanceof Error ? fetchError : new Error(String(fetchError))
    );

    // Templates with custom backgrounds should use transparent canvas
    if (template.name === 'minimal' || template.name === 'classic') {
      return createTransparentCanvas(width, height);
    }
    return await createBlankCanvas(width, height, options);
  }
}

/**
 * Get brightness effect for template based on its design
 */
function getBrightnessForTemplate(template: TemplateConfig): number {
  // Template-specific brightness adjustments for better text readability
  switch (template.name) {
    case 'modern':
      return 0.7; // Darker for better white text contrast
    case 'classic':
      return 0.9; // Slightly darker for business look
    case 'minimal':
      return 1.0; // No adjustment for clean look
    default:
      return 0.8; // Default moderate darkening
  }
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
