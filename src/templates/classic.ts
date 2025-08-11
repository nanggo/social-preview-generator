/**
 * Classic Template
 * A traditional, business-friendly design with serif typography and conservative layout
 */

import { TemplateConfig, PreviewOptions, ExtractedMetadata } from '../types';
import { escapeXml, wrapText, adjustBrightness } from '../utils';
import { validateDimensions, validateColor } from '../utils/validators';

/**
 * Classic template configuration
 */
export const classicTemplate: TemplateConfig = {
  name: 'classic',
  layout: {
    padding: 60,
    titlePosition: 'left',
    descriptionPosition: 'below-title',
    imagePosition: 'right',
    logoPosition: 'top-left',
  },
  typography: {
    title: {
      fontSize: 48,
      fontWeight: '700',
      lineHeight: 1.3,
      maxLines: 3,
    },
    description: {
      fontSize: 24,
      fontWeight: '400',
      lineHeight: 1.5,
      maxLines: 3,
    },
    siteName: {
      fontSize: 18,
      fontWeight: '600',
    },
  },
  effects: {
    gradient: {
      type: 'linear',
      colors: ['rgba(0,0,0,0.1)', 'rgba(0,0,0,0.05)'],
      direction: '0deg',
      opacity: 0.8,
    },
    blur: {
      radius: 0,
      areas: 'none',
    },
    shadow: {
      text: false,
      box: true,
    },
    borderRadius: 8,
  },
};

/**
 * Generate classic template SVG overlay
 */
