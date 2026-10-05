/**
 * Font Setup Module
 * Registers caller-supplied font files with fontconfig once per process, before
 * any text is rendered, and verifies that the configuration is the active one.
 */

import sharp from 'sharp';
import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isMainThread } from 'worker_threads';
import { ErrorType, FontConfig, PreviewGeneratorError, SetupFontsOptions } from '../types';
import { escapeXml } from '../utils';
import { logger } from '../utils/logger';
import { applySharpProcessingTimeout } from '../utils/sharp-timeout';
import { FONT_PROBE_FAMILY_PREFIX, validateFontFamily } from '../utils/validators/fonts';

export const DEFAULT_SETUP_FONT_FAMILY = 'Social Preview Font';

const MAX_FONT_FILES = 64;
const BASE_RECORD_FILE = 'base.json';
const FONT_SIGNATURES: Record<string, string> = {
  '00010000': 'sfnt',
  '4f54544f': 'sfnt',
  '74746366': 'collection',
};

const PROBE_CANVAS_SIZE = 512;
const PROBE_FONT_SIZE = 72;
const PROBE_GLYPHS = ['H', '가'];
const PROBE_ALPHA_THRESHOLD = 16;
const PROBE_MIN_CONTROL_HEIGHT = 24;
const PROBE_MIN_RATIO = 1.8;
const PROBE_MAX_RATIO = 2.2;

const VERIFICATION_FAILURE_MESSAGE =
  'Font setup could not be verified. Restart the process and await setupFonts before any text rendering.';

type FontSetupPhase = 'idle' | 'setting-up' | 'ready' | 'failed';

interface FontSetupState {
  phase: FontSetupPhase;
  renderStarted: boolean;
  requestKey?: string;
  pending?: Promise<readonly FontConfig[]>;
  defaults?: readonly FontConfig[];
}

// Shared across duplicate copies of this module in one process: fontconfig
// state is process-wide, so the guard has to be as well.
const STATE_KEY = Symbol.for('social-preview-generator.font-setup.v1');

function getState(): FontSetupState {
  const holder = globalThis as unknown as Record<symbol, FontSetupState | undefined>;
  let state = holder[STATE_KEY];
  if (!state) {
    state = { phase: 'idle', renderStarted: false };
    holder[STATE_KEY] = state;
  }
  return state;
}

function setupError(type: ErrorType, message: string): PreviewGeneratorError {
  return new PreviewGeneratorError(type, message);
}

function hasXmlInvalidCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code >= 0xfffe) {
      return true;
    }
  }
  return false;
}

export interface ProbeBounds {
  height: number;
  touchesEdge: boolean;
}

/**
 * Build the fontconfig file that keeps the previously effective configuration,
 * adds the staged font directory under one family name, and carries the
 * per-setup marker rule used to prove this file is the one fontconfig loaded.
 */
