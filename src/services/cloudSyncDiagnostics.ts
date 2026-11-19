type CloudSyncDiagnosticOperation = 'pull' | 'push' | 'reconcile';
type CloudSyncDiagnosticOutcome = 'success' | 'conflict' | 'error';
export type CloudSyncDiagnosticReason =
  | 'confirmed'
  | 'auto-reconciled'
  | 'missing-credentials'
  | 'remote-record-missing'
  | 'revision-conflict'
  | 'overlapping-edits'
  | 'transaction-history-conflict'
  | 'http-unauthorized'
  | 'http-forbidden'
  | 'http-server-error'
  | 'http-error'
  | 'timeout'
  | 'network'
  | 'decryption-failed'
  | 'invalid-payload'
  | 'local-storage-failed'
  | 'local-apply-rejected'
  | 'no-accepted-baseline'
  | 'latest-revision-unavailable'
  | 'legacy-history-requires-migration'
  | 'local-edits-changed-during-merge'
  | 'conditional-retry-failed'
  | 'unknown';

export interface CloudSyncDiagnostic {
  timestamp: number;
  operation: CloudSyncDiagnosticOperation;
  outcome: CloudSyncDiagnosticOutcome;
  reason: CloudSyncDiagnosticReason;
  httpStatus?: number;
  expectedRevision?: number;
  observedRevision?: number;
}

export interface CloudSyncDiagnosticsStore {
  getSnapshot: () => CloudSyncDiagnostic[];
  subscribe: (listener: (entries: CloudSyncDiagnostic[]) => void) => () => void;
  record: (entry: Omit<CloudSyncDiagnostic, 'timestamp'> & { timestamp?: number }) => CloudSyncDiagnostic;
  clear: () => void;
}

const STORAGE_KEY = 'portfolio_cloud_sync_diagnostics_v1';
const MAX_ENTRIES = 3;
const OPERATIONS = new Set<CloudSyncDiagnosticOperation>(['pull', 'push', 'reconcile']);
const OUTCOMES = new Set<CloudSyncDiagnosticOutcome>(['success', 'conflict', 'error']);
const REASONS = new Set<CloudSyncDiagnosticReason>([
  'confirmed', 'auto-reconciled', 'missing-credentials', 'remote-record-missing',
  'revision-conflict', 'overlapping-edits', 'transaction-history-conflict',
  'http-unauthorized', 'http-forbidden', 'http-server-error', 'http-error',
  'timeout', 'network', 'decryption-failed', 'invalid-payload',
  'local-storage-failed', 'local-apply-rejected', 'no-accepted-baseline',
  'latest-revision-unavailable', 'legacy-history-requires-migration',
  'local-edits-changed-during-merge', 'conditional-retry-failed', 'unknown'
]);

type DiagnosticsStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserSessionStorage(): DiagnosticsStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeRevision(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function normalizeEntry(value: unknown): CloudSyncDiagnostic | null {
  if (!isRecord(value) ||
      !Number.isFinite(value.timestamp) ||
      Number(value.timestamp) <= 0 ||
      !OPERATIONS.has(value.operation as CloudSyncDiagnosticOperation) ||
      !OUTCOMES.has(value.outcome as CloudSyncDiagnosticOutcome) ||
      !REASONS.has(value.reason as CloudSyncDiagnosticReason)) return null;

  const httpStatus = Number.isInteger(value.httpStatus) && Number(value.httpStatus) >= 100 && Number(value.httpStatus) <= 599
    ? Number(value.httpStatus)
    : undefined;
  const expectedRevision = safeRevision(value.expectedRevision);
  const observedRevision = safeRevision(value.observedRevision);
  return {
    timestamp: Number(value.timestamp),
    operation: value.operation as CloudSyncDiagnosticOperation,
    outcome: value.outcome as CloudSyncDiagnosticOutcome,
    reason: value.reason as CloudSyncDiagnosticReason,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    ...(observedRevision === undefined ? {} : { observedRevision })
  };
}

function loadEntries(storage: DiagnosticsStorage | null): CloudSyncDiagnostic[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed.map(normalizeEntry).filter((entry): entry is CloudSyncDiagnostic => entry !== null).slice(0, MAX_ENTRIES)
      : [];
  } catch {
    return [];
  }
}

/**
 * Retains only coarse, allowlisted synchronization metadata for the current tab.
 * It never stores error messages, URLs, account identifiers, credentials,
 * encrypted payloads, or portfolio data. sessionStorage lets a refresh retain
 * the last result without making diagnostics a cross-session account record.
 */
export function createCloudSyncDiagnosticsStore(
  getStorage: () => DiagnosticsStorage | null = browserSessionStorage
): CloudSyncDiagnosticsStore {
  let entries = loadEntries(getStorage());
  const listeners = new Set<(snapshot: CloudSyncDiagnostic[]) => void>();

  const publish = (): void => {
    const snapshot = entries.map((entry) => ({ ...entry }));
    listeners.forEach((listener) => listener(snapshot));
  };

  const persist = (): void => {
    try {
      getStorage()?.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // Diagnostics are best-effort and must never interrupt synchronization.
    }
  };

  return {
    getSnapshot: () => entries.map((entry) => ({ ...entry })),
    subscribe: (listener) => {
      listeners.add(listener);
      listener(entries.map((entry) => ({ ...entry })));
      return () => listeners.delete(listener);
    },
    record: (value) => {
      const entry = normalizeEntry({ ...value, timestamp: value.timestamp ?? Date.now() });
      if (!entry) throw new TypeError('Invalid cloud synchronization diagnostic.');
      entries = [entry, ...entries].slice(0, MAX_ENTRIES);
      persist();
      publish();
      return { ...entry };
    },
    clear: () => {
      entries = [];
      try {
        getStorage()?.removeItem(STORAGE_KEY);
      } catch {
        // Clearing diagnostic metadata is best-effort.
      }
      publish();
    }
  };
}

const cloudSyncDiagnosticsStore = createCloudSyncDiagnosticsStore();

export const getCloudSyncDiagnostics = cloudSyncDiagnosticsStore.getSnapshot;
export const subscribeCloudSyncDiagnostics = cloudSyncDiagnosticsStore.subscribe;
export const recordCloudSyncDiagnostic = cloudSyncDiagnosticsStore.record;
export const clearCloudSyncDiagnostics = cloudSyncDiagnosticsStore.clear;
