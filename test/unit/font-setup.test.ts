import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { vi } from 'vitest';
import {
  beginFontAwareRender,
  buildFontconfigXml,
  DEFAULT_SETUP_FONT_FAMILY,
  isProbeVerified,
  resolveRequestFonts,
  setupFonts,
} from '../../src/core/font-setup';
import { generateImage } from '../../src/core/image-generator';
import { generateDefaultOverlay } from '../../src/core/overlay-generator';
import { buildFontStack, SYSTEM_FONT_STACK } from '../../src/constants/fonts';
import {
  generateImageWithTemplate,
  generatePreview,
  generatePreviewFromMetadata,
} from '../../src/index';
import { generateArticleOverlay } from '../../src/templates/article';
import { generateClassicOverlay } from '../../src/templates/classic';
import { generateMinimalOverlay } from '../../src/templates/minimal';
import { generateModernOverlay } from '../../src/templates/modern';
import {
  ErrorType,
  ExtractedMetadata,
  PreviewGeneratorError,
  PreviewOptions,
  SanitizedOptions,
  TemplateConfig,
} from '../../src/types';
import { logger } from '../../src/utils/logger';

const STATE_KEY = Symbol.for('social-preview-generator.font-setup.v1');
const originalPlatform = process.platform;

const metadata: ExtractedMetadata = {
  title: '한글 제목 Title',
  description: 'Description',
  siteName: 'Site',
  url: 'https://example.com/post',
  domain: 'example.com',
};

function resetFontSetup(): void {
  delete (globalThis as unknown as Record<symbol, unknown>)[STATE_KEY];
}

function stubPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

async function expectSetupError(
  promise: Promise<unknown>,
  type: ErrorType,
  message: string
): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(PreviewGeneratorError);
  expect((error as PreviewGeneratorError).type).toBe(type);
  expect((error as PreviewGeneratorError).message).toContain(message);
}

