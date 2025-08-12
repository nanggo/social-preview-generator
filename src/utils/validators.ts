/**
 * Validation utilities for social preview generator
 */

import { PreviewGeneratorError, ErrorType, PreviewOptions } from '../types';
import sharp from 'sharp';

/**
 * Validates CSS color values to prevent injection attacks
 * Accepts: hex colors, rgb/rgba, hsl/hsla, and named colors
 * Enhanced security to prevent CSS injection attacks
 */
export function validateColor(color: string): string {
  const trimmedColor = color.trim();

  // Security checks - reject dangerous patterns
  if (!isSafeColorInput(trimmedColor)) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `Invalid color value: ${color}. Contains potentially dangerous characters or patterns.`
    );
  }

  // Hex color validation (#RGB, #RRGGBB, #RRGGBBAA)
  const hexPattern = /^#([A-Fa-f0-9]{3}|[A-Fa-f0-9]{4}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/;
  if (hexPattern.test(trimmedColor)) {
    return trimmedColor;
  }

  // RGB validation with proper range checking
  const rgbMatch = trimmedColor.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch;
    const red = parseInt(r, 10);
    const green = parseInt(g, 10);
    const blue = parseInt(b, 10);

    if (red <= 255 && green <= 255 && blue <= 255) {
      return trimmedColor;
    }
  }

  // RGBA validation with proper range checking
  const rgbaMatch = trimmedColor.match(
    /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+)\s*\)$/
  );
  if (rgbaMatch) {
    const [, r, g, b, a] = rgbaMatch;
    const red = parseInt(r, 10);
    const green = parseInt(g, 10);
    const blue = parseInt(b, 10);
    const alpha = parseFloat(a);

    if (red <= 255 && green <= 255 && blue <= 255 && alpha >= 0 && alpha <= 1) {
      return trimmedColor;
    }
  }

  // HSL validation with proper range checking
  const hslMatch = trimmedColor.match(/^hsl\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*\)$/);
  if (hslMatch) {
    const [, h, s, l] = hslMatch;
    const hue = parseInt(h, 10);
    const saturation = parseInt(s, 10);
    const lightness = parseInt(l, 10);

    if (hue <= 360 && saturation <= 100 && lightness <= 100) {
      return trimmedColor;
    }
  }

  // HSLA validation with proper range checking
  const hslaMatch = trimmedColor.match(
    /^hsla\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*,\s*(0|1|0?\.\d+)\s*\)$/
  );
  if (hslaMatch) {
    const [, h, s, l, a] = hslaMatch;
    const hue = parseInt(h, 10);
    const saturation = parseInt(s, 10);
    const lightness = parseInt(l, 10);
    const alpha = parseFloat(a);

    if (hue <= 360 && saturation <= 100 && lightness <= 100 && alpha >= 0 && alpha <= 1) {
      return trimmedColor;
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
 * Check if color input is safe from CSS injection attacks
 */
function isSafeColorInput(color: string): boolean {
  // Maximum length check to prevent DoS
  if (color.length > 100) {
    return false;
  }

  // Reject dangerous characters and patterns
  const dangerousPatterns = [
    // CSS injection patterns
    /[<>]/g, // HTML tags
    /javascript:/gi, // JavaScript protocol
    /expression\(/gi, // CSS expressions (IE)
    /data:/gi, // Data URIs
    /url\(/gi, // URL functions
    /import/gi, // CSS imports
    /@/g, // CSS at-rules
    /\/\*/g, // CSS comments
    /\*\//g, // CSS comment ends
    /;/g, // CSS statement terminators
    /\}/g, // CSS block terminators
    /\{/g, // CSS block starters
    /\\/g, // Escape sequences
    // eslint-disable-next-line no-control-regex
    /\x00-\x1f/g, // Control characters
    /\x7f-\x9f/g, // Extended control characters
    /[\n\r\t\f\v]/g, // Whitespace that shouldn't be in color values
  ];

  // Check against dangerous patterns
  for (const pattern of dangerousPatterns) {
    if (pattern.test(color)) {
      return false;
    }
  }

  // Additional checks for suspicious combinations
  const suspiciousPatterns = [
    /script/gi, // Script references
    /eval/gi, // Eval functions
    /function/gi, // Function declarations
    /return/gi, // Return statements
    /alert/gi, // Alert calls
    /prompt/gi, // Prompt calls
    /confirm/gi, // Confirm calls
    /document/gi, // Document object
    /window/gi, // Window object
    /console/gi, // Console object
    /xhr/gi, // XMLHttpRequest
    /fetch/gi, // Fetch API
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(color)) {
      return false;
    }
  }

  return true;
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
    throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, 'Minimum dimensions: 100x100');
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
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }, // Transparent
    },
  });
}

/**
 * Validates all preview options including dimensions, quality, and colors
 */
