/**
 * Minimal Template
 * A clean, modern minimalist design focusing on simplicity and readability
 */

import { TemplateConfig, PreviewOptions, ExtractedMetadata } from '../types';
import { escapeXml, wrapText } from '../utils';
import { validateColor } from '../utils/validators';
import { SYSTEM_FONT_STACK } from '../constants/fonts';
import { createSvgStyleCdata, layoutCenteredTitleDescription } from './shared';

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
  imageProcessing: {
    brightness: 1.0,
    requiresTransparentCanvas: true,
  },
  overlayGenerator: generateMinimalOverlay,
};

/**
 * Generate minimal template SVG overlay
 */
export function generateMinimalOverlay(
  metadata: ExtractedMetadata,
  width: number,
  height: number,
  options: PreviewOptions = {},
  template: TemplateConfig = minimalTemplate
): string {
  const padding = template.layout.padding;
  const textColor = validateColor(options.colors?.text || '#000000');
  const accentColor = validateColor(options.colors?.accent || '#000000');
  const backgroundColor = validateColor(options.colors?.background || '#ffffff');

  // Typography settings with minimal approach
  const titleFontSize = template.typography.title.fontSize;
  const titleLineHeight = template.typography.title.lineHeight || 1.1;
  const descFontSize = template.typography.description?.fontSize || 26;
  const descLineHeight = template.typography.description?.lineHeight || 1.6;
  const siteNameFontSize = template.typography.siteName?.fontSize || 16;

  // Text wrapping with generous spacing
  const maxTextWidth = width - padding * 2;
  const titleLines = wrapText(
    metadata.title,
    maxTextWidth,
    titleFontSize,
    template.typography.title.maxLines || 2,
    'inter'
  );
  const descLines = metadata.description
    ? wrapText(
        metadata.description,
        maxTextWidth,
        descFontSize,
        template.typography.description?.maxLines || 2,
        'inter'
      )
    : [];

  const TITLE_DESCRIPTION_GAP = 60;
  const layout = layoutCenteredTitleDescription({
    height,
    titleLineCount: titleLines.length,
    titleFontSize,
    titleLineHeight,
    descLineCount: descLines.length,
    descFontSize,
    descLineHeight,
    gap: TITLE_DESCRIPTION_GAP,
  });

  const titleStartY = layout.titleStartY;
  const descStartY = layout.descStartY;

  return `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        ${createSvgStyleCdata(`
          .minimal-title { 
            font-family: ${SYSTEM_FONT_STACK}; 
            font-size: ${titleFontSize}px; 
            font-weight: 300; 
            fill: ${textColor};
            letter-spacing: -0.03em;
            line-height: ${titleLineHeight};
          }
          .minimal-description { 
            font-family: ${SYSTEM_FONT_STACK}; 
            font-size: ${descFontSize}px; 
            font-weight: 300; 
            fill: ${textColor};
            opacity: 0.7;
            letter-spacing: -0.01em;
            line-height: ${descLineHeight};
          }
          .minimal-sitename { 
            font-family: ${SYSTEM_FONT_STACK}; 
            font-size: ${siteNameFontSize}px; 
            font-weight: 500; 
            fill: ${accentColor};
            text-transform: uppercase;
            letter-spacing: 0.2em;
            opacity: 0.6;
          }
          .minimal-domain {
            font-family: ${SYSTEM_FONT_STACK}; 
            font-size: 14px; 
            font-weight: 400; 
            fill: ${textColor};
            opacity: 0.4;
            letter-spacing: 0.05em;
          }
        `)}
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
