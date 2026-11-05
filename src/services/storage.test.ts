import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  saveState,
  savePortfolioSnapshot,
  savePortfolioSnapshotAfterFlush,
  loadSavedState,
  loadSavedHistory,
  saveSavedHistory,
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
  saveApiKeys,
  hasFreedomCashflowHistoryBaseline,
  hasFreedomTradeHistoryBaseline,
  markFreedomCashflowHistoryBaseline,
  markFreedomTradeHistoryBaseline,
  configurePortfolioStateDatabaseForTesting,
  resetPortfolioStateDatabaseForTesting,
  flushPortfolioPersistence,
  hydratePortfolioPersistence,
  getPortfolioPersistenceStatus,
  getArchivedPortfolioRecoveryRecords
} from './storage.ts';
import type { PortfolioRecoveryArchiveRecord, PortfolioStateDatabase, PortfolioStateSnapshotRecord } from './portfolioStateDatabase';

describe('storage service', () => {
  const storageMap = new Map<string, string>();
  let databaseFixture: ReturnType<typeof createMemoryPortfolioDatabase>;

  function createMemoryPortfolioDatabase() {
    let current: PortfolioStateSnapshotRecord | null = null;
    let failure: Error | null = null;
    const recoveryRecords = new Map<string, PortfolioRecoveryArchiveRecord>();
    const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
    const database: PortfolioStateDatabase = {
      async readCurrent() {
        if (failure) throw failure;
        return current ? clone(current) : null;
      },
      async compareAndCommit(record, expectedRevision) {
        if (failure) throw failure;
        if (current?.commitId === record.commitId) return 'already-committed';
        if ((current?.revision ?? null) !== expectedRevision) return 'conflict';
        current = clone(record);
        return 'committed';
      },
      async clear() {
        if (failure) throw failure;
        current = null;
      },
      async archiveRecoveryRecords(records) {
        if (failure) throw failure;
        records.forEach((record) => recoveryRecords.set(record.id, clone(record)));
      },
      async readRecoveryRecords() {
        if (failure) throw failure;
        return clone(Array.from(recoveryRecords.values()));
      }
    };
    return {
      database,
      getCurrent: () => current ? clone(current) : null,
      setCurrent: (record: PortfolioStateSnapshotRecord | null) => { current = record ? clone(record) : null; },
      getRecoveryRecords: () => clone(Array.from(recoveryRecords.values())),
      setFailure: (error: Error | null) => { failure = error; }
    };
  }

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

  beforeEach(() => {
    storageMap.clear();
    vi.clearAllMocks();
    vi.stubGlobal('localStorage', localStorageMock);
    databaseFixture = createMemoryPortfolioDatabase();
    configurePortfolioStateDatabaseForTesting(databaseFixture.database);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    // Let any fire-and-forget flush from the test settle before clearing the
    // injected adapter; failures remain journaled and are discarded with the
    // isolated in-memory localStorage map on the next beforeEach.
    await flushPortfolioPersistence();
    resetPortfolioStateDatabaseForTesting();
    localStorageMock.setItem.mockImplementation((key: string, value: string) => {
      storageMap.set(key, String(value));
    });
    vi.unstubAllGlobals();
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

    it('returns false without deleting legacy data when quota is exceeded before a checkpoint is verified', () => {
      const onPushToGist = vi.fn();
      const previousState = JSON.stringify({ activeView: 'AAPL', balance: 100 });
      const previousHistory = JSON.stringify({
        brokerExecutedTrades: [{ id: 'recoverable-trade' }],
        cashflows: [{ id: 'recoverable-cashflow' }]
      });
      storageMap.set('margin_portfolio_state_dynamic_v2', previousState);
      storageMap.set('portfolio_closed_history_v1', previousHistory);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
      });

      expect(saveState({ activeView: 'AAPL' }, onPushToGist)).toBe(false);
      expect(onPushToGist).not.toHaveBeenCalled();
      expect(storageMap.get('margin_portfolio_state_dynamic_v2')).toBe(previousState);
      expect(storageMap.get('portfolio_closed_history_v1')).toBe(previousHistory);

      errorSpy.mockRestore();
    });

    it('keeps the journal commit recoverable when a legacy history mirror cannot be updated', () => {
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
        if (key === 'portfolio_closed_history_v1') throw new Error('quota exceeded');
        storageMap.set(key, String(value));
      });

      // The single journal record is the synchronous commit boundary. The
      // legacy sidecar is only a compatibility mirror and may lag safely.
      expect(saveState(state, onPushToGist)).toBe(true);
      expect(storageMap.get('margin_portfolio_state_dynamic_v2')).not.toBe(previousState);
      expect(storageMap.get('portfolio_closed_history_v1')).toBe(previousHistory);
      expect(state.lastUpdated).toBeGreaterThan(123);
      expect(loadSavedHistory()).toEqual({
        brokerExecutedTrades: [{ id: 'new-trade' }],
        cashflows: [{ id: 'new-fee' }]
      });
      expect(onPushToGist).toHaveBeenCalledWith(false);
    });

    it('commits blank portfolio, explicit empty history, and device view together', () => {
      const state = { activeView: 'COMBINED', balance: 0, lastUpdated: 123 };
      storageMap.set('margin_portfolio_state_dynamic_v2', JSON.stringify({ activeView: 'AAPL', balance: 100 }));
      storageMap.set('portfolio_closed_history_v1', JSON.stringify({
        brokerExecutedTrades: [{ id: 'old-trade' }],
        cashflows: [{ id: 'old-fee' }]
      }));
      storageMap.set('portfolio_active_view', 'AAPL');

      expect(savePortfolioSnapshot(
        state,
        { brokerExecutedTrades: [], cashflows: [] },
        { deviceActiveView: 'COMBINED' }
      )).toBe(true);

      expect(JSON.parse(storageMap.get('margin_portfolio_state_dynamic_v2')!)).toMatchObject({
        activeView: 'COMBINED',
        balance: 0
      });
      expect(JSON.parse(storageMap.get('portfolio_closed_history_v1')!)).toEqual({
        brokerExecutedTrades: [],
        cashflows: []
      });
      expect(storageMap.get('portfolio_active_view')).toBe('COMBINED');
      expect(state.lastUpdated).toBeGreaterThanOrEqual(123);
    });

    it('rolls back portfolio and history when a later device-preference write fails', () => {
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

      expect(savePortfolioSnapshot(
        state,
        { brokerExecutedTrades: [], cashflows: [] },
        { deviceActiveView: 'COMBINED' }
      )).toBe(false);

      expect(storageMap.get('margin_portfolio_state_dynamic_v2')).toBe(previousState);
      expect(storageMap.get('portfolio_closed_history_v1')).toBe(previousHistory);
      expect(storageMap.get('portfolio_active_view')).toBe('AAPL');
      expect(state.lastUpdated).toBe(123);
    });

    it('does not throw when localStorage is undefined', () => {
      vi.stubGlobal('localStorage', undefined);
      expect(() => saveState({ activeView: 'TSLA' })).not.toThrow();
    });
  });

  describe('IndexedDB portfolio snapshot migration and recovery', () => {
    it('migrates the existing local snapshot, history, broker rules, and desk preference without deleting legacy evidence', async () => {
      storageMap.set('margin_portfolio_state_dynamic_v2', JSON.stringify({
        activeView: 'AAPL',
        balance: -1250,
        gatewaySecret: 'must-not-be-migrated',
        brokerExecutedTrades: [{ id: 'inline-trade' }],
        cashflows: [{ id: 'inline-cashflow' }]
      }));
      const history = {
        brokerExecutedTrades: [{ id: 'sidecar-trade' }],
        cashflows: [{ id: 'sidecar-cashflow' }]
      };
      const brokerRules = { annualBorrowRate: 0.15, dayCountBasis: '365' };
      storageMap.set('portfolio_closed_history_v1', JSON.stringify(history));
      storageMap.set('tradernet_rules_v1', JSON.stringify(brokerRules));
      storageMap.set('portfolio_active_view', 'AAPL');

      const status = await hydratePortfolioPersistence();
      const migrated = databaseFixture.getCurrent();

      expect(status.state).toBe('ready');
      expect(migrated).toMatchObject({
        schemaVersion: 1,
        revision: 0,
        state: { activeView: 'AAPL', balance: -1250 },
        history,
        brokerRules,
        deviceActiveView: 'AAPL'
      });
      expect(migrated?.state).not.toHaveProperty('gatewaySecret');
      expect(migrated?.state).not.toHaveProperty('brokerExecutedTrades');
      expect(loadSavedState({})).toMatchObject({ activeView: 'AAPL', balance: -1250 });
      expect(loadSavedHistory()).toEqual(history);
      expect(loadBrokerRules()).toEqual(brokerRules);
      expect(storageMap.has('margin_portfolio_state_dynamic_v2')).toBe(true);
      expect(storageMap.has('portfolio_closed_history_v1')).toBe(true);
      expect(storageMap.has('portfolio_terminal_state_snapshot_v1')).toBe(true);
    });

    it('chains multiple first-run synchronous writes into consecutive revisions', async () => {
      expect(saveState({ activeView: 'AAPL', balance: 100 })).toBe(true);
      expect(saveState({ activeView: 'MSFT', balance: 250 })).toBe(true);

      const status = await flushPortfolioPersistence();
      const committed = databaseFixture.getCurrent();

      expect(status.state).toBe('ready');
      expect(committed?.revision).toBe(2);
      expect(committed?.parentRevision).toBe(1);
      expect(committed?.state).toMatchObject({ activeView: 'MSFT', balance: 250 });
      expect(status.pendingWrites).toBe(0);
      expect(Array.from(storageMap.keys()).filter((key) => key.startsWith('portfolio_terminal_state_pending_v1:'))).toHaveLength(0);
    });

    it('does not copy unchanged large history arrays into every local recovery journal', async () => {
      const executions = Array.from({ length: 250 }, (_, index) => ({ id: `execution-${index}`, ticker: 'AAPL' }));
      const cashflows = Array.from({ length: 250 }, (_, index) => ({ id: `cashflow-${index}`, amount: -1 }));
      const initial = {
        activeView: 'AAPL',
        balance: 100,
        brokerExecutedTrades: executions,
        cashflows
      };

      expect(saveState(initial)).toBe(true);
      await flushPortfolioPersistence();
      expect(databaseFixture.getCurrent()?.history.brokerExecutedTrades).toHaveLength(250);

      expect(saveState({ ...initial, activeView: 'MSFT', balance: 200 })).toBe(true);
      const pendingKey = Array.from(storageMap.keys()).find((key) =>
        key.startsWith('portfolio_terminal_state_pending_v1:')
      );
      expect(pendingKey).toBeDefined();
      const journal = JSON.parse(storageMap.get(pendingKey!)!);

      expect(journal.state).toMatchObject({ activeView: 'MSFT', balance: 200 });
      expect(journal).not.toHaveProperty('history');

      const status = await flushPortfolioPersistence();
      expect(status.state).toBe('ready');
      expect(databaseFixture.getCurrent()?.state).toMatchObject({ activeView: 'MSFT', balance: 200 });
      expect(databaseFixture.getCurrent()?.history.brokerExecutedTrades).toHaveLength(250);
      expect(databaseFixture.getCurrent()?.history.cashflows).toHaveLength(250);
    });

    it('reclaims verified mirrors when the atomic checkpoint itself hits localStorage quota', async () => {
      const initialized = await hydratePortfolioPersistence();
      expect(initialized.state).toBe('ready');
      storageMap.set('margin_portfolio_state_dynamic_v2', JSON.stringify({
        activeView: 'AAPL',
        closedTrades: Array.from({ length: 100 }, (_, index) => ({ id: `trade-${index}` }))
      }));
      storageMap.set('portfolio_closed_history_v1', JSON.stringify({
        brokerExecutedTrades: Array.from({ length: 100 }, (_, index) => ({ id: `execution-${index}` })),
        cashflows: Array.from({ length: 100 }, (_, index) => ({ id: `cashflow-${index}` }))
      }));

      const record = {
        schemaVersion: 1,
        revision: 1,
        parentRevision: 0,
        commitId: 'checkpoint-quota-retry',
        originId: 'current-tab',
        committedAt: Date.now(),
        state: { activeView: 'MSFT', balance: 250 }
      };
      storageMap.set(
        `portfolio_terminal_state_pending_v1:${record.commitId}`,
        JSON.stringify(record)
      );

      let rejectedCheckpoint = false;
      localStorageMock.setItem.mockImplementation((key: string, value: string) => {
        if (key === 'portfolio_terminal_state_snapshot_v1' && !rejectedCheckpoint) {
          rejectedCheckpoint = true;
          throw new DOMException('Atomic checkpoint exceeded quota', 'QuotaExceededError');
        }
        storageMap.set(key, String(value));
      });

      const status = await flushPortfolioPersistence();

      expect(rejectedCheckpoint).toBe(true);
      expect(status.state).toBe('ready');
      expect(status.pendingWrites).toBe(0);
      expect(storageMap.has('margin_portfolio_state_dynamic_v2')).toBe(false);
      expect(storageMap.has('portfolio_closed_history_v1')).toBe(false);
      expect(JSON.parse(storageMap.get('portfolio_terminal_state_snapshot_v1')!).revision).toBe(1);
      expect(databaseFixture.getCurrent()).toMatchObject({
        revision: 1,
        commitId: 'checkpoint-quota-retry',
        state: { activeView: 'MSFT', balance: 250 }
      });
    });

    it('does not commit a delayed history save after its account session becomes stale', async () => {
      await hydratePortfolioPersistence();
      let checks = 0;
      const saved = await savePortfolioSnapshotAfterFlush(
        { activeView: 'CLOSED_HISTORY', closedTrades: [{ id: 'closed-a' }] },
        { brokerExecutedTrades: [{ id: 'execution-a' }], cashflows: [] },
        {},
        () => ++checks === 1
      );

      expect(saved).toBe(false);
      expect(checks).toBe(2);
      expect(databaseFixture.getCurrent()?.revision).toBe(0);
      expect(Array.from(storageMap.keys()).some((key) =>
        key.startsWith('portfolio_terminal_state_pending_v1:')
      )).toBe(false);
    });

    it('flushes an earlier pending journal before writing a large closed-history snapshot', async () => {
      databaseFixture.setFailure(new Error('temporary IndexedDB interruption'));
      expect(saveState({ activeView: 'AAPL', balance: 100 })).toBe(true);

      const interrupted = await flushPortfolioPersistence();
      expect(interrupted.state).toBe('degraded');
      expect(interrupted.pendingWrites).toBe(1);

      databaseFixture.setFailure(null);
      let rejectedWhilePreviousJournalExists = false;
      localStorageMock.setItem.mockImplementation((key: string, value: string) => {
        const hasOlderJournal = Array.from(storageMap.keys()).some((storedKey) =>
          storedKey.startsWith('portfolio_terminal_state_pending_v1:')
        );
        if (key.startsWith('portfolio_terminal_state_pending_v1:') && hasOlderJournal) {
          rejectedWhilePreviousJournalExists = true;
          throw new DOMException('A previous recovery journal still occupies local storage', 'QuotaExceededError');
        }
        storageMap.set(key, String(value));
      });

      const executions = Array.from({ length: 100 }, (_, index) => ({
        id: `execution-${index}`,
        ticker: 'AAPL',
        marginFee: index / 100
      }));
      const cashflows = Array.from({ length: 100 }, (_, index) => ({
        id: `cashflow-${index}`,
        amount: index === 0 ? 0 : -index
      }));
      const saved = await savePortfolioSnapshotAfterFlush(
        { activeView: 'CLOSED_HISTORY', closedTrades: [{ id: 'closed-1', ticker: 'AAPL' }] },
        { brokerExecutedTrades: executions, cashflows }
      );

      expect(saved).toBe(true);
      expect(rejectedWhilePreviousJournalExists).toBe(false);
      expect(databaseFixture.getCurrent()?.revision).toBe(2);
      const status = await flushPortfolioPersistence();
      expect(status.state).toBe('ready');
      expect(status.pendingWrites).toBe(0);
      expect(databaseFixture.getCurrent()?.history).toEqual({
        brokerExecutedTrades: executions,
        cashflows
      });
      expect(status.pendingWrites).toBe(0);
    });

    it('reclaims verified duplicate localStorage mirrors and retries a quota-blocked journal write', async () => {
      const initialized = await hydratePortfolioPersistence();
      expect(initialized.state).toBe('ready');
      const committedBefore = databaseFixture.getCurrent();
      expect(committedBefore).not.toBeNull();

      // Simulate the large compatibility mirrors observed on the affected device.
      const previousStateMirror = JSON.stringify({
        activeView: 'CLOSED_HISTORY',
        closedTrades: Array.from({ length: 120 }, (_, index) => ({ id: `closed-${index}`, ticker: 'AAPL' }))
      });
      const previousHistoryMirror = JSON.stringify({
        brokerExecutedTrades: Array.from({ length: 120 }, (_, index) => ({ id: `execution-${index}`, ticker: 'AAPL' })),
        cashflows: Array.from({ length: 120 }, (_, index) => ({ id: `cashflow-${index}`, amount: -1 }))
      });
      storageMap.set('margin_portfolio_state_dynamic_v2', previousStateMirror);
      storageMap.set('portfolio_closed_history_v1', previousHistoryMirror);

      let rejectedFirstJournalWrite = false;
      localStorageMock.setItem.mockImplementation((key: string, value: string) => {
        if (key.startsWith('portfolio_terminal_state_pending_v1:') && !rejectedFirstJournalWrite) {
          rejectedFirstJournalWrite = true;
          throw new DOMException('Setting the value exceeded the quota', 'QuotaExceededError');
        }
        storageMap.set(key, String(value));
      });

      const executions = Array.from({ length: 160 }, (_, index) => ({
        id: `updated-execution-${index}`,
        ticker: 'AAPL',
        marginFeeAllocations: [{ trancheId: `tranche-${index}`, amount: index / 10 }]
      }));
      const cashflows = Array.from({ length: 160 }, (_, index) => ({
        id: `updated-cashflow-${index}`,
        amount: index === 0 ? 0 : -index
      }));
      const state = {
        activeView: 'CLOSED_HISTORY',
        closedTrades: Array.from({ length: 80 }, (_, index) => ({
          id: `closed-${index}`,
          ticker: 'AAPL',
          netProfit: index
        }))
      };

      expect(savePortfolioSnapshot(state, {
        brokerExecutedTrades: executions,
        cashflows
      })).toBe(true);
      expect(rejectedFirstJournalWrite).toBe(true);
      expect(storageMap.has('margin_portfolio_state_dynamic_v2')).toBe(false);
      expect(storageMap.has('portfolio_state')).toBe(false);
      expect(storageMap.has('portfolio_closed_history_v1')).toBe(false);
      expect(Array.from(storageMap.keys()).some((key) =>
        key.startsWith('portfolio_terminal_state_pending_v1:')
      )).toBe(true);

      const status = await flushPortfolioPersistence();
      expect(status.state).toBe('ready');
      expect(databaseFixture.getCurrent()?.history).toEqual({
        brokerExecutedTrades: executions,
        cashflows
      });
      expect(databaseFixture.getCurrent()?.revision).toBe((committedBefore?.revision ?? 0) + 1);
      expect(loadSavedHistory()).toEqual({ brokerExecutedTrades: executions, cashflows });
      // A verified IndexedDB-backed checkpoint must not recreate the duplicate
      // localStorage sidecar when Closed History mounts and reads its cache.
      expect(storageMap.has('portfolio_closed_history_v1')).toBe(false);
    });

    it('persists an explicit empty history after reload when the in-memory history cache is empty', async () => {
      expect(saveState({
        activeView: 'AAPL',
        brokerExecutedTrades: [{ id: 'old-execution' }],
        cashflows: [{ id: 'old-cashflow' }]
      })).toBe(true);
      await flushPortfolioPersistence();
      expect(databaseFixture.getCurrent()?.history).toEqual({
        brokerExecutedTrades: [{ id: 'old-execution' }],
        cashflows: [{ id: 'old-cashflow' }]
      });

      // Simulate a new page runtime: the IndexedDB/current snapshot survives,
      // but the module-local history reference cache is reset.
      configurePortfolioStateDatabaseForTesting(databaseFixture.database);
      expect(saveState({
        activeView: 'COMBINED',
        brokerExecutedTrades: [],
        cashflows: []
      })).toBe(true);
      const status = await flushPortfolioPersistence();

      expect(status.state).toBe('ready');
      expect(databaseFixture.getCurrent()?.history).toEqual({
        brokerExecutedTrades: [],
        cashflows: []
      });
    });

    it('keeps a failed IndexedDB transaction journaled and recovers it on retry', async () => {
      databaseFixture.setFailure(new Error('IndexedDB quota exceeded'));

      expect(saveState({ activeView: 'NVDA', balance: 400 })).toBe(true);
      const failed = await flushPortfolioPersistence();

      expect(failed.state).toBe('degraded');
      expect(failed.pendingWrites).toBe(1);
      expect(loadSavedState({})).toMatchObject({ activeView: 'NVDA', balance: 400 });
      expect(databaseFixture.getCurrent()).toBeNull();

      databaseFixture.setFailure(null);
      const recovered = await flushPortfolioPersistence();

      expect(recovered.state).toBe('ready');
      expect(recovered.pendingWrites).toBe(0);
      expect(databaseFixture.getCurrent()?.state).toMatchObject({ activeView: 'NVDA', balance: 400 });
    });

    it('rejects a malformed IndexedDB generation without overwriting or discarding local recovery data', async () => {
      const malformed = {
        schemaVersion: 99,
        revision: 4,
        commitId: 'unsupported-schema',
        state: { activeView: 'AAPL' }
      } as unknown as PortfolioStateSnapshotRecord;
      databaseFixture.setCurrent(malformed);

      expect(saveState({ activeView: 'MSFT', balance: 250 })).toBe(true);
      const status = await flushPortfolioPersistence();

      expect(status.state).toBe('degraded');
      expect(status.pendingWrites).toBe(1);
      expect((databaseFixture.getCurrent() as unknown as { schemaVersion: number }).schemaVersion).toBe(99);
      expect(storageMap.has('portfolio_terminal_state_snapshot_v1')).toBe(false);
      expect(Array.from(storageMap.keys()).some((key) =>
        key.startsWith('portfolio_terminal_state_pending_v1:')
      )).toBe(true);
    });

    it('archives older divergent journals after the IndexedDB and local checkpoints are confirmed identical', async () => {
      await hydratePortfolioPersistence();
      const baseline = databaseFixture.getCurrent()!;
      const committed = {
        ...baseline,
        revision: 95,
        parentRevision: 94,
        commitId: 'committed-revision-95',
        originId: 'current-tab-origin',
        committedAt: Date.now(),
        state: { activeView: 'TSLA', balance: 700 }
      };
      databaseFixture.setCurrent(committed);
      storageMap.set('portfolio_terminal_state_snapshot_v1', JSON.stringify(committed));

      for (let revision = 86; revision <= 90; revision += 1) {
        const commitId = `stale-commit-${revision}`;
        storageMap.set(`portfolio_terminal_state_pending_v1:${commitId}`, JSON.stringify({
          schemaVersion: 1,
          revision,
          parentRevision: revision - 1,
          commitId,
          originId: 'previous-tab-origin',
          committedAt: Date.now(),
          state: { activeView: 'AAPL', balance: revision }
        }));
      }

      const hydrated = await hydratePortfolioPersistence();

      expect(hydrated.state).toBe('ready');
      expect(hydrated.pendingWrites).toBe(0);
      expect(databaseFixture.getCurrent()?.commitId).toBe('committed-revision-95');
      expect(Array.from(storageMap.keys()).filter((key) =>
        key.startsWith('portfolio_terminal_state_pending_v1:')
      )).toHaveLength(0);

      const archived = databaseFixture.getRecoveryRecords();
      expect(archived).toHaveLength(5);
      await expect(getArchivedPortfolioRecoveryRecords()).resolves.toHaveLength(5);
      expect(archived.map((entry) => entry.id).sort()).toEqual([
        'stale-commit-86',
        'stale-commit-87',
        'stale-commit-88',
        'stale-commit-89',
        'stale-commit-90'
      ]);
      expect(archived[0]).toMatchObject({
        reason: 'superseded-by-committed-checkpoint',
        payload: { originId: 'previous-tab-origin' }
      });

      // A subsequent cloud pull/local mutation can now append to revision 95.
      expect(saveState({ activeView: 'GOOGL', balance: 800 })).toBe(true);
      const saved = await flushPortfolioPersistence();
      expect(saved.state).toBe('ready');
      expect(databaseFixture.getCurrent()).toMatchObject({
        revision: 96,
        state: { activeView: 'GOOGL', balance: 800 }
      });
      expect(databaseFixture.getRecoveryRecords()).toHaveLength(5);
    });

    it('archives a stale-tab journal without overwriting the newer IndexedDB generation', async () => {
      await hydratePortfolioPersistence();
      const initial = databaseFixture.getCurrent();
      expect(initial?.revision).toBe(0);
      databaseFixture.setCurrent({
        ...initial!,
        revision: 7,
        parentRevision: 6,
        commitId: 'newer-tab-commit',
        originId: 'other-tab',
        committedAt: Date.now(),
        state: { activeView: 'TSLA', balance: 700 }
      });

      expect(saveState({ activeView: 'AAPL', balance: 100 })).toBe(true);
      const status = await flushPortfolioPersistence();

      expect(status.state).toBe('ready');
      expect(status.pendingWrites).toBe(0);
      expect(databaseFixture.getCurrent()?.state).toMatchObject({ activeView: 'TSLA', balance: 700 });
      expect(loadSavedState({})).toMatchObject({ activeView: 'TSLA', balance: 700 });
      expect(databaseFixture.getRecoveryRecords()).toHaveLength(1);
      expect(databaseFixture.getRecoveryRecords()[0]).toMatchObject({
        reason: 'superseded-by-committed-checkpoint',
        payload: { revision: 1, originId: expect.any(String), state: { activeView: 'AAPL', balance: 100 } }
      });
      expect(Array.from(storageMap.keys()).some((key) => key.startsWith('portfolio_terminal_state_pending_v1:'))).toBe(false);
    });

    it('keeps a clear tombstone authoritative if legacy-key removal is interrupted', async () => {
      const previousRules = { annualBorrowRate: 0.15, dayCountBasis: '365' };
      storageMap.set('margin_portfolio_state_dynamic_v2', JSON.stringify({
        activeView: 'AAPL',
        balance: -900
      }));
      storageMap.set('portfolio_closed_history_v1', JSON.stringify({
        brokerExecutedTrades: [{ id: 'old-execution' }],
        cashflows: [{ id: 'old-cashflow' }]
      }));
      storageMap.set('tradernet_rules_v1', JSON.stringify(previousRules));
      storageMap.set('portfolio_active_view', 'AAPL');
      storageMap.set('portfolio_terminal_state_pending_v1:pre-clear', JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        parentRevision: 0,
        commitId: 'pre-clear-portfolio-write',
        originId: 'previous-tab',
        committedAt: Date.now(),
        state: { activeView: 'AAPL', balance: -999 }
      }));
      localStorageMock.removeItem.mockImplementation((key: string) => {
        if (key === 'margin_portfolio_state_dynamic_v2') throw new Error('tab interrupted while clearing legacy keys');
        storageMap.delete(key);
      });

      clearLocalData();

      expect(loadSavedState({ activeView: 'COMBINED', balance: 0 })).toEqual({
        activeView: 'COMBINED',
        balance: 0
      });
      expect(loadSavedHistory()).toEqual({ brokerExecutedTrades: [], cashflows: [] });

      // The first cleanup attempt was interrupted. Restore removal behavior
      // and prove the tombstone allows a later retry to finish safely.
      localStorageMock.removeItem.mockImplementation((key: string) => {
        storageMap.delete(key);
      });
      const interruptedStatus = getPortfolioPersistenceStatus();
      expect(interruptedStatus.state).toBe('degraded');
      expect(storageMap.has('portfolio_terminal_state_cleared_v1')).toBe(true);
      const pendingCountBeforeRejectedWrite = Array.from(storageMap.keys()).filter((key) =>
        key.startsWith('portfolio_terminal_state_pending_v1:')
      ).length;
      expect(saveState({ activeView: 'MSFT', balance: -100 })).toBe(false);
      expect(Array.from(storageMap.keys()).filter((key) =>
        key.startsWith('portfolio_terminal_state_pending_v1:')
      )).toHaveLength(pendingCountBeforeRejectedWrite);

      const status = await flushPortfolioPersistence();
      expect(status.state).toBe('ready');
      expect(storageMap.has('portfolio_terminal_state_cleared_v1')).toBe(false);
      expect(databaseFixture.getCurrent()?.state).toEqual({});
      expect(databaseFixture.getCurrent()?.state).not.toHaveProperty('balance');
      expect(storageMap.has('portfolio_terminal_state_pending_v1:pre-clear')).toBe(false);
      expect(databaseFixture.getCurrent()?.brokerRules).toEqual(previousRules);
      expect(databaseFixture.getCurrent()?.deviceActiveView).toBe('AAPL');
      expect(loadSavedState({ activeView: 'COMBINED', balance: 0 })).toEqual({
        activeView: 'COMBINED',
        balance: 0
      });
      expect(loadBrokerRules()).toEqual(previousRules);
    });

    it('reports degraded mode when IndexedDB is unavailable but keeps the local journal readable', async () => {
      configurePortfolioStateDatabaseForTesting(null);

      expect(saveState({ activeView: 'AMD', balance: 125 })).toBe(true);
      const status = await flushPortfolioPersistence();

      expect(status.state).toBe('degraded');
      expect(status.message).toContain('test adapter is not configured');
      expect(status.pendingWrites).toBe(1);
      expect(loadSavedState({})).toMatchObject({ activeView: 'AMD', balance: 125 });
      expect(getPortfolioPersistenceStatus().state).toBe('degraded');
    });

    it('writes a durable empty generation when local portfolio data is cleared', async () => {
      expect(saveState({ activeView: 'AAPL', balance: -300 })).toBe(true);
      await flushPortfolioPersistence();

      clearLocalData();
      const status = await flushPortfolioPersistence();

      expect(status.state).toBe('ready');
      expect(databaseFixture.getCurrent()?.state).toEqual({});
      expect(databaseFixture.getCurrent()?.history).toEqual({
        brokerExecutedTrades: [],
        cashflows: []
      });
      expect(storageMap.has('margin_portfolio_state_dynamic_v2')).toBe(false);
      expect(storageMap.has('portfolio_state')).toBe(false);
    });
  });

  describe('loadSavedState', () => {
    it('falls back safely when accessing the browser localStorage getter throws', () => {
      const fallback = { activeView: 'COMBINED', balance: 0 };
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get() {
          throw new Error('localStorage access is blocked');
        }
      });

      try {
        expect(loadSavedState(fallback)).toEqual(fallback);
        expect(saveState({ activeView: 'AAPL', balance: 100 })).toBe(false);
      } finally {
        if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
        else delete (globalThis as { localStorage?: Storage }).localStorage;
      }
    });

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
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to parse saved state:',
        expect.any(SyntaxError)
      );
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
      expect(warnSpy).toHaveBeenCalledWith('Failed to parse saved state:', expect.any(SyntaxError));
      warnSpy.mockRestore();
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
      const logTerminal = vi.fn();
      const secureStorageAvailable = typeof indexedDB !== 'undefined' && Boolean(globalThis.crypto?.subtle);

      const result = await saveApiKeys({
        secret: 'test-gateway-secret',
        showToast,
        logTerminal
      });

      expect(getGatewaySecret()).toBe('test-gateway-secret');
      if (secureStorageAvailable) {
        expect(result).toBe(true);
        expect(logTerminal).toHaveBeenCalledWith(expect.stringContaining('Remote access has not been verified'));
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Remote access has not been verified'), 'success');
      } else {
        expect(result).toBe(false);
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('secure device storage failed'), 'error');
        expect(showToast).not.toHaveBeenCalledWith(expect.any(String), 'success');
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
      const logTerminal = vi.fn();

      const result = await saveApiKeys({
        secret: 'test-gateway-secret',
        showToast,
        logTerminal
      });

      expect(result).toBe(false);
      expect(getGatewaySecret()).toBe('test-gateway-secret');
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('secure device storage failed'), 'error');
      expect(showToast).not.toHaveBeenCalledWith(expect.any(String), 'success');
      expect(logTerminal).toHaveBeenCalledWith(expect.stringContaining('may need to be entered again after refresh'));
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
    it('returns null for malformed JSON and absent settings', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      storageMap.set('tradernet_rules_v1', '{"broken');
      expect(loadBrokerRules()).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith('Failed to parse saved broker rules:', expect.any(SyntaxError));
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

  describe('separate closed history persistence', () => {
    it('migrates history embedded in a legacy portfolio snapshot when the sidecar is absent', () => {
      const expected = {
        brokerExecutedTrades: [{ id: 'legacy-trade', ticker: 'AAPL' }],
        cashflows: [{ id: 'legacy-fee', amount: -2 }]
      };
      storageMap.set('margin_portfolio_state_dynamic_v2', JSON.stringify(expected));

      expect(loadSavedHistory()).toEqual(expected);
      expect(JSON.parse(storageMap.get('portfolio_closed_history_v1')!)).toEqual(expected);
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
      expect(warning).toHaveBeenCalledWith('Failed to parse saved closed history:', expect.any(SyntaxError));
    });

    it('persists an explicit empty history snapshot so a full reset cannot restore old rows', () => {
      storageMap.set('portfolio_closed_history_v1', JSON.stringify({
        brokerExecutedTrades: [{ id: 'old-trade' }],
        cashflows: [{ id: 'old-fee' }]
      }));

      expect(saveSavedHistory({ brokerExecutedTrades: [], cashflows: [] })).toBe(true);
      expect(loadSavedHistory()).toEqual({ brokerExecutedTrades: [], cashflows: [] });
      expect(JSON.parse(storageMap.get('portfolio_closed_history_v1')!)).toEqual({
        brokerExecutedTrades: [],
        cashflows: []
      });
    });

    it('reports when the separate history record cannot be persisted', () => {
      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new Error('quota exceeded');
      });

      expect(saveSavedHistory({ brokerExecutedTrades: [], cashflows: [] })).toBe(false);
    });
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
    it('clears state items from storage', async () => {
      storageMap.set('portfolio_state', 'data1');
      storageMap.set('margin_portfolio_state_dynamic_v2', 'data2');

      clearLocalData();
      await flushPortfolioPersistence();

      expect(storageMap.has('portfolio_state')).toBe(false);
      expect(storageMap.has('margin_portfolio_state_dynamic_v2')).toBe(false);
    });
  });
});
