import { logSafeDiagnostic } from './safeDiagnostics';
import type { BrokerAssumptions } from '../types/portfolio';
import {
  DEFAULT_ADMIN_REFRESH_INTERVAL_MS,
  isSupportedQuoteRefreshInterval,
  normalizeQuoteRefreshInterval
} from './portfolioAutoRefresh';

const STORAGE_KEY_STATE = 'margin_portfolio_state_dynamic_v2';
const STORAGE_KEY_STATE_RECOVERY = 'margin_portfolio_state_dynamic_v2_recovery_v1';
const STORAGE_KEY_CLOSED_HISTORY = 'portfolio_closed_history_v1';
const STORAGE_KEY_CLOSED_HISTORY_RECOVERY = 'portfolio_closed_history_v1_recovery_v1';
const HISTORY_DATABASE_NAME = 'portfolio-terminal-history-cache';
const HISTORY_DATABASE_VERSION = 1;
const HISTORY_OBJECT_STORE = 'history';
const HISTORY_RECORD_KEY = 'closed-history-v1';
const HISTORY_RECORD_RECOVERY_KEY = 'closed-history-v1:last-known-good';
const MAX_LOCAL_HISTORY_FALLBACK_CHARS = 512 * 1024;
// Keep startup reads/opens short, but allow large account history snapshots more
// time to be structured-cloned and committed by slower browser IndexedDB engines.
const INDEXED_DB_OPERATION_TIMEOUT_MS = 2_000;
const INDEXED_DB_HISTORY_WRITE_TIMEOUT_MS = 20_000;
const STORAGE_KEY_TRADE_HISTORY_BASELINE = 'portfolio_tradenet_trade_history_baseline_v1';
const STORAGE_KEY_CASHFLOW_HISTORY_BASELINE = 'portfolio_tradenet_cashflow_history_baseline_v1';
const STORAGE_KEY_CASHFLOW_TRADE_CHECKPOINT = 'portfolio_tradenet_cashflow_trade_checkpoint_v1';
let lastPersistedHistory: ClosedHistorySnapshot | null = null;
let cachedHistory: ClosedHistorySnapshot | null = null;
let queuedHistorySnapshot: ClosedHistorySnapshot | null = null;
let historyWriteQueue: Promise<boolean> = Promise.resolve(true);
let historyStorageInitialized = false;
let historyStorageInitialization: Promise<void> | null = null;

const STORAGE_KEY_LEGACY_STATE = 'portfolio_state';
const STORAGE_KEY_RULES = 'tradernet_rules_v1';
const STORAGE_KEY_RULES_RECOVERY = 'tradernet_rules_v1_recovery_v1';
const STORAGE_KEY_REFRESH_INTERVAL = 'quote_refresh_interval';
const STORAGE_KEY_GUEST_REFRESH_INTERVAL = 'quote_refresh_interval_guest_v1';
const STORAGE_KEY_WORKSPACE_DISCLOSURES = 'portfolio_workspace_disclosures_v1';

export interface ClosedHistorySnapshot {
  brokerExecutedTrades: unknown[];
  cashflows: unknown[];
}

export interface PortfolioSnapshotOptions {
  /** Keep the device-local desk preference consistent with the committed snapshot. */
  deviceActiveView?: string;
  /** Keep the separately-preferred broker settings record consistent with the portfolio snapshot. */
  brokerRules?: BrokerAssumptions;
}

/** Returns browser storage only when it is available to the current runtime. */
function getBrowserStorage(): Storage | null {
  return typeof localStorage !== 'undefined' && localStorage ? localStorage : null;
}

const LEGACY_PORTFOLIO_STORAGE_SCOPE = 'legacy';
const PORTFOLIO_STORAGE_SCOPE_MARKER = 'portfolio_session_storage_v1';

function initialPortfolioStorageScope(): string {
  let storage: Storage | null;
  try {
    storage = getBrowserStorage();
    // Without localStorage in an actual browser there is no reliable legacy-state
    // marker. Fail closed rather than hydrating history from a prior session.
    // Non-browser runtimes retain the legacy default for deterministic tests/SSR.
    if (!storage) {
      return typeof window === 'undefined' ? LEGACY_PORTFOLIO_STORAGE_SCOPE : 'offline';
    }
    if (storage.getItem(PORTFOLIO_STORAGE_SCOPE_MARKER) === '1') return 'offline';
  } catch {
    return typeof window === 'undefined' ? LEGACY_PORTFOLIO_STORAGE_SCOPE : 'offline';
  }

  try {
    if (typeof sessionStorage !== 'undefined' &&
        sessionStorage.getItem(PORTFOLIO_STORAGE_SCOPE_MARKER) === '1') return 'offline';
  } catch {
    // sessionStorage may be disabled while localStorage remains available.
  }
  return LEGACY_PORTFOLIO_STORAGE_SCOPE;
}

let activePortfolioStorageScope = initialPortfolioStorageScope();
const historyWriteQueuesByScope = new Map<string, Promise<boolean>>();
historyWriteQueuesByScope.set(activePortfolioStorageScope, historyWriteQueue);

function scopedStorageKey(key: string, scope = activePortfolioStorageScope): string {
  return scope === LEGACY_PORTFOLIO_STORAGE_SCOPE
    ? key
    : key + '::' + encodeURIComponent(scope);
}

function scopedHistoryDatabaseName(scope = activePortfolioStorageScope): string {
  return scope === LEGACY_PORTFOLIO_STORAGE_SCOPE
    ? HISTORY_DATABASE_NAME
    : HISTORY_DATABASE_NAME + '::' + encodeURIComponent(scope);
}

function historyStorageTimeout(message: string): Error {
  const error = new Error(message);
  error.name = 'TimeoutError';
  return error;
}

function resetHistoryStorageCache(): void {
  lastPersistedHistory = null;
  cachedHistory = null;
  queuedHistorySnapshot = null;
  historyWriteQueue = historyWriteQueuesByScope.get(activePortfolioStorageScope) ?? Promise.resolve(true);
  historyStorageInitialized = false;
  historyStorageInitialization = null;
}


function isExplicitPortfolioReset(state: Record<string, unknown>): boolean {
  const events = state.transactionEvents;
  if (!Array.isArray(events) || events.length === 0) return false;
  const latest = events[events.length - 1];
  return Boolean(latest && typeof latest === 'object' &&
    (latest as Record<string, unknown>).type === 'portfolio.reset');
}

