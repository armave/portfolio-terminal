import type { BrokerAssumptions } from '../types/portfolio';
import {
  createIndexedDbPortfolioStateDatabase,
  type PortfolioStateDatabase,
  type PortfolioStateSnapshotRecord,
  type PortfolioRecoveryArchiveRecord
} from './portfolioStateDatabase';
import {
  DEFAULT_ADMIN_REFRESH_INTERVAL_MS,
  isSupportedQuoteRefreshInterval,
  normalizeQuoteRefreshInterval
} from './portfolioAutoRefresh';

const STORAGE_KEY_STATE = 'margin_portfolio_state_dynamic_v2';
const STORAGE_KEY_CLOSED_HISTORY = 'portfolio_closed_history_v1';
const STORAGE_KEY_TRADE_HISTORY_BASELINE = 'portfolio_tradenet_trade_history_baseline_v1';
const STORAGE_KEY_CASHFLOW_HISTORY_BASELINE = 'portfolio_tradenet_cashflow_history_baseline_v1';
let lastPersistedHistory: ClosedHistorySnapshot | null = null;

const STORAGE_KEY_LEGACY_STATE = 'portfolio_state';
const STORAGE_KEY_GW_AUTH = '_gw_auth';
const STORAGE_KEY_GW_AUTH_ENCRYPTED = 'gateway_secret_encrypted_v1';
const GW_KEY_DB = 'portfolio-terminal-secure-storage';
const GW_KEY_STORE = 'keys';
const GW_KEY_ID = 'gateway-secret-aes-key';
let pendingSecretPersistence: Promise<boolean> = Promise.resolve(true);
const STORAGE_KEY_RULES = 'tradernet_rules_v1';
const STORAGE_KEY_REFRESH_INTERVAL = 'quote_refresh_interval';
const STORAGE_KEY_GUEST_REFRESH_INTERVAL = 'quote_refresh_interval_guest_v1';
const STORAGE_KEY_ATOMIC_SNAPSHOT = 'portfolio_terminal_state_snapshot_v1';
const STORAGE_KEY_CLEAR_MARKER = 'portfolio_terminal_state_cleared_v1';
const STORAGE_KEY_PENDING_PREFIX = 'portfolio_terminal_state_pending_v1:';

let inMemoryGatewaySecret = '';

export interface ClosedHistorySnapshot {
  brokerExecutedTrades: unknown[];
  cashflows: unknown[];
}

export interface PortfolioSnapshotOptions {
  /** Keep the device-local desk preference consistent with the committed snapshot. */
  deviceActiveView?: string;
  /** Keep the separately-preferred broker settings record consistent with the portfolio snapshot. */
  brokerRules?: BrokerAssumptions | null;
}

/** Returns browser storage only when it is available to the current runtime. */
function getBrowserStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' && localStorage ? localStorage : null;
  } catch {
    // Accessing the browser storage getter itself may throw in privacy or
    // sandboxed contexts before any Storage method can be called.
    return null;
  }
}

