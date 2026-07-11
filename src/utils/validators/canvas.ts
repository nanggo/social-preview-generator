import sharp from 'sharp';
import { SHARP_SECURITY_CONFIG } from '../../constants/security';
import { applySharpProcessingTimeout } from '../sharp-timeout';

/**
 * Creates a transparent canvas for templates that provide their own background.
 */
export function createTransparentCanvas(width: number, height: number) {
  return applySharpProcessingTimeout(
    sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }, // Transparent
      },
      ...SHARP_SECURITY_CONFIG,
    })
  );
}
