/**
 * Validation utilities for social preview generator
 */

import { 
  PreviewGeneratorError, 
  ErrorType, 
  PreviewOptions,
  SanitizedText,
  SanitizedColor,
  SafeUrl,
  ValidatedDimension,
  SanitizedOptions
} from '../types';
import { createPooledSharp } from './sharp-pool';
import {
  MAX_TEXT_LENGTH,
  MAX_COLOR_LENGTH,
  MAX_URL_LENGTH,
  ALLOWED_TEMPLATES,
  DIMENSION_LIMITS,
  QUALITY_LIMITS,
  DANGEROUS_CSS_PATTERNS,
  SUSPICIOUS_PATTERNS,
  DANGEROUS_HTML_PATTERNS,
  SUSPICIOUS_URL_PARAMS,
  ASCII_CONTROL_CHARS,
  EXTENDED_ASCII_CONTROL_CHARS,
  BIDI_CONTROL_CHARS,
  ZERO_WIDTH_CHARS,
  DANGEROUS_UNICODE_CHARS,
  ALLOWED_PROTOCOLS,
  BLOCKED_PROTOCOLS,
} from '../constants/security';

/**
 * Validates CSS color values to prevent injection attacks
 * Accepts: hex colors, rgb/rgba, hsl/hsla, and named colors
 * Enhanced security to prevent CSS injection attacks
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
  const rgbMatch = sanitizedColor.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/);
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
  const hslMatch = sanitizedColor.match(/^hsl\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*\)$/);
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

/**
 * Check if color input is safe from CSS injection attacks
 */
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

  if (width < DIMENSION_LIMITS.MIN_WIDTH || height < DIMENSION_LIMITS.MIN_HEIGHT) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `Minimum dimensions: ${DIMENSION_LIMITS.MIN_WIDTH}x${DIMENSION_LIMITS.MIN_HEIGHT}`
    );
  }

  if (width > DIMENSION_LIMITS.MAX_WIDTH || height > DIMENSION_LIMITS.MAX_HEIGHT) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `Image dimensions cannot exceed ${DIMENSION_LIMITS.MAX_WIDTH}x${DIMENSION_LIMITS.MAX_HEIGHT} pixels`
    );
  }
}

/**
 * Creates a transparent canvas for templates that provide their own background
 * Uses pooled Sharp instances for better performance
 */
