/**
 * Common utility functions shared across the project
 */

// Re-export logger utilities
export * from './logger';

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
 * @param color - Hex color string (e.g., '#ff0000')
 * @param percent - Brightness adjustment percentage (-100 to 100)
 * @returns Adjusted hex color string
 */
export function adjustBrightness(color: string, percent: number): string {
  // Handle non-hex colors by returning as-is
  if (!color.startsWith('#')) {
    return color;
  }

  const num = parseInt(color.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max(0, Math.min(255, (num >> 16) + amt));
  const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00ff) + amt));
  const B = Math.max(0, Math.min(255, (num & 0x0000ff) + amt));

  return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
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
