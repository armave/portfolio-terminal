import { describe, expect, it, vi } from 'vitest';
import { createLatestFramePublisher } from './marketDepthFramePublisher';

function createFrameScheduler() {
  let nextHandle = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const schedule = vi.fn((callback: FrameRequestCallback) => {
    const handle = nextHandle++;
    callbacks.set(handle, callback);
    return handle;
  });
  const cancel = vi.fn((handle: number) => {
    callbacks.delete(handle);
  });
  const flush = (handle: number) => callbacks.get(handle)?.(0);
  return { schedule, cancel, flush, callbacks };
}

describe('latest Market Depth frame publisher', () => {
  it('coalesces rapid updates and publishes only the newest book in a frame', () => {
    const scheduler = createFrameScheduler();
    const onPublish = vi.fn();
    const publisher = createLatestFramePublisher(onPublish, scheduler.schedule, scheduler.cancel);
    const latest = { sequence: 3 };

    publisher.publish({ sequence: 1 });
    publisher.publish({ sequence: 2 });
    publisher.publish(latest);

    expect(scheduler.schedule).toHaveBeenCalledTimes(1);
    expect(onPublish).not.toHaveBeenCalled();
    scheduler.flush(1);
    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(onPublish).toHaveBeenLastCalledWith(latest);
  });

  it('cancels and invalidates queued data when the stream is cleared', () => {
    const scheduler = createFrameScheduler();
    const onPublish = vi.fn();
    const publisher = createLatestFramePublisher(onPublish, scheduler.schedule, scheduler.cancel);

    publisher.publish({ sequence: 1 });
    const staleCallback = scheduler.callbacks.get(1);
    publisher.clear();
    staleCallback?.(0);

    expect(scheduler.cancel).toHaveBeenCalledWith(1);
    expect(onPublish).not.toHaveBeenCalled();

    publisher.publish({ sequence: 2 });
    scheduler.flush(2);
    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(onPublish).toHaveBeenLastCalledWith({ sequence: 2 });
  });
});
