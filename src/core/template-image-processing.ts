import type { Sharp } from 'sharp';
import {
  ExtractedMetadata,
  SanitizedOptions,
  TemplateConfig,
} from '../types';
import { createTransparentCanvas } from '../utils/validators';
import { logImageFetchError } from '../utils/logger';
import { createSecureSharpInstance, secureResize, withSecureSharp } from '../utils/image-security';
import { fetchImage } from './metadata-extractor';
import { createBlankCanvas } from './image-generator';
import { isSecurityPolicyError } from '../utils/security-policy-error';
import { isSharpProcessingTimeout } from '../utils/sharp-timeout';

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
    if (isSecurityPolicyError(fetchError)) {
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
      const blurRadius = template.imageProcessing?.blur ?? template.effects?.blur?.radius ?? 0;
      const brightnessValue = template.imageProcessing?.brightness ?? 1.0;
      const saturationValue = template.imageProcessing?.saturation;
      const contrast = template.imageProcessing?.contrast ?? 1;

      // Apply blur first if needed
      if (blurRadius > 0) {
        processedImage = processedImage.blur(blurRadius);
      }

      if (contrast !== 1) {
        // Use an 8-bit colour space so middle gray is consistent for 16-bit/CMYK inputs.
        processedImage = processedImage.pipelineColourspace('srgb')
          .linear(contrast, 128 * (1 - contrast));
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

      // Sharp runs linear after composite regardless of method-call order.
      // Finish the adjusted background first so later text/logo overlays retain
      // their original colours. Each native pipeline keeps its timeout/limits.
      return contrast !== 1
        ? createSecureSharpInstance(await processedImage.png().toBuffer())
        : processedImage;
    });

    return { baseImage, effectiveMetadata, usedBackgroundImage: true };
  } catch (processingError) {
    if (isSharpProcessingTimeout(processingError)) throw processingError;
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
