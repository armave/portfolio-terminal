export type FreedomAccountStreamStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface FreedomAccountSocketLike {
  readonly readyState: number;
  addEventListener: (type: string, listener: (event: any) => void) => void;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
}

export interface FreedomAccountStreamRuntimeDependencies {
  createTicket: () => Promise<{ ticket: string }>;
  buildSocketUrl: (ticket: string) => string;
  createSocket?: (url: string) => FreedomAccountSocketLike;
  getCurrentSessionKey: () => string;
  onPortfolio: (data: unknown, sessionKey: string, receivedAt: number) => void;
  onOrders: (data: unknown, sessionKey: string, receivedAt: number) => void;
  onStatus?: (status: FreedomAccountStreamStatus, message?: string) => void;
  scheduleTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearScheduledTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
  scheduleInterval?: (callback: () => void, delayMs: number) => ReturnType<typeof setInterval>;
  clearScheduledInterval?: (handle: ReturnType<typeof setInterval>) => void;
  now?: () => number;
}

export interface FreedomAccountStreamRuntime {
  start: (sessionKey: string) => Promise<boolean>;
  stop: () => void;
  isConnected: () => boolean;
}

const HEARTBEAT_MS = 20_000;
const CONNECT_TIMEOUT_MS = 12_000;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 15_000, 30_000];