function parseJsonRecord(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function normalizeHistorySnapshot(value: unknown): ClosedHistorySnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.brokerExecutedTrades) && !Array.isArray(candidate.cashflows)) return null;
  return {
    brokerExecutedTrades: Array.isArray(candidate.brokerExecutedTrades) ? candidate.brokerExecutedTrades : [],
    cashflows: Array.isArray(candidate.cashflows) ? candidate.cashflows : []
  };
}

function readLegacySavedHistorySnapshot(
  scope = activePortfolioStorageScope
): ClosedHistorySnapshot | null {
  const storage = getBrowserStorage();
  if (!storage) return null;
  const sidecarKey = scopedStorageKey(STORAGE_KEY_CLOSED_HISTORY, scope);
  const recoveryKey = scopedStorageKey(STORAGE_KEY_CLOSED_HISTORY_RECOVERY, scope);
  for (const key of [sidecarKey, recoveryKey]) {
    let raw: string | null = null;
    try {
      raw = storage.getItem(key);
    } catch (error) {
      logSafeDiagnostic('warn', 'closed-history', error);
      continue;
    }
    if (!raw) continue;
    try {
      const history = normalizeHistorySnapshot(JSON.parse(raw));
      if (!history) throw new Error('Saved closed history must contain history arrays.');
      return history;
    } catch (error) {
      logSafeDiagnostic('warn', 'closed-history', error);
    }
  }

  for (const key of [
    scopedStorageKey(STORAGE_KEY_STATE, scope),
    scopedStorageKey(STORAGE_KEY_LEGACY_STATE, scope)
  ]) {
    try {
      const legacyRaw = storage.getItem(key);
      if (!legacyRaw) continue;
      const history = normalizeHistorySnapshot(JSON.parse(legacyRaw));
      if (history) return history;
    } catch {
      // Continue to the next legacy snapshot if one is malformed.
    }
  }
  return null;
}

function openHistoryDatabase(
  scope = activePortfolioStorageScope,
  timeoutMs = INDEXED_DB_OPERATION_TIMEOUT_MS
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }

    const request = indexedDB.open(scopedHistoryDatabaseName(scope), HISTORY_DATABASE_VERSION);
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(historyStorageTimeout('Opening closed-history storage timed out.'));
    }, timeoutMs);
    const rejectRequest = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(HISTORY_OBJECT_STORE)) {
        request.result.createObjectStore(HISTORY_OBJECT_STORE);
      }
    };
    request.onsuccess = () => {
      if (settled) {
        // A request that completes after its deadline must not leak a connection.
        request.result.close();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => rejectRequest(request.error || new Error('Could not open closed-history storage'));
    request.onblocked = () => rejectRequest(new Error('Closed-history storage upgrade is blocked by another tab'));
  });
}

async function readHistoryRecordFromIndexedDB(scope = activePortfolioStorageScope): Promise<ClosedHistorySnapshot | null> {
  const db = await openHistoryDatabase(scope);
  let snapshot: ClosedHistorySnapshot | null = null;
  let recoveryNeeded = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(HISTORY_OBJECT_STORE, 'readonly');
      const store = transaction.objectStore(HISTORY_OBJECT_STORE);
      let currentValue: unknown;
      let recoveryValue: unknown;
      let currentRead = false;
      let recoveryRead = false;
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Reading closed-history storage timed out.'));
        try {
          transaction.abort();
        } catch {
          // The transaction may already be inactive.
        }
      }, INDEXED_DB_OPERATION_TIMEOUT_MS);
      const resolveTransaction = () => {
        if (settled) return;
        if (!currentRead || !recoveryRead) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error('Closed-history read completed without all requested records.'));
          return;
        }
        settled = true;
        clearTimeout(timeout);
        const current = normalizeHistorySnapshot(currentValue);
        const recovery = normalizeHistorySnapshot(recoveryValue);
        if (current) {
          snapshot = current;
          recoveryNeeded = !recovery;
        } else if (recovery) {
          snapshot = recovery;
          recoveryNeeded = true;
        }
        resolve();
      };
      const rejectTransaction = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      };

      const currentRequest = store.get(HISTORY_RECORD_KEY);
      const recoveryRequest = store.get(HISTORY_RECORD_RECOVERY_KEY);
      currentRequest.onsuccess = () => {
        currentValue = currentRequest.result;
        currentRead = true;
      };
      recoveryRequest.onsuccess = () => {
        recoveryValue = recoveryRequest.result;
        recoveryRead = true;
      };
      currentRequest.onerror = () => rejectTransaction(
        currentRequest.error || new Error('Could not read closed-history storage')
      );
      recoveryRequest.onerror = () => rejectTransaction(
        recoveryRequest.error || new Error('Could not read closed-history recovery storage')
      );
      transaction.oncomplete = resolveTransaction;
      transaction.onerror = () => rejectTransaction(transaction.error || new Error('Closed-history read transaction failed'));
      transaction.onabort = () => rejectTransaction(transaction.error || new Error('Closed-history read transaction was aborted'));
    });
  } finally {
    db.close();
  }

  // Restore a missing/corrupt active row or seed the recovery row on first
  // initialization. Keep the in-memory recovered rows even if repair cannot save.
  if (snapshot && recoveryNeeded) {
    try {
      await writeHistoryRecordToIndexedDB(snapshot, scope, true);
    } catch (error) {
      logSafeDiagnostic('warn', 'closed-history', error);
    }
  }
  if (snapshot) writeLocalHistoryRecoverySnapshot(snapshot, scope);
  return snapshot;
}

