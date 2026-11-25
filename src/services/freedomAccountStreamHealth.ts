export type FreedomAccountStreamChannel = 'portfolio' | 'orders';
export type FreedomAccountStreamConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

interface FreedomAccountStreamHealthState {
  sessionKey: string;
  connectionStatus: FreedomAccountStreamConnectionStatus;
  connected: boolean;
  everConnected: boolean;
  portfolioReceived: boolean;
  ordersReceived: boolean;
  portfolioRevision: number;
  ordersRevision: number;
  recoveryPending: boolean;
}

const emptyState = (): FreedomAccountStreamHealthState => ({
  sessionKey: '',
  connectionStatus: 'disconnected',
  connected: false,
  everConnected: false,
  portfolioReceived: false,
  ordersReceived: false,
  portfolioRevision: 0,
  ordersRevision: 0,
  recoveryPending: false
});

let state = emptyState();
const healthListeners = new Set<(sessionKey: string) => void>();

function notifyHealthListeners(): void {
  healthListeners.forEach((listener) => listener(state.sessionKey));
}

/** Subscribe to in-memory stream health changes; no account data is included in the notification. */
export function subscribeFreedomAccountStreamHealth(listener: (sessionKey: string) => void): () => void {
  healthListeners.add(listener);
  listener(state.sessionKey);
  return () => healthListeners.delete(listener);
}

/** Return a defensive, account-session-scoped health snapshot for presentation. */
export function getFreedomAccountStreamHealth(sessionKey: string): Readonly<FreedomAccountStreamHealthState> {
  if (!sessionKey || state.sessionKey !== sessionKey) {
    return { ...emptyState(), sessionKey };
  }
  return { ...state };
}

function ensureSession(sessionKey: string): void {
  if (state.sessionKey !== sessionKey) {
    state = { ...emptyState(), sessionKey };
  }
}

/** Tracks only validated events for the active administrator account session. */
export function setFreedomAccountStreamStatus(
  sessionKey: string,
  status: FreedomAccountStreamConnectionStatus
): void {
  if (!sessionKey) return;
  ensureSession(sessionKey);

  if (status === 'connected') {
    state.connectionStatus = 'connected';
    state.connected = true;
    state.everConnected = true;
    state.recoveryPending = false;
    notifyHealthListeners();
    return;
  }

  if (status === 'connecting') {
    if (!state.connected) state.connectionStatus = 'connecting';
    notifyHealthListeners();
    return;
  }

  if (status === 'reconnecting') {
    // Upstream recovery notices arrive over the still-open browser socket.
    state.connectionStatus = 'reconnecting';
    notifyHealthListeners();
    return;
  }

  if (status === 'disconnected') {
    // Only the connected -> disconnected transition opens a new recovery
    // window; repeated reconnect notices during one outage must not restart it.
    if (state.connected && state.everConnected) state.recoveryPending = true;
    state.connectionStatus = 'disconnected';
    state.connected = false;
    state.portfolioReceived = false;
    state.ordersReceived = false;
    notifyHealthListeners();
  }
}

/** Records a normalized push event. Revisions survive reconnects to reject late stale snapshots. */
export function markFreedomAccountStreamSnapshot(
  sessionKey: string,
  channel: FreedomAccountStreamChannel
): void {
  if (!sessionKey || state.sessionKey !== sessionKey || !state.connected) return;

  if (channel === 'portfolio') {
    state.portfolioReceived = true;
    state.portfolioRevision += 1;
  } else {
    state.ordersReceived = true;
    state.ordersRevision += 1;
  }
  notifyHealthListeners();
}

export function hasFreedomAccountStreamSnapshot(
  sessionKey: string,
  channel: FreedomAccountStreamChannel
): boolean {
  if (!sessionKey || state.sessionKey !== sessionKey || !state.connected) return false;
  return channel === 'portfolio' ? state.portfolioReceived : state.ordersReceived;
}

export function getFreedomAccountStreamSnapshotRevision(
  sessionKey: string,
  channel: FreedomAccountStreamChannel
): number {
  if (!sessionKey || state.sessionKey !== sessionKey) return 0;
  return channel === 'portfolio' ? state.portfolioRevision : state.ordersRevision;
}

/** Tracks whether both private channels have delivered validated snapshots. */
export function isFreedomAccountStreamHealthy(sessionKey: string): boolean {
  return Boolean(
    sessionKey &&
    state.sessionKey === sessionKey &&
    state.connected &&
    state.portfolioReceived &&
    state.ordersReceived
  );
}

/** A connected browser stream is authoritative even while its upstream recovers. */
export function isFreedomAccountStreamConnected(sessionKey: string): boolean {
  return Boolean(sessionKey && state.sessionKey === sessionKey && state.connected);
}

/** A single REST catch-up is allowed for each disconnect after a previously healthy connection. */
export function consumeFreedomAccountStreamRecovery(sessionKey: string): boolean {
  if (!sessionKey || state.sessionKey !== sessionKey || !state.recoveryPending) return false;
  state.recoveryPending = false;
  return true;
}

export type FreedomAccountRefreshMode = 'inactive' | 'live' | 'recover' | 'fallback';

/**
 * Resolve the admin's supplemental broker-data policy once per scheduled
 * checkpoint. REST is only eligible while the persistent browser socket is down.
 */
export function resolveFreedomAccountRefreshMode(sessionKey: string): FreedomAccountRefreshMode {
  if (!sessionKey) return 'inactive';
  if (isFreedomAccountStreamConnected(sessionKey)) return 'live';
  if (consumeFreedomAccountStreamRecovery(sessionKey)) return 'recover';
  return 'fallback';
}

/** Test isolation and explicit account-session teardown. */
export function resetFreedomAccountStreamHealth(): void {
  const previousSessionKey = state.sessionKey;
  state = emptyState();
  if (previousSessionKey) healthListeners.forEach((listener) => listener(previousSessionKey));
}
