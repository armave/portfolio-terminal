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
const HISTORY_DATABASE_OPERATION_TIMEOUT_MS = 5_000;
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
const STORAGE_KEY_GW_AUTH = '_gw_auth';
const STORAGE_KEY_GW_AUTH_ENCRYPTED = 'gateway_secret_encrypted_v1';
const GW_KEY_DB = 'portfolio-terminal-secure-storage';
const GW_KEY_STORE = 'keys';
const GW_KEY_ID = 'gateway-secret-aes-key';
let pendingSecretPersistence: Promise<boolean> = Promise.resolve(true);
const STORAGE_KEY_RULES = 'tradernet_rules_v1';
const STORAGE_KEY_RULES_RECOVERY = 'tradernet_rules_v1_recovery_v1';
const STORAGE_KEY_REFRESH_INTERVAL = 'quote_refresh_interval';
const STORAGE_KEY_GUEST_REFRESH_INTERVAL = 'quote_refresh_interval_guest_v1';

let inMemoryGatewaySecret = '';

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

function resetHistoryStorageCache(): void {
  lastPersistedHistory = null;
  cachedHistory = null;
  queuedHistorySnapshot = null;
  historyWriteQueue = historyWriteQueuesByScope.get(activePortfolioStorageScope) ?? Promise.resolve(true);
  historyStorageInitialized = false;
  historyStorageInitialization = null;
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
      console.warn('Failed to read legacy closed history from localStorage:', error);
      continue;
    }
    if (!raw) continue;
    try {
      const history = normalizeHistorySnapshot(JSON.parse(raw));
      if (!history) throw new Error('Saved closed history must contain history arrays.');
      if (key === recoveryKey) {
        try {
          storage.setItem(sidecarKey, raw);
          console.warn('Recovered closed history from a scoped local recovery copy.');
        } catch (error) {
          console.warn('Recovered closed history in memory; browser storage repair is pending:', error);
        }
      }
      return history;
    } catch (error) {
      console.warn('Failed to parse saved closed history:', error);
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

function openHistoryDatabase(scope = activePortfolioStorageScope): Promise<IDBDatabase> {
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
      reject(new Error('Opening closed-history storage timed out.'));
    }, HISTORY_DATABASE_OPERATION_TIMEOUT_MS);
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
      }, HISTORY_DATABASE_OPERATION_TIMEOUT_MS);
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
      await writeHistoryRecordToIndexedDB(snapshot, scope);
    } catch (error) {
      console.warn('Closed-history data was recovered in memory but its IndexedDB repair did not complete:', error);
    }
  }
  return snapshot;
}

async function writeHistoryRecordToIndexedDB(history: ClosedHistorySnapshot, scope = activePortfolioStorageScope): Promise<void> {
  const db = await openHistoryDatabase(scope);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(HISTORY_OBJECT_STORE, 'readwrite');
      const store = transaction.objectStore(HISTORY_OBJECT_STORE);
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Writing closed-history storage timed out.'));
        try {
          transaction.abort();
        } catch {
          // The transaction may already be inactive.
        }
      }, HISTORY_DATABASE_OPERATION_TIMEOUT_MS);
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

async function writeLegacyHistoryFallback(history: ClosedHistorySnapshot, scope = activePortfolioStorageScope): Promise<boolean> {
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
      const previous = storage.getItem(sidecarKey);
      if (previous && normalizeHistorySnapshot(JSON.parse(previous))) {
        storage.setItem(recoveryKey, previous);
      }
    } catch {
      // A recovery copy is best-effort; never block the current history write.
    }
    storage.setItem(sidecarKey, serialized);
    return true;
  } catch (error) {
    console.warn('Closed history could not be written to the legacy localStorage fallback:', error);
    return false;
  }
}

