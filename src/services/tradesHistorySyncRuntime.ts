export type TradesHistorySyncMode = 'refresh' | 'recalculate';
export type TradesHistorySyncSource = 'scheduler' | 'manual' | 'trades-desk';
export type TradesHistorySyncStatus = 'idle' | 'running' | 'succeeded' | 'stale' | 'failed';

export interface TradesHistorySyncRequest {
  mode: TradesHistorySyncMode;
  source: TradesHistorySyncSource;
  /** A newly observed broker fill may require a second pass after an active desk check. */
  forceRefresh?: boolean;
  /** Fingerprint of the allocator inputs captured when the caller requested work. */
  coalesceKey?: string;
}

export interface TradesHistorySyncContext extends TradesHistorySyncRequest {
  operationId: string;
}

export interface TradesHistorySyncSnapshot {
  status: TradesHistorySyncStatus;
  operationId: string | null;
  mode: TradesHistorySyncMode | null;
  source: TradesHistorySyncSource | null;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
}

export interface TradesHistorySyncDiagnostics {
  started: number;
  succeeded: number;
  failed: number;
  stale: number;
  coalesced: number;
  queued: number;
  lastDurationMs: number | null;
  totalDurationMs: number;
  maxDurationMs: number;
  activeOperations: number;
}

export interface TradesHistorySyncRuntime {
  run: (request: TradesHistorySyncRequest) => Promise<boolean>;
  getSnapshot: () => TradesHistorySyncSnapshot;
  getDiagnostics: () => TradesHistorySyncDiagnostics;
  subscribe: (listener: (snapshot: TradesHistorySyncSnapshot) => void) => () => void;
}

export interface TradesHistorySyncRuntimeDependencies {
  /** Account and session-generation scope. The key is retained internally only. */
  getSessionKey: () => string | null;
  perform: (context: TradesHistorySyncContext) => Promise<boolean>;
  now?: () => number;
}

interface ActiveOperation {
  mode: TradesHistorySyncMode;
  forceRefresh: boolean;
  coalesceKey?: string;
  promise: Promise<boolean>;
}

const INITIAL_SNAPSHOT: TradesHistorySyncSnapshot = {
  status: 'idle',
  operationId: null,
  mode: null,
  source: null,
  startedAt: null,
  completedAt: null,
  durationMs: null
};

const INITIAL_DIAGNOSTICS: TradesHistorySyncDiagnostics = {
  started: 0,
  succeeded: 0,
  failed: 0,
  stale: 0,
  coalesced: 0,
  queued: 0,
  lastDurationMs: null,
  totalDurationMs: 0,
  maxDurationMs: 0,
  activeOperations: 0
};

/**
 * Coalesces all Trades/cashflow synchronization entry points within one
 * authenticated session. A forced refresh waits behind a cache-only operation
 * rather than inheriting its weaker work. A recalculation arriving during a
 * provider refresh waits and recomputes against the latest canonical state.
 *
 * Diagnostics intentionally contain only operation categories, counts and
 * durations. Account/session identifiers and portfolio values are never exposed.
 */