function createPersistenceId(): string {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

type PortfolioPersistenceStatusState = 'idle' | 'pending' | 'ready' | 'degraded' | 'conflict';

export interface PortfolioPersistenceStatus {
  state: PortfolioPersistenceStatusState;
  revision: number;
  pendingWrites: number;
  message: string | null;
}

interface PendingPortfolioSnapshotRecord {
  schemaVersion: 1;
  revision: number;
  parentRevision: number;
  commitId: string;
  originId: string;
  committedAt: number;
  state: Record<string, unknown>;
  /** Omitted when the preceding generation's history is unchanged. */
  history?: ClosedHistorySnapshot;
  /** Omitted when the preceding generation's broker rules are unchanged. */
  brokerRules?: unknown | null;
  /** Omitted when the preceding generation's device preference is unchanged. */
  deviceActiveView?: string | null;
}

type PendingPortfolioSnapshot = {
  key: string;
  record: PendingPortfolioSnapshotRecord;
};

const persistenceOriginId = createPersistenceId();
let lastScheduledRevision: number | null = null;
let hydratedPortfolioSnapshot: PortfolioStateSnapshotRecord | null = null;
let portfolioStateDatabase: PortfolioStateDatabase | null = null;
let portfolioStateDatabaseOverride: PortfolioStateDatabase | null = null;
let hasPortfolioStateDatabaseOverride = false;
let portfolioPersistenceFlush: Promise<PortfolioPersistenceStatus> | null = null;
let portfolioPersistenceFlushRequested = false;
const portfolioPersistenceListeners = new Set<(status: PortfolioPersistenceStatus) => void>();
let portfolioPersistenceStatus: PortfolioPersistenceStatus = {
  state: 'idle',
  revision: 0,
  pendingWrites: 0,
  message: null
};

function getPortfolioStateDatabase(): PortfolioStateDatabase {
  if (hasPortfolioStateDatabaseOverride) {
    if (!portfolioStateDatabaseOverride) throw new Error('Portfolio state database test adapter is not configured.');
    return portfolioStateDatabaseOverride;
  }
  if (!portfolioStateDatabase) portfolioStateDatabase = createIndexedDbPortfolioStateDatabase();
  return portfolioStateDatabase;
}

function isPortfolioStateDatabaseAvailable(): boolean {
  return hasPortfolioStateDatabaseOverride || typeof indexedDB !== 'undefined';
}

function isPortfolioSnapshotRecord(value: unknown): value is PortfolioStateSnapshotRecord {
  if (!isPlainObject(value)) return false;
  const revision = Number(value.revision);
  const parentRevision = Number(value.parentRevision);
  return value.schemaVersion === 1 &&
    Number.isInteger(revision) && revision >= 0 &&
    Number.isInteger(parentRevision) && parentRevision >= 0 &&
    (revision === 0 ? parentRevision === 0 : revision === parentRevision + 1) &&
    typeof value.commitId === 'string' && value.commitId.length > 0 &&
    typeof value.originId === 'string' &&
    Number.isFinite(Number(value.committedAt)) &&
    isPlainObject(value.state) &&
    isPlainObject(value.history) &&
    Array.isArray(value.history.brokerExecutedTrades) &&
    Array.isArray(value.history.cashflows) &&
    Object.prototype.hasOwnProperty.call(value, 'brokerRules') &&
    (value.deviceActiveView === null || typeof value.deviceActiveView === 'string');
}

function parseSnapshotRecord(raw: string | null): PortfolioStateSnapshotRecord | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPortfolioSnapshotRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPendingPortfolioSnapshotRecord(value: unknown): value is PendingPortfolioSnapshotRecord {
  if (!isPlainObject(value)) return false;
  const hasHistory = !Object.prototype.hasOwnProperty.call(value, 'history') ||
    (isPlainObject(value.history) &&
      Array.isArray(value.history.brokerExecutedTrades) &&
      Array.isArray(value.history.cashflows));
  const hasRules = !Object.prototype.hasOwnProperty.call(value, 'brokerRules') ||
    value.brokerRules === null || value.brokerRules !== undefined;
  const hasDeviceView = !Object.prototype.hasOwnProperty.call(value, 'deviceActiveView') ||
    value.deviceActiveView === null || typeof value.deviceActiveView === 'string';
  return value.schemaVersion === 1 &&
    Number.isInteger(value.revision) && Number(value.revision) > 0 &&
    Number.isInteger(value.parentRevision) && Number(value.parentRevision) >= 0 &&
    Number(value.revision) === Number(value.parentRevision) + 1 &&
    typeof value.commitId === 'string' && value.commitId.length > 0 &&
    typeof value.originId === 'string' &&
    Number.isFinite(Number(value.committedAt)) &&
    isPlainObject(value.state) &&
    hasHistory && hasRules && hasDeviceView;
}

function parsePendingPortfolioSnapshotRecord(raw: string | null): PendingPortfolioSnapshotRecord | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPendingPortfolioSnapshotRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function materializePendingPortfolioSnapshot(
  parent: PortfolioStateSnapshotRecord,
  pending: PendingPortfolioSnapshotRecord
): PortfolioStateSnapshotRecord {
  return {
    schemaVersion: 1,
    revision: pending.revision,
    parentRevision: pending.parentRevision,
    commitId: pending.commitId,
    originId: pending.originId,
    committedAt: pending.committedAt,
    state: pending.state,
    history: pending.history
      ? cloneHistory(pending.history)
      : cloneHistory(parent.history),
    brokerRules: Object.prototype.hasOwnProperty.call(pending, 'brokerRules')
      ? pending.brokerRules ?? null
      : parent.brokerRules,
    deviceActiveView: Object.prototype.hasOwnProperty.call(pending, 'deviceActiveView')
      ? pending.deviceActiveView ?? null
      : parent.deviceActiveView
  };
}

function cloneHistory(history: ClosedHistorySnapshot): ClosedHistorySnapshot {
  return {
    brokerExecutedTrades: [...history.brokerExecutedTrades],
    cashflows: [...history.cashflows]
  };
}

function readLegacyPortfolioSnapshot(storage: Storage): PortfolioStateSnapshotRecord | null {
  let sourceState: Record<string, any> | null = null;
  for (const key of [STORAGE_KEY_STATE, STORAGE_KEY_LEGACY_STATE]) {
    try {
      const raw = storage.getItem(key);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (isPlainObject(parsed)) {
        sourceState = { ...parsed };
        break;
      }
    } catch (error) {
      // A damaged current snapshot does not hide a recoverable legacy snapshot.
      console.warn('Failed to parse saved state:', error);
    }
  }

  let history: ClosedHistorySnapshot | null = null;
  try {
    const rawHistory = storage.getItem(STORAGE_KEY_CLOSED_HISTORY);
    if (rawHistory) {
      const parsed: unknown = JSON.parse(rawHistory);
      if (isPlainObject(parsed)) {
        history = {
          brokerExecutedTrades: Array.isArray(parsed.brokerExecutedTrades) ? parsed.brokerExecutedTrades : [],
          cashflows: Array.isArray(parsed.cashflows) ? parsed.cashflows : []
        };
      }
    }
  } catch (error) {
    // Keep damaged evidence intact and fall back to embedded legacy history.
    console.warn('Failed to parse saved closed history:', error);
  }

  if (!history && sourceState) {
    history = {
      brokerExecutedTrades: Array.isArray(sourceState.brokerExecutedTrades) ? sourceState.brokerExecutedTrades : [],
      cashflows: Array.isArray(sourceState.cashflows) ? sourceState.cashflows : []
    };
  }

  let brokerRules: unknown | null = null;
  try {
    const rawRules = storage.getItem(STORAGE_KEY_RULES);
    if (rawRules) brokerRules = JSON.parse(rawRules);
  } catch {
    // Invalid broker settings are handled by the existing domain compatibility boundary.
  }

  let deviceActiveView: string | null = null;
  try {
    deviceActiveView = storage.getItem('portfolio_active_view');
  } catch {
    // The device preference is optional.
  }

  if (!sourceState && !history && brokerRules === null && deviceActiveView === null) return null;

  const state = sourceState || {};
  delete state.gatewaySecret;
  delete state.brokerExecutedTrades;
  delete state.cashflows;

  return {
    schemaVersion: 1,
    revision: 0,
    parentRevision: 0,
    commitId: 'legacy-portfolio-snapshot',
    originId: 'legacy-migration',
    committedAt: 0,
    state,
    history: history || { brokerExecutedTrades: [], cashflows: [] },
    brokerRules,
    deviceActiveView
  };
}

function readAtomicPortfolioSnapshot(storage: Storage): PortfolioStateSnapshotRecord | null {
  try {
    return parseSnapshotRecord(storage.getItem(STORAGE_KEY_ATOMIC_SNAPSHOT));
  } catch {
    return null;
  }
}

function readPendingPortfolioSnapshots(storage: Storage): PendingPortfolioSnapshot[] {
  const pending: PendingPortfolioSnapshot[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key || !key.startsWith(STORAGE_KEY_PENDING_PREFIX)) continue;
      try {
        const raw = storage.getItem(key);
        const record = parsePendingPortfolioSnapshotRecord(raw);
        if (record) pending.push({ key, record });
      } catch {
        // Leave malformed recovery entries untouched for manual inspection.
      }
    }
  } catch {
    // If enumeration is unavailable, callers still retain the atomic checkpoint.
  }
  return pending;
}