export function buildFontconfigXml(params: {
  cacheDir: string;
  fontDir: string;
  family: string;
  nonce: string;
  originalConfigFile: string | undefined;
}): string {
  const include = params.originalConfigFile ?? 'fonts.conf';
  for (const value of [params.cacheDir, params.fontDir, include]) {
    if (hasXmlInvalidCharacter(value)) {
      throw setupError(
        ErrorType.IMAGE_ERROR,
        'Font setup paths must not contain control characters'
      );
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <cachedir>${escapeXml(params.cacheDir)}</cachedir>
  <include ignore_missing="${params.originalConfigFile === undefined ? 'yes' : 'no'}">${escapeXml(include)}</include>
  <dir>${escapeXml(params.fontDir)}</dir>
  <match target="scan">
    <test name="file" compare="contains">
      <string>${escapeXml(`${params.fontDir}${path.sep}`)}</string>
    </test>
    <edit name="family" mode="assign">
      <string>${escapeXml(params.family)}</string>
      <string>${probeFamily(params.nonce, 'font')}</string>
    </edit>
  </match>
  <match target="font">
    <test name="family" target="pattern" qual="any" compare="eq">
      <string>${probeFamily(params.nonce, 'active')}</string>
    </test>
    <test name="family" target="font" qual="any" compare="eq">
      <string>${probeFamily(params.nonce, 'font')}</string>
    </test>
    <edit name="pixelsize" mode="assign">
      <times>
        <name target="font">pixelsize</name>
        <double>2</double>
      </times>
    </edit>
  </match>
</fontconfig>
`;
}

// 'font' is a second family name given only to the files staged by this setup,
// so a probe cannot be satisfied by an installed font of the same name or by
// the files of a setup inherited from a parent process.
function probeFamily(nonce: string, kind: 'control' | 'active' | 'font'): string {
  return `${FONT_PROBE_FAMILY_PREFIX}${nonce}_${kind}_0`;
}

/**
 * The marker rule doubles the glyph only when fontconfig loaded this setup's
 * configuration and drew the glyph with one of the staged files, so the verdict
 * does not depend on which other fonts happen to cover the probe glyph.
 */
export function isProbeVerified(
  control: ProbeBounds | undefined,
  active: ProbeBounds | undefined
): boolean {
  if (!control || !active || control.touchesEdge || active.touchesEdge) {
    return false;
  }
  if (control.height < PROBE_MIN_CONTROL_HEIGHT) {
    return false;
  }
  const ratio = active.height / control.height;
  return ratio >= PROBE_MIN_RATIO && ratio <= PROBE_MAX_RATIO;
}

async function renderProbe(
  requestFamily: string,
  fontFamily: string,
  glyph: string
): Promise<ProbeBounds | undefined> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PROBE_CANVAS_SIZE}" height="${PROBE_CANVAS_SIZE}">
  <text x="64" y="320" fill="black" font-size="${PROBE_FONT_SIZE}" font-weight="400" font-family="'${requestFamily}', '${fontFamily}'">${glyph}</text>
</svg>`;
  const { data, info } = await applySharpProcessingTimeout(
    sharp(Buffer.from(svg), {
      density: 72,
      limitInputPixels: PROBE_CANVAS_SIZE * PROBE_CANVAS_SIZE,
    })
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let top = -1;
  let bottom = -1;
  let touchesEdge = false;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + 3] < PROBE_ALPHA_THRESHOLD) {
        continue;
      }
      if (top === -1) {
        top = y;
      }
      bottom = y;
      if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) {
        touchesEdge = true;
      }
    }
  }

  return top === -1 ? undefined : { height: bottom - top + 1, touchesEdge };
}

function normalizeSetupInput(
  files: readonly string[],
  options: SetupFontsOptions | undefined
): { family: string; resolvedFiles: string[] } {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FONT_FILES) {
    throw setupError(
      ErrorType.VALIDATION_ERROR,
      `setupFonts requires an array of 1-${MAX_FONT_FILES} font file paths`
    );
  }
  files.forEach((file: unknown, index) => {
    if (typeof file !== 'string' || file.length === 0) {
      throw setupError(
        ErrorType.VALIDATION_ERROR,
        `Font file at index ${index} must be a non-empty path string`
      );
    }
  });
  if (
    options !== undefined &&
    (options === null || typeof options !== 'object' || Array.isArray(options))
  ) {
    throw setupError(ErrorType.VALIDATION_ERROR, 'setupFonts options must be a plain object');
  }

  return {
    family: validateFontFamily(options?.family ?? DEFAULT_SETUP_FONT_FAMILY),
    resolvedFiles: files.map((file) => path.resolve(file)),
  };
}

/**
 * Screen the supplied files by extension and container signature. This is a
 * format screen, not font validation.
 */
async function resolveFontFiles(resolvedFiles: readonly string[]): Promise<string[]> {
  const canonicalFiles = new Set<string>();

  for (const [index, file] of resolvedFiles.entries()) {
    let canonical: string;
    let signature: string;
    try {
      canonical = await fs.realpath(file);
      const handle = await fs.open(canonical, 'r');
      try {
        if (!(await handle.stat()).isFile()) {
          throw new Error('not a regular file');
        }
        const header = Buffer.alloc(4);
        await handle.read(header, 0, 4, 0);
        signature = header.toString('hex');
      } finally {
        await handle.close();
      }
    } catch {
      throw setupError(
        ErrorType.VALIDATION_ERROR,
        `Font file at index ${index} is not a readable file`
      );
    }

    const extension = path.extname(canonical).toLowerCase();
    const format = FONT_SIGNATURES[signature];
    if (extension === '.ttc' || extension === '.otc' || format === 'collection') {
      throw setupError(
        ErrorType.VALIDATION_ERROR,
        'Font collections are not supported. Supply individual TTF or OTF files for one typeface and regional variant.'
      );
    }
    if ((extension !== '.ttf' && extension !== '.otf') || format !== 'sfnt') {
      throw setupError(
        ErrorType.VALIDATION_ERROR,
        `Font file at index ${index} is not a supported TTF or OTF file`
      );
    }

    canonicalFiles.add(canonical);
  }

  return [...canonicalFiles];
}

