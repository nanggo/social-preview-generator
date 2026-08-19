/**
 * Social Preview Generator
 * Generate beautiful social media preview images from any URL
 */

import {
  PreviewOptions,
  PreviewMetadataInput,
  SanitizedOptions,
  ExtractedMetadata,
  GeneratedPreview,
  TemplateConfig,
  ErrorType,
  PreviewGeneratorError,
} from './types';
import { extractMetadata, validateMetadata, applyFallbacks } from './core/metadata-extractor';
import { createFallbackImageWithDetails, DEFAULT_DIMENSIONS } from './core/image-generator';
import { templates } from './templates/registry';
import {
  validateDimensions,
  normalizeMetadataForRendering,
  sanitizeOptions,
  validateTemplateConfig,
  validateUrlInput,
} from './utils/validators';
import { initializeSharpSecurity } from './utils/image-security';
import { generateDefaultOverlay } from './core/overlay-generator';
import {
  prepareImageForTemplate,
  processImageForTemplate,
  type PreparedTemplateImage,
  type ProcessedTemplateImage,
} from './core/template-image-processing';
import { getCachedPreview, setCachedPreview } from './utils/preview-cache';
import { createCachedSVG } from './utils/sharp-cache';
import { startCacheCleanup, isCacheCleanupRunning } from './utils/cache';
import { withPreparedRenderSlot, withRenderSlot } from './utils/render-limiter';
import { isSharpProcessingTimeout } from './utils/sharp-timeout';
import { createSafeErrorDetails } from './utils/network-diagnostics';

// Initialize Sharp security settings (no side-effect timers at import time)
initializeSharpSecurity();

export * from './exports';

// Note: Sharp caching utilities (createCachedSVG, createCachedCanvas) are used internally
// Direct Sharp instance creation is now recommended over pooling for better reliability

const FALLBACK_PREVIEW_CACHE_TTL_MS = 30_000;

function createFinalOptions(options: PreviewOptions = {}): SanitizedOptions {
  return sanitizeOptions({
    template: 'modern',
    width: DEFAULT_DIMENSIONS.width,
    height: DEFAULT_DIMENSIONS.height,
    quality: 90,
    cache: false,
    ...options,
  });
}

function getTemplate(templateName: SanitizedOptions['template']): TemplateConfig {
  const template = templates[templateName || 'modern'];

  if (!template) {
    throw new PreviewGeneratorError(
      ErrorType.TEMPLATE_ERROR,
      `Template "${templateName}" not found`
    );
  }

  return template;
}

function createPreviewResult(
  buffer: Buffer,
  metadata: ExtractedMetadata,
  finalOptions: SanitizedOptions
): GeneratedPreview {
  return {
    buffer,
    format: 'jpeg',
    dimensions: {
      width: finalOptions.width || DEFAULT_DIMENSIONS.width,
      height: finalOptions.height || DEFAULT_DIMENSIONS.height,
    },
    metadata: { ...metadata },
    template: finalOptions.template || 'modern',
    cached: false,
  };
}

function createMetadataPreviewCacheKey(metadata: ExtractedMetadata): string {
  return `metadata:${JSON.stringify(metadata)}`;
}

async function renderPreviewFromMetadata(
  metadata: ExtractedMetadata,
  finalOptions: SanitizedOptions
): Promise<GeneratedPreview> {
  const template = validateTemplateConfig(getTemplate(finalOptions.template));
  const rendered = await generateImageWithSanitizedOptions(metadata, template, finalOptions);
  return createPreviewResult(rendered.buffer, rendered.effectiveMetadata, finalOptions);
}

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
 * Generate a social preview image from caller-provided metadata.
 * Use this for static/publish-time blog preview generation when metadata is already known.
 * @param metadata - Post/page metadata to render
 * @param options - Configuration options
 * @returns Buffer containing the generated image
 */
export async function generatePreviewFromMetadata(
  metadata: PreviewMetadataInput,
  options: PreviewOptions = {}
): Promise<Buffer> {
  const result = await generatePreviewFromMetadataWithDetails(metadata, options);
  return result.buffer;
}

/**
 * Generate an image with a caller-provided template.
 * Metadata text and template numbers are bounded before rendering. The optional
 * overlayGenerator is trusted caller code, while its SVG return value must be a
 * string no larger than 1 MiB in UTF-8 bytes.
 */
