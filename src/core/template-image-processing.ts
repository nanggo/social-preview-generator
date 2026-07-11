import type { Sharp } from 'sharp';
import { ExtractedMetadata, TemplateConfig, SanitizedOptions } from '../types';
import { createTransparentCanvas } from '../utils/validators';
import { logImageFetchError } from '../utils/logger';
import { secureResize, withSecureSharp } from '../utils/image-security';
import { fetchImage } from './metadata-extractor';
import { createBlankCanvas } from './image-generator';

export interface ProcessedTemplateImage {
  baseImage: Sharp;
  effectiveMetadata: ExtractedMetadata;
  usedBackgroundImage: boolean;
}

export async function processImageForTemplate(
  metadata: ExtractedMetadata,
  template: TemplateConfig,
  width: number,
  height: number,
  options: SanitizedOptions
): Promise<ProcessedTemplateImage> {
  const effectiveMetadata = { ...metadata };

  // Check if template wants no background image
  if (template.layout.imagePosition === 'none') {
    // Use transparent canvas if template requires it, otherwise use blank canvas
    if (template.imageProcessing?.requiresTransparentCanvas) {
      return {
        baseImage: createTransparentCanvas(width, height),
        effectiveMetadata,
        usedBackgroundImage: false,
      };
    }
    return {
      baseImage: await createBlankCanvas(width, height, options),
      effectiveMetadata,
      usedBackgroundImage: false,
    };
  }

  // If no image available, handle based on template configuration
  if (!metadata.image) {
    // Use transparent canvas if template requires it for custom backgrounds
    if (template.imageProcessing?.requiresTransparentCanvas) {
      return {
        baseImage: createTransparentCanvas(width, height),
        effectiveMetadata,
        usedBackgroundImage: false,
      };
    }
    return {
      baseImage: await createBlankCanvas(width, height, options),
      effectiveMetadata,
      usedBackgroundImage: false,
    };
  }

  // Process background image with template-specific effects
  try {
    const imageBuffer = await fetchImage(metadata.image, options.security);

    const baseImage = await withSecureSharp(imageBuffer, async (secureImage) => {
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

    return { baseImage, effectiveMetadata, usedBackgroundImage: true };
  } catch (fetchError) {
    // If image fetch fails, create appropriate canvas based on template configuration
    logImageFetchError(
      metadata.image,
      fetchError instanceof Error ? fetchError : new Error(String(fetchError))
    );

    const metadataWithoutFailedImage = { ...metadata, image: undefined };

    // Use transparent canvas if template requires it for custom backgrounds
    if (template.imageProcessing?.requiresTransparentCanvas) {
      return {
        baseImage: createTransparentCanvas(width, height),
        effectiveMetadata: metadataWithoutFailedImage,
        usedBackgroundImage: false,
      };
    }
    return {
      baseImage: await createBlankCanvas(width, height, options),
      effectiveMetadata: metadataWithoutFailedImage,
      usedBackgroundImage: false,
    };
  }
}
