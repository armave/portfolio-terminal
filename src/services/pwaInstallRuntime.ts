interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

export interface PwaInstallState {
  canInstall: boolean;
  installed: boolean;
  isIOS: boolean;
}

type PwaInstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

export type PwaInstallTarget = Pick<
  Window,
  'addEventListener' | 'removeEventListener' | 'matchMedia'
> & {
  navigator: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> & {
    standalone?: boolean;
  };
};

export interface PwaInstallRuntime {
  getState: () => PwaInstallState;
  subscribe: (listener: (state: PwaInstallState) => void) => () => void;
  promptInstall: () => Promise<PwaInstallOutcome>;
  dispose: () => void;
}

export function isIOSDevice(userAgent: string, platform = '', maxTouchPoints = 0): boolean {
  return /iPhone|iPad|iPod/i.test(userAgent) ||
    (platform === 'MacIntel' && maxTouchPoints > 1);
}

/**
 * Captures the browser's one-use install event when the application module
 * loads. The native prompt is deliberately deferred to an explicit user action.
 */
export function createPwaInstallRuntime(target: PwaInstallTarget): PwaInstallRuntime {
  let deferredPrompt: BeforeInstallPromptEvent | null = null;
  const listeners = new Set<(state: PwaInstallState) => void>();
  const displayMode = target.matchMedia('(display-mode: standalone)');
  const initialInstalled = displayMode.matches || target.navigator.standalone === true;
  let state: PwaInstallState = {
    canInstall: false,
    installed: initialInstalled,
    isIOS: isIOSDevice(
      target.navigator.userAgent || '',
      target.navigator.platform || '',
      target.navigator.maxTouchPoints || 0
    )
  };

  const publish = (next: PwaInstallState): void => {
    if (
      next.canInstall === state.canInstall &&
      next.installed === state.installed &&
      next.isIOS === state.isIOS
    ) return;
    state = next;
    listeners.forEach((listener) => listener(state));
  };

  const refreshDisplayMode = (): void => {
    const installed = displayMode.matches || target.navigator.standalone === true;
    publish({ ...state, installed, canInstall: installed ? false : state.canInstall });
  };

  const handleBeforeInstallPrompt = (event: Event): void => {
    event.preventDefault();
    if (state.installed) return;
    deferredPrompt = event as BeforeInstallPromptEvent;
    publish({ ...state, canInstall: true });
  };

  const handleAppInstalled = (): void => {
    deferredPrompt = null;
    publish({ ...state, canInstall: false, installed: true });
  };

  target.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  target.addEventListener('appinstalled', handleAppInstalled);
  displayMode.addEventListener('change', refreshDisplayMode);

  const getState = (): PwaInstallState => ({ ...state });

  const subscribe = (listener: (next: PwaInstallState) => void): (() => void) => {
    listeners.add(listener);
    listener(getState());
    return () => listeners.delete(listener);
  };

  const promptInstall = async (): Promise<PwaInstallOutcome> => {
    const prompt = deferredPrompt;
    if (!prompt || state.installed) return 'unavailable';

    deferredPrompt = null;
    publish({ ...state, canInstall: false });
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      return choice.outcome;
    } catch {
      return 'unavailable';
    }
  };

  const dispose = (): void => {
    target.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    target.removeEventListener('appinstalled', handleAppInstalled);
    displayMode.removeEventListener('change', refreshDisplayMode);
    listeners.clear();
    deferredPrompt = null;
  };

  return { getState, subscribe, promptInstall, dispose };
}
