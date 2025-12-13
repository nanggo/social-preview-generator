import { ExtractedMetadata, PreviewOptions, TemplateConfig } from '../types';
import { escapeXml, wrapText } from '../utils';
import { validateColor } from '../utils/validators';
import { createCachedSVG } from '../utils/sharp-cache';
import { SYSTEM_FONT_STACK } from '../constants/fonts';

/**
 * Default overlay generator for templates that don't provide a custom overlayGenerator.
 * Uses conservative typography + wrapping so custom templates still render cleanly.
 */
export async function generateDefaultOverlay(
  metadata: ExtractedMetadata,
  template: TemplateConfig,
  width: number,
  height: number,
  options: PreviewOptions
): Promise<Buffer> {
  const padding = template.layout.padding || 60;
  const textColor = validateColor(options.colors?.text || '#ffffff');

  // Typography settings
  const titleFontSize = template.typography.title.fontSize;
  const titleLineHeight = template.typography.title.lineHeight || 1.2;
  const descFontSize = template.typography.description?.fontSize || 24;
  const descLineHeight = template.typography.description?.lineHeight || 1.4;

  // Text wrapping similar to specific template generators
  const maxTextWidth = width - padding * 2;
  const titleLines = wrapText(
    metadata.title,
    maxTextWidth,
    titleFontSize,
    template.typography.title.maxLines || 2,
    'default'
  );
  const descLines = metadata.description
    ? wrapText(
        metadata.description,
        maxTextWidth,
        descFontSize,
        template.typography.description?.maxLines || 2,
        'default'
      )
    : [];

  // Calculate positions for proper vertical centering
  const titleHeight = titleLines.length * titleFontSize * titleLineHeight;
  const descHeight = descLines.length > 0 ? descLines.length * descFontSize * descLineHeight : 0;
  const gap = descLines.length > 0 ? 20 : 0;
  const totalContentHeight = titleHeight + gap + descHeight;

  const contentStartY = (height - totalContentHeight) / 2;
  const titleStartY = contentStartY + titleFontSize;
  const descStartY = titleStartY + titleHeight + gap;

  const overlaySvg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          .title { 
            font-family: ${SYSTEM_FONT_STACK}; 
            font-size: ${titleFontSize}px; 
            font-weight: ${template.typography.title.fontWeight || '700'}; 
            fill: ${textColor};
          }
          .description { 
            font-family: ${SYSTEM_FONT_STACK}; 
            font-size: ${descFontSize}px; 
            font-weight: ${template.typography.description?.fontWeight || '400'}; 
            fill: ${textColor};
            opacity: 0.9;
          }
        </style>
      </defs>
      
      <!-- Title with proper wrapping -->
      ${titleLines
        .map(
          (line: string, index: number) => `
      <text x="${padding}" y="${titleStartY + index * titleFontSize * titleLineHeight}" class="title">
        ${escapeXml(line)}
      </text>
      `
        )
        .join('')}
      
      <!-- Description with proper wrapping -->
      ${
        descLines.length > 0
          ? descLines
              .map(
                (line: string, index: number) => `
      <text x="${padding}" y="${descStartY + index * descFontSize * descLineHeight}" class="description">
        ${escapeXml(line)}
      </text>
      `
              )
              .join('')
          : ''
      }
    </svg>
  `;

  // Use cached SVG creation for better performance
  const cachedSVG = await createCachedSVG(overlaySvg);
  return cachedSVG.toBuffer();
}

