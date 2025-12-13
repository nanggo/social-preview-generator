import { PreviewGeneratorError, ErrorType, SanitizedColor } from '../../types';
import { DANGEROUS_CSS_PATTERNS, MAX_COLOR_LENGTH, SUSPICIOUS_PATTERNS } from '../../constants/security';
import { sanitizeControlChars } from './text';

/**
 * Validates CSS color values to prevent injection attacks.
 * Accepts: hex colors, rgb/rgba, hsl/hsla, and named colors.
 */
export function validateColor(color: string): SanitizedColor {
  // Sanitize control characters first
  const sanitizedColor = sanitizeControlChars(color.trim());

  // Security checks - reject dangerous patterns
  if (!isSafeColorInput(sanitizedColor)) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `Invalid color value: ${color}. Contains potentially dangerous characters or patterns.`
    );
  }

  // Hex color validation (#RGB, #RRGGBB, #RRGGBBAA)
  const hexPattern = /^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{4}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/;
  if (hexPattern.test(sanitizedColor)) {
    return sanitizedColor as SanitizedColor;
  }

  // RGB validation with proper range checking
  const rgbMatch = sanitizedColor.match(
    /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/
  );
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch;
    const red = parseInt(r, 10);
    const green = parseInt(g, 10);
    const blue = parseInt(b, 10);

    if (red <= 255 && green <= 255 && blue <= 255) {
      return sanitizedColor as SanitizedColor;
    }
  }

  // RGBA validation with proper range checking
  const rgbaMatch = sanitizedColor.match(
    /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+)\s*\)$/
  );
  if (rgbaMatch) {
    const [, r, g, b, a] = rgbaMatch;
    const red = parseInt(r, 10);
    const green = parseInt(g, 10);
    const blue = parseInt(b, 10);
    const alpha = parseFloat(a);

    if (red <= 255 && green <= 255 && blue <= 255 && alpha >= 0 && alpha <= 1) {
      return sanitizedColor as SanitizedColor;
    }
  }

  // HSL validation with proper range checking
  const hslMatch = sanitizedColor.match(
    /^hsl\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*\)$/
  );
  if (hslMatch) {
    const [, h, s, l] = hslMatch;
    const hue = parseInt(h, 10);
    const saturation = parseInt(s, 10);
    const lightness = parseInt(l, 10);

    if (hue <= 360 && saturation <= 100 && lightness <= 100) {
      return sanitizedColor as SanitizedColor;
    }
  }

  // HSLA validation with proper range checking
  const hslaMatch = sanitizedColor.match(
    /^hsla\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*,\s*(0|1|0?\.\d+)\s*\)$/
  );
  if (hslaMatch) {
    const [, h, s, l, a] = hslaMatch;
    const hue = parseInt(h, 10);
    const saturation = parseInt(s, 10);
    const lightness = parseInt(l, 10);
    const alpha = parseFloat(a);

    if (hue <= 360 && saturation <= 100 && lightness <= 100 && alpha >= 0 && alpha <= 1) {
      return sanitizedColor as SanitizedColor;
    }
  }

  // Named colors (CSS standard colors) - using Set for O(1) lookup
  const namedColors = new Set([
    'black',
    'silver',
    'gray',
    'white',
    'maroon',
    'red',
    'purple',
    'fuchsia',
    'green',
    'lime',
    'olive',
    'yellow',
    'navy',
    'blue',
    'teal',
    'aqua',
    'orange',
    'aliceblue',
    'antiquewhite',
    'aquamarine',
    'azure',
    'beige',
    'bisque',
    'blanchedalmond',
    'blueviolet',
    'brown',
    'burlywood',
    'cadetblue',
    'chartreuse',
    'chocolate',
    'coral',
    'cornflowerblue',
    'cornsilk',
    'crimson',
    'cyan',
    'darkblue',
    'darkcyan',
    'darkgoldenrod',
    'darkgray',
    'darkgreen',
    'darkgrey',
    'darkkhaki',
    'darkmagenta',
    'darkolivegreen',
    'darkorange',
    'darkorchid',
    'darkred',
    'darksalmon',
    'darkseagreen',
    'darkslateblue',
    'darkslategray',
    'darkslategrey',
    'darkturquoise',
    'darkviolet',
    'deeppink',
    'deepskyblue',
    'dimgray',
    'dimgrey',
    'dodgerblue',
    'firebrick',
    'floralwhite',
    'forestgreen',
    'gainsboro',
    'ghostwhite',
    'gold',
    'goldenrod',
    'greenyellow',
    'grey',
    'honeydew',
    'hotpink',
    'indianred',
    'indigo',
    'ivory',
    'khaki',
    'lavender',
    'lavenderblush',
    'lawngreen',
    'lemonchiffon',
    'lightblue',
    'lightcoral',
    'lightcyan',
    'lightgoldenrodyellow',
    'lightgray',
    'lightgreen',
    'lightgrey',
    'lightpink',
    'lightsalmon',
    'lightseagreen',
    'lightskyblue',
    'lightslategray',
    'lightslategrey',
    'lightsteelblue',
    'lightyellow',
    'limegreen',
    'linen',
    'magenta',
    'mediumaquamarine',
    'mediumblue',
    'mediumorchid',
    'mediumpurple',
    'mediumseagreen',
    'mediumslateblue',
    'mediumspringgreen',
    'mediumturquoise',
    'mediumvioletred',
    'midnightblue',
    'mintcream',
    'mistyrose',
    'moccasin',
    'navajowhite',
    'oldlace',
    'olivedrab',
    'orangered',
    'orchid',
    'palegoldenrod',
    'palegreen',
    'paleturquoise',
    'palevioletred',
    'papayawhip',
    'peachpuff',
    'peru',
    'pink',
    'plum',
    'powderblue',
    'rosybrown',
    'royalblue',
    'saddlebrown',
    'salmon',
    'sandybrown',
    'seagreen',
    'seashell',
    'sienna',
    'skyblue',
    'slateblue',
    'slategray',
    'slategrey',
    'snow',
    'springgreen',
    'steelblue',
    'tan',
    'thistle',
    'tomato',
    'turquoise',
    'violet',
    'wheat',
    'whitesmoke',
    'yellowgreen',
    'transparent',
  ]);

  if (namedColors.has(sanitizedColor.toLowerCase())) {
    return sanitizedColor.toLowerCase() as SanitizedColor;
  }

  // If validation fails, throw an error
  throw new PreviewGeneratorError(
    ErrorType.VALIDATION_ERROR,
    `Invalid color value: ${color}. Please use a valid CSS color format.`
  );
}

function isSafeColorInput(color: string): boolean {
  // Maximum length check to prevent DoS
  if (color.length > MAX_COLOR_LENGTH) {
    return false;
  }

  // Check against dangerous CSS patterns
  for (const pattern of DANGEROUS_CSS_PATTERNS) {
    // Create new RegExp to avoid global flag state issues
    const testPattern = new RegExp(pattern.source, pattern.flags);
    if (testPattern.test(color)) {
      return false;
    }
  }

  // Additional checks for suspicious combinations
  for (const pattern of SUSPICIOUS_PATTERNS) {
    // Create new RegExp to avoid global flag state issues
    const testPattern = new RegExp(pattern.source, pattern.flags);
    if (testPattern.test(color)) {
      return false;
    }
  }

  return true;
}

