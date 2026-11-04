export interface LatestFramePublisher<T> {
  publish: (value: T) => void;
  clear: () => void;
}

type ScheduleFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;

/**
 * Keep only the latest stream value and publish it once per animation frame.
 * clear() invalidates queued callbacks so a disconnect can never repaint a
 * snapshot from the previous live session.
 */
export function createLatestFramePublisher<T>(
  onPublish: (value: T) => void,
  scheduleFrame: ScheduleFrame = callback => requestAnimationFrame(callback),
  cancelFrame: CancelFrame = handle => cancelAnimationFrame(handle)
): LatestFramePublisher<T> {
  let frame: number | null = null;
  let generation = 0;
  let hasPendingValue = false;
  let latestValue: T | undefined;

  const clear = (): void => {
    generation += 1;
    if (frame !== null) cancelFrame(frame);
    frame = null;
    latestValue = undefined;
    hasPendingValue = false;
  };

  const publish = (value: T): void => {
    latestValue = value;
    hasPendingValue = true;
    if (frame !== null) return;

    const scheduledGeneration = generation;
    frame = scheduleFrame(() => {
      if (scheduledGeneration !== generation) return;
      frame = null;
      if (!hasPendingValue) return;
      const nextValue = latestValue as T;
      latestValue = undefined;
      hasPendingValue = false;
      onPublish(nextValue);
    });
  };

  return { publish, clear };
}
