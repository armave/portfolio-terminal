export type FreedomAccountStreamChannel = 'portfolio' | 'orders';
export type FreedomAccountStreamConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

interface FreedomAccountStreamHealthState {
  sessionKey: string;
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
  connected: false,
  everConnected: false,
  portfolioReceived: false,
  ordersReceived: false,
  portfolioRevision: 0,
  ordersRevision: 0,
  recoveryPending: false
});

let state = emptyState();

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
    state.connected = true;
    state.everConnected = true;
    return;
  }

  if (status === 'reconnecting' || status === 'disconnected') {
    // Only the connected -> disconnected transition opens a new recovery
    // window; repeated reconnect notices during one outage must not restart it.
    if (state.connected && state.everConnected) state.recoveryPending = true;
    state.connected = false;
    state.portfolioReceived = false;
    state.ordersReceived = false;
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

/** Both private data channels must have delivered a valid event before recurring REST is suppressed. */
export function isFreedomAccountStreamHealthy(sessionKey: string): boolean {
  return Boolean(
    sessionKey &&
    state.sessionKey === sessionKey &&
    state.connected &&
    state.portfolioReceived &&
    state.ordersReceived
  );
}

/** A single REST catch-up is allowed for each disconnect after a previously healthy connection. */
export function consumeFreedomAccountStreamRecovery(sessionKey: string): boolean {
  if (!sessionKey || state.sessionKey !== sessionKey || !state.recoveryPending) return false;
  state.recoveryPending = false;
  return true;
}

/** Test isolation and explicit account-session teardown. */
export function resetFreedomAccountStreamHealth(): void {
  state = emptyState();
}
