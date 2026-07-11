import { ErrorType, PreviewGeneratorError } from '../types';

const MAX_ACTIVE_RENDERS = 4;
const MAX_QUEUED_RENDERS = 32;

type ReleaseRenderSlot = () => void;

interface QueuedRender {
  resolve: (release: ReleaseRenderSlot) => void;
}

const renderQueue: QueuedRender[] = [];
let activeRenders = 0;

function createRelease(): ReleaseRenderSlot {
  let released = false;

  return () => {
    if (released) {
      return;
    }
    released = true;
    activeRenders--;

    const next = renderQueue.shift();
    if (next) {
      activeRenders++;
      next.resolve(createRelease());
    }
  };
}

/** Acquire one process-wide render slot, preserving FIFO queue order. */
export function acquireRenderSlot(): Promise<ReleaseRenderSlot> {
  if (activeRenders < MAX_ACTIVE_RENDERS) {
    activeRenders++;
    return Promise.resolve(createRelease());
  }

  if (renderQueue.length >= MAX_QUEUED_RENDERS) {
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      `Render queue is full (${MAX_ACTIVE_RENDERS} active, ${MAX_QUEUED_RENDERS} queued)`
    );
  }

  return new Promise<ReleaseRenderSlot>((resolve) => {
    renderQueue.push({ resolve });
  });
}

/** Hold one render slot until the complete native image pipeline settles. */
export async function withRenderSlot<T>(operation: () => Promise<T>): Promise<T> {
  const release = await acquireRenderSlot();

  try {
    return await operation();
  } finally {
    release();
  }
}

/** Internal diagnostics used by deterministic limiter tests. */
export function getRenderLimiterStats() {
  return {
    active: activeRenders,
    queued: renderQueue.length,
    maxActive: MAX_ACTIVE_RENDERS,
    maxQueued: MAX_QUEUED_RENDERS,
  } as const;
}

/** Test-only reset. Refuse to orphan active or queued work. */
export function resetRenderLimiterForTests(): void {
  if (activeRenders !== 0 || renderQueue.length !== 0) {
    throw new Error('Cannot reset render limiter while work is active or queued');
  }

  activeRenders = 0;
  renderQueue.length = 0;
}