async function writeHistoryRecordToIndexedDB(
  history: ClosedHistorySnapshot,
  scope = activePortfolioStorageScope,
  resetRecovery = false,
  timeoutMs = INDEXED_DB_OPERATION_TIMEOUT_MS
): Promise<void> {
  const db = await openHistoryDatabase(scope, timeoutMs);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(HISTORY_OBJECT_STORE, 'readwrite');
      const store = transaction.objectStore(HISTORY_OBJECT_STORE);
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(historyStorageTimeout('Writing closed-history storage timed out.'));
        try {
          transaction.abort();
        } catch {
          // The transaction may already be inactive.
        }
      }, timeoutMs);
      const resolveTransaction = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      };
      const rejectTransaction = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      };

      // Read the current row inside the same transaction. The previous valid
      // history is retained as a recovery row before the replacement commits.
      const currentRequest = store.get(HISTORY_RECORD_KEY);
      currentRequest.onsuccess = () => {
        if (resetRecovery) {
          // An explicit user reset is a new known-good state, not a recoverable
          // corruption candidate. Keep both rows blank so old history cannot return.
          store.put(history, HISTORY_RECORD_RECOVERY_KEY);
          store.put(history, HISTORY_RECORD_KEY);
          return;
        }
        const current = normalizeHistorySnapshot(currentRequest.result);
        if (current) {
          store.put(current, HISTORY_RECORD_RECOVERY_KEY);
          store.put(history, HISTORY_RECORD_KEY);
          return;
        }

        // Do not overwrite an existing recovery row when the active row is
        // missing/corrupt. Seed it only when no valid recovery copy exists.
        const recoveryRequest = store.get(HISTORY_RECORD_RECOVERY_KEY);
        recoveryRequest.onsuccess = () => {
          if (!normalizeHistorySnapshot(recoveryRequest.result)) {
            store.put(history, HISTORY_RECORD_RECOVERY_KEY);
          }
          store.put(history, HISTORY_RECORD_KEY);
        };
      };
      currentRequest.onerror = () => rejectTransaction(
        currentRequest.error || new Error('Could not inspect existing closed-history storage')
      );

      transaction.oncomplete = resolveTransaction;
      transaction.onerror = () => rejectTransaction(transaction.error || new Error('Closed-history write transaction failed'));
      transaction.onabort = () => rejectTransaction(transaction.error || new Error('Closed-history write transaction was aborted'));
    });
  } finally {
    db.close();
  }
}

async function writeLegacyHistoryFallback(
  history: ClosedHistorySnapshot,
  scope = activePortfolioStorageScope,
  resetRecovery = false
): Promise<boolean> {
  const storage = getBrowserStorage();
  if (!storage) return false;
  try {
    const serialized = JSON.stringify(history);
    if (serialized.length > MAX_LOCAL_HISTORY_FALLBACK_CHARS) {
      throw new Error('Closed history is too large for the legacy localStorage fallback; IndexedDB is required.');
    }
    const sidecarKey = scopedStorageKey(STORAGE_KEY_CLOSED_HISTORY, scope);
    const recoveryKey = scopedStorageKey(STORAGE_KEY_CLOSED_HISTORY_RECOVERY, scope);
    try {
      if (resetRecovery) {
        storage.setItem(recoveryKey, serialized);
      } else {
        const previous = storage.getItem(sidecarKey);
        if (previous && normalizeHistorySnapshot(JSON.parse(previous))) {
          storage.setItem(recoveryKey, previous);
        }
      }
    } catch {
      // A recovery copy is best-effort; never block the current history write.
    }
    storage.setItem(sidecarKey, serialized);
    return true;
  } catch (error) {
    logSafeDiagnostic('warn', 'closed-history', error);
    return false;
  }
}

function writeLocalHistoryRecoverySnapshot(
  history: ClosedHistorySnapshot,
  scope = activePortfolioStorageScope
): boolean {
  const storage = getBrowserStorage();
  if (!storage) return false;
  try {
    const serialized = JSON.stringify(history);
    if (serialized.length > MAX_LOCAL_HISTORY_FALLBACK_CHARS) return false;
    const recoveryKey = scopedStorageKey(STORAGE_KEY_CLOSED_HISTORY_RECOVERY, scope);
    if (storage.getItem(recoveryKey) === serialized) return true;
    storage.setItem(recoveryKey, serialized);
    return true;
  } catch (error) {
    logSafeDiagnostic('warn', 'closed-history', error);
    return false;
  }
}

function removeLegacyHistorySidecar(scope = activePortfolioStorageScope): void {
  try {
    getBrowserStorage()?.removeItem(scopedStorageKey(STORAGE_KEY_CLOSED_HISTORY, scope));
  } catch (error) {
    logSafeDiagnostic('warn', 'closed-history', error);
  }
}

/**
 * Hydrate the synchronous history cache before mounting history consumers.
 * Existing localStorage history is migrated to IndexedDB and removed only
 * after the IndexedDB transaction has completed successfully.
 */
export function initializeSavedHistoryStorage(
  scope = activePortfolioStorageScope
): Promise<void> {
  if (scope !== activePortfolioStorageScope) {
    return Promise.reject(new Error('Cannot initialize history for an inactive portfolio storage scope.'));
  }
  if (historyStorageInitialized) return Promise.resolve();
  if (historyStorageInitialization) return historyStorageInitialization;

  historyStorageInitialization = (async () => {
    await (historyWriteQueuesByScope.get(scope) ?? Promise.resolve(true)).catch(() => false);

    let indexedHistory: ClosedHistorySnapshot | null = null;
    try {
      indexedHistory = await readHistoryRecordFromIndexedDB(scope);
    } catch (error) {
      // IndexedDB can be unavailable or temporarily blocked. Read the scoped
      // local fallback without copying it back over itself: recovery reads must
      // never require another localStorage write to make the workspace usable.
      cachedHistory = readLegacySavedHistorySnapshot(scope) ??
        { brokerExecutedTrades: [], cashflows: [] };
      lastPersistedHistory = null;
      logSafeDiagnostic('warn', 'closed-history', error);
      historyStorageInitialized = true;
      return;
    }

    const legacyHistory = indexedHistory ? null : readLegacySavedHistorySnapshot(scope);
    const history = indexedHistory ?? legacyHistory ?? { brokerExecutedTrades: [], cashflows: [] };
    try {
      if (!indexedHistory) await writeHistoryRecordToIndexedDB(history, scope);
      // IndexedDB now contains the accepted snapshot. The bounded recovery copy
      // remains available independently; the obsolete active sidecar can go.
      removeLegacyHistorySidecar(scope);
      cachedHistory = history;
      lastPersistedHistory = history;
    } catch (error) {
      // Keep the local fallback available when its IndexedDB migration fails.
      cachedHistory = history;
      lastPersistedHistory = indexedHistory;
      logSafeDiagnostic('warn', 'closed-history', error);
    }
    historyStorageInitialized = true;
  })().finally(() => {
    historyStorageInitialization = null;
  });

  return historyStorageInitialization;
}

/**
 * Switch the active browser portfolio namespace. All administrators share the
 * owner workspace; each guest has a distinct local workspace.
 *
 * Legacy local data is copied only into the owner namespace. Its source remains
 * available for recovery and is never used as a guest/offline fallback after
 * scoped authenticated storage has been activated.
 */