export async function createTransparentCanvas(width: number, height: number) {
  // Use imported createPooledSharp function
  return createPooledSharp(undefined, {
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
  // Use the new centralized sanitization - this ensures all validation paths converge
  sanitizeOptions(options);
}

// Legacy function maintained for backward compatibility
export function validateOptionsLegacy(options: PreviewOptions): void {
  // Validate dimensions if provided
  if (options.width !== undefined || options.height !== undefined) {
    const width = options.width || 1200;
    const height = options.height || 630;
    validateDimensions(width, height);
  }

  // Validate quality if provided
  if (options.quality !== undefined) {
    if (!Number.isFinite(options.quality) || options.quality < QUALITY_LIMITS.MIN || options.quality > QUALITY_LIMITS.MAX) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        `Quality must be between ${QUALITY_LIMITS.MIN} and ${QUALITY_LIMITS.MAX}, got: ${options.quality}`
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
    if (!ALLOWED_TEMPLATES.includes(options.template as any)) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        `Invalid template type: ${options.template}. Allowed templates: ${ALLOWED_TEMPLATES.join(', ')}`
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

  const sanitizedUrl = sanitizeControlChars(url.trim());

  // Length check
  if (sanitizedUrl.length > MAX_URL_LENGTH) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `URL exceeds maximum length of ${MAX_URL_LENGTH} characters`
    );
  }

  // Security patterns check
  if (!isSafeUrlInput(sanitizedUrl)) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      'URL contains potentially dangerous characters or patterns'
    );
  }

  try {
    const urlObj = new URL(sanitizedUrl);

    // Protocol validation - URL.protocol is always lowercase, so direct comparison is safe
    const protocol = urlObj.protocol.toLowerCase();
    if (!ALLOWED_PROTOCOLS.includes(protocol as typeof ALLOWED_PROTOCOLS[number])) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        `Invalid protocol: ${protocol}. Only ${ALLOWED_PROTOCOLS.join(' and ')} are supported.`
      );
    }

    // Hostname validation - ensure hostname exists and is not empty
    if (!urlObj.hostname || urlObj.hostname.trim().length === 0) {
      throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, 'URL must have a valid hostname');
    }

    // Additional security: reject URLs with unusual characters in hostname
    const hostnamePattern = /^[a-zA-Z0-9.-]+$/;
    if (!hostnamePattern.test(urlObj.hostname)) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR, 
        'URL hostname contains invalid characters'
      );
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
  // Check for blocked protocols - must check URL start, not anywhere in the string
  // to avoid false positives like "https://example.com/page?info=some_data:value"
  const lowerUrl = url.trim().toLowerCase();
  for (const protocol of BLOCKED_PROTOCOLS) {
    if (lowerUrl.startsWith(protocol)) {
      return false;
    }
  }
  
  // Check for dangerous HTML/Script patterns
  for (const pattern of DANGEROUS_HTML_PATTERNS) {
    // Create new RegExp to avoid global flag state issues
    const testPattern = new RegExp(pattern.source, pattern.flags);
    if (testPattern.test(url)) {
      return false;
    }
  }

  // Check for control characters
  const asciiPattern = new RegExp(ASCII_CONTROL_CHARS.source, ASCII_CONTROL_CHARS.flags);
  const extendedPattern = new RegExp(EXTENDED_ASCII_CONTROL_CHARS.source, EXTENDED_ASCII_CONTROL_CHARS.flags);
  if (asciiPattern.test(url) || extendedPattern.test(url)) {
    return false;
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
  if (text.length > MAX_TEXT_LENGTH) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `${fieldName} exceeds maximum length of ${MAX_TEXT_LENGTH} characters`
    );
  }

  // Remove control characters and dangerous Unicode sequences
  const sanitizedText = sanitizeControlChars(text);

  // Security check for dangerous patterns
  if (!isSafeTextInput(sanitizedText)) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `${fieldName} contains potentially dangerous characters or patterns`
    );
  }

  return sanitizedText;
}

/**
 * Sanitize control characters and dangerous Unicode sequences
 * Centralizes all control character filtering logic
 */
export function sanitizeControlChars(text: string): string {
  let sanitized = text
    // ASCII control characters (except tab \t, newline \n, carriage return \r)
    .replace(ASCII_CONTROL_CHARS, '')
    // Extended ASCII control characters
    .replace(EXTENDED_ASCII_CONTROL_CHARS, '');
    
  // Unicode Bidirectional Text Control Characters (Bidi attacks)
  Object.values(BIDI_CONTROL_CHARS).forEach(pattern => {
    sanitized = sanitized.replace(pattern, '');
  });
  
  // Zero-width and formatting characters
  Object.values(ZERO_WIDTH_CHARS).forEach(pattern => {
    sanitized = sanitized.replace(pattern, '');
  });
  
  // Other dangerous Unicode characters
  Object.values(DANGEROUS_UNICODE_CHARS).forEach(pattern => {
    sanitized = sanitized.replace(pattern, '');
  });
  
  return sanitized.trim();
}

/**
 * Check if text input is safe from injection attacks
 */
function isSafeTextInput(text: string): boolean {
  // Check against dangerous HTML/Script patterns
  for (const pattern of DANGEROUS_HTML_PATTERNS) {
    // Create new RegExp to avoid global flag state issues
    const testPattern = new RegExp(pattern.source, pattern.flags);
    if (testPattern.test(text)) {
      return false;
    }
  }

  // Check for control characters that shouldn't be in normal text
  // Create new RegExp instance to avoid state issues
  const controlCharsPattern = new RegExp(ASCII_CONTROL_CHARS.source, ASCII_CONTROL_CHARS.flags);
  if (controlCharsPattern.test(text)) {
    return false;
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
  for (const param of SUSPICIOUS_URL_PARAMS) {
    if (urlObj.searchParams.has(param)) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        `Image URL contains suspicious parameter: ${param}`
      );
    }
  }

  return validatedUrl;
}

