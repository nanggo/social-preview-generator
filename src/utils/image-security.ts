/**
 * Image security utilities and Sharp configuration
 * Prevents pixel bomb attacks and validates image dimensions
 */

import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { PreviewGeneratorError, ErrorType } from '../types';

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
    if (typeof (sharp as any).limitInputPixels === 'function') {
      (sharp as any).limitInputPixels(MAX_INPUT_PIXELS);
    }

    // Set memory limits
    sharp.cache({
      memory: 100, // 100MB memory cache
      files: 20,   // 20 files cache
      items: 200,  // 200 operations cache
    });

    // Set concurrency limit to prevent resource exhaustion
    sharp.concurrency(4);
  } catch (error) {
    // Silently fail if Sharp configuration is not supported
    console.warn('Could not configure Sharp security settings:', error);
  }
}

/**
 * Validate image buffer before processing
 */
export async function validateImageBuffer(imageBuffer: Buffer, allowSvg: boolean = false): Promise<void> {
  // Check file size
  if (imageBuffer.length > MAX_FILE_SIZE) {
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      `Image file too large: ${imageBuffer.length} bytes. Maximum allowed: ${MAX_FILE_SIZE} bytes.`
    );
  }

  // First, detect actual file type using magic bytes
  const detectedType = await fileTypeFromBuffer(imageBuffer);
  
  // Define allowed MIME types
  const allowedMimeTypes = [
    'image/jpeg',
    'image/png', 
    'image/webp',
    'image/gif',
    'image/bmp',
    'image/tiff'
  ];

  // Conditionally allow SVG (disabled by default for security)
  if (allowSvg) {
    allowedMimeTypes.push('image/svg+xml');
  }

  // Validate detected file type
  if (!detectedType) {
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      'Could not determine file type from content. File may be corrupted or not a valid image.'
    );
  }

  if (!allowedMimeTypes.includes(detectedType.mime)) {
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      `Unsupported image type detected: ${detectedType.mime}. Allowed types: ${allowedMimeTypes.join(', ')}`
    );
  }

  // Special handling for SVG files (if allowed)
  if (detectedType.mime === 'image/svg+xml') {
    await validateSvgContent(imageBuffer);
    return; // Skip Sharp validation for SVG
  }

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

    // Cross-validate detected type with Sharp format
    const sharpFormatMap: Record<string, string> = {
      'image/jpeg': 'jpeg',
      'image/png': 'png',
      'image/webp': 'webp', 
      'image/gif': 'gif',
      'image/bmp': 'bmp',
      'image/tiff': 'tiff'
    };

    const expectedFormat = sharpFormatMap[detectedType.mime];
    if (metadata.format && metadata.format !== expectedFormat) {
      throw new PreviewGeneratorError(
        ErrorType.IMAGE_ERROR,
        `File type mismatch: detected ${detectedType.mime} but Sharp identified ${metadata.format}`
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
 * Validate SVG content for security risks
 */
async function validateSvgContent(svgBuffer: Buffer): Promise<void> {
  const svgContent = svgBuffer.toString('utf8');
  
  // Check for potentially dangerous SVG content
  const dangerousPatterns = [
    /<script/gi,           // Script tags
    /javascript:/gi,       // JavaScript protocol
    /data:/gi,            // Data URIs (can contain JS)
    /@import/gi,          // CSS imports
    /url\(/gi,            // External URL references
    /<foreignObject/gi,   // Foreign objects (can contain HTML)
    /<iframe/gi,          // Iframe tags
    /<object/gi,          // Object tags
    /<embed/gi,           // Embed tags
    /onload/gi,           // Event handlers
    /onclick/gi,
    /onmouseover/gi,
    /onerror/gi,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(svgContent)) {
      throw new PreviewGeneratorError(
        ErrorType.IMAGE_ERROR,
        'SVG content contains potentially dangerous elements and has been blocked for security'
      );
    }
  }

  // Check SVG size limits
  if (svgContent.length > 1024 * 1024) { // 1MB limit for SVG
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      `SVG content too large: ${svgContent.length} characters. Maximum allowed: 1MB`
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