async function activatePortfolioStorageScopeNow(
  scope: string,
  options: { migrateLegacy?: boolean } = {}
): Promise<void> {
  const nextScope = typeof scope === 'string' ? scope.trim() : '';
  if (!nextScope || nextScope.length > 512 ||
      !/^(legacy|offline|owner|guest:.+)$/.test(nextScope)) {
    throw new Error('A supported portfolio storage scope is required.');
  }

  const previousScope = activePortfolioStorageScope;
  if (historyStorageInitialization) await historyStorageInitialization;
  await (historyWriteQueuesByScope.get(previousScope) ?? historyWriteQueue).catch(() => false);
  await (historyWriteQueuesByScope.get(nextScope) ?? Promise.resolve(true)).catch(() => false);

  if (previousScope === nextScope) {
    await initializeSavedHistoryStorage(nextScope);
    return;
  }

  const storage = getBrowserStorage();
  if (nextScope === LEGACY_PORTFOLIO_STORAGE_SCOPE) {
    try {
      storage?.removeItem(PORTFOLIO_STORAGE_SCOPE_MARKER);
    } catch {
      // The in-memory legacy scope remains usable if browser storage is read-only.
    }
    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(PORTFOLIO_STORAGE_SCOPE_MARKER);
    } catch {
      // The in-memory legacy scope remains usable if session storage is read-only.
    }
    activePortfolioStorageScope = nextScope;
    resetHistoryStorageCache();
    await initializeSavedHistoryStorage(nextScope);
    return;
  }

  if (nextScope === 'offline') {
    try {
      storage?.setItem(PORTFOLIO_STORAGE_SCOPE_MARKER, '1');
    } catch {
      // The active in-memory scope still becomes offline if persistent storage is read-only.
    }
    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(PORTFOLIO_STORAGE_SCOPE_MARKER, '1');
    } catch {
      // A same-tab reload marker is best-effort; the active in-memory scope remains isolated.
    }
    activePortfolioStorageScope = nextScope;
    resetHistoryStorageCache();
    await initializeSavedHistoryStorage(nextScope);
    return;
  }

  if (!storage) throw new Error('Browser storage is unavailable; the account workspace was not switched.');

  if (options.migrateLegacy && nextScope === 'owner') {
    const targetStateKey = scopedStorageKey(STORAGE_KEY_STATE, nextScope);
    const targetRecoveryStateKey = scopedStorageKey(STORAGE_KEY_STATE_RECOVERY, nextScope);
    const targetStateIsValid = Boolean(
      parseJsonRecord(storage.getItem(targetStateKey)) ||
      parseJsonRecord(storage.getItem(targetRecoveryStateKey))
    );
    if (!targetStateIsValid) {
      const legacyState = storage.getItem(STORAGE_KEY_STATE) ?? storage.getItem(STORAGE_KEY_LEGACY_STATE);
      if (legacyState) {
        if (!parseJsonRecord(legacyState)) {
          throw new Error('The legacy administrator snapshot is not a valid object; its source was left untouched.');
        }
        storage.setItem(targetStateKey, legacyState);
      }
    }

    const targetRulesKey = scopedStorageKey(STORAGE_KEY_RULES, nextScope);
    const targetRecoveryRulesKey = scopedStorageKey(STORAGE_KEY_RULES_RECOVERY, nextScope);
    const targetRulesIsValid = Boolean(
      parseJsonRecord(storage.getItem(targetRulesKey)) ||
      parseJsonRecord(storage.getItem(targetRecoveryRulesKey))
    );
    const legacyRules = storage.getItem(STORAGE_KEY_RULES);
    if (!targetRulesIsValid && legacyRules !== null) {
      if (parseJsonRecord(legacyRules)) storage.setItem(targetRulesKey, legacyRules);
    }

    // The history sidecar may be using the bounded localStorage fallback
    // because IndexedDB is unavailable. Treat that scoped record as existing
    // owner data before consulting the retained legacy source; otherwise a
    // later login can overwrite newer owner history with the old migration copy.
    const indexedTargetHistory = await readHistoryRecordFromIndexedDB(nextScope).catch(() => null);
    const targetHistory = indexedTargetHistory ?? readLegacySavedHistorySnapshot(nextScope);
    if (!targetHistory) {
      const legacyIndexedHistory = await readHistoryRecordFromIndexedDB(LEGACY_PORTFOLIO_STORAGE_SCOPE)
        .catch(() => null);
      const legacyHistory = legacyIndexedHistory ??
        readLegacySavedHistorySnapshot(LEGACY_PORTFOLIO_STORAGE_SCOPE);
      if (legacyHistory) {
        try {
          await writeHistoryRecordToIndexedDB(legacyHistory, nextScope);
        } catch {
          const saved = await writeLegacyHistoryFallback(legacyHistory, nextScope);
          if (!saved) {
            throw new Error('Legacy administrator history could not be copied safely; the source history was preserved.');
          }
        }
      }
    }
  }

  // Write the marker last. If migration fails, the prior scope and legacy
  // source remain the active, recoverable workspace.
  try {
    storage.setItem(PORTFOLIO_STORAGE_SCOPE_MARKER, '1');
  } catch {
    throw new Error('The active account storage scope could not be recorded; the previous workspace remains active.');
  }

  activePortfolioStorageScope = nextScope;
  resetHistoryStorageCache();
  await initializeSavedHistoryStorage(nextScope);
}

let portfolioStorageScopeTransitionQueue: Promise<void> = Promise.resolve();

/**
 * Serialize workspace transitions so overlapping authentication checks cannot
 * interleave migration, IndexedDB initialization, or active-scope replacement.
 */
export function activatePortfolioStorageScope(
  scope: string,
  options: { migrateLegacy?: boolean } = {}
): Promise<void> {
  const transition = portfolioStorageScopeTransitionQueue
    .catch(() => undefined)
    .then(() => activatePortfolioStorageScopeNow(scope, options));
  portfolioStorageScopeTransitionQueue = transition.then(
    () => undefined,
    () => undefined
  );
  return transition;
}

