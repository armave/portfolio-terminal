import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleDialogClose } from './dialogClose';

afterEach(() => {
  vi.useRealTimers();
});

describe('scheduleDialogClose', () => {
  it('runs the close callback after the requested exit-animation delay', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();

    scheduleDialogClose(onClose, 200);

    vi.advanceTimersByTime(199);
    expect(onClose).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('cancels the callback when the owning modal unmounts', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const cancel = scheduleDialogClose(onClose, 200);

    cancel();
    cancel();
    vi.advanceTimersByTime(250);

    expect(onClose).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not attempt to cancel a callback after it has already fired', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const cancel = scheduleDialogClose(onClose, 180);

    vi.advanceTimersByTime(180);
    cancel();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
