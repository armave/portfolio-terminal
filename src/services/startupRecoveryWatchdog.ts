export const DEFAULT_STARTUP_RECOVERY_TIMEOUT_MS = 30_000;

export interface StartupRecoveryWatchdogDependencies {
  /** True when this page is the single reload immediately following an automatic repair. */
  automaticRepairAlreadyAttempted?: boolean;
  timeoutMs?: number;
  repairBrowserAppCache: () => Promise<unknown> | unknown;
  onManualRecoveryRequired: () => void;
  onRepairError?: (error: unknown) => void;
  schedule?: typeof setTimeout;
  cancelScheduled?: typeof clearTimeout;
}

export interface StartupRecoveryWatchdog {
  arm: () => void;
  cancel: () => void;
  hasAttemptedAutomaticRepair: () => boolean;
}

/**
 * Gives an unresponsive startup one automatic, data-preserving app-shell repair.
 *
 * A query marker survives the repair reload so a second stuck boot cannot create
 * an automatic reload loop. That second boot exposes the manual recovery UI.
 */
export function createStartupRecoveryWatchdog(
  dependencies: StartupRecoveryWatchdogDependencies
): StartupRecoveryWatchdog {
  const schedule = dependencies.schedule ?? setTimeout;
  const cancelScheduled = dependencies.cancelScheduled ?? clearTimeout;
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_STARTUP_RECOVERY_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempted = dependencies.automaticRepairAlreadyAttempted === true;
  let repairStarted = false;

  const cancel = (): void => {
    if (timer !== null) cancelScheduled(timer);
    timer = null;
  };

  const arm = (): void => {
    cancel();
    if (repairStarted) return;

    timer = schedule(() => {
      timer = null;
      if (attempted) {
        dependencies.onManualRecoveryRequired();
        return;
      }

      // Set the one-shot guard before invoking browser APIs; they may reject or
      // synchronously trigger navigation/controller events.
      attempted = true;
      repairStarted = true;
      void Promise.resolve()
        .then(() => dependencies.repairBrowserAppCache())
        .catch((error: unknown) => {
          dependencies.onRepairError?.(error);
          dependencies.onManualRecoveryRequired();
        });
    }, timeoutMs);
  };

  return {
    arm,
    cancel,
    hasAttemptedAutomaticRepair: () => attempted
  };
}
