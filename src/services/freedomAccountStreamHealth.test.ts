import { afterEach, describe, expect, it } from 'vitest';
import {
  consumeFreedomAccountStreamRecovery,
  getFreedomAccountStreamSnapshotRevision,
  hasFreedomAccountStreamSnapshot,
  isFreedomAccountStreamHealthy,
  markFreedomAccountStreamSnapshot,
  resetFreedomAccountStreamHealth,
  resolveFreedomAccountRefreshMode,
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

  it('allows one recovery during an outage and clears it when the socket reconnects', () => {
    const session = 'admin:account-1';
    setFreedomAccountStreamStatus(session, 'connected');
    markFreedomAccountStreamSnapshot(session, 'portfolio');
    markFreedomAccountStreamSnapshot(session, 'orders');
    expect(isFreedomAccountStreamHealthy(session)).toBe(true);

    setFreedomAccountStreamStatus(session, 'disconnected');
    expect(isFreedomAccountStreamHealthy(session)).toBe(false);
    expect(hasFreedomAccountStreamSnapshot(session, 'portfolio')).toBe(false);
    // Repeated reconnect notices before the connection recovers are one outage.
    setFreedomAccountStreamStatus(session, 'disconnected');

    // A recovered persistent socket takes over immediately without a REST catch-up.
    setFreedomAccountStreamStatus(session, 'connected');
    markFreedomAccountStreamSnapshot(session, 'portfolio');
    markFreedomAccountStreamSnapshot(session, 'orders');
    expect(isFreedomAccountStreamHealthy(session)).toBe(true);
    expect(consumeFreedomAccountStreamRecovery(session)).toBe(false);

    // A later disconnect is a distinct outage and opens exactly one new recovery.
    setFreedomAccountStreamStatus(session, 'disconnected');
    expect(consumeFreedomAccountStreamRecovery(session)).toBe(true);
    expect(consumeFreedomAccountStreamRecovery(session)).toBe(false);
  });

  it('does not schedule recovery for a stream that never connected', () => {
    const session = 'admin:account-1';
    setFreedomAccountStreamStatus(session, 'connecting');
    setFreedomAccountStreamStatus(session, 'disconnected');
    expect(consumeFreedomAccountStreamRecovery(session)).toBe(false);
  });

  it('suppresses REST as soon as the persistent browser socket is connected', () => {
    const session = 'admin:account-1';
    expect(resolveFreedomAccountRefreshMode(session)).toBe('fallback');

    setFreedomAccountStreamStatus(session, 'connecting');
    expect(resolveFreedomAccountRefreshMode(session)).toBe('fallback');

    setFreedomAccountStreamStatus(session, 'connected');
    expect(resolveFreedomAccountRefreshMode(session)).toBe('live');
    markFreedomAccountStreamSnapshot(session, 'portfolio');
    expect(resolveFreedomAccountRefreshMode(session)).toBe('live');

    markFreedomAccountStreamSnapshot(session, 'orders');
    expect(resolveFreedomAccountRefreshMode(session)).toBe('live');

    setFreedomAccountStreamStatus(session, 'reconnecting');
    expect(resolveFreedomAccountRefreshMode(session)).toBe('live');
  });

  it('allows one broker catch-up while disconnected and drops it if the socket recovers first', () => {
    const session = 'admin:account-1';
    setFreedomAccountStreamStatus(session, 'connected');
    markFreedomAccountStreamSnapshot(session, 'portfolio');
    markFreedomAccountStreamSnapshot(session, 'orders');
    setFreedomAccountStreamStatus(session, 'disconnected');

    expect(resolveFreedomAccountRefreshMode(session)).toBe('recover');
    expect(resolveFreedomAccountRefreshMode(session)).toBe('fallback');

    setFreedomAccountStreamStatus(session, 'connected');
    expect(resolveFreedomAccountRefreshMode(session)).toBe('live');
  });

  it('does not run a recovery catch-up after the persistent socket reconnects first', () => {
    const session = 'admin:account-1';
    setFreedomAccountStreamStatus(session, 'connected');
    setFreedomAccountStreamStatus(session, 'disconnected');
    setFreedomAccountStreamStatus(session, 'connected');
    expect(resolveFreedomAccountRefreshMode(session)).toBe('live');
  });

  it('does not activate broker refresh work without an account session', () => {
    expect(resolveFreedomAccountRefreshMode('')).toBe('inactive');
  });

  it('keeps event revisions across disconnects so late snapshots can be discarded', () => {
    const session = 'admin:account-1';
    setFreedomAccountStreamStatus(session, 'connected');
    markFreedomAccountStreamSnapshot(session, 'portfolio');
    const revision = getFreedomAccountStreamSnapshotRevision(session, 'portfolio');

    setFreedomAccountStreamStatus(session, 'disconnected');
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
