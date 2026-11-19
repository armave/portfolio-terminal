import '../style.css';
import { h, render } from 'preact';
import { PwaShell } from './PwaShell';
import { handleSaveGatewaySecret, initApp } from '../app';
import { pullCloudState, pushCloudState } from './services/api';
import { registerSW } from 'virtual:pwa-register';
import { addUiEventListener, emitUiEvent } from './ui/uiEventBus';
import { createStartupRecoveryWatchdog } from './services/startupRecoveryWatchdog';
import { pwaUpdateRuntime } from './services/pwaUpdateRuntime';
import { isOnlyOpenAppClient, isPageRefreshNavigation } from './services/pwaRefreshUpdate';
import {
  consumeAutomaticRepairAttemptMarker,
  repairCurrentBrowserAppCache
} from './services/browserProfileRepairRuntime';

const pageNavigation = typeof performance === 'undefined'
  ? undefined
  : performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
const pageWasRefreshed = isPageRefreshNavigation(pageNavigation?.type);
let startupOverlayDismissed = false;
let initialWorkspaceSyncSettled = false;
let registeredServiceWorker: ServiceWorkerRegistration | null = null;
let applyStagedServiceWorkerUpdate: ((reloadPage?: boolean) => Promise<void>) | null = null;
let refreshUpdateActivationInFlight = false;

async function applyWaitingUpdateAfterRefresh(): Promise<void> {
  const registration = registeredServiceWorker;
  const waitingWorker = registration?.waiting;
  if (
    !pageWasRefreshed ||
    !startupOverlayDismissed ||
    !initialWorkspaceSyncSettled ||
    refreshUpdateActivationInFlight ||
    !registration ||
    !waitingWorker ||
    !navigator.serviceWorker.controller ||
    !applyStagedServiceWorkerUpdate
  ) return;

  refreshUpdateActivationInFlight = true;
  try {
    // The waiting worker counts all open clients in this app's scope. Only
    // activate after an explicit page refresh when this is the sole app tab.
    // Older tabs may not know this protocol, so the count is owned by the SW.
    const isOnlyOpenTab = await isOnlyOpenAppClient(waitingWorker);
    if (
      !isOnlyOpenTab ||
      registration.waiting !== waitingWorker ||
      registeredServiceWorker !== registration
    ) {
      if (!isOnlyOpenTab) {
        console.info('[PWA]: Update remains staged because another Portfolio Terminal tab is still open. Close the other tab and refresh again to apply it.');
      }
      return;
    }
    await applyStagedServiceWorkerUpdate();
  } catch (error) {
    // Fail closed: keep the worker waiting and let the ordinary close/reopen
    // lifecycle apply it later rather than forcing activation after a failed probe.
    console.warn('[PWA]: Could not safely apply the waiting update on refresh.', error);
  } finally {
    refreshUpdateActivationInFlight = false;
  }
}

let serviceWorkerReloadRequested = false;
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  // A first controller acquisition is normal PWA installation and can happen
  // while the user is creating an account. Never reload that in-flight session.
  // Only reload when an already-controlled page receives a replacement worker.
  let hasExistingController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hasExistingController) {
      hasExistingController = true;
      return;
    }
    if (serviceWorkerReloadRequested) return;
    serviceWorkerReloadRequested = true;
    window.location.reload();
  });
}

if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
  pwaUpdateRuntime.markUnsupported();
}

applyStagedServiceWorkerUpdate = registerSW({
  immediate: true,
  onNeedRefresh: () => {
    pwaUpdateRuntime.markUpdateAvailable();
    // Normal update detection only stages the worker. A refreshed page may
    // apply it after startup if no other tab uses this app scope.
    void applyWaitingUpdateAfterRefresh();
  },
  onNeedReload: () => {
    // The guarded controllerchange listener above owns the single page reload.
  },
  onRegisteredSW: (_serviceWorkerUrl, registration) => {
    if (!registration) {
      pwaUpdateRuntime.markUnsupported();
      return;
    }
    registeredServiceWorker = registration;
    if (registration.waiting) {
      pwaUpdateRuntime.markUpdateAvailable();
      void applyWaitingUpdateAfterRefresh();
    }
    // Check after registration and every 30 minutes while the page is visible.
    // Returning to a visible tab catches up if the interval elapsed in the background.
    pwaUpdateRuntime.start(() => registration.update().catch((error) => {
      console.warn('[PWA]: Could not check for a newer Portfolio Terminal app shell.', error);
      throw error;
    }));
  },
  onRegisterError: (error) => {
    pwaUpdateRuntime.markError();
    console.warn('[PWA]: Could not register the Portfolio Terminal service worker.', error);
  }
});

const automaticRepairAlreadyAttempted = typeof window !== 'undefined'
  ? consumeAutomaticRepairAttemptMarker(window.location.href, (url) => {
    window.history.replaceState(window.history.state, '', url);
  })
  : false;

