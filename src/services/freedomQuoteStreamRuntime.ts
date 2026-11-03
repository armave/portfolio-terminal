type FreedomQuoteStreamStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

interface FreedomQuoteStreamMessage {
  type: 'quote';
  symbol: string;
  data: Record<string, unknown>;
  receivedAt: number;
}

export interface FreedomQuoteSocketLike {
  readonly readyState: number;
  addEventListener: (type: string, listener: (event: any) => void) => void;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
}

export interface FreedomQuoteStreamRuntimeDependencies {
  createTicket: (symbols: string[]) => Promise<{ ticket: string }>;
  buildSocketUrl: (ticket: string) => string;
  createSocket?: (url: string) => FreedomQuoteSocketLike;
  onQuote: (message: FreedomQuoteStreamMessage, sessionKey: string) => void;
  onStatus?: (status: FreedomQuoteStreamStatus, message?: string) => void;
  scheduleTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearScheduledTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
  scheduleInterval?: (callback: () => void, delayMs: number) => ReturnType<typeof setInterval>;
  clearScheduledInterval?: (handle: ReturnType<typeof setInterval>) => void;
  now?: () => number;
}

export interface FreedomQuoteStreamRuntime {
  start: (tickers: string[], sessionKey: string) => Promise<boolean>;
  stop: () => void;
  isConnected: () => boolean;
}

const QUOTE_STREAM_HEARTBEAT_MS = 20_000;
const QUOTE_STREAM_CONNECT_TIMEOUT_MS = 12_000;
const QUOTE_STREAM_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 15_000, 30_000];

function normalizeTickers(tickers: string[]): string[] {
  return [...new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))].sort();
}

