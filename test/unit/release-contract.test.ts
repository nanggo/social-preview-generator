import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const verifierPath = resolve(process.cwd(), 'scripts/verify-release-contract.mjs');
const sourceManifest = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
const matchingTag = `v${sourceManifest.version}`;
const temporaryDirectories: string[] = [];

function cloneManifest(): Record<string, any> {
  return structuredClone(sourceManifest);
}

function writeManifest(manifest: Record<string, any>): string {
  const directory = mkdtempSync(join(tmpdir(), 'social-preview-release-contract-'));
  const packageJsonPath = join(directory, 'package.json');
  temporaryDirectories.push(directory);
  writeFileSync(packageJsonPath, JSON.stringify(manifest));
  return packageJsonPath;
}

function verifyFailure(manifest: Record<string, any>, tag: string) {
  return spawnSync(
    process.execPath,
    [verifierPath, '--package-json', writeManifest(manifest), '--tag', tag],
    { encoding: 'utf8' }
  );
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { force: true, recursive: true });
  }
});

describe('release contract verifier', () => {
  it('accepts the repository package and its matching synthetic tag', () => {
    const packageJsonPath = writeManifest(cloneManifest());

    expect(() =>
      execFileSync(
        process.execPath,
        [verifierPath, '--package-json', packageJsonPath, '--tag', matchingTag],
        { encoding: 'utf8' }
      )
    ).not.toThrow();
  });

  it('can be imported without executing the CLI path', () => {
    const importCheck = `
      process.argv.push('--not-a-verifier-argument');
      const verifier = await import(${JSON.stringify(pathToFileURL(verifierPath).href)});
      verifier.verifyReleaseContract(
        ${JSON.stringify(sourceManifest)},
        ${JSON.stringify(matchingTag)}
      );
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', importCheck], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it.each([
    [
      'a prerelease version',
      (manifest: Record<string, any>) => {
        manifest.version = `${sourceManifest.version}-rc.1`;
      },
      `${matchingTag}-rc.1`,
      'stable x.y.z semantic version',
    ],
    [
      'a tag that does not match the package version',
      (_manifest: Record<string, any>) => {},
      'v999.999.999',
      `release tag must exactly match ${matchingTag}`,
    ],
    [
      'a different package name',
      (manifest: Record<string, any>) => {
        manifest.name = '@nanggo/other-package';
      },
      matchingTag,
      'package name must be @nanggo/social-preview',
    ],
    [
      'a different repository',
      (manifest: Record<string, any>) => {
        manifest.repository.url = 'git+https://github.com/example/fork.git';
      },
      matchingTag,
      'repository must be',
    ],
    [
      'a missing runtime entry point',
      (manifest: Record<string, any>) => {
        manifest.main = 'index.js';
      },
      matchingTag,
      'main must be dist/index.js',
    ],
    [
      'a missing type entry point',
      (manifest: Record<string, any>) => {
        manifest.types = 'index.d.ts';
      },
      matchingTag,
      'types must be dist/index.d.ts',
    ],
    [
      'a changed root export',
      (manifest: Record<string, any>) => {
        manifest.exports['.'].default = './index.js';
      },
      matchingTag,
      'exports must be',
    ],
    [
      'an unsafe published file list',
      (manifest: Record<string, any>) => {
        manifest.files.push('src');
      },
      matchingTag,
      'files must contain only README.md and dist',
    ],
    [
      'non-public publish access',
      (manifest: Record<string, any>) => {
        manifest.publishConfig.access = 'restricted';
      },
      matchingTag,
      'publishConfig must be',
    ],
    [
      'extra publish registry and dist-tag configuration',
      (manifest: Record<string, any>) => {
        manifest.publishConfig.registry = 'https://example.invalid/';
        manifest.publishConfig.tag = 'next';
      },
      matchingTag,
      'publishConfig must be',
    ],
    [
      'a changed Node.js support range',
      (manifest: Record<string, any>) => {
        manifest.engines.node = '>=18';
      },
      matchingTag,
      'engines must be',
    ],
  ])('rejects %s', (_description, mutate, tag, expectedMessage) => {
    const manifest = cloneManifest();
    mutate(manifest);

    const result = verifyFailure(manifest, tag);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(expectedMessage);
  });
});
