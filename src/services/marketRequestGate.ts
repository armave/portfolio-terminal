import { getUsEquityMarketSession, getUsEquityMarketSessionKey } from './marketSession';

export interface MarketRequestGateOptions {
  getSession?: () => ReturnType<typeof getUsEquityMarketSession>;
  getSessionKey?: () => string;
}

function isSuccessfulMarketDataResult(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value !== 'object' || Array.isArray(value)) return true;
  const result = value as Record<string, unknown>;
  return result.ok !== false && result.success !== false && !result.error && !result.errMsg;
}

/**
 * During fully closed hours, cache successful responses per exact request and
 * closed-session identity. Different requests are independent; errors can retry.
 */
export function createMarketRequestGate(options: MarketRequestGateOptions = {}) {
  const getSession = options.getSession || (() => getUsEquityMarketSession());
  const getSessionKey = options.getSessionKey || (() => getUsEquityMarketSessionKey());
  let activeClosedSessionKey: string | null = null;
  const successfulResponses = new Map<string, unknown>();
  const inFlightRequests = new Map<string, Promise<unknown>>();

  return async function run<T>(requestKey: string, request: () => Promise<T>): Promise<T> {
    if (getSession() !== 'CLOSED') return request();

    const sessionKey = getSessionKey();
    if (sessionKey !== activeClosedSessionKey) {
      activeClosedSessionKey = sessionKey;
      successfulResponses.clear();
    }

    if (successfulResponses.has(requestKey)) {
      return successfulResponses.get(requestKey) as T;
    }

    const inFlightKey = `${sessionKey}\u0000${requestKey}`;
    const existing = inFlightRequests.get(inFlightKey);
    if (existing) return existing as Promise<T>;

    const pending = request().then((value) => {
      if (
        isSuccessfulMarketDataResult(value) &&
        getSession() === 'CLOSED' &&
        getSessionKey() === sessionKey &&
        activeClosedSessionKey === sessionKey
      ) {
        successfulResponses.set(requestKey, value);
      }
      return value;
    }).finally(() => {
      if (inFlightRequests.get(inFlightKey) === pending) inFlightRequests.delete(inFlightKey);
    });

    inFlightRequests.set(inFlightKey, pending);
    return pending;
  };
}

let testSessionOverride: ReturnType<typeof getUsEquityMarketSession> | null = null;
let testSessionGeneration = 0;

function createDefaultGate() {
  return createMarketRequestGate({
    getSession: () => testSessionOverride ?? getUsEquityMarketSession(),
    getSessionKey: () => testSessionOverride
      ? `test-${testSessionGeneration}:${testSessionOverride}`
      : getUsEquityMarketSessionKey()
  });
}

let defaultMarketRequestGate = createDefaultGate();

export function runMarketDataRequest<T>(requestKey: string, request: () => Promise<T>): Promise<T> {
  return defaultMarketRequestGate(requestKey, request);
}

export function resetMarketRequestGate(): void {
  defaultMarketRequestGate = createDefaultGate();
}

export function setMarketRequestSessionForTests(session: ReturnType<typeof getUsEquityMarketSession> | null): void {
  testSessionOverride = session;
  testSessionGeneration += 1;
  resetMarketRequestGate();
}
