export interface CloudRevisionStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface CloudRevisionCoordinator {
  getRevision: () => number;
  setRevision: (revision: number) => void;
  recordPulledRevision: (revision: number) => void;
  enqueueWrite: <T>(operation: (expectedRevision: number) => Promise<T>) => Promise<T>;
}

export interface CloudRevisionCoordinatorDependencies {
  storage?: CloudRevisionStorage | null;
}

/**
 * Tracks the browser's last accepted cloud revision and serializes snapshot
 * writes. A pull that completes after a caller submitted a snapshot must not
 * silently grant that older snapshot a newer If-Match revision.
 */
export function createCloudRevisionCoordinator(
  dependencies: CloudRevisionCoordinatorDependencies = {}
): CloudRevisionCoordinator {
  const storageKey = 'portfolio_cloud_revision_v1';
  const getStorage = (): CloudRevisionStorage | null => {
    if (dependencies.storage !== undefined) return dependencies.storage;
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  };

  const loadRevision = (): number => {
    try {
      const raw = getStorage()?.getItem(storageKey) ?? null;
      const revision = raw === null ? 0 : Number(raw);
      return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
    } catch {
      return 0;
    }
  };

  let revision = loadRevision();
  let pullGeneration = 0;
  let writeQueue: Promise<void> = Promise.resolve();

  const setRevision = (nextRevision: number): void => {
    revision = nextRevision;
    try {
      getStorage()?.setItem(storageKey, String(nextRevision));
    } catch {
      // The in-memory revision still protects this running app instance.
    }
  };

  const recordPulledRevision = (pulledRevision: number): void => {
    pullGeneration += 1;
    setRevision(pulledRevision);
  };

  const enqueueWrite = <T>(operation: (expectedRevision: number) => Promise<T>): Promise<T> => {
    // Capture both values at submission time. The queue may follow prior writes
    // from this tab, but a later pull cannot authorize an already-queued snapshot.
    const submittedRevision = revision;
    const submittedPullGeneration = pullGeneration;
    const result = writeQueue.then(() => {
      const expectedRevision = pullGeneration === submittedPullGeneration
        ? revision
        : submittedRevision;
      return operation(expectedRevision);
    });
    writeQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    getRevision: () => revision,
    setRevision,
    recordPulledRevision,
    enqueueWrite
  };
}
