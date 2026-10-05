import { PreviewGeneratorError, ErrorType, FontConfig } from '../../types';

const FONT_FAMILY_PATTERN = /^[\p{L}\p{M}\p{N} ._-]+$/u;
const MAX_FONT_FAMILY_LENGTH = 128;
const MAX_FONT_CONFIGS = 16;
const REMOVED_FONT_FIELDS = ['path', 'weight', 'style'] as const;

/** Family names with this prefix are reserved for setupFonts() verification renders. */
export const FONT_PROBE_FAMILY_PREFIX = '__spg_probe_';

/**
 * Validates a literal font family name. The allowed alphabet keeps the name
 * safe to quote inside generated CSS, XML attributes, and fontconfig XML.
 */
export function validateFontFamily(family: unknown): string {
  if (typeof family !== 'string') {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `Font family must be a string, got: ${typeof family}`
    );
  }

  const trimmed = family.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_FONT_FAMILY_LENGTH ||
    !FONT_FAMILY_PATTERN.test(trimmed)
  ) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `Font family must be 1-${MAX_FONT_FAMILY_LENGTH} characters of letters, digits, spaces, ".", "_" or "-"`
    );
  }

  if (trimmed.toLowerCase().startsWith(FONT_PROBE_FAMILY_PREFIX)) {
    throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, 'Font family name is reserved');
  }

  return trimmed;
}

/**
 * Validates the fonts rendering option. Only family names are accepted:
 * rendering options never load font files.
 */
export function sanitizeFontConfigs(fonts: unknown): FontConfig[] {
  if (!Array.isArray(fonts)) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `Fonts option must be an array, got: ${typeof fonts}`
    );
  }

  if (fonts.length > MAX_FONT_CONFIGS) {
    throw new PreviewGeneratorError(
      ErrorType.VALIDATION_ERROR,
      `Fonts option accepts at most ${MAX_FONT_CONFIGS} entries`
    );
  }

  return fonts.map((font: unknown, index) => {
    if (!font || typeof font !== 'object' || Array.isArray(font)) {
      throw new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        `Font configuration at index ${index} must be an object`
      );
    }

    for (const field of REMOVED_FONT_FIELDS) {
      if (Object.hasOwn(font, field)) {
        throw new PreviewGeneratorError(
          ErrorType.VALIDATION_ERROR,
          `Removed font option is not supported: fonts[${index}].${field}. Register font files with setupFonts()`
        );
      }
    }

    return { family: validateFontFamily((font as { family?: unknown }).family) };
  });
}
