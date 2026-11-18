import { useEffect, useState } from 'preact/hooks';
import {
  getAppLanguage,
  subscribeAppLanguage,
  translateText,
  type AppLanguage
} from '../services/i18n';
import {
  createPwaInstallRuntime,
  type PwaInstallState
} from '../services/pwaInstallRuntime';

const installRuntime = typeof window === 'undefined'
  ? null
  : createPwaInstallRuntime(window);

const unavailableState: PwaInstallState = {
  canInstall: false,
  installed: false,
  isIOS: false
};

export function PwaInstallPrompt() {
  const [state, setState] = useState<PwaInstallState>(
    () => installRuntime?.getState() ?? unavailableState
  );
  const [language, setLanguage] = useState<AppLanguage>(() => getAppLanguage());
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => installRuntime?.subscribe(setState), []);
  useEffect(() => subscribeAppLanguage(setLanguage), []);

  if (state.installed || dismissed || (!state.canInstall && !state.isIOS)) return null;

  const handleInstall = async (): Promise<void> => {
    if (!installRuntime) return;
    await installRuntime.promptInstall();
  };

  return (
    <section
      class="mx-auto mt-3 flex max-w-6xl flex-wrap items-center justify-between gap-3 rounded-lg border border-cyan-900/70 bg-slate-900/90 px-3 py-3 shadow-sm"
      aria-label={translateText('Install Portfolio Terminal', language)}
      data-pwa-install-prompt
    >
      <div class="min-w-0 flex-1">
        <h2 class="text-sm font-semibold text-slate-100">
          {translateText('Install Portfolio Terminal', language)}
        </h2>
        <p class="mt-0.5 text-xs text-slate-400">
          {translateText('Keep your workspace one tap away.', language)}
        </p>
        {instructionsOpen && state.isIOS && (
          <div class="mt-2 rounded-md border border-slate-700 bg-slate-950/70 p-2 text-xs leading-5 text-slate-300">
            <p>{translateText('On iPhone or iPad, tap Share, then choose Add to Home Screen.', language)}</p>
            <p class="mt-1 font-semibold text-cyan-200">{translateText('Tap Add to finish.', language)}</p>
          </div>
        )}
      </div>
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        {state.canInstall ? (
          <button
            type="button"
            class="min-h-9 rounded-md bg-cyan-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
            onClick={() => { void handleInstall(); }}
          >
            {translateText('Install app', language)}
          </button>
        ) : (
          <button
            type="button"
            class="min-h-9 rounded-md border border-cyan-800 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-950/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
            aria-expanded={instructionsOpen}
            onClick={() => setInstructionsOpen((open) => !open)}
          >
            {translateText('Add to Home Screen', language)}
          </button>
        )}
        <button
          type="button"
          class="min-h-9 rounded-md px-2 py-1.5 text-xs text-slate-400 hover:text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300"
          onClick={() => setDismissed(true)}
        >
          {translateText('Not now', language)}
        </button>
      </div>
    </section>
  );
}