function parseStreamMessage(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * Owns one persistent browser WebSocket for the current authenticated account.
 * Credentials are used only to mint a one-use ticket over HTTPS; the browser
 * socket URL never contains the Gateway Secret or the TradeNet SID.
 */
export function createFreedomQuoteStreamRuntime(
  dependencies: FreedomQuoteStreamRuntimeDependencies
): FreedomQuoteStreamRuntime {
  const createSocket = dependencies.createSocket || ((url: string) => new WebSocket(url));
  const scheduleTimeout = dependencies.scheduleTimeout || ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearScheduledTimeout = dependencies.clearScheduledTimeout || ((handle) => clearTimeout(handle));
  const scheduleInterval = dependencies.scheduleInterval || ((callback, delayMs) => setInterval(callback, delayMs));
  const clearScheduledInterval = dependencies.clearScheduledInterval || ((handle) => clearInterval(handle));
  const now = dependencies.now || Date.now;

  let active = false;
  let requestedTickers: string[] = [];
  let activeSessionKey = '';
  let generation = 0;
  let socket: FreedomQuoteSocketLike | null = null;
  let connectPromise: Promise<boolean> | null = null;
  let heartbeatHandle: ReturnType<typeof setInterval> | null = null;
  let reconnectHandle: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let connected = false;

  const reportStatus = (status: FreedomQuoteStreamStatus, message?: string): void => {
    dependencies.onStatus?.(status, message);
  };

  const clearHeartbeat = (): void => {
    if (heartbeatHandle !== null) {
      clearScheduledInterval(heartbeatHandle);
      heartbeatHandle = null;
    }
  };

  const clearReconnect = (): void => {
    if (reconnectHandle !== null) {
      clearScheduledTimeout(reconnectHandle);
      reconnectHandle = null;
    }
  };

  const scheduleReconnect = (runGeneration: number): void => {
    if (!active || runGeneration !== generation || reconnectHandle !== null) return;
    connected = false;
    reportStatus('reconnecting');
    const delay = QUOTE_STREAM_RECONNECT_DELAYS_MS[
      Math.min(reconnectAttempt, QUOTE_STREAM_RECONNECT_DELAYS_MS.length - 1)
    ];
    reconnectAttempt += 1;
    reconnectHandle = scheduleTimeout(() => {
      reconnectHandle = null;
      if (!active || runGeneration !== generation) return;
      const pending = connect(runGeneration);
      connectPromise = pending;
      void pending.catch(() => {
        if (connectPromise === pending) connectPromise = null;
      });
    }, delay);
  };

  const connect = async (runGeneration: number): Promise<boolean> => {
    reportStatus(reconnectAttempt === 0 ? 'connecting' : 'reconnecting');
    let ticket: { ticket: string };
    try {
      ticket = await dependencies.createTicket(requestedTickers);
    } catch (error) {
      if (active && runGeneration === generation) scheduleReconnect(runGeneration);
      throw error instanceof Error ? error : new Error(String(error));
    }
    if (!active || runGeneration !== generation) return false;

    const nextSocket = createSocket(dependencies.buildSocketUrl(ticket.ticket));
    socket = nextSocket;

    return await new Promise<boolean>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearScheduledTimeout(timeoutHandle);
        if (error) reject(error);
        else resolve(true);
      };
      const timeoutHandle = scheduleTimeout(() => {
        finish(new Error('Timed out while establishing the live TradeNet quote socket.'));
        try { nextSocket.close(4000, 'Quote stream connection timeout'); } catch { /* ignore */ }
      }, QUOTE_STREAM_CONNECT_TIMEOUT_MS);

      nextSocket.addEventListener('open', () => {
        if (!active || runGeneration !== generation) {
          try { nextSocket.close(1000, 'Quote stream no longer active'); } catch { /* ignore */ }
          return;
        }
        clearHeartbeat();
        heartbeatHandle = scheduleInterval(() => {
          if (nextSocket.readyState === 1) {
            try { nextSocket.send('ping'); } catch { /* close event will reconnect */ }
          }
        }, QUOTE_STREAM_HEARTBEAT_MS);
      });

      nextSocket.addEventListener('message', (event: any) => {
        if (!active || runGeneration !== generation || socket !== nextSocket) return;
        const message = parseStreamMessage(event?.data);
        if (!message) return;
        if (message.type === 'ready' || (message.type === 'status' && message.status === 'connected')) {
          connected = true;
          reconnectAttempt = 0;
          reportStatus('connected');
          if (message.type === 'ready') finish();
          return;
        }
        if (message.type === 'quote' &&
            typeof message.symbol === 'string' &&
            message.data && typeof message.data === 'object' &&
            !Array.isArray(message.data)) {
          connected = true;
          dependencies.onQuote({
            type: 'quote',
            symbol: message.symbol,
            data: message.data as Record<string, unknown>,
            receivedAt: Number(message.receivedAt) || now()
          }, activeSessionKey);
          return;
        }
        if (message.type === 'status' && message.status === 'reconnecting') {
          connected = false;
          reportStatus('reconnecting');
        }
        if (message.type === 'error') {
          reportStatus('reconnecting', typeof message.message === 'string' ? message.message : undefined);
        }
      });

      nextSocket.addEventListener('error', () => {
        finish(new Error('The live TradeNet quote socket encountered a connection error.'));
      });

      nextSocket.addEventListener('close', (event: any) => {
        clearHeartbeat();
        connected = false;
        if (socket === nextSocket) socket = null;
        if (!settled) finish(new Error('The live TradeNet quote socket closed before it became ready.'));
        if (active && runGeneration === generation) {
          reportStatus('disconnected', typeof event?.reason === 'string' ? event.reason : undefined);
          scheduleReconnect(runGeneration);
        }
      });
    }).catch((error: unknown) => {
      clearHeartbeat();
      if (socket === nextSocket) socket = null;
      if (active && runGeneration === generation) scheduleReconnect(runGeneration);
      throw error instanceof Error ? error : new Error(String(error));
    });
  };

  const start = async (tickers: string[], sessionKey: string): Promise<boolean> => {
    const normalized = normalizeTickers(tickers);
    if (normalized.length === 0 || !sessionKey) {
      stop();
      return false;
    }
    if (normalized.length > 10) {
      throw new Error('The live quote stream supports at most 10 tickers per account session.');
    }

    const unchanged = active &&
      activeSessionKey === sessionKey &&
      requestedTickers.length === normalized.length &&
      requestedTickers.every((ticker, index) => ticker === normalized[index]);

    if (unchanged) {
      // The browser socket remains open while the Durable Object reconnects
      // its upstream TradeNet socket. Do not mint another ticket/socket during
      // that server-side recovery window.
      if (connected || socket?.readyState === 1) return true;
      if (connectPromise) return connectPromise;
      if (reconnectHandle !== null) return true;
    } else {
      generation += 1;
      clearReconnect();
      clearHeartbeat();
      const previousSocket = socket;
      socket = null;
      if (previousSocket) {
        try { previousSocket.close(1000, 'Quote stream subscription changed'); } catch { /* ignore */ }
      }
      active = true;
      connected = false;
      requestedTickers = normalized;
      activeSessionKey = sessionKey;
      reconnectAttempt = 0;
    }

    const runGeneration = generation;
    const pending = connect(runGeneration);
    connectPromise = pending;
    try {
      return await pending;
    } finally {
      if (connectPromise === pending) connectPromise = null;
    }
  };

  function stop(): void {
    active = false;
    generation += 1;
    connected = false;
    requestedTickers = [];
    activeSessionKey = '';
    reconnectAttempt = 0;
    clearReconnect();
    clearHeartbeat();
    const previousSocket = socket;
    socket = null;
    connectPromise = null;
    if (previousSocket) {
      try { previousSocket.close(1000, 'Quote stream stopped'); } catch { /* ignore */ }
    }
    reportStatus('disconnected');
  }

  return {
    start,
    stop,
    isConnected: () => connected && socket?.readyState === 1
  };
}
