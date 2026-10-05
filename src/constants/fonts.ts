/**
 * Centralized font stacks for SVG templates.
 * Keep these consistent across templates and overlay generators.
 */

import type { FontConfig } from '../types';
import { validateFontFamily } from '../utils/validators/fonts';

export const SYSTEM_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

export const SERIF_FONT_STACK = "Georgia, 'Times New Roman', serif";

/**
 * Prepend configured font families, quoted, to a built-in fallback stack.
 * Families are re-validated because overlay generators are callable directly.
 */
export function buildFontStack(
  fonts: readonly FontConfig[] | undefined,
  fallbackStack: string
): string {
  if (!fonts || fonts.length === 0) {
    return fallbackStack;
  }

  const families = fonts.map((font) => `'${validateFontFamily(font.family)}'`);
  return `${families.join(', ')}, ${fallbackStack}`;
}
