export type ConfirmedCloudReplacementDisposition = 'discarded' | 'flush' | 'kept';

/** Keeps startup/deferred writes from racing an authenticated cloud snapshot pull. */
export function createStartupCloudWriteGate() {
  let suppressed = true;
  let pending = false;

  return {
    beginWorkspaceActivation(): void {
      suppressed = true;
    },
    deferWrite(): boolean {
      if (!suppressed) return false;
      pending = true;
      return true;
    },
    releaseAfterAcceptedStartupPull(): boolean {
      suppressed = false;
      const shouldFlush = pending;
      pending = false;
      return shouldFlush;
    },
    beginConfirmedReplacement(): boolean {
      const wasSuppressed = suppressed;
      suppressed = true;
      return wasSuppressed;
    },
    finishConfirmedReplacement(succeeded: boolean, wasSuppressed: boolean): ConfirmedCloudReplacementDisposition {
      if (succeeded) {
        // The user explicitly chose the cloud snapshot as authoritative. Any
        // queued pre-pull write represents the state that was just replaced.
        suppressed = false;
        pending = false;
        return 'discarded';
      }

      suppressed = wasSuppressed;
      if (wasSuppressed || !pending) return 'kept';
      pending = false;
      return 'flush';
    },
    isSuppressed(): boolean {
      return suppressed;
    },
    hasPendingWrite(): boolean {
      return pending;
    }
  };
}
