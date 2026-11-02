import type { CloudRevisionCoordinator } from './cloudRevisionCoordinator';

export interface SyncOptions {
  state?: any;
  secret?: string;
  pullCloudAndRewriteLocal?: (state: any) => void;
  getState?: () => any;
  showToast?: (msg: string, type: string) => void;
  logTerminal?: (msg: string) => void;
  onStatusChange?: (status: 'synced' | 'error') => void;
  isCurrentSession?: () => boolean;
  allowCloudWrites?: boolean;
}
export interface CloudStateSyncRuntimeDependencies {
  workerProxyUrl: string;
  getActiveGatewaySecret: () => string;
  encryptCloudPayload: (plaintext: string, sessionToken: string) => Promise<string>;
  decryptCloudPayload: (payload: string, sessionToken: string) => Promise<{ plaintext: string; legacy: boolean }>;
  readCloudRevision: (headers?: Headers | null) => number | null;
  revisionCoordinator: Pick<CloudRevisionCoordinator, 'recordPulledRevision' | 'setRevision' | 'enqueueWrite'>;
  processRollovers: (state: any) => boolean;
  loadSavedState: (fallback: any) => any;
  loadSavedHistory: () => { brokerExecutedTrades: unknown[]; cashflows: unknown[] };
  saveState: (state: any) => boolean;
  normalizeFreedomTrades: (trades: unknown) => any[];
  fetchImpl?: typeof fetch;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  now?: () => number;
}
export interface CloudStateSyncRuntime {
  pullCloudState: (options?: SyncOptions | ((state: any) => void), reportResult?: (success: boolean) => void) => Promise<any>;
  pushCloudState: (state?: any, options?: SyncOptions) => Promise<boolean>;
  syncCloudState: (mode?: string, options?: SyncOptions) => Promise<boolean>;
  pushCloudHistory: (history: { brokerExecutedTrades?: unknown[]; cashflows?: unknown[] }, secret?: string, knownRevision?: number, options?: Pick<SyncOptions, 'isCurrentSession'>) => Promise<boolean>;
  clearCloudHistory: (secret?: string, options?: Pick<SyncOptions, 'isCurrentSession'>) => Promise<boolean>;
  pullCloudHistory: (secret?: string) => Promise<{ brokerExecutedTrades: unknown[]; cashflows: unknown[] } | null>;
  clearRequestCache: () => void;
}

