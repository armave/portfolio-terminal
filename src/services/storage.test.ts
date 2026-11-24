import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  activatePortfolioStorageScope,
  saveState,
  savePortfolioSnapshot,
  savePortfolioStateSnapshot,
  loadSavedState,
  loadSavedHistory,
  saveSavedHistory,
  initializeSavedHistoryStorage,
  flushSavedHistoryPersistence,
  clearSavedHistoryPersistence,
  initializePortfolioStateRecoveryStorage,
  flushPortfolioStateRecoveryPersistence,
  clearPortfolioStateRecoveryPersistence,
  clearLocalData,
  getGatewaySecret,
  setGatewaySecret,
  saveGatewaySecret,
  loadGatewaySecret,
  restoreGatewaySecret,
  persistGatewaySecret,
  obfuscateSecret,
  deobfuscateSecret,
  areHeaderCredentialsConfigured,
  loadBrokerRules,
  saveBrokerRules,
  clearBrokerRules,
  getQuoteRefreshInterval,
  saveQuoteRefreshInterval,
  getWorkspaceDisclosurePreferences,
  saveWorkspaceDisclosurePreferences,
  saveApiKeys,
  hasFreedomCashflowHistoryBaseline,
  hasFreedomTradeHistoryBaseline,
  markFreedomCashflowHistoryBaseline,
  markFreedomTradeHistoryBaseline
} from './storage.ts';

