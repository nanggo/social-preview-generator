import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __testNetworkRequestLimiter,
  NetworkRequestDeadlineError,
  NetworkRequestQueueFullError,
  runControlledNetworkRequest,
} from '../../src/utils/network-request-control';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const limiter = __testNetworkRequestLimiter!;

describe('network request control', () => {
  afterEach(() => {
    limiter.reset();
    vi.useRealTimers();
  });

  it('aborts and rejects a pending transport at the total wall-clock deadline', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const lateTransport = deferred();

    const request = runControlledNetworkRequest(25, undefined, signal => {
      requestSignal = signal;
      // Deliberately ignore AbortSignal to verify the controller still settles
      // the caller and returns the limiter permit.
      return lateTransport.promise;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(limiter.getStats()).toMatchObject({ active: 1, queued: 0 });

    const rejected = expect(request).rejects.toBeInstanceOf(NetworkRequestDeadlineError);
    await vi.advanceTimersByTimeAsync(25);

    await rejected;
    expect(requestSignal?.aborted).toBe(true);
    expect(limiter.getStats()).toMatchObject({ active: 0, queued: 0 });
    expect(vi.getTimerCount()).toBe(0);

    // A transport that rejects after the deadline must stay handled.
    lateTransport.reject(new Error('late transport rejection'));
    await vi.advanceTimersByTimeAsync(0);
  });

  it('preserves the deadline reason when a transport rejects with a generic cancel error', async () => {
    vi.useFakeTimers();

    const request = runControlledNetworkRequest(25, undefined, signal =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('canceled')), { once: true });
      })
    );
    await vi.advanceTimersByTimeAsync(0);

    const rejected = expect(request).rejects.toBeInstanceOf(NetworkRequestDeadlineError);
    await vi.advanceTimersByTimeAsync(25);

    await rejected;
    expect(limiter.getStats()).toMatchObject({ active: 0, queued: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates caller abort and always removes the caller listener', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const callerReason = new Error('caller canceled network request');
    const removeListener = vi.spyOn(caller.signal, 'removeEventListener');

    const request = runControlledNetworkRequest(1000, caller.signal, signal =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('canceled')), { once: true });
      })
    );
    await vi.advanceTimersByTimeAsync(0);

    const rejected = expect(request).rejects.toBe(callerReason);
    caller.abort(callerReason);

    await rejected;
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(limiter.getStats()).toMatchObject({ active: 0, queued: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans the deadline timer and caller listener after success', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, 'removeEventListener');

    await expect(
      runControlledNetworkRequest(1000, caller.signal, async () => 'ok')
    ).resolves.toBe('ok');

    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(limiter.getStats()).toMatchObject({ active: 0, queued: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases permits on success and failure and starts queued work in FIFO order', async () => {
    vi.useFakeTimers();
    const activeWork = Array.from({ length: 50 }, () => deferred());
    const startOrder: string[] = [];

    const activeRequests = activeWork.map((work, index) =>
      runControlledNetworkRequest(60_000, undefined, async () => {
        startOrder.push(`active-${index}`);
        await work.promise;
      })
    );
    await vi.advanceTimersByTimeAsync(0);

    const queuedA = runControlledNetworkRequest(60_000, undefined, async () => {
      startOrder.push('queued-a');
      return 'a';
    });
    const queuedB = runControlledNetworkRequest(60_000, undefined, async () => {
      startOrder.push('queued-b');
      throw new Error('expected queued failure');
    });
    void queuedB.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);

    expect(limiter.getStats()).toMatchObject({ active: 50, queued: 2 });

    activeWork[0].resolve();
    await vi.advanceTimersByTimeAsync(0);

    await expect(queuedA).resolves.toBe('a');
    await expect(queuedB).rejects.toThrow('expected queued failure');
    expect(startOrder.slice(-2)).toEqual(['queued-a', 'queued-b']);
    expect(limiter.getStats()).toMatchObject({ active: 49, queued: 0 });

    for (const work of activeWork.slice(1)) {
      work.resolve();
    }
    await Promise.all(activeRequests);

    expect(limiter.getStats()).toMatchObject({ active: 0, queued: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes an aborted queued request without consuming a permit', async () => {
    vi.useFakeTimers();
    const activeWork = Array.from({ length: 50 }, () => deferred());
    const activeRequests = activeWork.map(work =>
      runControlledNetworkRequest(60_000, undefined, async () => work.promise)
    );
    await vi.advanceTimersByTimeAsync(0);

    const caller = new AbortController();
    const queued = runControlledNetworkRequest(60_000, caller.signal, async () => 'never');
    await vi.advanceTimersByTimeAsync(0);
    expect(limiter.getStats()).toMatchObject({ active: 50, queued: 1 });

    const rejected = queued.catch(error => error);
    caller.abort();
    await expect(rejected).resolves.toBe(caller.signal.reason);
    expect(limiter.getStats()).toMatchObject({ active: 50, queued: 0 });

    for (const work of activeWork) {
      work.resolve();
    }
    await Promise.all(activeRequests);
    expect(limiter.getStats()).toMatchObject({ active: 0, queued: 0 });
  });

  it('bounds the FIFO queue at 1000 requests and fails overflow immediately', async () => {
    vi.useFakeTimers();
    const activeWork = Array.from({ length: 50 }, () => deferred());
    const activeRequests = activeWork.map(work =>
      runControlledNetworkRequest(60_000, undefined, async () => work.promise)
    );
    await vi.advanceTimersByTimeAsync(0);

    const queuedRequests = Array.from({ length: 1000 }, () =>
      runControlledNetworkRequest(60_000, undefined, async () => undefined)
    );
    for (const request of queuedRequests) {
      void request.catch(() => undefined);
    }
    await vi.advanceTimersByTimeAsync(0);

    expect(limiter.getStats()).toEqual({
      active: 50,
      queued: 1000,
      activeLimit: 50,
      queuedLimit: 1000,
    });
    await expect(
      runControlledNetworkRequest(60_000, undefined, async () => undefined)
    ).rejects.toBeInstanceOf(NetworkRequestQueueFullError);

    limiter.reset();
    await Promise.allSettled(queuedRequests);
    for (const work of activeWork) {
      work.resolve();
    }
    await Promise.all(activeRequests);
    expect(limiter.getStats()).toMatchObject({ active: 0, queued: 0 });
  });
});