export function validateOptions(options: PreviewOptions): void {
  // Validate dimensions if provided
  if (options.width !== undefined || options.height !== undefined) {
    const width = options.width || 1200;
    const height = options.height || 630;
    validateDimensions(width, height);
  }

  // Validate quality if provided (1-100 range)
  if (options.quality !== undefined) {
    if (!Number.isFinite(options.quality) || options.quality < 1 || options.quality > 100) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        `Quality must be between 1 and 100, got: ${options.quality}`
      );
    }
  }

  // Validate colors if provided
  if (options.colors) {
    const colors = options.colors;

    // Validate each color property if it exists
    if (colors.primary) validateColor(colors.primary);
    if (colors.secondary) validateColor(colors.secondary);
    if (colors.background) validateColor(colors.background);
    if (colors.text) validateColor(colors.text);
    if (colors.accent) validateColor(colors.accent);
    if (colors.overlay) validateColor(colors.overlay);
  }

  // Validate template type if provided
  if (options.template !== undefined) {
    const allowedTemplates = ['modern', 'classic', 'minimal', 'custom'];
    if (!allowedTemplates.includes(options.template)) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        `Invalid template type: ${options.template}. Allowed templates: ${allowedTemplates.join(', ')}`
      );
    }
  }

  // Validate cache option if provided
  if (options.cache !== undefined && typeof options.cache !== 'boolean') {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `Cache option must be boolean, got: ${typeof options.cache}`
    );
  }

  // Validate text inputs if provided
  if (options.fallback?.text) {
    validateTextInput(options.fallback.text, 'fallback text');
  }
}

/**
 * Comprehensive URL validation with security checks
 */
export function validateUrlInput(url: string): string {
  if (!url || typeof url !== 'string') {
    throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, 'URL must be a non-empty string');
  }

  const trimmedUrl = url.trim();

  // Length check
  if (trimmedUrl.length > 2048) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      'URL exceeds maximum length of 2048 characters'
    );
  }

  // Security patterns check
  if (!isSafeUrlInput(trimmedUrl)) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      'URL contains potentially dangerous characters or patterns'
    );
  }

  try {
    const urlObj = new URL(trimmedUrl);

    // Protocol validation
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        'Invalid protocol. Only HTTP and HTTPS are supported.'
      );
    }

    // Hostname validation
    if (!urlObj.hostname || urlObj.hostname.length === 0) {
      throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, 'URL must have a valid hostname');
    }

    return urlObj.toString();
  } catch (error) {
    if (error instanceof PreviewGeneratorError) {
      throw error;
    }
    throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, `Invalid URL format: ${url}`);
  }
}

/**
 * Check if URL input is safe from injection attacks
 */
function isSafeUrlInput(url: string): boolean {
  const dangerousPatterns = [
    // Injection patterns
    /javascript:/gi, // JavaScript protocol
    /data:/gi, // Data URIs (can be dangerous)
    /vbscript:/gi, // VBScript protocol
    /file:/gi, // File protocol
    /ftp:/gi, // FTP protocol (not supported)

    // Control characters
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f-\x9f]/g, // Control characters
    /[\n\r\t]/g, // Line breaks and tabs

    // Potential XSS patterns
    /<script/gi, // Script tags
    /%3Cscript/gi, // URL encoded script tags
    /javascript%3A/gi, // URL encoded javascript protocol
    /eval\(/gi, // Eval functions
    /expression\(/gi, // CSS expressions
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(url)) {
      return false;
    }
  }

  return true;
}

/**
 * Validate text input to prevent injection attacks
 */
export function validateTextInput(text: string, fieldName: string = 'text'): string {
  if (typeof text !== 'string') {
    throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, `${fieldName} must be a string`);
  }

  // Length check - reasonable limits for text content
  if (text.length > 10000) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `${fieldName} exceeds maximum length of 10,000 characters`
    );
  }

  // Security check for dangerous patterns
  if (!isSafeTextInput(text)) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `${fieldName} contains potentially dangerous characters or patterns`
    );
  }

  return text;
}

/**
 * Check if text input is safe from injection attacks
 */
function isSafeTextInput(text: string): boolean {
  const dangerousPatterns = [
    // Script injection patterns
    /<script/gi, // Script tags
    /<\/script>/gi, // Script closing tags
    /javascript:/gi, // JavaScript protocol
    /data:/gi, // Data URIs
    /vbscript:/gi, // VBScript protocol

    // HTML injection patterns
    /<iframe/gi, // Iframe tags
    /<object/gi, // Object tags
    /<embed/gi, // Embed tags
    /<applet/gi, // Applet tags
    /<meta/gi, // Meta tags
    /<link/gi, // Link tags
    /<style/gi, // Style tags

    // Event handlers
    /on\w+\s*=/gi, // Event handlers (onclick, onload, etc.)

    // Expression patterns
    /expression\(/gi, // CSS expressions
    /eval\(/gi, // Eval functions
    /function\s*\(/gi, // Function declarations

    // Control characters that shouldn't be in normal text
    // eslint-disable-next-line no-control-regex
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, // Control characters (except \n, \r, \t)
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(text)) {
      return false;
    }
  }

  return true;
}

/**
 * Validate image URL with additional security checks
 */
export function validateImageUrl(imageUrl: string): string {
  // First validate as regular URL
  const validatedUrl = validateUrlInput(imageUrl);

  // Additional checks specific to image URLs
  const urlObj = new URL(validatedUrl);

  // Check for suspicious query parameters
  const suspiciousParams = ['callback', 'jsonp', 'eval', 'script'];
  for (const param of suspiciousParams) {
    if (urlObj.searchParams.has(param)) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        `Image URL contains suspicious parameter: ${param}`
      );
    }
  }

  return validatedUrl;
}
