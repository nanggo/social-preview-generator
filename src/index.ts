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
import {
  extractMetadata,
  validateMetadata,
  applyFallbacks,
  fetchImage,
} from './core/metadata-extractor';
import { createFallbackImage, DEFAULT_DIMENSIONS, createBlankCanvas } from './core/image-generator';
import { modernTemplate } from './templates/modern';
import { classicTemplate } from './templates/classic';
import { minimalTemplate } from './templates/minimal';
import { escapeXml, logImageFetchError, wrapText } from './utils';
import {
  createTransparentCanvas,
  validateDimensions,
  validateColor,
  validateOptions,
  sanitizeOptions,
} from './utils/validators';
import { SanitizedOptions } from './types';
import sharp from 'sharp';
import { initializeSharpSecurity, secureResize } from './utils/image-security';

// Initialize Sharp security settings
initializeSharpSecurity();

// Pre-load image security module at module level for performance
const imageSecurityPromise = import('./utils/image-security');

// Re-export types
export {
  PreviewOptions,
  ExtractedMetadata,
  GeneratedPreview,
  TemplateConfig,
  ErrorType,
  PreviewGeneratorError,
};

// Re-export cache management functions
export {
  startCacheCleanup,
  stopCacheCleanup,
  isCacheCleanupRunning,
} from './utils/cache';

// Re-export metadata extraction utilities
export {
  getInflightRequestStats,
  clearInflightRequests,
} from './core/metadata-extractor';

// Re-export Sharp caching utilities
export {
  getCacheStats,
  clearAllCaches,
  shutdownSharpCaches,
} from './utils/sharp-cache';

// Re-export modern Sharp API (recommended for new code)
export {
  createCachedSharp,
  withCachedSharp,
} from './utils/sharp-pool';

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
  const result = await generatePreviewWithDetails(url, options);
  return result.buffer;
}

/**
 * Generate image with specific template
 */
