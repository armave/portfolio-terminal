import { useEffect, useState } from 'preact/hooks';
import {
  getAppLanguage,
  subscribeAppLanguage,
  translateText,
  type AppLanguage
} from '../services/i18n';
import { pwaUpdateRuntime, type PwaUpdateSnapshot } from '../services/pwaUpdateRuntime';

function formatLastChecked(timestamp: number, language: AppLanguage): string {
  return new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(timestamp));
}

function statusCopy(status: PwaUpdateSnapshot['status']): string {
  switch (status) {
    case 'checking': return 'Checking for updates…';
    case 'up_to_date': return 'Up to date';
    case 'update_waiting': return 'Update ready';
    case 'error': return 'Update check failed';
    case 'unsupported': return 'Updates are not supported in this browser.';
    default: return 'Not checked yet';
  }
}

export function PwaUpdateStatus() {
  const [snapshot, setSnapshot] = useState<PwaUpdateSnapshot>(() => pwaUpdateRuntime.getState());
  const [language, setLanguage] = useState<AppLanguage>(() => getAppLanguage());

  useEffect(() => pwaUpdateRuntime.subscribe(setSnapshot), []);
  useEffect(() => subscribeAppLanguage(setLanguage), []);

  const statusTone = snapshot.status === 'up_to_date'
    ? 'text-emerald-300'
    : snapshot.status === 'update_waiting'
      ? 'text-amber-200'
      : snapshot.status === 'error'
        ? 'text-rose-300'
        : 'text-slate-300';
  const canCheckNow = pwaUpdateRuntime.canCheckNow();

  return (
    <section
      class="settings-panel flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3"
      aria-labelledby="pwaUpdateStatusTitle"
      data-pwa-update-status={snapshot.status}
    >
      <div class="min-w-0 flex-1">
        <h3 id="pwaUpdateStatusTitle" class="text-xs font-semibold text-slate-200">
          {translateText('App updates', language)}
        </h3>
        <p class={`mt-1 text-xs font-semibold ${statusTone}`} role="status" aria-live="polite">
          {translateText(statusCopy(snapshot.status), language)}
        </p>
        <p class="mt-1 text-[11px] text-slate-500">
          {translateText('Automatically checks every 30 minutes', language)}
        </p>
        <p class="mt-0.5 text-[11px] text-slate-500">
          {snapshot.lastCheckedAt === null
            ? translateText('Not checked yet', language)
            : translateText('Last checked', language) + ': ' + formatLastChecked(snapshot.lastCheckedAt, language)}
        </p>
        {snapshot.status === 'update_waiting' && (
          <p class="mt-1 text-[11px] text-amber-200/80">
            {translateText('The update will install automatically the next time you open the app.', language)}
          </p>
        )}
        {snapshot.status === 'error' && (
          <p class="mt-1 text-[11px] text-slate-500">
            {translateText(
              canCheckNow
                ? 'The app will retry automatically. You can also check again now.'
                : 'Open the app again to retry update detection.',
              language
            )}
          </p>
        )}
      </div>
      <button
        type="button"
        class="min-h-8 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!canCheckNow}
        onClick={() => { void pwaUpdateRuntime.checkNow(); }}
      >
        {translateText('Check now', language)}
      </button>
    </section>
  );
}
