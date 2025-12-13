import { PreviewGeneratorError, ErrorType, SanitizedText } from '../../types';
import {
  ASCII_CONTROL_CHARS,
  BIDI_CONTROL_CHARS,
  DANGEROUS_HTML_PATTERNS,
  DANGEROUS_UNICODE_CHARS,
  EXTENDED_ASCII_CONTROL_CHARS,
  MAX_TEXT_LENGTH,
  ZERO_WIDTH_CHARS,
} from '../../constants/security';

/**
 * Validate text input to prevent injection attacks.
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
 * Sanitize control characters and dangerous Unicode sequences.
 * Centralizes all control character filtering logic.
 */
export function sanitizeControlChars(text: string): string {
  let sanitized = text
    // ASCII control characters (except tab \t, newline \n, carriage return \r)
    .replace(ASCII_CONTROL_CHARS, '')
    // Extended ASCII control characters
    .replace(EXTENDED_ASCII_CONTROL_CHARS, '');

  // Unicode Bidirectional Text Control Characters (Bidi attacks)
  Object.values(BIDI_CONTROL_CHARS).forEach((pattern) => {
    sanitized = sanitized.replace(pattern, '');
  });

  // Zero-width and formatting characters
  Object.values(ZERO_WIDTH_CHARS).forEach((pattern) => {
    sanitized = sanitized.replace(pattern, '');
  });

  // Other dangerous Unicode characters
  Object.values(DANGEROUS_UNICODE_CHARS).forEach((pattern) => {
    sanitized = sanitized.replace(pattern, '');
  });

  return sanitized.trim();
}

/**
 * Validate and sanitize text content.
 */
export function sanitizeText(text: string): SanitizedText {
  const validated = validateTextInput(text, 'text');
  // Control character sanitization is now centralized in validateTextInput
  return validated as SanitizedText;
}

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

