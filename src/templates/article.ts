/**
 * Article Template
 * A metadata-first editorial preview with an optional mobile summary surface.
 */

import { SYSTEM_FONT_STACK } from '../constants/fonts';
import type { ExtractedMetadata, PreviewOptions, TemplateConfig } from '../types';
import { escapeXml } from '../utils';
import { validateColor } from '../utils/validators';
import { createSvgStyleCdata, layoutCenteredTitleDescription } from './shared';

const BASE_WIDTH = 1200;
const BASE_HEIGHT = 630;
const DEFAULT_PRIMARY = '#3182F6';
const DEFAULT_BACKGROUND = '#F2F4F6';
const DEFAULT_TEXT = '#191F28';
const DEFAULT_SECONDARY = '#4E5968';
const STACKED_LAYOUT_WIDTH = 1200;
const STACKED_LAYOUT_MAX_ASPECT_RATIO = 1.4;

const PROHIBITED_LINE_START =
  /^[\u0021\u0029\u002C\u002E\u003A\u003B\u003F\u005D\u007D\u3001\u3002\uFF0C\uFF0E\u30FB\uFF1A\uFF1B\uFF1F\uFF01\u309B\u309C\u30FD\u30FE\u309D\u309E\u3005\u303B\u30FC\u2010\u2013\u2019\u201D\u2025\u2026\u203C\u2047-\u2049\u3009\u300B\u300D\u300F\u3011\u3015\u3017\u3019\u301B\u301E\u301F\uFF09\uFF3D\uFF5D\uFF60\uFF61\uFF63\uFF64\uFF67-\uFF70\u00BB\u3041\u3043\u3045\u3047\u3049\u3063\u3083\u3085\u3087\u308E\u30A1\u30A3\u30A5\u30A7\u30A9\u30C3\u30E3\u30E5\u30E7\u30EE\u30F5\u30F6]/u;
const PROHIBITED_LINE_END =
  /^[\u3008\u300A\u300C\u300E\u3010\u3014\u3016\u3018\u301A\u301D\uFF08\uFF3B\uFF5B\uFF5F\uFF62\u00AB\u0028\u005B\u007B\u2018\u201C]/u;

const graphemeSegmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });

interface TextBlockOptions {
  lines: string[];
  x: number;
  firstBaseline: number;
  fontSize: number;
  lineHeight: number;
  className: string;
  anchor?: 'start' | 'middle' | 'end';
}

interface ArticleViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MobilePanelLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  stacked: boolean;
}

/**
 * Article template configuration.
 *
 * The template intentionally ignores remote article imagery. It reconstructs a
 * compact reading surface from metadata so generation stays deterministic and
 * does not require a browser or screenshot dependency.
 */
export const articleTemplate: TemplateConfig = {
  name: 'article',
  layout: {
    padding: 80,
    titlePosition: 'left',
    descriptionPosition: 'below-title',
    imagePosition: 'none',
    logoPosition: 'bottom-left',
  },
  typography: {
    title: {
      fontSize: 68,
      fontWeight: '800',
      lineHeight: 1.12,
      maxLines: 3,
    },
    description: {
      fontSize: 28,
      fontWeight: '400',
      lineHeight: 1.45,
      maxLines: 3,
    },
    siteName: {
      fontSize: 20,
      fontWeight: '700',
    },
  },
  effects: {
    shadow: {
      text: false,
      box: true,
    },
    borderRadius: 34,
  },
  imageProcessing: {
    requiresTransparentCanvas: true,
  },
  overlayGenerator: generateArticleOverlay,
};

