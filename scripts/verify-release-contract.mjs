import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_PACKAGE_NAME = '@nanggo/social-preview';
const EXPECTED_REPOSITORY = {
  type: 'git',
  url: 'git+https://github.com/nanggo/social-preview-generator.git',
};
const EXPECTED_EXPORTS = {
  '.': {
    types: './dist/index.d.ts',
    default: './dist/index.js',
  },
};
const EXPECTED_FILES = ['README.md', 'dist'];
const EXPECTED_ENGINES = { node: '^22.13.0 || >=24.0.0' };
const EXPECTED_PUBLISH_CONFIG = { access: 'public' };
const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseArguments(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--') {
      continue;
    }

    if (argument !== '--package-json' && argument !== '--tag') {
      throw new Error(`Unknown argument: ${argument}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}`);
    }

    options[argument.slice(2)] = value;
    index += 1;
  }

  return options;
}

function normalizeForComparison(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeForComparison);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, normalizeForComparison(nestedValue)])
    );
  }

  return value;
}

function isDeepEqual(actual, expected) {
  return (
    JSON.stringify(normalizeForComparison(actual)) ===
    JSON.stringify(normalizeForComparison(expected))
  );
}

export function verifyReleaseContract(manifest, releaseTag) {
  const violations = [];

  if (manifest.name !== EXPECTED_PACKAGE_NAME) {
    violations.push(`package name must be ${EXPECTED_PACKAGE_NAME}`);
  }

  if (typeof manifest.version !== 'string' || !STABLE_SEMVER.test(manifest.version)) {
    violations.push('package version must be a stable x.y.z semantic version');
  }

  if (!releaseTag) {
    violations.push('release tag is required');
  } else if (releaseTag !== `v${manifest.version}`) {
    violations.push(`release tag must exactly match v${manifest.version}`);
  }

  if (!isDeepEqual(manifest.repository, EXPECTED_REPOSITORY)) {
    violations.push(`repository must be ${JSON.stringify(EXPECTED_REPOSITORY)}`);
  }

  if (manifest.main !== 'dist/index.js') {
    violations.push('main must be dist/index.js');
  }

  if (manifest.types !== 'dist/index.d.ts') {
    violations.push('types must be dist/index.d.ts');
  }

  if (!isDeepEqual(manifest.exports, EXPECTED_EXPORTS)) {
    violations.push(`exports must be ${JSON.stringify(EXPECTED_EXPORTS)}`);
  }

  const files = Array.isArray(manifest.files) ? [...manifest.files].sort() : manifest.files;
  if (!isDeepEqual(files, EXPECTED_FILES)) {
    violations.push(`files must contain only ${EXPECTED_FILES.join(' and ')}`);
  }

  if (!isDeepEqual(manifest.engines, EXPECTED_ENGINES)) {
    violations.push(`engines must be ${JSON.stringify(EXPECTED_ENGINES)}`);
  }

  if (!isDeepEqual(manifest.publishConfig, EXPECTED_PUBLISH_CONFIG)) {
    violations.push(`publishConfig must be ${JSON.stringify(EXPECTED_PUBLISH_CONFIG)}`);
  }

  if (manifest.private === true) {
    violations.push('package must not be marked private');
  }

  if (violations.length > 0) {
    throw new Error(`Release contract validation failed:\n- ${violations.join('\n- ')}`);
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));

if (invokedPath === modulePath) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const packageJsonPath = resolve(options['package-json'] ?? 'package.json');
    const releaseTag = options.tag ?? process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME;
    const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

    verifyReleaseContract(manifest, releaseTag);
    console.log(
      `Release contract verified for ${manifest.name}@${manifest.version} (${releaseTag}).`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