function parseMessage(value: unknown): Record<string, unknown> | null {
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

/** Owns the private account stream; the broker SID never reaches the browser. */
export function createFreedomAccountStreamRuntime(
  dependencies: FreedomAccountStreamRuntimeDependencies
): FreedomAccountStreamRuntime {
  const createSocket = dependencies.createSocket || ((url: string) => new WebSocket(url));
  const scheduleTimeout = dependencies.scheduleTimeout || ((callback, delay) => setTimeout(callback, delay));
  const clearTimeoutHandle = dependencies.clearScheduledTimeout || ((handle) => clearTimeout(handle));
  const scheduleInterval = dependencies.scheduleInterval || ((callback, delay) => setInterval(callback, delay));
  const clearIntervalHandle = dependencies.clearScheduledInterval || ((handle) => clearInterval(handle));
  const now = dependencies.now || Date.now;

  let active = false;
  let activeSessionKey = '';
  let generation = 0;
  let socket: FreedomAccountSocketLike | null = null;
  let connectPromise: Promise<boolean> | null = null;
  let heartbeatHandle: ReturnType<typeof setInterval> | null = null;
  let reconnectHandle: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let connected = false;

  const reportStatus = (status: FreedomAccountStreamStatus, message?: string): void => {
    dependencies.onStatus?.(status, message);
  };

  const clearHeartbeat = (): void => {
    if (heartbeatHandle !== null) {
      clearIntervalHandle(heartbeatHandle);
      heartbeatHandle = null;
    }
  };

  const clearReconnect = (): void => {
    if (reconnectHandle !== null) {
      clearTimeoutHandle(reconnectHandle);
      reconnectHandle = null;
    }
  };

  const scheduleReconnect = (runGeneration: number): void => {
    if (!active || runGeneration !== generation || reconnectHandle !== null) return;
    connected = false;
    reportStatus('reconnecting');
    const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    reconnectAttempt += 1;
    reconnectHandle = scheduleTimeout(() => {
      reconnectHandle = null;
      if (!active || runGeneration !== generation) return;
      const pending = connect(runGeneration);
      connectPromise = pending;
      void pending.finally(() => {
        if (connectPromise === pending) connectPromise = null;
      }).catch(() => undefined);
    }, delay);
  };

  const connect = async (runGeneration: number): Promise<boolean> => {
    reportStatus(reconnectAttempt === 0 ? 'connecting' : 'reconnecting');
    let ticket: { ticket: string };
    try {
      ticket = await dependencies.createTicket();
    } catch (error) {
      if (active && runGeneration === generation) scheduleReconnect(runGeneration);
      throw error instanceof Error ? error : new Error(String(error));
    }
    if (!active || runGeneration !== generation) return false;

    const nextSocket = createSocket(dependencies.buildSocketUrl(ticket.ticket));
    socket = nextSocket;

    return await new Promise<boolean>((resolve, reject) => {
      let settled = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        if (timeoutHandle !== null) clearTimeoutHandle(timeoutHandle);
        if (error) reject(error);
        else resolve(true);
      };
      timeoutHandle = scheduleTimeout(() => {
        finish(new Error('Timed out while establishing the TradeNet account stream.'));
        try { nextSocket.close(4000, 'Account stream connection timeout'); } catch { /* ignore */ }
      }, CONNECT_TIMEOUT_MS);

      nextSocket.addEventListener('open', () => {
        if (!active || runGeneration !== generation) {
          try { nextSocket.close(1000, 'Account stream no longer active'); } catch { /* ignore */ }
          return;
        }
        clearHeartbeat();
        heartbeatHandle = scheduleInterval(() => {
          if (nextSocket.readyState === 1) {
            try { nextSocket.send('ping'); } catch { /* close event will reconnect */ }
          }
        }, HEARTBEAT_MS);
      });

      nextSocket.addEventListener('message', (event: any) => {
        if (!active || runGeneration !== generation || socket !== nextSocket) return;
        const message = parseMessage(event?.data);
        if (!message) return;
        if (message.type === 'ready' ||
            (message.type === 'status' && message.status === 'connected')) {
          connected = true;
          reconnectAttempt = 0;
          reportStatus('connected');
          if (message.type === 'ready') finish();
          return;
        }
        if (message.type === 'status' && message.status === 'reconnecting') {
          connected = false;
          reportStatus('reconnecting', typeof message.message === 'string' ? message.message : undefined);
          return;
        }
        if (message.type === 'error') {
          reportStatus('reconnecting', typeof message.message === 'string' ? message.message : undefined);
          return;
        }

        const sessionKey = dependencies.getCurrentSessionKey();
        if (!sessionKey || sessionKey !== activeSessionKey) return;
        const receivedAt = Number(message.receivedAt) || now();
        if (message.type === 'portfolio' && message.data && typeof message.data === 'object') {
          dependencies.onPortfolio(message.data, activeSessionKey, receivedAt);
        } else if (message.type === 'orders' && message.data && typeof message.data === 'object') {
          dependencies.onOrders(message.data, activeSessionKey, receivedAt);
        }
      });

      nextSocket.addEventListener('error', () => {
        finish(new Error('The TradeNet account stream encountered a connection error.'));
      });

      nextSocket.addEventListener('close', (event: any) => {
        clearHeartbeat();
        connected = false;
        if (socket === nextSocket) socket = null;
        if (!settled) finish(new Error('The TradeNet account stream closed before it became ready.'));
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

  const start = async (sessionKey: string): Promise<boolean> => {
    if (!sessionKey) {
      stop();
      return false;
    }
    if (active && activeSessionKey === sessionKey) {
      if (connected || socket?.readyState === 1 || reconnectHandle !== null) return true;
      if (connectPromise) return connectPromise;
    } else {
      generation += 1;
      clearReconnect();
      clearHeartbeat();
      const previousSocket = socket;
      socket = null;
      if (previousSocket) {
        try { previousSocket.close(1000, 'Account session changed'); } catch { /* ignore */ }
      }
      active = true;
      connected = false;
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
    activeSessionKey = '';
    reconnectAttempt = 0;
    clearReconnect();
    clearHeartbeat();
    const previousSocket = socket;
    socket = null;
    connectPromise = null;
    if (previousSocket) {
      try { previousSocket.close(1000, 'Account stream stopped'); } catch { /* ignore */ }
    }
    reportStatus('disconnected');
  }

  return { start, stop, isConnected: () => connected && socket?.readyState === 1 };
}