/**
 * The configuration to build on. When FONTCONFIG_FILE is a file generated by an
 * earlier setup (inherited from a parent process), build on what that setup
 * built on, so its staged fonts cannot compete under the same family name.
 */
async function resolveBaseConfigFile(): Promise<string | undefined> {
  const current = process.env.FONTCONFIG_FILE;
  if (current === undefined || !path.isAbsolute(current)) {
    return current;
  }

  try {
    const record: unknown = JSON.parse(
      await fs.readFile(path.join(path.dirname(current), BASE_RECORD_FILE), 'utf8')
    );
    const { generatedConfig, baseConfigFile } = record as Record<string, unknown>;
    if (generatedConfig === path.basename(current)) {
      if (baseConfigFile === null) {
        return undefined;
      }
      if (typeof baseConfigFile === 'string' && baseConfigFile.length > 0) {
        return baseConfigFile;
      }
    }
  } catch {
    // Not a configuration generated by setupFonts.
  }
  return current;
}

async function stageFontconfig(
  family: string,
  fontFiles: readonly string[],
  originalConfigFile: string | undefined
): Promise<{ stagingDir: string; configFile: string; nonce: string }> {
  let stagingDir: string | undefined;
  try {
    stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'social-preview-fonts-'));
    const fontDir = path.join(stagingDir, 'fonts');
    const cacheDir = path.join(stagingDir, 'cache');
    await fs.mkdir(fontDir);
    await fs.mkdir(cacheDir);
    for (const [index, file] of fontFiles.entries()) {
      await fs.symlink(file, path.join(fontDir, `${index}${path.extname(file).toLowerCase()}`));
    }

    const nonce = randomBytes(16).toString('hex');
    const configFile = path.join(stagingDir, `fonts-${nonce}.conf`);
    await fs.writeFile(
      configFile,
      buildFontconfigXml({ cacheDir, fontDir, family, nonce, originalConfigFile })
    );
    await fs.writeFile(
      path.join(stagingDir, BASE_RECORD_FILE),
      JSON.stringify({
        generatedConfig: path.basename(configFile),
        baseConfigFile: originalConfigFile ?? null,
      })
    );
    return { stagingDir, configFile, nonce };
  } catch (error) {
    if (stagingDir) {
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    }
    if (error instanceof PreviewGeneratorError) {
      throw error;
    }
    throw setupError(ErrorType.IMAGE_ERROR, 'Font setup could not stage font files');
  }
}

async function runSetup(
  family: string,
  resolvedFiles: readonly string[],
  onEnvironmentChanged: () => void
): Promise<readonly FontConfig[]> {
  const fontFiles = await resolveFontFiles(resolvedFiles);
  const defaults: readonly FontConfig[] = Object.freeze([Object.freeze({ family })]);

  if (process.platform !== 'linux') {
    // Other platforms keep their host text backend: nothing is registered.
    logger.warn(
      'Custom font files are applied on Linux only; this platform uses host font resolution.'
    );
    return defaults;
  }

  if (process.env.FONTCONFIG_SYSROOT) {
    throw setupError(ErrorType.IMAGE_ERROR, 'setupFonts does not support FONTCONFIG_SYSROOT');
  }
  if (process.env.FONTCONFIG_FILE === '') {
    throw setupError(ErrorType.IMAGE_ERROR, 'setupFonts does not support an empty FONTCONFIG_FILE');
  }
  const originalConfigFile = await resolveBaseConfigFile();

  const { configFile, nonce } = await stageFontconfig(family, fontFiles, originalConfigFile);

  // fontconfig reads this once, when the first text is rendered. From here on
  // a failure cannot be undone inside this process. The staged files are kept
  // for the life of the process (child processes inherit the variable).
  process.env.FONTCONFIG_FILE = configFile;
  onEnvironmentChanged();

  let verified = false;
  try {
    // The marker only applies when a staged file itself draws the glyph, so
    // try a Latin glyph first and Hangul for fonts without Latin.
    for (const glyph of PROBE_GLYPHS) {
      const stagedFamily = probeFamily(nonce, 'font');
      const control = await renderProbe(probeFamily(nonce, 'control'), stagedFamily, glyph);
      const active = await renderProbe(probeFamily(nonce, 'active'), stagedFamily, glyph);
      if (isProbeVerified(control, active)) {
        verified = true;
        break;
      }
    }
  } catch {
    verified = false;
  }
  if (!verified) {
    throw setupError(ErrorType.IMAGE_ERROR, VERIFICATION_FAILURE_MESSAGE);
  }

  return defaults;
}