function removeLegacyHistorySidecar(scope = activePortfolioStorageScope): void {
  try {
    getBrowserStorage()?.removeItem(scopedStorageKey(STORAGE_KEY_CLOSED_HISTORY, scope));
  } catch (error) {
    console.warn('Could not remove the migrated localStorage history copy:', error);
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
    const legacyHistory = readLegacySavedHistorySnapshot(scope);
    try {
      const indexedHistory = await readHistoryRecordFromIndexedDB(scope);
      const history = indexedHistory ?? legacyHistory ?? { brokerExecutedTrades: [], cashflows: [] };
      if (!indexedHistory) await writeHistoryRecordToIndexedDB(history, scope);
      cachedHistory = history;
      lastPersistedHistory = history;
      if (legacyHistory) removeLegacyHistorySidecar(scope);
    } catch (error) {
      cachedHistory = legacyHistory ?? { brokerExecutedTrades: [], cashflows: [] };
      lastPersistedHistory = null;
      console.warn('IndexedDB closed-history storage is unavailable; using the legacy cache when possible:', error);
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
  scope = activePortfolioStorageScope
): Promise<boolean> {
  const snapshot: ClosedHistorySnapshot = {
    brokerExecutedTrades: Array.isArray(history.brokerExecutedTrades) ? history.brokerExecutedTrades : [],
    cashflows: Array.isArray(history.cashflows) ? history.cashflows : []
  };

  const isActiveScope = scope === activePortfolioStorageScope;
  if (isActiveScope) {
    cachedHistory = snapshot;
    if (
      lastPersistedHistory &&
      lastPersistedHistory.brokerExecutedTrades === snapshot.brokerExecutedTrades &&
      lastPersistedHistory.cashflows === snapshot.cashflows
    ) return true;
    if (
      queuedHistorySnapshot &&
      queuedHistorySnapshot.brokerExecutedTrades === snapshot.brokerExecutedTrades &&
      queuedHistorySnapshot.cashflows === snapshot.cashflows
    ) return await historyWriteQueue;
    queuedHistorySnapshot = snapshot;
  }

  const previousQueue = historyWriteQueuesByScope.get(scope) ?? Promise.resolve(true);
  const nextWrite = previousQueue.catch(() => false).then(async () => {
    try {
      await writeHistoryRecordToIndexedDB(snapshot, scope);
      removeLegacyHistorySidecar(scope);
      return true;
    } catch (indexedDbError) {
      console.warn('Could not persist closed history in IndexedDB; trying the bounded legacy fallback:', indexedDbError);
      return await writeLegacyHistoryFallback(snapshot, scope);
    }
  });

  historyWriteQueuesByScope.set(scope, nextWrite);
  if (isActiveScope) historyWriteQueue = nextWrite;

  const saved = await nextWrite;
  if (saved && scope === activePortfolioStorageScope) lastPersistedHistory = snapshot;
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

/**
 * Reversible client-side secret encoding is disabled.
 */
export function obfuscateSecret(_plain: string): string {
  return '';
}

/**
 * Decoding legacy client-side secret encodings is disabled.
 */
export function deobfuscateSecret(_encoded: string): string {
  return '';
}

/**
 * In-memory gateway secret getter.
 */
export function getGatewaySecret(): string {
  return inMemoryGatewaySecret;
}

/**
 * In-memory gateway secret setter.
 */
export function setGatewaySecret(secret: string): void {
  inMemoryGatewaySecret = secret ? String(secret) : '';
}

/**
 * Returns true if the in-memory gateway secret is non-empty.
 */
export function areHeaderCredentialsConfigured(): boolean {
  return Boolean(inMemoryGatewaySecret && inMemoryGatewaySecret.trim().length > 0);
}

function openSecureKeyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }
    const request = indexedDB.open(GW_KEY_DB, 1);
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Opening secure device-key storage timed out.'));
    }, HISTORY_DATABASE_OPERATION_TIMEOUT_MS);
    const rejectRequest = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(GW_KEY_STORE)) {
        request.result.createObjectStore(GW_KEY_STORE);
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => rejectRequest(request.error || new Error('Could not open secure key storage'));
    request.onblocked = () => rejectRequest(new Error('Secure device-key storage upgrade is blocked by another tab.'));
  });
}

