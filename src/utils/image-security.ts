/**
 * Image security utilities and Sharp configuration
 * Prevents pixel bomb attacks and validates image dimensions
 */

import sharp from 'sharp';
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

  // Simple magic bytes check for basic file type validation
  const header = imageBuffer.slice(0, 16);
  
  // Check for basic image file signatures
  const isJPEG = header[0] === 0xFF && header[1] === 0xD8;
  const isPNG = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47;
  const isWebP = header.indexOf(Buffer.from('WEBP')) !== -1;
  const isGIF = header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46;
  const isBMP = header[0] === 0x42 && header[1] === 0x4D;
  const isTIFF = (header[0] === 0x49 && header[1] === 0x49 && header[2] === 0x2A && header[3] === 0x00) ||
                 (header[0] === 0x4D && header[1] === 0x4D && header[2] === 0x00 && header[3] === 0x2A);
  const isSVG = allowSvg && imageBuffer.toString('utf8', 0, 100).toLowerCase().includes('<svg');

  if (!isJPEG && !isPNG && !isWebP && !isGIF && !isBMP && !isTIFF && !isSVG) {
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      'Unsupported image format. Only JPEG, PNG, WebP, GIF, BMP, and TIFF are supported.'
    );
  }

  // Special handling for SVG files (if allowed)
  if (isSVG) {
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
 * Validate SVG content for security risks
 */
async function validateSvgContent(svgBuffer: Buffer): Promise<void> {
  const svgContent = svgBuffer.toString('utf8');
  
  // Check for potentially dangerous SVG content with more precise patterns
  const dangerousPatterns = [
    /<script/gi,                    // Script tags
    /javascript:/gi,                // JavaScript protocol
    /data:text\/html/gi,           // HTML data URIs (specific threat)
    /data:application\/javascript/gi, // JavaScript data URIs
    /data:text\/javascript/gi,     // JavaScript text data URIs
    /@import\s+["']?https?:/gi,    // External CSS imports (not local)
    /url\(["']?https?:/gi,         // External URL references (not local refs like #id)
    /url\(["']?data:text\/html/gi, // Data URL with HTML
    /url\(["']?javascript:/gi,     // JavaScript URLs
    /<foreignObject/gi,            // Foreign objects (can contain HTML)
    /<iframe/gi,                   // Iframe tags
    /<object/gi,                   // Object tags
    /<embed/gi,                    // Embed tags
    /onload\s*=/gi,               // Event handlers with assignment
    /onclick\s*=/gi,
    /onmouseover\s*=/gi,
    /onerror\s*=/gi,
    /onmouseout\s*=/gi,
    /onfocus\s*=/gi,
    /onblur\s*=/gi,
    /onkeydown\s*=/gi,
    /onkeyup\s*=/gi,
    /onsubmit\s*=/gi,
  ];

  // Check for dangerous patterns with specific context validation
  for (const pattern of dangerousPatterns) {
    const matches = svgContent.match(pattern);
    if (matches) {
      // Additional validation to reduce false positives
      for (const match of matches) {
        const lowerMatch = match.toLowerCase();
        
        // Allow safe local references like url(#gradient) or url("#pattern")
        if (lowerMatch.includes('url(') && 
            (lowerMatch.includes('#') || lowerMatch.includes('"#') || lowerMatch.includes("'#"))) {
          continue; // Skip safe local references
        }
        
        // Allow safe data URIs for images (not HTML/JS)
        if (lowerMatch.includes('data:') && 
            (lowerMatch.includes('data:image/') || 
             lowerMatch.includes('data:font/') ||
             lowerMatch.includes('data:application/font'))) {
          continue; // Skip safe image/font data URIs
        }
        
        // If we reach here, it's a potentially dangerous pattern
        throw new PreviewGeneratorError(
          ErrorType.IMAGE_ERROR,
          `SVG content contains potentially dangerous element: ${match.slice(0, 50)}...`
        );
      }
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