function readPortfolioSnapshotBase(storage: Storage): PortfolioStateSnapshotRecord | null {
  try {
    if (storage.getItem(STORAGE_KEY_CLEAR_MARKER)) return null;
  } catch (error) {
    throw error;
  }
  // The local checkpoint/journal is the recovery source for this browser
  // storage area. An in-memory snapshot may belong to a previous account,
  // test storage, or pre-clear generation, so it must never override missing
  // local evidence.
  const atomic = readAtomicPortfolioSnapshot(storage);
  return atomic || readLegacyPortfolioSnapshot(storage);
}

function resolveLocalPortfolioSnapshot(storage: Storage): {
  record: PortfolioStateSnapshotRecord | null;
  conflict: boolean;
} {
  const pending = readPendingPortfolioSnapshots(storage);
  let record = readPortfolioSnapshotBase(storage);
  // A first-run save has no legacy or atomic checkpoint. Treat the empty
  // workspace as revision zero so consecutive synchronous store mutations can
  // build one ordered journal chain before the first IndexedDB flush finishes.
  if (!record && pending.length > 0) record = makeEmptyPortfolioSnapshot();
  if (!record) return { record: null, conflict: false };

  const consumed = new Set<string>();
  let conflict = false;

  for (let step = 0; step < pending.length; step += 1) {
    const candidates = pending.filter((item) =>
      !consumed.has(item.key) &&
      item.record.parentRevision === record!.revision &&
      item.record.revision === record!.revision + 1
    );
    if (candidates.length > 1) {
      conflict = true;
      break;
    }
    if (candidates.length === 0) break;
    record = materializePendingPortfolioSnapshot(record, candidates[0].record);
    consumed.add(candidates[0].key);
  }

  if (pending.some((item) => !consumed.has(item.key) &&
      item.record.commitId !== record?.commitId &&
      item.record.parentRevision < (record?.revision ?? 0))) {
    conflict = true;
  }

  return { record, conflict };
}

function readPendingCount(storage = getBrowserStorage()): number {
  if (!storage) return 0;
  try {
    let count = 0;
    for (let index = 0; index < storage.length; index += 1) {
      if (storage.key(index)?.startsWith(STORAGE_KEY_PENDING_PREFIX)) count += 1;
    }
    return count;
  } catch {
    return readPendingPortfolioSnapshots(storage).length;
  }
}

function updatePortfolioPersistenceStatus(
  state: PortfolioPersistenceStatusState,
  revision = portfolioPersistenceStatus.revision,
  message: string | null = null
): void {
  const next: PortfolioPersistenceStatus = {
    state,
    revision,
    pendingWrites: readPendingCount(),
    message
  };
  if (
    next.state === portfolioPersistenceStatus.state &&
    next.revision === portfolioPersistenceStatus.revision &&
    next.pendingWrites === portfolioPersistenceStatus.pendingWrites &&
    next.message === portfolioPersistenceStatus.message
  ) return;
  portfolioPersistenceStatus = next;
  portfolioPersistenceListeners.forEach((listener) => {
    try {
      listener(next);
    } catch (error) {
      console.error('Failed to notify a portfolio persistence status listener:', error);
    }
  });
}

export function getPortfolioPersistenceStatus(): PortfolioPersistenceStatus {
  return { ...portfolioPersistenceStatus };
}

/** Reads preserved superseded recovery branches without changing the active portfolio. */
export async function getArchivedPortfolioRecoveryRecords(): Promise<PortfolioRecoveryArchiveRecord[]> {
  return getPortfolioStateDatabase().readRecoveryRecords();
}

export function subscribePortfolioPersistenceStatus(
  listener: (status: PortfolioPersistenceStatus) => void
): () => void {
  portfolioPersistenceListeners.add(listener);
  return () => portfolioPersistenceListeners.delete(listener);
}

/** Test seam for deterministic IndexedDB commit, failure, and revision-conflict coverage. */
export function configurePortfolioStateDatabaseForTesting(
  database: PortfolioStateDatabase | null
): void {
  portfolioStateDatabaseOverride = database;
  hasPortfolioStateDatabaseOverride = true;
  hydratedPortfolioSnapshot = null;
  lastScheduledRevision = null;
  lastPersistedHistory = null;
  portfolioPersistenceFlush = null;
  portfolioPersistenceFlushRequested = false;
  updatePortfolioPersistenceStatus('idle', 0, null);
}

export function resetPortfolioStateDatabaseForTesting(): void {
  portfolioStateDatabaseOverride = null;
  hasPortfolioStateDatabaseOverride = false;
  portfolioStateDatabase = null;
  hydratedPortfolioSnapshot = null;
  lastScheduledRevision = null;
  lastPersistedHistory = null;
  portfolioPersistenceFlush = null;
  portfolioPersistenceFlushRequested = false;
  updatePortfolioPersistenceStatus('idle', 0, null);
}

function makeEmptyPortfolioSnapshot(
  brokerRules: unknown | null = null,
  deviceActiveView: string | null = null
): PortfolioStateSnapshotRecord {
  return {
    schemaVersion: 1,
    revision: 0,
    parentRevision: 0,
    commitId: 'empty-portfolio-snapshot',
    originId: 'migration',
    committedAt: 0,
    state: {},
    history: { brokerExecutedTrades: [], cashflows: [] },
    brokerRules,
    deviceActiveView
  };
}

