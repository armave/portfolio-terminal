type ProviderHealthStatus = 'unknown' | 'healthy' | 'degraded' | 'unavailable';

export interface ProviderHealthSnapshot {
  providerId: string;
  status: ProviderHealthStatus;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  retryAfter: number | null;
}

interface ProviderState {
  successes: number;
  failures: number;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  retryAfter: number | null;
}

export function createMarketDataProviderHealth(options: {
  now?: () => number;
  failureThreshold?: number;
  cooldownMs?: number;
} = {}) {
  const now = options.now ?? Date.now;
  const threshold = Math.max(1, Math.floor(options.failureThreshold ?? 3));
  const cooldownMs = Math.max(0, Math.floor(options.cooldownMs ?? 30_000));
  const states = new Map<string, ProviderState>();
  const normalizeId = (value: string) => value.trim().toUpperCase();

  const stateFor = (providerId: string): ProviderState => {
    const id = normalizeId(providerId);
    if (!id) throw new Error('A provider ID is required.');
    let state = states.get(id);
    if (!state) {
      state = {
        successes: 0, failures: 0, consecutiveFailures: 0,
        lastSuccessAt: null, lastFailureAt: null, retryAfter: null
      };
      states.set(id, state);
    }
    return state;
  };

  const getSnapshot = (providerId: string, at = now()): ProviderHealthSnapshot => {
    const state = stateFor(providerId);
    const status: ProviderHealthStatus = state.successes === 0 && state.failures === 0
      ? 'unknown'
      : state.retryAfter !== null && at < state.retryAfter
        ? 'unavailable'
        : state.consecutiveFailures > 0 ? 'degraded' : 'healthy';
    return {
      providerId: normalizeId(providerId),
      status,
      successes: state.successes,
      failures: state.failures,
      consecutiveFailures: state.consecutiveFailures,
      lastSuccessAt: state.lastSuccessAt,
      lastFailureAt: state.lastFailureAt,
      retryAfter: state.retryAfter
    };
  };

  return {
    recordSuccess(providerId: string, at = now()): ProviderHealthSnapshot {
      const state = stateFor(providerId);
      state.successes += 1;
      state.consecutiveFailures = 0;
      state.lastSuccessAt = at;
      state.retryAfter = null;
      return getSnapshot(providerId, at);
    },
    recordFailure(providerId: string, at = now()): ProviderHealthSnapshot {
      const state = stateFor(providerId);
      state.failures += 1;
      state.consecutiveFailures += 1;
      state.lastFailureAt = at;
      state.retryAfter = state.consecutiveFailures >= threshold ? at + cooldownMs : null;
      return getSnapshot(providerId, at);
    },
    canAttempt(providerId: string, at = now()): boolean {
      const retryAfter = stateFor(providerId).retryAfter;
      return retryAfter === null || at >= retryAfter;
    },
    getSnapshot,
    list(at = now()): ProviderHealthSnapshot[] {
      return [...states.keys()].sort().map(providerId => getSnapshot(providerId, at));
    },
    reset(providerId?: string): void {
      if (providerId) states.delete(normalizeId(providerId));
      else states.clear();
    }
  };
}

export const marketDataProviderHealth = createMarketDataProviderHealth();
