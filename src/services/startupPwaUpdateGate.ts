/**
 * Keep automatic PWA activation inside the initial startup window.
 *
 * Updates discovered after the startup overlay has been dismissed remain in
 * the service worker's waiting state and are applied automatically next time
 * the app starts, avoiding an unsolicited mid-session reload.
 */
export function createStartupPwaUpdateGate() {
  let startupWindowOpen = true;
  let updateActivationRequested = false;

  return {
    applyDuringStartup(applyUpdate: () => void): boolean {
      if (!startupWindowOpen || updateActivationRequested) return false;
      updateActivationRequested = true;
      applyUpdate();
      return true;
    },
    closeStartupWindow(): void {
      startupWindowOpen = false;
    }
  };
}