describe('storage service', () => {
  const storageMap = new Map<string, string>();

  const localStorageMock = {
    getItem: vi.fn((key: string) => storageMap.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storageMap.set(key, String(value));
    }),
    removeItem: vi.fn((key: string) => {
      storageMap.delete(key);
    }),
    clear: vi.fn(() => {
      storageMap.clear();
    }),
    key: vi.fn((index: number) => Array.from(storageMap.keys())[index] ?? null),
    get length() {
      return storageMap.size;
    }
  };

  beforeEach(async () => {
    vi.stubGlobal('localStorage', localStorageMock);
    await activatePortfolioStorageScope('legacy');
    storageMap.clear();
    await clearPortfolioStateRecoveryPersistence('legacy');
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await clearSavedHistoryPersistence();
  });

  afterEach(() => {
    localStorageMock.setItem.mockImplementation((key: string, value: string) => {
      storageMap.set(key, String(value));
    });
    vi.unstubAllGlobals();
  });

  it('fails closed into the offline scope when localStorage is unavailable', async () => {
    try {
      vi.stubGlobal('localStorage', undefined);

      await expect(activatePortfolioStorageScope('offline')).resolves.toBeUndefined();

      vi.stubGlobal('localStorage', localStorageMock);
      expect(saveState({ balance: 42 })).toBe(true);
      expect(storageMap.get('margin_portfolio_state_dynamic_v2::offline')).not.toBeNull();
      expect(storageMap.has('margin_portfolio_state_dynamic_v2')).toBe(false);
      expect(storageMap.has('margin_portfolio_state_dynamic_v2::owner')).toBe(false);
    } finally {
      // Keep the module-level storage scope isolated from other Vitest files.
      vi.stubGlobal('localStorage', localStorageMock);
      await activatePortfolioStorageScope('legacy');
    }
  });

  it('completes authenticated scope activation when IndexedDB open requests stall', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('indexedDB', {
        open: vi.fn(() => ({}))
      } as unknown as IDBFactory);

      const activation = activatePortfolioStorageScope('owner', { migrateLegacy: true });
      // Scope activation bounds the owner-state preflight, legacy-history
      // preflight, portfolio-recovery migration, and closed-history hydration.
      // Each IndexedDB open has its own two-second deadline.
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(activation).resolves.toBeUndefined();

      expect(storageMap.get('portfolio_session_storage_v1')).toBe('1');
      expect(saveState({ balance: 42 })).toBe(true);
      expect(storageMap.has('margin_portfolio_state_dynamic_v2::owner')).toBe(true);
    } finally {
      vi.useRealTimers();
      vi.stubGlobal('indexedDB', undefined);
      await activatePortfolioStorageScope('legacy');
    }
  });

  it('falls back to the scoped localStorage history when an IndexedDB read transaction stalls', async () => {
    vi.useFakeTimers();
    const expectedHistory = {
      brokerExecutedTrades: [{ id: 'cached-trade' }],
      cashflows: [{ id: 'cached-cashflow' }]
    };
    storageMap.set('portfolio_closed_history_v1', JSON.stringify(expectedHistory));
    const historyRequest = {} as IDBRequest<unknown>;
    const transaction = {
      objectStore: () => ({ get: () => historyRequest }),
      abort: vi.fn()
    } as unknown as IDBTransaction;
    const database = {
      objectStoreNames: { contains: () => true },
      transaction: () => transaction,
      close: vi.fn()
    } as unknown as IDBDatabase;
    const openRequest = {
      result: database,
      error: null,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      onblocked: null
    } as unknown as IDBOpenDBRequest;

    try {
      vi.stubGlobal('indexedDB', {
        open: vi.fn(() => {
          void Promise.resolve().then(() => {
            openRequest.onsuccess?.call(openRequest, new Event('success') as IDBVersionChangeEvent);
          });
          return openRequest;
        })
      } as unknown as IDBFactory);

      const initialization = initializeSavedHistoryStorage('legacy');
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(initialization).resolves.toBeUndefined();

      expect(transaction.abort).toHaveBeenCalledTimes(1);
      expect(loadSavedHistory()).toEqual(expectedHistory);
    } finally {
      vi.useRealTimers();
      vi.stubGlobal('indexedDB', undefined);
    }
  });

  it('reads the scoped local recovery copy without rewriting it when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const expectedHistory = {
      brokerExecutedTrades: [{ id: 'recovered-trade' }],
      cashflows: [{ id: 'recovered-cashflow' }]
    };
    const recoveryRaw = JSON.stringify(expectedHistory);
    storageMap.set('portfolio_closed_history_v1_recovery_v1', recoveryRaw);
    localStorageMock.setItem.mockClear();

    await expect(initializeSavedHistoryStorage('legacy')).resolves.toBeUndefined();

    expect(loadSavedHistory()).toEqual(expectedHistory);
    expect(storageMap.get('portfolio_closed_history_v1_recovery_v1')).toBe(recoveryRaw);
    expect(storageMap.has('portfolio_closed_history_v1')).toBe(false);
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalledWith(
      'Recovered closed history from a scoped local recovery copy.'
    );
  });

  describe('saveState', () => {
    it('persists state to localStorage and updates lastUpdated', () => {
      const state = { activeView: 'AAPL', balance: 1200, lastUpdated: Date.now() };
      const beforeTime = Date.now();

      expect(saveState(state)).toBe(true);

      const afterTime = Date.now();
      expect(state.lastUpdated).toBeGreaterThanOrEqual(beforeTime);
      expect(state.lastUpdated).toBeLessThanOrEqual(afterTime);

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'margin_portfolio_state_dynamic_v2',
        expect.any(String)
      );

      const savedJson = storageMap.get('margin_portfolio_state_dynamic_v2');
      expect(savedJson).toBeDefined();

      const parsed = JSON.parse(savedJson!);
      expect(parsed.activeView).toBe('AAPL');
      expect(parsed.balance).toBe(1200);
      expect(parsed.lastUpdated).toBe(state.lastUpdated);
    });

    it('never persists gatewaySecret from the runtime state', () => {
      const state = { activeView: 'AAPL', gatewaySecret: 'plaintext-sensitive-secret' };
      expect(saveState(state)).toBe(true);
      const persisted = JSON.parse(storageMap.get('margin_portfolio_state_dynamic_v2')!);
      expect(persisted).not.toHaveProperty('gatewaySecret');
      expect(state.gatewaySecret).toBe('plaintext-sensitive-secret');
    });

    it('triggers onPushToGist callback with false when provided', () => {
      const onPushToGist = vi.fn();
      const state = { activeView: 'NVDA' };

      saveState(state, onPushToGist);

      expect(onPushToGist).toHaveBeenCalledTimes(1);
      expect(onPushToGist).toHaveBeenCalledWith(false);
    });

    it('handles null, undefined, and non-object states gracefully without throwing', () => {
      expect(() => saveState(null)).not.toThrow();
      expect(() => saveState(undefined)).not.toThrow();
      expect(() => saveState('non-object' as unknown as Record<string, unknown>)).not.toThrow();
      expect(() => saveState(123 as unknown as Record<string, unknown>)).not.toThrow();
      expect(localStorageMock.setItem).not.toHaveBeenCalled();
    });

    it('returns false when persistence fails and does not trigger a sync callback', () => {
      const onPushToGist = vi.fn();
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new Error('quota exceeded');
      });

      expect(saveState({ activeView: 'AAPL' }, onPushToGist)).toBe(false);
      expect(onPushToGist).not.toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    it('commits compact portfolio state even when the legacy localStorage history fallback is full', async () => {
      vi.stubGlobal('indexedDB', undefined);
      const previousState = JSON.stringify({ activeView: 'AAPL', balance: 100 });
      const previousHistory = JSON.stringify({
        brokerExecutedTrades: [{ id: 'old-trade' }],
        cashflows: [{ id: 'old-fee' }]
      });
      storageMap.set('margin_portfolio_state_dynamic_v2', previousState);
      storageMap.set('portfolio_closed_history_v1', previousHistory);
      const state = {
        activeView: 'MSFT',
        balance: 250,
        lastUpdated: 123,
        brokerExecutedTrades: [{ id: 'new-trade' }],
        cashflows: [{ id: 'new-fee' }]
      };
      const onPushToGist = vi.fn();
      localStorageMock.setItem.mockImplementation((key: string, value: string) => {
        if (key === 'portfolio_closed_history_v1') {
          const error = new Error('quota exceeded') as Error & { name: string };
          error.name = 'QuotaExceededError';
          throw error;
        }
        storageMap.set(key, String(value));
      });

      expect(saveState(state, onPushToGist)).toBe(true);
      await flushSavedHistoryPersistence();
      expect(JSON.parse(storageMap.get('margin_portfolio_state_dynamic_v2')!)).toMatchObject({
        activeView: 'MSFT',
        balance: 250
      });
      expect(storageMap.get('portfolio_closed_history_v1')).toBe(previousHistory);
      expect(state.lastUpdated).not.toBe(123);
      expect(onPushToGist).toHaveBeenCalledWith(false);
    });

    it('commits blank portfolio, explicit empty IndexedDB history, and device view together', async () => {
      const state = { activeView: 'COMBINED', balance: 0, lastUpdated: 123 };
      storageMap.set('margin_portfolio_state_dynamic_v2', JSON.stringify({ activeView: 'AAPL', balance: 100 }));
      storageMap.set('portfolio_closed_history_v1', JSON.stringify({
        brokerExecutedTrades: [{ id: 'old-trade' }],
        cashflows: [{ id: 'old-fee' }]
      }));
      storageMap.set('portfolio_active_view', 'AAPL');

      expect(await savePortfolioSnapshot(
        state,
        { brokerExecutedTrades: [], cashflows: [] },
        { deviceActiveView: 'COMBINED' }
      )).toBe(true);

      expect(JSON.parse(storageMap.get('margin_portfolio_state_dynamic_v2')!)).toMatchObject({
        activeView: 'COMBINED',
        balance: 0
      });
      expect(loadSavedHistory()).toEqual({ brokerExecutedTrades: [], cashflows: [] });
      if (typeof indexedDB !== 'undefined') {
        expect(storageMap.has('portfolio_closed_history_v1')).toBe(false);
      } else {
        expect(JSON.parse(storageMap.get('portfolio_closed_history_v1')!)).toEqual({
          brokerExecutedTrades: [], cashflows: []
        });
      }
      expect(storageMap.get('portfolio_active_view')).toBe('COMBINED');
      expect(state.lastUpdated).toBeGreaterThanOrEqual(123);
    });

    it('rolls back IndexedDB history when a later device-preference write fails', async () => {
      const previousState = JSON.stringify({ activeView: 'AAPL', balance: 100 });
      const previousHistory = JSON.stringify({
        brokerExecutedTrades: [{ id: 'old-trade' }],
        cashflows: [{ id: 'old-fee' }]
      });
      storageMap.set('margin_portfolio_state_dynamic_v2', previousState);
      storageMap.set('portfolio_closed_history_v1', previousHistory);
      storageMap.set('portfolio_active_view', 'AAPL');
      const state = { activeView: 'COMBINED', balance: 0, lastUpdated: 123 };
      localStorageMock.setItem.mockImplementation((key: string, value: string) => {
        if (key === 'portfolio_active_view') throw new Error('storage unavailable');
        storageMap.set(key, String(value));
      });

      expect(await savePortfolioSnapshot(
        state,
        { brokerExecutedTrades: [], cashflows: [] },
        { deviceActiveView: 'COMBINED' }
      )).toBe(false);

      expect(storageMap.get('margin_portfolio_state_dynamic_v2')).toBe(previousState);
      expect(loadSavedHistory()).toEqual(JSON.parse(previousHistory));
      expect(storageMap.get('portfolio_active_view')).toBe('AAPL');
      expect(state.lastUpdated).toBe(123);
    });

    it('does not throw when localStorage is undefined', () => {
      vi.stubGlobal('localStorage', undefined);
      expect(() => saveState({ activeView: 'TSLA' })).not.toThrow();
    });
  });

  describe('portfolio state persistence without closed-history cache rewrite', () => {
    it('saves portfolio state without rewriting an oversized local history sidecar', () => {
      const previousState = JSON.stringify({ activeView: 'AAPL', balance: 100 });
      const previousHistory = JSON.stringify({
        brokerExecutedTrades: [{ id: 'previous-history-is-retained' }],
        cashflows: [{ id: 'previous-cashflow-is-retained' }]
      });
      storageMap.set('margin_portfolio_state_dynamic_v2', previousState);
      storageMap.set('portfolio_closed_history_v1', previousHistory);
      localStorageMock.setItem.mockImplementation((key: string, value: string) => {
        if (key === 'portfolio_closed_history_v1') {
          const error = new Error('Quota exceeded') as Error & { name: string };
          error.name = 'QuotaExceededError';
          throw error;
        }
        storageMap.set(key, String(value));
      });

      const state = {
        activeView: 'COMBINED',
        balance: 250,
        brokerExecutedTrades: [{ id: 'full-history-is-checkpointed-in-cloud' }],
        cashflows: [{ id: 'full-cashflows-are-checkpointed-in-cloud' }]
      };

      expect(savePortfolioStateSnapshot(state)).toBe(true);
      expect(JSON.parse(storageMap.get('margin_portfolio_state_dynamic_v2')!)).toMatchObject({
        activeView: 'COMBINED',
        balance: 250
      });
      expect(storageMap.get('portfolio_closed_history_v1')).toBe(previousHistory);
      expect(loadSavedHistory()).toEqual({
        brokerExecutedTrades: [{ id: 'previous-history-is-retained' }],
        cashflows: [{ id: 'previous-cashflow-is-retained' }]
      });
      expect(localStorageMock.setItem).not.toHaveBeenCalledWith(
        'portfolio_closed_history_v1',
        expect.any(String)
      );
    });

    it('does not include raw execution/cashflow arrays in the compact portfolio snapshot', () => {
      const state = {
        activeView: 'COMBINED',
        balance: 0,
        brokerExecutedTrades: [{ id: 'trade-1' }],
        cashflows: [{ id: 'cashflow-1' }]
      };
      expect(savePortfolioStateSnapshot(state)).toBe(true);
      const saved = JSON.parse(storageMap.get('margin_portfolio_state_dynamic_v2')!);
      expect(saved).not.toHaveProperty('brokerExecutedTrades');
      expect(saved).not.toHaveProperty('cashflows');
    });
  });

  describe('loadSavedState', () => {
    it('handles missing payload gracefully and returns fallback state', () => {
      const fallback = { activeView: 'COMBINED', balance: 0 };
      const loaded = loadSavedState(fallback);

      expect(loaded).toEqual(expect.objectContaining(fallback));
    });

    it('handles empty string payload gracefully and returns fallback state', () => {
      storageMap.set('portfolio_state', '');
      storageMap.set('margin_portfolio_state_dynamic_v2', '');

      const fallback = { activeView: 'COMBINED', balance: 500 };
      const loaded = loadSavedState(fallback);

      expect(loaded).toEqual(fallback);
    });

    it('handles corrupted JSON payloads gracefully and returns exact fallback state', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      storageMap.set('portfolio_state', '{"broken_json: true,');
      storageMap.set('margin_portfolio_state_dynamic_v2', '{"broken_json: true,');

      const fallback = { activeView: 'DEFAULT', balance: 1500 };
      const loaded = loadSavedState(fallback);

      expect(loaded).toEqual(fallback);
      expect(warnSpy.mock.calls.some(([entry]) => {
        const value = String(entry);
        return value.includes('"category":"browser-storage"') &&
          value.includes('"errorClass":"malformed-data"');
      })).toBe(true);
      expect(warnSpy.mock.calls.flat().join(' ')).not.toContain('broken_json');
      warnSpy.mockRestore();
    });

    it('loads and merges valid state when present in localStorage', () => {
      const savedPayload = { activeView: 'GOOGL', balance: 3400 };
      storageMap.set('portfolio_state', JSON.stringify(savedPayload));
      storageMap.set('margin_portfolio_state_dynamic_v2', JSON.stringify(savedPayload));

      const fallback = { activeView: 'COMBINED', balance: 0, testField: 'preserved' };
      const loaded = loadSavedState(fallback);

      expect(loaded.activeView).toBe('GOOGL');
      expect(loaded.balance).toBe(3400);
    });

    it('recovers the legacy snapshot when the current snapshot contains invalid JSON', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      storageMap.set('margin_portfolio_state_dynamic_v2', '{"broken');
      storageMap.set('portfolio_state', JSON.stringify({ activeView: 'MSFT', balance: -250 }));

      expect(loadSavedState({ activeView: 'COMBINED', balance: 0 })).toEqual({
        activeView: 'MSFT',
        balance: -250
      });
      expect(warnSpy.mock.calls.some(([entry]) => {
        const value = String(entry);
        return value.includes('"category":"browser-storage"') &&
          value.includes('"errorClass":"malformed-data"');
      })).toBe(true);
      expect(warnSpy.mock.calls.flat().join(' ')).not.toContain('broken_json');
      warnSpy.mockRestore();
    });

    it('keeps the last committed full portfolio snapshot in IndexedDB instead of duplicating it in localStorage', async () => {
      if (typeof indexedDB === 'undefined') return;

      const current = { activeView: 'AAPL', balance: 125 };
      const previous = { activeView: 'GOOGL', balance: 100 };
      storageMap.set('margin_portfolio_state_dynamic_v2', JSON.stringify(current));
      storageMap.set('margin_portfolio_state_dynamic_v2_recovery_v1', JSON.stringify(previous));

      await initializePortfolioStateRecoveryStorage('legacy');

      expect(storageMap.get('margin_portfolio_state_dynamic_v2')).toBe(JSON.stringify(current));
      expect(storageMap.has('margin_portfolio_state_dynamic_v2_recovery_v1')).toBe(false);

      const next = { activeView: 'MSFT', balance: 250 };
      localStorageMock.setItem.mockImplementation((key: string, value: string) => {
        if (key === 'margin_portfolio_state_dynamic_v2_recovery_v1') {
          const error = new Error('Quota exceeded') as Error & { name: string };
          error.name = 'QuotaExceededError';
          throw error;
        }
        storageMap.set(key, String(value));
      });

      expect(saveState(next)).toBe(true);
      await flushPortfolioStateRecoveryPersistence();

      expect(storageMap.get('margin_portfolio_state_dynamic_v2')).toContain('"activeView":"MSFT"');
      expect(storageMap.has('margin_portfolio_state_dynamic_v2_recovery_v1')).toBe(false);
      expect(localStorageMock.setItem).not.toHaveBeenCalledWith(
        'margin_portfolio_state_dynamic_v2_recovery_v1',
        expect.any(String)
      );

      // A fresh workspace activation restores the active snapshot from the
      // scoped IndexedDB record even if the local canonical copy is damaged.
      storageMap.set('margin_portfolio_state_dynamic_v2', '{damaged-after-page-reload');
      await activatePortfolioStorageScope('legacy');
      expect(loadSavedState({ activeView: 'COMBINED', balance: 0 })).toMatchObject(next);
      expect(JSON.parse(storageMap.get('margin_portfolio_state_dynamic_v2') || 'null')).toMatchObject(next);

      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('portfolio-terminal-history-cache', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Could not open portfolio recovery test database.'));
      });
      try {
        const records = await new Promise<{ current: unknown; recovery: unknown }>((resolve, reject) => {
          const transaction = db.transaction('history', 'readonly');
          const store = transaction.objectStore('history');
          const currentRequest = store.get('portfolio-state-v1');
          const recoveryRequest = store.get('portfolio-state-v1:last-known-good');
          let currentRecord: unknown;
          let recoveryRecord: unknown;
          currentRequest.onsuccess = () => { currentRecord = currentRequest.result; };
          recoveryRequest.onsuccess = () => { recoveryRecord = recoveryRequest.result; };
          transaction.oncomplete = () => resolve({ current: currentRecord, recovery: recoveryRecord });
          transaction.onerror = () => reject(transaction.error || new Error('Could not read portfolio recovery test records.'));
          transaction.onabort = () => reject(transaction.error || new Error('Portfolio recovery test read was aborted.'));
        });
        expect(records.current).toMatchObject({ activeView: 'MSFT', balance: 250 });
        expect(records.recovery).toMatchObject({ activeView: 'AAPL', balance: 125 });
      } finally {
        db.close();
      }
    });

    it('chooses the newest complete same-account snapshot when localStorage lags IndexedDB', async () => {
      if (typeof indexedDB === 'undefined') return;

      const staleLocal = { activeView: 'AAPL', balance: 100, lastUpdated: 100 };
      const localRecovery = { activeView: 'MSFT', balance: 150, lastUpdated: 150 };
      const latestIndexed = { activeView: 'GOOGL', balance: 300, lastUpdated: 300 };
      const previousIndexed = { activeView: 'TSLA', balance: 200, lastUpdated: 200 };
      storageMap.set('margin_portfolio_state_dynamic_v2', JSON.stringify(staleLocal));
      storageMap.set('margin_portfolio_state_dynamic_v2_recovery_v1', JSON.stringify(localRecovery));

      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('portfolio-terminal-history-cache', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Could not open stale-snapshot test database.'));
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('history', 'readwrite');
        const store = transaction.objectStore('history');
        store.put(latestIndexed, 'portfolio-state-v1');
        store.put(previousIndexed, 'portfolio-state-v1:last-known-good');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('Could not seed IndexedDB portfolio snapshots.'));
        transaction.onabort = () => reject(transaction.error || new Error('IndexedDB portfolio snapshot seed was aborted.'));
      });
      db.close();

      await initializePortfolioStateRecoveryStorage('legacy');

      expect(loadSavedState({ activeView: 'COMBINED', balance: 0 })).toMatchObject({
        activeView: 'GOOGL',
        balance: 300,
        lastUpdated: 300
      });
      expect(JSON.parse(storageMap.get('margin_portfolio_state_dynamic_v2') || 'null')).toMatchObject(latestIndexed);
      expect(storageMap.has('margin_portfolio_state_dynamic_v2_recovery_v1')).toBe(false);

      const verifyDb = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('portfolio-terminal-history-cache', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Could not reopen stale-snapshot test database.'));
      });
      const recovery = await new Promise<unknown>((resolve, reject) => {
        const transaction = verifyDb.transaction('history', 'readonly');
        const request = transaction.objectStore('history').get('portfolio-state-v1:last-known-good');
        request.onsuccess = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error || new Error('Could not verify IndexedDB recovery snapshot.'));
      });
      verifyDb.close();
      expect(recovery).toMatchObject(previousIndexed);
    });

    it('does not repair a damaged canonical key from an older local recovery row when IndexedDB has a newer snapshot', async () => {
      if (typeof indexedDB === 'undefined') return;
      const latest = { activeView: 'GOOGL', balance: 300, lastUpdated: 300 };
      const previous = { activeView: 'TSLA', balance: 200, lastUpdated: 200 };
      const staleLocalRecovery = { activeView: 'AAPL', balance: 100, lastUpdated: 100 };
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('portfolio-terminal-history-cache', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Could not open stale-local recovery database.'));
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('history', 'readwrite');
        const store = transaction.objectStore('history');
        store.put(latest, 'portfolio-state-v1');
        store.put(previous, 'portfolio-state-v1:last-known-good');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('Could not seed latest portfolio recovery.'));
        transaction.onabort = () => reject(transaction.error || new Error('Latest portfolio recovery seed was aborted.'));
      });
      db.close();

      await initializePortfolioStateRecoveryStorage('legacy');
      storageMap.set('margin_portfolio_state_dynamic_v2', '{damaged-active-snapshot');
      storageMap.set('margin_portfolio_state_dynamic_v2_recovery_v1', JSON.stringify(staleLocalRecovery));

      expect(loadSavedState({ activeView: 'COMBINED', balance: 0 })).toMatchObject(latest);
      expect(JSON.parse(storageMap.get('margin_portfolio_state_dynamic_v2') || 'null')).toMatchObject(latest);
    });

    it('coalesces same-turn saves while retaining the last committed recovery baseline', async () => {
      if (typeof indexedDB === 'undefined') return;
      const baseline = { activeView: 'AAPL', balance: 100, lastUpdated: 100 };
      const intermediate = { activeView: 'MSFT', balance: 200, lastUpdated: 200 };
      const latest = { activeView: 'GOOGL', balance: 300, lastUpdated: 300 };
      storageMap.set('margin_portfolio_state_dynamic_v2', JSON.stringify(baseline));
      await initializePortfolioStateRecoveryStorage('legacy');

      expect(saveState(intermediate)).toBe(true);
      expect(saveState(latest)).toBe(true);
      await flushPortfolioStateRecoveryPersistence();

      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('portfolio-terminal-history-cache', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Could not open coalesced portfolio recovery database.'));
      });
      const records = await new Promise<{ current: unknown; recovery: unknown }>((resolve, reject) => {
        const transaction = db.transaction('history', 'readonly');
        const store = transaction.objectStore('history');
        const currentRequest = store.get('portfolio-state-v1');
        const recoveryRequest = store.get('portfolio-state-v1:last-known-good');
        let current: unknown;
        let recovery: unknown;
        currentRequest.onsuccess = () => { current = currentRequest.result; };
        recoveryRequest.onsuccess = () => { recovery = recoveryRequest.result; };
        transaction.oncomplete = () => resolve({ current, recovery });
        transaction.onerror = () => reject(transaction.error || new Error('Could not verify coalesced portfolio recovery records.'));
        transaction.onabort = () => reject(transaction.error || new Error('Coalesced portfolio recovery read was aborted.'));
      });
      db.close();

      expect(records.current).toMatchObject(latest);
      expect(records.recovery).toMatchObject(baseline);
    });

    it('retains the local recovery snapshot when IndexedDB is unavailable', async () => {
      vi.stubGlobal('indexedDB', undefined);
      const current = JSON.stringify({ activeView: 'MSFT', balance: 250 });
      const previous = JSON.stringify({ activeView: 'AAPL', balance: 125 });
      storageMap.set('margin_portfolio_state_dynamic_v2', current);
      storageMap.set('margin_portfolio_state_dynamic_v2_recovery_v1', previous);

      await initializePortfolioStateRecoveryStorage('legacy');

      expect(storageMap.get('margin_portfolio_state_dynamic_v2')).toBe(current);
      expect(storageMap.get('margin_portfolio_state_dynamic_v2_recovery_v1')).toBe(previous);
    });

    it('never reads another account scope recovery snapshot', async () => {
      await activatePortfolioStorageScope('owner');
      storageMap.set('margin_portfolio_state_dynamic_v2_recovery_v1::owner', JSON.stringify({
        balance: 900,
        activeView: 'OWNER'
      }));

      await activatePortfolioStorageScope('guest:local-recovery-a');
      expect(loadSavedState({ balance: 0, activeView: 'COMBINED' })).toEqual({
        balance: 0,
        activeView: 'COMBINED'
      });
    });

    it('recovers the legacy snapshot when the current snapshot is not an object', () => {
      storageMap.set('margin_portfolio_state_dynamic_v2', JSON.stringify(['invalid-shape']));
      storageMap.set('portfolio_state', JSON.stringify({ activeView: 'AAPL', balance: 125 }));

      expect(loadSavedState({ activeView: 'COMBINED', balance: 0 })).toEqual({
        activeView: 'AAPL',
        balance: 125
      });
    });

    it('returns fallback state when localStorage is undefined', () => {
      vi.stubGlobal('localStorage', undefined);
      const fallback = { activeView: 'COMBINED' };

      expect(loadSavedState(fallback)).toBe(fallback);
    });

    it('does not access or mutate DOM elements while loading saved state', () => {
      storageMap.set('gateway_secret', 'secret-token-xyz');
      const getElementById = vi.fn();

      if (typeof document !== 'undefined') {
        vi.spyOn(document, 'getElementById').mockImplementation(getElementById);
      } else {
        vi.stubGlobal('document', { getElementById });
      }

      const fallback = { activeView: 'COMBINED' };
      expect(loadSavedState(fallback)).toBe(fallback);
      expect(getElementById).not.toHaveBeenCalled();
    });
  });

  describe('gateway secret & header credentials', () => {
    it('gets, sets and clears gateway secret', () => {
      expect(getGatewaySecret()).toBe('');
      expect(areHeaderCredentialsConfigured()).toBe(false);

      setGatewaySecret('my-secret-key');
      expect(getGatewaySecret()).toBe('my-secret-key');
      expect(areHeaderCredentialsConfigured()).toBe(true);

      setGatewaySecret('');
      expect(getGatewaySecret()).toBe('');
      expect(areHeaderCredentialsConfigured()).toBe(false);
    });

    it('keeps gateway secret in memory and purges persisted legacy credentials', () => {
      const secret = 'super-secret-token-123';
      storageMap.set('_gw_auth', 'b64:c3VwZXItc2VjcmV0LXRva2VuLTEyMw==');
      storageMap.set('gateway_secret', secret);

      saveGatewaySecret(secret);

      expect(getGatewaySecret()).toBe(secret);
      expect(storageMap.has('_gw_auth')).toBe(false);
      expect(storageMap.has('gateway_secret')).toBe(false);
      expect(loadGatewaySecret()).toBe(secret);
    });

    it('does not store the Gateway Secret in plaintext and safely falls back when secure storage is unavailable', async () => {
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.stubGlobal('indexedDB', undefined);
      saveGatewaySecret('private-device-secret');
      const persisted = await persistGatewaySecret();

      expect(persisted).toBe(false);
      expect(getGatewaySecret()).toBe('private-device-secret');
      expect(storageMap.has('_gw_auth')).toBe(false);
      expect(storageMap.has('gateway_secret')).toBe(false);
      expect([...storageMap.values()].join('|')).not.toContain('private-device-secret');

      setGatewaySecret('');
      expect(await restoreGatewaySecret()).toBe('');
      warning.mockRestore();
    });

    it('does not create reversible client-side secret encodings', () => {
      expect(obfuscateSecret('my-gateway-password')).toBe('');
      expect(deobfuscateSecret('b64:bXktZ2F0ZXdheS1wYXNzd29yZA==')).toBe('');
      expect(obfuscateSecret('')).toBe('');
      expect(deobfuscateSecret('')).toBe('');
    });

    it('saveApiKeys reports the actual device-persistence result', async () => {
      const showToast = vi.fn();
      const logAppMessage = vi.fn();
      const secureStorageAvailable = typeof indexedDB !== 'undefined' && Boolean(globalThis.crypto?.subtle);

      const result = await saveApiKeys({
        secret: 'test-gateway-secret',
        showToast,
        logAppMessage
      });

      expect(getGatewaySecret()).toBe('test-gateway-secret');
      if (secureStorageAvailable) {
        expect(result).toBe(true);
        expect(logAppMessage).toHaveBeenCalledWith(expect.stringContaining('Remote access has not been verified'));
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Remote access has not been verified'), 'success');
      } else {
        expect(result).toBe(false);
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('secure device storage failed'), 'error');
        expect(showToast).not.toHaveBeenCalledWith(expect.any(String), 'success');
      }
    });

    it('bounds stalled secure IndexedDB open requests and preserves encrypted credentials', async () => {
      vi.useFakeTimers();
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        setGatewaySecret('');
        const encryptedPayload = JSON.stringify({ version: 1, iv: Array(12).fill(1), data: [2, 3, 4] });
        storageMap.set('gateway_secret_encrypted_v1', encryptedPayload);
        vi.stubGlobal('crypto', { subtle: { decrypt: vi.fn() } });
        vi.stubGlobal('indexedDB', { open: vi.fn(() => ({})) } as unknown as IDBFactory);

        const restoring = restoreGatewaySecret();
        await vi.advanceTimersByTimeAsync(5_000);
        await expect(restoring).resolves.toBe('');
        expect(storageMap.get('gateway_secret_encrypted_v1')).toBe(encryptedPayload);
      } finally {
        warning.mockRestore();
        vi.useRealTimers();
      }
    });

    it('does not mint a replacement device key when the saved key is missing', async () => {
      setGatewaySecret('');
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const encryptedPayload = JSON.stringify({ version: 1, iv: Array(12).fill(1), data: [2, 3, 4] });
        storageMap.set('gateway_secret_encrypted_v1', encryptedPayload);

        const keyReadRequest = {
          result: undefined,
          onsuccess: null,
          onerror: null,
          error: null
        } as unknown as IDBRequest<CryptoKey>;
        let readTransaction: IDBTransaction;
        readTransaction = {
          objectStore: () => ({
            get: () => {
              queueMicrotask(() => {
                keyReadRequest.onsuccess?.call(keyReadRequest, new Event('success'));
                queueMicrotask(() => readTransaction.oncomplete?.call(readTransaction, new Event('complete')));
              });
              return keyReadRequest;
            }
          }),
          abort: vi.fn(),
          oncomplete: null,
          onerror: null,
          onabort: null,
          error: null
        } as unknown as IDBTransaction;
        const database = {
          objectStoreNames: { contains: () => true },
          transaction: () => readTransaction,
          close: vi.fn()
        } as unknown as IDBDatabase & { close: ReturnType<typeof vi.fn> };
        const openRequest = {
          result: database,
          error: null,
          onupgradeneeded: null,
          onsuccess: null,
          onerror: null,
          onblocked: null
        } as unknown as IDBOpenDBRequest;
        const generateKey = vi.fn();
        vi.stubGlobal('crypto', { subtle: { decrypt: vi.fn(), generateKey } });
        vi.stubGlobal('indexedDB', {
          open: vi.fn(() => {
            queueMicrotask(() => openRequest.onsuccess?.call(openRequest, new Event('success')));
            return openRequest;
          })
        } as unknown as IDBFactory);

        await expect(restoreGatewaySecret()).resolves.toBe('');
        expect(generateKey).not.toHaveBeenCalled();
        expect(storageMap.get('gateway_secret_encrypted_v1')).toBe(encryptedPayload);
        expect(database.close).toHaveBeenCalledTimes(1);
      } finally {
        warning.mockRestore();
      }
    });

    it('preserves encrypted device credentials when IndexedDB is temporarily unavailable', async () => {
      setGatewaySecret('');
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const encryptedPayload = JSON.stringify({ version: 1, iv: Array(12).fill(1), data: [2, 3, 4] });
      storageMap.set('gateway_secret_encrypted_v1', encryptedPayload);
      vi.stubGlobal('indexedDB', undefined);

      expect(await restoreGatewaySecret()).toBe('');
      expect(storageMap.get('gateway_secret_encrypted_v1')).toBe(encryptedPayload);
      expect(getGatewaySecret()).toBe('');

      warning.mockRestore();
    });

    it('saveApiKeys reports secure storage failure instead of success', async () => {
      vi.stubGlobal('indexedDB', undefined);
      const showToast = vi.fn();
      const logAppMessage = vi.fn();

      const result = await saveApiKeys({
        secret: 'test-gateway-secret',
        showToast,
        logAppMessage
      });

      expect(result).toBe(false);
      expect(getGatewaySecret()).toBe('test-gateway-secret');
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('secure device storage failed'), 'error');
      expect(showToast).not.toHaveBeenCalledWith(expect.any(String), 'success');
      expect(logAppMessage).toHaveBeenCalledWith(expect.stringContaining('may need to be entered again after refresh'));
    });

    it('saveApiKeys rejects empty secret', async () => {
      const showToast = vi.fn();
      const result = await saveApiKeys({ secret: '   ', showToast });

      expect(result).toBe(false);
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Please enter'), 'error');
    });
  });

  describe('broker rules', () => {
    const canonicalRules = {
      broker: 'Freedom Broker Armenia (Tradernet)', annualBorrowRate: 0.12, dayCountBasis: 360 as const,
      rolloverHour: 5, rolloverMinute: 30, rolloverTimeZone: 'Asia/Yerevan',
      maintenanceEquityRatio: 0.2, stopOutRatio: 0.01, commissionMin: 2,
      commissionPerShare: 0.02, commissionRatePct: 0.002
    };
    it('round-trips canonical assumptions without changing their values', () => {
      expect(loadBrokerRules()).toBeNull();
      saveBrokerRules(canonicalRules);
      expect(loadBrokerRules()).toEqual(canonicalRules);
    });
    it('leaves legacy payloads unknown for the domain compatibility boundary', () => {
      const legacy = { annualRate: '0.13', dailyRolloverCutoffArmenia: '06:15',
        maintenanceMarginRatio: '0.18', commPerShare: '0.03' };
      storageMap.set('tradernet_rules_v1', JSON.stringify(legacy));
      expect(loadBrokerRules()).toEqual(legacy);
    });
    it('repairs malformed broker rules from the last-known-good scoped copy', () => {
      const original = { annualBorrowRate: 0.12, commissionPerShare: 0.02 };
      saveBrokerRules(original as never);
      saveBrokerRules({ annualBorrowRate: 0.18, commissionPerShare: 0.03 } as never);
      expect(storageMap.get('tradernet_rules_v1_recovery_v1')).toBe(JSON.stringify(original));

      storageMap.set('tradernet_rules_v1', '{broken');
      expect(loadBrokerRules()).toEqual(original);
      expect(storageMap.get('tradernet_rules_v1')).toBe(JSON.stringify(original));

      clearBrokerRules();
      expect(storageMap.has('tradernet_rules_v1_recovery_v1')).toBe(false);
    });

    it('recovers broker assumptions when the stored JSON root shape is invalid', () => {
      const previous = { annualBorrowRate: 0.12, commissionPerShare: 0.02 };
      saveBrokerRules(previous as never);
      saveBrokerRules({ annualBorrowRate: 0.18, commissionPerShare: 0.03 } as never);
      storageMap.set('tradernet_rules_v1', '[]');

      expect(loadBrokerRules()).toEqual(previous);
      expect(storageMap.get('tradernet_rules_v1')).toBe(JSON.stringify(previous));
    });

    it('returns null for malformed JSON and absent settings', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      storageMap.set('tradernet_rules_v1', '{"broken');
      expect(loadBrokerRules()).toBeNull();
      expect(warnSpy.mock.calls.some(([entry]) => {
        const value = String(entry);
        return value.includes('"category":"browser-storage"') &&
          value.includes('"errorClass":"malformed-data"');
      })).toBe(true);
      expect(warnSpy.mock.calls.flat().join(' ')).not.toContain('malformed-secret');
      warnSpy.mockRestore();
      clearBrokerRules();
      expect(loadBrokerRules()).toBeNull();
    });
  });

  describe('quote refresh interval', () => {
    it('gets and sets refresh interval with fallback', () => {
      expect(getQuoteRefreshInterval(60000)).toBe(60000);
      saveQuoteRefreshInterval(15000);
      expect(getQuoteRefreshInterval(60000)).toBe(15000);
    });

    it('keeps guest refresh defaults and preferences separate from admin settings', () => {
      saveQuoteRefreshInterval(60000, 'admin');

      expect(getQuoteRefreshInterval(15000, 'guest')).toBe(15000);
      expect(getQuoteRefreshInterval(60000, 'admin')).toBe(60000);

      saveQuoteRefreshInterval(30000, 'guest');
      expect(getQuoteRefreshInterval(15000, 'guest')).toBe(30000);
      expect(getQuoteRefreshInterval(60000, 'admin')).toBe(60000);
    });

    it('falls back safely when a saved interval is unsupported or malformed', () => {
      storageMap.set('quote_refresh_interval', '20000');
      storageMap.set('quote_refresh_interval_guest_v1', 'not-a-number');
      expect(getQuoteRefreshInterval(60000, 'admin')).toBe(60000);
      expect(getQuoteRefreshInterval(15000, 'guest')).toBe(15000);

      // Legacy users who previously selected Off are migrated to their role default.
      storageMap.set('quote_refresh_interval', '0');
      storageMap.set('quote_refresh_interval_guest_v1', '0');
      expect(getQuoteRefreshInterval(60000, 'admin')).toBe(60000);
      expect(getQuoteRefreshInterval(15000, 'guest')).toBe(15000);
    });

    it('does not persist unsupported or disabled refresh intervals', () => {
      saveQuoteRefreshInterval(20000, 'admin');
      saveQuoteRefreshInterval(0, 'guest');
      expect(storageMap.has('quote_refresh_interval')).toBe(false);
      expect(storageMap.has('quote_refresh_interval_guest_v1')).toBe(false);
    });
  });

  describe('workspace disclosure preferences', () => {
    it('isolates panel choices between owner and guest scopes', async () => {
      await activatePortfolioStorageScope('owner');
      saveWorkspaceDisclosurePreferences({ performanceOpen: true, projectionsOpen: false, researchOpen: true });
      expect(getWorkspaceDisclosurePreferences()).toEqual({
        performanceOpen: true, projectionsOpen: false, researchOpen: true
      });

      await activatePortfolioStorageScope('guest:combined-disclosures-a');
      expect(getWorkspaceDisclosurePreferences()).toEqual({});
      saveWorkspaceDisclosurePreferences({ researchOpen: false });
      expect(getWorkspaceDisclosurePreferences()).toEqual({ researchOpen: false });

      await activatePortfolioStorageScope('guest:combined-disclosures-b');
      expect(getWorkspaceDisclosurePreferences()).toEqual({});
      await activatePortfolioStorageScope('owner');
      expect(getWorkspaceDisclosurePreferences()).toEqual({
        performanceOpen: true, projectionsOpen: false, researchOpen: true
      });
      await activatePortfolioStorageScope('legacy');
    });

    it('ignores malformed values and unknown fields', () => {
      storageMap.set('portfolio_workspace_disclosures_v1', JSON.stringify({
        performanceOpen: 'yes', projectionsOpen: true, researchOpen: false, unrelated: 'ignored'
      }));
      expect(getWorkspaceDisclosurePreferences()).toEqual({ projectionsOpen: true, researchOpen: false });
    });

    it('handles unavailable browser storage safely', () => {
      vi.stubGlobal('localStorage', undefined);
      expect(getWorkspaceDisclosurePreferences()).toEqual({});
      expect(() => saveWorkspaceDisclosurePreferences({ researchOpen: true })).not.toThrow();
    });
  });

  describe('separate closed history persistence', () => {
    it('migrates history embedded in a legacy portfolio snapshot without rewriting localStorage', async () => {
      const expected = {
        brokerExecutedTrades: [{ id: 'legacy-trade', ticker: 'AAPL' }],
        cashflows: [{ id: 'legacy-fee', amount: -2 }]
      };
      storageMap.set('margin_portfolio_state_dynamic_v2', JSON.stringify(expected));

      await initializeSavedHistoryStorage();
      expect(loadSavedHistory()).toEqual(expected);
      // The rows came from the compact legacy state itself, not a local sidecar.
      // The migration must not create a duplicate localStorage history record.
      expect(storageMap.has('portfolio_closed_history_v1')).toBe(false);
    });

    it('recovers embedded history without overwriting an unreadable sidecar', () => {
      const damagedSidecar = '{"brokerExecutedTrades":';
      const expected = {
        brokerExecutedTrades: [{ id: 'recoverable-trade', ticker: 'MSFT' }],
        cashflows: [{ id: 'recoverable-fee', amount: -3 }]
      };
      storageMap.set('portfolio_closed_history_v1', damagedSidecar);
      storageMap.set('margin_portfolio_state_dynamic_v2', JSON.stringify(expected));
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(loadSavedHistory()).toEqual(expected);
      expect(storageMap.get('portfolio_closed_history_v1')).toBe(damagedSidecar);
      expect(warning.mock.calls.some(([entry]) => {
        const value = String(entry);
        return value.includes('"category":"closed-history"') &&
          value.includes('"errorClass":"malformed-data"');
      })).toBe(true);
    });

    it('restores a corrupt IndexedDB history row from its last-known-good record without merging rows', async () => {
      if (typeof indexedDB === 'undefined') return;
      const previous = {
        brokerExecutedTrades: [{ id: 'previous-trade' }],
        cashflows: [{ id: 'previous-cashflow' }]
      };
      const newest = {
        brokerExecutedTrades: [{ id: 'newest-trade' }],
        cashflows: [{ id: 'newest-cashflow' }]
      };
      await initializeSavedHistoryStorage('legacy');
      expect(await saveSavedHistory(previous)).toBe(true);
      expect(await saveSavedHistory(newest)).toBe(true);
      await flushSavedHistoryPersistence();

      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('portfolio-terminal-history-cache', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Could not open test history database'));
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('history', 'readwrite');
        transaction.objectStore('history').put({ damaged: true }, 'closed-history-v1');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('Could not corrupt test history row'));
        transaction.onabort = () => reject(transaction.error || new Error('Test history corruption aborted'));
      });
      db.close();

      await activatePortfolioStorageScope('guest:history-recovery-test');
      await activatePortfolioStorageScope('legacy');
      expect(loadSavedHistory()).toEqual(previous);
    });

    it('recovers history when its IndexedDB database is lost but the bounded local recovery copy remains', async () => {
      if (typeof indexedDB === 'undefined') return;
      const expected = {
        brokerExecutedTrades: [{ id: 'durable-recovery-trade' }],
        cashflows: [{ id: 'durable-recovery-cashflow' }]
      };

      await initializeSavedHistoryStorage('legacy');
      expect(await saveSavedHistory(expected)).toBe(true);
      await flushSavedHistoryPersistence();
      expect(JSON.parse(storageMap.get('portfolio_closed_history_v1_recovery_v1') || 'null')).toEqual(expected);
      expect(storageMap.has('portfolio_closed_history_v1')).toBe(false);

      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase('portfolio-terminal-history-cache');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error('Could not delete test history database'));
        request.onblocked = () => reject(new Error('Test history database deletion was blocked'));
      });

      await activatePortfolioStorageScope('guest:history-database-loss');
      await activatePortfolioStorageScope('legacy');
      expect(loadSavedHistory()).toEqual(expected);
    });

    it('uses blank IndexedDB recovery baselines after a committed portfolio reset', async () => {
      if (typeof indexedDB === 'undefined') return;
      const previousHistory = {
        brokerExecutedTrades: [{ id: 'before-reset-trade' }],
        cashflows: [{ id: 'before-reset-cashflow' }]
      };
      await initializeSavedHistoryStorage('legacy');
      expect(await saveSavedHistory(previousHistory)).toBe(true);
      storageMap.set('margin_portfolio_state_dynamic_v2', JSON.stringify({
        activeView: 'AAPL',
        balance: 500,
        positions: { AAPL: { shares: 10 } },
        transactionEvents: [{ type: 'trade.buy', id: 'before-reset-event' }]
      }));

      const resetState = {
        activeView: 'COMBINED',
        balance: 0,
        positions: {},
        transactionEvents: [{ type: 'portfolio.reset', id: 'reset-event' }]
      };
      expect(await savePortfolioSnapshot(
        resetState,
        { brokerExecutedTrades: [], cashflows: [] },
        { deviceActiveView: 'COMBINED' }
      )).toBe(true);

      await flushPortfolioStateRecoveryPersistence();
      expect(storageMap.has('margin_portfolio_state_dynamic_v2_recovery_v1')).toBe(false);
      const recoveryDb = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('portfolio-terminal-history-cache', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Could not open reset portfolio recovery database'));
      });
      const recoverySnapshot = await new Promise<unknown>((resolve, reject) => {
        const transaction = recoveryDb.transaction('history', 'readonly');
        const request = transaction.objectStore('history').get('portfolio-state-v1:last-known-good');
        request.onsuccess = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error || new Error('Could not read reset portfolio recovery'));
        transaction.onabort = () => reject(transaction.error || new Error('Reset portfolio recovery read was aborted'));
      });
      recoveryDb.close();
      expect(recoverySnapshot).toMatchObject({
        activeView: 'COMBINED',
        balance: 0,
        transactionEvents: [{ type: 'portfolio.reset' }]
      });

      storageMap.set('margin_portfolio_state_dynamic_v2', '{corrupted-after-reset');
      expect(loadSavedState({ activeView: 'DEFAULT', balance: 99 })).toMatchObject({
        activeView: 'COMBINED',
        balance: 0,
        transactionEvents: [{ type: 'portfolio.reset' }]
      });

      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('portfolio-terminal-history-cache', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Could not open reset history database'));
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('history', 'readwrite');
        transaction.objectStore('history').put({ damaged: true }, 'closed-history-v1');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('Could not damage reset history row'));
        transaction.onabort = () => reject(transaction.error || new Error('Reset history corruption aborted'));
      });
      db.close();

      await activatePortfolioStorageScope('guest:reset-recovery-check');
      await activatePortfolioStorageScope('legacy');
      expect(loadSavedHistory()).toEqual({ brokerExecutedTrades: [], cashflows: [] });
    });

    it('persists an explicit empty IndexedDB history snapshot so a full reset cannot restore old rows', async () => {
      storageMap.set('portfolio_closed_history_v1', JSON.stringify({
        brokerExecutedTrades: [{ id: 'old-trade' }],
        cashflows: [{ id: 'old-fee' }]
      }));
      await initializeSavedHistoryStorage();

      const indexedDbAvailable = typeof indexedDB !== 'undefined';
      expect(await saveSavedHistory({ brokerExecutedTrades: [], cashflows: [] })).toBe(true);
      expect(loadSavedHistory()).toEqual({ brokerExecutedTrades: [], cashflows: [] });
      if (indexedDbAvailable) {
        expect(storageMap.has('portfolio_closed_history_v1')).toBe(false);
      } else {
        expect(JSON.parse(storageMap.get('portfolio_closed_history_v1')!)).toEqual({
          brokerExecutedTrades: [], cashflows: []
        });
      }
    });

    it('preserves the last-known-good cache when IndexedDB and the bounded local history fallback both fail', async () => {
      const previous = {
        brokerExecutedTrades: [{ id: 'saved-trade-before-failed-write' }],
        cashflows: [{ id: 'saved-cashflow-before-failed-write' }]
      };
      const previousJson = JSON.stringify(previous);
      storageMap.set('portfolio_closed_history_v1', previousJson);
      vi.stubGlobal('indexedDB', undefined);
      await initializeSavedHistoryStorage();
      expect(loadSavedHistory()).toEqual(previous);

      localStorageMock.setItem.mockImplementation((key: string, value: string) => {
        if (key === 'portfolio_closed_history_v1') throw new Error('quota exceeded');
        storageMap.set(key, String(value));
      });

      expect(await saveSavedHistory({
        brokerExecutedTrades: Array.from({ length: 5000 }, (_, index) => ({
          id: String(index), raw: 'large-history-row'.repeat(20)
        })),
        cashflows: []
      })).toBe(false);

      expect(loadSavedHistory()).toEqual(previous);
      expect(storageMap.get('portfolio_closed_history_v1')).toBe(previousJson);
    });
  });

  it('preserves newer owner history when migration uses the localStorage fallback', async () => {
    const legacyHistory = {
      brokerExecutedTrades: [{ id: 'legacy-owner-trade' }],
      cashflows: [{ id: 'legacy-owner-cashflow' }]
    };
    const newerOwnerHistory = {
      brokerExecutedTrades: [{ id: 'new-owner-trade' }],
      cashflows: [{ id: 'new-owner-cashflow' }]
    };
    storageMap.set('portfolio_closed_history_v1', JSON.stringify(legacyHistory));
    vi.stubGlobal('indexedDB', undefined);

    await activatePortfolioStorageScope('owner', { migrateLegacy: true });
    expect(loadSavedHistory()).toEqual(legacyHistory);
    expect(await saveSavedHistory(newerOwnerHistory)).toBe(true);

    await activatePortfolioStorageScope('guest:history-fallback-check');
    await activatePortfolioStorageScope('owner', { migrateLegacy: true });

    expect(loadSavedHistory()).toEqual(newerOwnerHistory);
    expect(JSON.parse(storageMap.get('portfolio_closed_history_v1::owner') || 'null'))
      .toEqual(newerOwnerHistory);
    expect(JSON.parse(storageMap.get('portfolio_closed_history_v1') || 'null'))
      .toEqual(legacyHistory);
  });

  it('migrates retained legacy snapshots into owner IndexedDB before reclaiming localStorage quota', async () => {
    if (typeof indexedDB === 'undefined') return;
    await clearPortfolioStateRecoveryPersistence('owner');

    const legacyCurrent = {
      activeView: 'GOOGL',
      balance: 350,
      positions: { GOOGL: { shares: 5 } },
      lastUpdated: 300
    };
    const legacyRecovery = {
      activeView: 'AAPL',
      balance: 200,
      positions: { AAPL: { shares: 2 } },
      lastUpdated: 200
    };
    const olderLegacy = { activeView: 'MSFT', balance: 100, lastUpdated: 100 };
    storageMap.set('margin_portfolio_state_dynamic_v2', JSON.stringify(legacyCurrent));
    storageMap.set('margin_portfolio_state_dynamic_v2_recovery_v1', JSON.stringify(legacyRecovery));
    storageMap.set('portfolio_state', JSON.stringify(olderLegacy));

    await activatePortfolioStorageScope('owner', { migrateLegacy: true });

    expect(loadSavedState({})).toMatchObject(legacyCurrent);
    expect(storageMap.has('margin_portfolio_state_dynamic_v2')).toBe(false);
    expect(storageMap.has('margin_portfolio_state_dynamic_v2_recovery_v1')).toBe(false);
    expect(storageMap.has('portfolio_state')).toBe(false);
    expect(JSON.parse(storageMap.get('margin_portfolio_state_dynamic_v2::owner') || 'null'))
      .toMatchObject(legacyCurrent);

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('portfolio-terminal-history-cache::owner', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open owner portfolio recovery database.'));
    });
    const records = await new Promise<{ current: unknown; recovery: unknown }>((resolve, reject) => {
      const transaction = db.transaction('history', 'readonly');
      const store = transaction.objectStore('history');
      const currentRequest = store.get('portfolio-state-v1');
      const recoveryRequest = store.get('portfolio-state-v1:last-known-good');
      let current: unknown;
      let recovery: unknown;
      currentRequest.onsuccess = () => { current = currentRequest.result; };
      recoveryRequest.onsuccess = () => { recovery = recoveryRequest.result; };
      transaction.oncomplete = () => resolve({ current, recovery });
      transaction.onerror = () => reject(transaction.error || new Error('Could not verify owner portfolio recovery records.'));
      transaction.onabort = () => reject(transaction.error || new Error('Owner portfolio recovery read was aborted.'));
    });
    db.close();
    expect(records.current).toMatchObject(legacyCurrent);
    expect(records.recovery).toMatchObject(legacyRecovery);
  });

  it('keeps an existing owner IndexedDB portfolio when stale legacy data is malformed', async () => {
    if (typeof indexedDB === 'undefined') return;
    await clearPortfolioStateRecoveryPersistence('owner');
    const ownerCurrent = { activeView: 'GOOGL', balance: 350, lastUpdated: 300 };
    const ownerRecovery = { activeView: 'AAPL', balance: 200, lastUpdated: 200 };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('portfolio-terminal-history-cache::owner', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('history')) {
          request.result.createObjectStore('history');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open existing owner recovery database.'));
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('history', 'readwrite');
      const store = transaction.objectStore('history');
      store.put(ownerCurrent, 'portfolio-state-v1');
      store.put(ownerRecovery, 'portfolio-state-v1:last-known-good');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Could not seed owner recovery records.'));
      transaction.onabort = () => reject(transaction.error || new Error('Owner recovery seed was aborted.'));
    });
    db.close();

    storageMap.set('margin_portfolio_state_dynamic_v2', '{malformed-legacy-state');
    storageMap.set('margin_portfolio_state_dynamic_v2_recovery_v1', '{malformed-legacy-recovery');
    storageMap.set('portfolio_state', '{malformed-legacy-fallback');

    await expect(activatePortfolioStorageScope('owner', { migrateLegacy: true })).resolves.toBeUndefined();

    expect(loadSavedState({})).toMatchObject(ownerCurrent);
    expect(storageMap.get('margin_portfolio_state_dynamic_v2::owner')).toMatch(JSON.stringify(ownerCurrent));
  });

  it('preserves legacy portfolio sources when owner IndexedDB migration is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const current = { activeView: 'GOOGL', balance: 350, lastUpdated: 300 };
    const recovery = { activeView: 'AAPL', balance: 200, lastUpdated: 200 };
    storageMap.set('margin_portfolio_state_dynamic_v2', JSON.stringify(current));
    storageMap.set('margin_portfolio_state_dynamic_v2_recovery_v1', JSON.stringify(recovery));

    await activatePortfolioStorageScope('owner', { migrateLegacy: true });

    expect(loadSavedState({})).toMatchObject(current);
    expect(storageMap.get('margin_portfolio_state_dynamic_v2')).toBe(JSON.stringify(current));
    expect(storageMap.get('margin_portfolio_state_dynamic_v2_recovery_v1')).toBe(JSON.stringify(recovery));
    expect(storageMap.has('margin_portfolio_state_dynamic_v2::owner')).toBe(false);
  });
  it('isolates owner, guest, and offline snapshots plus broker history and rules', async () => {
    const legacyState = {
      balance: -275,
      apiKeys: { finnhub: 'owner-only-key' },
      brokerExecutedTrades: [{ id: 'owner-trade-1' }],
      cashflows: [{ id: 'owner-cashflow-1' }]
    };
    expect(saveState(legacyState)).toBe(true);
    saveBrokerRules({ broker: 'owner-rules' } as never);
    await flushSavedHistoryPersistence();

    await activatePortfolioStorageScope('owner', { migrateLegacy: true });
    expect(loadSavedState({})).toMatchObject({
      balance: -275,
      apiKeys: { finnhub: 'owner-only-key' }
    });
    expect(loadSavedHistory()).toEqual({
      brokerExecutedTrades: [{ id: 'owner-trade-1' }],
      cashflows: [{ id: 'owner-cashflow-1' }]
    });
    expect(loadBrokerRules()).toEqual({ broker: 'owner-rules' });

    const pendingOwnerWrite = saveSavedHistory({
      brokerExecutedTrades: [{ id: 'owner-trade-1' }, { id: 'owner-trade-2' }],
      cashflows: [{ id: 'owner-cashflow-1' }]
    });
    const switchToGuest = activatePortfolioStorageScope('guest:guest-a');
    await Promise.all([pendingOwnerWrite, switchToGuest]);
    expect(loadSavedState({})).toEqual({});
    expect(loadSavedHistory()).toEqual({ brokerExecutedTrades: [], cashflows: [] });
    expect(loadBrokerRules()).toBeNull();

    expect(saveState({ balance: 25, apiKeys: { finnhub: 'guest-a-key' } })).toBe(true);
    await activatePortfolioStorageScope('guest:guest-b');
    expect(loadSavedState({})).toEqual({});
    expect(loadSavedHistory()).toEqual({ brokerExecutedTrades: [], cashflows: [] });

    await activatePortfolioStorageScope('guest:guest-a');
    expect(loadSavedState({})).toMatchObject({
      balance: 25,
      apiKeys: { finnhub: 'guest-a-key' }
    });

    await activatePortfolioStorageScope('owner');
    expect(loadSavedState({})).toMatchObject({
      balance: -275,
      apiKeys: { finnhub: 'owner-only-key' }
    });
    expect(loadSavedHistory()).toEqual({
      brokerExecutedTrades: [{ id: 'owner-trade-1' }, { id: 'owner-trade-2' }],
      cashflows: [{ id: 'owner-cashflow-1' }]
    });

    await activatePortfolioStorageScope('offline');
    expect(loadSavedState({})).toEqual({});
    expect(loadSavedHistory()).toEqual({ brokerExecutedTrades: [], cashflows: [] });
  });

  describe('TradeNet history baseline markers', () => {
    it('stores trade and cashflow completeness separately for each account', () => {
      expect(hasFreedomTradeHistoryBaseline('admin-a')).toBe(false);
      expect(hasFreedomCashflowHistoryBaseline('admin-a')).toBe(false);

      expect(markFreedomTradeHistoryBaseline('admin-a')).toBe(true);
      expect(hasFreedomTradeHistoryBaseline('admin-a')).toBe(true);
      expect(hasFreedomCashflowHistoryBaseline('admin-a')).toBe(false);

      expect(markFreedomCashflowHistoryBaseline('admin-a')).toBe(true);
      expect(hasFreedomCashflowHistoryBaseline('admin-a')).toBe(true);
      expect(hasFreedomTradeHistoryBaseline('admin-b')).toBe(false);
      expect(hasFreedomCashflowHistoryBaseline('admin-b')).toBe(false);
    });

    it('does not mark a missing account identity as complete', () => {
      expect(markFreedomTradeHistoryBaseline('')).toBe(false);
      expect(markFreedomCashflowHistoryBaseline('')).toBe(false);
      expect(hasFreedomTradeHistoryBaseline('')).toBe(false);
      expect(hasFreedomCashflowHistoryBaseline('')).toBe(false);
    });
  });

  describe('clearLocalData', () => {
    it('clears state items and IndexedDB recovery records', async () => {
      storageMap.set('portfolio_state', 'data1');
      storageMap.set('margin_portfolio_state_dynamic_v2', 'data2');

      await clearLocalData();

      expect(storageMap.has('portfolio_state')).toBe(false);
      expect(storageMap.has('margin_portfolio_state_dynamic_v2')).toBe(false);
    });
  });

  describe('large history localStorage isolation', () => {
    it('allows a large IndexedDB history commit to finish beyond the short startup deadline', async () => {
      vi.useFakeTimers();
      const values = new Map<string, unknown>();
      const transaction = {
        objectStore: () => store,
        abort: vi.fn(),
        oncomplete: null as ((event: Event) => void) | null,
        onerror: null,
        onabort: null
      };
      const store = {
        get: vi.fn((key: string) => {
          const request: {
            result?: unknown;
            onsuccess: ((event: Event) => void) | null;
            onerror: ((event: Event) => void) | null;
          } = { result: undefined, onsuccess: null, onerror: null };
          queueMicrotask(() => {
            request.result = values.get(key);
            request.onsuccess?.call(request, new Event('success'));
            if (key === 'closed-history-v1:last-known-good') {
              setTimeout(() => transaction.oncomplete?.call(transaction, new Event('complete')), 3_000);
            }
          });
          return request as unknown as IDBRequest<unknown>;
        }),
        put: vi.fn((value: unknown, key: string) => {
          values.set(key, value);
          return {} as IDBRequest<unknown>;
        })
      };
      const database = {
        objectStoreNames: { contains: () => true },
        transaction: () => transaction,
        close: vi.fn()
      } as unknown as IDBDatabase;
      const openRequest = {
        result: database,
        error: null,
        onupgradeneeded: null,
        onsuccess: null as ((event: Event) => void) | null,
        onerror: null,
        onblocked: null
      };
      try {
        vi.stubGlobal('indexedDB', {
          open: vi.fn(() => {
            queueMicrotask(() => openRequest.onsuccess?.call(openRequest, new Event('success')));
            return openRequest;
          })
        } as unknown as IDBFactory);

        const history = {
          brokerExecutedTrades: [{ id: 'large-history-write', raw: 'x'.repeat(2 * 1024 * 1024) }],
          cashflows: []
        };
        const write = saveSavedHistory(history);
        await vi.advanceTimersByTimeAsync(2_500);
        expect(transaction.abort).not.toHaveBeenCalled();
        expect(store.put).toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(3_000);
        await expect(write).resolves.toBe(true);
        await expect(flushSavedHistoryPersistence()).resolves.toBe(true);
        expect(values.get('closed-history-v1')).toEqual(history);
        expect(storageMap.has('portfolio_closed_history_v1')).toBe(false);
      } finally {
        vi.useRealTimers();
        vi.stubGlobal('indexedDB', undefined);
      }
    });

    it('stores large closed history in IndexedDB and keeps the localStorage sidecar absent', async () => {
      if (typeof indexedDB === 'undefined') return;
      const history = {
        brokerExecutedTrades: Array.from({ length: 250 }, (_, index) => ({
          id: `trade-${index}`,
          ticker: 'AAPL',
          raw: 'execution-metadata-'.repeat(120)
        })),
        cashflows: Array.from({ length: 80 }, (_, index) => ({
          id: `cashflow-${index}`,
          raw: 'cashflow-metadata-'.repeat(60)
        }))
      };
      expect(saveState({
        activeView: 'COMBINED',
        brokerExecutedTrades: history.brokerExecutedTrades,
        cashflows: history.cashflows
      })).toBe(true);
      await flushSavedHistoryPersistence();

      expect(storageMap.has('portfolio_closed_history_v1')).toBe(false);
      expect(loadSavedHistory()).toEqual(history);
    });
  });
});
