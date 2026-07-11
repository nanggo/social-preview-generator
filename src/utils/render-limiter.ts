import { ErrorType, PreviewGeneratorError } from '../types';

const MAX_ACTIVE_RENDERS = 4;
const MAX_QUEUED_RENDERS = 32;
const MAX_ACTIVE_IMAGE_PREPARATIONS = 4;
const MAX_QUEUED_IMAGE_PREPARATIONS = 32;

type ReleaseRenderSlot = () => void;

interface QueuedRender {
  resolve: (release: ReleaseRenderSlot) => void;
}

const renderQueue: QueuedRender[] = [];
let activeRenders = 0;
const imagePreparationQueue: QueuedRender[] = [];
let activeImagePreparations = 0;

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

function createImagePreparationRelease(): ReleaseRenderSlot {
  let released = false;

  return () => {
    if (released) {
      return;
    }
    released = true;
    activeImagePreparations--;

    const next = imagePreparationQueue.shift();
    if (next) {
      activeImagePreparations++;
      next.resolve(createImagePreparationRelease());
    }
  };
}

/** Acquire one process-wide render slot, preserving FIFO queue order. */
export async function acquireRenderSlot(): Promise<ReleaseRenderSlot> {
  if (activeRenders < MAX_ACTIVE_RENDERS) {
    activeRenders++;
    return createRelease();
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

/** Bound background fetch/validation and the prepared-buffer handoff to rendering. */
export async function acquireImagePreparationSlot(): Promise<ReleaseRenderSlot> {
  if (activeImagePreparations < MAX_ACTIVE_IMAGE_PREPARATIONS) {
    activeImagePreparations++;
    return createImagePreparationRelease();
  }

  if (imagePreparationQueue.length >= MAX_QUEUED_IMAGE_PREPARATIONS) {
    throw new PreviewGeneratorError(
      ErrorType.IMAGE_ERROR,
      `Image preparation queue is full (${MAX_ACTIVE_IMAGE_PREPARATIONS} active, ${MAX_QUEUED_IMAGE_PREPARATIONS} queued)`
    );
  }

  return new Promise<ReleaseRenderSlot>(resolve => {
    imagePreparationQueue.push({ resolve });
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

/**
 * Prepare background bytes under a separate bound, then atomically hand them
 * to a native render slot. Queued preparation entries retain no image Buffer.
 */
export async function withPreparedRenderSlot<Prepared, Result>(
  prepare: () => Promise<Prepared>,
  render: (prepared: Prepared) => Promise<Result>
): Promise<Result> {
  const releasePreparation = await acquireImagePreparationSlot();
  let releaseRender: ReleaseRenderSlot | undefined;

  try {
    const prepared = await prepare();
    releaseRender = await acquireRenderSlot();
    releasePreparation();

    return await render(prepared);
  } finally {
    releasePreparation();
    releaseRender?.();
  }
}

/** Internal diagnostics used by deterministic limiter tests. */
export function getRenderLimiterStats() {
  return {
    active: activeRenders,
    queued: renderQueue.length,
    maxActive: MAX_ACTIVE_RENDERS,
    maxQueued: MAX_QUEUED_RENDERS,
    preparing: activeImagePreparations,
    preparationQueued: imagePreparationQueue.length,
    maxPreparing: MAX_ACTIVE_IMAGE_PREPARATIONS,
    maxPreparationQueued: MAX_QUEUED_IMAGE_PREPARATIONS,
  } as const;
}

/** Test-only reset. Refuse to orphan active or queued work. */
export function resetRenderLimiterForTests(): void {
  if (
    activeRenders !== 0 ||
    renderQueue.length !== 0 ||
    activeImagePreparations !== 0 ||
    imagePreparationQueue.length !== 0
  ) {
    throw new Error('Cannot reset render limiter while work is active or queued');
  }

  activeRenders = 0;
  renderQueue.length = 0;
  activeImagePreparations = 0;
  imagePreparationQueue.length = 0;
}
