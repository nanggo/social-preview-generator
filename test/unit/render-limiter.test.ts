import {
  acquireRenderSlot,
  getRenderLimiterStats,
  resetRenderLimiterForTests,
  withRenderSlot,
} from '../../src/utils/render-limiter';
import { ErrorType, PreviewGeneratorError } from '../../src/types';

describe('process-wide render limiter', () => {
  beforeEach(() => {
    resetRenderLimiterForTests();
  });

  afterEach(() => {
    expect(getRenderLimiterStats()).toMatchObject({ active: 0, queued: 0 });
    resetRenderLimiterForTests();
  });

  it('runs at most four renders and admits queued work in FIFO order', async () => {
    const activeReleases = await Promise.all(Array.from({ length: 4 }, () => acquireRenderSlot()));
    const admitted: number[] = [];
    const queued = [0, 1, 2].map((index) =>
      acquireRenderSlot().then((release) => {
        admitted.push(index);
        return release;
      })
    );

    expect(getRenderLimiterStats()).toMatchObject({ active: 4, queued: 3 });

    activeReleases[0]();
    const queuedRelease0 = await queued[0];
    expect(admitted).toEqual([0]);

    activeReleases[1]();
    const queuedRelease1 = await queued[1];
    expect(admitted).toEqual([0, 1]);

    activeReleases[2]();
    const queuedRelease2 = await queued[2];
    expect(admitted).toEqual([0, 1, 2]);
    expect(getRenderLimiterStats()).toMatchObject({ active: 4, queued: 0 });

    activeReleases[3]();
    queuedRelease0();
    queuedRelease1();
    queuedRelease2();
  });

  it('fails fast with IMAGE_ERROR after 32 queued renders', async () => {
    const activeReleases = await Promise.all(Array.from({ length: 4 }, () => acquireRenderSlot()));
    const queued = Array.from({ length: 32 }, () => acquireRenderSlot());

    expect(getRenderLimiterStats()).toMatchObject({ active: 4, queued: 32 });
    expect(() => acquireRenderSlot()).toThrowError(PreviewGeneratorError);

    try {
      acquireRenderSlot();
    } catch (error) {
      expect(error).toMatchObject({ type: ErrorType.IMAGE_ERROR });
    }

    for (const release of activeReleases) {
      release();
    }
    for (const queuedRelease of queued) {
      (await queuedRelease)();
    }
  });

  it('releases slots after both success and failure', async () => {
    await expect(withRenderSlot(async () => 'done')).resolves.toBe('done');
    expect(getRenderLimiterStats()).toMatchObject({ active: 0, queued: 0 });

    await expect(
      withRenderSlot(async () => {
        throw new Error('native failure');
      })
    ).rejects.toThrow('native failure');
    expect(getRenderLimiterStats()).toMatchObject({ active: 0, queued: 0 });
  });
});