async function getOrCreateDeviceKey(db: IDBDatabase, createIfMissing = true): Promise<CryptoKey> {
  const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
    const transaction = db.transaction(GW_KEY_STORE, 'readonly');
    const request = transaction.objectStore(GW_KEY_STORE).get(GW_KEY_ID);
    let key: CryptoKey | undefined;
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Reading the secure device key timed out.'));
      try {
        transaction.abort();
      } catch {
        // The transaction may already be inactive.
      }
    }, HISTORY_DATABASE_OPERATION_TIMEOUT_MS);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(key);
    };

    request.onsuccess = () => { key = request.result as CryptoKey | undefined; };
    request.onerror = () => finish(request.error || new Error('Could not read the secure device key'));
    transaction.oncomplete = () => finish();
    transaction.onerror = () => finish(transaction.error || new Error('Secure device-key read failed'));
    transaction.onabort = () => finish(transaction.error || new Error('Secure device-key read was aborted'));
  });
  if (existing) return existing;
  // A restore must not mint a replacement key: doing so would guarantee that
  // existing ciphertext cannot decrypt and could destroy a recoverable device key.
  if (!createIfMissing) throw new Error('The existing device encryption key is unavailable.');
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable');

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(GW_KEY_STORE, 'readwrite');
    tx.objectStore(GW_KEY_STORE).put(key, GW_KEY_ID);
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Writing the secure device key timed out.'));
      try {
        tx.abort();
      } catch {
        // The transaction may already be inactive.
      }
    }, HISTORY_DATABASE_OPERATION_TIMEOUT_MS);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    tx.oncomplete = () => finish();
    tx.onerror = () => finish(tx.error || new Error('Secure key storage transaction failed'));
    tx.onabort = () => finish(tx.error || new Error('Secure key storage transaction aborted'));
  });
  return key;
}

async function persistEncryptedGatewaySecret(secret: string): Promise<void> {
  const storage = getBrowserStorage();
  if (!storage) throw new Error('Local storage is unavailable');
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable');
  if (!secret) {
    storage.removeItem(STORAGE_KEY_GW_AUTH_ENCRYPTED);
    return;
  }
  const db = await openSecureKeyDatabase();
  try {
    const key = await getOrCreateDeviceKey(db, false);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(secret));
    const payload = JSON.stringify({
      version: 1,
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(encrypted))
    });
    storage.setItem(STORAGE_KEY_GW_AUTH_ENCRYPTED, payload);
  } finally {
    db.close();
  }
}

/**
 * Keeps the secret in memory and persists it encrypted with a non-extractable
 * device key held in IndexedDB. This avoids plaintext credentials in localStorage
 * while allowing the same browser profile to restore the secret after refresh.
 */
export function saveGatewaySecret(secret: string): void {
  const cleanSecret = typeof secret === 'string' ? secret.trim() : '';
  setGatewaySecret(cleanSecret);
  try {
    const storage = getBrowserStorage();
    if (storage) removeStoredKeys(storage, [STORAGE_KEY_GW_AUTH, 'gateway_secret']);
  } catch (err) {
    console.warn('Failed to purge persisted gateway credentials:', err);
  }
  pendingSecretPersistence = pendingSecretPersistence
    .catch(() => false)
    .then(() => persistEncryptedGatewaySecret(cleanSecret))
    .then(() => true)
    .catch((err) => {
      console.warn('Could not persist encrypted Gateway Secret; it will be requested again after refresh:', err);
      return false;
    });
}

/** Waits until the latest encrypted secret write has completed and reports persistence success. */
export async function persistGatewaySecret(): Promise<boolean> {
  return pendingSecretPersistence;
}

/**
 * Restores a saved device secret into memory. If decryption is unavailable or
 * fails, removes the unusable ciphertext and falls back to the normal auth modal.
 */
