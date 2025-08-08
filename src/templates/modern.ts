/**
 * Modern Template
 * A contemporary design with gradient overlays and clean typography
 */

import { TemplateConfig, PreviewOptions, ExtractedMetadata } from '../types';

/**
 * Modern template configuration
 */
export const modernTemplate: TemplateConfig = {
  name: 'modern',
  layout: {
    padding: 80,
    titlePosition: 'center',
    descriptionPosition: 'below-title',
    imagePosition: 'background',
    logoPosition: 'bottom-left',
  },
  typography: {
    title: {
      fontSize: 56,
      fontWeight: '700',
      lineHeight: 1.2,
      maxLines: 2,
    },
    description: {
      fontSize: 28,
      fontWeight: '400',
      lineHeight: 1.4,
      maxLines: 2,
    },
    siteName: {
      fontSize: 22,
      fontWeight: '600',
    },
  },
  effects: {
    gradient: {
      type: 'linear',
      colors: ['rgba(0,0,0,0.7)', 'rgba(0,0,0,0.3)'],
      direction: '180deg',
      opacity: 1,
    },
    blur: {
      radius: 3,
      areas: 'background',
    },
    shadow: {
      text: true,
      box: false,
    },
    borderRadius: 0,
  },
};

/**
 * Generate modern template SVG overlay
 */
export function generateModernOverlay(
  metadata: ExtractedMetadata,
  width: number,
  height: number,
  options: PreviewOptions = {}
): string {
  const padding = modernTemplate.layout.padding;
  const textColor = options.colors?.text || '#ffffff';
  const accentColor = options.colors?.accent || '#4a9eff';
  
  // Typography settings
  const titleFontSize = modernTemplate.typography.title.fontSize;
  const titleLineHeight = modernTemplate.typography.title.lineHeight || 1.2;
  const descFontSize = modernTemplate.typography.description?.fontSize || 28;
  const descLineHeight = modernTemplate.typography.description?.lineHeight || 1.4;
  const siteNameFontSize = modernTemplate.typography.siteName?.fontSize || 22;
  
  // Calculate text wrapping
  const maxTitleWidth = width - (padding * 2);
  const titleLines = wrapText(metadata.title, maxTitleWidth, titleFontSize, modernTemplate.typography.title.maxLines || 2);
  const descLines = metadata.description 
    ? wrapText(metadata.description, maxTitleWidth, descFontSize, modernTemplate.typography.description?.maxLines || 2)
    : [];
  
  // Calculate vertical centering
  const totalContentHeight = 
    (titleLines.length * titleFontSize * titleLineHeight) +
    (descLines.length > 0 ? 30 : 0) + // Gap between title and description
    (descLines.length * descFontSize * descLineHeight);
  
  const contentStartY = (height - totalContentHeight) / 2;
  const titleY = contentStartY + titleFontSize;
  const descY = titleY + (titleLines.length * titleFontSize * titleLineHeight) + 30;
  
  return `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style type="text/css">
          <![CDATA[
          .title { 
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
            font-size: ${titleFontSize}px; 
            font-weight: 800; 
            fill: ${textColor};
            filter: drop-shadow(0 4px 6px rgba(0,0,0,0.4));
            letter-spacing: -0.02em;
          }
          .description { 
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
            font-size: ${descFontSize}px; 
            font-weight: 400; 
            fill: ${textColor};
            opacity: 0.95;
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
            letter-spacing: -0.01em;
          }
          .siteName { 
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
            font-size: ${siteNameFontSize}px; 
            font-weight: 600; 
            fill: ${textColor};
            opacity: 0.8;
            letter-spacing: 0.05em;
            text-transform: uppercase;
          }
          .domain {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
            font-size: 18px; 
            font-weight: 500; 
            fill: ${textColor};
            opacity: 0.6;
          }
          ]]>
        </style>
        
        <!-- Gradient overlays -->
        <linearGradient id="bgOverlay" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:rgba(0,0,0,0.7);stop-opacity:1" />
          <stop offset="50%" style="stop-color:rgba(0,0,0,0.5);stop-opacity:1" />
          <stop offset="100%" style="stop-color:rgba(0,0,0,0.3);stop-opacity:1" />
        </linearGradient>
        
        <linearGradient id="accentGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:${accentColor};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${adjustBrightness(accentColor, 20)};stop-opacity:1" />
        </linearGradient>
        
        <!-- Blur filter for background -->
        <filter id="blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
        </filter>
      </defs>
      
      <!-- Background overlay -->
      ${metadata.image ? `
        <rect width="${width}" height="${height}" fill="url(#bgOverlay)"/>
      ` : ''}
      
      <!-- Top accent bar -->
      <rect x="0" y="0" width="${width}" height="4" fill="url(#accentGradient)"/>
      
      <!-- Content container with subtle background -->
      <rect 
        x="${padding - 20}" 
        y="${contentStartY - 20}" 
        width="${width - (padding * 2) + 40}" 
        height="${totalContentHeight + 40}" 
        fill="rgba(0,0,0,0.2)" 
        rx="8"
        filter="url(#blur)"
      />
      
      <!-- Title -->
      ${titleLines.map((line, index) => `
        <text 
          x="${width / 2}" 
          y="${titleY + (index * titleFontSize * titleLineHeight)}" 
          class="title"
          text-anchor="middle"
        >
          ${escapeXml(line)}
        </text>
      `).join('')}
      
      <!-- Description -->
      ${descLines.length > 0 ? descLines.map((line, index) => `
        <text 
          x="${width / 2}" 
          y="${descY + (index * descFontSize * descLineHeight)}" 
          class="description"
          text-anchor="middle"
        >
          ${escapeXml(line)}
        </text>
      `).join('') : ''}
      
      <!-- Bottom section -->
      <g transform="translate(${padding}, ${height - padding})">
        <!-- Site name -->
        ${metadata.siteName ? `
          <text x="0" y="-30" class="siteName">
            ${escapeXml(metadata.siteName.toUpperCase())}
          </text>
        ` : ''}
        
        <!-- Domain -->
        ${metadata.domain ? `
          <text x="0" y="-8" class="domain">
            ${escapeXml(metadata.domain)}
          </text>
        ` : ''}
        
        <!-- Decorative accent line -->
        <rect x="0" y="-50" width="60" height="3" fill="${accentColor}" rx="1.5"/>
      </g>
      
      <!-- Right corner accent -->
      <g transform="translate(${width - padding}, ${padding})">
        <circle cx="0" cy="0" r="3" fill="${accentColor}" opacity="0.8"/>
        <circle cx="12" cy="0" r="3" fill="${accentColor}" opacity="0.6"/>
        <circle cx="24" cy="0" r="3" fill="${accentColor}" opacity="0.4"/>
      </g>
    </svg>
  `;
}

/**
 * Wrap text to fit within maximum width
 */
function wrapText(text: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
  // Approximate character width (adjusted for Inter font)
  const avgCharWidth = fontSize * 0.55;
  const maxCharsPerLine = Math.floor(maxWidth / avgCharWidth);
  
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
  
  return lines;
}

/**
 * Escape XML special characters
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Adjust color brightness
 */
function adjustBrightness(color: string, percent: number): string {
  // Simple brightness adjustment for hex colors
  if (color.startsWith('#')) {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    
    return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
      (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
      (B < 255 ? B < 1 ? 0 : B : 255))
      .toString(16)
      .slice(1);
  }
  return color;
}