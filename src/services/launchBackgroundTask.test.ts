import { describe, expect, it, vi } from 'vitest';
import { launchBackgroundTask } from './launchBackgroundTask';

describe('launchBackgroundTask', () => {
  it('returns without waiting for a long-lived task to settle', () => {
    let resolveTask: (() => void) | undefined;
    const task = vi.fn(() => new Promise<void>((resolve) => { resolveTask = resolve; }));
    const onError = vi.fn();

    expect(launchBackgroundTask(task, onError)).toBeUndefined();
    expect(task).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();

    resolveTask?.();
  });

  it('observes asynchronous task failures and reports them', async () => {
    const error = new Error('socket handshake failed');
    const onError = vi.fn();
    launchBackgroundTask(() => Promise.reject(error), onError);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));
  });

  it('reports synchronous task-start errors', () => {
    const error = new Error('could not allocate socket');
    const onError = vi.fn();
    launchBackgroundTask(() => { throw error; }, onError);

    expect(onError).toHaveBeenCalledWith(error);
  });
});
