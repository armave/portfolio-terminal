import { afterEach, describe, expect, it } from 'vitest';
import {
  consumeFreedomAccountStreamRecovery,
  getFreedomAccountStreamSnapshotRevision,
  hasFreedomAccountStreamSnapshot,
  isFreedomAccountStreamHealthy,
  markFreedomAccountStreamSnapshot,
  resetFreedomAccountStreamHealth,
  setFreedomAccountStreamStatus
} from './freedomAccountStreamHealth';

describe('Freedom account stream health', () => {
  afterEach(() => resetFreedomAccountStreamHealth());

  it('requires a connected stream and valid events from both private channels', () => {
    const session = 'admin:account-1';
    setFreedomAccountStreamStatus(session, 'connected');

    markFreedomAccountStreamSnapshot(session, 'portfolio');
    expect(hasFreedomAccountStreamSnapshot(session, 'portfolio')).toBe(true);
    expect(isFreedomAccountStreamHealthy(session)).toBe(false);

    markFreedomAccountStreamSnapshot(session, 'orders');
    expect(hasFreedomAccountStreamSnapshot(session, 'orders')).toBe(true);
    expect(isFreedomAccountStreamHealthy(session)).toBe(true);
  });

  it('allows one recovery after a connected stream drops, then suppresses repeated recovery', () => {
    const session = 'admin:account-1';
    setFreedomAccountStreamStatus(session, 'connected');
    markFreedomAccountStreamSnapshot(session, 'portfolio');
    markFreedomAccountStreamSnapshot(session, 'orders');
    expect(isFreedomAccountStreamHealthy(session)).toBe(true);

    setFreedomAccountStreamStatus(session, 'reconnecting');
    expect(isFreedomAccountStreamHealthy(session)).toBe(false);
    expect(hasFreedomAccountStreamSnapshot(session, 'portfolio')).toBe(false);
    expect(consumeFreedomAccountStreamRecovery(session)).toBe(true);
    expect(consumeFreedomAccountStreamRecovery(session)).toBe(false);
    setFreedomAccountStreamStatus(session, 'reconnecting');
    expect(consumeFreedomAccountStreamRecovery(session)).toBe(false);

    setFreedomAccountStreamStatus(session, 'connected');
    markFreedomAccountStreamSnapshot(session, 'portfolio');
    markFreedomAccountStreamSnapshot(session, 'orders');
    setFreedomAccountStreamStatus(session, 'disconnected');
    expect(consumeFreedomAccountStreamRecovery(session)).toBe(true);
  });

  it('does not schedule recovery for a stream that never connected', () => {
    const session = 'admin:account-1';
    setFreedomAccountStreamStatus(session, 'connecting');
    setFreedomAccountStreamStatus(session, 'reconnecting');
    expect(consumeFreedomAccountStreamRecovery(session)).toBe(false);
  });

  it('keeps event revisions across disconnects so late snapshots can be discarded', () => {
    const session = 'admin:account-1';
    setFreedomAccountStreamStatus(session, 'connected');
    markFreedomAccountStreamSnapshot(session, 'portfolio');
    const revision = getFreedomAccountStreamSnapshotRevision(session, 'portfolio');

    setFreedomAccountStreamStatus(session, 'reconnecting');
    expect(getFreedomAccountStreamSnapshotRevision(session, 'portfolio')).toBe(revision);
    setFreedomAccountStreamStatus(session, 'connected');
    markFreedomAccountStreamSnapshot(session, 'portfolio');
    expect(getFreedomAccountStreamSnapshotRevision(session, 'portfolio')).toBe(revision + 1);
  });

  it('isolates health state by account session', () => {
    setFreedomAccountStreamStatus('admin:account-1', 'connected');
    markFreedomAccountStreamSnapshot('admin:account-1', 'portfolio');
    markFreedomAccountStreamSnapshot('admin:account-1', 'orders');

    expect(isFreedomAccountStreamHealthy('admin:account-1')).toBe(true);
    expect(isFreedomAccountStreamHealthy('admin:account-2')).toBe(false);
    expect(consumeFreedomAccountStreamRecovery('admin:account-2')).toBe(false);
  });
});
