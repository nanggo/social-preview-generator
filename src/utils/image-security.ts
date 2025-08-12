/**
 * Image security utilities and Sharp configuration
 * Prevents pixel bomb attacks and validates image dimensions
 */

import sharp from 'sharp';
import { PreviewGeneratorError, ErrorType } from '../types';
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';

// Maximum allowed pixels for image processing (32 megapixels)
const MAX_INPUT_PIXELS = 32 * 1024 * 1024;

// Maximum image dimensions
const MAX_WIDTH = 8192;
const MAX_HEIGHT = 8192;

// Maximum file size (15MB)
const MAX_FILE_SIZE = 15 * 1024 * 1024;

/**
 * Initialize Sharp with security settings
 * Should be called once at application startup
 */
export function initializeSharpSecurity(): void {
  try {
    // Set global pixel limit to prevent pixel bomb attacks
    // Note: sharp.limitInputPixels() might not be available in all versions
    if (
      typeof (sharp as unknown as { limitInputPixels?: (pixels: number) => void })
        .limitInputPixels === 'function'
    ) {
      (sharp as unknown as { limitInputPixels: (pixels: number) => void }).limitInputPixels(
        MAX_INPUT_PIXELS
      );
    }

    // Set memory limits
    sharp.cache({
      memory: 100, // 100MB memory cache
      files: 20, // 20 files cache
      items: 200, // 200 operations cache
    });

    // Set concurrency limit to prevent resource exhaustion
    sharp.concurrency(4);
  } catch (error) {
    // Silently fail if Sharp configuration is not supported
    // eslint-disable-next-line no-console
    console.warn('Could not configure Sharp security settings:', error);
  }
}

/**
 * Validate image buffer before processing
 */