/** Coordinates encrypted portfolio/history transfer, legacy migration and per-secret caches. */
export function createCloudStateSyncRuntime({
  workerProxyUrl,
  getActiveGatewaySecret,
  encryptCloudPayload,
  decryptCloudPayload,
  readCloudRevision,
  revisionCoordinator,
  processRollovers,
  loadSavedState,
  loadSavedHistory,
  saveState,
  normalizeFreedomTrades,
  fetchImpl: injectedFetch,
  storage: injectedStorage,
  now: injectedNow
}: CloudStateSyncRuntimeDependencies): CloudStateSyncRuntime {
  const fetchImpl = injectedFetch ?? ((input, init) => fetch(input, init));
  const now = injectedNow || Date.now;
  const getLocalStorage = (): Pick<Storage, 'getItem' | 'setItem'> | null => {
    if (injectedStorage !== undefined) return injectedStorage;
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
  };

  const apiUrl = (path: string): string => new URL(path, workerProxyUrl).toString();
  const authHeaders = (secret: string, ifMatch?: string): Record<string, string> => ({
    'Content-Type': 'application/json', 'X-App-Auth': secret,
    Authorization: `Bearer ${secret}`,
    ...(ifMatch ? { 'If-Match': ifMatch } : {})
  });
  const responseError = async (response: Response): Promise<string> => {
    const data = await response.json().catch(() => null);
    return typeof data === 'object' && data !== null
      ? (data.error || data.message || `HTTP ${response.status}`)
      : `HTTP ${response.status}`;
  };
  const cloudStatePushFingerprints = new Map<string, string>();

async function pullCloudState(
  options: SyncOptions | ((state: any) => void) = {},
  reportResult?: (success: boolean) => void
): Promise<any> {
  const handlers: SyncOptions = typeof options === 'function' ? { pullCloudAndRewriteLocal: options } : options;
  const {
    state,
    pullCloudAndRewriteLocal,
    showToast = (msg: string, type: string) => console.log(`[${type}] ${msg}`),
    logTerminal = (msg: string) => console.log(msg)
  } = handlers;

  const currentSecret = handlers.secret || getActiveGatewaySecret();
  const isCurrentSession = handlers.isCurrentSession || (() => true);
  const stalePullFallback = () => {
    reportResult?.(false);
    return loadSavedState(state || {});
  };

  if (!currentSecret) {
    reportResult?.(false);
    showToast('Gateway Secret required to access cloud state.', 'error');
    return loadSavedState(state || {});
  }

  // showToast('Pulling portfolio from KV cloud...', 'info');

  try {
    const url = apiUrl('/api/state');
    if (!isCurrentSession()) return stalePullFallback();
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: authHeaders(currentSecret)
    });
    if (!isCurrentSession()) return stalePullFallback();

    const pulledRevision = readCloudRevision(res.headers);

    if (res.status === 404) {
      cloudStatePushFingerprints.delete(currentSecret);
      // A confirmed empty cloud store is safe to use as the current base revision.
      if (pulledRevision !== null) {
        revisionCoordinator.recordPulledRevision(pulledRevision);
      }
      reportResult?.(false);
      logTerminal('[KV Cloud]: State not found (404). Falling back to local storage.');
      return loadSavedState(state || {});
    }

    if (!res.ok) {
      const errorMessage = await responseError(res);
      if (!isCurrentSession()) return stalePullFallback();
      throw new Error(errorMessage);
    }

    const data = await res.json();
    if (!isCurrentSession()) return stalePullFallback();
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid state payload from KV.');
    }

    let parsedState: any;
    let requiresEncryptionUpgrade = false;
    if (typeof data.encryptedPayload === 'string') {
      try {
        const decrypted = await decryptCloudPayload(data.encryptedPayload, currentSecret);
        if (!isCurrentSession()) return stalePullFallback();
        requiresEncryptionUpgrade = decrypted.legacy;
        try {
          parsedState = JSON.parse(decrypted.plaintext);
        } catch (parseErr: any) {
          throw new Error(`Invalid JSON in decrypted state: ${parseErr.message}`);
        }
      } catch (decryptErr: any) {
        console.error('[Sync]: Cloud payload authentication/decryption failed.');
        throw new Error(`Failed to decrypt cloud state: ${decryptErr instanceof Error ? decryptErr.message : 'invalid ciphertext'}`);
      }
    } else {
      parsedState = data;
      requiresEncryptionUpgrade = true;
    }

    if (!parsedState || typeof parsedState !== 'object') {
      throw new Error('Invalid state payload from KV.');
    }

    if ('marginBalance' in parsedState) {
      delete parsedState.marginBalance;
    }

    if (!parsedState.lastRolloverTimestamp) {
      parsedState.lastRolloverTimestamp = now();
    }

    // Migrate legacy history out of the main cloud snapshot. Prefer whichever
    // source has data; the dedicated record is written before the main snapshot
    // is compacted, so a failed history write cannot silently discard records.
    const localHistory = loadSavedHistory();
    const legacyCloudExecutions = normalizeFreedomTrades(parsedState.brokerExecutedTrades);
    const localExecutions = normalizeFreedomTrades(localHistory.brokerExecutedTrades);
    const localExecutionsById = new Map(localExecutions
      .filter((trade) => Boolean(trade.id))
      .map((trade) => [trade.id, trade]));
    // Legacy portfolio snapshots may predate fee allocation. Keep the cloud's
    // execution fields but restore locally calculated fee metadata by stable ID,
    // so opening Balance cannot migrate an older snapshot over allocated fees.
    const migratedExecutions = legacyCloudExecutions.map((trade) => {
      const local = localExecutionsById.get(trade.id);
      if (!local) return trade;
      const preserved = { ...trade };
      preserved.marginFeeAllocations = local.marginFeeAllocations ?? trade.marginFeeAllocations;
      preserved.marginFee = local.marginFee ?? trade.marginFee;
      preserved.feesAndCommissions = local.feesAndCommissions ?? trade.feesAndCommissions;
      preserved.netProfit = local.netProfit ?? trade.netProfit;
      return preserved;
    });
    const legacyHistory = {
      brokerExecutedTrades: migratedExecutions.length ? migratedExecutions : localHistory.brokerExecutedTrades,
      cashflows: localHistory.cashflows.length
        ? localHistory.cashflows
        : (Array.isArray(parsedState.cashflows) ? parsedState.cashflows : [])
    };
    const hasHistory = legacyHistory.brokerExecutedTrades.length > 0 || legacyHistory.cashflows.length > 0;
    let historyMigrationComplete = false;
    try { historyMigrationComplete = getLocalStorage()?.getItem(CLOSED_HISTORY_MIGRATION_KEY) === '1'; } catch { /* migrate safely when storage is unavailable */ }
    if (hasHistory && !historyMigrationComplete) {
      // A dedicated history record may already have newer data. Never overwrite
      // it with the legacy copy embedded in an older portfolio snapshot. Only
      // migrate legacy rows when the dedicated record does not exist yet.
      const historySnapshot = await pullCloudHistorySnapshot(currentSecret);
      if (!isCurrentSession()) return stalePullFallback();
      if (!historySnapshot.history && (legacyHistory.brokerExecutedTrades.length || legacyHistory.cashflows.length)) {
        // Guest sessions are read-only. Do not attempt the legacy-history POST:
        // a 403 here would abort the portfolio pull before the guest UI is updated.
        if (handlers.allowCloudWrites !== false) {
          // Reuse the 404's revision (normally 0) for the migration POST instead of
          // issuing a second GET solely to discover the same ETag.
          await pushCloudHistory(legacyHistory, currentSecret, historySnapshot.revision);
          if (!isCurrentSession()) return stalePullFallback();
        }
      } else if (historySnapshot.history && handlers.allowCloudWrites !== false) {
        try { getLocalStorage()?.setItem(CLOSED_HISTORY_MIGRATION_KEY, '1'); } catch { /* migration can be rechecked next session */ }
      }
    }
    delete parsedState.brokerExecutedTrades;
    delete parsedState.cashflows;
    const mergedLocalData = hasHistory;

    if (!isCurrentSession()) return stalePullFallback();
    const wasUpdated = processRollovers(parsedState);
    if (!saveState(parsedState)) {
      throw new Error('Cloud state was downloaded but could not be saved to this device. Check browser storage availability and free space, then retry.');
    }

    cloudStatePushFingerprints.delete(currentSecret);
    // Only trust the cloud revision after its payload was decrypted, validated,
    // and persisted locally. A failed pull must not authorize a later overwrite.
    if (pulledRevision !== null) {
      revisionCoordinator.recordPulledRevision(pulledRevision);
    }

    if (handlers.allowCloudWrites !== false && (wasUpdated || requiresEncryptionUpgrade || mergedLocalData)) {
      pushCloudState(parsedState, {
        ...handlers,
        secret: currentSecret,
        showToast: () => { }
      }).catch((err) => {
        console.warn(wasUpdated ? 'Background rollover sync failed:' : 'Background cloud encryption upgrade failed:', err);
      });
    }

    if (typeof pullCloudAndRewriteLocal === 'function' && isCurrentSession()) {
      pullCloudAndRewriteLocal(parsedState);
    }

    reportResult?.(true);
    return parsedState;
  } catch (err: any) {
    if (!isCurrentSession()) return stalePullFallback();
    reportResult?.(false);
    console.error('Failed to pull KV cloud state:', err);
    showToast(`Cloud pull failed: ${err.message}`, 'error');
    logTerminal(`[KV Cloud Error]: ${err.message}. Retaining local state.`);
    return loadSavedState(state || {});
  }
}