export async function generateImageWithTemplate(
  metadata: ExtractedMetadata,
  template: TemplateConfig,
  options: PreviewOptions
): Promise<Buffer> {
  const sanitizedOptions = sanitizeOptions(options);
  const normalizedMetadata = normalizeMetadataForRendering(metadata, 'custom');
  const validatedTemplate = validateTemplateConfig(template);
  const rendered = await generateImageWithSanitizedOptions(
    normalizedMetadata,
    validatedTemplate,
    sanitizedOptions
  );
  return rendered.buffer;
}

interface RenderedImage {
  buffer: Buffer;
  effectiveMetadata: ExtractedMetadata;
}

async function createOverlayBuffer(
  effectiveMetadata: ExtractedMetadata,
  template: TemplateConfig,
  width: number,
  height: number,
  sanitizedOptions: SanitizedOptions
): Promise<Buffer> {
  if (template.overlayGenerator) {
    let overlaySvg: string;
    try {
      const overlayResult: unknown = template.overlayGenerator(
        effectiveMetadata,
        width,
        height,
        sanitizedOptions,
        template
      );
      const resultType = typeof overlayResult;
      if (
        (resultType === 'object' && overlayResult !== null) ||
        resultType === 'function'
      ) {
        const then = (overlayResult as { then?: unknown }).then;
        if (typeof then === 'function') {
          // The public callback contract is synchronous. Consume rejected
          // thenables immediately so a JavaScript caller cannot turn invalid
          // callback output into an unhandled rejection containing secrets.
          void Promise.resolve(overlayResult).catch(() => undefined);
          throw new Error('Asynchronous overlay generators are not supported');
        }
      }
      overlaySvg = overlayResult as string;
    } catch {
      // Caller callbacks are trusted code, but their exceptions may contain
      // secrets or attacker-derived metadata. Do not preserve any fields.
      throw new PreviewGeneratorError(
        ErrorType.IMAGE_ERROR,
        'Failed to generate image with template'
      );
    }
    // Materialize custom SVG overlays before entering the background-image
    // retry path. Otherwise Sharp can defer an SVG parse error until the final
    // composite and incorrectly classify it as a failed background image.
    const overlayImage = await createCachedSVG(overlaySvg);
    return overlayImage.toBuffer();
  }

  return generateDefaultOverlay(effectiveMetadata, template, width, height, sanitizedOptions);
}

function renderProcessedImage(
  processedImage: ProcessedTemplateImage,
  overlayBuffer: Buffer,
  quality: number
): Promise<Buffer> {
  return processedImage.baseImage
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
      mozjpeg: true,
    })
    .toBuffer();
}

/**
 * Internal image generation with pre-validated options (skips redundant validation)
 */
