/**
 * Image Generator Module
 * Handles image processing and generation using Sharp
 */

import sharp from 'sharp';
import { createSecureSharpInstance, secureResize } from '../utils/image-security';
import { withSharpInstance } from '../utils/sharp-pool';
import {
  ExtractedMetadata,
  PreviewOptions,
  TemplateConfig,
  ErrorType,
  PreviewGeneratorError,
} from '../types';
import { escapeXml, wrapText } from '../utils';
import { fetchImage } from './metadata-extractor';
import { createTransparentCanvas, validateColor } from '../utils/validators';

/**
 * Default dimensions for social media preview images
 */
export const DEFAULT_DIMENSIONS = {
  width: 1200,
  height: 630,
};

/**
 * Generate image buffer from metadata and template
 */
export async function generateImage(
  metadata: ExtractedMetadata,
  template: TemplateConfig,
  options: PreviewOptions = {}
): Promise<Buffer> {
  try {
    const width = options.width || DEFAULT_DIMENSIONS.width;
    const height = options.height || DEFAULT_DIMENSIONS.height;
    const quality = options.quality || 90;

    // Create base image or use existing image
    let baseImage: sharp.Sharp;

    if (metadata.image) {
      // Use existing image as background
      const imageBuffer = await fetchImage(metadata.image);
      baseImage = await processBackgroundImage(imageBuffer, width, height, template);
    } else {
      // Create blank canvas with gradient background or transparent canvas based on template settings
      if (template.imageProcessing?.requiresTransparentCanvas) {
        baseImage = createTransparentCanvas(width, height);
      } else {
        baseImage = await createBlankCanvas(width, height, options);
      }
    }

    // Generate text overlay SVG
    const overlayBuffer = await generateTextOverlay(metadata, template, width, height, options);

    // Composite text overlay on base image
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
    if (error instanceof PreviewGeneratorError) {
      throw error;
    }
    throw new PreviewGeneratorError(ErrorType.IMAGE_ERROR, 'Failed to generate image', error);
  }
}

/**
 * Process background image to fit dimensions with template-specific processing
 */
async function processBackgroundImage(
  imageBuffer: Buffer,
  width: number,
  height: number,
  template: TemplateConfig
): Promise<sharp.Sharp> {
  try {
    return await withSharpInstance(async (sharpInstance) => {
      // Use secure Sharp instance
      const image = createSecureSharpInstance(imageBuffer);
      await image.metadata();

      // Apply template-specific image processing settings
      const imageProcessing = template.imageProcessing || {};

      // Use secure resize function
      let processedImage = secureResize(image, width, height, {
        fit: 'cover',
        position: 'center',
      });

      // Apply template-specific blur if specified
      const blurRadius = imageProcessing.blur || template.effects?.blur?.radius || 2;
      if (blurRadius > 0) {
        processedImage = processedImage.blur(blurRadius);
      }

      // Apply template-specific brightness and saturation together for efficiency
      const brightness = imageProcessing.brightness !== undefined ? imageProcessing.brightness : 0.7;

      const saturation = imageProcessing.saturation;

      // Apply modulation only once with all necessary changes
      if (brightness !== 1 || saturation !== undefined) {
        const modulateOptions: { brightness?: number; saturation?: number } = {};

        if (brightness !== 1) {
          modulateOptions.brightness = brightness;
        }

        if (saturation !== undefined) {
          modulateOptions.saturation = saturation;
        }

        processedImage = processedImage.modulate(modulateOptions);
      }

      return processedImage;
    });
  } catch (error) {
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      'Failed to process background image',
      error
    );
  }
}

/**
 * Create blank canvas with gradient background
 */