export function createTradesHistorySyncRuntime(
  dependencies: TradesHistorySyncRuntimeDependencies
): TradesHistorySyncRuntime {
  const now = dependencies.now || Date.now;
  const activeBySession = new Map<string, ActiveOperation>();
  const listeners = new Set<(snapshot: TradesHistorySyncSnapshot) => void>();
  let snapshot: TradesHistorySyncSnapshot = { ...INITIAL_SNAPSHOT };
  const diagnostics: TradesHistorySyncDiagnostics = { ...INITIAL_DIAGNOSTICS };
  let sequence = 0;

  const publish = (next: TradesHistorySyncSnapshot): void => {
    snapshot = next;
    listeners.forEach((listener) => listener(snapshot));
  };

  const copyDiagnostics = (): TradesHistorySyncDiagnostics => ({
    ...diagnostics,
    activeOperations: activeBySession.size
  });

  const run = (request: TradesHistorySyncRequest): Promise<boolean> => {
    const sessionKey = dependencies.getSessionKey();
    if (!sessionKey) return Promise.resolve(false);

    const forceRefresh = request.mode === 'refresh' && (request.forceRefresh === true || request.source !== 'trades-desk');
    const existing = activeBySession.get(sessionKey);
    if (existing) {
      const sameInputSnapshot = request.coalesceKey === existing.coalesceKey;
      const compatibleRefresh = existing.mode === 'refresh' &&
        request.mode === 'refresh' &&
        sameInputSnapshot &&
        (!forceRefresh || existing.forceRefresh);
      const refreshSatisfiesRecalculation = existing.mode === 'refresh' &&
        request.mode === 'recalculate' &&
        sameInputSnapshot;
      const compatibleRecalculation = existing.mode === 'recalculate' &&
        request.mode === 'recalculate' &&
        sameInputSnapshot;
      if (compatibleRefresh || refreshSatisfiesRecalculation || compatibleRecalculation) {
        diagnostics.coalesced += 1;
        return existing.promise;
      }

      // A stronger refresh or a different allocator input snapshot runs after
      // the current operation. Recalculation after a changed snapshot is queued
      // behind an active refresh so it cannot be satisfied by stale work.
      diagnostics.queued += 1;
      return existing.promise.then(() =>
        dependencies.getSessionKey() === sessionKey ? run(request) : false
      );
    }

    const operationId = `trades-history-${++sequence}`;
    const startedAt = now();
    diagnostics.started += 1;
    publish({
      status: 'running',
      operationId,
      mode: request.mode,
      source: request.source,
      startedAt,
      completedAt: null,
      durationMs: null
    });

    let operation!: Promise<boolean>;
    operation = Promise.resolve()
      .then(() => dependencies.perform({ ...request, operationId }))
      .then((succeeded) => {
        const completedAt = now();
        const durationMs = Math.max(0, completedAt - startedAt);
        diagnostics.lastDurationMs = durationMs;
        diagnostics.totalDurationMs += durationMs;
        diagnostics.maxDurationMs = Math.max(diagnostics.maxDurationMs, durationMs);

        const sessionIsCurrent = dependencies.getSessionKey() === sessionKey;
        if (!sessionIsCurrent) {
          diagnostics.stale += 1;
          if (snapshot.operationId === operationId) {
            publish({
              status: 'stale',
              operationId,
              mode: request.mode,
              source: request.source,
              startedAt,
              completedAt,
              durationMs
            });
          }
          return false;
        }

        if (succeeded) diagnostics.succeeded += 1;
        else diagnostics.failed += 1;
        if (snapshot.operationId === operationId) {
          publish({
            status: succeeded ? 'succeeded' : 'failed',
            operationId,
            mode: request.mode,
            source: request.source,
            startedAt,
            completedAt,
            durationMs
          });
        }
        return succeeded;
      })
      .catch(() => {
        const completedAt = now();
        const durationMs = Math.max(0, completedAt - startedAt);
        diagnostics.failed += 1;
        diagnostics.lastDurationMs = durationMs;
        diagnostics.totalDurationMs += durationMs;
        diagnostics.maxDurationMs = Math.max(diagnostics.maxDurationMs, durationMs);
        if (dependencies.getSessionKey() !== sessionKey) diagnostics.stale += 1;
        if (snapshot.operationId === operationId) {
          publish({
            status: dependencies.getSessionKey() === sessionKey ? 'failed' : 'stale',
            operationId,
            mode: request.mode,
            source: request.source,
            startedAt,
            completedAt,
            durationMs
          });
        }
        return false;
      })
      .finally(() => {
        if (activeBySession.get(sessionKey)?.promise === operation) {
          activeBySession.delete(sessionKey);
        }
      });

    activeBySession.set(sessionKey, {
      mode: request.mode,
      forceRefresh,
      coalesceKey: request.coalesceKey,
      promise: operation
    });
    return operation;
  };

  return {
    run,
    getSnapshot: () => ({ ...snapshot }),
    getDiagnostics: copyDiagnostics,
    subscribe: (listener) => {
      listeners.add(listener);
      listener({ ...snapshot });
      return () => listeners.delete(listener);
    }
  };
}
