import { describe, expect, it } from 'vitest';
import { createTradesHistorySyncRuntime } from './tradesHistorySyncRuntime';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('Trades history synchronization runtime', () => {
  it('coalesces scheduler and manual refreshes in the same account session', async () => {
    const response = deferred<boolean>();
    const calls: string[] = [];
    const runtime = createTradesHistorySyncRuntime({
      getSessionKey: () => 'admin-session-a',
      perform: async ({ source }) => {
        calls.push(source);
        return response.promise;
      }
    });

    const scheduled = runtime.run({ mode: 'refresh', source: 'scheduler' });
    const manual = runtime.run({ mode: 'refresh', source: 'manual' });
    await Promise.resolve();

    expect(calls).toEqual(['scheduler']);
    expect(runtime.getDiagnostics().coalesced).toBe(1);
    response.resolve(true);
    await expect(Promise.all([scheduled, manual])).resolves.toEqual([true, true]);
    expect(runtime.getDiagnostics()).toMatchObject({ started: 1, succeeded: 1, failed: 0, activeOperations: 0 });
  });

  it('queues a forced provider refresh behind a Trades cache-only refresh', async () => {
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    const secondStarted = deferred<void>();
    const calls: string[] = [];
    const runtime = createTradesHistorySyncRuntime({
      getSessionKey: () => 'admin-session-a',
      perform: async ({ mode, source }) => {
        calls.push(`${mode}:${source}`);
        if (calls.length === 2) secondStarted.resolve();
        return calls.length === 1 ? first.promise : second.promise;
      }
    });

    const desk = runtime.run({ mode: 'refresh', source: 'trades-desk' });
    const manual = runtime.run({ mode: 'refresh', source: 'manual' });
    await Promise.resolve();
    expect(calls).toEqual(['refresh:trades-desk']);
    expect(runtime.getDiagnostics().queued).toBe(1);

    first.resolve(true);
    await secondStarted.promise;
    expect(calls).toEqual(['refresh:trades-desk', 'refresh:manual']);
    second.resolve(true);
    await expect(Promise.all([desk, manual])).resolves.toEqual([true, true]);
    expect(runtime.getDiagnostics()).toMatchObject({ started: 2, succeeded: 2, queued: 1 });
  });

  it('queues a new fill snapshot behind a refresh that captured the previous inputs', async () => {
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    const secondStarted = deferred<void>();
    const calls: string[] = [];
    const runtime = createTradesHistorySyncRuntime({
      getSessionKey: () => 'admin-session-a',
      perform: async ({ mode, source, coalesceKey }) => {
        calls.push(`${mode}:${source}:${coalesceKey}`);
        if (calls.length === 2) secondStarted.resolve();
        return calls.length === 1 ? first.promise : second.promise;
      }
    });

    const initial = runtime.run({
      mode: 'refresh',
      source: 'trades-desk',
      coalesceKey: 'closed-trades-v1'
    });
    const newFill = runtime.run({
      mode: 'refresh',
      source: 'trades-desk',
      coalesceKey: 'closed-trades-v2'
    });
    first.resolve(true);
    await secondStarted.promise;
    expect(calls).toEqual([
      'refresh:trades-desk:closed-trades-v1',
      'refresh:trades-desk:closed-trades-v2'
    ]);
    second.resolve(true);
    await expect(Promise.all([initial, newFill])).resolves.toEqual([true, true]);
  });

  it('lets a provider refresh satisfy an overlapping cached recalculation', async () => {
    const response = deferred<boolean>();
    let calls = 0;
    const runtime = createTradesHistorySyncRuntime({
      getSessionKey: () => 'admin-session-a',
      perform: async () => { calls += 1; return response.promise; }
    });

    const refresh = runtime.run({ mode: 'refresh', source: 'scheduler' });
    const recalculate = runtime.run({ mode: 'recalculate', source: 'trades-desk' });
    await Promise.resolve();
    expect(calls).toBe(1);
    response.resolve(true);
    await expect(Promise.all([refresh, recalculate])).resolves.toEqual([true, true]);
  });

  it('queues a recalculation when its fee-allocation inputs changed during a refresh', async () => {
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    const secondStarted = deferred<void>();
    const calls: string[] = [];
    const runtime = createTradesHistorySyncRuntime({
      getSessionKey: () => 'admin-session-a',
      perform: async ({ mode, source, coalesceKey }) => {
        calls.push(`${mode}:${source}:${coalesceKey}`);
        if (calls.length === 2) secondStarted.resolve();
        return calls.length === 1 ? first.promise : second.promise;
      }
    });

    const refresh = runtime.run({
      mode: 'refresh',
      source: 'scheduler',
      coalesceKey: 'alloc-v1'
    });
    const changedRecalculation = runtime.run({
      mode: 'recalculate',
      source: 'trades-desk',
      coalesceKey: 'alloc-v2'
    });
    await Promise.resolve();
    expect(calls).toEqual(['refresh:scheduler:alloc-v1']);
    expect(runtime.getDiagnostics().queued).toBe(1);

    first.resolve(true);
    await secondStarted.promise;
    expect(calls).toEqual(['refresh:scheduler:alloc-v1', 'recalculate:trades-desk:alloc-v2']);
    second.resolve(true);
    await expect(Promise.all([refresh, changedRecalculation])).resolves.toEqual([true, true]);
  });

  it('queues a checkpoint refresh requested while a local recalculation is running', async () => {
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    const secondStarted = deferred<void>();
    const calls: string[] = [];
    const runtime = createTradesHistorySyncRuntime({
      getSessionKey: () => 'admin-session-a',
      perform: async ({ mode, source }) => {
        calls.push(`${mode}:${source}`);
        if (calls.length === 2) secondStarted.resolve();
        return calls.length === 1 ? first.promise : second.promise;
      }
    });

    const recalculation = runtime.run({ mode: 'recalculate', source: 'trades-desk' });
    const refresh = runtime.run({ mode: 'refresh', source: 'trades-desk' });
    first.resolve(true);
    await secondStarted.promise;
    expect(calls).toEqual(['recalculate:trades-desk', 'refresh:trades-desk']);
    second.resolve(true);
    await expect(Promise.all([recalculation, refresh])).resolves.toEqual([true, true]);
  });

  it('rejects a late result after the account session generation changes', async () => {
    const response = deferred<boolean>();
    let session: string | null = 'admin-session-a';
    const runtime = createTradesHistorySyncRuntime({
      getSessionKey: () => session,
      perform: async () => response.promise
    });

    const pending = runtime.run({ mode: 'refresh', source: 'manual' });
    session = 'admin-session-b';
    response.resolve(true);

    await expect(pending).resolves.toBe(false);
    expect(runtime.getSnapshot().status).toBe('stale');
    expect(runtime.getDiagnostics()).toMatchObject({ stale: 1, succeeded: 0 });
  });

  it('keeps diagnostic snapshots bounded and free of account or portfolio identifiers', () => {
    const runtime = createTradesHistorySyncRuntime({
      getSessionKey: () => 'sensitive-account-session-token',
      perform: async () => true,
      now: (() => { let value = 10; return () => value++; })()
    });

    expect(runtime.getDiagnostics()).toMatchObject({
      started: 0,
      succeeded: 0,
      failed: 0,
      coalesced: 0,
      queued: 0,
      activeOperations: 0
    });
    expect(JSON.stringify(runtime.getSnapshot())).not.toContain('sensitive-account-session-token');
    expect(JSON.stringify(runtime.getDiagnostics())).not.toContain('sensitive-account-session-token');
  });
});