function readClearMarker(storage: Storage): { brokerRules: unknown | null; deviceActiveView: string | null } | null {
  try {
    const raw = storage.getItem(STORAGE_KEY_CLEAR_MARKER);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isPlainObject(value)) return { brokerRules: null, deviceActiveView: null };
    return {
      brokerRules: value.brokerRules ?? null,
      deviceActiveView: typeof value.deviceActiveView === 'string' ? value.deviceActiveView : null
    };
  } catch {
    // Old timestamp-only markers still mean "clear"; they simply carry no
    // settings metadata to preserve.
    return { brokerRules: null, deviceActiveView: null };
  }
}

function writeLegacyCompatibilityMirrors(
  storage: Storage,
  record: PortfolioStateSnapshotRecord
): void {
  // These mirrors keep older app versions and existing recovery tools readable.
  // The journal/IndexedDB snapshot is authoritative; mirror failures do not undo
  // a successfully written single-key recovery record.
  try {
    storage.setItem(STORAGE_KEY_STATE, JSON.stringify(record.state));
  } catch (error) {
    console.warn('Could not update the legacy portfolio-state mirror:', error);
  }
  try {
    storage.setItem(STORAGE_KEY_CLOSED_HISTORY, JSON.stringify(record.history));
  } catch (error) {
    console.warn('Could not update the legacy closed-history mirror:', error);
  }
  try {
    if (record.brokerRules === null) storage.removeItem(STORAGE_KEY_RULES);
    else storage.setItem(STORAGE_KEY_RULES, JSON.stringify(record.brokerRules));
  } catch (error) {
    console.warn('Could not update the legacy broker-rules mirror:', error);
  }
}

function makePortfolioSnapshotRecord(
  state: Record<string, any>,
  history: ClosedHistorySnapshot | null,
  options: PortfolioSnapshotOptions,
  parent: PortfolioStateSnapshotRecord | null,
  savedAt: number
): PortfolioStateSnapshotRecord {
  const persistedState: Record<string, unknown> = { ...state, lastUpdated: savedAt };
  delete persistedState.gatewaySecret;
  delete persistedState.brokerExecutedTrades;
  delete persistedState.cashflows;

  const resolvedHistory = history
    ? cloneHistory(history)
    : parent ? cloneHistory(parent.history) : { brokerExecutedTrades: [], cashflows: [] };
  const rulesProvided = Object.prototype.hasOwnProperty.call(options, 'brokerRules');
  const brokerRules = rulesProvided
    ? (options.brokerRules ?? null)
    : parent ? parent.brokerRules : null;
  const storage = getBrowserStorage();
  let deviceActiveView = options.deviceActiveView ?? parent?.deviceActiveView ?? null;
  if (options.deviceActiveView === undefined && storage) {
    try {
      deviceActiveView = storage.getItem('portfolio_active_view') ?? deviceActiveView;
    } catch {
      // Keep the last committed device preference.
    }
  }

  const parentRevision = parent?.revision ?? 0;
  return {
    schemaVersion: 1,
    revision: parentRevision + 1,
    parentRevision,
    commitId: createPersistenceId(),
    originId: persistenceOriginId,
    committedAt: savedAt,
    state: persistedState,
    history: resolvedHistory,
    brokerRules,
    deviceActiveView
  };
}

