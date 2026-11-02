import { describe, expect, it, vi } from 'vitest';
import { createCloudRevisionCoordinator, type CloudRevisionStorage } from './cloudRevisionCoordinator';

function createStorage(initial: string | null = null) {
  let value = initial;
  const storage: CloudRevisionStorage = {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key, nextValue) => { value = nextValue; })
  };
  return {
    storage,
    get value() { return value; }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('cloud revision coordinator', () => {
  it('loads only safe non-negative integer revisions and persists accepted revisions', () => {
    const storage = createStorage('14');
    const coordinator = createCloudRevisionCoordinator({ storage: storage.storage });
    expect(coordinator.getRevision()).toBe(14);

    coordinator.setRevision(15);
    expect(coordinator.getRevision()).toBe(15);
    expect(storage.value).toBe('15');
    expect(storage.storage.setItem).toHaveBeenCalledWith('portfolio_cloud_revision_v1', '15');

    for (const invalid of ['-1', '1.5', 'NaN', 'Infinity', '']) {
      const invalidStorage = createStorage(invalid);
      expect(createCloudRevisionCoordinator({ storage: invalidStorage.storage }).getRevision()).toBe(0);
    }
  });

  it('continues protecting the in-memory revision when browser storage writes fail', () => {
    const storage: CloudRevisionStorage = {
      getItem: () => '7',
      setItem: () => { throw new Error('storage unavailable'); }
    };
    const coordinator = createCloudRevisionCoordinator({ storage });
    coordinator.setRevision(8);
    expect(coordinator.getRevision()).toBe(8);
  });

  it('serializes writes and lets a queued write follow the preceding write revision', async () => {
    const coordinator = createCloudRevisionCoordinator({ storage: createStorage('20').storage });
    const firstGate = deferred<void>();
    const observed: number[] = [];

    const first = coordinator.enqueueWrite(async (expectedRevision) => {
      observed.push(expectedRevision);
      await firstGate.promise;
      coordinator.setRevision(21);
      return true;
    });
    const second = coordinator.enqueueWrite(async (expectedRevision) => {
      observed.push(expectedRevision);
      return true;
    });

    await Promise.resolve();
    expect(observed).toEqual([20]);
    firstGate.resolve();
    await Promise.all([first, second]);
    expect(observed).toEqual([20, 21]);
  });

  it('does not let a pull that completes after submission authorize an older queued snapshot', async () => {
    const coordinator = createCloudRevisionCoordinator({ storage: createStorage('30').storage });
    const firstGate = deferred<void>();
    const observed: number[] = [];

    const first = coordinator.enqueueWrite(async () => {
      await firstGate.promise;
      return true;
    });
    const second = coordinator.enqueueWrite(async (expectedRevision) => {
      observed.push(expectedRevision);
      return true;
    });

    coordinator.recordPulledRevision(50);
    firstGate.resolve();
    await Promise.all([first, second]);
    expect(coordinator.getRevision()).toBe(50);
    expect(observed).toEqual([30]);
  });

  it('keeps the queue usable after a failed write', async () => {
    const coordinator = createCloudRevisionCoordinator({ storage: createStorage('3').storage });
    const failure = vi.fn(async () => { throw new Error('conflict'); });
    const success = vi.fn(async (revision: number) => revision);
    await expect(coordinator.enqueueWrite(failure)).rejects.toThrow('conflict');
    await expect(coordinator.enqueueWrite(success)).resolves.toBe(3);
    expect(success).toHaveBeenCalledTimes(1);
  });

  it('records pull revisions separately from successful push revisions', async () => {
    const coordinator = createCloudRevisionCoordinator({ storage: createStorage('4').storage });
    coordinator.recordPulledRevision(8);
    expect(coordinator.getRevision()).toBe(8);
    await coordinator.enqueueWrite(async (expectedRevision) => {
      expect(expectedRevision).toBe(8);
      coordinator.setRevision(9);
      return true;
    });
    expect(coordinator.getRevision()).toBe(9);
  });
});