export async function createBlankCanvas(
  width: number,
  height: number,
  options: PreviewOptions
): Promise<sharp.Sharp> {
  // Validate colors before using them in SVG
  const backgroundColor = validateColor(options.colors?.background || '#1a1a2e');
  const accentColor = validateColor(options.colors?.accent || '#16213e');

  // Create gradient SVG
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
 * Generate text overlay SVG
 */
async function generateTextOverlay(
  metadata: ExtractedMetadata,
  template: TemplateConfig,
  width: number,
  height: number,
  options: PreviewOptions
): Promise<Buffer> {
  const padding = template.layout.padding || 60;
  const textColor = validateColor(options.colors?.text || '#ffffff');

  // Calculate text dimensions
  const maxTitleWidth = width - padding * 2;
  const maxDescWidth = width - padding * 2;

  // Typography settings
  const titleFontSize = template.typography.title.fontSize || 48;
  const titleLineHeight = template.typography.title.lineHeight || 1.2;
  const descFontSize = template.typography.description?.fontSize || 24;
  const descLineHeight = template.typography.description?.lineHeight || 1.4;
  const siteNameFontSize = template.typography.siteName?.fontSize || 20;

  // Truncate and wrap text
  const titleLines = wrapText(
    metadata.title,
    maxTitleWidth,
    titleFontSize,
    template.typography.title.maxLines || 2
  );
  const descLines = metadata.description
    ? wrapText(
        metadata.description,
        maxDescWidth,
        descFontSize,
        template.typography.description?.maxLines || 2
      )
    : [];

  // Calculate positions
  const titleY = calculateTitlePosition(
    height,
    padding,
    titleLines.length,
    titleFontSize,
    titleLineHeight,
    template.layout.titlePosition
  );
  const descY = titleY + titleLines.length * titleFontSize * titleLineHeight + 20;
  const siteNameY = height - padding - 10;

  // Create overlay SVG
  const overlaySvg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          .title { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; 
            font-size: ${titleFontSize}px; 
            font-weight: 700; 
            fill: ${textColor};
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
          }
          .description { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; 
            font-size: ${descFontSize}px; 
            font-weight: 400; 
            fill: ${textColor};
            opacity: 0.9;
            filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
          }
          .siteName { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; 
            font-size: ${siteNameFontSize}px; 
            font-weight: 600; 
            fill: ${textColor};
            opacity: 0.8;
          }
        </style>
        <linearGradient id="overlayGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:rgba(0,0,0,0.6);stop-opacity:1" />
          <stop offset="100%" style="stop-color:rgba(0,0,0,0.2);stop-opacity:1" />
        </linearGradient>
      </defs>
      
      <!-- Semi-transparent overlay for better text readability -->
      ${metadata.image ? `<rect width="${width}" height="${height}" fill="url(#overlayGradient)"/>` : ''}
      
      <!-- Title -->
      ${titleLines
        .map(
          (line, index) => `
        <text x="${padding}" y="${titleY + index * titleFontSize * titleLineHeight}" class="title">
          ${escapeXml(line)}
        </text>
      `
        )
        .join('')}
      
      <!-- Description -->
      ${descLines
        .map(
          (line, index) => `
        <text x="${padding}" y="${descY + index * descFontSize * descLineHeight}" class="description">
          ${escapeXml(line)}
        </text>
      `
        )
        .join('')}
      
      <!-- Site name / Domain -->
      ${
        metadata.siteName
          ? `
        <text x="${padding}" y="${siteNameY}" class="siteName">
          ${escapeXml(metadata.siteName.toUpperCase())}
        </text>
      `
          : ''
      }
      
      <!-- Decorative elements -->
      <rect x="${padding}" y="${titleY - titleFontSize - 10}" width="60" height="4" fill="${validateColor(options.colors?.accent || '#4a9eff')}" rx="2"/>
    </svg>
  `;

  return Buffer.from(overlaySvg);
}

/**
 * Calculate title position based on layout configuration
 */
function calculateTitlePosition(
  height: number,
  padding: number,
  lineCount: number,
  fontSize: number,
  lineHeight: number,
  position?: 'top' | 'center' | 'bottom' | 'left' | 'right'
): number {
  const totalTextHeight = lineCount * fontSize * lineHeight;

  switch (position) {
    case 'top':
      return padding + fontSize;
    case 'bottom':
      return height - padding - totalTextHeight;
    case 'left':
    case 'right':
    case 'center':
    default:
      return (height - totalTextHeight) / 2 + fontSize;
  }
}

/**
 * Create fallback image when no metadata is available
 */
export async function createFallbackImage(
  url: string,
  options: PreviewOptions = {}
): Promise<Buffer> {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;

    // Create simple fallback metadata
    const fallbackMetadata: ExtractedMetadata = {
      title: options.fallback?.text || domain,
      description: `Visit ${domain} for more information`,
      url,
      domain,
      siteName: domain.replace('www.', ''),
    };

    // Use a simple template for fallback
    const fallbackTemplate: TemplateConfig = {
      name: 'fallback',
      layout: {
        padding: 60,
        titlePosition: 'center',
      },
      typography: {
        title: {
          fontSize: 42,
          fontWeight: '600',
          lineHeight: 1.3,
          maxLines: 2,
        },
        description: {
          fontSize: 22,
          lineHeight: 1.4,
          maxLines: 1,
        },
      },
    };

    return await generateImage(fallbackMetadata, fallbackTemplate, options);
  } catch (error) {
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      'Failed to create fallback image',
      error
    );
  }
}
