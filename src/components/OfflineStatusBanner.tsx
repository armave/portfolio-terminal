import { useEffect, useState } from 'preact/hooks';
import { getAuthStatus } from '../services/api';
import {
  getAppLanguage,
  subscribeAppLanguage,
  translateText,
  type AppLanguage
} from '../services/i18n';
import {
  createPwaConnectivityRuntime,
  type PwaConnectivityStatus
} from '../services/pwaConnectivityRuntime';

const connectivityRuntime = typeof window === 'undefined'
  ? null
  : createPwaConnectivityRuntime(window, async () => {
      await getAuthStatus();
    });

export function OfflineStatusBanner() {
  const [status, setStatus] = useState<PwaConnectivityStatus>(
    () => connectivityRuntime?.getState() ?? 'online'
  );
  const [language, setLanguage] = useState<AppLanguage>(() => getAppLanguage());

  useEffect(() => connectivityRuntime?.subscribe(setStatus), []);
  useEffect(() => subscribeAppLanguage(setLanguage), []);

  if (status === 'online') return null;

  const message = status === 'offline'
    ? 'No internet connection'
    : status === 'reconnecting'
      ? 'Checking application service…'
      : 'The application service is not responding. Portfolio, broker and quote availability is checked separately.';

  return (
    <div
      id="pwa-network-status"
      data-pwa-connectivity={status}
      class="mx-auto mt-3 flex max-w-6xl flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-800/70 bg-amber-950/35 px-3 py-2 text-xs text-amber-100"
      role={status === 'offline' ? 'alert' : 'status'}
      aria-live={status === 'offline' ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      <div class="min-w-0">
        <p class="font-semibold">{translateText(message, language)}</p>
        {status === 'offline' && (
          <p class="mt-0.5 text-[11px] text-amber-200/80">
            {translateText(
              'Only the application shell is cached. Sign-in and authenticated portfolio data require a connection.',
              language
            )}
          </p>
        )}
      </div>
      {status === 'unavailable' && (
        <button
          type="button"
          class="min-h-9 rounded-md border border-amber-700 bg-amber-900/50 px-3 py-1.5 font-semibold text-amber-50 hover:bg-amber-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
          onClick={() => { void connectivityRuntime?.retry(); }}
        >
          {translateText('Retry', language)}
        </button>
      )}
    </div>
  );
}