// =============================================================================
// BRAND TYPE VALIDATORS - Phase 1.5 Advanced Security
// =============================================================================

/**
 * Central validation gateway - all external input must pass through this
 */
export function sanitizeOptions(options: PreviewOptions): SanitizedOptions {
  // Deep validation of all nested properties
  const sanitized: PreviewOptions = {
    ...options,
  };

  // Validate colors if present - ALL color properties must be validated
  if (sanitized.colors) {
    if (sanitized.colors.background) {
      // Note: validateColor now returns SanitizedColor, but we need to store as string
      // This maintains type safety at validation boundaries while preserving runtime compatibility
      sanitized.colors.background = validateColor(sanitized.colors.background);
    }
    if (sanitized.colors.text) {
      sanitized.colors.text = validateColor(sanitized.colors.text);
    }
    if (sanitized.colors.accent) {
      sanitized.colors.accent = validateColor(sanitized.colors.accent);
    }
    // Critical security fix: validate previously missing color properties
    if (sanitized.colors.primary) {
      sanitized.colors.primary = validateColor(sanitized.colors.primary);
    }
    if (sanitized.colors.secondary) {
      sanitized.colors.secondary = validateColor(sanitized.colors.secondary);
    }
    if (sanitized.colors.overlay) {
      sanitized.colors.overlay = validateColor(sanitized.colors.overlay);
    }
  }

  // Validate dimensions
  if (sanitized.width !== undefined) {
    sanitized.width = validateDimension(sanitized.width);
  }
  if (sanitized.height !== undefined) {
    sanitized.height = validateDimension(sanitized.height);
  }

  // Validate quality
  if (sanitized.quality !== undefined) {
    if (sanitized.quality < QUALITY_LIMITS.MIN || sanitized.quality > QUALITY_LIMITS.MAX) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        `Quality must be between ${QUALITY_LIMITS.MIN} and ${QUALITY_LIMITS.MAX}`
      );
    }
  }

  // Validate template type
  if (sanitized.template !== undefined) {
    if (!ALLOWED_TEMPLATES.includes(sanitized.template as any)) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        `Invalid template type: ${sanitized.template}. Allowed templates: ${ALLOWED_TEMPLATES.join(', ')}`
      );
    }
  }

  // Validate cache option
  if (sanitized.cache !== undefined && typeof sanitized.cache !== 'boolean') {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `Cache option must be boolean, got: ${typeof sanitized.cache}`
    );
  }

  // Validate text inputs from fallback
  if (sanitized.fallback?.text) {
    sanitized.fallback = {
      ...sanitized.fallback,
      text: validateTextInput(sanitized.fallback.text, 'fallback text'),
    };
  }

  return sanitized as SanitizedOptions;
}

/**
 * Validate and sanitize text content
 */
export function sanitizeText(text: string): SanitizedText {
  const validated = validateTextInput(text, 'text');
  // Control character sanitization is now centralized in validateTextInput
  return validated as SanitizedText;
}

/**
 * Validate and sanitize URL
 */
export function sanitizeUrl(url: string): SafeUrl {
  const validated = validateImageUrl(url);
  return validated as SafeUrl;
}

/**
 * Validate dimension values
 */
export function validateDimension(value: number): ValidatedDimension {
  if (typeof value !== 'number' || isNaN(value) || value <= 0) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      'Dimension must be a positive number'
    );
  }

  // Reasonable limits for image dimensions
  if (value > DIMENSION_LIMITS.MAX_WIDTH) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `Dimension exceeds maximum allowed size of ${DIMENSION_LIMITS.MAX_WIDTH} pixels`
    );
  }

  return value as ValidatedDimension;
}
