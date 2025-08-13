/**
 * Image security utilities and Sharp configuration
 * Prevents pixel bomb attacks and validates image dimensions
 */

import sharp from 'sharp';
import { PreviewGeneratorError, ErrorType } from '../types';
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';
import * as os from 'os';
import { getCachedMetadata } from './sharp-cache';
import { createPooledSharp, withPooledSharp } from './sharp-pool';

// Cache file-type module to avoid repeated dynamic imports
// Use typeof import to ensure type safety with actual module structure
let fileTypeModule: typeof import('file-type') | null = null;
let fileTypeImportPromise: Promise<typeof import('file-type')> | null = null;
import {
  MAX_INPUT_PIXELS,
  MAX_IMAGE_WIDTH,
  MAX_IMAGE_HEIGHT,
  MAX_FILE_SIZE,
  MAX_SVG_SIZE,
  MAX_DPI,
  PROCESSING_TIMEOUT,
  ALLOWED_IMAGE_FORMATS,
  ALLOWED_SVG_TAGS,
  FORBIDDEN_SVG_TAGS,
  ALLOWED_SVG_ATTRIBUTES,
  FORBIDDEN_SVG_ATTRIBUTES,
  ALLOWED_SVG_URI_PATTERN,
  ALLOWED_SVG_NAMESPACES,
  SHARP_CACHE_CONFIG,
  SHARP_SECURITY_CONFIG,
} from '../constants/security';

