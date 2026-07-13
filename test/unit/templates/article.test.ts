import { articleTemplate, generateArticleOverlay } from '../../../src/templates/article';
import { templates } from '../../../src/templates/registry';
import type { ExtractedMetadata, PreviewOptions } from '../../../src/types';

function elementMarkupByClass(svg: string, className: string, tagName: string): string[] {
  const classPattern = `class="[^"]*\\b${className}\\b[^"]*"`;
  const pattern = new RegExp(
    `<${tagName}\\b[^>]*${classPattern}[^>]*>[\\s\\S]*?<\\/${tagName}>`,
    'g'
  );

  return svg.match(pattern) ?? [];
}

function openingTagsByClass(
  svg: string,
  className: string,
  tagName = '[a-zA-Z][\\w:-]*'
): string[] {
  const classPattern = `class="[^"]*\\b${className}\\b[^"]*"`;
  const pattern = new RegExp(`<${tagName}\\b[^>]*${classPattern}[^>]*>`, 'g');

  return svg.match(pattern) ?? [];
}

function numericAttribute(markup: string, name: string): number {
  const match = markup.match(new RegExp(`\\b${name}="([^"]+)"`));
  if (!match) {
    throw new Error(`Missing ${name} in ${markup}`);
  }
  return Number(match[1]);
}

function translation(markup: string): { x: number; y: number } {
  const match = markup.match(/\btransform="translate\(([^ ]+) ([^)]+)\)"/);
  if (!match) {
    throw new Error(`Missing translation in ${markup}`);
  }
  return { x: Number(match[1]), y: Number(match[2]) };
}

function viewBox(svg: string): { x: number; y: number; width: number; height: number } {
  const match = svg.match(/\bviewBox="([^ ]+) ([^ ]+) ([^ ]+) ([^"]+)"/);
  if (!match) {
    throw new Error('Missing viewBox');
  }
  return {
    x: Number(match[1]),
    y: Number(match[2]),
    width: Number(match[3]),
    height: Number(match[4]),
  };
}

