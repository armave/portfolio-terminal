type FrameCancellation = () => void;
export type FrameSchedule = (callback: () => void) => FrameCancellation;

export interface CoalescedFrameCallback {
  schedule: () => void;
  cancel: () => void;
}

function scheduleOnNextFrame(callback: () => void): FrameCancellation {
  if (typeof requestAnimationFrame === 'function') {
    const frameId = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(frameId);
  }

  const timeoutId = setTimeout(callback, 16);
  return () => clearTimeout(timeoutId);
}

/**
 * Schedule one derived UI refresh for the next animation frame.
 * Repeated updates in the same frame are coalesced; cancel also makes a
 * callback harmless if the browser has already queued it for execution.
 */
export function createCoalescedFrameCallback(
  callback: () => void,
  scheduleFrame: FrameSchedule = scheduleOnNextFrame
): CoalescedFrameCallback {
  let scheduled = false;
  let cancelScheduledFrame: FrameCancellation | null = null;

  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    cancelScheduledFrame = scheduleFrame(() => {
      if (!scheduled) return;
      scheduled = false;
      cancelScheduledFrame = null;
      callback();
    });
  };

  const cancel = (): void => {
    if (!scheduled) return;
    scheduled = false;
    cancelScheduledFrame?.();
    cancelScheduledFrame = null;
  };

  return { schedule, cancel };
}
