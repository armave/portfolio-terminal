export type FreedomMarketDepthStreamStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface FreedomMarketDepthSocketLike {
  readonly readyState: number;
  addEventListener: (type: string, listener: (event: any) => void) => void;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
}

export interface FreedomMarketDepthStreamRuntimeDependencies {
  createTicket: (ticker: string) => Promise<{ ticket: string; symbol: string }>;
  buildSocketUrl: (ticket: string) => string;
  createSocket?: (url: string) => FreedomMarketDepthSocketLike;
  onDepth: (symbol: string, data: unknown, updatedAt: number, sessionKey: string) => void;
  onStatus?: (status: FreedomMarketDepthStreamStatus, message?: string) => void;
  scheduleTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearScheduledTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
  scheduleInterval?: (callback: () => void, delayMs: number) => ReturnType<typeof setInterval>;
  clearScheduledInterval?: (handle: ReturnType<typeof setInterval>) => void;
  now?: () => number;
  /** Maximum time to wait after socket readiness for the first validated depth book. */
  firstDepthTimeoutMs?: number;
}

export interface FreedomMarketDepthStreamRuntime {
  start: (ticker: string, sessionKey: string) => Promise<boolean>;
  stop: () => void;
  isConnected: () => boolean;
}

const CONNECT_TIMEOUT_MS = 15_000;
const FIRST_DEPTH_TIMEOUT_MS = 15_000;
const HEARTBEAT_MS = 20_000;
const PONG_TIMEOUT_MS = 50_000;
const MAX_BROWSER_MESSAGE_BYTES = 256 * 1024;

