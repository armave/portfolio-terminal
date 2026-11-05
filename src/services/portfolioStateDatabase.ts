const PORTFOLIO_STATE_DATABASE_NAME = 'portfolio-terminal-state';
const PORTFOLIO_STATE_DATABASE_VERSION = 2;
const PORTFOLIO_STATE_OBJECT_STORE = 'snapshots';
const PORTFOLIO_RECOVERY_OBJECT_STORE = 'recovery';
const PORTFOLIO_STATE_CURRENT_KEY = 'current';

export interface PortfolioStateSnapshotRecord {
  schemaVersion: 1;
  revision: number;
  parentRevision: number;
  commitId: string;
  originId: string;
  committedAt: number;
  state: Record<string, unknown>;
  history: {
    brokerExecutedTrades: unknown[];
    cashflows: unknown[];
  };
  brokerRules: unknown | null;
  deviceActiveView: string | null;
}

type PortfolioStateCommitResult = 'committed' | 'already-committed' | 'conflict';

export interface PortfolioRecoveryArchiveRecord {
  id: string;
  originalKey: string;
  archivedAt: number;
  reason: 'superseded-by-committed-checkpoint';
  payload: unknown;
}

export interface PortfolioStateDatabase {
  readCurrent(): Promise<PortfolioStateSnapshotRecord | null>;
  compareAndCommit(
    record: PortfolioStateSnapshotRecord,
    expectedRevision: number | null
  ): Promise<PortfolioStateCommitResult>;
  clear(): Promise<void>;
  archiveRecoveryRecords(records: PortfolioRecoveryArchiveRecord[]): Promise<void>;
  readRecoveryRecords(): Promise<PortfolioRecoveryArchiveRecord[]>;
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = factory.open(PORTFOLIO_STATE_DATABASE_NAME, PORTFOLIO_STATE_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PORTFOLIO_STATE_OBJECT_STORE)) {
        database.createObjectStore(PORTFOLIO_STATE_OBJECT_STORE);
      }
      if (!database.objectStoreNames.contains(PORTFOLIO_RECOVERY_OBJECT_STORE)) {
        database.createObjectStore(PORTFOLIO_RECOVERY_OBJECT_STORE);
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error || new Error('Could not open portfolio state database.'));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error('Portfolio state database upgrade is blocked by another open tab.'));
    };
  });
}

/**
 * IndexedDB adapter for the single committed portfolio generation.
 *
 * Every generation is one object-store record. The read/check/write sequence
 * happens inside one readwrite transaction, so stale tabs cannot overwrite a
 * newer generation.
 */