/**
 * Closed-history data uses its own encrypted Durable Object record so normal
 * portfolio sync never transfers the large historical arrays.
 */
const CLOSED_HISTORY_MIGRATION_KEY = 'closed_history_cloud_migrated_v1';

// History has an independent Durable Object revision from portfolio state. Share
// concurrent reads and serialize writes, coalescing structurally identical snapshots.
type CloudHistory = { brokerExecutedTrades: unknown[]; cashflows: unknown[] };
type CloudHistorySnapshot = { history: CloudHistory | null; revision: number };
let lastSyncedHistoryFingerprint: string | undefined;
let cloudHistoryPushQueue: Promise<void> = Promise.resolve();
let cloudHistoryPulls = new Map<string, Promise<CloudHistorySnapshot>>();
const cloudHistorySnapshotCache = new Map<string, CloudHistorySnapshot>();

function rememberCloudHistorySnapshot(secret: string, snapshot: CloudHistorySnapshot): void {
  const current = cloudHistorySnapshotCache.get(secret);
  if (!current || snapshot.revision >= current.revision) cloudHistorySnapshotCache.set(secret, snapshot);
}

function enqueueCloudHistoryWrite(
  history: { brokerExecutedTrades?: unknown[]; cashflows?: unknown[] },
  secret: string,
  knownRevision: number | undefined,
  force: boolean,
  isCurrentSession: () => boolean = () => true
): Promise<boolean> {
  const operation = cloudHistoryPushQueue.then(() =>
    performPushCloudHistory(history, secret, knownRevision, force, isCurrentSession)
  );
  cloudHistoryPushQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function pushCloudHistory(
  history: { brokerExecutedTrades?: unknown[]; cashflows?: unknown[] },
  secret = getActiveGatewaySecret(),
  knownRevision?: number,
  options: Pick<SyncOptions, 'isCurrentSession'> = {}
): Promise<boolean> {
  return enqueueCloudHistoryWrite(history, secret, knownRevision, false, options.isCurrentSession);
}

/**
 * Persist an authoritative empty history record for a full portfolio reset.
 * The forced write bypasses the ordinary no-change fingerprint so a previous
 * empty snapshot cannot hide cloud history added by another device later.
 */
function clearCloudHistory(
  secret = getActiveGatewaySecret(),
  options: Pick<SyncOptions, 'isCurrentSession'> = {}
): Promise<boolean> {
  return enqueueCloudHistoryWrite({
    brokerExecutedTrades: [],
    cashflows: []
  }, secret, undefined, true, options.isCurrentSession);
}

async function performPushCloudHistory(
  history: { brokerExecutedTrades?: unknown[]; cashflows?: unknown[] },
  secret: string,
  knownRevision: number | undefined,
  force: boolean,
  isCurrentSession: () => boolean = () => true
): Promise<boolean> {
  const brokerExecutedTrades = Array.isArray(history.brokerExecutedTrades) ? history.brokerExecutedTrades : [];
  const cashflows = Array.isArray(history.cashflows) ? history.cashflows : [];
  if (!isCurrentSession() || !secret || (!force && !brokerExecutedTrades.length && !cashflows.length)) return false;
  const plaintext = JSON.stringify({ brokerExecutedTrades, cashflows });
  const fingerprint = JSON.stringify([secret, plaintext]);
  // Compare serialized content, not object identity: stores often rebuild arrays
  // during render/recalculation even when no history record has actually changed.
  if (!force && fingerprint === lastSyncedHistoryFingerprint) return false;

  let revision = knownRevision;
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) {
    const url = apiUrl('/api/history');
    const current = await fetchImpl(url, { method: 'GET', headers: authHeaders(secret) });
    if (!isCurrentSession()) return false;
    revision = readCloudRevision(current.headers) ?? 0;
    if (!current.ok && current.status !== 404) throw new Error(`Closed history revision check failed (HTTP ${current.status}).`);
  }
  const encryptedPayload = await encryptCloudPayload(plaintext, secret);
  if (!isCurrentSession()) return false;
  const res = await fetchImpl(apiUrl('/api/history'), {
    method: 'POST',
    headers: authHeaders(secret, `\"${revision}\"`),
    body: JSON.stringify({ encryptedPayload })
  });
  if (!isCurrentSession()) return false;
  if (!res.ok) throw new Error(`Closed history sync failed (HTTP ${res.status}).`);
  const savedRevision = readCloudRevision(res.headers) ?? (revision as number) + 1;
  rememberCloudHistorySnapshot(secret, {
    history: { brokerExecutedTrades, cashflows },
    revision: savedRevision
  });
  lastSyncedHistoryFingerprint = fingerprint;
  try { getLocalStorage()?.setItem(CLOSED_HISTORY_MIGRATION_KEY, '1'); } catch { /* session cache remains valid */ }
  return true;
}