async function persistSavedHistorySnapshot(
  history: ClosedHistorySnapshot,
  scope = activePortfolioStorageScope,
  options: { resetRecovery?: boolean } = {}
): Promise<boolean> {
  const snapshot: ClosedHistorySnapshot = {
    brokerExecutedTrades: Array.isArray(history.brokerExecutedTrades) ? history.brokerExecutedTrades : [],
    cashflows: Array.isArray(history.cashflows) ? history.cashflows : []
  };

  const isActiveScope = scope === activePortfolioStorageScope;
  if (isActiveScope) {
    if (!options.resetRecovery && lastPersistedHistory &&
      lastPersistedHistory.brokerExecutedTrades === snapshot.brokerExecutedTrades &&
      lastPersistedHistory.cashflows === snapshot.cashflows
    ) {
      cachedHistory = lastPersistedHistory;
      return true;
    }
    if (!options.resetRecovery && queuedHistorySnapshot &&
      queuedHistorySnapshot.brokerExecutedTrades === snapshot.brokerExecutedTrades &&
      queuedHistorySnapshot.cashflows === snapshot.cashflows
    ) return await historyWriteQueue;
    queuedHistorySnapshot = snapshot;
  }

  const previousQueue = historyWriteQueuesByScope.get(scope) ?? Promise.resolve(true);
  const nextWrite = previousQueue.catch(() => false).then(async () => {
    try {
      await writeHistoryRecordToIndexedDB(
        snapshot,
        scope,
        options.resetRecovery === true,
        INDEXED_DB_HISTORY_WRITE_TIMEOUT_MS
      );
      writeLocalHistoryRecoverySnapshot(snapshot, scope);
      removeLegacyHistorySidecar(scope);
      return true;
    } catch (indexedDbError) {
      logSafeDiagnostic('warn', 'closed-history', indexedDbError);
      return await writeLegacyHistoryFallback(snapshot, scope, options.resetRecovery === true);
    }
  });

  historyWriteQueuesByScope.set(scope, nextWrite);
  if (isActiveScope) historyWriteQueue = nextWrite;

  const saved = await nextWrite;
  if (saved && scope === activePortfolioStorageScope) {
    // Keep the synchronous cache aligned with durable history. In particular,
    // a failed IndexedDB write and failed localStorage fallback must not expose
    // an uncommitted snapshot as though it were saved.
    cachedHistory = snapshot;
    lastPersistedHistory = snapshot;
  }
  if (scope === activePortfolioStorageScope && queuedHistorySnapshot === snapshot) queuedHistorySnapshot = null;
  return saved;
}

/** A warm cache is eligible for date-bounded requests only after a full baseline has been persisted. */
function historyBaselineKey(key: string, accountId: string): string {
  return key + ':' + encodeURIComponent(String(accountId || ''));
}

export function hasFreedomTradeHistoryBaseline(accountId: string): boolean {
  if (!accountId) return false;
  try {
    return getBrowserStorage()?.getItem(historyBaselineKey(STORAGE_KEY_TRADE_HISTORY_BASELINE, accountId)) === '1';
  } catch {
    return false;
  }
}

export function markFreedomTradeHistoryBaseline(accountId: string): boolean {
  if (!accountId) return false;
  try {
    const storage = getBrowserStorage();
    if (!storage) return false;
    storage.setItem(historyBaselineKey(STORAGE_KEY_TRADE_HISTORY_BASELINE, accountId), '1');
    return true;
  } catch {
    return false;
  }
}

export function hasFreedomCashflowHistoryBaseline(accountId: string): boolean {
  if (!accountId) return false;
  try {
    return getBrowserStorage()?.getItem(historyBaselineKey(STORAGE_KEY_CASHFLOW_HISTORY_BASELINE, accountId)) === '1';
  } catch {
    return false;
  }
}

export function markFreedomCashflowHistoryBaseline(accountId: string): boolean {
  if (!accountId) return false;
  try {
    const storage = getBrowserStorage();
    if (!storage) return false;
    storage.setItem(historyBaselineKey(STORAGE_KEY_CASHFLOW_HISTORY_BASELINE, accountId), '1');
    return true;
  } catch {
    return false;
  }
}

/** Read the latest closed-trade fingerprint included in a successful cashflow request. */
export function getFreedomCashflowTradeCheckpoint(accountId: string): string | null {
  if (!accountId) return null;
  try {
    return getBrowserStorage()?.getItem(historyBaselineKey(STORAGE_KEY_CASHFLOW_TRADE_CHECKPOINT, accountId)) ?? null;
  } catch {
    return null;
  }
}

/** Persist the trade fingerprint only after cashflow rows and allocations are saved. */
export function markFreedomCashflowTradeCheckpoint(accountId: string, checkpoint: string): boolean {
  if (!accountId) return false;
  try {
    const storage = getBrowserStorage();
    if (!storage) return false;
    storage.setItem(historyBaselineKey(STORAGE_KEY_CASHFLOW_TRADE_CHECKPOINT, accountId), checkpoint);
    return true;
  } catch {
    return false;
  }
}

/** Removes related legacy keys together so credential cleanup follows one path. */
function removeStoredKeys(storage: Storage, keys: string[]): void {
  keys.forEach((key) => storage.removeItem(key));
}

export {
  obfuscateSecret,
  deobfuscateSecret,
  getGatewaySecret,
  setGatewaySecret,
  areHeaderCredentialsConfigured,
  saveGatewaySecret,
  persistGatewaySecret,
  restoreGatewaySecret,
  loadGatewaySecret,
  saveApiKeys
} from './credentialStorage';

interface PortfolioSnapshotPersistResult {
  success: boolean;
  stateChanged: boolean;
  savedAt: number | null;
}

/**
 * Persists only the compact portfolio snapshot and small device preferences.
 * Large closed-history collections are stored independently in IndexedDB.
 * If a later localStorage key fails, earlier compact writes are rolled back.
 */