async function flushPortfolioPersistenceOnce(): Promise<PortfolioPersistenceStatus> {
  const storage = getBrowserStorage();
  if (!storage) {
    updatePortfolioPersistenceStatus('degraded', hydratedPortfolioSnapshot?.revision ?? 0,
      'Local recovery storage is unavailable.');
    return getPortfolioPersistenceStatus();
  }

  try {
    const database = getPortfolioStateDatabase();
    let current = await database.readCurrent();

    const clearMetadata = readClearMarker(storage);
    const clearing = clearMetadata !== null;
    if (clearing) {
      await database.clear();
      storage.removeItem(STORAGE_KEY_ATOMIC_SNAPSHOT);
      hydratedPortfolioSnapshot = null;
      current = null;

      // The clear tombstone supersedes every pending pre-clear mutation. Purge
      // journal keys before seeding the empty generation so an interrupted
      // clear can never replay an old portfolio write into a newly cleared DB.
      const journalKeys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(STORAGE_KEY_PENDING_PREFIX)) journalKeys.push(key);
      }
      removeStoredKeys(storage, journalKeys);
      if (readPendingCount(storage) > 0) {
        throw new Error('Could not clear every pending portfolio recovery entry.');
      }
    } else if (current !== null && !isPortfolioSnapshotRecord(current)) {
      throw new Error('The IndexedDB portfolio snapshot has an unsupported or corrupted schema; the record was preserved and local recovery data was not discarded.');
    }

    if (!current) {
      const baseline = clearing
        ? makeEmptyPortfolioSnapshot(clearMetadata?.brokerRules ?? null, clearMetadata?.deviceActiveView ?? null)
        : readPortfolioSnapshotBase(storage) || makeEmptyPortfolioSnapshot();
      const seeded = await database.compareAndCommit(baseline, null);
      if (seeded === 'conflict') {
        updatePortfolioPersistenceStatus('conflict', baseline.revision,
          'Another tab initialized portfolio storage concurrently.');
        return getPortfolioPersistenceStatus();
      }
      current = baseline;
    }

    // A matching local checkpoint proves that this browser has a complete,
    // committed generation. Journals from older revisions may belong to a
    // crashed or superseded tab and cannot safely be replayed onto that newer
    // generation. Preserve them in IndexedDB first, then remove their local
    // copies so they neither block future saves nor exhaust localStorage quota.
    const localCheckpoint = readAtomicPortfolioSnapshot(storage);
    const checkpointMatchesCurrent = Boolean(
      current && localCheckpoint &&
      localCheckpoint.revision === current.revision &&
      localCheckpoint.commitId === current.commitId &&
      localCheckpoint.originId === current.originId
    );
    if (checkpointMatchesCurrent && current) {
      const superseded = readPendingPortfolioSnapshots(storage).filter((item) =>
        item.record.commitId !== current!.commitId &&
        item.record.revision <= current!.revision
      );
      if (superseded.length > 0) {
        const archivedAt = Date.now();
        const archiveRecords: PortfolioRecoveryArchiveRecord[] = superseded.map((item) => ({
          id: item.record.commitId,
          originalKey: item.key,
          archivedAt,
          reason: 'superseded-by-committed-checkpoint',
          payload: item.record
        }));
        // The adapter resolves only after the IndexedDB transaction commits.
        // If archiving fails, the local journals remain untouched for retry.
        await database.archiveRecoveryRecords(archiveRecords);
        removeStoredKeys(storage, superseded.map((item) => item.key));
      }
    }

    const committedKeys = new Set<string>();
    let hasConflict = false;
    let hasGap = false;

    while (true) {
      const pending = readPendingPortfolioSnapshots(storage);
      const alreadyCommitted = pending.filter((item) => item.record.commitId === current!.commitId);
      alreadyCommitted.forEach((item) => committedKeys.add(item.key));

      const candidates = pending.filter((item) =>
        item.record.parentRevision === current!.revision &&
        item.record.revision === current!.revision + 1
      );
      if (candidates.length > 1) {
        hasConflict = true;
        break;
      }
      if (candidates.length === 0) {
        const unresolved = pending.filter((item) => !committedKeys.has(item.key));
        hasConflict = unresolved.some((item) => item.record.parentRevision < current!.revision);
        hasGap = unresolved.some((item) => item.record.parentRevision > current!.revision);
        break;
      }

      const candidate = candidates[0];
      const completeRecord = materializePendingPortfolioSnapshot(current, candidate.record);
      const result = await database.compareAndCommit(completeRecord, current.revision);
      if (result === 'conflict') {
        hasConflict = true;
        current = await database.readCurrent() || current;
        break;
      }
      current = completeRecord;
      committedKeys.add(candidate.key);
    }

    // The committed database record is written to one local checkpoint key.
    // Pending journals are removed only after that checkpoint is also saved.
    storage.setItem(STORAGE_KEY_ATOMIC_SNAPSHOT, JSON.stringify(current));
    if (clearing) {
      // A clear operation intentionally leaves only the empty atomic snapshot;
      // remove any legacy mirrors that a concurrently completing prior write
      // may have restored while the clear transaction was in flight.
      removeStoredKeys(storage, [
        STORAGE_KEY_STATE,
        STORAGE_KEY_LEGACY_STATE,
        STORAGE_KEY_CLOSED_HISTORY
      ]);
      storage.removeItem(STORAGE_KEY_CLEAR_MARKER);
    }
    hydratedPortfolioSnapshot = current;
    lastScheduledRevision = current.revision;
    committedKeys.forEach((key) => {
      try { storage.removeItem(key); } catch { /* Recovery remains in IndexedDB. */ }
    });

    const remaining = readPendingCount(storage);
    const state = hasConflict ? 'conflict' : hasGap || remaining > 0 ? 'degraded' : 'ready';
    const message = hasConflict
      ? 'A newer portfolio revision exists in another tab. Conflicting local changes were preserved for recovery.'
      : hasGap || remaining > 0
        ? 'Some local portfolio journal entries are waiting for their parent revision.'
        : null;
    updatePortfolioPersistenceStatus(state, current.revision, message);
    return getPortfolioPersistenceStatus();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let localRevision = hydratedPortfolioSnapshot?.revision ?? 0;
    try {
      const local = storage ? resolveLocalPortfolioSnapshot(storage).record : null;
      localRevision = local?.revision ?? localRevision;
    } catch {
      // Preserve the original storage/IndexedDB failure as the surfaced cause.
    }
    updatePortfolioPersistenceStatus('degraded', localRevision, message);
    return getPortfolioPersistenceStatus();
  }
}

export async function flushPortfolioPersistence(): Promise<PortfolioPersistenceStatus> {
  if (portfolioPersistenceFlush) {
    // A new journal entry may have arrived while the current transaction was
    // draining. Ask the active drain to make one more pass after it completes.
    portfolioPersistenceFlushRequested = true;
    return portfolioPersistenceFlush;
  }

  portfolioPersistenceFlush = (async () => {
    let status = await flushPortfolioPersistenceOnce();
    while (portfolioPersistenceFlushRequested) {
      portfolioPersistenceFlushRequested = false;
      status = await flushPortfolioPersistenceOnce();
    }
    return status;
  })().finally(() => {
    portfolioPersistenceFlush = null;
    if (portfolioPersistenceFlushRequested) {
      portfolioPersistenceFlushRequested = false;
      void flushPortfolioPersistence();
    }
  });
  return portfolioPersistenceFlush;
}

/**
 * Reconciles the local recovery journal with the transactional IndexedDB
 * snapshot. It is called after administrator identity is known, before the
 * local administrator workspace is imported into PortfolioStore.
 */
export async function hydratePortfolioPersistence(): Promise<PortfolioPersistenceStatus> {
  const status = await flushPortfolioPersistence();
  const storage = getBrowserStorage();
  if (storage && lastScheduledRevision === null) {
    const local = resolveLocalPortfolioSnapshot(storage).record;
    lastScheduledRevision = local?.revision ?? 0;
  }
  return status;
}

function schedulePortfolioPersistenceFlush(): void {
  if (!isPortfolioStateDatabaseAvailable()) {
    const storage = getBrowserStorage();
    const local = storage ? resolveLocalPortfolioSnapshot(storage).record : null;
    updatePortfolioPersistenceStatus('degraded', local?.revision ?? 0, 'IndexedDB is unavailable; the local recovery journal is retained.');
    return;
  }
  void flushPortfolioPersistence();
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
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(GW_KEY_STORE)) {
        request.result.createObjectStore(GW_KEY_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open secure key storage'));
  });
}