async function pullCloudHistory(secret = getActiveGatewaySecret()): Promise<CloudHistory | null> {
  if (!secret) return null;
  const snapshot = await pullCloudHistorySnapshot(secret);
  if (snapshot.history) return snapshot.history;

  // If this 404 raced a legacy-history migration, wait for its queued write.
  // Return the saved snapshot from memory instead of re-reading or posting the
  // same local rows back to the record that was just created.
  await cloudHistoryPushQueue;
  const latest = cloudHistorySnapshotCache.get(secret);
  return latest && latest.revision > snapshot.revision ? latest.history : snapshot.history;
}

function pullCloudHistorySnapshot(secret: string): Promise<CloudHistorySnapshot> {
  const existing = cloudHistoryPulls.get(secret);
  if (existing) return existing;
  const request = performPullCloudHistory(secret).then(snapshot => {
    rememberCloudHistorySnapshot(secret, snapshot);
    return snapshot;
  });
  cloudHistoryPulls.set(secret, request);
  void request.finally(() => {
    if (cloudHistoryPulls.get(secret) === request) cloudHistoryPulls.delete(secret);
  }).catch(() => {
    // The caller handles the original rejection; don't create an unhandled cleanup rejection.
  });
  return request;
}

async function performPullCloudHistory(secret: string): Promise<CloudHistorySnapshot> {
  const res = await fetchImpl(apiUrl('/api/history'), {
    method: 'GET',
    headers: authHeaders(secret)
  });
  const revision = readCloudRevision(res.headers) ?? 0;
  if (res.status === 404) return { history: null, revision };
  if (!res.ok) throw new Error(`Closed history load failed (HTTP ${res.status}).`);
  const envelope = await res.json();
  if (typeof envelope?.encryptedPayload !== 'string') throw new Error('Invalid closed history payload.');
  const decrypted = await decryptCloudPayload(envelope.encryptedPayload, secret);
  const parsed = JSON.parse(decrypted.plaintext);
  return {
    history: {
      brokerExecutedTrades: Array.isArray(parsed.brokerExecutedTrades) ? parsed.brokerExecutedTrades : [],
      cashflows: Array.isArray(parsed.cashflows) ? parsed.cashflows : []
    },
    revision
  };
}