async function generateImageWithSanitizedOptions(
  metadata: ExtractedMetadata,
  template: TemplateConfig,
  sanitizedOptions: SanitizedOptions
): Promise<RenderedImage> {
  const width = sanitizedOptions.width || DEFAULT_DIMENSIONS.width;
  const height = sanitizedOptions.height || DEFAULT_DIMENSIONS.height;
  const quality = sanitizedOptions.quality || 90;

  const renderPreparedImage = async (
    preparedImage: PreparedTemplateImage
  ): Promise<RenderedImage> => {
    try {
      validateDimensions(width, height);

      let processedImage = await processImageForTemplate(
        preparedImage,
        template,
        width,
        height,
        sanitizedOptions
      );
      let overlayBuffer = await createOverlayBuffer(
        processedImage.effectiveMetadata,
        template,
        width,
        height,
        sanitizedOptions
      );

      let finalImage: Buffer;
      try {
        finalImage = await renderProcessedImage(processedImage, overlayBuffer, quality);
      } catch (processingError) {
        if (!processedImage.usedBackgroundImage || isSharpProcessingTimeout(processingError)) {
          throw processingError;
        }

        // Sharp evaluates image pipelines lazily, so decoding/resizing can fail
        // only while producing the final buffer. Retry once with the same
        // metadata minus the failed background image. Native Sharp timeouts are
        // never retried because doing so doubles work after resource exhaustion.
        processedImage = await processImageForTemplate(
          {
            effectiveMetadata: { ...processedImage.effectiveMetadata, image: undefined },
          },
          template,
          width,
          height,
          sanitizedOptions
        );
        overlayBuffer = await createOverlayBuffer(
          processedImage.effectiveMetadata,
          template,
          width,
          height,
          sanitizedOptions
        );
        finalImage = await renderProcessedImage(processedImage, overlayBuffer, quality);
      }

      return {
        buffer: finalImage,
        effectiveMetadata: processedImage.effectiveMetadata,
      };
    } catch (error) {
      if (error instanceof PreviewGeneratorError) {
        throw error;
      }
      throw new PreviewGeneratorError(
        ErrorType.IMAGE_ERROR,
        'Failed to generate image with template',
        createSafeErrorDetails(error)
      );
    }
  };

  if (template.layout.imagePosition !== 'none' && metadata.image) {
    return withPreparedRenderSlot(
      () => prepareImageForTemplate(metadata, template, sanitizedOptions),
      renderPreparedImage
    );
  }

  const preparedImage = await prepareImageForTemplate(metadata, template, sanitizedOptions);
  return withRenderSlot(() => renderPreparedImage(preparedImage));
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

    const finalOptions = createFinalOptions(options);
    const normalizedUrl = validateUrlInput(url, {
      httpsOnly: finalOptions.security?.httpsOnly === true,
    });

    const shouldCache = finalOptions.cache === true;
    if (shouldCache) {
      const cached = getCachedPreview(normalizedUrl, finalOptions);
      if (cached) {
        return { ...cached, cached: true };
      }
    }

    // Extract metadata from URL once
    let metadata: ExtractedMetadata;
    try {
      metadata = await extractMetadata(normalizedUrl, finalOptions.security);

      // Validate metadata
      if (!validateMetadata(metadata)) {
        // Apply fallbacks if metadata is incomplete
        metadata = applyFallbacks(metadata, normalizedUrl);
      }
    } catch (error) {
      // Input and security-policy violations must remain observable to callers.
      // Falling back here would turn a rejected URL (for example, HTTP in
      // HTTPS-only mode or a blocked SSRF target) into a successful response.
      if (
        error instanceof PreviewGeneratorError &&
        error.type === ErrorType.VALIDATION_ERROR
      ) {
        throw error;
      }

      // If metadata extraction fails completely, use fallback
      if (
        finalOptions.fallback?.strategy === 'generate' ||
        finalOptions.fallback?.strategy === 'auto'
      ) {
        const fallback = await createFallbackImageWithDetails(normalizedUrl, finalOptions);
        const fallbackResult: GeneratedPreview = {
          buffer: fallback.buffer,
          format: 'jpeg',
          dimensions: {
            width: finalOptions.width || DEFAULT_DIMENSIONS.width,
            height: finalOptions.height || DEFAULT_DIMENSIONS.height,
          },
          metadata: fallback.metadata,
          template: fallback.template,
          cached: false,
        };
        if (shouldCache) {
          setCachedPreview(
            normalizedUrl,
            finalOptions,
            fallbackResult,
            FALLBACK_PREVIEW_CACHE_TTL_MS
          );
        }
        return fallbackResult;
      }
      throw error;
    }

    const result = await renderPreviewFromMetadata(metadata, finalOptions);
    if (shouldCache) {
      setCachedPreview(normalizedUrl, finalOptions, result);
    }
    return result;
  } catch (error) {
    if (error instanceof PreviewGeneratorError) {
      throw error;
    }
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      'Failed to generate preview with details',
      createSafeErrorDetails(error)
    );
  }
}

/**
 * Generate a preview from caller-provided metadata with full result details.
 */
export async function generatePreviewFromMetadataWithDetails(
  metadataInput: PreviewMetadataInput,
  options: PreviewOptions = {}
): Promise<GeneratedPreview> {
  try {
    // Lazily start cache cleanup on first actual usage (not at import time)
    if (!isCacheCleanupRunning()) {
      startCacheCleanup();
    }

    const finalOptions = createFinalOptions(options);
    const metadata = normalizeMetadataForRendering(metadataInput, 'direct');

    const shouldCache = finalOptions.cache === true;
    const cacheKey = createMetadataPreviewCacheKey(metadata);
    if (shouldCache) {
      const cached = getCachedPreview(cacheKey, finalOptions);
      if (cached) {
        return { ...cached, cached: true };
      }
    }

    const result = await renderPreviewFromMetadata(metadata, finalOptions);
    if (shouldCache) {
      setCachedPreview(cacheKey, finalOptions, result);
    }
    return result;
  } catch (error) {
    if (error instanceof PreviewGeneratorError) {
      throw error;
    }
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      'Failed to generate preview from metadata',
      createSafeErrorDetails(error)
    );
  }
}
