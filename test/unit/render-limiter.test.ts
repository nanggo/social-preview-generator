import {
  acquireImagePreparationSlot,
  acquireRenderSlot,
  getRenderLimiterStats,
  resetRenderLimiterForTests,
  withPreparedRenderSlot,
  withRenderSlot,
} from '../../src/utils/render-limiter';
import { ErrorType, PreviewGeneratorError } from '../../src/types';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
  }
}

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
    await expect(acquireRenderSlot()).rejects.toBeInstanceOf(PreviewGeneratorError);
    await expect(acquireRenderSlot()).rejects.toMatchObject({ type: ErrorType.IMAGE_ERROR });

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

  it('bounds image preparation before buffers can wait for render admission', async () => {
    const preparationWork = Array.from({ length: 5 }, () => deferred());
    const started: number[] = [];
    const operations = preparationWork.map((work, index) =>
      withPreparedRenderSlot(
        async () => {
          started.push(index);
          await work.promise;
          return index;
        },
        async prepared => prepared
      )
    );

    await flushMicrotasks();
    expect(started).toEqual([0, 1, 2, 3]);
    expect(getRenderLimiterStats()).toMatchObject({ preparing: 4, preparationQueued: 1 });

    preparationWork[0].resolve();
    await expect(operations[0]).resolves.toBe(0);
    await flushMicrotasks();
    expect(started).toEqual([0, 1, 2, 3, 4]);

    for (const work of preparationWork.slice(1)) {
      work.resolve();
    }
    await Promise.all(operations.slice(1));
  });

  it('holds preparation admission until a render slot is acquired', async () => {
    const activeRenderReleases = await Promise.all(
      Array.from({ length: 4 }, () => acquireRenderSlot())
    );
    const renderWork = deferred();
    let renderStarted = false;
    const operation = withPreparedRenderSlot(
      async () => 'prepared',
      async prepared => {
        renderStarted = true;
        await renderWork.promise;
        return prepared;
      }
    );

    try {
      await flushMicrotasks();
      expect(renderStarted).toBe(false);
      expect(getRenderLimiterStats()).toMatchObject({
        active: 4,
        queued: 1,
        preparing: 1,
        preparationQueued: 0,
      });

      activeRenderReleases[0]();
      await flushMicrotasks();
      expect(renderStarted).toBe(true);
      expect(getRenderLimiterStats()).toMatchObject({ active: 4, preparing: 0 });

      renderWork.resolve();
      await expect(operation).resolves.toBe('prepared');
    } finally {
      renderWork.resolve();
      for (const release of activeRenderReleases) {
        release();
      }
      await Promise.allSettled([operation]);
    }
  });

  it('rejects image preparation overflow as an IMAGE_ERROR promise', async () => {
    const activeReleases = await Promise.all(
      Array.from({ length: 4 }, () => acquireImagePreparationSlot())
    );
    const queued = Array.from({ length: 32 }, () => acquireImagePreparationSlot());

    expect(getRenderLimiterStats()).toMatchObject({ preparing: 4, preparationQueued: 32 });
    await expect(acquireImagePreparationSlot()).rejects.toMatchObject({
      type: ErrorType.IMAGE_ERROR,
    });

    for (const release of activeReleases) {
      release();
    }
    for (const queuedRelease of queued) {
      (await queuedRelease)();
    }
  });
});
