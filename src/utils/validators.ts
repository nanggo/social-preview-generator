/**
 * Validation utilities for social preview generator
 */

import { PreviewGeneratorError, ErrorType } from '../types';

/**
 * Validates CSS color values to prevent injection attacks
 * Accepts: hex colors, rgb/rgba, hsl/hsla, and named colors
 */
export function validateColor(color: string): string {
  const trimmedColor = color.trim();

  // Hex color validation (#RGB, #RRGGBB, #RRGGBBAA)
  const hexPattern = /^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{4}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/;
  if (hexPattern.test(trimmedColor)) {
    return trimmedColor;
  }

  // RGB/RGBA validation with proper range checking
  const rgbMatch = trimmedColor.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+))?\s*\)$/);
  if (rgbMatch) {
    const [, r, g, b, a] = rgbMatch;
    const red = parseInt(r, 10);
    const green = parseInt(g, 10);
    const blue = parseInt(b, 10);
    
    if (red <= 255 && green <= 255 && blue <= 255) {
      if (a !== undefined) {
        const alpha = parseFloat(a);
        if (alpha >= 0 && alpha <= 1) {
          return trimmedColor;
        }
      } else {
        return trimmedColor;
      }
    }
  }

  // HSL/HSLA validation with proper range checking
  const hslMatch = trimmedColor.match(/^hsla?\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*(?:,\s*(0|1|0?\.\d+))?\s*\)$/);
  if (hslMatch) {
    const [, h, s, l, a] = hslMatch;
    const hue = parseInt(h, 10);
    const saturation = parseInt(s, 10);
    const lightness = parseInt(l, 10);
    
    if (hue <= 360 && saturation <= 100 && lightness <= 100) {
      if (a !== undefined) {
        const alpha = parseFloat(a);
        if (alpha >= 0 && alpha <= 1) {
          return trimmedColor;
        }
      } else {
        return trimmedColor;
      }
    }
  }

  // Named colors (CSS standard colors) - using Set for O(1) lookup
  const namedColors = new Set([
    'black', 'silver', 'gray', 'white', 'maroon', 'red', 'purple', 'fuchsia',
    'green', 'lime', 'olive', 'yellow', 'navy', 'blue', 'teal', 'aqua',
    'orange', 'aliceblue', 'antiquewhite', 'aquamarine', 'azure', 'beige',
    'bisque', 'blanchedalmond', 'blueviolet', 'brown', 'burlywood', 'cadetblue',
    'chartreuse', 'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson',
    'cyan', 'darkblue', 'darkcyan', 'darkgoldenrod', 'darkgray', 'darkgreen',
    'darkgrey', 'darkkhaki', 'darkmagenta', 'darkolivegreen', 'darkorange',
    'darkorchid', 'darkred', 'darksalmon', 'darkseagreen', 'darkslateblue',
    'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink',
    'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite',
    'forestgreen', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod', 'greenyellow',
    'grey', 'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki',
    'lavender', 'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue',
    'lightcoral', 'lightcyan', 'lightgoldenrodyellow', 'lightgray', 'lightgreen',
    'lightgrey', 'lightpink', 'lightsalmon', 'lightseagreen', 'lightskyblue',
    'lightslategray', 'lightslategrey', 'lightsteelblue', 'lightyellow',
    'limegreen', 'linen', 'magenta', 'mediumaquamarine', 'mediumblue',
    'mediumorchid', 'mediumpurple', 'mediumseagreen', 'mediumslateblue',
    'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue',
    'mintcream', 'mistyrose', 'moccasin', 'navajowhite', 'oldlace', 'olivedrab',
    'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise',
    'palevioletred', 'papayawhip', 'peachpuff', 'peru', 'pink', 'plum',
    'powderblue', 'rosybrown', 'royalblue', 'saddlebrown', 'salmon', 'sandybrown',
    'seagreen', 'seashell', 'sienna', 'skyblue', 'slateblue', 'slategray',
    'slategrey', 'snow', 'springgreen', 'steelblue', 'tan', 'thistle', 'tomato',
    'turquoise', 'violet', 'wheat', 'whitesmoke', 'yellowgreen', 'transparent'
  ]);

  if (namedColors.has(trimmedColor.toLowerCase())) {
    return trimmedColor.toLowerCase();
  }

  // If validation fails, throw an error
  throw new PreviewGeneratorError(
    ErrorType.VALIDATION_ERROR,
    `Invalid color value: ${color}. Please use a valid CSS color format.`
  );
}

/**
 * Validates image dimensions
 */
export function validateDimensions(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      'Dimensions must be finite numbers'
    );
  }

  if (width < 100 || height < 100) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      'Minimum dimensions: 100x100'
    );
  }

  if (width > 4096 || height > 4096) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      'Image dimensions cannot exceed 4096x4096 pixels'
    );
  }
}

/**
 * Creates a transparent canvas for templates that provide their own background
 */
export function createTransparentCanvas(width: number, height: number) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sharp = require('sharp');
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }, // Transparent
    },
  });
}
