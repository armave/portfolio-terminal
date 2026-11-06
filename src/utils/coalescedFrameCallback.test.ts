import { describe, expect, it, vi } from 'vitest';
import { createCoalescedFrameCallback, type FrameSchedule } from './coalescedFrameCallback';

function createFrameQueue() {
  const frames: Array<{ callback: () => void; cancelled: boolean }> = [];
  const schedule: FrameSchedule = (callback) => {
    const frame = { callback, cancelled: false };
    frames.push(frame);
    return () => { frame.cancelled = true; };
  };

  return {
    frames,
    schedule,
    flush() {
      const frame = frames.shift();
      if (frame && !frame.cancelled) frame.callback();
      return frame;
    }
  };
}

describe('createCoalescedFrameCallback', () => {
  it('runs one callback for multiple updates scheduled before the same frame', () => {
    const queue = createFrameQueue();
    const callback = vi.fn();
    const coalesced = createCoalescedFrameCallback(callback, queue.schedule);

    coalesced.schedule();
    coalesced.schedule();
    coalesced.schedule();

    expect(queue.frames).toHaveLength(1);
    expect(callback).not.toHaveBeenCalled();

    queue.flush();
    expect(callback).toHaveBeenCalledTimes(1);

    coalesced.schedule();
    expect(queue.frames).toHaveLength(1);
    queue.flush();
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending frame and ignores a callback that was already queued', () => {
    const queue = createFrameQueue();
    const callback = vi.fn();
    const coalesced = createCoalescedFrameCallback(callback, queue.schedule);

    coalesced.schedule();
    const pending = queue.frames[0];
    coalesced.cancel();

    expect(pending.cancelled).toBe(true);
    pending.callback();
    expect(callback).not.toHaveBeenCalled();

    coalesced.cancel();
    expect(callback).not.toHaveBeenCalled();
  });
});
