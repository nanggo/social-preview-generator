import type { Sharp } from 'sharp';
import {
  ErrorType,
  ExtractedMetadata,
  PreviewGeneratorError,
  SanitizedOptions,
  TemplateConfig,
} from '../types';
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

export interface PreparedTemplateImage {
  effectiveMetadata: ExtractedMetadata;
  imageBuffer?: Buffer;
}

/** Fetch and validate optional background bytes before native render admission. */
export async function prepareImageForTemplate(
  metadata: ExtractedMetadata,
  template: TemplateConfig,
  options: SanitizedOptions
): Promise<PreparedTemplateImage> {
  const effectiveMetadata = { ...metadata };

  if (template.layout.imagePosition === 'none' || !metadata.image) {
    return { effectiveMetadata };
  }

  try {
    const imageBuffer = await fetchImage(metadata.image, options.security);
    return { effectiveMetadata, imageBuffer };
  } catch (fetchError) {
    if (
      fetchError instanceof PreviewGeneratorError &&
      fetchError.type === ErrorType.VALIDATION_ERROR
    ) {
      throw fetchError;
    }

    logImageFetchError(
      metadata.image,
      fetchError instanceof Error ? fetchError : new Error(String(fetchError))
    );
    return { effectiveMetadata: { ...metadata, image: undefined } };
  }
}

export async function processImageForTemplate(
  preparedImage: PreparedTemplateImage,
  template: TemplateConfig,
  width: number,
  height: number,
  options: SanitizedOptions
): Promise<ProcessedTemplateImage> {
  const effectiveMetadata = { ...preparedImage.effectiveMetadata };

  if (!preparedImage.imageBuffer) {
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

  try {
    const baseImage = await withSecureSharp(preparedImage.imageBuffer, async (secureImage) => {
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
  } catch (processingError) {
    logImageFetchError(
      effectiveMetadata.image ?? 'background image',
      processingError instanceof Error ? processingError : new Error(String(processingError))
    );

    const metadataWithoutFailedImage = { ...effectiveMetadata, image: undefined };

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
