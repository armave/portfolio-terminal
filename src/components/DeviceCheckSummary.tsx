import { useEffect, useState } from 'preact/hooks';
import { getAppLanguage, translateText } from '../services/i18n';
import { useCloudStatus, useCloudSyncStatus } from '../ui/uiStateStore';

type ServiceWorkerState = 'active' | 'registered' | 'not_registered' | 'unsupported' | 'error';
type DeviceHealth = 'ready' | 'offline' | 'attention';

export interface DeviceDiagnostics {
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
  if (/iPad|Tablet/i.test(userAgent)) return 'Tablet';
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

export function getCloudStorageLabel(status: { status: string; text: string }): string {
  if (status.status === 'synced') return 'Connected';
  if (status.status === 'syncing') return 'Connecting';
  if (status.status === 'error') return 'Unavailable';
  if (/secret/i.test(status.text)) return 'Setup required';
  return 'Not checked';
}

export function getPortfolioSyncLabel(status: { status: string; text: string }): string {
  if (status.status === 'synced') return 'Synced';
  if (status.status === 'syncing') return 'Syncing';
  if (status.status === 'error') return 'Failed';
  return 'No recent sync result';
}

export function getDeviceHealth(
  diagnostics: Pick<DeviceDiagnostics, 'online' | 'localStorageAvailable' | 'secureContext'> | null,
  cloudSyncStatus: { status: string; text: string }
): DeviceHealth {
  if (!diagnostics) return 'attention';
  if (!diagnostics.localStorageAvailable || !diagnostics.secureContext || cloudSyncStatus.status === 'error') {
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

async function collectDeviceDiagnostics(): Promise<DeviceDiagnostics> {
  const userAgent = navigator.userAgent || '';
  const screenWidth = window.screen?.width || 0;
  const screenHeight = window.screen?.height || 0;
  const viewportWidth = window.innerWidth || 0;
  const viewportHeight = window.innerHeight || 0;
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  return {
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
    checkedAt: Date.now()
  };
}

const DEVICE_CHECK_RU: Record<string, string> = {
  'Device Check': 'Проверка устройства',
  'A quick health check of this browser and app environment.': 'Краткая проверка состояния браузера и среды приложения.',
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
  'PWA / offline support': 'PWA / офлайн-поддержка',
  'Active': 'Активен',
  'Registered, not active': 'Зарегистрирован, не активен',
  'Not registered': 'Не зарегистрирован',
  'Unsupported': 'Не поддерживается',
  'Error': 'Ошибка',
  'Cloud storage': 'Облачное хранилище',
  'Connected': 'Подключено',
  'Connecting': 'Подключение',
  'Setup required': 'Требуется настройка',
  'Not checked': 'Не проверено',
  'Portfolio sync': 'Синхронизация портфеля',
  'Synced': 'Синхронизировано',
  'Syncing': 'Синхронизация',
  'Failed': 'Ошибка',
  'No recent sync result': 'Нет недавнего результата синхронизации',
  'Browser-reported network state does not confirm that the API or cloud service is reachable.': 'Состояние сети по данным браузера не подтверждает доступность API или облачного сервиса.',
  'The storage check writes and removes a temporary test value; no portfolio data is changed.': 'Проверка хранилища записывает и удаляет временное тестовое значение; данные портфеля не изменяются.',
  'Installed app mode': 'Режим установленного приложения',
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
  return 'border-rose-800/70 bg-rose-950/20 text-rose-200';
}

function diagnosticTone(value: string): string {
  if (['Available', 'Secure', 'Active', 'Connected', 'Synced', 'Online (browser-reported)', 'Installed'].includes(value)) {
    return 'text-emerald-300';
  }
  if (['Unavailable', 'Not secure', 'Error', 'Failed'].includes(value)) return 'text-rose-300';
  if (['Offline', 'Setup required', 'Not checked', 'No recent sync result', 'Not registered', 'Registered, not active'].includes(value)) {
    return 'text-amber-200';
  }
  return 'text-slate-200';
}

function serviceWorkerLabel(value: ServiceWorkerState): string {
  if (value === 'active') return 'Active';
  if (value === 'registered') return 'Registered, not active';
  if (value === 'not_registered') return 'Not registered';
  if (value === 'unsupported') return 'Unsupported';
  return 'Error';
}

export function DeviceCheckSummary() {
  const cloudStatus = useCloudStatus();
  const cloudSyncStatus = useCloudSyncStatus();
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
    navigator.serviceWorker?.addEventListener('controllerchange', () => { void runCheck(); });
    return () => {
      window.removeEventListener('online', updateNetwork);
      window.removeEventListener('offline', updateNetwork);
      window.removeEventListener('resize', updateDisplay);
    };
  }, []);

  const health = getDeviceHealth(diagnostics, cloudSyncStatus);

  const rows: Array<[string, string]> = diagnostics ? [
    ['Browser', diagnostics.browser],
    ['Operating system', diagnostics.operatingSystem],
    ['Device type', diagnostics.deviceType],
    ['Screen', diagnostics.screen],
    ['Viewport', diagnostics.viewport],
    ['Pixel ratio', diagnostics.pixelRatio],
    ['Language', diagnostics.language],
    ['Time zone', diagnostics.timeZone],
    ['Network', diagnostics.online ? 'Online (browser-reported)' : 'Offline'],
    ['Local storage', diagnostics.localStorageAvailable ? 'Available' : 'Unavailable'],
    ['Secure context', diagnostics.secureContext ? 'Secure' : 'Not secure'],
    ['PWA / offline support', serviceWorkerLabel(diagnostics.serviceWorker)],
    ['Installed app mode', diagnostics.standalone ? 'Installed' : 'Browser tab'],
    ['Cloud storage', getCloudStorageLabel(cloudStatus)],
    ['Portfolio sync', getPortfolioSyncLabel(cloudSyncStatus)]
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
            {label(health === 'ready' ? 'Ready' : health === 'offline' ? 'Offline' : 'Needs attention')}
          </span>
          <button type="button" onClick={() => void runCheck()} disabled={checking} class="rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[10px] font-bold text-cyan-300 disabled:opacity-50">
            {label(checking ? 'Checking…' : 'Run check')}
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(([name, value]) => (
          <div key={name} class="flex min-w-0 items-start justify-between gap-2 rounded-lg bg-slate-900/70 px-3 py-2">
            <span class="text-[10px] text-slate-500">{label(name)}</span>
            <span class={'min-w-0 break-words text-right text-[11px] font-semibold ' + diagnosticTone(value)}>{label(value)}</span>
          </div>
        ))}
        {!diagnostics && <p class="col-span-full text-xs text-slate-400" role="status">{label('Checking…')}</p>}
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2">
        <p class="max-w-3xl text-[10px] leading-4 text-slate-500">
          {label('Browser-reported network state does not confirm that the API or cloud service is reachable.')}
          {' '}
          {label('The storage check writes and removes a temporary test value; no portfolio data is changed.')}
        </p>
        <span class="shrink-0 text-[10px] text-slate-500">
          {label('Last checked')}: {formatCheckedAt(diagnostics?.checkedAt ?? null)}
        </span>
      </div>
    </section>
  );
}