export async function validateImageBuffer(
  imageBuffer: Buffer,
  allowSvg: boolean = false
): Promise<void> {
  // Check file size
  if (imageBuffer.length > MAX_FILE_SIZE) {
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      `Image file too large: ${imageBuffer.length} bytes. Maximum allowed: ${MAX_FILE_SIZE} bytes.`
    );
  }

  // Special-case SVG first (text-based, not reliably detected by magic bytes)
  const isSvgCandidate =
    allowSvg && imageBuffer.toString('utf8', 0, 512).toLowerCase().includes('<svg');
  if (isSvgCandidate) {
    await validateSvgContent(imageBuffer);
    return; // Skip Sharp validation for SVG
  }

  // Hybrid validation: try file-type first, fallback to magic bytes
  await validateImageFormat(imageBuffer);

  try {
    // Get metadata without loading the full image
    const metadata = await sharp(imageBuffer, { failOnError: false }).metadata();

    // Check if dimensions are valid
    if (!metadata.width || !metadata.height) {
      throw new PreviewGeneratorError(
        ErrorType.IMAGE_ERROR,
        'Could not determine image dimensions'
      );
    }

    // Check maximum dimensions
    if (metadata.width > MAX_WIDTH || metadata.height > MAX_HEIGHT) {
      throw new PreviewGeneratorError(
        ErrorType.IMAGE_ERROR,
        `Image dimensions too large: ${metadata.width}x${metadata.height}. Maximum allowed: ${MAX_WIDTH}x${MAX_HEIGHT}`
      );
    }

    // Check total pixel count (additional protection)
    const totalPixels = metadata.width * metadata.height;
    if (totalPixels > MAX_INPUT_PIXELS) {
      throw new PreviewGeneratorError(
        ErrorType.IMAGE_ERROR,
        `Image has too many pixels: ${totalPixels}. Maximum allowed: ${MAX_INPUT_PIXELS}`
      );
    }

    // Sharp format validation - ensure it's a recognized image format
    const supportedFormats = ['jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff'];
    if (metadata.format && !supportedFormats.includes(metadata.format)) {
      throw new PreviewGeneratorError(
        ErrorType.IMAGE_ERROR,
        `Unsupported image format detected by Sharp: ${metadata.format}`
      );
    }
  } catch (error) {
    if (error instanceof PreviewGeneratorError) {
      throw error;
    }

    // Sharp couldn't process the file - likely malformed or not an image
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      `Invalid or corrupted image file: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Validate image format using hybrid approach: file-type with magic bytes fallback
 */
async function validateImageFormat(imageBuffer: Buffer): Promise<void> {
  const ALLOWED_MIME_TYPES = new Set<string>([
    'image/jpeg',
    'image/png', 
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/tiff',
  ]);

  // First attempt: Use file-type library for robust detection
  try {
    const { fileTypeFromBuffer } = await import('file-type');
    const detected = await fileTypeFromBuffer(imageBuffer);

    if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
      throw new PreviewGeneratorError(
        ErrorType.IMAGE_ERROR,
        `Unsupported image format detected by file-type: ${detected?.mime || 'unknown'}. Only JPEG, PNG, WebP, GIF, BMP, and TIFF are supported.`
      );
    }
    
    // file-type succeeded
    return;
  } catch (error) {
    // If it's already our error, re-throw
    if (error instanceof PreviewGeneratorError) {
      throw error;
    }
    
    // file-type failed (module not found, etc.), try magic bytes fallback
    console.warn('file-type validation failed, falling back to magic bytes:', error instanceof Error ? error.message : String(error));
  }

  // Fallback: Manual magic bytes validation
  const header = imageBuffer.slice(0, 16);
  
  const isJPEG = header[0] === 0xFF && header[1] === 0xD8;
  const isPNG = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47;
  const isWebP = header.indexOf(Buffer.from('WEBP')) !== -1;
  const isGIF = header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46;
  const isBMP = header[0] === 0x42 && header[1] === 0x4D;
  const isTIFF = (header[0] === 0x49 && header[1] === 0x49 && header[2] === 0x2A && header[3] === 0x00) ||
                 (header[0] === 0x4D && header[1] === 0x4D && header[2] === 0x00 && header[3] === 0x2A);

  if (!isJPEG && !isPNG && !isWebP && !isGIF && !isBMP && !isTIFF) {
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      'Unsupported image format detected by magic bytes fallback. Only JPEG, PNG, WebP, GIF, BMP, and TIFF are supported.'
    );
  }
}

/**
 * Validate SVG content for security risks using DOMPurify
 */
async function validateSvgContent(svgBuffer: Buffer): Promise<void> {
  const svgContent = svgBuffer.toString('utf8');

  // Check SVG size limits first
  if (svgContent.length > 1024 * 1024) {
    // 1MB limit for SVG
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      `SVG content too large: ${svgContent.length} characters. Maximum allowed: 1MB`
    );
  }

  try {
    // Create JSDOM window for DOMPurify
    const window = new JSDOM('').window;
    const purify = DOMPurify(window);

    // Configure DOMPurify for strict SVG sanitization with detailed reporting
    const cleanSvg = purify.sanitize(svgContent, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ALLOWED_TAGS: [
        'svg',
        'g',
        'path',
        'rect',
        'circle',
        'ellipse',
        'line',
        'polyline',
        'polygon',
        'text',
        'tspan',
        'textPath',
        'defs',
        'clipPath',
        'mask',
        'pattern',
        'image',
        'switch',
        'marker',
        'symbol',
        'use',
        'style',
        'linearGradient',
        'radialGradient',
        'stop',
        'animate',
        'animateTransform',
        'animateMotion',
        'set',
        'title',
        'desc',
        'metadata',
      ],
      ALLOWED_ATTR: [
        'id',
        'class',
        'style',
        'x',
        'y',
        'x1',
        'y1',
        'x2',
        'y2',
        'cx',
        'cy',
        'r',
        'rx',
        'ry',
        'width',
        'height',
        'd',
        'fill',
        'stroke',
        'stroke-width',
        'stroke-dasharray',
        'stroke-dashoffset',
        'stroke-linecap',
        'stroke-linejoin',
        'stroke-miterlimit',
        'fill-opacity',
        'stroke-opacity',
        'opacity',
        'visibility',
        'display',
        'overflow',
        'clip-path',
        'mask',
        'filter',
        'transform',
        'viewBox',
        'preserveAspectRatio',
        'xmlns',
        'xmlns:xlink',
        'xlink:href',
        'href',
        'gradientUnits',
        'gradientTransform',
        'spreadMethod',
        'stop-color',
        'stop-opacity',
        'offset',
        'patternUnits',
        'patternContentUnits',
        'patternTransform',
        'markerUnits',
        'markerWidth',
        'markerHeight',
        'orient',
        'refX',
        'refY',
        'dx',
        'dy',
        'rotate',
        'textLength',
        'lengthAdjust',
        'font-family',
        'font-size',
        'font-weight',
        'font-style',
        'text-anchor',
        'text-decoration',
        'letter-spacing',
        'word-spacing',
      ],
      ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?):\/\/|mailto:|tel:|callto:|cid:|xmpp:|#)/i,
      FORBID_TAGS: ['script', 'object', 'embed', 'iframe'],
      FORBID_ATTR: [
        'onload',
        'onerror',
        'onclick',
        'onmouseover',
        'onmouseout',
        'onfocus',
        'onblur',
        'onkeydown',
        'onkeyup',
        'onkeypress',
        'onsubmit',
        'onreset',
        'onselect',
        'onchange',
        'onabort',
        'onunload',
        'onbeforeunload',
        'ontouchstart',
        'ontouchend',
        'ontouchmove',
        'ontouchcancel',
        'onpointerdown',
        'onpointerup',
        'onpointermove',
        'onpointercancel',
      ],
      KEEP_CONTENT: false,
      RETURN_DOM: false,
      RETURN_DOM_FRAGMENT: false,
      SANITIZE_DOM: true,
    });

    // Extract sanitization information from DOMPurify result
    const sanitizationInfo = purify.removed;
    
    // Check if DOMPurify removed any potentially malicious content
    if (sanitizationInfo && sanitizationInfo.length > 0) {
      // Log what was removed for security monitoring
      const removedElements = sanitizationInfo
        .map((item: any) => {
          if (item.element) {
            return `<${item.element.tagName.toLowerCase()}>`;
          } else if (item.attribute) {
            return `${item.attribute.name}="${item.attribute.value}"`;
          }
          return 'unknown';
        })
        .filter((item: string) => item !== 'unknown');

      // Block SVG if dangerous elements/attributes were removed
      const dangerousTagPatterns = ['<script>', '<object>', '<embed>', '<iframe>'];
      const hasDangerousContent = removedElements.some((item: string) => {
        const lowerItem = item.toLowerCase();
        if (lowerItem.startsWith('<')) {
          // Tag elements: check for exact dangerous tag matches
          return dangerousTagPatterns.some(tag => lowerItem.startsWith(tag));
        }
        // Attributes: check for event handlers that start with 'on'
        return lowerItem.trim().startsWith('on');
      });

      if (hasDangerousContent) {
        throw new PreviewGeneratorError(
          ErrorType.IMAGE_ERROR,
          `SVG blocked: potentially malicious content removed - ${removedElements.join(', ')}`
        );
      }

      // Log warning for other removed content (might be overly strict filtering)
      console.warn(`SVG sanitization removed elements: ${removedElements.join(', ')}`);
    }

    // Validate that the result is still a valid SVG
    if (!cleanSvg.includes('<svg') && !cleanSvg.toLowerCase().includes('svg')) {
      throw new PreviewGeneratorError(
        ErrorType.IMAGE_ERROR,
        'SVG validation failed: content does not appear to be a valid SVG after sanitization'
      );
    }
  } catch (error) {
    if (error instanceof PreviewGeneratorError) {
      throw error;
    }

    // DOMPurify failed - likely malformed or malicious SVG
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      `SVG sanitization failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Create a secure Sharp instance with safety checks
 */
export function createSecureSharpInstance(imageBuffer: Buffer): sharp.Sharp {
  // This will be called after validateImageBuffer, so we know it's safe
  return sharp(imageBuffer, {
    sequentialRead: true, // More memory efficient for large images
    density: 300, // Limit DPI to prevent excessive memory usage
    failOnError: false, // Don't fail on warnings
  });
}

/**
 * Safely resize image with dimension validation
 */
export function secureResize(
  sharpInstance: sharp.Sharp,
  width: number,
  height: number,
  options: sharp.ResizeOptions = {}
): sharp.Sharp {
  // Validate output dimensions
  if (width > MAX_WIDTH || height > MAX_HEIGHT) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `Output dimensions too large: ${width}x${height}. Maximum allowed: ${MAX_WIDTH}x${MAX_HEIGHT}`
    );
  }

  if (width < 1 || height < 1) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `Invalid output dimensions: ${width}x${height}. Must be positive integers.`
    );
  }

  return sharpInstance.resize(width, height, {
    fit: 'cover',
    position: 'center',
    withoutEnlargement: false,
    ...options,
  });
}

/**
 * Export security constants for use in other modules
 */
export const IMAGE_SECURITY_LIMITS = {
  MAX_INPUT_PIXELS,
  MAX_WIDTH,
  MAX_HEIGHT,
  MAX_FILE_SIZE,
} as const;
