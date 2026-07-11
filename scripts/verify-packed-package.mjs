import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';

const PACKAGE_NAME = '@nanggo/social-preview';
const EXPECTED_RUNTIME_EXPORTS = [
  'ErrorType',
  'PreviewGeneratorError',
  'clearAllCaches',
  'clearInflightRequests',
  'generateImageWithTemplate',
  'generatePreview',
  'generatePreviewFromMetadata',
  'generatePreviewFromMetadataWithDetails',
  'generatePreviewWithDetails',
  'getCacheStats',
  'getInflightRequestStats',
  'isCacheCleanupRunning',
  'shutdownSharpCaches',
  'startCacheCleanup',
  'stopCacheCleanup',
];
const repositoryRoot = process.cwd();
const temporaryRoot = mkdtempSync(join(tmpdir(), 'social-preview-package-smoke-'));
const consumerDirectory = join(temporaryRoot, 'consumer');
const npmCacheDirectory = join(temporaryRoot, 'npm-cache');
const requireFromVerifier = createRequire(import.meta.url);

function parseArguments(argv) {
  let outputPath;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--') {
      continue;
    }
    if (argument !== '--output') {
      throw new Error(`Unknown argument: ${argument}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error('Missing value for --output');
    }

    outputPath = resolve(repositoryRoot, value);
    index += 1;
  }

  return { outputPath };
}

function collectTypeScriptSources(directory) {
  const sourcePaths = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      sourcePaths.push(...collectTypeScriptSources(absolutePath));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      sourcePaths.push(relative(join(repositoryRoot, 'src'), absolutePath).replaceAll('\\', '/'));
    }
  }

  return sourcePaths;
}

function verifyTarballContents(packResult) {
  const actualPaths = (packResult.files ?? []).map((file) => file.path).sort();
  const expectedPaths = ['LICENSE', 'README.md', 'package.json'];

  for (const sourcePath of collectTypeScriptSources(join(repositoryRoot, 'src'))) {
    const outputBase = `dist/${sourcePath.slice(0, -'.ts'.length)}`;
    expectedPaths.push(`${outputBase}.d.ts`, `${outputBase}.js`);
  }

  expectedPaths.sort();

  const missing = expectedPaths.filter((path) => !actualPaths.includes(path));
  const forbidden = actualPaths.filter((path) => !expectedPaths.includes(path));

  if (missing.length > 0 || forbidden.length > 0) {
    const messages = [];
    if (missing.length > 0) {
      messages.push(`missing files: ${missing.join(', ')}`);
    }
    if (forbidden.length > 0) {
      messages.push(`unexpected or forbidden files: ${forbidden.join(', ')}`);
    }
    throw new Error(`Packed tarball contents are invalid (${messages.join('; ')})`);
  }
}

function verifyRuntimeExports(packageExports) {
  const actualExports = Object.keys(packageExports).sort();
  const expectedExports = [...EXPECTED_RUNTIME_EXPORTS].sort();

  if (JSON.stringify(actualExports) !== JSON.stringify(expectedExports)) {
    throw new Error(
      `Packed package runtime exports changed: expected ${expectedExports.join(', ')}, received ${actualExports.join(', ')}`
    );
  }

  for (const exportName of expectedExports) {
    const expectedType = exportName === 'ErrorType' ? 'object' : 'function';
    if (typeof packageExports[exportName] !== expectedType) {
      throw new Error(`Packed package export ${exportName} must be a ${expectedType}`);
    }
  }
}

function verifyEsmImport() {
  const esmCheck = `
    const packageExports = await import(${JSON.stringify(PACKAGE_NAME)});
    for (const exportName of ${JSON.stringify(EXPECTED_RUNTIME_EXPORTS)}) {
      if (!(exportName in packageExports)) {
        throw new Error('ESM import is missing ' + exportName);
      }
    }
  `;

  execFileSync(process.execPath, ['--input-type=module', '--eval', esmCheck], {
    cwd: consumerDirectory,
    stdio: 'inherit',
  });
}

function verifyTypeScriptConsumer() {
  const nodeTypesRoot = dirname(dirname(requireFromVerifier.resolve('@types/node/package.json')));
  const typescriptEntrypoint = requireFromVerifier.resolve('typescript');
  const tscPath = join(dirname(typescriptEntrypoint), '..', 'bin', 'tsc');

  writeFileSync(
    join(consumerDirectory, 'consumer.ts'),
    `
      import {
        ErrorType,
        PreviewGeneratorError,
        generateImageWithTemplate,
        generatePreviewFromMetadata,
        generatePreviewWithDetails,
        type ExtractedMetadata,
        type GeneratedPreview,
        type PreviewMetadataInput,
        type PreviewOptions,
        type TemplateConfig,
      } from '${PACKAGE_NAME}';

      const metadata: PreviewMetadataInput = {
        title: 'TypeScript package smoke',
        url: 'https://example.com/typescript-smoke',
      };
      const options: PreviewOptions = { width: 320, height: 168, template: 'minimal' };
      const extracted: ExtractedMetadata = metadata;
      const template: TemplateConfig = {
        name: 'consumer-smoke',
        layout: { padding: 20 },
        typography: { title: { fontSize: 32 } },
      };
      const typedError: PreviewGeneratorError = new PreviewGeneratorError(
        ErrorType.VALIDATION_ERROR,
        'consumer smoke'
      );
      const rendered: Promise<Buffer> = generatePreviewFromMetadata(metadata, options);
      const detailed: Promise<GeneratedPreview> = generatePreviewWithDetails(metadata.url, options);
      const custom: Promise<Buffer> = generateImageWithTemplate(extracted, template, options);
      void rendered;
      void detailed;
      void custom;
      void typedError;
    `
  );
  writeFileSync(
    join(consumerDirectory, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        esModuleInterop: true,
        module: 'Node16',
        moduleResolution: 'Node16',
        noEmit: true,
        skipLibCheck: false,
        strict: true,
        target: 'ES2022',
        typeRoots: [nodeTypesRoot],
        types: ['node'],
      },
      include: ['consumer.ts'],
    })
  );

  execFileSync(process.execPath, [tscPath, '--project', join(consumerDirectory, 'tsconfig.json')], {
    cwd: consumerDirectory,
    stdio: 'inherit',
  });
}

const { outputPath } = parseArguments(process.argv.slice(2));
let packageExports;

try {
  const packOutput = execFileSync(
    'npm',
    ['pack', '--json', '--pack-destination', temporaryRoot, '--cache', npmCacheDirectory],
    { encoding: 'utf8' }
  );
  const packResults = JSON.parse(packOutput);
  const packResult = packResults[0];
  const packageFilename = packResult?.filename;

  if (packResults.length !== 1 || !packageFilename) {
    throw new Error('npm pack did not return exactly one package filename');
  }

  verifyTarballContents(packResult);

  mkdirSync(consumerDirectory);
  writeFileSync(
    join(consumerDirectory, 'package.json'),
    JSON.stringify({ name: 'social-preview-package-smoke', private: true })
  );
  execFileSync(
    'npm',
    [
      'install',
      '--prefix',
      consumerDirectory,
      '--omit=dev',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--cache',
      npmCacheDirectory,
      join(temporaryRoot, basename(packageFilename)),
    ],
    { stdio: 'inherit' }
  );

  const requireFromConsumer = createRequire(join(consumerDirectory, 'package.json'));
  packageExports = requireFromConsumer(PACKAGE_NAME);
  verifyRuntimeExports(packageExports);
  verifyEsmImport();

  const image = await packageExports.generatePreviewFromMetadata(
    {
      title: 'Packed package render smoke',
      url: 'https://example.com/package-smoke',
    },
    { cache: false, height: 168, template: 'minimal', width: 320 }
  );
  const sharp = requireFromConsumer('sharp');
  const imageMetadata = await sharp(image).metadata();

  if (!Buffer.isBuffer(image) || imageMetadata.format !== 'jpeg') {
    throw new Error('Packed package did not render a JPEG buffer');
  }
  if (imageMetadata.width !== 320 || imageMetadata.height !== 168) {
    throw new Error(
      `Packed package rendered ${imageMetadata.width}x${imageMetadata.height}; expected 320x168`
    );
  }

  verifyTypeScriptConsumer();

  if (outputPath) {
    mkdirSync(dirname(outputPath), { recursive: true });
    copyFileSync(join(temporaryRoot, basename(packageFilename)), outputPath);
  }

  console.log(
    'Packed package passed tarball, CJS/ESM import, runtime export, 320x168 JPEG, and TypeScript consumer checks.'
  );
  if (outputPath) {
    console.log(`Verified tarball written to ${outputPath}.`);
  }
} finally {
  packageExports?.stopCacheCleanup?.();
  rmSync(temporaryRoot, { force: true, recursive: true });
}
