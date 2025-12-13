import { PreviewGeneratorError, ErrorType, SafeUrl } from '../../types';
import {
  ALLOWED_PROTOCOLS,
  ASCII_CONTROL_CHARS,
  BLOCKED_PROTOCOLS,
  DANGEROUS_HTML_PATTERNS,
  EXTENDED_ASCII_CONTROL_CHARS,
  MAX_URL_LENGTH,
  SUSPICIOUS_URL_PARAMS,
} from '../../constants/security';
import { sanitizeControlChars } from './text';

/**
 * Comprehensive URL validation with security checks.
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
    if (!ALLOWED_PROTOCOLS.includes(protocol as (typeof ALLOWED_PROTOCOLS)[number])) {
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
      throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, 'URL hostname contains invalid characters');
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
 * Validate image URL with additional security checks.
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

/**
 * Validate and sanitize URL.
 */
export function sanitizeUrl(url: string): SafeUrl {
  const validated = validateImageUrl(url);
  return validated as SafeUrl;
}

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

