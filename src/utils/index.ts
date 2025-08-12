/**
 * Common utility functions shared across the project
 */

// Re-export logger utilities
export * from './logger';

// Re-export validation utilities
export * from './validation';

/**
 * Escape XML special characters for safe SVG text rendering
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Adjust color brightness by a percentage
 * @param color - Color string (hex, rgb, rgba, hsl, hsla, or named color)
 * @param percent - Brightness adjustment percentage (-100 to 100)
 * @returns Adjusted color string (always returns hex format for consistency)
 */
export function adjustBrightness(color: string, percent: number): string {
  // Convert various color formats to RGB values
  const rgb = parseColor(color);
  if (!rgb) {
    // If parsing fails, return original color
    return color;
  }

  // Apply brightness adjustment
  const amt = Math.round(2.55 * percent);
  const r = Math.max(0, Math.min(255, rgb.r + amt));
  const g = Math.max(0, Math.min(255, rgb.g + amt));
  const b = Math.max(0, Math.min(255, rgb.b + amt));

  // Return as hex format
  return rgbToHex(r, g, b);
}

/**
 * Parse various color formats to RGB values
 * @param color - Color string in various formats
 * @returns RGB object or null if parsing fails
 */
function parseColor(color: string): { r: number; g: number; b: number } | null {
  const trimmedColor = color.trim().toLowerCase();

  // Hex colors (#RGB, #RRGGBB, #RRGGBBAA)
  if (trimmedColor.startsWith('#')) {
    const hex = trimmedColor.slice(1);
    if (hex.length === 3) {
      // #RGB -> #RRGGBB
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return { r, g, b };
    } else if (hex.length === 6) {
      // #RRGGBB
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return { r, g, b };
    } else if (hex.length === 8) {
      // #RRGGBBAA (ignore alpha)
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return { r, g, b };
    }
  }

  // RGB/RGBA colors
  const rgbMatch = trimmedColor.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+)?\s*\)/
  );
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10),
    };
  }

  // HSL/HSLA colors - basic conversion
  const hslMatch = trimmedColor.match(
    /hsla?\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*(?:,\s*[\d.]+)?\s*\)/
  );
  if (hslMatch) {
    const h = parseInt(hslMatch[1], 10) / 360;
    const s = parseInt(hslMatch[2], 10) / 100;
    const l = parseInt(hslMatch[3], 10) / 100;
    return hslToRgb(h, s, l);
  }

  // Named colors - basic support for common ones
  const namedColors: Record<string, { r: number; g: number; b: number }> = {
    black: { r: 0, g: 0, b: 0 },
    white: { r: 255, g: 255, b: 255 },
    red: { r: 255, g: 0, b: 0 },
    green: { r: 0, g: 128, b: 0 },
    blue: { r: 0, g: 0, b: 255 },
    yellow: { r: 255, g: 255, b: 0 },
    cyan: { r: 0, g: 255, b: 255 },
    magenta: { r: 255, g: 0, b: 255 },
    gray: { r: 128, g: 128, b: 128 },
    grey: { r: 128, g: 128, b: 128 },
    orange: { r: 255, g: 165, b: 0 },
    purple: { r: 128, g: 0, b: 128 },
  };

  if (namedColors[trimmedColor]) {
    return namedColors[trimmedColor];
  }

  return null;
}

/**
 * Convert RGB values to hex string
 */
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/**
 * Convert HSL to RGB
 */
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  let r, g, b;

  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

/**
 * Wrap text to fit within specified constraints
 * @param text - Text to wrap
 * @param maxWidth - Maximum width in pixels
 * @param fontSize - Font size in pixels
 * @param maxLines - Maximum number of lines
 * @param fontFamily - Font family for width calculation (affects character width)
 * @returns Array of text lines
 */
export function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
  maxLines: number,
  fontFamily: 'inter' | 'default' = 'default'
): string[] {
  // Font-specific character width multipliers
  const fontMultipliers = {
    inter: 0.55, // Inter font is more condensed
    default: 0.6, // Default system font
  };

  const avgCharWidth = fontSize * fontMultipliers[fontFamily];
  const maxCharsPerLine = Math.floor(maxWidth / avgCharWidth);

  // Handle empty text
  if (!text.trim()) {
    return [];
  }

  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const testLine = currentLine ? `${currentLine} ${word}` : word;

    if (testLine.length <= maxCharsPerLine) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        // Word is too long, truncate it
        lines.push(word.substring(0, maxCharsPerLine - 3) + '...');
        currentLine = '';
      }
    }

    // Check if we've reached max lines
    if (lines.length >= maxLines - 1 && currentLine) {
      const remainingWords = words.slice(i + 1);
      if (remainingWords.length > 0) {
        // Add ellipsis if there's more text
        const truncatedLine = currentLine.substring(0, maxCharsPerLine - 3) + '...';
        lines.push(truncatedLine);
      } else {
        lines.push(currentLine);
      }
      break;
    }
  }

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
  }

  // Ensure we have at least one line for very short text that needs wrapping
  if (lines.length === 0 && currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Generate SVG gradient definition
 * @param id - Gradient ID for SVG reference
 * @param colors - Array of color stops
 * @param direction - Gradient direction (angle in degrees or keywords)
 * @returns SVG gradient definition string
 */
export function generateSvgGradient(
  id: string,
  colors: Array<{ offset: string; color: string; opacity?: number }>,
  direction: string | number = '0deg'
): string {
  // Convert direction to SVG coordinates
  let x1 = '0%',
    y1 = '0%',
    x2 = '100%',
    y2 = '0%';

  if (typeof direction === 'number' || direction.endsWith('deg')) {
    const angle = typeof direction === 'number' ? direction : parseInt(direction);
    const rad = (angle * Math.PI) / 180;
    x1 = '50%';
    y1 = '50%';
    x2 = `${50 + 50 * Math.cos(rad)}%`;
    y2 = `${50 + 50 * Math.sin(rad)}%`;
  } else if (direction === 'vertical' || direction === '180deg') {
    x1 = '0%';
    y1 = '0%';
    x2 = '0%';
    y2 = '100%';
  }

  const stops = colors
    .map(
      ({ offset, color, opacity = 1 }) =>
        `<stop offset="${offset}" style="stop-color:${color};stop-opacity:${opacity}" />`
    )
    .join('\n    ');

  return `
    <linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">
      ${stops}
    </linearGradient>
  `;
}

/**
 * Create SVG text element with proper positioning and styling
 * @param content - Text content
 * @param x - X coordinate
 * @param y - Y coordinate
 * @param className - CSS class name
 * @param attributes - Additional SVG attributes
 * @returns SVG text element string
 */
export function createSvgText(
  content: string,
  x: number | string,
  y: number | string,
  className?: string,
  attributes: Record<string, string | number> = {}
): string {
  const escapedContent = escapeXml(content);
  const classAttr = className ? `class="${className}"` : '';
  const additionalAttrs = Object.entries(attributes)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ');

  return `<text x="${x}" y="${y}" ${classAttr} ${additionalAttrs}>${escapedContent}</text>`;
}

/**
 * Truncate text to specified length with ellipsis
 * @param text - Text to truncate
 * @param maxLength - Maximum length
 * @param ellipsis - Ellipsis string (default: '...')
 * @returns Truncated text
 */
export function truncateText(text: string, maxLength: number, ellipsis = '...'): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - ellipsis.length) + ellipsis;
}
