/**
 * Social Preview Generator
 * Generate beautiful social media preview images from any URL
 */

import {
  PreviewOptions,
  SanitizedOptions,
  ExtractedMetadata,
  GeneratedPreview,
  TemplateConfig,
  ErrorType,
  PreviewGeneratorError,
} from './types';
import { extractMetadata, validateMetadata, applyFallbacks } from './core/metadata-extractor';
import { createFallbackImage, DEFAULT_DIMENSIONS } from './core/image-generator';
import { templates } from './templates/registry';
import { validateDimensions, sanitizeOptions } from './utils/validators';
import { initializeSharpSecurity } from './utils/image-security';
import { generateDefaultOverlay } from './core/overlay-generator';
import { processImageForTemplate } from './core/template-image-processing';
import { getCachedPreview, setCachedPreview } from './utils/preview-cache';
import { svgCache } from './utils/sharp-cache';
import { startCacheCleanup, isCacheCleanupRunning } from './utils/cache';

// Initialize Sharp security settings (no side-effect timers at import time)
initializeSharpSecurity();

export * from './exports';

// Note: Sharp caching utilities (createCachedSVG, createCachedCanvas) are used internally
// Direct Sharp instance creation is now recommended over pooling for better reliability

const FALLBACK_PREVIEW_CACHE_TTL_MS = 30_000;

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
 * Generate image with specific template (public API - validates options)
 */
export async function generateImageWithTemplate(
  metadata: ExtractedMetadata,
  template: TemplateConfig,
  options: PreviewOptions
): Promise<Buffer> {
  const sanitizedOptions = sanitizeOptions(options);
  return generateImageWithSanitizedOptions(metadata, template, sanitizedOptions);
}

/**
 * Internal image generation with pre-validated options (skips redundant validation)
 */
async function generateImageWithSanitizedOptions(
  metadata: ExtractedMetadata,
  template: TemplateConfig,
  sanitizedOptions: SanitizedOptions
): Promise<Buffer> {
  const width = sanitizedOptions.width || DEFAULT_DIMENSIONS.width;
  const height = sanitizedOptions.height || DEFAULT_DIMENSIONS.height;
  const quality = sanitizedOptions.quality || 90;

  try {
    validateDimensions(width, height);

    const baseImage = await processImageForTemplate(metadata, template, width, height, sanitizedOptions);

    let overlayBuffer: Buffer;

    if (template.overlayGenerator) {
      const overlaySvg = template.overlayGenerator(metadata, width, height, sanitizedOptions, template);
      overlayBuffer = svgCache.getCachedSVG(overlaySvg) ?? svgCache.cacheSVG(overlaySvg);
    } else {
      overlayBuffer = await generateDefaultOverlay(metadata, template, width, height, sanitizedOptions);
    }

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
 * Generate preview with full result details
 */
export async function generatePreviewWithDetails(
  url: string,
  options: PreviewOptions = {}
): Promise<GeneratedPreview> {
  try {
    // Lazily start cache cleanup on first actual usage (not at import time)
    if (!isCacheCleanupRunning()) {
      startCacheCleanup();
    }

    // Merge defaults then validate+sanitize in a single pass
    const finalOptions = sanitizeOptions({
      template: 'modern',
      width: DEFAULT_DIMENSIONS.width,
      height: DEFAULT_DIMENSIONS.height,
      quality: 90,
      cache: false,
      ...options,
    });

    const shouldCache = finalOptions.cache === true;
    if (shouldCache) {
      const cached = getCachedPreview(url, finalOptions);
      if (cached) {
        return { ...cached, cached: true };
      }
    }

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
        const fallbackResult: GeneratedPreview = {
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
        if (shouldCache) {
          setCachedPreview(url, finalOptions, fallbackResult, FALLBACK_PREVIEW_CACHE_TTL_MS);
        }
        return fallbackResult;
      }
      throw error;
    }

    // Get template configuration
    const templateName = finalOptions.template || 'modern';
    const template = templates[templateName];

    if (!template) {
      throw new PreviewGeneratorError(
        ErrorType.TEMPLATE_ERROR,
        `Template "${templateName}" not found`
      );
    }

    // Generate image based on template - use pre-sanitized options with defaults applied
    const buffer = await generateImageWithSanitizedOptions(
      metadata,
      template,
      finalOptions
    );

    const result: GeneratedPreview = {
      buffer,
      format: 'jpeg',
      dimensions: {
        width: finalOptions.width || DEFAULT_DIMENSIONS.width,
        height: finalOptions.height || DEFAULT_DIMENSIONS.height,
      },
      metadata,
      template: finalOptions.template || 'modern',
      cached: false,
    };
    if (shouldCache) {
      setCachedPreview(url, finalOptions, result);
    }
    return result;
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
