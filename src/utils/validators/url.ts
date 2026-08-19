import { PreviewGeneratorError, ErrorType, SafeUrl } from '../../types';
import net from 'node:net';
import {
  ALLOWED_PROTOCOLS,
  ASCII_CONTROL_CHARS,
  BLOCKED_PROTOCOLS,
  DANGEROUS_HTML_PATTERNS,
  EXTENDED_ASCII_CONTROL_CHARS,
  MAX_URL_LENGTH,
  SUSPICIOUS_URL_PARAMS,
} from '../../constants/security';

interface UrlValidationOptions {
  httpsOnly?: boolean;
}

// URL parsers may discard some controls before validation. Check the caller's
// original text first so an unsafe representation is never silently accepted.
// eslint-disable-next-line no-control-regex
const ALL_C0_C1_CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/u;

export function validateRawUrlInput(url: unknown): string {
  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, 'URL must be a non-empty string');
  }

  if (ALL_C0_C1_CONTROL_CHARS.test(url)) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      'URL contains forbidden control characters'
    );
  }

  const trimmedUrl = url.trim();
  if (trimmedUrl.length > MAX_URL_LENGTH) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `URL exceeds maximum length of ${MAX_URL_LENGTH} characters`
    );
  }

  return trimmedUrl;
}

/** Resolve caller or page-provided URL text against a page URL and allow HTTP(S) only. */
export function resolveHttpUrl(value: unknown, baseUrl: string): string | undefined {
  try {
    const candidate = validateRawUrlInput(value);
    const resolved = new URL(candidate, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return undefined;
    }
    return validateUrlInput(resolved.toString());
  } catch {
    return undefined;
  }
}

/** Build the conventional root favicon URL without dropping a non-default port. */
export function getDefaultFaviconUrl(pageUrl: string): string {
  const faviconUrl = new URL('/favicon.ico', pageUrl);
  faviconUrl.username = '';
  faviconUrl.password = '';
  return faviconUrl.toString();
}

/** Remove only the conventional leading www. host label. */
export function stripLeadingWww(hostname: string): string {
  return hostname.replace(/^www\./i, '');
}

/**
 * Comprehensive URL validation with security checks.
 */
export function validateUrlInput(url: string, options: UrlValidationOptions = {}): string {
  const sanitizedUrl = validateRawUrlInput(url);

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

    if (options.httpsOnly && protocol !== 'https:') {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        'HTTP URLs are not allowed when HTTPS-only mode is enabled'
      );
    }

    if (urlObj.username.length > 0 || urlObj.password.length > 0) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        'URL userinfo credentials are not allowed'
      );
    }

    // Hostname validation - ensure hostname exists and is not empty
    if (!urlObj.hostname || urlObj.hostname.trim().length === 0) {
      throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, 'URL must have a valid hostname');
    }

    // Additional security: reject URLs with unusual characters in hostname
    const hostname = urlObj.hostname.startsWith('[') && urlObj.hostname.endsWith(']')
      ? urlObj.hostname.slice(1, -1)
      : urlObj.hostname;
    const hostnamePattern = /^[a-zA-Z0-9.-]+$/;
    if (net.isIP(hostname) === 0 && !hostnamePattern.test(hostname)) {
      throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, 'URL hostname contains invalid characters');
    }

    urlObj.hash = '';
    const canonicalUrl = urlObj.toString();
    if (canonicalUrl.length > MAX_URL_LENGTH) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        `Canonical URL exceeds maximum length of ${MAX_URL_LENGTH} characters`
      );
    }

    return canonicalUrl;
  } catch (error) {
    if (error instanceof PreviewGeneratorError) {
      throw error;
    }
    throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, 'Invalid URL format');
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
