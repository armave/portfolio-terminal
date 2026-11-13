import { describe, expect, it, vi } from 'vitest';
import { createRequestScheduler } from './requestScheduler';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('shared request scheduler', () => {
  it('bounds concurrency and orders queued work by priority with FIFO ties', async () => {
    const scheduler = createRequestScheduler({ concurrency: 1, maxQueued: 8 });
    const sequence: string[] = [];
    const firstGate = deferred();
    const backgroundGate = deferred();

    const first = scheduler.schedule(async () => {
      sequence.push('active');
      await firstGate.promise;
      return 'active';
    }, { priority: 'interactive' });

    await vi.waitFor(() => expect(sequence).toEqual(['active']));

    const backgroundOne = scheduler.schedule(async () => {
      sequence.push('background-1');
      await backgroundGate.promise;
      return 'background-1';
    }, { priority: 'background' });
    const interactive = scheduler.schedule(() => {
      sequence.push('interactive');
      return 'interactive';
    }, { priority: 'interactive' });
    const critical = scheduler.schedule(() => {
      sequence.push('critical');
      return 'critical';
    }, { priority: 'critical' });
    const backgroundTwo = scheduler.schedule(() => {
      sequence.push('background-2');
      return 'background-2';
    }, { priority: 'background' });

    expect(scheduler.getSnapshot()).toMatchObject({
      active: 1,
      queued: 4,
      concurrency: 1,
      activeByPriority: { interactive: 1 },
      queuedByPriority: { critical: 1, interactive: 1, background: 2 }
    });

    firstGate.resolve(undefined);
    await expect(first).resolves.toBe('active');
    await vi.waitFor(() => expect(sequence).toEqual(['active', 'critical', 'interactive', 'background-1']));

    backgroundGate.resolve(undefined);
    await expect(Promise.all([backgroundOne, backgroundTwo, interactive, critical]))
      .resolves.toEqual(['background-1', 'background-2', 'interactive', 'critical']);
    expect(sequence).toEqual(['active', 'critical', 'interactive', 'background-1', 'background-2']);
    expect(scheduler.getSnapshot()).toMatchObject({ active: 0, queued: 0 });
  });

  it('removes an aborted queued request without invoking its task', async () => {
    const scheduler = createRequestScheduler({ concurrency: 1 });
    const activeGate = deferred();
    const active = scheduler.schedule(() => activeGate.promise);
    const controller = new AbortController();
    const queuedTask = vi.fn(() => 'should-not-run');
    const queued = scheduler.schedule(queuedTask, { signal: controller.signal });
    const reason = new Error('account session changed');

    controller.abort(reason);
    await expect(queued).rejects.toBe(reason);
    expect(queuedTask).not.toHaveBeenCalled();
    expect(scheduler.getSnapshot()).toMatchObject({ active: 1, queued: 0 });

    activeGate.resolve(undefined);
    await expect(active).resolves.toBeUndefined();
  });

  it('forwards cancellation to running work and frees its scheduler slot', async () => {
    const scheduler = createRequestScheduler({ concurrency: 1 });
    const controller = new AbortController();
    const reason = new Error('request no longer needed');
    const started = deferred();
    const running = scheduler.schedule((signal) => new Promise((_resolve, reject) => {
      started.resolve(undefined);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }), { signal: controller.signal });

    await started.promise;
    controller.abort(reason);
    await expect(running).rejects.toBe(reason);
    expect(scheduler.getSnapshot()).toMatchObject({ active: 0, queued: 0 });
  });

  it('continues pumping after a task failure', async () => {
    const scheduler = createRequestScheduler({ concurrency: 1 });
    const failed = scheduler.schedule(() => { throw new Error('provider failed'); });
    const next = scheduler.schedule(() => 'next');

    await expect(failed).rejects.toThrow('provider failed');
    await expect(next).resolves.toBe('next');
    expect(scheduler.getSnapshot()).toMatchObject({ active: 0, queued: 0 });
  });

  it('rejects excess queued work and cancels the remaining queue on reset', async () => {
    const scheduler = createRequestScheduler({ concurrency: 1, maxQueued: 1 });
    const activeGate = deferred();
    const active = scheduler.schedule(() => activeGate.promise);
    const queued = scheduler.schedule(() => 'queued');
    await expect(scheduler.schedule(() => 'overflow')).rejects.toThrow('queue is full');

    const reason = new Error('session reset');
    scheduler.cancelAll(reason);
    await expect(active).rejects.toBe(reason);
    await expect(queued).rejects.toBe(reason);
    expect(scheduler.getSnapshot()).toMatchObject({ active: 0, queued: 0 });
    activeGate.resolve(undefined);
  });
});