export async function generateImageWithTemplate(
  metadata: ExtractedMetadata,
  template: TemplateConfig,
  options: PreviewOptions
): Promise<Buffer> {
  // Use centralized validation gateway - returns sanitized options
  const sanitizedOptions = sanitizeOptions(options);
  
  const width = sanitizedOptions.width || DEFAULT_DIMENSIONS.width;
  const height = sanitizedOptions.height || DEFAULT_DIMENSIONS.height;
  const quality = sanitizedOptions.quality || 90;

  try {
    // Validate dimensions once at the start
    validateDimensions(width, height);

    // Create base image with template-specific processing
    const baseImage = await processImageForTemplate(metadata, template, width, height, sanitizedOptions);

    // Generate overlay using template's overlay generator
    let overlayBuffer: Buffer;

    if (template.overlayGenerator) {
      const overlaySvg = template.overlayGenerator(metadata, width, height, options, template);
      overlayBuffer = Buffer.from(overlaySvg);
    } else {
      // Fallback to default overlay generation for custom templates
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
      .jpeg({ 
        quality,
        progressive: true,
        mozjpeg: true 
      })
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
  const textColor = validateColor(options.colors?.text || '#ffffff');

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

  // Use cached SVG creation for better performance
  const { createCachedSVG } = await import('./utils/sharp-cache');
  const cachedSVG = await createCachedSVG(overlaySvg);
  return cachedSVG.toBuffer();
}

/**
 * Process image for template with template-specific configuration
 */
async function processImageForTemplate(
  metadata: ExtractedMetadata,
  template: TemplateConfig,
  width: number,
  height: number,
  options: SanitizedOptions
): Promise<sharp.Sharp> {
  // Check if template wants no background image
  if (template.layout.imagePosition === 'none') {
    // Use transparent canvas if template requires it, otherwise use blank canvas
    if (template.imageProcessing?.requiresTransparentCanvas) {
      return await createTransparentCanvas(width, height);
    }
    return await createBlankCanvas(width, height, options);
  }

  // If no image available, handle based on template configuration
  if (!metadata.image) {
    // Use transparent canvas if template requires it for custom backgrounds
    if (template.imageProcessing?.requiresTransparentCanvas) {
      return await createTransparentCanvas(width, height);
    }
    return await createBlankCanvas(width, height, options);
  }

  // Process background image with template-specific effects
  try {
    const imageBuffer = await fetchImage(metadata.image, options.security);
    
    // Use withSecureSharp for automatic pool management
    const { withSecureSharp } = await imageSecurityPromise;
    return await withSecureSharp(imageBuffer, async (secureImage) => {
      let processedImage = secureResize(secureImage, width, height, {
        fit: 'cover',
        position: 'center',
      });

      // Apply template-specific effects in optimized pipeline
      const blurRadius = template.effects?.blur?.radius ?? 0;
      const brightnessValue = template.imageProcessing?.brightness ?? 1.0;
      const saturationValue = template.imageProcessing?.saturation;

      // Apply blur first if needed
      if (blurRadius > 0) {
        processedImage = processedImage.blur(blurRadius);
      }

      // Apply brightness and saturation together for efficiency
      if (brightnessValue !== 1.0 || saturationValue !== undefined) {
        const modulateOptions: { brightness?: number; saturation?: number } = {};
        
        if (brightnessValue !== 1.0) {
          modulateOptions.brightness = brightnessValue;
        }
        
        if (saturationValue !== undefined) {
          modulateOptions.saturation = saturationValue;
        }
        
        processedImage = processedImage.modulate(modulateOptions);
      }

      return processedImage;
    });
  } catch (fetchError) {
    // If image fetch fails, create appropriate canvas based on template configuration
    logImageFetchError(
      metadata.image,
      fetchError instanceof Error ? fetchError : new Error(String(fetchError))
    );

    // Use transparent canvas if template requires it for custom backgrounds
    if (template.imageProcessing?.requiresTransparentCanvas) {
      return await createTransparentCanvas(width, height);
    }
    return await createBlankCanvas(width, height, options);
  }
}

/**
 * Generate preview with full result details
 */
export async function generatePreviewWithDetails(
  url: string,
  options: PreviewOptions = {}
): Promise<GeneratedPreview> {
  try {
    // Validate options first
    validateOptions(options);

    // Set default options
    const finalOptions: PreviewOptions = {
      template: 'modern',
      width: DEFAULT_DIMENSIONS.width,
      height: DEFAULT_DIMENSIONS.height,
      quality: 90,
      cache: false, // Set to false until caching is properly implemented
      ...options,
    };

    // Extract metadata from URL once
    let metadata: ExtractedMetadata;
    try {
      metadata = await extractMetadata(url, finalOptions.security);

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
        const buffer = await createFallbackImage(url, finalOptions);
        // Create minimal metadata for fallback
        const fallbackMetadata = applyFallbacks({}, url);
        return {
          buffer,
          format: 'jpeg',
          dimensions: {
            width: finalOptions.width || DEFAULT_DIMENSIONS.width,
            height: finalOptions.height || DEFAULT_DIMENSIONS.height,
          },
          metadata: fallbackMetadata,
          template: finalOptions.template || 'modern',
          cached: false,
        };
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

    // Generate image based on template - reuse metadata instead of re-extracting
    const buffer = await generateImageWithTemplate(
      metadata,
      template || templates.modern,
      finalOptions
    );

    return {
      buffer,
      format: 'jpeg',
      dimensions: {
        width: finalOptions.width || DEFAULT_DIMENSIONS.width,
        height: finalOptions.height || DEFAULT_DIMENSIONS.height,
      },
      metadata,
      template: finalOptions.template || 'modern',
      cached: false, // TODO: Implement caching
    };
  } catch (error) {
    if (error instanceof PreviewGeneratorError) {
      throw error;
    }
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      `Failed to generate preview with details for ${url}: ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }
}
