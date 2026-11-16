import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStartupRecoveryWatchdog,
  DEFAULT_STARTUP_RECOVERY_TIMEOUT_MS
} from './startupRecoveryWatchdog';

describe('startup recovery watchdog', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('automatically repairs once after the 30-second startup deadline', async () => {
    vi.useFakeTimers();
    const repair = vi.fn(async () => undefined);
    const manualRecovery = vi.fn();
    const watchdog = createStartupRecoveryWatchdog({
      repairBrowserAppCache: repair,
      onManualRecoveryRequired: manualRecovery
    });

    expect(DEFAULT_STARTUP_RECOVERY_TIMEOUT_MS).toBe(30_000);
    watchdog.arm();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(repair).not.toHaveBeenCalled();
    expect(manualRecovery).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(repair).toHaveBeenCalledTimes(1));
    expect(watchdog.hasAttemptedAutomaticRepair()).toBe(true);
    expect(manualRecovery).not.toHaveBeenCalled();

    watchdog.arm();
    await vi.advanceTimersByTimeAsync(DEFAULT_STARTUP_RECOVERY_TIMEOUT_MS);
    expect(repair).toHaveBeenCalledTimes(1);
    expect(manualRecovery).not.toHaveBeenCalled();
  });

  it('does not repeat automatic repair after the recovery reload', async () => {
    vi.useFakeTimers();
    const repair = vi.fn();
    const manualRecovery = vi.fn();
    const watchdog = createStartupRecoveryWatchdog({
      automaticRepairAlreadyAttempted: true,
      repairBrowserAppCache: repair,
      onManualRecoveryRequired: manualRecovery
    });

    watchdog.arm();
    await vi.advanceTimersByTimeAsync(DEFAULT_STARTUP_RECOVERY_TIMEOUT_MS);

    expect(repair).not.toHaveBeenCalled();
    expect(manualRecovery).toHaveBeenCalledTimes(1);
    expect(watchdog.hasAttemptedAutomaticRepair()).toBe(true);
  });

  it('cancels the deadline when startup completes', async () => {
    vi.useFakeTimers();
    const repair = vi.fn();
    const manualRecovery = vi.fn();
    const watchdog = createStartupRecoveryWatchdog({
      repairBrowserAppCache: repair,
      onManualRecoveryRequired: manualRecovery
    });

    watchdog.arm();
    await vi.advanceTimersByTimeAsync(10_000);
    watchdog.cancel();
    await vi.advanceTimersByTimeAsync(DEFAULT_STARTUP_RECOVERY_TIMEOUT_MS);

    expect(repair).not.toHaveBeenCalled();
    expect(manualRecovery).not.toHaveBeenCalled();
  });

  it('re-arms the deadline when startup progress reports a new active phase', async () => {
    vi.useFakeTimers();
    const repair = vi.fn();
    const watchdog = createStartupRecoveryWatchdog({
      timeoutMs: 30_000,
      repairBrowserAppCache: repair,
      onManualRecoveryRequired: vi.fn()
    });

    watchdog.arm();
    await vi.advanceTimersByTimeAsync(20_000);
    watchdog.arm();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(repair).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(repair).toHaveBeenCalledTimes(1));
  });

  it('falls back to manual recovery if the automatic repair itself fails', async () => {
    vi.useFakeTimers();
    const error = new Error('Cache Storage is unavailable');
    const repair = vi.fn(async () => { throw error; });
    const manualRecovery = vi.fn();
    const onRepairError = vi.fn();
    const watchdog = createStartupRecoveryWatchdog({
      repairBrowserAppCache: repair,
      onManualRecoveryRequired: manualRecovery,
      onRepairError
    });

    watchdog.arm();
    await vi.advanceTimersByTimeAsync(DEFAULT_STARTUP_RECOVERY_TIMEOUT_MS);
    await vi.waitFor(() => expect(manualRecovery).toHaveBeenCalledTimes(1));

    expect(onRepairError).toHaveBeenCalledWith(error);
    expect(watchdog.hasAttemptedAutomaticRepair()).toBe(true);
  });
});