const startupRecoveryWatchdog = createStartupRecoveryWatchdog({
  automaticRepairAlreadyAttempted,
  repairBrowserAppCache: () => repairCurrentBrowserAppCache({ automatic: true }),
  onManualRecoveryRequired: () => {
    console.error('[Startup Watchdog]: Startup is still blocked after its one automatic browser repair.');
    emitUiEvent('app:startup-state', { visible: true, failed: true });
  },
  onRepairError: (error) => {
    console.error('[Startup Watchdog]: Automatic browser repair could not complete.', error);
  }
});

function clearStartupWatchdog(): void {
  startupRecoveryWatchdog.cancel();
}

function armStartupWatchdog(): void {
  startupRecoveryWatchdog.arm();
}

addUiEventListener('app:startup-state', (event) => {
  if (event.detail.failed) {
    clearStartupWatchdog();
  } else if (event.detail.visible) {
    armStartupWatchdog();
  }
  // visible=false is only a request. App may keep the overlay mounted until
  // page-readiness checks finish, so keep the watchdog armed until that commit.
});
addUiEventListener('app:startup-overlay-dismissed', () => {
  clearStartupWatchdog();
  startupOverlayDismissed = true;
  void applyWaitingUpdateAfterRefresh();
});
addUiEventListener('app:initial-workspace-sync-settled', () => {
  initialWorkspaceSyncSettled = true;
  void applyWaitingUpdateAfterRefresh();
});

/**
 * Ask browser autofill and common password managers to ignore ordinary app
 * fields. The gateway secret is deliberately excluded so authentication still
 * works with the user's credential manager.
 *
 * Note: a site cannot reliably suppress prompts injected by every installed
 * password-manager app/extension; manager-specific site settings may still
 * be needed.
 */
function disableAutofillForNonAuthFields() {
  const authFieldSelector = '#gatewaySecretInput, #authUserName, #authPassword, #bootstrapSecret';
  const fieldSelector = 'input, textarea, select';

  const configureField = (field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => {
    if (field.matches(authFieldSelector)) return;

    // Do not use autocomplete="new-password" here: that token can itself
    // trigger password-manager generation/save UI. These are not credentials.
    if (field.getAttribute('autocomplete') !== 'off') {
      field.setAttribute('autocomplete', 'off');
    }

    // Password-manager-specific opt-out hints (ignored by managers that do not
    // support them). Keep the values stable to avoid MutationObserver loops.
    const ignoreAttributes: Record<string, string> = {
      'data-lpignore': 'true',
      'data-1p-ignore': 'true',
      'data-bwignore': 'true',
      'data-protonpass-ignore': 'true',
      'data-form-type': 'other'
    };
    for (const [name, value] of Object.entries(ignoreAttributes)) {
      if (field.getAttribute(name) !== value) field.setAttribute(name, value);
    }

    if (!(field instanceof HTMLSelectElement)) {
      if (field.getAttribute('autocorrect') !== 'off') field.setAttribute('autocorrect', 'off');
      if (field.getAttribute('autocapitalize') !== 'off') field.setAttribute('autocapitalize', 'off');
      if (field.getAttribute('spellcheck') !== 'false') field.setAttribute('spellcheck', 'false');
    }
  };

  const configureFields = (root: ParentNode) => {
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(fieldSelector)
      .forEach(configureField);
    if (root instanceof HTMLInputElement || root instanceof HTMLTextAreaElement || root instanceof HTMLSelectElement) {
      configureField(root);
    }
  };

  configureFields(document);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLElement) configureFields(node);
      }
      if (
        record.type === 'attributes' &&
        (record.target instanceof HTMLInputElement ||
          record.target instanceof HTMLTextAreaElement ||
          record.target instanceof HTMLSelectElement)
      ) {
        configureField(record.target);
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['type', 'autocomplete', 'name']
  });
}

if (typeof document !== 'undefined') {
  disableAutofillForNonAuthFields();
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).pullCloudState = pullCloudState;
  (window as unknown as Record<string, unknown>).pushCloudState = pushCloudState;
}


/** The application has exactly one Preact root. Runtime orchestration lives in app.ts;
 * component mounting and startup sequencing are owned by this entry point. */
function mountPreactApplication() {
  const root = document.getElementById('root');
  if (!root) throw new Error('Missing #root mount element');
  render(h(PwaShell, { onSaveGatewaySecret: handleSaveGatewaySecret }), root);
}

async function bootstrapApplication() {
  // Mount the recovery-capable shell first. A blocked profile database must not
  // prevent the app from rendering its retry/repair controls.
  mountPreactApplication();
  armStartupWatchdog();

  // Let App effects register their runtime event subscriptions before startup emits events.
  window.requestAnimationFrame(() => { void initApp(); });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { void bootstrapApplication(); }, { once: true });
} else {
  void bootstrapApplication();
}