async function getOrCreateDeviceKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
    const request = db.transaction(GW_KEY_STORE, 'readonly').objectStore(GW_KEY_STORE).get(GW_KEY_ID);
    request.onsuccess = () => resolve(request.result as CryptoKey | undefined);
    request.onerror = () => reject(request.error);
  });
  if (existing) return existing;
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable');
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(GW_KEY_STORE, 'readwrite');
    tx.objectStore(GW_KEY_STORE).put(key, GW_KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Secure key storage transaction aborted'));
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
    const key = await getOrCreateDeviceKey(db);
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
    console.warn('Encrypted Gateway Secret payload is invalid; clearing it:', err);
    try { storage.removeItem(STORAGE_KEY_GW_AUTH_ENCRYPTED); } catch { /* storage unavailable */ }
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
    // Decryption failure means the payload is corrupt or the stored device key
    // no longer matches it. Keep the established fallback to re-enter the secret.
    console.warn('Could not decrypt encrypted Gateway Secret; clearing unusable ciphertext:', err);
    try { storage.removeItem(STORAGE_KEY_GW_AUTH_ENCRYPTED); } catch { /* storage unavailable */ }
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
  logTerminal?: (message: string) => void;
  [key: string]: unknown;
}

/**
 * Validates, saves, and confirms Gateway credentials.
 */
