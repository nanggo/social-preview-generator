import sharp from 'sharp';
import { ExtractedMetadata, TemplateConfig, SanitizedOptions } from '../types';
import { createTransparentCanvas } from '../utils/validators';
import { logImageFetchError } from '../utils/logger';
import { secureResize } from '../utils/image-security';
import { fetchImage } from './metadata-extractor';
import { createBlankCanvas } from './image-generator';

// Pre-load image security module at module level for performance
const imageSecurityPromise = import('../utils/image-security');

export async function processImageForTemplate(
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
      return createTransparentCanvas(width, height);
    }
    return await createBlankCanvas(width, height, options);
  }

  // If no image available, handle based on template configuration
  if (!metadata.image) {
    // Use transparent canvas if template requires it for custom backgrounds
    if (template.imageProcessing?.requiresTransparentCanvas) {
      return createTransparentCanvas(width, height);
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
      return createTransparentCanvas(width, height);
    }
    return await createBlankCanvas(width, height, options);
  }
}

