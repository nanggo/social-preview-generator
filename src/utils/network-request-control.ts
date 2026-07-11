/**
 * Process-wide controls for outbound HTML and image requests.
 *
 * The secure HTTP agents bound sockets per origin. This limiter adds a global
 * ceiling so callers cannot bypass the bound by spreading requests over many
 * different origins. The deadline is intentionally separate from Axios'
 * socket-inactivity timeout and covers queue wait plus the complete response.
 */

const MAX_ACTIVE_REQUESTS = 50;
const MAX_QUEUED_REQUESTS = 1000;

type ReleasePermit = () => void;

interface QueueEntry {
  generation: number;
  signal: AbortSignal;
  resolve: (release: ReleasePermit) => void;
  reject: (error: unknown) => void;
  onAbort: () => void;
}

let activeRequests = 0;
let limiterGeneration = 0;
const requestQueue: QueueEntry[] = [];

export class NetworkRequestDeadlineError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Network request deadline exceeded after ${timeoutMs}ms`);
    this.name = 'NetworkRequestDeadlineError';
  }
}

export class NetworkRequestAbortedError extends Error {
  constructor(message: string = 'Network request aborted by caller') {
    super(message);
    this.name = 'NetworkRequestAbortedError';
  }
}

export class NetworkRequestQueueFullError extends Error {
  constructor() {
    super(
      `Network request queue limit reached (${MAX_QUEUED_REQUESTS}). Server is busy, please try again later.`
    );
    this.name = 'NetworkRequestQueueFullError';
  }
}

function signalReason(signal: AbortSignal): unknown {
  return signal.reason ?? new NetworkRequestAbortedError();
}

function createReleasePermit(generation: number): ReleasePermit {
  let released = false;

  return () => {
    if (released) {
      return;
    }
    released = true;

    // A test-only reset invalidates permits from the previous generation.
    if (generation !== limiterGeneration) {
      return;
    }

    activeRequests = Math.max(0, activeRequests - 1);
    drainQueue();
  };
}

function grantPermit(entry: QueueEntry): boolean {
  entry.signal.removeEventListener('abort', entry.onAbort);
  if (entry.signal.aborted || entry.generation !== limiterGeneration) {
    entry.reject(signalReason(entry.signal));
    return false;
  }

  activeRequests += 1;
  entry.resolve(createReleasePermit(entry.generation));
  return true;
}

function drainQueue(): void {
  while (activeRequests < MAX_ACTIVE_REQUESTS && requestQueue.length > 0) {
    const entry = requestQueue.shift();
    if (entry && grantPermit(entry)) {
      // Continue while capacity remains, preserving FIFO order.
      continue;
    }
  }
}

function acquirePermit(signal: AbortSignal): Promise<ReleasePermit> {
  if (signal.aborted) {
    return Promise.reject(signalReason(signal));
  }

  const generation = limiterGeneration;
  if (activeRequests < MAX_ACTIVE_REQUESTS && requestQueue.length === 0) {
    activeRequests += 1;
    return Promise.resolve(createReleasePermit(generation));
  }

  if (requestQueue.length >= MAX_QUEUED_REQUESTS) {
    return Promise.reject(new NetworkRequestQueueFullError());
  }

  return new Promise<ReleasePermit>((resolve, reject) => {
    const entry: QueueEntry = {
      generation,
      signal,
      resolve,
      reject,
      onAbort: () => {
        const index = requestQueue.indexOf(entry);
        if (index !== -1) {
          requestQueue.splice(index, 1);
        }
        signal.removeEventListener('abort', entry.onAbort);
        reject(signalReason(signal));
      },
    };

    requestQueue.push(entry);
    signal.addEventListener('abort', entry.onAbort, { once: true });
  });
}

interface RequestAbortContext {
  signal: AbortSignal;
  aborted: Promise<never>;
  cleanup: () => void;
}

function createRequestAbortContext(
  timeoutMs: number,
  callerSignal?: AbortSignal
): RequestAbortContext {
  const controller = new AbortController();
  let rejectAborted!: (error: unknown) => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAborted = reject;
  });

  const abort = (reason: unknown) => {
    if (controller.signal.aborted) {
      return;
    }
    // Settle the controlled reason before dispatching AbortSignal listeners.
    // Transports such as Axios may synchronously reject with a generic
    // cancellation error from their listener; that must not mask the caller's
    // reason or this deadline error in the surrounding Promise.race.
    rejectAborted(reason);
    controller.abort(reason);
  };

  const onCallerAbort = () => {
    abort(signalReason(callerSignal!));
  };

  if (callerSignal?.aborted) {
    onCallerAbort();
  } else {
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
  }

  const timeoutId = controller.signal.aborted
    ? undefined
    : setTimeout(() => {
        abort(new NetworkRequestDeadlineError(timeoutMs));
      }, timeoutMs);
  timeoutId?.unref?.();

  return {
    signal: controller.signal,
    aborted,
    cleanup: () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      callerSignal?.removeEventListener('abort', onCallerAbort);
    },
  };
}

/**
 * Run one outbound request under a total wall-clock deadline and the shared
 * process-wide concurrency limit.
 */
export async function runControlledNetworkRequest<T>(
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
  request: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const abortContext = createRequestAbortContext(timeoutMs, callerSignal);
  const controlledRequest = (async () => {
    const release = await acquirePermit(abortContext.signal);
    try {
      abortContext.signal.throwIfAborted();
      // Race inside the permit boundary as well. This returns capacity on
      // abort even if a transport mock ignores AbortSignal and never settles.
      return await Promise.race([
        request(abortContext.signal),
        abortContext.aborted,
      ]);
    } finally {
      release();
    }
  })();

  try {
    // The explicit abort race guarantees prompt settlement even if a mocked or
    // non-compliant transport ignores AbortSignal. Axios still receives the
    // same signal and cancels the real socket/body stream.
    return await Promise.race([controlledRequest, abortContext.aborted]);
  } finally {
    abortContext.cleanup();
  }
}

function resetLimiterForTests(): void {
  limiterGeneration += 1;
  activeRequests = 0;
  const resetError = new NetworkRequestAbortedError('Network request limiter reset for test');
  for (const entry of requestQueue.splice(0)) {
    entry.signal.removeEventListener('abort', entry.onAbort);
    entry.reject(resetError);
  }
}

/** Test-only limiter visibility; omitted at runtime outside NODE_ENV=test. */
export const __testNetworkRequestLimiter = process.env.NODE_ENV === 'test'
  ? {
      getStats: () => ({
        active: activeRequests,
        queued: requestQueue.length,
        activeLimit: MAX_ACTIVE_REQUESTS,
        queuedLimit: MAX_QUEUED_REQUESTS,
      }),
      reset: resetLimiterForTests,
    }
  : undefined;