function estimateGraphemeWidth(grapheme: string, fontSize: number): number {
  if (/^\s$/u.test(grapheme)) {
    return fontSize * 0.32;
  }

  if (
    /\p{Extended_Pictographic}/u.test(grapheme) ||
    /\p{Regional_Indicator}/u.test(grapheme) ||
    /\u20E3/u.test(grapheme) ||
    /[\u3000-\u303F\u3200-\u33FF\uFE10-\uFE6F\uFF01-\uFF60\uFFE0-\uFFE6]/u.test(grapheme) ||
    /\p{Script=Han}|\p{Script=Hangul}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(grapheme)
  ) {
    return fontSize;
  }

  const decomposedBase = grapheme.normalize('NFD').replace(/\p{M}/gu, '');

  if (/^[MW]$/u.test(decomposedBase)) {
    return fontSize;
  }

  if (/^[A-Z]$/u.test(decomposedBase)) {
    return fontSize * 0.7;
  }

  if (/^[0-9]$/u.test(decomposedBase)) {
    return fontSize * 0.62;
  }

  if (/^[mw]$/u.test(decomposedBase)) {
    return fontSize * 0.85;
  }

  if (/^[il]$/u.test(decomposedBase)) {
    return fontSize * 0.25;
  }

  if (/^[fjrt]$/u.test(decomposedBase)) {
    return fontSize * 0.4;
  }

  if (/^[a-z]$/u.test(decomposedBase)) {
    return fontSize * 0.53;
  }

  if (/^[—…]$/u.test(grapheme) || /[\p{L}\p{N}\p{M}]/u.test(grapheme)) {
    return fontSize;
  }

  if (/^[.,:;'"`!]$/u.test(grapheme)) {
    return fontSize * 0.23;
  }

  if (/^[?\-_/\\|()[\]{}<>]$/u.test(grapheme)) {
    return fontSize * 0.55;
  }

  if (/^[@%#&]$/u.test(grapheme)) {
    return fontSize * 0.9;
  }

  if (/^[*+=$^~]$/u.test(grapheme)) {
    return fontSize * 0.7;
  }

  if (/^[\p{P}\p{S}]$/u.test(grapheme)) {
    return fontSize;
  }

  return fontSize;
}

function measureGraphemes(graphemes: string[], fontSize: number, letterSpacingEm = 0): number {
  const glyphWidth = graphemes.reduce(
    (total, grapheme) => total + estimateGraphemeWidth(grapheme, fontSize),
    0
  );
  const spacingWidth = Math.max(0, graphemes.length - 1) * fontSize * letterSpacingEm;

  return glyphWidth + spacingWidth;
}

function trimGraphemeWhitespace(graphemes: string[]): string[] {
  let start = 0;
  let end = graphemes.length;

  while (start < end && /^\s$/u.test(graphemes[start])) {
    start += 1;
  }
  while (end > start && /^\s$/u.test(graphemes[end - 1])) {
    end -= 1;
  }

  return graphemes.slice(start, end);
}

function findLastWhitespace(graphemes: string[]): number {
  for (let index = graphemes.length - 1; index >= 0; index -= 1) {
    if (/^\s$/u.test(graphemes[index])) {
      return index;
    }
  }
  return -1;
}

function appendEllipsis(
  line: string,
  maxWidth: number,
  fontSize: number,
  letterSpacingEm: number
): string {
  const ellipsis = '…';
  const graphemes = Array.from(graphemeSegmenter.segment(line), (part) => part.segment);

  while (
    graphemes.length > 0 &&
    measureGraphemes([...graphemes, ellipsis], fontSize, letterSpacingEm) > maxWidth
  ) {
    graphemes.pop();
  }

  while (graphemes.length > 0 && PROHIBITED_LINE_END.test(graphemes[graphemes.length - 1])) {
    graphemes.pop();
  }

  return trimGraphemeWhitespace(graphemes).join('') + ellipsis;
}

/**
 * Approximate browser line wrapping while remaining deterministic in SVG.
 * Grapheme segmentation keeps emoji and composed Korean characters intact.
 */
function wrapArticleText(
  text: string,
  maxWidth: number,
  fontSize: number,
  maxLines: number,
  letterSpacingEm = 0
): string[] {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  if (!normalized) {
    return [];
  }

  const source = Array.from(graphemeSegmenter.segment(normalized), (part) => part.segment);
  const lines: string[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    while (cursor < source.length && /^\s$/u.test(source[cursor])) {
      cursor += 1;
    }
    if (cursor >= source.length) {
      break;
    }

    let fittedEnd = cursor;
    while (fittedEnd < source.length) {
      const candidate = source.slice(cursor, fittedEnd + 1);
      if (fittedEnd > cursor && measureGraphemes(candidate, fontSize, letterSpacingEm) > maxWidth) {
        break;
      }
      fittedEnd += 1;
    }

    let lineEnd = fittedEnd;
    let nextStart = fittedEnd;
    if (fittedEnd < source.length) {
      const whitespaceOffset = findLastWhitespace(source.slice(cursor, fittedEnd));
      if (whitespaceOffset > 0) {
        lineEnd = cursor + whitespaceOffset;
        nextStart = lineEnd + 1;
        while (nextStart < source.length && /^\s$/u.test(source[nextStart])) {
          nextStart += 1;
        }
      }

      while (nextStart < source.length && PROHIBITED_LINE_START.test(source[nextStart])) {
        if (lineEnd - cursor <= 1) {
          const currentLine = trimGraphemeWhitespace(source.slice(cursor, lineEnd)).join('');
          const visibleLines = [...lines, currentLine].filter(Boolean).slice(0, maxLines);
          if (visibleLines.length === 0) {
            return ['…'];
          }
          visibleLines[visibleLines.length - 1] = appendEllipsis(
            visibleLines[visibleLines.length - 1],
            maxWidth,
            fontSize,
            letterSpacingEm
          );
          return visibleLines;
        }
        lineEnd -= 1;
        nextStart = lineEnd;
      }

      let legalLineEnd = lineEnd;
      while (legalLineEnd > cursor && PROHIBITED_LINE_END.test(source[legalLineEnd - 1])) {
        legalLineEnd -= 1;
      }
      if (legalLineEnd === cursor) {
        const visibleLines = lines.slice(0, maxLines);
        if (visibleLines.length === 0) {
          return ['…'];
        }
        visibleLines[visibleLines.length - 1] = appendEllipsis(
          visibleLines[visibleLines.length - 1],
          maxWidth,
          fontSize,
          letterSpacingEm
        );
        return visibleLines;
      }
      if (legalLineEnd !== lineEnd) {
        lineEnd = legalLineEnd;
        nextStart = lineEnd;
      }
    }

    const line = trimGraphemeWhitespace(source.slice(cursor, lineEnd));
    if (line.length > 0) {
      lines.push(line.join(''));
    }

    cursor = nextStart > cursor ? nextStart : cursor + 1;

    if (maxLines >= 1 && lines.length === maxLines && cursor < source.length) {
      lines[maxLines - 1] = appendEllipsis(
        lines[maxLines - 1],
        maxWidth,
        fontSize,
        letterSpacingEm
      );
      return lines;
    }
  }
  if (lines.length <= maxLines) {
    return lines;
  }

  const visibleLines = lines.slice(0, maxLines);
  visibleLines[maxLines - 1] = appendEllipsis(
    visibleLines[maxLines - 1],
    maxWidth,
    fontSize,
    letterSpacingEm
  );
  return visibleLines;
}

function fitSingleLine(
  text: string,
  maxWidth: number,
  fontSize: number,
  letterSpacingEm = 0
): string {
  return wrapArticleText(text, maxWidth, fontSize, 1, letterSpacingEm)[0] || '';
}

function renderTextBlock({
  lines,
  x,
  firstBaseline,
  fontSize,
  lineHeight,
  className,
  anchor = 'start',
}: TextBlockOptions): string {
  return lines
    .map(
      (line, index) =>
        '<text x="' +
        x +
        '" y="' +
        (firstBaseline + index * fontSize * lineHeight) +
        '" class="' +
        className +
        '" text-anchor="' +
        anchor +
        '">' +
        escapeXml(line) +
        '</text>'
    )
    .join('');
}

function domainFor(metadata: ExtractedMetadata): string {
  if (metadata.domain?.trim()) {
    return metadata.domain.trim().replace(/^www\./i, '');
  }

  try {
    return new URL(metadata.url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function normalizedIdentity(value: string): string {
  return value
    .trim()
    .replace(/^www\./i, '')
    .toLowerCase();
}

function createViewport(width: number, height: number, stacked: boolean): ArticleViewport {
  if (stacked) {
    return {
      x: 0,
      y: 0,
      width: STACKED_LAYOUT_WIDTH,
      height: (STACKED_LAYOUT_WIDTH * height) / width,
    };
  }

  const scale = Math.min(width / BASE_WIDTH, height / BASE_HEIGHT);
  const viewportWidth = width / scale;
  const viewportHeight = height / scale;

  return {
    x: (BASE_WIDTH - viewportWidth) / 2,
    y: (BASE_HEIGHT - viewportHeight) / 2,
    width: viewportWidth,
    height: viewportHeight,
  };
}

function createMobilePanel(
  metadata: ExtractedMetadata,
  description: string,
  primaryColor: string,
  siteName: string,
  domain: string,
  layout: MobilePanelLayout
): string {
  const panelTitleFontSize = 34 * layout.scale;
  const panelTitleLineHeight = 1.14;
  const panelSummaryFontSize = 22 * layout.scale;
  const panelSummaryLineHeight = 1.46;
  const panelSiteFontSize = 17 * layout.scale;
  const panelDomainFontSize = 17 * layout.scale;
  const horizontalPadding = 40 * layout.scale;
  const panelTitleWidth = layout.width - horizontalPadding * 2;
  const panelTitleLines = wrapArticleText(
    metadata.title,
    panelTitleWidth,
    panelTitleFontSize,
    3,
    -0.03
  );
  const panelTitleFirstBaseline = 118 * layout.scale;
  const panelTitleHeight = panelTitleLines.length * panelTitleFontSize * panelTitleLineHeight;
  const summaryY = panelTitleFirstBaseline + panelTitleHeight + 22 * layout.scale;
  const dividerY = layout.height - 70 * layout.scale;
  const summaryBottom = dividerY - 76 * layout.scale;
  const summaryHeight = Math.min(
    196 * layout.scale,
    Math.max(132 * layout.scale, summaryBottom - summaryY)
  );
  const summaryLines = wrapArticleText(
    description,
    layout.width - 104 * layout.scale,
    panelSummaryFontSize,
    Math.max(
      2,
      Math.floor(
        (summaryHeight - 42 * layout.scale) / (panelSummaryFontSize * panelSummaryLineHeight)
      )
    ),
    -0.015
  );
  const compactSiteName = fitSingleLine(
    siteName,
    layout.width - 132 * layout.scale,
    panelSiteFontSize,
    -0.01
  );
  const compactDomain = fitSingleLine(
    domain || siteName,
    layout.width - 108 * layout.scale,
    panelDomainFontSize
  );
  const className = layout.stacked
    ? 'article-mobile-preview article-mobile-preview-stacked'
    : 'article-mobile-preview article-mobile-preview-split';

  return (
    '<g class="' +
    className +
    '" transform="translate(' +
    layout.x +
    ' ' +
    layout.y +
    ')">' +
    '<rect x="0" y="0" width="' +
    layout.width +
    '" height="' +
    layout.height +
    '" rx="' +
    34 * layout.scale +
    '" fill="#FFFFFF" class="article-mobile-panel" filter="url(#article-card-shadow)"/>' +
    '<rect x="' +
    40 * layout.scale +
    '" y="' +
    42 * layout.scale +
    '" width="' +
    34 * layout.scale +
    '" height="' +
    5 * layout.scale +
    '" rx="' +
    2.5 * layout.scale +
    '" fill="' +
    primaryColor +
    '"/>' +
    '<text x="' +
    86 * layout.scale +
    '" y="' +
    52 * layout.scale +
    '" class="article-panel-site">' +
    escapeXml(compactSiteName) +
    '</text>' +
    renderTextBlock({
      lines: panelTitleLines,
      x: horizontalPadding,
      firstBaseline: panelTitleFirstBaseline,
      fontSize: panelTitleFontSize,
      lineHeight: panelTitleLineHeight,
      className: 'article-panel-title',
    }) +
    '<rect x="' +
    32 * layout.scale +
    '" y="' +
    summaryY +
    '" width="' +
    (layout.width - 64 * layout.scale) +
    '" height="' +
    summaryHeight +
    '" rx="' +
    22 * layout.scale +
    '" fill="' +
    primaryColor +
    '" opacity="0.09"/>' +
    renderTextBlock({
      lines: summaryLines,
      x: 52 * layout.scale,
      firstBaseline: summaryY + 38 * layout.scale,
      fontSize: panelSummaryFontSize,
      lineHeight: panelSummaryLineHeight,
      className: 'article-summary',
    }) +
    '<line x1="' +
    40 * layout.scale +
    '" y1="' +
    dividerY +
    '" x2="' +
    (layout.width - 40 * layout.scale) +
    '" y2="' +
    dividerY +
    '" stroke="#E5E8EB" stroke-width="' +
    2 * layout.scale +
    '"/>' +
    '<circle cx="' +
    50 * layout.scale +
    '" cy="' +
    (layout.height - 37 * layout.scale) +
    '" r="' +
    6 * layout.scale +
    '" fill="' +
    primaryColor +
    '"/>' +
    '<text x="' +
    68 * layout.scale +
    '" y="' +
    (layout.height - 30 * layout.scale) +
    '" class="article-panel-domain">' +
    escapeXml(compactDomain) +
    '</text>' +
    '</g>'
  );
}

/**
 * Generate the article template SVG overlay.
 */
export function generateArticleOverlay(
  metadata: ExtractedMetadata,
  width: number,
  height: number,
  options: PreviewOptions = {},
  template: TemplateConfig = articleTemplate
): string {
  const primaryColor = validateColor(
    options.colors?.primary || options.colors?.accent || DEFAULT_PRIMARY
  );
  const backgroundColor = validateColor(options.colors?.background || DEFAULT_BACKGROUND);
  const textColor = validateColor(options.colors?.text || DEFAULT_TEXT);
  const secondaryColor = validateColor(options.colors?.secondary || DEFAULT_SECONDARY);
  const description = metadata.description?.trim() || '';
  const showMobilePreview = options.mobilePreview !== false && description.length > 0;
  const stackedLayout = width / height <= STACKED_LAYOUT_MAX_ASPECT_RATIO;
  const viewport = createViewport(width, height, stackedLayout);
  const stackedLayoutProgress = stackedLayout
    ? Math.max(0, Math.min(1, (viewport.height - 840) / 360))
    : 0;
  const domain = domainFor(metadata);
  const siteName = metadata.siteName?.trim() || domain || 'ARTICLE';
  const showBrandDomain =
    domain.length > 0 && normalizedIdentity(domain) !== normalizedIdentity(siteName);
  const brandFontSize = stackedLayout ? 28 + 6 * stackedLayoutProgress : 20;
  const brandDomainFontSize = stackedLayout ? 22 + 5 * stackedLayoutProgress : 18;
  const brandTextMaxWidth = stackedLayout ? 840 + 80 * stackedLayoutProgress : 520;
  const compactSiteName = fitSingleLine(siteName, brandTextMaxWidth, brandFontSize, -0.01);
  const compactDomain = showBrandDomain
    ? fitSingleLine(domain, brandTextMaxWidth, brandDomainFontSize)
    : '';

  const titleFontSize = stackedLayout
    ? 60 + 18 * stackedLayoutProgress
    : showMobilePreview
      ? template.typography.title.fontSize
      : 74;
  const titleLineHeight = template.typography.title.lineHeight || 1.12;
  const titleMaxLines = template.typography.title.maxLines || 3;
  const titleMaxWidth = stackedLayout ? 1040 : showMobilePreview ? 600 : 1000;
  const titleLines = wrapArticleText(
    metadata.title,
    titleMaxWidth,
    titleFontSize,
    titleMaxLines,
    -0.035
  );
  const descriptionFontSize = stackedLayout
    ? 28 + 6 * stackedLayoutProgress
    : template.typography.description?.fontSize || 28;
  const descriptionLineHeight = template.typography.description?.lineHeight || 1.45;
  const descriptionLines =
    !showMobilePreview && description
      ? wrapArticleText(
          description,
          stackedLayout ? 1040 : 940,
          descriptionFontSize,
          template.typography.description?.maxLines || 3,
          -0.012
        )
      : [];

  let articleContent: string;
  let mobilePanelLayout: MobilePanelLayout | undefined;

  if (stackedLayout && showMobilePreview) {
    const titleBlockHeight = titleLines.length * titleFontSize * titleLineHeight;
    const panelWidth = Math.min(840 + 80 * stackedLayoutProgress, viewport.width - 160);
    const desiredPanelHeight = Math.min(1100, Math.max(360, viewport.height * 0.48));
    const layoutReserve = 180 + 80 * stackedLayoutProgress;
    const panelHeight = Math.min(
      desiredPanelHeight,
      Math.max(340, viewport.height - titleBlockHeight - layoutReserve)
    );
    const panelScale = Math.min(panelWidth / 392, panelHeight / 546);
    const stackGap = 40 + 30 * stackedLayoutProgress;
    const stackHeight = titleBlockHeight + stackGap + panelHeight;
    const bottomReserve = 100 + 60 * stackedLayoutProgress;
    const minimumTop = 50 + 30 * stackedLayoutProgress;
    const titleTop = Math.max(minimumTop, (viewport.height - bottomReserve - stackHeight) / 2);

    mobilePanelLayout = {
      x: (viewport.width - panelWidth) / 2,
      y: titleTop + titleBlockHeight + stackGap,
      width: panelWidth,
      height: panelHeight,
      scale: panelScale,
      stacked: true,
    };
    articleContent =
      '<rect x="80" y="' +
      Math.max(42, titleTop - 34) +
      '" width="56" height="8" rx="4" fill="' +
      primaryColor +
      '"/>' +
      renderTextBlock({
        lines: titleLines,
        x: 80,
        firstBaseline: titleTop + titleFontSize,
        fontSize: titleFontSize,
        lineHeight: titleLineHeight,
        className: 'article-title',
      });
  } else if (stackedLayout) {
    const titleBlockHeight = titleLines.length * titleFontSize * titleLineHeight;
    const descriptionBlockHeight =
      descriptionLines.length * descriptionFontSize * descriptionLineHeight;
    const gap = descriptionLines.length > 0 ? 42 : 0;
    const contentHeight = titleBlockHeight + gap + descriptionBlockHeight;
    const contentTop = Math.max(100, (viewport.height - 180 - contentHeight) / 2);

    articleContent =
      '<rect x="80" y="' +
      Math.max(60, contentTop - 34) +
      '" width="56" height="8" rx="4" fill="' +
      primaryColor +
      '"/>' +
      renderTextBlock({
        lines: titleLines,
        x: 80,
        firstBaseline: contentTop + titleFontSize,
        fontSize: titleFontSize,
        lineHeight: titleLineHeight,
        className: 'article-title',
      }) +
      renderTextBlock({
        lines: descriptionLines,
        x: 80,
        firstBaseline: contentTop + titleBlockHeight + gap + descriptionFontSize,
        fontSize: descriptionFontSize,
        lineHeight: descriptionLineHeight,
        className: 'article-description',
      });
  } else if (showMobilePreview) {
    const titleBlockHeight = titleLines.length * titleFontSize * titleLineHeight;
    const titleTop = Math.max(132, (BASE_HEIGHT - titleBlockHeight) / 2 - 8);
    mobilePanelLayout = {
      x: 748,
      y: 42,
      width: 392,
      height: 546,
      scale: 1,
      stacked: false,
    };
    articleContent =
      '<rect x="80" y="' +
      Math.max(96, titleTop - 34) +
      '" width="48" height="8" rx="4" fill="' +
      primaryColor +
      '"/>' +
      renderTextBlock({
        lines: titleLines,
        x: 80,
        firstBaseline: titleTop + titleFontSize,
        fontSize: titleFontSize,
        lineHeight: titleLineHeight,
        className: 'article-title',
      });
  } else {
    const centeredLayout = layoutCenteredTitleDescription({
      height: 510,
      titleLineCount: titleLines.length,
      titleFontSize,
      titleLineHeight,
      descLineCount: descriptionLines.length,
      descFontSize: descriptionFontSize,
      descLineHeight: descriptionLineHeight,
      gap: 32,
    });

    articleContent =
      '<rect x="80" y="' +
      Math.max(60, centeredLayout.contentStartY + 14) +
      '" width="56" height="8" rx="4" fill="' +
      primaryColor +
      '"/>' +
      renderTextBlock({
        lines: titleLines,
        x: 80,
        firstBaseline: centeredLayout.titleStartY + 48,
        fontSize: titleFontSize,
        lineHeight: titleLineHeight,
        className: 'article-title',
      }) +
      renderTextBlock({
        lines: descriptionLines,
        x: 80,
        firstBaseline: centeredLayout.descStartY + 48,
        fontSize: descriptionFontSize,
        lineHeight: descriptionLineHeight,
        className: 'article-description',
      });
  }

  const mobileContent = mobilePanelLayout
    ? createMobilePanel(metadata, description, primaryColor, siteName, domain, mobilePanelLayout)
    : '';
  const panelScale = mobilePanelLayout?.scale || 1;
  const brandCircleX = stackedLayout ? 100 : 88;
  const brandCircleY = stackedLayout ? viewport.height - 74 : 554;
  const brandTextX = stackedLayout ? 128 : 108;
  const brandTextY = brandCircleY + 7;
  const brandDomainY = brandCircleY + (stackedLayout ? 40 : 34);
  const brandCircleRadius = stackedLayout ? 10 : 8;

  const svgStyle = createSvgStyleCdata(
    [
      '.article-title { font-family: ' +
        SYSTEM_FONT_STACK +
        '; font-size: ' +
        titleFontSize +
        'px; font-weight: 800; fill: ' +
        textColor +
        '; letter-spacing: -0.035em; }',
      '.article-description { font-family: ' +
        SYSTEM_FONT_STACK +
        '; font-size: ' +
        descriptionFontSize +
        'px; font-weight: 400; fill: ' +
        secondaryColor +
        '; letter-spacing: -0.012em; }',
      '.article-brand { font-family: ' +
        SYSTEM_FONT_STACK +
        '; font-size: ' +
        brandFontSize +
        'px; font-weight: 700; fill: ' +
        textColor +
        '; letter-spacing: -0.01em; }',
      '.article-domain { font-family: ' +
        SYSTEM_FONT_STACK +
        '; font-size: ' +
        brandDomainFontSize +
        'px; font-weight: 500; fill: ' +
        secondaryColor +
        '; }',
      '.article-panel-site { font-family: ' +
        SYSTEM_FONT_STACK +
        '; font-size: ' +
        17 * panelScale +
        'px; font-weight: 700; fill: ' +
        secondaryColor +
        '; letter-spacing: -0.01em; }',
      '.article-panel-title { font-family: ' +
        SYSTEM_FONT_STACK +
        '; font-size: ' +
        34 * panelScale +
        'px; font-weight: 800; fill: ' +
        textColor +
        '; letter-spacing: -0.03em; }',
      '.article-summary { font-family: ' +
        SYSTEM_FONT_STACK +
        '; font-size: ' +
        22 * panelScale +
        'px; font-weight: 500; fill: ' +
        textColor +
        '; letter-spacing: -0.015em; }',
      '.article-panel-domain { font-family: ' +
        SYSTEM_FONT_STACK +
        '; font-size: ' +
        17 * panelScale +
        'px; font-weight: 600; fill: ' +
        secondaryColor +
        '; }',
    ].join('\n')
  );

  return (
    '<svg width="' +
    width +
    '" height="' +
    height +
    '" viewBox="' +
    viewport.x +
    ' ' +
    viewport.y +
    ' ' +
    viewport.width +
    ' ' +
    viewport.height +
    '" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">' +
    '<defs>' +
    svgStyle +
    '<filter id="article-card-shadow" x="-30%" y="-20%" width="160%" height="160%">' +
    '<feDropShadow dx="0" dy="' +
    18 * panelScale +
    '" stdDeviation="' +
    24 * panelScale +
    '" flood-color="#191F28" flood-opacity="0.12"/>' +
    '</filter>' +
    '</defs>' +
    '<rect x="' +
    viewport.x +
    '" y="' +
    viewport.y +
    '" width="' +
    viewport.width +
    '" height="' +
    viewport.height +
    '" fill="' +
    backgroundColor +
    '"/>' +
    articleContent +
    mobileContent +
    '<g class="article-branding">' +
    '<circle cx="' +
    brandCircleX +
    '" cy="' +
    brandCircleY +
    '" r="' +
    brandCircleRadius +
    '" fill="' +
    primaryColor +
    '"/>' +
    '<text x="' +
    brandTextX +
    '" y="' +
    brandTextY +
    '" class="article-brand">' +
    escapeXml(compactSiteName) +
    '</text>' +
    (compactDomain
      ? '<text x="' +
        brandTextX +
        '" y="' +
        brandDomainY +
        '" class="article-domain">' +
        escapeXml(compactDomain) +
        '</text>'
      : '') +
    '</g>' +
    '</svg>'
  );
}