export function generateClassicOverlay(
  metadata: ExtractedMetadata,
  width: number,
  height: number,
  options: PreviewOptions = {}
): string {
  // Validate dimensions
  validateDimensions(width, height);
  const padding = classicTemplate.layout.padding;
  const textColor = validateColor(options.colors?.text || '#1a1a1a');
  const accentColor = validateColor(options.colors?.accent || '#2c5aa0');
  const backgroundColor = validateColor(options.colors?.background || '#ffffff');

  // Typography settings
  const titleFontSize = classicTemplate.typography.title.fontSize;
  const titleLineHeight = classicTemplate.typography.title.lineHeight || 1.3;
  const descFontSize = classicTemplate.typography.description?.fontSize || 24;
  const descLineHeight = classicTemplate.typography.description?.lineHeight || 1.5;
  const siteNameFontSize = classicTemplate.typography.siteName?.fontSize || 18;

  // Layout calculations
  const contentWidth = Math.floor((width - padding * 3) * 0.6); // 60% for text, 40% for image
  const imageWidth = width - contentWidth - padding * 3;

  // Text wrapping
  const titleLines = wrapText(
    metadata.title,
    contentWidth,
    titleFontSize,
    classicTemplate.typography.title.maxLines || 3,
    'default'
  );
  const descLines = metadata.description
    ? wrapText(
        metadata.description,
        contentWidth,
        descFontSize,
        classicTemplate.typography.description?.maxLines || 3,
        'default'
      )
    : [];

  // Vertical positioning
  const headerHeight = 40;
  const contentStartY = headerHeight + padding;
  const titleStartY = contentStartY + titleFontSize;
  const descStartY = titleStartY + titleLines.length * titleFontSize * titleLineHeight + 20;

  return `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style type="text/css">
          <![CDATA[
          .classic-title { 
            font-family: Georgia, 'Times New Roman', serif; 
            font-size: ${titleFontSize}px; 
            font-weight: 700; 
            fill: ${textColor};
            line-height: ${titleLineHeight};
          }
          .classic-description { 
            font-family: Georgia, 'Times New Roman', serif; 
            font-size: ${descFontSize}px; 
            font-weight: 400; 
            fill: ${adjustBrightness(textColor, 20)};
            opacity: 0.9;
            line-height: ${descLineHeight};
          }
          .classic-sitename { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
            font-size: ${siteNameFontSize}px; 
            font-weight: 600; 
            fill: ${accentColor};
            text-transform: uppercase;
            letter-spacing: 0.1em;
          }
          .classic-domain {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
            font-size: 16px; 
            font-weight: 400; 
            fill: ${adjustBrightness(textColor, 40)};
            opacity: 0.7;
          }
          ]]>
        </style>
        
        <!-- Background pattern for texture -->
        <pattern id="classicPattern" x="0" y="0" width="100" height="100" patternUnits="userSpaceOnUse">
          <rect width="100" height="100" fill="${backgroundColor}"/>
          <circle cx="50" cy="50" r="1" fill="${accentColor}" opacity="0.03"/>
        </pattern>

        <!-- Subtle gradient overlay -->
        <linearGradient id="classicGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:${backgroundColor};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${adjustBrightness(backgroundColor, -5)};stop-opacity:1" />
        </linearGradient>
        
        <!-- Box shadow filter -->
        <filter id="classicShadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="rgba(0,0,0,0.1)"/>
        </filter>
      </defs>
      
      <!-- Background with pattern -->
      ${metadata.image ? '' : `<rect width="${width}" height="${height}" fill="url(#classicPattern)"/>`}
      
      <!-- Main content background with shadow -->
      <rect 
        x="${padding - 10}" 
        y="${headerHeight}" 
        width="${contentWidth + 20}" 
        height="${height - headerHeight - padding}" 
        fill="url(#classicGradient)"
        rx="8"
        filter="url(#classicShadow)"
        opacity="0.95"
      />
      
      <!-- Top accent line -->
      <rect x="${padding}" y="${headerHeight}" width="${contentWidth}" height="3" fill="${accentColor}"/>
      
      <!-- Site name in header -->
      ${
        metadata.siteName
          ? `
        <text x="${padding}" y="${headerHeight - 10}" class="classic-sitename">
          ${escapeXml(metadata.siteName)}
        </text>
      `
          : ''
      }
      
      <!-- Title -->
      ${titleLines
        .map(
          (line, index) => `
        <text 
          x="${padding}" 
          y="${titleStartY + index * titleFontSize * titleLineHeight}" 
          class="classic-title"
        >
          ${escapeXml(line)}
        </text>
      `
        )
        .join('')}
      
      <!-- Description -->
      ${
        descLines.length > 0
          ? descLines
              .map(
                (line, index) => `
        <text 
          x="${padding}" 
          y="${descStartY + index * descFontSize * descLineHeight}" 
          class="classic-description"
        >
          ${escapeXml(line)}
        </text>
      `
              )
              .join('')
          : ''
      }
      
      <!-- Bottom section with domain -->
      <g transform="translate(${padding}, ${height - 40})">
        ${
          metadata.domain
            ? `
          <text x="0" y="0" class="classic-domain">
            ${escapeXml(metadata.domain)}
          </text>
        `
            : ''
        }
        
        <!-- Decorative element -->
        <rect x="0" y="10" width="40" height="2" fill="${accentColor}" opacity="0.6"/>
      </g>
      
      <!-- Image placeholder area (if no background image) -->
      ${
        !metadata.image
          ? `
        <g transform="translate(${width - imageWidth - padding}, ${contentStartY})">
          <!-- Image placeholder -->
          <rect 
            x="0" y="0" 
            width="${imageWidth}" 
            height="${Math.min(imageWidth * 0.6, height - contentStartY - padding)}" 
            fill="${adjustBrightness(accentColor, -20)}" 
            opacity="0.1" 
            rx="8"
          />
          <text 
            x="${imageWidth / 2}" 
            y="${Math.min(imageWidth * 0.6, height - contentStartY - padding) / 2}" 
            text-anchor="middle" 
            font-family="sans-serif" 
            font-size="14" 
            fill="${accentColor}" 
            opacity="0.4"
          >
            ${metadata.siteName ? escapeXml(metadata.siteName) : 'IMAGE'}
          </text>
        </g>
      `
          : ''
      }
      
      <!-- Corner accent -->
      <g transform="translate(${width - 30}, 20)">
        <rect x="0" y="0" width="20" height="3" fill="${accentColor}" opacity="0.8"/>
        <rect x="0" y="6" width="15" height="2" fill="${accentColor}" opacity="0.6"/>
        <rect x="0" y="10" width="10" height="2" fill="${accentColor}" opacity="0.4"/>
      </g>
    </svg>
  `;
}