// Import centralized constants from security module
// All security limits are now defined in src/constants/security.ts

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

    // Set concurrency limit to prevent resource exhaustion
    // Lower concurrency for security (prevents DoS through resource exhaustion)
    sharp.concurrency(Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2))));
    
    // Set global Sharp settings for security
    sharp.simd(true); // Enable SIMD acceleration for performance
    
    // Cache configuration: Balance security and performance
    // - Use limited memory cache for performance (controlled memory usage)
    // - Disable file cache for security (prevent cache-based attacks)
    sharp.cache({ 
      memory: SHARP_CACHE_CONFIG.memory,  // 150MB memory cache for performance
      files: 0,   // Disable file cache for security
      items: SHARP_CACHE_CONFIG.items     // 300 operations cache
    });
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
    // Get metadata with strict error handling for security - use cached version for performance
    // Use imported getCachedMetadata function
    const metadata = await getCachedMetadata(imageBuffer);

    // Check if dimensions are valid
    if (!metadata.width || !metadata.height) {
      throw new PreviewGeneratorError(
        ErrorType.IMAGE_ERROR,
        'Could not determine image dimensions'
      );
    }

    // Check maximum dimensions
    if (metadata.width > MAX_IMAGE_WIDTH || metadata.height > MAX_IMAGE_HEIGHT) {
      throw new PreviewGeneratorError(
        ErrorType.IMAGE_ERROR,
        `Image dimensions too large: ${metadata.width}x${metadata.height}. Maximum allowed: ${MAX_IMAGE_WIDTH}x${MAX_IMAGE_HEIGHT}`
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

    // Sharp format validation - ensure it's a recognized image format (whitelist approach)
    if (metadata.format && !ALLOWED_IMAGE_FORMATS.has(metadata.format as any)) {
      throw new PreviewGeneratorError(
        ErrorType.IMAGE_ERROR,
        `Unsupported image format detected by Sharp: ${metadata.format}. Allowed formats: ${Array.from(ALLOWED_IMAGE_FORMATS).join(', ')}`
      );
    }
    
    // Additional security checks on metadata
    if (metadata.density && metadata.density > MAX_DPI) {
      // Extremely high DPI can cause memory exhaustion
      throw new PreviewGeneratorError(
        ErrorType.IMAGE_ERROR,
        `Image DPI too high: ${metadata.density}. Maximum allowed: ${MAX_DPI} DPI`
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
    // Use cached module or import if not cached
    if (!fileTypeModule) {
      if (!fileTypeImportPromise) {
        fileTypeImportPromise = import('file-type');
      }
      fileTypeModule = await fileTypeImportPromise;
    }
    
    const { fileTypeFromBuffer } = fileTypeModule;
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
export async function validateSvgContent(svgBuffer: Buffer): Promise<void> {
  const svgContent = svgBuffer.toString('utf8');

  // Check SVG size limits first
  if (svgContent.length > MAX_SVG_SIZE) {
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      `SVG content too large: ${svgContent.length} characters. Maximum allowed: ${MAX_SVG_SIZE / (1024 * 1024)}MB`
    );
  }

  try {
    // Create JSDOM window for DOMPurify
    const window = new JSDOM('').window;
    const purify = DOMPurify(window);

    // Configure DOMPurify for strict SVG sanitization with detailed reporting
    const cleanSvg = purify.sanitize(svgContent, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ALLOWED_TAGS: [...ALLOWED_SVG_TAGS],
      ALLOWED_ATTR: [...ALLOWED_SVG_ATTRIBUTES],
      // Only allow fragment identifiers (internal document links), no external URIs
      ALLOWED_URI_REGEXP: ALLOWED_SVG_URI_PATTERN,
      
      // Explicitly forbid dangerous tags (in addition to not allowing them)
      FORBID_TAGS: [...FORBIDDEN_SVG_TAGS],
      
      // Explicitly forbid dangerous attributes
      FORBID_ATTR: [...FORBIDDEN_SVG_ATTRIBUTES],
      // Security-hardened configuration
      KEEP_CONTENT: false,           // Don't keep content of removed elements
      RETURN_DOM: false,            // Return string, not DOM
      RETURN_DOM_FRAGMENT: false,   // Return string, not DOM fragment
      SANITIZE_DOM: true,           // Sanitize DOM properties
      WHOLE_DOCUMENT: false,        // Only sanitize fragment
      FORCE_BODY: false,            // Don't wrap in body
      SAFE_FOR_TEMPLATES: false,    // More restrictive parsing
      ALLOW_DATA_ATTR: false,       // Block data-* attributes (can store scripts)
      ALLOW_UNKNOWN_PROTOCOLS: false, // Block unknown protocols
      ALLOWED_NAMESPACES: [...ALLOWED_SVG_NAMESPACES], // Only SVG namespace
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
      // Only block for truly dangerous content, not just structural HTML elements
      const criticalDangerousTags = ['<script', '<object', '<embed', '<iframe', '<link', '<meta'];
      const hasDangerousContent = removedElements.some((item: string) => {
        const lowerItem = item.toLowerCase();
        if (lowerItem.startsWith('<')) {
          // Tag elements: only check for critical security threats
          return criticalDangerousTags.some(tag => lowerItem.startsWith(tag));
        }
        // Attributes: check for event handlers or dangerous external references
        const trimmedItem = lowerItem.trim();
        return trimmedItem.startsWith('on') || 
               trimmedItem.startsWith('href=') || 
               trimmedItem.startsWith('xlink:href=') ||
               trimmedItem.startsWith('style=');
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
 * Sanitize SVG content and return cleaned result for testing
 */
export function sanitizeSvgContent(svgContent: string): string {
  try {
    // Create JSDOM window for DOMPurify
    const window = new JSDOM('').window;
    const purify = DOMPurify(window);

    // Use the same configuration as validateSvgContent - simplified for debugging
    const cleanSvg = purify.sanitize(svgContent, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ALLOWED_TAGS: [...ALLOWED_SVG_TAGS],
      ALLOWED_ATTR: [...ALLOWED_SVG_ATTRIBUTES],
      ALLOWED_URI_REGEXP: ALLOWED_SVG_URI_PATTERN,
      FORBID_TAGS: [...FORBIDDEN_SVG_TAGS],
      FORBID_ATTR: [...FORBIDDEN_SVG_ATTRIBUTES],
      KEEP_CONTENT: false,
      RETURN_DOM: false,
      SANITIZE_DOM: true,
      ALLOW_DATA_ATTR: false,
      ALLOW_UNKNOWN_PROTOCOLS: false,
    });

    return cleanSvg;
  } catch (error) {
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      `SVG sanitization failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Create a secure Sharp instance with safety checks and timeout protection
 * Uses pooled instances for better performance
 * Note: Caller is responsible for releasing the instance back to the pool
 */
export async function createSecureSharpInstance(imageBuffer: Buffer): Promise<sharp.Sharp> {
  // Use imported createPooledSharp function
  // This will be called after validateImageBuffer, so we know it's safe
  return createPooledSharp(imageBuffer, SHARP_SECURITY_CONFIG);
}

/**
 * Execute a Sharp operation with automatic pool management
 * Use this for one-shot operations that need automatic cleanup
 */
export async function withSecureSharp<T>(
  imageBuffer: Buffer,
  operation: (sharp: sharp.Sharp) => Promise<T>
): Promise<T> {
  // Use imported withPooledSharp function
  return withPooledSharp(operation, imageBuffer, SHARP_SECURITY_CONFIG);
}

/**
 * Process image with timeout protection to prevent DoS attacks
 */
export async function processImageWithTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number = PROCESSING_TIMEOUT
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new PreviewGeneratorError(
        ErrorType.IMAGE_ERROR,
        `Image processing timed out after ${timeoutMs}ms. This may indicate a malicious image designed to cause resource exhaustion.`
      ));
    }, timeoutMs);

    operation()
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timer);
        reject(error);
      });
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
  if (width > MAX_IMAGE_WIDTH || height > MAX_IMAGE_HEIGHT) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `Output dimensions too large: ${width}x${height}. Maximum allowed: ${MAX_IMAGE_WIDTH}x${MAX_IMAGE_HEIGHT}`
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
 * Create a Sharp instance with metadata removal for privacy and security
 * Uses pooled instances for better performance
 * Note: Caller is responsible for releasing the instance back to the pool
 */
export async function createSecureSharpWithCleanMetadata(imageBuffer: Buffer): Promise<sharp.Sharp> {
  // Use imported createPooledSharp function
  return (await createPooledSharp(imageBuffer, SHARP_SECURITY_CONFIG))
    // Remove EXIF and other metadata by default - use empty metadata
    .withMetadata({});
}

/**
 * Execute a Sharp operation with automatic pool management and clean metadata
 * Use this for one-shot operations that need automatic cleanup
 */
export async function withSecureSharpCleanMetadata<T>(
  imageBuffer: Buffer,
  operation: (sharp: sharp.Sharp) => Promise<T>
): Promise<T> {
  // Use imported withPooledSharp function
  return withPooledSharp(
    async (sharpInstance) => operation(sharpInstance.withMetadata({})),
    imageBuffer, 
    SHARP_SECURITY_CONFIG
  );
}

/**
 * Validate Sharp processing limits before operations
 */
export function validateSharpLimits(width: number, height: number): void {
  const totalPixels = width * height;
  
  if (totalPixels > MAX_INPUT_PIXELS) {
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      `Operation would exceed pixel limit: ${totalPixels} > ${MAX_INPUT_PIXELS}`
    );
  }
  
  if (width > MAX_IMAGE_WIDTH || height > MAX_IMAGE_HEIGHT) {
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      `Dimensions exceed limits: ${width}x${height}. Max: ${MAX_IMAGE_WIDTH}x${MAX_IMAGE_HEIGHT}`
    );
  }
}

/**
 * Export security constants for use in other modules
 */
export const IMAGE_SECURITY_LIMITS = {
  MAX_INPUT_PIXELS,
  MAX_IMAGE_WIDTH,
  MAX_IMAGE_HEIGHT,
  MAX_FILE_SIZE,
  MAX_SVG_SIZE,
  MAX_DPI,
  PROCESSING_TIMEOUT,
  ALLOWED_IMAGE_FORMATS: Array.from(ALLOWED_IMAGE_FORMATS),
} as const;