export async function saveApiKeys(options: SaveApiKeysOptions): Promise<boolean> {
  const { secret, showToast, logTerminal } = options || {};
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
    if (typeof logTerminal === 'function') logTerminal(message);
    if (typeof showToast === 'function') showToast(message, 'error');
    return false;
  }

  if (typeof logTerminal === 'function') {
    logTerminal('Gateway Secret saved. Remote access has not been verified yet.');
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
 * Commits one complete recovery-journal record synchronously, then mirrors that
 * generation into IndexedDB through a revision-checked readwrite transaction.
 *
 * The synchronous store contract is intentionally retained: success means the
 * single local recovery record was committed, not that the asynchronous
 * IndexedDB mirror has finished. A journal entry is kept until the IndexedDB
 * transaction and local checkpoint both complete.
 */
function persistPortfolioSnapshot(
  state: Record<string, any>,
  history: ClosedHistorySnapshot | null,
  options: PortfolioSnapshotOptions = {}
): PortfolioSnapshotPersistResult {
  const storage = getBrowserStorage();
  if (!storage) return { success: false, stateChanged: false, savedAt: null };
  if (readClearMarker(storage) !== null) {
    updatePortfolioPersistenceStatus('degraded', hydratedPortfolioSnapshot?.revision ?? 0,
      'Portfolio reset is still being finalized; retry this change after local recovery completes.');
    return { success: false, stateChanged: false, savedAt: null };
  }

  let local: ReturnType<typeof resolveLocalPortfolioSnapshot>;
  try {
    local = resolveLocalPortfolioSnapshot(storage);
  } catch (error) {
    console.error('Failed to inspect the local portfolio recovery journal:', error);
    updatePortfolioPersistenceStatus('degraded', hydratedPortfolioSnapshot?.revision ?? 0,
      error instanceof Error ? error.message : String(error));
    return { success: false, stateChanged: false, savedAt: null };
  }
  if (local.conflict) {
    updatePortfolioPersistenceStatus('conflict', local.record?.revision ?? 0,
      'Conflicting local portfolio journal entries must be reconciled before another save.');
    return { success: false, stateChanged: false, savedAt: null };
  }
  const parent = local.record;
  const pendingCount = readPendingCount(storage);
  // A cleared/replaced browser storage area starts a new local generation.
  // Module state from a prior page/test storage instance must not make the
  // first valid write appear stale; the IndexedDB CAS still protects against
  // an older durable generation in another tab.
  const atomicCheckpoint = readAtomicPortfolioSnapshot(storage);
  if (
    pendingCount === 0 &&
    (!atomicCheckpoint || parent?.commitId === 'legacy-portfolio-snapshot')
  ) {
    // No committed v1 checkpoint or journal exists in this Storage area. A
    // revision held only in module memory may belong to a previous account,
    // tab fixture, or pre-migration session. Rebase on the durable legacy base;
    // the IndexedDB compare-and-commit still rejects a stale cross-tab write.
    lastScheduledRevision = parent?.revision ?? 0;
  } else if (lastScheduledRevision === null) {
    lastScheduledRevision = parent?.revision ?? 0;
  }
  if ((parent?.revision ?? 0) !== lastScheduledRevision) {
    updatePortfolioPersistenceStatus('conflict', parent?.revision ?? 0,
      'This tab is behind a newer portfolio revision. Reload and reconcile before saving.');
    return { success: false, stateChanged: false, savedAt: null };
  }

  const savedAt = Date.now();
  let record: PortfolioStateSnapshotRecord;
  let serializedRecord: string;
  let stateChanged = true;
  try {
    record = makePortfolioSnapshotRecord(state, history, options, parent, savedAt);
    const journalRecord: PendingPortfolioSnapshotRecord = {
      schemaVersion: record.schemaVersion,
      revision: record.revision,
      parentRevision: record.parentRevision,
      commitId: record.commitId,
      originId: record.originId,
      committedAt: record.committedAt,
      state: record.state,
      ...(history !== null ? { history: record.history } : {}),
      ...(Object.prototype.hasOwnProperty.call(options, 'brokerRules') ? { brokerRules: record.brokerRules } : {}),
      ...(typeof options.deviceActiveView === 'string' ? { deviceActiveView: record.deviceActiveView } : {})
    };
    serializedRecord = JSON.stringify(journalRecord);
    if (parent) {
      stateChanged = JSON.stringify(parent.state, (key, value) =>
        key === 'lastUpdated' ? undefined : value
      ) !== JSON.stringify(record.state, (key, value) =>
        key === 'lastUpdated' ? undefined : value
      );
    }
  } catch (error) {
    console.error('Failed to serialize portfolio snapshot:', error);
    return { success: false, stateChanged: false, savedAt: null };
  }

  const previousDeviceView = typeof options.deviceActiveView === 'string'
    ? (() => {
      try { return storage.getItem('portfolio_active_view'); } catch { return null; }
    })()
    : null;
  if (typeof options.deviceActiveView === 'string') {
    try {
      storage.setItem('portfolio_active_view', options.deviceActiveView);
    } catch (error) {
      console.error('Failed to save device desk preference:', error);
      return { success: false, stateChanged: false, savedAt: null };
    }
  }

  const journalKey = STORAGE_KEY_PENDING_PREFIX + record.commitId;
  try {
    // One setItem is the synchronous commit boundary used by PortfolioStore.
    storage.setItem(journalKey, serializedRecord);
  } catch (error) {
    if (typeof options.deviceActiveView === 'string') {
      try {
        if (previousDeviceView === null) storage.removeItem('portfolio_active_view');
        else storage.setItem('portfolio_active_view', previousDeviceView);
      } catch (rollbackError) {
        console.error('Failed to restore device desk preference after a rejected portfolio write:', rollbackError);
      }
    }
    console.error('Failed to write the local portfolio recovery journal:', error);
    return { success: false, stateChanged: false, savedAt: null };
  }

  lastScheduledRevision = record.revision;
  state.lastUpdated = savedAt;
  if (history) lastPersistedHistory = history;

  // Legacy mirrors are deliberately best-effort. They are no longer part of
  // the commit boundary; a mirror quota error cannot invalidate the journal.
  writeLegacyCompatibilityMirrors(storage, record);
  updatePortfolioPersistenceStatus('pending', record.revision, null);
  schedulePortfolioPersistenceFlush();
  return { success: true, stateChanged, savedAt };
}

export function savePortfolioSnapshot<TState extends object>(
  state: TState,
  history: ClosedHistorySnapshot,
  options: PortfolioSnapshotOptions = {}
): boolean {
  if (!state || typeof state !== 'object' || Array.isArray(state) ||
      !history || !Array.isArray(history.brokerExecutedTrades) ||
      !Array.isArray(history.cashflows)) {
    return false;
  }
  return persistPortfolioSnapshot(state as Record<string, any>, history, options).success;
}

/**
 * Persists application state to a single local recovery-journal record and
 * schedules its revision-checked IndexedDB commit. A true return value means
 * the recovery journal is committed locally; IndexedDB mirroring is tracked
 * separately by PortfolioPersistenceStatus.
 */
export function saveState<TState extends object>(
  state?: TState | null,
  onPushToGist?: (forcePrompt?: boolean) => void,
  options: PortfolioSnapshotOptions = {}
): boolean {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
  const mutableState = state as TState & Record<string, any>;
  const brokerExecutedTrades = Array.isArray(mutableState.brokerExecutedTrades)
    ? mutableState.brokerExecutedTrades
    : [];
  const cashflows = Array.isArray(mutableState.cashflows) ? mutableState.cashflows : [];
  let persistedHistory = lastPersistedHistory;
  try {
    const storage = getBrowserStorage();
    const currentSnapshot = storage ? resolveLocalPortfolioSnapshot(storage).record : null;
    persistedHistory = currentSnapshot?.history ?? persistedHistory;
  } catch (error) {
    console.error('Failed to inspect persisted portfolio history before saving:', error);
    return false;
  }
  const baselineHistory = persistedHistory || {
    brokerExecutedTrades: [],
    cashflows: []
  };
  const historyChanged =
    JSON.stringify(baselineHistory.brokerExecutedTrades) !== JSON.stringify(brokerExecutedTrades) ||
    JSON.stringify(baselineHistory.cashflows) !== JSON.stringify(cashflows);

  const result = persistPortfolioSnapshot(
    mutableState,
    historyChanged ? { brokerExecutedTrades, cashflows } : null,
    options
  );
  if (!result.success) return false;

  if (result.stateChanged && typeof onPushToGist === 'function') {
    try {
      onPushToGist(false);
    } catch (error) {
      console.error('Failed to trigger Gist sync:', error);
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
    if (storage.getItem(STORAGE_KEY_CLEAR_MARKER)) return fallback;
    const resolved = resolveLocalPortfolioSnapshot(storage);
    if (resolved.record) {
      if (resolved.conflict) {
        updatePortfolioPersistenceStatus('conflict', resolved.record.revision,
          'Conflicting local portfolio journal entries were preserved for recovery.');
      }
      const persistedState = { ...resolved.record.state };
      delete persistedState.gatewaySecret;
      delete persistedState.brokerExecutedTrades;
      delete persistedState.cashflows;
      return { ...fallback, ...persistedState };
    }

    // A damaged current entry must not hide a recoverable legacy snapshot.
    for (const key of [STORAGE_KEY_STATE, STORAGE_KEY_LEGACY_STATE]) {
      const raw = storage.getItem(key);
      if (!raw || !raw.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!isPlainObject(parsed)) continue;
        const persistedState = { ...parsed };
        delete persistedState.gatewaySecret;
        delete persistedState.brokerExecutedTrades;
        delete persistedState.cashflows;
        return { ...fallback, ...persistedState };
      } catch (error) {
        console.warn('Failed to parse saved state:', error);
      }
    }
    return fallback;
  } catch (error) {
    console.warn('Storage unavailable; using in-memory portfolio state:', error);
    return fallback;
  }
}

/** Load large closed-history collections only when the history section needs them. */
/** Persist closed-history source rows and calculated fee metadata independently of portfolio state. */
export function saveSavedHistory(history: { brokerExecutedTrades?: unknown[]; cashflows?: unknown[] }): boolean {
  if (!getBrowserStorage()) return false;
  const snapshot = {
    brokerExecutedTrades: Array.isArray(history.brokerExecutedTrades) ? history.brokerExecutedTrades : [],
    cashflows: Array.isArray(history.cashflows) ? history.cashflows : []
  };
  const storage = getBrowserStorage();
  if (!storage) return false;
  const local = resolveLocalPortfolioSnapshot(storage);
  const base = local.record || makeEmptyPortfolioSnapshot();
  const state = { ...base.state };
  return persistPortfolioSnapshot(state, snapshot, {
    ...(base.brokerRules !== null ? { brokerRules: base.brokerRules as BrokerAssumptions } : {})
  }).success;
}

export function loadSavedHistory(): ClosedHistorySnapshot {
  const storage = getBrowserStorage();
  if (!storage) return { brokerExecutedTrades: [], cashflows: [] };
  let resolved: ReturnType<typeof resolveLocalPortfolioSnapshot>;
  try {
    if (storage.getItem(STORAGE_KEY_CLEAR_MARKER)) {
      return { brokerExecutedTrades: [], cashflows: [] };
    }
    resolved = resolveLocalPortfolioSnapshot(storage);
  } catch (error) {
    console.warn('Failed to read saved portfolio history:', error);
    return { brokerExecutedTrades: [], cashflows: [] };
  }
  if (resolved.record) {
    const history = cloneHistory(resolved.record.history);
    lastPersistedHistory = history;
    // Migrate inline legacy history to the established sidecar only when no
    // sidecar exists. A malformed sidecar is forensic evidence and is never
    // overwritten by an automatic fallback.
    try {
      if (storage.getItem(STORAGE_KEY_CLOSED_HISTORY) === null) {
        storage.setItem(STORAGE_KEY_CLOSED_HISTORY, JSON.stringify(history));
      }
    } catch (error) {
      console.warn('Could not migrate legacy closed history to its sidecar:', error);
    }
    if (resolved.conflict) {
      updatePortfolioPersistenceStatus('conflict', resolved.record.revision,
        'Conflicting local portfolio journal entries were preserved for recovery.');
    }
    return history;
  }

  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY_CLOSED_HISTORY);
  } catch (error) {
    console.warn('Failed to read saved closed history:', error);
    return { brokerExecutedTrades: [], cashflows: [] };
  }

  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isPlainObject(parsed)) throw new Error('Saved closed history must be an object.');
      const history = {
        brokerExecutedTrades: Array.isArray(parsed.brokerExecutedTrades) ? parsed.brokerExecutedTrades : [],
        cashflows: Array.isArray(parsed.cashflows) ? parsed.cashflows : []
      };
      lastPersistedHistory = history;
      return history;
    } catch (error) {
      // Keep damaged evidence intact; embedded legacy history may still recover it.
      console.warn('Failed to parse saved closed history:', error);
    }
  }

  const legacy = readLegacyPortfolioSnapshot(storage);
  if (legacy) {
    lastPersistedHistory = cloneHistory(legacy.history);
    return cloneHistory(legacy.history);
  }
  return { brokerExecutedTrades: [], cashflows: [] };
}

