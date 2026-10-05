// Native regression check for setupFonts(): fontconfig is initialized once per
// process, so every scenario runs in a fresh Node process against the built
// package. Results are judged against an independent reference process that
// gets a hand-written fontconfig file and never calls setupFonts().

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const FIXTURE_REVISION = 'f8d157532fbfaeda587e826d4cd5b21a49186f7c';
const FIXTURE_FAMILY = 'Noto Sans KR';
const FIXTURES = [
  {
    name: 'NotoSansKR-Regular.otf',
    sha256: '69975a0ac8472717870aefeab0a4d52739308d90856b9955313b2ad5e0148d68',
  },
  {
    name: 'NotoSansKR-Bold.otf',
    sha256: '5a6ceb287ed2fc6cfc6213144ebea68cbd94b20fc9eb873d8486493bf02d9bda',
  },
];
const CUSTOM_FAMILY = '미리보기 서체';
const VERIFICATION_MESSAGE = 'Font setup could not be verified';
const LATIN_SYSTEM_FONTS = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans.ttf',
];
const TEMPLATES = ['modern', 'classic', 'minimal', 'article'];

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function fetchFixtures() {
  if (process.env.FONT_FIXTURE_DIR) {
    return resolve(process.env.FONT_FIXTURE_DIR);
  }

  const directory = mkdtempSync(join(tmpdir(), 'social-preview-font-fixtures-'));
  for (const fixture of FIXTURES) {
    const response = await fetch(
      `https://raw.githubusercontent.com/notofonts/noto-cjk/${FIXTURE_REVISION}/Sans/SubsetOTF/KR/${fixture.name}`
    );
    if (!response.ok) {
      throw new Error(`Could not download ${fixture.name}: HTTP ${response.status}`);
    }
    writeFileSync(join(directory, fixture.name), Buffer.from(await response.arrayBuffer()));
  }
  return directory;
}