function persistPortfolioSnapshot(
  state: Record<string, any>,
  options: PortfolioSnapshotOptions = {},
  scope = activePortfolioStorageScope
): PortfolioSnapshotPersistResult {
  const storage = getBrowserStorage();
  if (!storage) return { success: false, stateChanged: false, savedAt: null };

  const savedAt = Date.now();
  let persistedStateJson: string;
  let brokerRulesJson: string | null = null;
  let nextComparable: string;
  const stateKey = scopedStorageKey(STORAGE_KEY_STATE, scope);
  const brokerRulesKey = scopedStorageKey(STORAGE_KEY_RULES, scope);
  try {
    const persistedState: Record<string, unknown> = { ...state, lastUpdated: savedAt };
    delete persistedState.gatewaySecret;
    delete persistedState.brokerExecutedTrades;
    delete persistedState.cashflows;
    persistedStateJson = JSON.stringify(persistedState);
    nextComparable = JSON.stringify(persistedState, (key, value) =>
      key === 'lastUpdated' ? undefined : value
    );
    if (options.brokerRules) brokerRulesJson = JSON.stringify(options.brokerRules);
  } catch (err) {
    logSafeDiagnostic('error', 'browser-storage', err);
    return { success: false, stateChanged: false, savedAt: null };
  }

  const resetRecovery = isExplicitPortfolioReset(state);
  const recoveryKey = scopedStorageKey(STORAGE_KEY_STATE_RECOVERY, scope);
  const writes: Array<{ key: string; value: string }> = [
    { key: stateKey, value: persistedStateJson },
    ...(resetRecovery ? [{ key: recoveryKey, value: persistedStateJson }] : [])
  ];
  if (typeof options.deviceActiveView === 'string') {
    writes.push({ key: 'portfolio_active_view', value: options.deviceActiveView });
  }
  if (brokerRulesJson !== null) {
    let previousRules: string | null;
    try {
      previousRules = storage.getItem(brokerRulesKey);
    } catch (err) {
      logSafeDiagnostic('error', 'browser-storage', err);
      return { success: false, stateChanged: false, savedAt: null };
    }
    if (previousRules && previousRules !== brokerRulesJson && parseJsonRecord(previousRules)) {
      writes.push({
        key: scopedStorageKey(STORAGE_KEY_RULES_RECOVERY, scope),
        value: previousRules
      });
    }
    writes.push({ key: brokerRulesKey, value: brokerRulesJson });
  }

  const previousValues = new Map<string, string | null>();
  try {
    for (const { key } of writes) {
      if (!previousValues.has(key)) previousValues.set(key, storage.getItem(key));
    }
  } catch (err) {
    logSafeDiagnostic('error', 'browser-storage', err);
    return { success: false, stateChanged: false, savedAt: null };
  }

  let previousComparable = '';
  const previousRaw = previousValues.get(stateKey);
  if (previousRaw) {
    try {
      const previous = JSON.parse(previousRaw);
      if (previous && typeof previous === 'object' && !Array.isArray(previous)) {
        const comparable = { ...previous };
        delete comparable.lastUpdated;
        delete comparable.gatewaySecret;
        previousComparable = JSON.stringify(comparable);
      }
    } catch {
      // Corrupt/legacy storage is repaired by this save and counts as a change.
    }
  }
  const stateChanged = previousComparable !== nextComparable;

  if (!resetRecovery && stateChanged && previousRaw && parseJsonRecord(previousRaw)) {
    try {
      storage.setItem(recoveryKey, previousRaw);
    } catch {
      // Recovery copies are best-effort; a full quota must not block the primary save.
    }
  }

  const attemptedKeys: string[] = [];
  try {
    for (const { key, value } of writes) {
      attemptedKeys.push(key);
      storage.setItem(key, value);
    }
  } catch (err) {
    for (const key of attemptedKeys.reverse()) {
      try {
        const previous = previousValues.get(key) ?? null;
        if (previous === null) storage.removeItem(key);
        else storage.setItem(key, previous);
      } catch (rollbackError) {
        logSafeDiagnostic('error', 'browser-storage', rollbackError);
      }
    }
    logSafeDiagnostic('error', 'browser-storage', err);
    return { success: false, stateChanged: false, savedAt: null };
  }

  state.lastUpdated = savedAt;
  return { success: true, stateChanged, savedAt };
}

export async function savePortfolioSnapshot<TState extends object>(
  state: TState,
  history: ClosedHistorySnapshot,
  options: PortfolioSnapshotOptions = {}
): Promise<boolean> {
  if (!state || typeof state !== 'object' || Array.isArray(state) ||
      !history || !Array.isArray(history.brokerExecutedTrades) ||
      !Array.isArray(history.cashflows)) {
    return false;
  }
  const scope = activePortfolioStorageScope;
  const resetRecovery = isExplicitPortfolioReset(state as Record<string, unknown>);
  await initializeSavedHistoryStorage(scope);
  const previousHistory = loadSavedHistory();
  if (!(await persistSavedHistorySnapshot(history, scope, { resetRecovery }))) return false;

  const result = persistPortfolioSnapshot(state as Record<string, any>, options, scope);
  if (!result.success) {
    const restored = await persistSavedHistorySnapshot(previousHistory, scope, { resetRecovery });
    if (!restored) console.error('Failed to restore closed history after the portfolio snapshot could not be saved.');
    return false;
  }
  return true;
}

/**
 * Persists only the compact portfolio snapshot, leaving the separately cached
 * closed-history sidecar untouched. Use this when the complete history is
 * being durably checkpointed to its independent encrypted cloud-history store;
 * routine broker sync must not rewrite megabytes of local cache on every pass.
 */
export function savePortfolioStateSnapshot<TState extends object>(
  state: TState,
  options: PortfolioSnapshotOptions = {}
): boolean {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
  const scope = activePortfolioStorageScope;
  return persistPortfolioSnapshot(state as Record<string, any>, options, scope).success;
}

/**
 * Persists the compact portfolio snapshot synchronously to localStorage. Changed
 * history is queued separately in IndexedDB, so a large history write cannot
 * exhaust localStorage or roll back a valid portfolio-state commit.
 */
export function saveState<TState extends object>(
  state?: TState | null,
  onPushToGist?: (forcePrompt?: boolean) => void,
  options: PortfolioSnapshotOptions = {}
): boolean {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
  const mutableState = state as TState & Record<string, any>;
  const scope = activePortfolioStorageScope;

  const brokerExecutedTrades = Array.isArray(mutableState.brokerExecutedTrades) ? mutableState.brokerExecutedTrades : [];
  const cashflows = Array.isArray(mutableState.cashflows) ? mutableState.cashflows : [];
  const resetRecovery = isExplicitPortfolioReset(mutableState);
  const hasHistory = brokerExecutedTrades.length > 0 || cashflows.length > 0;
  const historyChanged = resetRecovery || (hasHistory && (
    !lastPersistedHistory ||
    lastPersistedHistory.brokerExecutedTrades !== brokerExecutedTrades ||
    lastPersistedHistory.cashflows !== cashflows
  ) && !(
    queuedHistorySnapshot &&
    queuedHistorySnapshot.brokerExecutedTrades === brokerExecutedTrades &&
    queuedHistorySnapshot.cashflows === cashflows
  ));

  const result = persistPortfolioSnapshot(mutableState, options, scope);
  if (!result.success) return false;

  if (historyChanged) {
    void persistSavedHistorySnapshot({ brokerExecutedTrades, cashflows }, scope, { resetRecovery }).then((saved) => {
      if (!saved) console.warn('Portfolio state was saved, but its local closed-history cache could not be updated. Cloud history remains separate.');
    }).catch((error) => {
      logSafeDiagnostic('warn', 'closed-history', error);
    });
  }

  if (result.stateChanged && typeof onPushToGist === 'function') {
    try {
      onPushToGist(false);
    } catch (err) {
      logSafeDiagnostic('error', 'cloud-sync', err);
    }
  }
  return true;
}
/**
 * Loads application state from localStorage, merging it with the supplied
 * fallback. This service is deliberately UI-agnostic: it never reads or mutates
 * DOM elements, so it can safely run before the application is mounted.
 */
