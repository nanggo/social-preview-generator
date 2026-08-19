import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const projectRoot = path.resolve(import.meta.dirname, '..');
const lockfile = await readFile(path.join(projectRoot, 'pnpm-lock.yaml'), 'utf8');

function parseVersion(version) {
  return version.split('.').map(part => Number(part));
}

function isAtLeast(version, minimum) {
  const actual = parseVersion(version);
  const floor = parseVersion(minimum);
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] > floor[index]) return true;
    if (actual[index] < floor[index]) return false;
  }
  return true;
}

function resolvedVersions(packageName) {
  const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^  ${escapedName}@(\\d+\\.\\d+\\.\\d+):$`, 'gm');
  return [...lockfile.matchAll(pattern)].map(match => match[1]);
}

const requirements = [
  ['dompurify', '3.4.13'],
  ['undici', '7.29.0'],
];

for (const [packageName, minimum] of requirements) {
  const versions = resolvedVersions(packageName);
  if (versions.length === 0) {
    throw new Error(`No resolved ${packageName} version found in pnpm-lock.yaml`);
  }
  const unsafe = versions.filter(version => !isAtLeast(version, minimum));
  if (unsafe.length > 0) {
    throw new Error(
      `${packageName} must resolve to >=${minimum}; found ${unsafe.join(', ')}`
    );
  }
  console.log(`${packageName}: ${versions.join(', ')} (minimum ${minimum})`);
}

process.exitCode = 0;
