import { vi } from 'vitest';

const sharpMockState = vi.hoisted(() => {
  const instances: Array<{
    timeout: ReturnType<typeof vi.fn>;
    withMetadata: ReturnType<typeof vi.fn>;
  }> = [];

  const sharp = vi.fn(() => {
    const instance = {
      timeout: vi.fn(),
      withMetadata: vi.fn(),
    };
    instance.timeout.mockReturnValue(instance);
    instance.withMetadata.mockReturnValue(instance);
    instances.push(instance);
    return instance;
  });

  return { sharp, instances };
});

vi.mock('sharp', () => ({ default: sharpMockState.sharp }));

import {
  createSecureSharpInstance,
  createSecureSharpWithCleanMetadata,
  withSecureSharp,
  withSecureSharpCleanMetadata,
} from '../../src/utils/image-security';
import {
  clearAllCaches,
  createCachedCanvas,
  createCachedSVG,
} from '../../src/utils/sharp-cache';
import { createTransparentCanvas } from '../../src/utils/validators/canvas';
import { isSharpProcessingTimeout } from '../../src/utils/sharp-timeout';
import { ErrorType, PreviewGeneratorError } from '../../src/types';

function expectNativeTimeoutOnEveryCreatedInstance(): void {
  expect(sharpMockState.instances.length).toBeGreaterThan(0);
  for (const instance of sharpMockState.instances) {
    expect(instance.timeout).toHaveBeenCalledOnce();
    expect(instance.timeout).toHaveBeenCalledWith({ seconds: 30 });
  }
}

describe('native Sharp processing timeout', () => {
  beforeEach(() => {
    sharpMockState.sharp.mockClear();
    sharpMockState.instances.length = 0;
    clearAllCaches();
  });

  it('covers every output-capable untrusted raster factory', async () => {
    const buffer = Buffer.from('raster');

    createSecureSharpInstance(buffer);
    await withSecureSharp(buffer, async (instance) => instance);
    createSecureSharpWithCleanMetadata(buffer);
    await withSecureSharpCleanMetadata(buffer, async (instance) => instance);

    expect(sharpMockState.instances).toHaveLength(4);
    expectNativeTimeoutOnEveryCreatedInstance();
  });

  it('covers SVG and canvas cache misses and hits', async () => {
    const svg = '<svg width="1" height="1" xmlns="http://www.w3.org/2000/svg" />';
    const canvasOptions = { colors: { background: '#000000', accent: '#ffffff' } };

    await createCachedSVG(svg);
    await createCachedSVG(svg);
    await createCachedCanvas(320, 168, canvasOptions);
    await createCachedCanvas(320, 168, canvasOptions);

    expect(sharpMockState.instances).toHaveLength(4);
    expectNativeTimeoutOnEveryCreatedInstance();
  });

  it('covers transparent canvas creation', () => {
    createTransparentCanvas(320, 168);

    expect(sharpMockState.instances).toHaveLength(1);
    expectNativeTimeoutOnEveryCreatedInstance();
  });

  it('recognizes native libvips timeouts through wrapped error details', () => {
    const nativeTimeout = new Error('timeout: 27% complete');
    const wrapped = new PreviewGeneratorError(ErrorType.IMAGE_ERROR, 'render failed', nativeTimeout);

    expect(isSharpProcessingTimeout(nativeTimeout)).toBe(true);
    expect(isSharpProcessingTimeout(wrapped)).toBe(true);
    expect(isSharpProcessingTimeout(new Error('network request timed out'))).toBe(false);
  });
});