describe('Article Template', () => {
  const metadata: ExtractedMetadata = {
    title: '좋은 제품은 복잡한 정보를 누구나 이해할 수 있게 정리합니다',
    description: '핵심 내용을 모바일 카드에서 빠르게 확인할 수 있습니다.',
    siteName: 'NANGGO LAB',
    url: 'https://example.com/article',
    domain: 'example.com',
  };

  it('registers the additive article template contract', () => {
    expect(articleTemplate.name).toBe('article');
    expect(articleTemplate.overlayGenerator).toBe(generateArticleOverlay);
    expect(templates.article).toBe(articleTemplate);
  });

  it('shows the mobile preview panel and summary by default when a description exists', () => {
    const svg = generateArticleOverlay(metadata, 1200, 630, {});

    expect(openingTagsByClass(svg, 'article-mobile-panel')).toHaveLength(1);
    expect(elementMarkupByClass(svg, 'article-summary', 'text').length).toBeGreaterThan(0);
    expect(svg).toContain('핵심 내용을 모바일 카드에서');
  });

  it('hides the mobile panel and reflows the article content when mobilePreview is false', () => {
    const splitSvg = generateArticleOverlay(metadata, 1200, 630, {});
    const reflowedSvg = generateArticleOverlay(metadata, 1200, 630, {
      mobilePreview: false,
    });

    expect(openingTagsByClass(reflowedSvg, 'article-mobile-panel')).toHaveLength(0);
    expect(elementMarkupByClass(reflowedSvg, 'article-summary', 'text')).toHaveLength(0);
    expect(elementMarkupByClass(reflowedSvg, 'article-title', 'text')).not.toEqual(
      elementMarkupByClass(splitSvg, 'article-title', 'text')
    );
  });

  it('omits the mobile panel when there is no description', () => {
    const svg = generateArticleOverlay({ ...metadata, description: undefined }, 1200, 630, {});

    expect(openingTagsByClass(svg, 'article-mobile-panel')).toHaveLength(0);
    expect(elementMarkupByClass(svg, 'article-summary', 'text')).toHaveLength(0);
  });

  it('uses colors.primary ahead of colors.accent for the article accent', () => {
    const options: PreviewOptions = {
      colors: {
        primary: '#7C3AED',
        accent: '#F97316',
      },
    };

    const svg = generateArticleOverlay(metadata, 1200, 630, options);

    expect(svg).toContain('#7C3AED');
    expect(svg).not.toContain('#F97316');
  });

  it.each([
    { width: 1200, height: 630 },
    { width: 320, height: 168 },
  ])('keeps the article layout inside a $width x $height root SVG', ({ width, height }) => {
    const svg = generateArticleOverlay(metadata, width, height, {});

    expect(svg).toContain(`<svg width="${width}" height="${height}"`);
    expect(openingTagsByClass(svg, 'article-mobile-panel')).toHaveLength(1);
    expect(elementMarkupByClass(svg, 'article-title', 'text').length).toBeGreaterThan(0);
  });

  it('preserves the split mobile layout for the default landscape aspect ratio', () => {
    const svg = generateArticleOverlay(metadata, 1200, 630, {});
    const group = openingTagsByClass(svg, 'article-mobile-preview-split', 'g')[0];
    const panel = openingTagsByClass(svg, 'article-mobile-panel', 'rect')[0];

    expect(translation(group)).toEqual({ x: 748, y: 42 });
    expect(numericAttribute(panel, 'width')).toBe(392);
    expect(numericAttribute(panel, 'height')).toBe(546);
    expect(svg).not.toContain('article-mobile-preview-stacked');
  });

  it.each([
    { width: 800, height: 800, logicalHeight: 1200 },
    { width: 400, height: 800, logicalHeight: 2400 },
  ])(
    'stacks a full-size mobile panel inside a $width x $height viewport',
    ({ width, height, logicalHeight }) => {
      const svg = generateArticleOverlay(metadata, width, height, {});
      const group = openingTagsByClass(svg, 'article-mobile-preview-stacked', 'g')[0];
      const panel = openingTagsByClass(svg, 'article-mobile-panel', 'rect')[0];
      const position = translation(group);
      const panelWidth = numericAttribute(panel, 'width');
      const panelHeight = numericAttribute(panel, 'height');

      expect(svg).toContain(`viewBox="0 0 1200 ${logicalHeight}"`);
      expect(panelWidth).toBeGreaterThanOrEqual(900);
      expect(panelHeight).toBeGreaterThanOrEqual(570);
      expect(position.x).toBeGreaterThanOrEqual(0);
      expect(position.x + panelWidth).toBeLessThanOrEqual(1200);
      expect(position.y).toBeGreaterThan(0);
      expect(position.y + panelHeight).toBeLessThan(logicalHeight - 100);
    }
  );

  it.each([
    { width: 801, height: 800 },
    { width: 1000, height: 800 },
  ])('keeps a near-square $width x $height output in the stacked layout', ({ width, height }) => {
    const svg = generateArticleOverlay(metadata, width, height, {});
    const viewport = viewBox(svg);
    const panel = openingTagsByClass(svg, 'article-mobile-panel', 'rect')[0];
    const group = openingTagsByClass(svg, 'article-mobile-preview-stacked', 'g')[0];
    const position = translation(group);

    expect(viewport).toEqual({ x: 0, y: 0, width: 1200, height: (1200 * height) / width });
    expect(openingTagsByClass(svg, 'article-mobile-preview-split', 'g')).toHaveLength(0);
    expect(position.x + numericAttribute(panel, 'width')).toBeLessThanOrEqual(viewport.width);
    expect(position.y + numericAttribute(panel, 'height')).toBeLessThan(viewport.height - 90);
  });

  it('keeps a clearly landscape output in the split layout', () => {
    const svg = generateArticleOverlay(metadata, 1200, 800, {});

    expect(openingTagsByClass(svg, 'article-mobile-preview-split', 'g')).toHaveLength(1);
    expect(openingTagsByClass(svg, 'article-mobile-preview-stacked', 'g')).toHaveLength(0);
  });

  it('keeps the stacked text-only state when mobilePreview is false', () => {
    const svg = generateArticleOverlay(metadata, 400, 800, { mobilePreview: false });

    expect(svg).toContain('viewBox="0 0 1200 2400"');
    expect(openingTagsByClass(svg, 'article-mobile-panel')).toHaveLength(0);
    expect(elementMarkupByClass(svg, 'article-description', 'text').length).toBeGreaterThan(0);
  });

  it('omits the stacked mobile panel when no description exists', () => {
    const svg = generateArticleOverlay({ ...metadata, description: undefined }, 400, 800, {});

    expect(openingTagsByClass(svg, 'article-mobile-panel')).toHaveLength(0);
    expect(elementMarkupByClass(svg, 'article-summary', 'text')).toHaveLength(0);
  });

  it('wraps an unspaced Korean title without dropping it into a single truncated line', () => {
    const koreanTitle =
      '사용자가복잡한설명없이도핵심정보를빠르게이해하고다음행동을선택할수있는제품디자인원칙';
    const svg = generateArticleOverlay({ ...metadata, title: koreanTitle }, 1200, 630, {});
    const titleLines = elementMarkupByClass(svg, 'article-title', 'text');

    expect(titleLines.length).toBeGreaterThan(1);
    expect(titleLines.length).toBeLessThanOrEqual(articleTemplate.typography.title.maxLines ?? 3);
    expect(titleLines.join('')).not.toContain('�');
    expect(titleLines[0]).toContain('사용자가');
  });

  it('accounts for wide Latin glyphs instead of letting them overrun the title region', () => {
    const wideTitle = 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW';
    const svg = generateArticleOverlay({ ...metadata, title: wideTitle }, 1200, 630, {});
    const titleLines = elementMarkupByClass(svg, 'article-title', 'text');

    expect(titleLines.length).toBeGreaterThan(1);
    expect(titleLines).toHaveLength(articleTemplate.typography.title.maxLines ?? 3);
    expect(titleLines[0]).not.toContain('WWWWWWWWWWW');
    expect(titleLines.at(-1)).toContain('…');
  });

  it.each([
    { name: 'regional-indicator flags', grapheme: '🇰🇷', expectedLines: 3 },
    { name: 'keycap sequences', grapheme: '1️⃣', expectedLines: 3 },
    { name: 'fullwidth Latin forms', grapheme: 'Ｍ', expectedLines: 3 },
    { name: 'fullwidth CJK punctuation', grapheme: '。', expectedLines: 1 },
    { name: 'non-ASCII math symbols', grapheme: '∑', expectedLines: 3 },
  ])('accounts for wide $name as complete graphemes', ({ grapheme, expectedLines }) => {
    const title = grapheme.repeat(30);
    const svg = generateArticleOverlay({ ...metadata, title }, 1200, 630, {});
    const titleLines = elementMarkupByClass(svg, 'article-title', 'text');

    expect(titleLines).toHaveLength(expectedLines);
    expect(titleLines[0]).not.toContain(grapheme.repeat(10));
    expect(titleLines.at(-1)).toContain('…');
    expect(titleLines.join('')).not.toContain('�');
  });

  it('keeps a realistic punctuation-heavy English title without premature ellipsis', () => {
    const title = "What's new in GPT-5? Faster, safer, and smarter.";
    const svg = generateArticleOverlay({ ...metadata, title }, 1200, 630, {});
    const leftTitle = elementMarkupByClass(svg, 'article-title', 'text').join('');
    const panelTitle = elementMarkupByClass(svg, 'article-panel-title', 'text').join('');

    expect(leftTitle).not.toContain('…');
    expect(leftTitle).toContain('smarter.');
    expect(panelTitle).not.toContain('…');
    expect(panelTitle).toContain('smarter.');
  });

  it.each([
    'あいうえおかきくけ。続きの記事タイトル',
    'あいうえおかきく「記事タイトルの続き',
    '一二三四五六七八九，后续文章标题',
    '一二三四五六七八九。」続き',
    '一二三四五六七。！？后续文章标题',
    `${'文'.repeat(9)},続き記事です`,
    `${'文'.repeat(9)}｡､｣続き記事です`,
    `${'文'.repeat(9)}ぁぃぅ続き記事です`,
    `文《${'語'.repeat(6)}》，${'後'.repeat(20)}`,
    '文お続ぅ文事き文ぇ｡ぁゅ。ゃゃ』》」？',
  ])('keeps Japanese and Chinese prohibited punctuation off title line boundaries', (title) => {
    const svg = generateArticleOverlay({ ...metadata, title }, 1200, 630, {});
    const blocks = [
      elementMarkupByClass(svg, 'article-title', 'text'),
      elementMarkupByClass(svg, 'article-panel-title', 'text'),
    ];
    const prohibitedStart =
      /^[!,.?:;、。，．！？；：)\]}」』】〉》〕］｝’”｡､｣ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ]/u;
    const prohibitedEnd = /[(\[{「『【〈《〔［｛‘“｢]$/u;

    for (const lines of blocks) {
      const textLines = lines.map((line) => line.replace(/<[^>]+>/g, ''));
      for (const line of textLines.slice(1)) {
        expect(line).not.toMatch(prohibitedStart);
      }
      for (const line of textLines.slice(0, -1)) {
        expect(line).not.toMatch(prohibitedEnd);
      }
    }
  });

  it('terminates safely when a wrapped segment contains only prohibited line endings', () => {
    const title = `${'文'.repeat(8)}${'「'.repeat(12)}続`;
    const startedAt = Date.now();
    const svg = generateArticleOverlay({ ...metadata, title }, 1200, 630, {});

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(elementMarkupByClass(svg, 'article-title', 'text').join('')).toContain('…');
    expect(elementMarkupByClass(svg, 'article-panel-title', 'text').join('')).toContain('…');
  });

  it('keeps closing CJK punctuation off summary line starts', () => {
    const description = `${'文'.repeat(13)}，后续摘要内容继续显示。`;
    const svg = generateArticleOverlay({ ...metadata, description }, 1200, 630, {});
    const summaryLines = elementMarkupByClass(svg, 'article-summary', 'text').map((line) =>
      line.replace(/<[^>]+>/g, '')
    );

    expect(summaryLines.length).toBeGreaterThan(1);
    for (const line of summaryLines.slice(1)) {
      expect(line).not.toMatch(/^[、。，．！？；：)\]}」』】〉》〕］｝’”]/u);
    }
  });

  it('truncates long site and domain labels inside their fixed-width regions', () => {
    const longSiteName = '아주긴사이트이름이모바일패널의가로폭을넘어가는경우';
    const longDomain = 'an-extremely-long-domain-name-for-an-article-preview.example.com';
    const svg = generateArticleOverlay(
      { ...metadata, siteName: longSiteName, domain: longDomain },
      1200,
      630,
      {}
    );
    const panelSite = elementMarkupByClass(svg, 'article-panel-site', 'text').join('');
    const panelDomain = elementMarkupByClass(svg, 'article-panel-domain', 'text').join('');

    expect(panelSite).toContain('…');
    expect(panelSite).not.toContain(longSiteName);
    expect(panelDomain).toContain('…');
    expect(panelDomain).not.toContain(longDomain);
  });

  it('does not repeat the hostname on adjacent lower-left branding lines', () => {
    const svg = generateArticleOverlay(
      { ...metadata, siteName: 'Example.com', domain: 'www.example.com' },
      1200,
      630,
      {}
    );

    expect(elementMarkupByClass(svg, 'article-brand', 'text')).toHaveLength(1);
    expect(elementMarkupByClass(svg, 'article-domain', 'text')).toHaveLength(0);
    expect(elementMarkupByClass(svg, 'article-panel-domain', 'text')).toHaveLength(1);
  });
});