/**
 * Loads untrusted saved broker settings; missing or malformed JSON returns null.
 */
export function loadBrokerRules(): unknown {
  const storage = getBrowserStorage();
  if (!storage) return null;
  const resolved = resolveLocalPortfolioSnapshot(storage);
  if (resolved.record) return resolved.record.brokerRules;
  try {
    const raw = storage.getItem(STORAGE_KEY_RULES);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch (error) {
    console.warn('Failed to parse saved broker rules:', error);
    return null;
  }
}

/**
 * Saves broker assumptions as part of the same versioned portfolio record.
 */
export function saveBrokerRules(rules: BrokerAssumptions): void {
  const storage = getBrowserStorage();
  if (!storage) return;
  const local = resolveLocalPortfolioSnapshot(storage);
  const base = local.record || makeEmptyPortfolioSnapshot();
  persistPortfolioSnapshot({ ...base.state }, base.history, { brokerRules: rules });
}

/** Clears broker assumptions through the same atomic portfolio journal. */
export function clearBrokerRules(): void {
  const storage = getBrowserStorage();
  if (!storage) return;
  const local = resolveLocalPortfolioSnapshot(storage);
  const base = local.record || makeEmptyPortfolioSnapshot();
  persistPortfolioSnapshot({ ...base.state }, base.history, { brokerRules: null });
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
    // Preserve settings that this legacy API intentionally does not clear.
    const previous = resolveLocalPortfolioSnapshot(storage).record || readLegacyPortfolioSnapshot(storage);
    let brokerRules = previous?.brokerRules ?? null;
    let deviceActiveView = previous?.deviceActiveView ?? null;
    try {
      if (brokerRules === null) {
        const rawRules = storage.getItem(STORAGE_KEY_RULES);
        if (rawRules) brokerRules = JSON.parse(rawRules);
      }
      deviceActiveView = storage.getItem('portfolio_active_view') ?? deviceActiveView;
    } catch {
      // Settings are best-effort metadata; the clear marker remains authoritative.
    }

    // The tombstone is the first write. It remains until the empty generation
    // is committed to IndexedDB and its local checkpoint is written, preventing
    // an interrupted delete from reviving an old local or IndexedDB snapshot.
    storage.setItem(STORAGE_KEY_CLEAR_MARKER, JSON.stringify({
      schemaVersion: 1,
      clearedAt: Date.now(),
      brokerRules,
      deviceActiveView
    }));
    const keysToRemove: string[] = [
      STORAGE_KEY_LEGACY_STATE,
      STORAGE_KEY_STATE,
      STORAGE_KEY_CLOSED_HISTORY,
      STORAGE_KEY_ATOMIC_SNAPSHOT
    ];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(STORAGE_KEY_PENDING_PREFIX)) keysToRemove.push(key);
    }
    removeStoredKeys(storage, keysToRemove);
    hydratedPortfolioSnapshot = null;
    lastScheduledRevision = 0;
    lastPersistedHistory = null;
    updatePortfolioPersistenceStatus('pending', 0, null);
    schedulePortfolioPersistenceFlush();
  } catch (error) {
    console.error('Failed to mark and clear local portfolio data:', error);
    updatePortfolioPersistenceStatus('degraded', hydratedPortfolioSnapshot?.revision ?? 0,
      'Could not safely clear local portfolio data.');
  }
}
