import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addToast, dismissToast, subscribeToasts } from './notificationStore';

describe('app notification store', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('publishes typed notifications and removes them after the exit transition', () => {
    const snapshots: Array<Array<{ id: string; message: string; variant: string; isClosing: boolean }>> = [];
    const unsubscribe = subscribeToasts((items) => snapshots.push(items.map((item) => ({ ...item }))));

    addToast('Portfolio sync completed.', 'success');
    expect(snapshots.at(-1)).toEqual([
      expect.objectContaining({ message: 'Portfolio sync completed.', variant: 'success', isClosing: false })
    ]);

    const toast = snapshots.at(-1)![0];
    dismissToast(toast.id);
    expect(snapshots.at(-1)?.[0]).toMatchObject({ id: toast.id, isClosing: true });
    vi.advanceTimersByTime(180);
    expect(snapshots.at(-1)).toEqual([]);

    unsubscribe();
  });

  it('automatically dismisses a notification after its display period', () => {
    const snapshots: number[] = [];
    const unsubscribe = subscribeToasts((items) => snapshots.push(items.length));

    addToast('Broker connection restored.', 'info');
    vi.advanceTimersByTime(4_500);
    expect(snapshots.at(-1)).toBe(1);
    vi.advanceTimersByTime(180);
    expect(snapshots.at(-1)).toBe(0);

    unsubscribe();
  });

  it('ignores blank messages and caps the visible message length', () => {
    const snapshots: Array<Array<{ message: string }>> = [];
    const unsubscribe = subscribeToasts((items) => snapshots.push(items));
    addToast('   ');
    expect(snapshots.at(-1)).toEqual([]);
    addToast('x'.repeat(250), 'warning');
    expect(snapshots.at(-1)?.[0].message).toHaveLength(180);
    unsubscribe();
  });
});
