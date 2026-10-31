import { getUsEquityMarketSession } from './marketSession';

export const CLOSED_MARKET_REQUEST_COOLDOWN_MS = 60_000;

export interface MarketRequestGateOptions {
  now?: () => number;
  getSession?: () => ReturnType<typeof getUsEquityMarketSession>;
  cooldownMs?: number;
}

/** One market-data HTTP request per cooldown window while US equities are fully closed. */
export function createMarketRequestGate(options: MarketRequestGateOptions = {}) {
  const now = options.now || Date.now;
  const getSession = options.getSession || (() => getUsEquityMarketSession());
  const cooldownMs = options.cooldownMs ?? CLOSED_MARKET_REQUEST_COOLDOWN_MS;
  let lastClosedRequestAt = Number.NEGATIVE_INFINITY;
  let closedRequestInFlight = false;

  return async function run<T>(request: () => Promise<T>): Promise<T> {
    if (getSession() !== 'CLOSED') return request();
    const startedAt = now();
    if (closedRequestInFlight || startedAt - lastClosedRequestAt < cooldownMs) {
      throw new Error('Market data request deferred: the US market is closed and the app-wide request limit has been reached.');
    }
    lastClosedRequestAt = startedAt;
    closedRequestInFlight = true;
    try {
      return await request();
    } finally {
      closedRequestInFlight = false;
    }
  };
}

let defaultMarketRequestGate = createMarketRequestGate();

export function runMarketDataRequest<T>(request: () => Promise<T>): Promise<T> {
  return defaultMarketRequestGate(request);
}

export function resetMarketRequestGate(): void {
  defaultMarketRequestGate = createMarketRequestGate();
}
