import { useEffect, useState } from 'preact/hooks';
import { getAppLanguage, translateText } from '../services/i18n';
import { getAuthStatus } from '../services/api';
import { getCloudSyncDiagnostics, subscribeCloudSyncDiagnostics } from '../services/cloudSyncDiagnostics';
import type { CloudSyncDiagnostic, CloudSyncDiagnosticReason } from '../services/cloudSyncDiagnostics';
import { useCloudStatus, useCloudSyncStatus } from '../ui/uiStateStore';

type ServiceWorkerState = 'active' | 'registered' | 'not_registered' | 'unsupported' | 'error';
type AppShellCacheState = 'available' | 'incomplete' | 'not_registered' | 'unsupported' | 'error';
type DeviceHealth = 'ready' | 'offline' | 'attention' | 'checking';

export interface DeviceDiagnostics {
  applicationApiStatus: 'reachable' | 'unavailable';
  browser: string;
  operatingSystem: string;
  deviceType: string;
  screen: string;
  viewport: string;
  pixelRatio: string;
  language: string;
  timeZone: string;
  online: boolean;
  localStorageAvailable: boolean;
  secureContext: boolean;
  standalone: boolean;
  serviceWorker: ServiceWorkerState;
  appShellCache: AppShellCacheState;
  checkedAt: number;
}

