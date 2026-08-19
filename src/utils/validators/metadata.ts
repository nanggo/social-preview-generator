import {
  ErrorType,
  PreviewGeneratorError,
  type ExtractedMetadata,
  type PreviewMetadataInput,
} from '../../types';
import { MAX_TEXT_LENGTH } from '../../constants/security';
import { exceedsTextLength } from './text';
import { getDefaultFaviconUrl, stripLeadingWww, validateUrlInput } from './url';
import { sanitizeControlChars } from './text';

export type MetadataValidationMode = 'direct' | 'custom' | 'scraped';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeOptionalText(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, `${fieldName} must be a string`);
  }
  if (exceedsTextLength(value)) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `${fieldName} exceeds maximum length of ${MAX_TEXT_LENGTH} characters`
    );
  }

  const normalized = sanitizeControlChars(value)
    .replace(/[\n\r]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || undefined;
}

function normalizeRequiredText(value: unknown, fieldName: string): string {
  const normalized = normalizeOptionalText(value, fieldName);
  if (!normalized) {
    throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, `${fieldName} is required`);
  }
  return normalized;
}

function normalizeOptionalUrl(
  value: unknown,
  fieldName: string,
  rejectInvalid: boolean
): string | undefined {
  if (value === undefined) return undefined;
  try {
    if (typeof value !== 'string') throw new Error('URL must be a string');
    return validateUrlInput(value);
  } catch (error) {
    if (!rejectInvalid) return undefined;
    if (error instanceof PreviewGeneratorError) throw error;
    throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, `${fieldName} must be a valid URL`);
  }
}

export function normalizeMetadataForRendering(
  input: PreviewMetadataInput | ExtractedMetadata,
  mode: MetadataValidationMode
): ExtractedMetadata {
  if (!isPlainObject(input)) {
    throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, 'metadata must be a plain object');
  }

  const url = validateUrlInput(input.url);
  const urlObj = new URL(url);
  const rejectInvalidOptionalUrls = mode === 'direct';
  const image = normalizeOptionalUrl(
    input.image,
    'metadata.image',
    rejectInvalidOptionalUrls
  );
  const favicon = normalizeOptionalUrl(
    input.favicon,
    'metadata.favicon',
    rejectInvalidOptionalUrls
  );

  return {
    ...input,
    title: normalizeRequiredText(input.title, 'metadata.title'),
    description: normalizeOptionalText(input.description, 'metadata.description'),
    image,
    siteName:
      normalizeOptionalText(input.siteName, 'metadata.siteName') ||
      (mode === 'direct' ? stripLeadingWww(urlObj.hostname) : undefined),
    favicon: favicon || (mode === 'direct' ? getDefaultFaviconUrl(url) : undefined),
    author: normalizeOptionalText(input.author, 'metadata.author'),
    publishedDate: normalizeOptionalText(input.publishedDate, 'metadata.publishedDate'),
    url,
    domain:
      normalizeOptionalText(input.domain, 'metadata.domain') ||
      (mode === 'direct' ? urlObj.hostname : undefined),
    locale:
      normalizeOptionalText(input.locale, 'metadata.locale') ||
      (mode === 'direct' ? 'en_US' : undefined),
  };
}
