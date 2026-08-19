import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  findActionPinViolations,
  isImmutableActionReference,
} from '../../scripts/verify-action-pins.mjs';

describe('GitHub Action pin verifier', () => {
  it('accepts only immutable remote references', () => {
    expect(isImmutableActionReference('./.github/actions/local')).toBe(true);
    expect(
      isImmutableActionReference(`actions/checkout@${'a'.repeat(40)}`)
    ).toBe(true);
    expect(
      isImmutableActionReference(`docker://alpine@sha256:${'b'.repeat(64)}`)
    ).toBe(true);

    expect(isImmutableActionReference('actions/checkout@v7')).toBe(false);
    expect(isImmutableActionReference(`actions/checkout@${'a'.repeat(39)}`)).toBe(false);
    expect(isImmutableActionReference(`actions/checkout@${'a'.repeat(41)}`)).toBe(false);
    expect(isImmutableActionReference(`actions/checkout@${'a'.repeat(40)}#moving`)).toBe(false);
    expect(isImmutableActionReference(`actions/checkout@${'a'.repeat(40)},moving`)).toBe(false);
    expect(isImmutableActionReference('docker://alpine:latest')).toBe(false);
  });

  it('checks workflow and composite-action YAML files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'action-pins-'));
    try {
      await mkdir(path.join(root, '.github', 'workflows'), { recursive: true });
      await mkdir(path.join(root, 'tools', 'build-action'), { recursive: true });
      await writeFile(
        path.join(root, '.github', 'workflows', 'ci.yaml'),
        [
          'jobs:',
          '  reusable:',
          `    uses: owner/reusable@${'c'.repeat(40)}`,
          '  local:',
          '    steps:',
          '      - uses: ./tools/build-action',
          '',
        ].join('\n')
      );
      await writeFile(
        path.join(root, 'tools', 'build-action', 'action.yml'),
        'runs:\n  steps:\n    - uses: actions/setup-node@v7\n'
      );

      await expect(findActionPinViolations(root)).resolves.toEqual([
        'tools/build-action/action.yml:3: actions/setup-node@v7',
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects mutable references in alternate valid YAML forms', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'action-pins-yaml-'));
    try {
      await mkdir(path.join(root, '.github', 'workflows'), { recursive: true });
      await writeFile(
        path.join(root, '.github', 'workflows', 'alternate.yml'),
        [
          'jobs:',
          '  quoted:',
          '    steps:',
          '      - "uses": "actions/checkout@v7"',
          '  spaced:',
          '    steps:',
          '      - uses : actions/setup-node@v7',
          '  flow:',
          '    steps: [{ name: foo#bar, uses: docker://alpine:latest }]',
          '  escaped:',
          '    steps:',
          '      - "u\\u0073es": actions/cache@v4',
          '  single-quoted-flow:',
          "    steps: [{ 'uses' : 'owner/action@v1' }]",
          '  aliased-key:',
          '    action-key: &action-key uses',
          '    steps: [{ *action-key: actions/upload-artifact@v4 }]',
          '  anchored-flow:',
          '    steps:',
          '      - &checkout-step { uses: actions/checkout@v7 }',
          '  named-step:',
          '    steps:',
          '      - name: Checkout',
          '        uses: actions/checkout@v7',
          '  alias-carrier:',
          '    strategy:',
          '      matrix:',
          '        include:',
          '          - &mutable-step { uses: actions/checkout@v7 }',
          '    steps:',
          '      - *mutable-step',
          '  jobs:',
          '    uses: owner/reusable/.github/workflows/ci.yml@main',
          '',
        ].join('\n')
      );

      await expect(findActionPinViolations(root)).resolves.toEqual([
        '.github/workflows/alternate.yml:4: actions/checkout@v7',
        '.github/workflows/alternate.yml:7: actions/setup-node@v7',
        '.github/workflows/alternate.yml:9: docker://alpine:latest',
        '.github/workflows/alternate.yml:12: actions/cache@v4',
        '.github/workflows/alternate.yml:14: owner/action@v1',
        '.github/workflows/alternate.yml:17: <missing or unsupported action reference>',
        '.github/workflows/alternate.yml:20: actions/checkout@v7',
        '.github/workflows/alternate.yml:24: actions/checkout@v7',
        '.github/workflows/alternate.yml:31: <missing or unsupported action reference>',
        '.github/workflows/alternate.yml:33: owner/reusable/.github/workflows/ci.yml@main',
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not treat quoted or block command text as action references', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'action-pins-command-'));
    try {
      await mkdir(path.join(root, '.github', 'workflows'), { recursive: true });
      await writeFile(
        path.join(root, '.github', 'workflows', 'commands.yml'),
        [
          'env:',
          '  uses: actions/checkout@v7',
          'jobs:',
          '  test:',
          '    env:',
          '      uses: actions/setup-node@v7',
          '    steps:',
          '      - run: echo "uses: actions/checkout@v7"',
          '      - run: |',
          '          uses: actions/setup-node@v7',
          '      - run: |2-',
          '          uses: actions/cache@v4',
          '      - env: { uses: actions/upload-artifact@v4 }',
          `      - { uses: actions/checkout@${'d'.repeat(40)} }`,
          '',
        ].join('\n')
      );

      await expect(findActionPinViolations(root)).resolves.toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not truncate block plain references at hash or comma characters', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'action-pins-scalars-'));
    const sha = 'e'.repeat(40);
    try {
      await mkdir(path.join(root, '.github', 'workflows'), { recursive: true });
      await writeFile(
        path.join(root, '.github', 'workflows', 'scalars.yml'),
        [
          'jobs:',
          '  test:',
          '    steps:',
          `      - uses: owner/action@${sha}#moving`,
          `      - uses: owner/action@${sha},moving`,
          `      - { uses: owner/action@${sha}, name: Pinned }`,
          '',
        ].join('\n')
      );

      await expect(findActionPinViolations(root)).resolves.toEqual([
        `.github/workflows/scalars.yml:4: owner/action@${sha}#moving`,
        `.github/workflows/scalars.yml:5: owner/action@${sha},moving`,
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed on multiline flow collections that can hide action paths', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'action-pins-multiline-flow-'));
    try {
      await mkdir(path.join(root, '.github', 'workflows'), { recursive: true });
      await writeFile(
        path.join(root, '.github', 'workflows', 'multiline-flow.yml'),
        [
          'jobs: {',
          'test: {',
          'steps: [',
          '{ uses: actions/checkout@v4 }',
          ']}}',
          '',
        ].join('\n')
      );

      await expect(findActionPinViolations(root)).resolves.toContain(
        '.github/workflows/multiline-flow.yml:1: <missing or unsupported action reference>'
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
