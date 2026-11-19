import { describe, expect, it } from 'vitest';
import { createStartupCloudWriteGate } from './startupCloudWriteGate';

describe('startup cloud-write gate', () => {
  it('defers writes until the initial cloud pull is accepted', () => {
    const gate = createStartupCloudWriteGate();
    expect(gate.deferWrite()).toBe(true);
    expect(gate.hasPendingWrite()).toBe(true);
    expect(gate.releaseAfterAcceptedStartupPull()).toBe(true);
    expect(gate.isSuppressed()).toBe(false);
    expect(gate.hasPendingWrite()).toBe(false);
  });

  it('discards stale deferred writes after an explicit confirmed cloud replacement', () => {
    const gate = createStartupCloudWriteGate();
    expect(gate.deferWrite()).toBe(true);
    const wasSuppressed = gate.beginConfirmedReplacement();
    expect(wasSuppressed).toBe(true);
    expect(gate.deferWrite()).toBe(true);

    expect(gate.finishConfirmedReplacement(true, wasSuppressed)).toBe('discarded');
    expect(gate.isSuppressed()).toBe(false);
    expect(gate.hasPendingWrite()).toBe(false);
  });

  it('restores deferred writes after a failed replacement when startup was already released', () => {
    const gate = createStartupCloudWriteGate();
    expect(gate.releaseAfterAcceptedStartupPull()).toBe(false);
    const wasSuppressed = gate.beginConfirmedReplacement();
    expect(gate.deferWrite()).toBe(true);

    expect(gate.finishConfirmedReplacement(false, wasSuppressed)).toBe('flush');
    expect(gate.isSuppressed()).toBe(false);
    expect(gate.hasPendingWrite()).toBe(false);
  });

  it('keeps startup writes deferred when a replacement fails during startup', () => {
    const gate = createStartupCloudWriteGate();
    expect(gate.deferWrite()).toBe(true);
    const wasSuppressed = gate.beginConfirmedReplacement();

    expect(gate.finishConfirmedReplacement(false, wasSuppressed)).toBe('kept');
    expect(gate.isSuppressed()).toBe(true);
    expect(gate.hasPendingWrite()).toBe(true);
  });
});