/**
 * Register font files for all previews generated by this process.
 *
 * Call once at startup, from the main thread, and await it before generating
 * any preview or rendering any other text through sharp. The files are
 * registered under a single family name that is then used by default.
 *
 * Font files are applied on Linux (fontconfig). On other platforms the call
 * validates its input and leaves host font resolution in place.
 *
 * @param files - TTF or OTF files of one typeface (for example Regular and Bold)
 * @param options - Optional family name to register the files under
 * @returns The font configuration used by default for subsequent previews
 */
export async function setupFonts(
  files: readonly string[],
  options?: SetupFontsOptions
): Promise<FontConfig[]> {
  const { family, resolvedFiles } = normalizeSetupInput(files, options);
  const requestKey = JSON.stringify([family, [...new Set(resolvedFiles)].sort()]);
  const state = getState();

  if (state.phase === 'failed') {
    throw setupError(ErrorType.IMAGE_ERROR, VERIFICATION_FAILURE_MESSAGE);
  }
  if (state.phase !== 'idle') {
    if (state.requestKey !== requestKey || !state.pending) {
      throw setupError(
        ErrorType.IMAGE_ERROR,
        'Fonts are already configured for this process with different files or family'
      );
    }
    return (await state.pending).map((font) => ({ ...font }));
  }
  if (!isMainThread) {
    throw setupError(ErrorType.IMAGE_ERROR, 'setupFonts must be called from the main thread');
  }
  if (state.renderStarted) {
    throw setupError(
      ErrorType.IMAGE_ERROR,
      'setupFonts must be awaited before the first preview is generated'
    );
  }

  let environmentChanged = false;
  state.phase = 'setting-up';
  state.requestKey = requestKey;
  state.pending = runSetup(family, resolvedFiles, () => {
    environmentChanged = true;
  }).then(
    (defaults) => {
      state.defaults = defaults;
      state.phase = 'ready';
      return defaults;
    },
    (error: unknown) => {
      state.phase = environmentChanged ? 'failed' : 'idle';
      state.requestKey = undefined;
      state.pending = undefined;
      throw error;
    }
  );

  return (await state.pending).map((font) => ({ ...font }));
}

function assertSetupSettled(state: FontSetupState): void {
  if (state.phase === 'setting-up') {
    throw setupError(
      ErrorType.IMAGE_ERROR,
      'Font setup is still in progress. Await setupFonts before generating previews.'
    );
  }
  if (state.phase === 'failed') {
    throw setupError(ErrorType.IMAGE_ERROR, VERIFICATION_FAILURE_MESSAGE);
  }
}

// Setup phase observed when a request resolved its fonts, keyed by its options.
const requestPhases = new WeakMap<object, FontSetupPhase>();

/**
 * Resolve the fonts for a validated render request: the caller's choice, or
 * the family registered by setupFonts(). Rejects while setup is pending or
 * failed. This does not count as rendering yet, so a request that is rejected
 * later (for example by URL or image security checks) leaves setup possible.
 */
export function resolveRequestFonts<T extends { fonts?: FontConfig[] }>(options: T): T {
  const state = getState();
  assertSetupSettled(state);

  const resolved =
    options.fonts === undefined && state.defaults
      ? { ...options, fonts: state.defaults.map((font) => ({ ...font })) }
      : { ...options };
  requestPhases.set(resolved, state.phase);
  return resolved;
}

/**
 * Whether this library has started rendering text in this process.
 */
export function hasFontAwareRenderStarted(): boolean {
  return getState().renderStarted;
}

/**
 * Mark the start of text rendering for a request. From here on a first setup
 * is no longer possible. A request whose fonts were resolved before setup ran
 * is rejected rather than rendered with stale fonts.
 */
export function beginFontAwareRender(options: object): void {
  const state = getState();
  assertSetupSettled(state);

  const requestPhase = requestPhases.get(options);
  if (requestPhase !== undefined && requestPhase !== state.phase) {
    throw setupError(
      ErrorType.IMAGE_ERROR,
      'Font setup completed while this preview was being prepared. Await setupFonts before generating previews.'
    );
  }
  state.renderStarted = true;
}