function verifyFixtures(directory) {
  for (const fixture of FIXTURES) {
    const actual = sha256(readFileSync(join(directory, fixture.name)));
    if (actual !== fixture.sha256) {
      throw new Error(`Fixture ${fixture.name} has unexpected SHA-256 ${actual}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Scenario processes
// ---------------------------------------------------------------------------

function specimenSvg(family) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="320">
  <rect width="100%" height="100%" fill="#fff"/>
  <text x="20" y="70" font-size="48" font-weight="400" font-family="'${family}'">가각한글힣 Regular 123</text>
  <text x="20" y="150" font-size="48" font-weight="700" font-family="'${family}'">가각한글힣 Bold 123</text>
  <text x="20" y="230" font-size="48" font-family="sans-serif">가각한글힣 sans-serif 123</text>
  <text x="20" y="300" font-size="48" font-family="'${family}', sans-serif">한글 Mixed 한글</text>
</svg>`;
}

async function pixelDigest(sharp, input) {
  const { data, info } = await sharp(input).raw().toBuffer({ resolveWithObject: true });
  return `${info.width}x${info.height}:${sha256(data)}`;
}

async function renderEverything(library, sharp, family, fonts) {
  const metadata = {
    title: '한글 미리보기 제목 Preview Title',
    description: '설명 문장입니다. Description text.',
    siteName: '블로그',
    url: 'https://example.com/posts/font-check',
  };
  const digests = { specimen: await pixelDigest(sharp, Buffer.from(specimenSvg(family))) };

  for (const template of TEMPLATES) {
    digests[template] = await pixelDigest(
      sharp,
      await library.generatePreviewFromMetadata(metadata, { template, ...fonts })
    );
  }
  digests.defaultOverlay = await pixelDigest(
    sharp,
    await library.generateImageWithTemplate(
      metadata,
      { name: 'custom', layout: { padding: 60 }, typography: { title: { fontSize: 48 } } },
      { ...fonts }
    )
  );

  const concurrent = await Promise.all(
    Array.from({ length: 16 }, () => pixelDigest(sharp, Buffer.from(specimenSvg(family))))
  );
  digests.concurrent = [...new Set(concurrent)].join(',');
  return digests;
}

async function expectRejection(operation) {
  try {
    await operation();
  } catch (error) {
    return { type: error?.type, message: String(error?.message) };
  }
  return { type: 'resolved', message: '' };
}

async function runScenario(name, fixtureDirectory) {
  const library = require(join(repositoryRoot, 'dist', 'index.js'));
  const sharp = require('sharp');
  const files = FIXTURES.map((fixture) => join(fixtureDirectory, fixture.name));
  const textSvg = Buffer.from(specimenSvg('sans-serif'));
  const renderText = () => sharp(textSvg).png().toBuffer();
  const previewAfterFailure = () =>
    expectRejection(() =>
      library.generatePreviewFromMetadata({ title: 'Title', url: 'https://example.com' })
    );

  switch (name) {
    case 'reference':
      return renderEverything(library, sharp, FIXTURE_FAMILY, {
        fonts: [{ family: FIXTURE_FAMILY }],
      });
    case 'unconfigured':
      return { specimen: await pixelDigest(sharp, Buffer.from(specimenSvg(FIXTURE_FAMILY))) };
    case 'early': {
      await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
        .png()
        .toBuffer();
      await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>'))
        .png()
        .toBuffer();
      const [font] = await library.setupFonts(files);
      return renderEverything(library, sharp, font.family, {});
    }
    case 'early-custom-family': {
      const [font] = await library.setupFonts(files, { family: CUSTOM_FAMILY });
      return renderEverything(library, sharp, font.family, {});
    }
    case 'latin-only': {
      // A font without Hangul must still verify (through the Latin probe glyph).
      const latinFont = LATIN_SYSTEM_FONTS.find((file) => existsSync(file));
      if (!latinFont) {
        return { skipped: true };
      }
      return { fonts: await library.setupFonts([latinFont]) };
    }
    case 'same-name-damaged': {
      // Only damaged files, registered under the name of an installed family:
      // the installed font must not be mistaken for the supplied files.
      if (!LATIN_SYSTEM_FONTS.some((file) => existsSync(file))) {
        return { skipped: true };
      }
      const damaged = join(mkdtempSync(join(tmpdir(), 'social-preview-font-damaged-')), 'Bad.ttf');
      writeFileSync(damaged, Buffer.concat([Buffer.from('00010000', 'hex'), Buffer.alloc(4096, 7)]));
      return {
        setup: await expectRejection(() => library.setupFonts([damaged], { family: 'DejaVu Sans' })),
        preview: await previewAfterFailure(),
      };
    }
    case 'late-svg':
      await renderText();
      break;
    case 'late-svg16':
      await Promise.all(Array.from({ length: 16 }, renderText));
      break;
    case 'late-text-input':
      await sharp({ text: { text: 'hello' } }).png().toBuffer();
      break;
    case 'late-library':
      await library.generatePreviewFromMetadata({ title: 'Title', url: 'https://example.com' });
      return { setup: await expectRejection(() => library.setupFonts(files)) };
    case 'user-config': {
      // FONTCONFIG_FILE / FONTCONFIG_PATH were set by the user before startup.
      const [font] = await library.setupFonts(files);
      return { specimen: await pixelDigest(sharp, Buffer.from(specimenSvg(font.family))) };
    }
    case 'bold-only': {
      const [font] = await library.setupFonts([files[1]]);
      return { specimen: await pixelDigest(sharp, Buffer.from(specimenSvg(font.family))) };
    }
    case 'inherited-different-parent':
      // The child registers different files under the same default family.
      await library.setupFonts([files[0]]);
      return { child: await spawnScenario('bold-only', fixtureDirectory, process.env) };
    case 'inherited-parent': {
      await library.setupFonts(files);
      return {
        early: await spawnScenario('early', fixtureDirectory, process.env),
        late: await spawnScenario('late-svg', fixtureDirectory, process.env),
      };
    }
    default:
      throw new Error(`Unknown scenario: ${name}`);
  }

  return {
    setup: await expectRejection(() => library.setupFonts(files)),
    preview: await previewAfterFailure(),
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function spawnScenario(name, fixtureDirectory, env) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [scriptPath, '--scenario', name, fixtureDirectory],
    { env, maxBuffer: 1024 * 1024 }
  );
  return JSON.parse(stdout.trim().split('\n').at(-1));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertSameDigests(label, actual, reference) {
  for (const [key, value] of Object.entries(reference)) {
    assert(actual[key] === value, `${label}: ${key} differs from the reference render`);
  }
  assert(!actual.concurrent.includes(','), `${label}: concurrent renders were not identical`);
}

function assertVerificationFailure(label, result) {
  assert(
    result.setup.type === 'IMAGE_ERROR' && result.setup.message.includes(VERIFICATION_MESSAGE),
    `${label}: late setupFonts was not rejected (${JSON.stringify(result.setup)})`
  );
  assert(
    result.preview.type === 'IMAGE_ERROR',
    `${label}: rendering continued after a failed setup (${JSON.stringify(result.preview)})`
  );
}

async function main() {
  if (process.platform !== 'linux') {
    console.log('Font setup verification is Linux only; skipped on this platform.');
    return;
  }

  const fixtureDirectory = await fetchFixtures();
  verifyFixtures(fixtureDirectory);

  const baseEnv = { ...process.env };
  delete baseEnv.FONTCONFIG_FILE;
  const run = (name, env = baseEnv) => spawnScenario(name, fixtureDirectory, env);

  const referenceDirectory = mkdtempSync(join(tmpdir(), 'social-preview-font-reference-'));
  mkdirSync(join(referenceDirectory, 'cache'));
  const referenceConfig = join(referenceDirectory, 'fonts.conf');
  writeFileSync(
    referenceConfig,
    `<?xml version="1.0"?>
<fontconfig>
  <cachedir>${join(referenceDirectory, 'cache')}</cachedir>
  <include ignore_missing="yes">fonts.conf</include>
  <dir>${fixtureDirectory}</dir>
</fontconfig>
`
  );

  const reference = await run('reference', { ...baseEnv, FONTCONFIG_FILE: referenceConfig });
  assert(!reference.concurrent.includes(','), 'reference: concurrent renders were not identical');

  const unconfigured = await run('unconfigured');
  assert(
    unconfigured.specimen !== reference.specimen,
    'This environment already renders the fixture family; the check would prove nothing'
  );

  assertSameDigests('early setup', await run('early'), reference);
  assertSameDigests('custom family', await run('early-custom-family'), reference);

  const latinOnly = await run('latin-only');
  assert(
    latinOnly.skipped || latinOnly.fonts?.length === 1,
    `latin-only: setupFonts rejected a font without Hangul (${JSON.stringify(latinOnly)})`
  );

  const sameNameDamaged = await run('same-name-damaged');
  if (!sameNameDamaged.skipped) {
    assertVerificationFailure('same-name-damaged', sameNameDamaged);
  }

  for (const name of ['late-svg', 'late-svg16', 'late-text-input']) {
    assertVerificationFailure(name, await run(name));
  }

  const lateLibrary = await run('late-library');
  assert(
    lateLibrary.setup.type === 'IMAGE_ERROR' &&
      lateLibrary.setup.message.includes('before the first preview'),
    `late-library: setupFonts after a preview was not rejected (${JSON.stringify(lateLibrary.setup)})`
  );

  const inherited = await run('inherited-parent');
  assertSameDigests('inherited configuration, early child', inherited.early, reference);
  assertVerificationFailure('inherited configuration, late child', inherited.late);

  // A configuration the user set before startup, by absolute path or by name
  // through FONTCONFIG_PATH, must be built on exactly as fontconfig resolves it.
  for (const env of [
    { FONTCONFIG_FILE: referenceConfig },
    { FONTCONFIG_FILE: 'fonts.conf', FONTCONFIG_PATH: `/nonexistent:${referenceDirectory}` },
  ]) {
    const native = await run('reference', { ...baseEnv, ...env });
    const userConfig = await run('user-config', { ...baseEnv, ...env });
    assert(
      userConfig.specimen === native.specimen,
      `user configuration ${JSON.stringify(env)}: render differs from the native render`
    );
  }

  const boldOnly = await run('bold-only');
  const inheritedDifferent = await run('inherited-different-parent');
  assert(boldOnly.specimen !== reference.specimen, 'bold-only: render matched Regular and Bold');
  assert(
    inheritedDifferent.child.specimen === boldOnly.specimen,
    'inherited configuration: the parent font was used instead of the child font'
  );

  console.log(
    'Font setup passed early, custom-family, late-setup, damaged-file, and inherited-configuration checks against the reference render.'
  );
}

const scenarioIndex = process.argv.indexOf('--scenario');
try {
  if (scenarioIndex === -1) {
    await main();
  } else {
    const result = await runScenario(process.argv[scenarioIndex + 1], process.argv[scenarioIndex + 2]);
    console.log(JSON.stringify(result));
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
