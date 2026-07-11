import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const temporaryRoot = mkdtempSync(join(tmpdir(), 'social-preview-package-smoke-'));
const consumerDirectory = join(temporaryRoot, 'consumer');
const npmCacheDirectory = join(temporaryRoot, 'npm-cache');

try {
  const packOutput = execFileSync(
    'npm',
    ['pack', '--json', '--pack-destination', temporaryRoot, '--cache', npmCacheDirectory],
    { encoding: 'utf8' }
  );
  const packResult = JSON.parse(packOutput);
  const packageFilename = packResult[0]?.filename;

  if (!packageFilename) {
    throw new Error('npm pack did not return a package filename');
  }

  mkdirSync(consumerDirectory);
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
  const packageExports = requireFromConsumer('@nanggo/social-preview');

  if (typeof packageExports.generatePreview !== 'function') {
    throw new Error('Packed package did not expose generatePreview');
  }

  console.log('Packed package imported successfully from a production-only install.');
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