export function createIndexedDbPortfolioStateDatabase(
  factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB
): PortfolioStateDatabase {
  if (!factory) {
    return {
      readCurrent: async () => { throw new Error('IndexedDB is unavailable.'); },
      compareAndCommit: async () => { throw new Error('IndexedDB is unavailable.'); },
      clear: async () => { throw new Error('IndexedDB is unavailable.'); },
      archiveRecoveryRecords: async () => { throw new Error('IndexedDB is unavailable.'); },
      readRecoveryRecords: async () => { throw new Error('IndexedDB is unavailable.'); }
    };
  }

  return {
    async readCurrent(): Promise<PortfolioStateSnapshotRecord | null> {
      const database = await openDatabase(factory);
      return new Promise((resolve, reject) => {
        let snapshot: PortfolioStateSnapshotRecord | null = null;
        let failure: Error | null = null;
        const transaction = database.transaction(PORTFOLIO_STATE_OBJECT_STORE, 'readonly');
        const request = transaction.objectStore(PORTFOLIO_STATE_OBJECT_STORE).get(PORTFOLIO_STATE_CURRENT_KEY);
        request.onsuccess = () => {
          const value = request.result;
          snapshot = value && typeof value === 'object' ? value as PortfolioStateSnapshotRecord : null;
        };
        request.onerror = () => {
          failure = request.error || new Error('Could not read portfolio state from IndexedDB.');
        };
        transaction.oncomplete = () => {
          database.close();
          if (failure) reject(failure);
          else resolve(snapshot);
        };
        transaction.onerror = () => {
          failure = transaction.error || failure || new Error('Portfolio state read transaction failed.');
        };
        transaction.onabort = () => {
          database.close();
          reject(failure || transaction.error || new Error('Portfolio state read transaction was aborted.'));
        };
      });
    },

    async compareAndCommit(
      record: PortfolioStateSnapshotRecord,
      expectedRevision: number | null
    ): Promise<PortfolioStateCommitResult> {
      const database = await openDatabase(factory);
      return new Promise((resolve, reject) => {
        let result: PortfolioStateCommitResult = 'committed';
        let failure: Error | null = null;
        const transaction = database.transaction(PORTFOLIO_STATE_OBJECT_STORE, 'readwrite');
        const store = transaction.objectStore(PORTFOLIO_STATE_OBJECT_STORE);
        const request = store.get(PORTFOLIO_STATE_CURRENT_KEY);

        request.onsuccess = () => {
          const current = request.result as PortfolioStateSnapshotRecord | undefined;
          if (current?.commitId === record.commitId) {
            result = 'already-committed';
            return;
          }
          const currentRevision = current ? current.revision : null;
          if (currentRevision !== expectedRevision) {
            result = 'conflict';
            transaction.abort();
            return;
          }
          store.put(record, PORTFOLIO_STATE_CURRENT_KEY);
        };
        request.onerror = () => {
          failure = request.error || new Error('Could not inspect the current portfolio revision.');
          transaction.abort();
        };
        transaction.oncomplete = () => {
          database.close();
          resolve(result);
        };
        transaction.onerror = () => {
          failure = transaction.error || failure || new Error('Portfolio state commit transaction failed.');
        };
        transaction.onabort = () => {
          database.close();
          if (result === 'conflict') resolve('conflict');
          else reject(failure || transaction.error || new Error('Portfolio state commit transaction was aborted.'));
        };
      });
    },

    async clear(): Promise<void> {
      const database = await openDatabase(factory);
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(PORTFOLIO_STATE_OBJECT_STORE, 'readwrite');
        transaction.objectStore(PORTFOLIO_STATE_OBJECT_STORE).delete(PORTFOLIO_STATE_CURRENT_KEY);
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error || new Error('Could not clear portfolio state from IndexedDB.'));
        };
        transaction.onabort = () => {
          database.close();
          reject(transaction.error || new Error('Portfolio state clear transaction was aborted.'));
        };
      });
    },

    /**
     * Preserve superseded local write-ahead journals in IndexedDB before their
     * localStorage copies are removed. The archive is a separate object store:
     * it never changes the authoritative current portfolio generation.
     */
    async archiveRecoveryRecords(records: PortfolioRecoveryArchiveRecord[]): Promise<void> {
      if (records.length === 0) return;
      const database = await openDatabase(factory);
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(PORTFOLIO_RECOVERY_OBJECT_STORE, 'readwrite');
        const store = transaction.objectStore(PORTFOLIO_RECOVERY_OBJECT_STORE);
        records.forEach((record) => store.put(record, record.id));
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error || new Error('Could not archive superseded portfolio recovery journals.'));
        };
        transaction.onabort = () => {
          database.close();
          reject(transaction.error || new Error('Portfolio recovery archive transaction was aborted.'));
        };
      });
    },

    async readRecoveryRecords(): Promise<PortfolioRecoveryArchiveRecord[]> {
      const database = await openDatabase(factory);
      return new Promise((resolve, reject) => {
        const transaction = database.transaction(PORTFOLIO_RECOVERY_OBJECT_STORE, 'readonly');
        const request = transaction.objectStore(PORTFOLIO_RECOVERY_OBJECT_STORE).getAll();
        request.onsuccess = () => {
          // Resolve only after the readonly transaction completes.
        };
        request.onerror = () => {
          database.close();
          reject(request.error || new Error('Could not read archived portfolio recovery journals.'));
        };
        transaction.oncomplete = () => {
          database.close();
          resolve((request.result || []) as PortfolioRecoveryArchiveRecord[]);
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error || new Error('Portfolio recovery archive read failed.'));
        };
        transaction.onabort = () => {
          database.close();
          reject(transaction.error || new Error('Portfolio recovery archive read was aborted.'));
        };
      });
    }
  };
}
