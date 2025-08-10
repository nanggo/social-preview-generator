/**
 * Minimal Template
 * A clean, modern minimalist design focusing on simplicity and readability
 */

import { TemplateConfig, PreviewOptions, ExtractedMetadata, PreviewGeneratorError, ErrorType } from '../types';
import { escapeXml, wrapText } from '../utils';

/**
 * Minimal template configuration
 */
export const minimalTemplate: TemplateConfig = {
  name: 'minimal',
  layout: {
    padding: 100,
    titlePosition: 'center',
    descriptionPosition: 'below-title',
    imagePosition: 'none',
    logoPosition: 'bottom-center',
  },
  typography: {
    title: {
      fontSize: 64,
      fontWeight: '300',
      lineHeight: 1.1,
      maxLines: 2,
    },
    description: {
      fontSize: 26,
      fontWeight: '300',
      lineHeight: 1.6,
      maxLines: 2,
    },
    siteName: {
      fontSize: 16,
      fontWeight: '500',
    },
  },
  effects: {
    gradient: {
      type: 'none',
      colors: [],
      direction: '0deg',
      opacity: 0,
    },
    blur: {
      radius: 0,
      areas: 'none',
    },
    shadow: {
      text: false,
      box: false,
    },
    borderRadius: 0,
  },
};

/**
 * Generate minimal template SVG overlay
 */
export function generateMinimalOverlay(
  metadata: ExtractedMetadata,
  width: number,
  height: number,
  options: PreviewOptions = {}
): string {
  // Validate dimensions
  if (width < 100 || height < 100) {
    throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, 'Minimum dimensions: 100x100');
  }
  if (width > 10000 || height > 10000) {
    throw new PreviewGeneratorError(ErrorType.VALIDATION_ERROR, 'Maximum dimensions: 10000x10000');
  }
  const padding = minimalTemplate.layout.padding;
  const textColor = options.colors?.text || '#000000';
  const accentColor = options.colors?.accent || '#000000';
  const backgroundColor = options.colors?.background || '#ffffff';

  // Typography settings with minimal approach
  const titleFontSize = minimalTemplate.typography.title.fontSize;
  const titleLineHeight = minimalTemplate.typography.title.lineHeight || 1.1;
  const descFontSize = minimalTemplate.typography.description?.fontSize || 26;
  const descLineHeight = minimalTemplate.typography.description?.lineHeight || 1.6;
  const siteNameFontSize = minimalTemplate.typography.siteName?.fontSize || 16;

  // Text wrapping with generous spacing
  const maxTextWidth = width - padding * 2;
  const titleLines = wrapText(
    metadata.title,
    maxTextWidth,
    titleFontSize,
    minimalTemplate.typography.title.maxLines || 2,
    'inter'
  );
  const descLines = metadata.description
    ? wrapText(
        metadata.description,
        maxTextWidth,
        descFontSize,
        minimalTemplate.typography.description?.maxLines || 2,
        'inter'
      )
    : [];

  // Vertical centering with minimal spacing
  const titleHeight = titleLines.length * titleFontSize * titleLineHeight;
  const descHeight = descLines.length > 0 ? descLines.length * descFontSize * descLineHeight : 0;
  const gap = descLines.length > 0 ? 60 : 0; // Generous gap between title and description
  const totalContentHeight = titleHeight + gap + descHeight;

  const contentStartY = (height - totalContentHeight) / 2;
  const titleStartY = contentStartY + titleFontSize;
  const descStartY = titleStartY + titleHeight + gap;

  return `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style type="text/css">
          <![CDATA[
          .minimal-title { 
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
            font-size: ${titleFontSize}px; 
            font-weight: 300; 
            fill: ${textColor};
            letter-spacing: -0.03em;
            line-height: ${titleLineHeight};
          }
          .minimal-description { 
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
            font-size: ${descFontSize}px; 
            font-weight: 300; 
            fill: ${textColor};
            opacity: 0.7;
            letter-spacing: -0.01em;
            line-height: ${descLineHeight};
          }
          .minimal-sitename { 
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
            font-size: ${siteNameFontSize}px; 
            font-weight: 500; 
            fill: ${accentColor};
            text-transform: uppercase;
            letter-spacing: 0.2em;
            opacity: 0.6;
          }
          .minimal-domain {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
            font-size: 14px; 
            font-weight: 400; 
            fill: ${textColor};
            opacity: 0.4;
            letter-spacing: 0.05em;
          }
          ]]>
        </style>
      </defs>
      
      <!-- Clean background -->
      <rect width="${width}" height="${height}" fill="${backgroundColor}"/>
      
      <!-- Title - centered with generous spacing -->
      ${titleLines
        .map(
          (line, index) => `
        <text 
          x="${width / 2}" 
          y="${titleStartY + index * titleFontSize * titleLineHeight}" 
          class="minimal-title"
          text-anchor="middle"
        >
          ${escapeXml(line)}
        </text>
      `
        )
        .join('')}
      
      <!-- Description - if present -->
      ${
        descLines.length > 0
          ? descLines
              .map(
                (line, index) => `
        <text 
          x="${width / 2}" 
          y="${descStartY + index * descFontSize * descLineHeight}" 
          class="minimal-description"
          text-anchor="middle"
        >
          ${escapeXml(line)}
        </text>
      `
              )
              .join('')
          : ''
      }
      
      <!-- Bottom section - minimal branding -->
      <g transform="translate(${width / 2}, ${height - 80})">
        ${
          metadata.siteName
            ? `
          <text x="0" y="0" class="minimal-sitename" text-anchor="middle">
            ${escapeXml(metadata.siteName.toUpperCase())}
          </text>
        `
            : ''
        }
        
        ${
          metadata.domain
            ? `
          <text x="0" y="25" class="minimal-domain" text-anchor="middle">
            ${escapeXml(metadata.domain)}
          </text>
        `
            : ''
        }
        
        <!-- Minimal geometric accent -->
        <g transform="translate(0, ${metadata.siteName || metadata.domain ? 15 : -10})">
          <circle cx="-20" cy="0" r="1.5" fill="${accentColor}" opacity="0.3"/>
          <circle cx="0" cy="0" r="1.5" fill="${accentColor}" opacity="0.6"/>
          <circle cx="20" cy="0" r="1.5" fill="${accentColor}" opacity="0.3"/>
        </g>
      </g>
      
      <!-- Subtle corner elements for balance -->
      <g opacity="0.1">
        <!-- Top left -->
        <rect x="40" y="40" width="2" height="20" fill="${accentColor}"/>
        <rect x="40" y="40" width="20" height="2" fill="${accentColor}"/>
        
        <!-- Bottom right -->
        <rect x="${width - 62}" y="${height - 60}" width="2" height="20" fill="${accentColor}"/>
        <rect x="${width - 60}" y="${height - 42}" width="20" height="2" fill="${accentColor}"/>
      </g>
      
      <!-- Optional divider line above bottom section -->
      ${
        metadata.siteName || metadata.domain
          ? `
        <line 
          x1="${width / 2 - 30}" 
          y1="${height - 120}" 
          x2="${width / 2 + 30}" 
          y2="${height - 120}" 
          stroke="${accentColor}" 
          stroke-width="1" 
          opacity="0.2"
        />
      `
          : ''
      }
    </svg>
  `;
}