export function getBrowserLabel(userAgent: string): string {
  if (/EdgA?\/|EdgiOS\//i.test(userAgent)) return 'Microsoft Edge';
  if (/OPR\//i.test(userAgent)) return 'Opera';
  if (/SamsungBrowser\//i.test(userAgent)) return 'Samsung Internet';
  if (/Firefox\//i.test(userAgent) || /FxiOS\//i.test(userAgent)) return 'Firefox';
  if (/CriOS\//i.test(userAgent) || /Chrome\//i.test(userAgent)) return 'Chrome';
  if (/Safari\//i.test(userAgent)) return 'Safari';
  return 'Unknown browser';
}

export function getOperatingSystemLabel(
  userAgent: string,
  platform = '',
  maxTouchPoints = 0
): string {
  if (/Android/i.test(userAgent)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)) return 'iOS / iPadOS';
  if (/Windows/i.test(userAgent) || /Win/i.test(platform)) return 'Windows';
  if (/CrOS/i.test(userAgent)) return 'ChromeOS';
  if (/Mac OS X/i.test(userAgent) || /Mac/i.test(platform)) return 'macOS';
  if (/Linux/i.test(userAgent) || /Linux/i.test(platform)) return 'Linux';
  return 'Unknown';
}

export function getDeviceTypeLabel(userAgent: string): string {
  if (/iPad|Tablet/i.test(userAgent) || (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent))) return 'Tablet';
  if (/Mobile|Android|iPhone|iPod/i.test(userAgent)) return 'Mobile';
  return 'Desktop';
}

export function checkLocalStorageAvailability(storage: Pick<Storage, 'setItem' | 'getItem' | 'removeItem'> | null): boolean {
  if (!storage) return false;
  const key = '__portfolio_terminal_device_check__';
  try {
    storage.setItem(key, 'ok');
    const available = storage.getItem(key) === 'ok';
    storage.removeItem(key);
    return available;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Storage is unavailable; there is nothing further to recover.
    }
    return false;
  }
}

export function getApplicationApiLabel(status: DeviceDiagnostics['applicationApiStatus']): string {
  return status === 'reachable' ? 'Reachable' : 'Unavailable';
}

export function getCloudRequestLabel(status: { status: string; text: string }): string {
  if (status.status === 'synced') return 'Last request confirmed';
  if (status.status === 'syncing') return 'Request in progress';
  if (status.status === 'error') return 'Last request failed';
  if (/secret/i.test(status.text)) return 'Setup required';
  return 'Not checked';
}

export function getPortfolioSyncLabel(status: { status: string; text: string }): string {
  if (status.status === 'synced') return 'Synced';
  if (status.status === 'syncing') return 'Syncing';
  if (status.status === 'conflict') return 'Conflict';
  if (status.status === 'error') return 'Failed';
  return 'No recent sync result';
}

export function getDeviceHealth(
  diagnostics: Pick<DeviceDiagnostics, 'online' | 'localStorageAvailable' | 'secureContext' | 'applicationApiStatus'> | null,
  cloudStatus: { status: string; text: string },
  cloudSyncStatus: { status: string; text: string }
): DeviceHealth {
  if (!diagnostics) return 'checking';
  if (
    !diagnostics.localStorageAvailable ||
    !diagnostics.secureContext ||
    diagnostics.applicationApiStatus === 'unavailable' ||
    cloudStatus.status === 'error' ||
    cloudSyncStatus.status === 'error' ||
    cloudSyncStatus.status === 'conflict'
  ) {
    return 'attention';
  }
  return diagnostics.online ? 'ready' : 'offline';
}

function readLocalStorage(): boolean {
  try {
    return checkLocalStorageAvailability(window.localStorage);
  } catch {
    return false;
  }
}

async function readServiceWorkerState(): Promise<ServiceWorkerState> {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (navigator.serviceWorker.controller || registration?.active) return 'active';
    if (registration?.installing || registration?.waiting) return 'registered';
    return 'not_registered';
  } catch {
    return 'error';
  }
}


/** Require one Workbox precache to include this app's document, entry JS and CSS. */
export function hasCompleteAppShellPrecache(
  cacheEntries: Array<{ name: string; urls: string[] }>,
  scopeUrl: string
): boolean {
  try {
    const scope = new URL(scopeUrl);
    const scopePath = scope.pathname.endsWith('/') ? scope.pathname : scope.pathname + '/';

    return cacheEntries.some(({ name, urls }) => {
      if (!name.startsWith('workbox-precache-')) return false;
      const paths = urls.map((url) => new URL(url, scopeUrl).pathname);
      const hasDocument = paths.some((path) =>
        path === scopePath || path === scopePath + 'index.html'
      );
      const hasEntryScript = paths.some((path) =>
        path.startsWith(scopePath + 'assets/') && /\/index-[\w-]+\.js$/.test(path)
      );
      const hasStylesheet = paths.some((path) =>
        path.startsWith(scopePath + 'assets/') && path.endsWith('.css')
      );
      return hasDocument && hasEntryScript && hasStylesheet;
    });
  } catch {
    return false;
  }
}

async function readAppShellCacheState(): Promise<AppShellCacheState> {
  if (!('serviceWorker' in navigator) || !('caches' in window)) return 'unsupported';
  try {
    const registration = await navigator.serviceWorker.getRegistration('/portfolio-terminal/');
    if (!registration) return 'not_registered';

    const cacheNames = await window.caches.keys();
    const appCacheNames = cacheNames.filter((name) => name.startsWith('workbox-precache-'));
    if (appCacheNames.length === 0) return 'incomplete';

    const cacheEntries: Array<{ name: string; urls: string[] }> = [];
    for (const name of appCacheNames) {
      const cache = await window.caches.open(name);
      const requests = await cache.keys();
      cacheEntries.push({ name, urls: requests.map((request) => request.url) });
    }

    return hasCompleteAppShellPrecache(cacheEntries, registration.scope)
      ? 'available'
      : 'incomplete';
  } catch {
    return 'error';
  }
}

async function checkApplicationApi(): Promise<DeviceDiagnostics['applicationApiStatus']> {
  try {
    // This public status endpoint proves Worker/auth-service reachability only;
    // it does not fetch portfolio data or prove that an authenticated cloud sync succeeded.
    await getAuthStatus();
    return 'reachable';
  } catch {
    return 'unavailable';
  }
}

async function collectDeviceDiagnostics(): Promise<DeviceDiagnostics> {
  const applicationApiStatus = await checkApplicationApi();
  const userAgent = navigator.userAgent || '';
  const screenWidth = window.screen?.width || 0;
  const screenHeight = window.screen?.height || 0;
  const viewportWidth = window.innerWidth || 0;
  const viewportHeight = window.innerHeight || 0;
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  return {
    applicationApiStatus,
    browser: getBrowserLabel(userAgent),
    operatingSystem: getOperatingSystemLabel(userAgent, navigator.platform || '', navigator.maxTouchPoints || 0),
    deviceType: getDeviceTypeLabel(userAgent),
    screen: screenWidth > 0 && screenHeight > 0 ? screenWidth + ' × ' + screenHeight : 'Unknown',
    viewport: viewportWidth > 0 && viewportHeight > 0 ? viewportWidth + ' × ' + viewportHeight : 'Unknown',
    pixelRatio: String(window.devicePixelRatio || 1) + '×',
    language: navigator.language || 'Unknown',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown',
    online: navigator.onLine,
    localStorageAvailable: readLocalStorage(),
    secureContext: window.isSecureContext === true,
    standalone,
    serviceWorker: await readServiceWorkerState(),
    appShellCache: await readAppShellCacheState(),
    checkedAt: Date.now()
  };
}

const DEVICE_CHECK_RU: Record<string, string> = {
  'Device Check': 'Проверка устройства',
  'A quick health check of this browser and app environment.': 'Краткая проверка состояния браузера и среды приложения.',
  'Local environment ready': 'Локальная среда готова',
  'Ready': 'Готово',
  'Offline': 'Нет сети',
  'Needs attention': 'Требует внимания',
  'Checking…': 'Проверка…',
  'Run check': 'Проверить',
  'Browser': 'Браузер',
  'Operating system': 'Операционная система',
  'Device type': 'Тип устройства',
  'Screen': 'Экран',
  'Viewport': 'Область просмотра',
  'Pixel ratio': 'Масштаб пикселей',
  'Language': 'Язык',
  'Time zone': 'Часовой пояс',
  'Network': 'Сеть',
  'Online (browser-reported)': 'В сети (по данным браузера)',
  'Local storage': 'Локальное хранилище',
  'Available': 'Доступно',
  'Unavailable': 'Недоступно',
  'Secure context': 'Защищённый контекст',
  'Secure': 'Защищён',
  'Not secure': 'Не защищён',
  'Service worker': 'Service worker',
  'Active': 'Активен',
  'Registered, not active': 'Зарегистрирован, не активен',
  'Not registered': 'Не зарегистрирован',
  'Unsupported': 'Не поддерживается',
  'Error': 'Ошибка',
  'Application API': 'API приложения',
  'Reachable': 'Доступен',
  'Cloud request': 'Облачный запрос',
  'Last request confirmed': 'Последний запрос подтверждён',
  'Last request failed': 'Последний запрос завершился ошибкой',
  'Request in progress': 'Выполняется запрос',
  'Cloud portfolio': 'Облачный портфель',
  'Portfolio sync': 'Синхронизация портфеля',
  'Conflict': 'Конфликт',
  'Connecting': 'Подключение',
  'Setup required': 'Требуется настройка',
  'Not checked': 'Не проверено',
  'Synced': 'Синхронизировано',
  'Syncing': 'Синхронизация',
  'Failed': 'Ошибка',
  'No recent sync result': 'Нет недавнего результата синхронизации',
  'Browser-reported network state does not confirm that the API or cloud service is reachable.': 'Состояние сети по данным браузера не подтверждает доступность API или облачного сервиса.',
  'The storage check writes and removes a temporary test value; no portfolio data is changed.': 'Проверка хранилища записывает и удаляет временное тестовое значение; данные портфеля не изменяются.',
  'Browser and device details are inferred from browser-provided information and may be approximate.': 'Сведения о браузере и устройстве определяются по данным браузера и могут быть приблизительными.',
  'An active service worker does not guarantee that every page or data source works offline.': 'Активный Service Worker не гарантирует, что все страницы и источники данных доступны без сети.',
  'Device diagnostics stay in this browser and are not uploaded as a device identifier.': 'Диагностика остаётся в этом браузере и не отправляется в виде идентификатора устройства.',
  'Installed app mode': 'Режим установленного приложения',
  'App shell cache': 'Кэш оболочки приложения',
  'Cached app shell available': 'Оболочка приложения сохранена в кэше',
  'App shell cache incomplete': 'Кэш оболочки приложения неполный',
  'Service worker not registered': 'Service worker не зарегистрирован',
  'Installed': 'Установлено',
  'Browser tab': 'Вкладка браузера',
  'Last checked': 'Последняя проверка',
  'Unknown': 'Неизвестно',
  'Microsoft Edge': 'Microsoft Edge',
  'Firefox': 'Firefox',
  'Chrome': 'Chrome',
  'Safari': 'Safari',
  'Opera': 'Opera',
  'Samsung Internet': 'Samsung Internet',
  'Unknown browser': 'Неизвестный браузер',
  'Android': 'Android',
  'iOS / iPadOS': 'iOS / iPadOS',
  'Windows': 'Windows',
  'ChromeOS': 'ChromeOS',
  'macOS': 'macOS',
  'Linux': 'Linux',
  'Desktop': 'Компьютер',
  'Mobile': 'Мобильное устройство',
  'Tablet': 'Планшет'
};

function label(value: string): string {
  return getAppLanguage() === 'ru'
    ? DEVICE_CHECK_RU[value] || translateText(value, 'ru')
    : value;
}

function formatCheckedAt(value: number | null): string {
  if (value === null) return label('Unknown');
  return new Intl.DateTimeFormat(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function healthTone(health: DeviceHealth): string {
  if (health === 'ready') return 'border-emerald-800/70 bg-emerald-950/25 text-emerald-300';
  if (health === 'offline') return 'border-amber-800/70 bg-amber-950/20 text-amber-200';
  if (health === 'checking') return 'border-slate-700 bg-slate-900 text-slate-300';
  return 'border-rose-800/70 bg-rose-950/20 text-rose-200';
}

function diagnosticTone(value: string): string {
  if (['Available', 'Secure', 'Active', 'Synced', 'Reachable', 'Last request confirmed', 'Online (browser-reported)', 'Installed', 'Cached app shell available'].includes(value)) {
    return 'text-emerald-300';
  }
  if (['Unavailable', 'Not secure', 'Error', 'Failed', 'Last request failed'].includes(value)) return 'text-rose-300';
  if (value === 'Conflict') return 'text-amber-200';
  if (['Offline', 'Setup required', 'Not checked', 'No recent sync result', 'Request in progress', 'Not registered', 'Registered, not active', 'App shell cache incomplete', 'Service worker not registered'].includes(value)) {
    return 'text-amber-200';
  }
  return 'text-slate-200';
}

function appShellCacheLabel(value: AppShellCacheState): string {
  if (value === 'available') return 'Cached app shell available';
  if (value === 'incomplete') return 'App shell cache incomplete';
  if (value === 'not_registered') return 'Service worker not registered';
  if (value === 'unsupported') return 'Unsupported';
  return 'Error';
}

function serviceWorkerLabel(value: ServiceWorkerState): string {
  if (value === 'active') return 'Active';
  if (value === 'registered') return 'Registered, not active';
  if (value === 'not_registered') return 'Not registered';
  if (value === 'unsupported') return 'Unsupported';
  return 'Error';
}

function diagnosticOperationLabel(operation: CloudSyncDiagnostic['operation']): string {
  if (operation === 'pull') return 'Cloud pull';
  if (operation === 'push') return 'Cloud write';
  return 'Background reconciliation';
}

function diagnosticOutcomeLabel(outcome: CloudSyncDiagnostic['outcome']): string {
  if (outcome === 'success') return 'Succeeded';
  if (outcome === 'conflict') return 'Conflict';
  return 'Failed';
}

const DIAGNOSTIC_REASON_LABELS: Record<CloudSyncDiagnosticReason, string> = {
  confirmed: 'Cloud operation was confirmed.',
  'auto-reconciled': 'Independent changes were reconciled automatically.',
  'missing-credentials': 'The cloud request could not start because the session credential is unavailable.',
  'remote-record-missing': 'The cloud record is missing even though this device previously accepted a populated revision.',
  'revision-conflict': 'The server rejected a stale revision because a newer cloud snapshot exists.',
  'overlapping-edits': 'This device and the cloud both changed protected portfolio data differently.',
  'transaction-history-conflict': 'The transaction journal contains conflicting event identity or history data.',
  'http-unauthorized': 'The cloud service rejected the session as unauthenticated.',
  'http-forbidden': 'The current account is not authorized for this cloud operation.',
  'http-server-error': 'The application server returned an error while handling the cloud request.',
  'http-error': 'The application server rejected the cloud request.',
  timeout: 'The cloud request timed out before a complete response was received.',
  network: 'The browser could not complete the request to the cloud service.',
  'decryption-failed': 'The encrypted cloud snapshot could not be decrypted or authenticated.',
  'invalid-payload': 'The cloud response failed payload validation.',
  'local-storage-failed': 'The local browser store could not commit the accepted cloud snapshot.',
  'local-apply-rejected': 'The portfolio store rejected the cloud snapshot; local data was retained.',
  'no-accepted-baseline': 'No accepted in-memory merge baseline was available for safe background recovery.',
  'latest-revision-unavailable': 'The latest cloud revision could not be confirmed for a conditional retry.',
  'legacy-history-requires-migration': 'The cloud snapshot contains legacy history that requires the normal migration flow.',
  'local-edits-changed-during-merge': 'Local data changed while a background merge was being prepared; the merge was cancelled.',
  'conditional-retry-failed': 'The conditional cloud write lost another revision race or was rejected.',
  unknown: 'The cloud operation failed for an unclassified reason.'
};

function diagnosticReasonLabel(reason: CloudSyncDiagnosticReason): string {
  return label(DIAGNOSTIC_REASON_LABELS[reason]);
}

export function DeviceCheckSummary() {
  const cloudStatus = useCloudStatus();
  const cloudSyncStatus = useCloudSyncStatus();
  const [cloudSyncDiagnostics, setCloudSyncDiagnostics] = useState<CloudSyncDiagnostic[]>(() => getCloudSyncDiagnostics());
  const [diagnostics, setDiagnostics] = useState<DeviceDiagnostics | null>(null);
  const [checking, setChecking] = useState(false);

  const runCheck = async () => {
    setChecking(true);
    try {
      setDiagnostics(await collectDeviceDiagnostics());
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => subscribeCloudSyncDiagnostics(setCloudSyncDiagnostics), []);

  useEffect(() => {
    void runCheck();
    const updateNetwork = () => setDiagnostics(current => current
      ? { ...current, online: navigator.onLine }
      : current);
    const updateDisplay = () => setDiagnostics(current => current
      ? {
          ...current,
          screen: window.screen?.width && window.screen?.height
            ? window.screen.width + ' × ' + window.screen.height
            : 'Unknown',
          viewport: window.innerWidth + ' × ' + window.innerHeight,
          pixelRatio: String(window.devicePixelRatio || 1) + '×'
        }
      : current);
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    window.addEventListener('resize', updateDisplay);
    const updateServiceWorker = () => { void runCheck(); };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', updateServiceWorker);
    }
    return () => {
      window.removeEventListener('online', updateNetwork);
      window.removeEventListener('offline', updateNetwork);
      window.removeEventListener('resize', updateDisplay);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('controllerchange', updateServiceWorker);
      }
    };
  }, []);

  const health = getDeviceHealth(diagnostics, cloudStatus, cloudSyncStatus);

  const primaryRows: Array<[string, string]> = diagnostics ? [
    ['Network', diagnostics.online ? 'Online (browser-reported)' : 'Offline'],
    ['Local storage', diagnostics.localStorageAvailable ? 'Available' : 'Unavailable'],
    ['Application API', getApplicationApiLabel(diagnostics.applicationApiStatus)],
    ['Cloud request', getCloudRequestLabel(cloudStatus)],
    ['Cloud portfolio', getPortfolioSyncLabel(cloudSyncStatus)]
  ] : [];

  const technicalRows: Array<[string, string]> = diagnostics ? [
    ['Browser', diagnostics.browser],
    ['Operating system', diagnostics.operatingSystem],
    ['Device type', diagnostics.deviceType],
    ['Screen', diagnostics.screen],
    ['Viewport', diagnostics.viewport],
    ['Pixel ratio', diagnostics.pixelRatio],
    ['Language', diagnostics.language],
    ['Time zone', diagnostics.timeZone],
    ['Secure context', diagnostics.secureContext ? 'Secure' : 'Not secure'],
    ['Service worker', serviceWorkerLabel(diagnostics.serviceWorker)],
    ['App shell cache', appShellCacheLabel(diagnostics.appShellCache)],
    ['Installed app mode', diagnostics.standalone ? 'Installed' : 'Browser tab']
  ] : [];

  return (
    <section class="settings-panel space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3" aria-labelledby="deviceCheckTitle">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="deviceCheckTitle" class="text-sm font-bold text-slate-200">{label('Device Check')}</h3>
          <p class="text-[10px] text-slate-500">{label('A quick health check of this browser and app environment.')}</p>
        </div>
        <div class="flex items-center gap-2">
          <span class={'rounded-full border px-2.5 py-1 text-[10px] font-semibold ' + healthTone(health)} role="status">
            {label(health === 'ready' ? 'Environment ready' : health === 'offline' ? 'Offline' : health === 'checking' ? 'Checking…' : 'Needs attention')}
          </span>
          <button type="button" onClick={() => void runCheck()} disabled={checking} class="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[10px] font-bold text-cyan-300 disabled:opacity-50">
            {label(checking ? 'Checking…' : 'Run check')}
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {primaryRows.map(([name, value]) => (
          <div key={name} class="flex min-w-0 items-start justify-between gap-2 rounded-lg bg-slate-900/70 px-3 py-2">
            <span class="text-[10px] text-slate-500">{label(name)}</span>
            <span class={'min-w-0 text-right text-[11px] font-semibold ' + diagnosticTone(value)}>{label(value)}</span>
          </div>
        ))}
        {!diagnostics && <p class="col-span-full text-xs text-slate-400" role="status">{label('Checking…')}</p>}
      </div>

      <details class="settings-device-details">
        <summary>{label('Cloud synchronization diagnostics')}</summary>
        <div class="space-y-2 pt-3">
          {cloudSyncDiagnostics.length === 0
            ? <p class="text-[11px] leading-5 text-slate-400">{label('No cloud synchronization attempts have been recorded in this tab session.')}</p>
            : cloudSyncDiagnostics.slice(0, 3).map((entry) => (
                <div key={entry.timestamp + '-' + entry.operation + '-' + entry.reason}
                  class="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <span class="text-[11px] font-semibold text-slate-200">{label(diagnosticOperationLabel(entry.operation))} · {label(diagnosticOutcomeLabel(entry.outcome))}</span>
                    <time class="text-[10px] text-slate-500">{formatCheckedAt(entry.timestamp)}</time>
                  </div>
                  <p class="mt-1 text-[11px] leading-5 text-slate-300">{diagnosticReasonLabel(entry.reason)}</p>
                  {(entry.httpStatus !== undefined || entry.expectedRevision !== undefined || entry.observedRevision !== undefined) && (
                    <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-800 pt-2 text-[10px] text-slate-500">
                      {entry.httpStatus !== undefined && <span>{label('HTTP status')}: {entry.httpStatus}</span>}
                      {entry.expectedRevision !== undefined && <span>{label('Expected revision')}: {entry.expectedRevision}</span>}
                      {entry.observedRevision !== undefined && <span>{label('Observed revision')}: {entry.observedRevision}</span>}
                    </div>
                  )}
                </div>
              ))}
        </div>
        <p class="mt-3 border-t border-slate-800 pt-2 text-[10px] leading-4 text-slate-500">
          {label('Diagnostics are kept only in this browser tab session and contain status metadata, not portfolio data, credentials, or encrypted payloads.')}
        </p>
      </details>

      <details class="settings-device-details">
        <summary>{label('Technical details')}</summary>
        <div class="grid grid-cols-1 gap-2 pt-3 sm:grid-cols-2 lg:grid-cols-3">
          {technicalRows.map(([name, value]) => (
            <div key={name} class="flex min-w-0 items-start justify-between gap-2 rounded-lg bg-slate-900/70 px-3 py-2">
              <span class="text-[10px] text-slate-500">{label(name)}</span>
              <span class={'min-w-0 text-right text-[11px] font-semibold ' + diagnosticTone(value)}>{label(value)}</span>
            </div>
          ))}
        </div>
        <div class="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2 mt-3">
          <p class="max-w-3xl text-[10px] leading-4 text-slate-500">
            {label('Browser-reported network state does not confirm that the API or cloud service is reachable.')}
            {' '}
            {label('Application API reachability checks the public status endpoint only; it does not confirm authenticated portfolio synchronization.')}
            {' '}
            {label('The storage check writes and removes a temporary test value; no portfolio data is changed.')}
            {' '}{label('Browser and device details are inferred from browser-provided information and may be approximate.')}
            {' '}{label('An active service worker does not guarantee that every page or data source works offline.')}
            {' '}{label('Device diagnostics stay in this browser and are not uploaded as a device identifier.')}
          </p>
          <span class="shrink-0 text-[10px] text-slate-500">
            {label('Last checked')}: {formatCheckedAt(diagnostics?.checkedAt ?? null)}
          </span>
        </div>
      </details>
    </section>
  );
}