function parseMessage(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || value.length > MAX_BROWSER_MESSAGE_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/** Owns one modal-scoped browser socket; closing it also ends the upstream Worker session. */
export function createFreedomMarketDepthStreamRuntime(
  dependencies: FreedomMarketDepthStreamRuntimeDependencies
): FreedomMarketDepthStreamRuntime {
  const createSocket = dependencies.createSocket || ((url: string) => new WebSocket(url));
  const scheduleTimeout = dependencies.scheduleTimeout || ((callback, delay) => setTimeout(callback, delay));
  const clearTimeoutHandle = dependencies.clearScheduledTimeout || ((handle) => clearTimeout(handle));
  const scheduleInterval = dependencies.scheduleInterval || ((callback, delay) => setInterval(callback, delay));
  const clearIntervalHandle = dependencies.clearScheduledInterval || ((handle) => clearInterval(handle));
  const now = dependencies.now || Date.now;
  const firstDepthTimeoutMs = dependencies.firstDepthTimeoutMs ?? FIRST_DEPTH_TIMEOUT_MS;
  let generation = 0;
  let activeSessionKey = '';
  let activeSymbol = '';
  let socket: FreedomMarketDepthSocketLike | null = null;
  let connected = false;
  let connectTimeout: ReturnType<typeof setTimeout> | null = null;
  let firstDepthTimeout: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let lastPongAt = 0;

  const report = (status: FreedomMarketDepthStreamStatus, message?: string): void => {
    dependencies.onStatus?.(status, message);
  };
  const clearTimers = (): void => {
    if (connectTimeout !== null) clearTimeoutHandle(connectTimeout);
    if (firstDepthTimeout !== null) clearTimeoutHandle(firstDepthTimeout);
    if (heartbeat !== null) clearIntervalHandle(heartbeat);
    connectTimeout = null;
    firstDepthTimeout = null;
    heartbeat = null;
  };

  const stop = (): void => {
    generation += 1;
    activeSessionKey = '';
    activeSymbol = '';
    connected = false;
    lastPongAt = 0;
    clearTimers();
    const previous = socket;
    socket = null;
    if (previous && previous.readyState < 2) {
      try { previous.close(1000, 'Market Depth modal closed'); } catch { /* close event may already be pending */ }
    }
    report('disconnected');
  };

  const start = async (ticker: string, sessionKey: string): Promise<boolean> => {
    stop();
    const run = generation;
    const normalizedTicker = ticker.trim().toUpperCase();
    if (!normalizedTicker || !sessionKey) {
      report('error', 'An authenticated administrator session and ticker are required.');
      return false;
    }
    activeSessionKey = sessionKey;
    report('connecting');

    try {
      const ticket = await dependencies.createTicket(normalizedTicker);
      if (run !== generation || activeSessionKey !== sessionKey) return false;
      activeSymbol = ticket.symbol;
      const nextSocket = createSocket(dependencies.buildSocketUrl(ticket.ticket));
      socket = nextSocket;

      return await new Promise<boolean>((resolve) => {
        let settled = false;
        // Keep a Worker error frame authoritative when its close frame follows immediately.
        let streamErrorMessage = '';
        const finish = (success: boolean): void => {
          if (settled) return;
          settled = true;
          if (connectTimeout !== null) clearTimeoutHandle(connectTimeout);
          connectTimeout = null;
          resolve(success);
        };
        connectTimeout = scheduleTimeout(() => {
          if (run !== generation) return finish(false);
          report('error', 'Timed out while opening the TradeNet Market Depth stream.');
          finish(false);
          try { nextSocket.close(4000, 'Market Depth connection timeout'); } catch { /* ignore */ }
        }, CONNECT_TIMEOUT_MS);

        nextSocket.addEventListener('open', () => {
          if (run !== generation || activeSessionKey !== sessionKey) {
            try { nextSocket.close(1000, 'Market Depth session no longer active'); } catch { /* ignore */ }
            return;
          }
          lastPongAt = now();
          heartbeat = scheduleInterval(() => {
            if (nextSocket.readyState !== 1) return;
            if (lastPongAt > 0 && now() - lastPongAt > PONG_TIMEOUT_MS) {
              report('error', 'The live Market Depth heartbeat timed out.');
              try { nextSocket.close(4000, 'Market Depth heartbeat timeout'); } catch { /* ignore */ }
              return;
            }
            try { nextSocket.send('ping'); } catch { /* close event reports the failure */ }
          }, HEARTBEAT_MS);
        });

        nextSocket.addEventListener('message', (event: any) => {
          if (run !== generation || socket !== nextSocket || activeSessionKey !== sessionKey) return;
          const message = parseMessage(event?.data);
          if (!message) return;
          if (message.type === 'pong') {
            lastPongAt = now();
            return;
          }
          if (message.type === 'ready') {
            if (message.symbol !== activeSymbol) {
              report('error', 'TradeNet opened a Market Depth stream for an unexpected ticker.');
              finish(false);
              try { nextSocket.close(1008, 'Unexpected Market Depth ticker'); } catch { /* ignore */ }
              return;
            }
            connected = true;
            lastPongAt = now();
            report('connected');
            // A healthy socket can keep answering heartbeats without ever
            // delivering an order book. Do not leave the UI waiting forever.
            firstDepthTimeout = scheduleTimeout(() => {
              firstDepthTimeout = null;
              if (run !== generation || socket !== nextSocket || !connected) return;
              connected = false;
              streamErrorMessage = 'No live Market Depth data is available.';
              report('error', streamErrorMessage);
              try { nextSocket.close(4000, 'Market Depth first-depth timeout'); } catch { /* ignore */ }
            }, firstDepthTimeoutMs);
            finish(true);
            return;
          }
          if (message.type === 'depth' &&
              message.symbol === activeSymbol &&
              message.data !== null && typeof message.data === 'object' &&
              !Array.isArray(message.data)) {
            const updatedAt = message.updatedAt;
            if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt <= 0) {
              connected = false;
              report('error', 'TradeNet returned Market Depth without a valid update timestamp.');
              finish(false);
              try { nextSocket.close(1008, 'Invalid Market Depth timestamp'); } catch { /* ignore */ }
              return;
            }
            connected = true;
            lastPongAt = now();
            if (firstDepthTimeout !== null) clearTimeoutHandle(firstDepthTimeout);
            firstDepthTimeout = null;
            dependencies.onDepth(activeSymbol, message.data, updatedAt, sessionKey);
            return;
          }
          if (message.type === 'error') {
            const text = typeof message.message === 'string'
              ? message.message.slice(0, 300)
              : 'TradeNet Market Depth stream failed.';
            connected = false;
            streamErrorMessage = text;
            report('error', text);
            finish(false);
            try { nextSocket.close(1011, 'Market Depth stream error'); } catch { /* ignore */ }
          }
        });

        nextSocket.addEventListener('error', () => {
          if (run !== generation || socket !== nextSocket) return;
          connected = false;
          report('error', 'The live TradeNet Market Depth connection failed.');
          finish(false);
        });

        nextSocket.addEventListener('close', (event: any) => {
          if (run !== generation || socket !== nextSocket) return;
          connected = false;
          clearTimers();
          socket = null;
          if (activeSessionKey === sessionKey && !streamErrorMessage) {
            const closeCode = Number.isFinite(Number(event?.code)) ? Number(event.code) : null;
            const closeReason = typeof event?.reason === 'string' ? event.reason.trim().slice(0, 220) : '';
            const reason = closeReason
              ? `TradeNet Market Depth stream closed (code ${closeCode ?? 'unknown'}): ${closeReason}`
              : closeCode !== null
                ? `TradeNet Market Depth stream closed (WebSocket close code ${closeCode}).`
                : 'TradeNet Market Depth stream closed without a close code or reason.';
            report('disconnected', reason);
          }
          finish(false);
        });
      });
    } catch (error) {
      if (run === generation && activeSessionKey === sessionKey) {
        report('error', error instanceof Error ? error.message : 'Could not open the Market Depth stream.');
      }
      return false;
    }
  };

  return {
    start,
    stop,
    isConnected: () => connected && socket?.readyState === 1 &&
      lastPongAt > 0 && now() - lastPongAt <= PONG_TIMEOUT_MS
  };
}