export function loadSavedState<T extends Record<string, any>>(fallback: T): T {
  try {
    const storage = getBrowserStorage();
    if (!storage) return fallback;

    const canonicalKey = scopedStorageKey(STORAGE_KEY_STATE);
    // Recovery stays within the active account namespace. Guest/offline scopes
    // can never inspect the owner's legacy or recovery records.
    const candidates = [
      canonicalKey,
      scopedStorageKey(STORAGE_KEY_STATE_RECOVERY),
      scopedStorageKey(STORAGE_KEY_LEGACY_STATE)
    ];
    for (const key of candidates) {
      let raw: string | null;
      try {
        raw = storage.getItem(key);
      } catch (err) {
        logSafeDiagnostic('warn', 'browser-storage', err);
        return fallback;
      }
      if (!raw || !raw.trim()) continue;

      const parsed = parseJsonRecord(raw);
      if (!parsed) {
        if (key === canonicalKey) {
          try {
            JSON.parse(raw);
          } catch (err) {
            logSafeDiagnostic('warn', 'browser-storage', err);
          }
        }
        continue;
      }

      if (key !== canonicalKey) {
        try {
          // Complete a recoverable interrupted/malformed local snapshot on the
          // next read. Keep the recovery row in place until a later good save.
          storage.setItem(canonicalKey, raw);
          console.warn('Recovered the local portfolio snapshot from a scoped recovery copy.');
        } catch (error) {
          logSafeDiagnostic('warn', 'browser-storage', error);
        }
      }

      if (key === canonicalKey) {
        try {
          const recoveryKey = scopedStorageKey(STORAGE_KEY_STATE_RECOVERY);
          if (!parseJsonRecord(storage.getItem(recoveryKey))) {
            storage.setItem(recoveryKey, raw);
          }
        } catch {
          // Seeding a recovery copy is best-effort and must not block startup.
        }
      }

      const persistedState = { ...parsed };
      // Credentials and independently persisted history are not part of the startup snapshot.
      delete persistedState.gatewaySecret;
      delete persistedState.brokerExecutedTrades;
      delete persistedState.cashflows;
      return { ...fallback, ...persistedState };
    }

    return fallback;
  } catch (err) {
    logSafeDiagnostic('warn', 'browser-storage', err);
    return fallback;
  }
}

/** Persist closed-history rows in IndexedDB; use localStorage only for small legacy fallback data. */
export async function saveSavedHistory(history: { brokerExecutedTrades?: unknown[]; cashflows?: unknown[] }): Promise<boolean> {
  const scope = activePortfolioStorageScope;
  return await persistSavedHistorySnapshot({
    brokerExecutedTrades: Array.isArray(history.brokerExecutedTrades) ? history.brokerExecutedTrades : [],
    cashflows: Array.isArray(history.cashflows) ? history.cashflows : []
  }, scope);
}

/** Synchronous cache accessor. The app hydrates this cache before mounting. */
export function loadSavedHistory(): ClosedHistorySnapshot {
  if (cachedHistory) return cachedHistory;
  const legacy = readLegacySavedHistorySnapshot(activePortfolioStorageScope);
  cachedHistory = legacy ?? { brokerExecutedTrades: [], cashflows: [] };
  lastPersistedHistory = legacy;
  return cachedHistory;
}

/** Wait until all queued local-history writes have settled. */
export async function flushSavedHistoryPersistence(): Promise<boolean> {
  const scope = activePortfolioStorageScope;
  if (historyStorageInitialization) await historyStorageInitialization;
  return await (historyWriteQueuesByScope.get(scope) ?? historyWriteQueue);
}

/** Clear the IndexedDB history record and all legacy copies. */
export async function clearSavedHistoryPersistence(): Promise<void> {
  const scope = activePortfolioStorageScope;
  await (historyWriteQueuesByScope.get(scope) ?? historyWriteQueue).catch(() => false);
  if (typeof indexedDB !== 'undefined') {
    try {
      const db = await openHistoryDatabase(scope);
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(HISTORY_OBJECT_STORE, 'readwrite');
          const store = transaction.objectStore(HISTORY_OBJECT_STORE);
          store.delete(HISTORY_RECORD_KEY);
          store.delete(HISTORY_RECORD_RECOVERY_KEY);
          let settled = false;
          const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error('Clearing closed-history storage timed out.'));
            try {
              transaction.abort();
            } catch {
              // The transaction may already be inactive.
            }
          }, INDEXED_DB_OPERATION_TIMEOUT_MS);
          const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (error) reject(error);
            else resolve();
          };
          transaction.oncomplete = () => finish();
          transaction.onerror = () => finish(transaction.error || new Error('Could not clear closed history'));
          transaction.onabort = () => finish(transaction.error || new Error('Closed-history clear was aborted'));
        });
      } finally {
        db.close();
      }
    } catch (error) {
      logSafeDiagnostic('warn', 'closed-history', error);
    }
  }
  try {
    const storage = getBrowserStorage();
    storage?.removeItem(scopedStorageKey(STORAGE_KEY_CLOSED_HISTORY, scope));
    storage?.removeItem(scopedStorageKey(STORAGE_KEY_CLOSED_HISTORY_RECOVERY, scope));
  } catch (error) {
    logSafeDiagnostic('warn', 'closed-history', error);
  }
  if (scope === activePortfolioStorageScope) resetHistoryStorageCache();
}

/**
 * Loads untrusted saved broker settings; missing or malformed JSON returns null.
 */