export async function restoreGatewaySecret(): Promise<string> {
  const storage = getBrowserStorage();
  if (!storage) return inMemoryGatewaySecret;

  try {
    removeStoredKeys(storage, [STORAGE_KEY_GW_AUTH, 'gateway_secret']);
  } catch (err) {
    console.warn('Could not clear legacy Gateway Secret entries:', err);
  }
  if (inMemoryGatewaySecret) return inMemoryGatewaySecret;

  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY_GW_AUTH_ENCRYPTED);
  } catch (err) {
    console.warn('Could not read encrypted Gateway Secret from device storage:', err);
    return '';
  }
  if (!raw) return '';

  let payload: { version?: number; iv?: number[]; data?: number[] };
  try {
    payload = JSON.parse(raw) as { version?: number; iv?: number[]; data?: number[] };
    if (payload.version !== 1 || !Array.isArray(payload.iv) || !Array.isArray(payload.data)) {
      throw new Error('Encrypted Gateway Secret payload is invalid');
    }
  } catch (err) {
    // Preserve the original ciphertext for inspection/recovery. A newly entered
    // credential will replace it after secure device storage is available.
    console.warn('Encrypted Gateway Secret payload is invalid; preserving the device copy:', err);
    setGatewaySecret('');
    return '';
  }

  // Preserve ciphertext when required browser APIs are unavailable. This can be
  // temporary (e.g. a restricted browser context); deleting it would make the
  // user's device-bound secret unrecoverable when storage becomes available again.
  if (!globalThis.crypto?.subtle || typeof indexedDB === 'undefined') {
    console.warn('Secure browser storage is temporarily unavailable; preserving the encrypted Gateway Secret.');
    return '';
  }

  let db: IDBDatabase;
  try {
    db = await openSecureKeyDatabase();
  } catch (err) {
    console.warn('Could not open secure key storage; preserving the encrypted Gateway Secret:', err);
    return '';
  }

  let key: CryptoKey;
  try {
    key = await getOrCreateDeviceKey(db);
  } catch (err) {
    console.warn('Could not access the device encryption key; preserving the encrypted Gateway Secret:', err);
    db.close();
    return '';
  }

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(payload.iv) },
      key,
      new Uint8Array(payload.data)
    );
    const secret = new TextDecoder().decode(decrypted);
    setGatewaySecret(secret);
    return secret;
  } catch (err) {
    // A missing/replaced IndexedDB key can be temporary or recoverable in a
    // restored browser profile. Preserve ciphertext instead of destroying the
    // only remaining device copy; the normal sign-in flow remains available.
    console.warn('Could not decrypt encrypted Gateway Secret; preserving ciphertext for a later retry:', err);
    setGatewaySecret('');
    return '';
  } finally {
    db.close();
  }
}

/** Returns the currently available in-memory secret without performing I/O. */
export function loadGatewaySecret(): string {
  return inMemoryGatewaySecret;
}

export interface SaveApiKeysOptions {
  secret?: string;
  showToast?: (message: string, type?: string) => void;
  logAppMessage?: (message: string) => void;
  [key: string]: unknown;
}

/**
 * Validates, saves, and confirms Gateway credentials.
 */