function pushCloudState(state?: any, options: SyncOptions = {}): Promise<boolean> {
  return revisionCoordinator.enqueueWrite((expectedRevision) =>
    performPushCloudState(state, options, expectedRevision)
  );
}

async function performPushCloudState(
  state: any = undefined,
  options: SyncOptions = {},
  expectedRevision: number
): Promise<boolean> {
  const handlers: SyncOptions = typeof options === 'function' ? {} : options;
  const {
    getState,
    showToast = (msg: string, type: string) => console.log(`[${type}] ${msg}`)
  } = handlers;
  const isCurrentSession = handlers.isCurrentSession || (() => true);
  if (!isCurrentSession()) return false;

  const currentState = state || (typeof getState === 'function' ? getState() : {});
  const currentSecret = handlers.secret || getActiveGatewaySecret();

  if (!currentSecret) {
    showToast('Gateway Secret required to access cloud state.', 'error');
    return false;
  }

  try {
    // Closed history has its own record and is synchronized only by its data
    // owner when source history or calculated fee metadata actually changes.
    // Portfolio UI/state writes must never implicitly trigger history GET/POST pairs.
    const stateToEncrypt = { ...currentState };
    delete stateToEncrypt.gatewaySecret;
    delete stateToEncrypt.marginBalance;
    delete stateToEncrypt.brokerExecutedTrades;
    delete stateToEncrypt.cashflows;
    // Broker API rows may contain a large duplicated raw payload. Cloud sync
    // only needs normalized execution fields and fee-allocation metadata.
    // A previous build may have persisted full TradeNet rows (including their
    // duplicated raw API payload). Keep only normalized fields required for
    // closed-history display and financing-fee reconciliation before cloud sync.
    if (Array.isArray(stateToEncrypt.brokerExecutedTrades)) {
      stateToEncrypt.brokerExecutedTrades = stateToEncrypt.brokerExecutedTrades.map((trade: any) => ({
        id: trade?.id,
        ticker: trade?.ticker,
        side: trade?.side,
        quantity: trade?.quantity,
        price: trade?.price,
        currency: trade?.currency,
        executedAt: trade?.executedAt,
        tradeValue: trade?.tradeValue,
        profit: trade?.profit,
        marginFee: trade?.marginFee,
        commission: trade?.commission,
        commissionCurrency: trade?.commissionCurrency,
        marginFeeAllocations: trade?.marginFeeAllocations,
        feesAndCommissions: trade?.feesAndCommissions,
        netProfit: trade?.netProfit
      }));
    }
    // Persist closed trades as compact canonical records. Older builds could
    // carry arbitrary broker/raw fields or duplicate the same records in
    // closedHistory, inflating every cloud sync even when history was unchanged.
    if (Array.isArray(stateToEncrypt.closedTrades)) {
      stateToEncrypt.closedTrades = stateToEncrypt.closedTrades.map((trade: any) => ({
        id: trade?.id,
        ticker: trade?.ticker,
        shares: trade?.shares,
        avgBuyPrice: trade?.avgBuyPrice,
        entryPrice: trade?.entryPrice,
        sellPrice: trade?.sellPrice,
        exitPrice: trade?.exitPrice,
        buyDate: trade?.buyDate,
        purchaseDate: trade?.purchaseDate,
        sellDate: trade?.sellDate,
        exitDate: trade?.exitDate,
        date: trade?.date,
        closedAt: trade?.closedAt,
        grossProfit: trade?.grossProfit,
        commissions: trade?.commissions,
        feesAndCommissions: trade?.feesAndCommissions,
        totalCommissions: trade?.totalCommissions,
        marginInterest: trade?.marginInterest,
        marginFee: trade?.marginFee,
        marginFeeAllocations: trade?.marginFeeAllocations,
        netProfit: trade?.netProfit,
        netRealizedGain: trade?.netRealizedGain,
        holdingDays: trade?.holdingDays
      }));
    }
    delete stateToEncrypt.closedHistory;
    const fingerprintState = { ...stateToEncrypt };
    delete fingerprintState.lastUpdated;
    const stateFingerprint = JSON.stringify(fingerprintState);
    if (cloudStatePushFingerprints.get(currentSecret) === stateFingerprint) {
      handlers.onStatusChange?.('synced');
      return true;
    }

    const serializedState = JSON.stringify(stateToEncrypt);
    const serializedBytes = new TextEncoder().encode(serializedState).byteLength;
    if (serializedBytes > 3500 * 1024) {
      throw new Error(`Cloud state is still too large after compacting (${(serializedBytes / 1024 / 1024).toFixed(2)} MB). Check large state fields before syncing.`);
    }
    const ciphertext = await encryptCloudPayload(serializedState, currentSecret);
    if (!isCurrentSession()) return false;
    const payload = { encryptedPayload: ciphertext };

    const url = new URL('/api/state', workerProxyUrl);
    const res = await fetchImpl(url.toString(), {
      method: 'POST',
      headers: authHeaders(currentSecret, `\"${expectedRevision}\"`),
      body: JSON.stringify(payload)
    });
    if (!isCurrentSession()) return false;

    if (!res.ok) {
      throw new Error(await responseError(res));
    }

    const savedRevision = readCloudRevision(res.headers);
    if (savedRevision !== null) revisionCoordinator.setRevision(savedRevision);
    cloudStatePushFingerprints.set(currentSecret, stateFingerprint);

    handlers.onStatusChange?.('synced');
    return true;
  } catch (err: any) {
    if (!isCurrentSession()) return false;
    console.error('Failed to push to KV cloud:', err);
    handlers.onStatusChange?.('error');
    showToast(`Cloud push failed: ${err.message}`, 'error');
    return false;
  }
}

async function syncCloudState(mode = 'push', options: SyncOptions = {}): Promise<boolean> {
  const handlers = typeof options === 'function' ? { pullCloudAndRewriteLocal: options } : options;
  if (mode === 'push') {
    const currentState = (handlers as any).state || (typeof (handlers as any).getState === 'function' ? (handlers as any).getState() : {});
    return pushCloudState(currentState, handlers);
  }
  if (mode === 'pull') {
    let succeeded = false;
    await pullCloudState(handlers, (success) => {
      succeeded = success;
    });
    return succeeded;
  }
  return false;
}
  const clearRequestCache = (): void => {
    cloudStatePushFingerprints.clear();
  };
  return {
    pullCloudState, pushCloudState, syncCloudState,
    pushCloudHistory, clearCloudHistory, pullCloudHistory,
    clearRequestCache
  };
}