export function loadBrokerRules(): unknown {
  const storage = getBrowserStorage();
  if (!storage) return null;
  const key = scopedStorageKey(STORAGE_KEY_RULES);
  const recoveryKey = scopedStorageKey(STORAGE_KEY_RULES_RECOVERY);
  try {
    const raw = storage.getItem(key);
    if (raw) {
      const parsed = parseJsonRecord(raw);
      if (parsed) {
        try {
          if (!parseJsonRecord(storage.getItem(recoveryKey))) {
            storage.setItem(recoveryKey, raw);
          }
        } catch {
          // Seed the last-known-good settings copy best-effort.
        }
        return parsed;
      }
      try {
        JSON.parse(raw);
        console.warn('Saved broker rules have an invalid root shape; trying the recovery copy.');
      } catch (err) {
        logSafeDiagnostic('warn', 'browser-storage', err);
      }
    }

    const recoveryRaw = storage.getItem(recoveryKey);
    if (!recoveryRaw) return null;
    const recovered = parseJsonRecord(recoveryRaw);
    if (!recovered) return null;
    try {
      storage.setItem(key, recoveryRaw);
      console.warn('Recovered broker assumptions from a scoped local recovery copy.');
    } catch (error) {
      logSafeDiagnostic('warn', 'browser-storage', error);
    }
    return recovered;
  } catch (err) {
    logSafeDiagnostic('warn', 'browser-storage', err);
    return null;
  }
}

/** Save normalized broker assumptions in the active workspace scope. */
export function saveBrokerRules(rules: BrokerAssumptions): void {
  const storage = getBrowserStorage();
  if (!storage) return;
  const key = scopedStorageKey(STORAGE_KEY_RULES);
  try {
    const previous = storage.getItem(key);
    if (previous && previous !== JSON.stringify(rules)) {
      if (parseJsonRecord(previous)) {
        try {
          storage.setItem(scopedStorageKey(STORAGE_KEY_RULES_RECOVERY), previous);
        } catch {
          // Do not block the current settings write when recovery storage is full.
        }
      }
    }
    storage.setItem(key, JSON.stringify(rules));
  } catch (err) {
    logSafeDiagnostic('error', 'browser-storage', err);
  }
}

export function clearBrokerRules(): void {
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    storage.removeItem(scopedStorageKey(STORAGE_KEY_RULES));
    storage.removeItem(scopedStorageKey(STORAGE_KEY_RULES_RECOVERY));
  } catch (err) {
    logSafeDiagnostic('error', 'browser-storage', err);
  }
}

export type QuoteRefreshIntervalScope = 'admin' | 'guest';

/**
 * Gets the quote refresh interval for one account role. Guests have their own
 * preference so an administrator's saved polling interval cannot override the
 * guest's 15-second default on a shared browser.
 */
export function getQuoteRefreshInterval(
  fallback = DEFAULT_ADMIN_REFRESH_INTERVAL_MS,
  scope: QuoteRefreshIntervalScope = 'admin'
): number {
  const safeFallback = normalizeQuoteRefreshInterval(fallback, DEFAULT_ADMIN_REFRESH_INTERVAL_MS);
  const storage = getBrowserStorage();
  if (!storage) return safeFallback;
  try {
    const key = scope === 'guest' ? STORAGE_KEY_GUEST_REFRESH_INTERVAL : STORAGE_KEY_REFRESH_INTERVAL;
    const raw = storage.getItem(key);
    return raw === null || raw === undefined
      ? safeFallback
      : normalizeQuoteRefreshInterval(raw, safeFallback);
  } catch {
    return safeFallback;
  }
}

/** Saves a quote refresh preference separately for admins and guests. */
export function saveQuoteRefreshInterval(
  interval: number,
  scope: QuoteRefreshIntervalScope = 'admin'
): void {
  if (!isSupportedQuoteRefreshInterval(interval)) return;
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    const key = scope === 'guest' ? STORAGE_KEY_GUEST_REFRESH_INTERVAL : STORAGE_KEY_REFRESH_INTERVAL;
    storage.setItem(key, String(interval));
  } catch (err) {
    logSafeDiagnostic('error', 'browser-storage', err);
  }
}


export interface WorkspaceDisclosurePreferences {
  performanceOpen?: boolean;
  projectionsOpen?: boolean;
  researchOpen?: boolean;
}

/** Read only allowlisted disclosure preferences from the active account storage scope. */
export function getWorkspaceDisclosurePreferences(): WorkspaceDisclosurePreferences {
  const storage = getBrowserStorage();
  if (!storage) return {};
  try {
    const saved = parseJsonRecord(storage.getItem(scopedStorageKey(STORAGE_KEY_WORKSPACE_DISCLOSURES)));
    if (!saved) return {};
    return {
      ...(typeof saved.performanceOpen === 'boolean' ? { performanceOpen: saved.performanceOpen } : {}),
      ...(typeof saved.projectionsOpen === 'boolean' ? { projectionsOpen: saved.projectionsOpen } : {}),
      ...(typeof saved.researchOpen === 'boolean' ? { researchOpen: saved.researchOpen } : {})
    };
  } catch (error) {
    logSafeDiagnostic('warn', 'browser-storage', error);
    return {};
  }
}

/** Persist only allowlisted disclosure preferences in the active account storage scope. */
export function saveWorkspaceDisclosurePreferences(preferences: WorkspaceDisclosurePreferences): void {
  const storage = getBrowserStorage();
  if (!storage) return;
  const safePreferences: WorkspaceDisclosurePreferences = {
    ...(typeof preferences.performanceOpen === 'boolean' ? { performanceOpen: preferences.performanceOpen } : {}),
    ...(typeof preferences.projectionsOpen === 'boolean' ? { projectionsOpen: preferences.projectionsOpen } : {}),
    ...(typeof preferences.researchOpen === 'boolean' ? { researchOpen: preferences.researchOpen } : {})
  };
  try {
    storage.setItem(scopedStorageKey(STORAGE_KEY_WORKSPACE_DISCLOSURES), JSON.stringify(safePreferences));
  } catch (error) {
    logSafeDiagnostic('warn', 'browser-storage', error);
  }
}

/**
 * Purges active and legacy state payloads from localStorage.
 */
export function clearLocalData(): void {
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    removeStoredKeys(storage, [
      scopedStorageKey(STORAGE_KEY_LEGACY_STATE),
      scopedStorageKey(STORAGE_KEY_STATE),
      scopedStorageKey(STORAGE_KEY_STATE_RECOVERY)
    ]);
  } catch (err) {
    logSafeDiagnostic('error', 'browser-storage', err);
  }
}