describe('font stacks', () => {
  it('should prepend quoted families to the fallback stack', () => {
    expect(buildFontStack(undefined, SYSTEM_FONT_STACK)).toBe(SYSTEM_FONT_STACK);
    expect(buildFontStack([], SYSTEM_FONT_STACK)).toBe(SYSTEM_FONT_STACK);
    expect(buildFontStack([{ family: 'Brand Sans' }, { family: '본고딕' }], 'serif')).toBe(
      "'Brand Sans', '본고딕', serif"
    );
  });

  it('should reject unvalidated families passed directly to an overlay generator', () => {
    expect(() =>
      generateModernOverlay(metadata, 1200, 630, {
        fonts: [{ family: "x'; opacity: 0; font-family: 'y" }],
      })
    ).toThrow(PreviewGeneratorError);
  });

  it.each([
    ['modern', generateModernOverlay],
    ['minimal', generateMinimalOverlay],
    ['classic', generateClassicOverlay],
    ['article', generateArticleOverlay],
  ] as const)('should apply configured families to every %s text declaration', (_, generate) => {
    const options: PreviewOptions = { fonts: [{ family: 'Brand Sans' }] };
    const plain = generate(metadata, 1200, 630, {});
    const svg = generate(metadata, 1200, 630, options);

    const declarations = svg.match(/font-family(?::|=")\s*[^;"]+/g) ?? [];
    expect(declarations.length).toBeGreaterThan(0);
    expect(declarations.length).toBe((plain.match(/font-family(?::|=")/g) ?? []).length);
    for (const declaration of declarations) {
      expect(declaration).toMatch(/font-family(?::|=")\s*'Brand Sans', /);
    }
    expect(plain).not.toContain('Brand Sans');
  });

  it('should apply configured families to the default overlay', async () => {
    const template: TemplateConfig = {
      name: 'custom',
      layout: { padding: 40 },
      typography: { title: { fontSize: 40 } },
    };
    const svgCache = await import('../../src/utils/sharp-cache');
    const createCachedSVG = vi.spyOn(svgCache.svgCache, 'cacheSVG');

    await generateDefaultOverlay(metadata, template, 600, 315, {
      fonts: [{ family: 'Brand Sans' }],
    } as SanitizedOptions);

    const svg = createCachedSVG.mock.calls.at(-1)?.[0] ?? '';
    expect(svg.match(/font-family: 'Brand Sans', /g)).toHaveLength(2);
    createCachedSVG.mockRestore();
  });

  it('should apply configured families to the fallback overlay', async () => {
    const template: TemplateConfig = {
      name: 'fallback',
      layout: { padding: 40 },
      typography: { title: { fontSize: 40 } },
    };
    const svgCache = await import('../../src/utils/sharp-cache');
    const cacheSVG = vi.spyOn(svgCache.svgCache, 'cacheSVG');

    await generateImage(metadata, template, {
      width: 320,
      height: 200,
      fonts: [{ family: 'Brand Sans' }],
    });

    const svg = cacheSVG.mock.calls.map(([content]) => content).find(content =>
      content.includes('class="title"')
    );
    expect(svg?.match(/font-family: 'Brand Sans', /g)).toHaveLength(3);
    cacheSVG.mockRestore();
  });
});

describe('fontconfig generation', () => {
  const params = {
    cacheDir: '/tmp/stage/cache',
    fontDir: '/tmp/stage/k r&한<글>',
    family: 'Brand Sans',
    nonce: 'abc123',
    originalConfigFile: undefined,
  };

  it('should register the staged directory under the chosen family', () => {
    const xml = buildFontconfigXml(params);

    expect(xml).toContain('<dir>/tmp/stage/k r&amp;한&lt;글&gt;</dir>');
    expect(xml).toContain('<string>/tmp/stage/k r&amp;한&lt;글&gt;/</string>');
    expect(xml).toContain('<cachedir>/tmp/stage/cache</cachedir>');
    expect(xml.match(/<string>Brand Sans<\/string>/g)).toHaveLength(1);
    // The marker rule is keyed on a family given only to this setup's staged files.
    expect(xml.match(/<string>__spg_probe_abc123_font_0<\/string>/g)).toHaveLength(2);
    expect(xml).toContain('<string>__spg_probe_abc123_active_0</string>');
    expect(xml).not.toContain('control');
  });

  it('should include the default configuration optionally when none was set', () => {
    expect(buildFontconfigXml(params)).toContain(
      '<include ignore_missing="yes">fonts.conf</include>'
    );
  });

  it('should include an existing configuration unchanged and require it', () => {
    expect(buildFontconfigXml({ ...params, originalConfigFile: 'custom & co.conf' })).toContain(
      '<include ignore_missing="no">custom &amp; co.conf</include>'
    );
  });

  it('should reject control characters in substituted paths', () => {
    expect(() => buildFontconfigXml({ ...params, originalConfigFile: 'a\u0001b.conf' })).toThrow(
      PreviewGeneratorError
    );
  });
});

describe('probe verification', () => {
  const bounds = (height: number, touchesEdge = false) => ({ height, touchesEdge });

  it('should accept a doubled marked render', () => {
    expect(isProbeVerified(bounds(66), bounds(132))).toBe(true);
    expect(isProbeVerified(bounds(66), bounds(120))).toBe(true);
  });

  it.each([
    ['missing control', undefined, bounds(132)],
    ['missing marked render', bounds(66), undefined],
    ['unchanged height', bounds(66), bounds(66)],
    ['missing-glyph boxes', bounds(12), bounds(24)],
    ['too large', bounds(66), bounds(200)],
    ['clipped control', bounds(66, true), bounds(132)],
    ['clipped marked render', bounds(66), bounds(132, true)],
  ])('should reject %s', (_, control, active) => {
    expect(isProbeVerified(control, active)).toBe(false);
  });
});

describe('setupFonts', () => {
  let directory: string;
  let regular: string;
  let bold: string;

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'spg-font-test-'));
    regular = join(directory, 'Regular.otf');
    bold = join(directory, 'Bold.TTF');
    writeFileSync(regular, Buffer.concat([Buffer.from('OTTO'), Buffer.alloc(32)]));
    writeFileSync(bold, Buffer.concat([Buffer.from('00010000', 'hex'), Buffer.alloc(32)]));
    writeFileSync(join(directory, 'Collection.ttc'), Buffer.from('ttcf0000'));
    writeFileSync(join(directory, 'Disguised.otf'), Buffer.from('ttcf0000'));
    writeFileSync(join(directory, 'Web.woff2'), Buffer.from('wOF20000'));
    writeFileSync(join(directory, 'Renamed.ttf'), Buffer.from('wOF20000'));
    writeFileSync(join(directory, 'Text.otf'), 'not a font');
    symlinkSync(regular, join(directory, 'Link.otf'));
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetFontSetup();
    stubPlatform('darwin');
  });

  afterEach(() => {
    stubPlatform(originalPlatform);
    resetFontSetup();
    vi.restoreAllMocks();
  });

  it('should validate files and publish the default family without native setup', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const originalConfigFile = process.env.FONTCONFIG_FILE;

    const fonts = await setupFonts([regular, bold]);

    expect(fonts).toEqual([{ family: DEFAULT_SETUP_FONT_FAMILY }]);
    expect(process.env.FONTCONFIG_FILE).toBe(originalConfigFile);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('Linux only');
  });

  it('should return independent copies for identical calls and warn once', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const [first, concurrent] = await Promise.all([
      setupFonts([regular, bold], { family: ' 미리보기 서체 ' }),
      setupFonts([bold, regular, regular], { family: '미리보기 서체' }),
    ]);
    first[0].family = 'mutated';
    const repeated = await setupFonts([bold, regular], { family: '미리보기 서체' });

    expect(concurrent).toEqual([{ family: '미리보기 서체' }]);
    expect(repeated).toEqual([{ family: '미리보기 서체' }]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('should treat an omitted family and the default family as the same request', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await setupFonts([regular]);

    await expect(
      setupFonts([regular], { family: DEFAULT_SETUP_FONT_FAMILY })
    ).resolves.toEqual([{ family: DEFAULT_SETUP_FONT_FAMILY }]);
  });

  it('should reject a different setup without replacing the first', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    await setupFonts([regular]);

    await expectSetupError(setupFonts([bold]), ErrorType.IMAGE_ERROR, 'already configured');
    await expectSetupError(
      setupFonts([regular], { family: 'Other' }),
      ErrorType.IMAGE_ERROR,
      'already configured'
    );
    await expect(setupFonts([regular])).resolves.toEqual([{ family: DEFAULT_SETUP_FONT_FAMILY }]);
  });

  it.each([
    ['a non-array', 'Regular.otf'],
    ['an empty array', []],
    ['an empty path', ['']],
    ['a non-string path', [42]],
    ['the former source-object shape', [{ family: 'Brand', files: ['Regular.otf'] }]],
  ])('should reject %s', async (_, files) => {
    await expectSetupError(
      setupFonts(files as unknown as string[]),
      ErrorType.VALIDATION_ERROR,
      'path'
    );
  });

  it('should reject invalid options and family names', async () => {
    await expectSetupError(
      setupFonts([regular], [] as unknown as { family?: string }),
      ErrorType.VALIDATION_ERROR,
      'plain object'
    );
    await expectSetupError(
      setupFonts([regular], { family: '' }),
      ErrorType.VALIDATION_ERROR,
      'Font family'
    );
    await expectSetupError(
      setupFonts([regular], { family: "x'; y" }),
      ErrorType.VALIDATION_ERROR,
      'Font family'
    );
  });

  it.each(['Collection.ttc', 'Disguised.otf'])(
    'should reject the font collection %s',
    async file => {
      await expectSetupError(
        setupFonts([regular, join(directory, file)]),
        ErrorType.VALIDATION_ERROR,
        'Font collections are not supported'
      );
    }
  );

  it.each(['Web.woff2', 'Renamed.ttf', 'Text.otf'])(
    'should reject the unsupported file %s without exposing its path',
    async file => {
      const error = await setupFonts([regular, join(directory, file)]).catch(
        (reason: unknown) => reason
      );

      expect((error as PreviewGeneratorError).type).toBe(ErrorType.VALIDATION_ERROR);
      expect((error as PreviewGeneratorError).message).toBe(
        'Font file at index 1 is not a supported TTF or OTF file'
      );
    }
  );

  it.each([
    ['a missing file', 'Missing.otf'],
    ['a directory', '.'],
  ])('should reject %s', async (_, file) => {
    await expectSetupError(
      setupFonts([join(directory, file)]),
      ErrorType.VALIDATION_ERROR,
      'Font file at index 0 is not a readable file'
    );
  });

  it('should allow a retry after a failure that changed nothing', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await expectSetupError(
      setupFonts([join(directory, 'Missing.otf')]),
      ErrorType.VALIDATION_ERROR,
      'not a readable file'
    );

    await expect(setupFonts([join(directory, 'Link.otf')])).resolves.toEqual([
      { family: DEFAULT_SETUP_FONT_FAMILY },
    ]);
  });

  it('should not expose paths when the staging directory cannot be created', async () => {
    stubPlatform('linux');
    const originalTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = join(directory, 'missing', 'secret-location');
    try {
      const error = await setupFonts([regular]).catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(PreviewGeneratorError);
      expect((error as PreviewGeneratorError).type).toBe(ErrorType.IMAGE_ERROR);
      expect((error as PreviewGeneratorError).message).toBe(
        'Font setup could not stage font files'
      );
    } finally {
      if (originalTmpdir === undefined) {
        delete process.env.TMPDIR;
      } else {
        process.env.TMPDIR = originalTmpdir;
      }
    }
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    stubPlatform('darwin');
    await expect(setupFonts([regular])).resolves.toHaveLength(1);
  });

  it('should reject unsupported fontconfig environments before changing them', async () => {
    stubPlatform('linux');
    const originalConfigFile = process.env.FONTCONFIG_FILE;
    process.env.FONTCONFIG_SYSROOT = '/sysroot';
    try {
      await expectSetupError(setupFonts([regular]), ErrorType.IMAGE_ERROR, 'FONTCONFIG_SYSROOT');
      expect(process.env.FONTCONFIG_FILE).toBe(originalConfigFile);

      delete process.env.FONTCONFIG_SYSROOT;
      process.env.FONTCONFIG_FILE = '';
      await expectSetupError(setupFonts([regular]), ErrorType.IMAGE_ERROR, 'empty FONTCONFIG_FILE');
    } finally {
      delete process.env.FONTCONFIG_SYSROOT;
      if (originalConfigFile === undefined) {
        delete process.env.FONTCONFIG_FILE;
      } else {
        process.env.FONTCONFIG_FILE = originalConfigFile;
      }
    }
  });

  describe('render entrypoints', () => {
    const seenFonts: Array<PreviewOptions['fonts']> = [];
    const template: TemplateConfig = {
      name: 'custom',
      layout: { padding: 40 },
      typography: { title: { fontSize: 40 } },
      overlayGenerator: (_metadata, width, height, options) => {
        seenFonts.push(options.fonts);
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"></svg>`;
      },
    };
    const render = (options: PreviewOptions = {}) =>
      generateImageWithTemplate(metadata, template, { width: 320, height: 200, ...options });

    beforeEach(() => {
      seenFonts.length = 0;
      vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    });

    it('should use the registered family by default and let options replace it', async () => {
      await render();
      resetFontSetup();
      await setupFonts([regular], { family: 'Brand Sans' });

      await render();
      await render({ fonts: [{ family: 'Other' }] });
      await render({ fonts: [] });

      expect(seenFonts).toEqual([
        undefined,
        [{ family: 'Brand Sans' }],
        [{ family: 'Other' }],
        [],
      ]);
    });

    it('should count an overlay that fails inside the renderer as rendering', async () => {
      const oversized = '<svg xmlns="http://www.w3.org/2000/svg" width="40000" height="40000"/>';
      await expect(
        generateImageWithTemplate(
          metadata,
          { ...template, overlayGenerator: () => oversized },
          { width: 320, height: 200 }
        )
      ).rejects.toBeInstanceOf(PreviewGeneratorError);

      await expectSetupError(
        setupFonts([regular]),
        ErrorType.IMAGE_ERROR,
        'before the first preview is generated'
      );
    });

    it('should reject a first setup after rendering began', async () => {
      await render();

      await expectSetupError(
        setupFonts([regular]),
        ErrorType.IMAGE_ERROR,
        'before the first preview is generated'
      );
    });

    it('should not count a rejected render request as rendering', async () => {
      await expect(render({ width: -1 })).rejects.toBeInstanceOf(PreviewGeneratorError);
      await expect(
        generateImageWithTemplate({ ...metadata, title: '' }, template, {})
      ).rejects.toBeInstanceOf(PreviewGeneratorError);
      await expect(
        generateImageWithTemplate(metadata, { ...template, layout: { padding: -1 } }, {})
      ).rejects.toBeInstanceOf(PreviewGeneratorError);
      await expect(
        generatePreviewFromMetadata({ title: '', url: 'https://example.com' })
      ).rejects.toBeInstanceOf(PreviewGeneratorError);
      await expect(generatePreview('not a url')).rejects.toBeInstanceOf(PreviewGeneratorError);
      // Rejected overlay output: nothing was rendered.
      await expect(
        generateImageWithTemplate(
          metadata,
          { ...template, overlayGenerator: () => `<svg>${' '.repeat(1024 * 1024)}</svg>` },
          { width: 320, height: 200 }
        )
      ).rejects.toBeInstanceOf(PreviewGeneratorError);
      await expect(
        generateImageWithTemplate(
          metadata,
          { ...template, overlayGenerator: () => '<svg><invalid' },
          { width: 320, height: 200 }
        )
      ).rejects.toBeInstanceOf(PreviewGeneratorError);
      // Text that is not valid XML, through the default and fallback overlays.
      await expect(
        generateImageWithTemplate(
          { ...metadata, title: 'Title\uFFFF' },
          { ...template, overlayGenerator: undefined },
          { width: 320, height: 200 }
        )
      ).rejects.toBeInstanceOf(PreviewGeneratorError);
      await expect(
        generateImage({ ...metadata, title: 'Title\uFFFF' }, template, { width: 320, height: 200 })
      ).rejects.toBeInstanceOf(PreviewGeneratorError);
      // Rejected by asynchronous security checks, after input validation passed.
      await expect(generatePreview('http://127.0.0.1/')).rejects.toBeInstanceOf(
        PreviewGeneratorError
      );
      await expect(
        generatePreviewFromMetadata({
          title: 'Title',
          url: 'https://example.com',
          image: 'http://127.0.0.1/image.png',
        })
      ).rejects.toBeInstanceOf(PreviewGeneratorError);
      await expect(
        generateImageWithTemplate(
          { ...metadata, image: 'http://127.0.0.1/image.png' },
          { ...template, layout: { padding: 40, imagePosition: 'background' } },
          {}
        )
      ).rejects.toBeInstanceOf(PreviewGeneratorError);

      await expect(setupFonts([regular])).resolves.toHaveLength(1);
    });

    it('should reject a request whose fonts were resolved before setup completed', async () => {
      const staleOptions = resolveRequestFonts({});
      await setupFonts([regular]);

      expect(() => beginFontAwareRender(staleOptions)).toThrow('completed while this preview');
      expect(resolveRequestFonts({}).fonts).toEqual([{ family: DEFAULT_SETUP_FONT_FAMILY }]);
      expect(() => beginFontAwareRender(resolveRequestFonts({}))).not.toThrow();
    });

    it('should reject rendering while setup is pending', async () => {
      const pending = setupFonts([regular]);

      await expectSetupError(render(), ErrorType.IMAGE_ERROR, 'still in progress');
      await expectSetupError(
        generatePreviewFromMetadata({ title: 'Title', url: 'https://example.com' }),
        ErrorType.IMAGE_ERROR,
        'still in progress'
      );
      await pending;
      await expect(render()).resolves.toBeInstanceOf(Buffer);
    });

    it('should keep rendering blocked after a failed native setup', async () => {
      (globalThis as unknown as Record<symbol, unknown>)[STATE_KEY] = {
        phase: 'failed',
        renderStarted: false,
      };

      await expectSetupError(render(), ErrorType.IMAGE_ERROR, 'could not be verified');
      await expectSetupError(setupFonts([regular]), ErrorType.IMAGE_ERROR, 'could not be verified');
    });
  });
});