export async function saveApiKeys(options: SaveApiKeysOptions): Promise<boolean> {
  const { secret, showToast, logAppMessage } = options || {};
  if (!secret || !secret.trim()) {
    if (typeof showToast === 'function') {
      showToast('Please enter a valid Gateway Secret', 'error');
    }
    return false;
  }

  const cleanSecret = secret.trim();
  saveGatewaySecret(cleanSecret);
  const persisted = await persistGatewaySecret();

  if (!persisted) {
    const message = 'Gateway Secret is available for this session, but secure device storage failed. It may need to be entered again after refresh.';
    if (typeof logAppMessage === 'function') logAppMessage(message);
    if (typeof showToast === 'function') showToast(message, 'error');
    return false;
  }

  if (typeof logAppMessage === 'function') {
    logAppMessage('Gateway Secret saved. Remote access has not been verified yet.');
  }
  if (typeof showToast === 'function') {
    showToast('Gateway Secret saved. Remote access has not been verified yet.', 'success');
  }
  return true;
}

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
    console.error('Failed to serialize portfolio snapshot:', err);
    return { success: false, stateChanged: false, savedAt: null };
  }

  const writes: Array<{ key: string; value: string }> = [
    { key: stateKey, value: persistedStateJson }
  ];
  if (typeof options.deviceActiveView === 'string') {
    writes.push({ key: 'portfolio_active_view', value: options.deviceActiveView });
  }
  if (brokerRulesJson !== null) writes.push({ key: brokerRulesKey, value: brokerRulesJson });

  const previousValues = new Map<string, string | null>();
  try {
    for (const { key } of writes) {
      if (!previousValues.has(key)) previousValues.set(key, storage.getItem(key));
    }
  } catch (err) {
    console.error('Failed to inspect existing portfolio snapshot before saving:', err);
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

  if (stateChanged && previousRaw && parseJsonRecord(previousRaw)) {
    try {
      storage.setItem(scopedStorageKey(STORAGE_KEY_STATE_RECOVERY, scope), previousRaw);
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
        console.error(`Failed to restore local storage key "${key}" after an incomplete portfolio save:`, rollbackError);
      }
    }
    console.error('Failed to save portfolio snapshot; attempted local changes were rolled back:', err);
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
  await initializeSavedHistoryStorage(scope);
  const previousHistory = loadSavedHistory();
  if (!(await persistSavedHistorySnapshot(history, scope))) return false;

  const result = persistPortfolioSnapshot(state as Record<string, any>, options, scope);
  if (!result.success) {
    const restored = await persistSavedHistorySnapshot(previousHistory, scope);
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
  const hasHistory = brokerExecutedTrades.length > 0 || cashflows.length > 0;
  const historyChanged = hasHistory && (
    !lastPersistedHistory ||
    lastPersistedHistory.brokerExecutedTrades !== brokerExecutedTrades ||
    lastPersistedHistory.cashflows !== cashflows
  ) && !(
    queuedHistorySnapshot &&
    queuedHistorySnapshot.brokerExecutedTrades === brokerExecutedTrades &&
    queuedHistorySnapshot.cashflows === cashflows
  );

  const result = persistPortfolioSnapshot(mutableState, options, scope);
  if (!result.success) return false;

  if (historyChanged) {
    void persistSavedHistorySnapshot({ brokerExecutedTrades, cashflows }, scope).then((saved) => {
      if (!saved) console.warn('Portfolio state was saved, but its local closed-history cache could not be updated. Cloud history remains separate.');
    }).catch((error) => {
      console.warn('Portfolio state was saved, but the local closed-history cache update failed:', error);
    });
  }

  if (result.stateChanged && typeof onPushToGist === 'function') {
    try {
      onPushToGist(false);
    } catch (err) {
      console.error('Failed to trigger Gist sync:', err);
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
        console.warn('Storage unavailable; using in-memory portfolio state:', err);
        return fallback;
      }
      if (!raw || !raw.trim()) continue;

      const parsed = parseJsonRecord(raw);
      if (!parsed) {
        if (key === canonicalKey) {
          try {
            JSON.parse(raw);
          } catch (err) {
            console.warn('Failed to parse saved state:', err);
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
          console.warn('Recovered local portfolio data in memory; browser storage repair is pending:', error);
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
    console.warn('Storage unavailable; using in-memory portfolio state:', err);
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
          }, HISTORY_DATABASE_OPERATION_TIMEOUT_MS);
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
      console.warn('Could not clear IndexedDB closed history:', error);
    }
  }
  try {
    const storage = getBrowserStorage();
    storage?.removeItem(scopedStorageKey(STORAGE_KEY_CLOSED_HISTORY, scope));
    storage?.removeItem(scopedStorageKey(STORAGE_KEY_CLOSED_HISTORY_RECOVERY, scope));
  } catch (error) {
    console.warn('Could not clear legacy closed history:', error);
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
      try {
        const parsed = JSON.parse(raw) as unknown;
        try {
          if (!parseJsonRecord(storage.getItem(recoveryKey))) {
            storage.setItem(recoveryKey, raw);
          }
        } catch {
          // Seed the last-known-good settings copy best-effort.
        }
        return parsed;
      } catch (err) {
        console.warn('Failed to parse saved broker rules:', err);
      }
    }

    const recoveryRaw = storage.getItem(recoveryKey);
    if (!recoveryRaw) return null;
    const recovered = JSON.parse(recoveryRaw) as unknown;
    try {
      storage.setItem(key, recoveryRaw);
      console.warn('Recovered broker assumptions from a scoped local recovery copy.');
    } catch (error) {
      console.warn('Recovered broker assumptions in memory; browser storage repair is pending:', error);
    }
    return recovered;
  } catch (err) {
    console.warn('Browser storage is unavailable while reading broker rules:', err);
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
      try {
        JSON.parse(previous);
        storage.setItem(scopedStorageKey(STORAGE_KEY_RULES_RECOVERY), previous);
      } catch {
        // Do not preserve malformed settings as a recovery candidate.
      }
    }
    storage.setItem(key, JSON.stringify(rules));
  } catch (err) {
    console.error('Failed to save broker rules:', err);
  }
}

export function clearBrokerRules(): void {
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    storage.removeItem(scopedStorageKey(STORAGE_KEY_RULES));
    storage.removeItem(scopedStorageKey(STORAGE_KEY_RULES_RECOVERY));
  } catch (err) {
    console.error('Failed to clear broker rules:', err);
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
    console.error('Failed to save quote refresh interval:', err);
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
    console.error('Failed to clear local data:', err);
  }
}
