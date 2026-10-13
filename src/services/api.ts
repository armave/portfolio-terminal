import CryptoJS from 'crypto-js';
import { processRollovers } from '../domain/portfolio';
import { getGatewaySecret, loadSavedState, saveState } from './storage';
import { PortfolioState } from '../types/portfolio';

export const YAHOO_PROXY_URL = 'https://trading-proxy.armenavetisyan-sa.workers.dev';
export { processRollovers };

export function setSecretGetter(_getter: () => string): void { }

export function getActiveGatewaySecret(state?: Record<string, any> | PortfolioState): string {
  if (state && 'gatewaySecret' in state && (state as any).gatewaySecret) {
    return (state as any).gatewaySecret;
  }
  const stored = getGatewaySecret();
  if (stored) return stored;
  if (typeof document !== 'undefined') {
    const input =
      (document.getElementById('headerGatewaySecretInput') as HTMLInputElement | null) ||
      (document.getElementById('gatewaySecretInput') as HTMLInputElement | null);
    if (input?.value?.trim()) return input.value.trim();
  }
  return '';
}

export interface ProxyFetchOptions extends RequestInit {
  secret?: string;
  state?: Record<string, any> | PortfolioState;
}

export async function proxyFetch(
  action = '',
  queryParams: Record<string, string | number | boolean | undefined | null> = {},
  fetchOptions: ProxyFetchOptions = {}
): Promise<any> {
  const url = new URL(YAHOO_PROXY_URL);
  if (action) {
    if (action.startsWith('/')) {
      url.pathname = action;
    } else {
      url.searchParams.append('action', action);
    }
  }
  Object.entries(queryParams).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.append(k, String(v));
    }
  });

  const authSecret = fetchOptions.secret || getActiveGatewaySecret(fetchOptions.state);

  const res = await fetch(url.toString(), {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      'X-App-Auth': authSecret,
      Authorization: `Bearer ${authSecret}`,
      ...(fetchOptions.headers || {})
    }
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    throw new Error(data.error || data.message || `HTTP ${res.status}`);
  }
  return data;
}

export async function fetchYahooStockData(ticker: string): Promise<any> {
  if (!ticker) return null;
  const cleanTicker = ticker.trim().toUpperCase();

  try {
    return await proxyFetch('', { symbol: cleanTicker });
  } catch (err: any) {
    console.warn(`[Yahoo Data Error for ${cleanTicker}]:`, err?.message || err);
    return null;
  }
}

export interface SyncOptions {
  state?: any;
  secret?: string;
  pullCloudAndRewriteLocal?: (state: any) => void;
  getState?: () => any;
  showToast?: (msg: string, type: string) => void;
  logTerminal?: (msg: string) => void;
}

export async function pullCloudState(options: SyncOptions | ((state: any) => void) = {}): Promise<any> {
  const handlers: SyncOptions = typeof options === 'function' ? { pullCloudAndRewriteLocal: options } : options;
  const {
    state,
    pullCloudAndRewriteLocal,
    showToast = (msg: string, type: string) =>
      typeof window !== 'undefined' && typeof (window as any).showToast === 'function'
        ? (window as any).showToast(msg, type)
        : console.log(msg),
    logTerminal = (msg: string) =>
      typeof window !== 'undefined' && typeof (window as any).logTerminal === 'function'
        ? (window as any).logTerminal(msg)
        : console.log(msg)
  } = handlers;

  const currentSecret = handlers.secret || getActiveGatewaySecret(state);

  if (!currentSecret) {
    showToast('Gateway Secret required to access cloud state.', 'error');
    return loadSavedState(state || {});
  }

  // showToast('Pulling portfolio from KV cloud...', 'info');

  try {
    const url = new URL('/api/state', YAHOO_PROXY_URL);
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Auth': currentSecret,
        Authorization: `Bearer ${currentSecret}`
      }
    });

    if (res.status === 404) {
      showToast('No KV cloud state found. Retaining local state.', 'info');
      logTerminal('[KV Cloud]: State not found (404). Falling back to local storage.');
      return loadSavedState(state || {});
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid state payload from KV.');
    }

    let parsedState: any;
    if (typeof data.encryptedPayload === 'string') {
      try {
        const bytes = CryptoJS.AES.decrypt(data.encryptedPayload, currentSecret);
        const decryptedStr = bytes ? bytes.toString(CryptoJS.enc.Utf8) : '';
        if (!decryptedStr) {
          console.error('[Sync]: Decryption failed — verify Gateway Secret matches the encryption key.');
          throw new Error('Decryption failed — verify Gateway Secret matches the encryption key.');
        }
        try {
          parsedState = JSON.parse(decryptedStr);
        } catch (parseErr: any) {
          console.error('[Sync]: Decryption failed — verify Gateway Secret matches the encryption key.');
          throw new Error(`Invalid JSON in decrypted state: ${parseErr.message}`);
        }
      } catch (decryptErr: any) {
        console.error('[Sync]: Decryption failed — verify Gateway Secret matches the encryption key.');
        throw new Error(`Failed to decrypt cloud state: ${decryptErr.message}`);
      }
    } else {
      parsedState = data;
      pushCloudState(parsedState, { ...handlers, secret: currentSecret }).catch((err) => {
        console.warn('Background encryption upgrade failed:', err);
      });
    }

    if (!parsedState || typeof parsedState !== 'object') {
      throw new Error('Invalid state payload from KV.');
    }

    if ('marginBalance' in parsedState) {
      delete parsedState.marginBalance;
    }

    if (!parsedState.lastRolloverTimestamp) {
      parsedState.lastRolloverTimestamp = Date.now();
    }

    const wasUpdated = processRollovers(parsedState);
    if (wasUpdated) {
      saveState(parsedState);
      pushCloudState(parsedState, { ...handlers, secret: currentSecret, showToast: () => { } }).catch((err) => {
        console.warn('Background rollover sync failed:', err);
      });
    }

    saveState(parsedState);
    if (typeof pullCloudAndRewriteLocal === 'function') {
      pullCloudAndRewriteLocal(parsedState);
    } else if (typeof window !== 'undefined' && typeof (window as any).renderBoard === 'function') {
      (window as any).renderBoard();
    }

    console.log('[Sync]: Cloud state ingested and UI re-rendered successfully', parsedState);
    // showToast('KV cloud state pulled.', 'success');
    logTerminal('[KV Cloud]: Synced successfully.');
    return parsedState;
  } catch (err: any) {
    console.error('Failed to pull KV cloud state:', err);
    showToast(`Cloud pull failed: ${err.message}`, 'error');
    logTerminal(`[KV Cloud Error]: ${err.message}. Retaining local state.`);
    return loadSavedState(state || {});
  }
}

export async function pushCloudState(state?: any, options: SyncOptions = {}): Promise<boolean> {
  const handlers: SyncOptions = typeof options === 'function' ? {} : options;
  const {
    getState,
    showToast = (msg: string, type: string) =>
      typeof window !== 'undefined' && typeof (window as any).showToast === 'function'
        ? (window as any).showToast(msg, type)
        : console.log(msg)
  } = handlers;

  const currentState = state || (typeof getState === 'function' ? getState() : {});
  const currentSecret = handlers.secret || getActiveGatewaySecret(currentState);

  if (!currentSecret) {
    showToast('Gateway Secret required to access cloud state.', 'error');
    return false;
  }

  try {
    delete currentState.gatewaySecret;
    if ('marginBalance' in currentState) {
      delete currentState.marginBalance;
    }
    const { gatewaySecret: _secret, ...stateToEncrypt } = currentState;
    if ('marginBalance' in stateToEncrypt) {
      delete stateToEncrypt.marginBalance;
    }
    const ciphertext = CryptoJS.AES.encrypt(JSON.stringify(stateToEncrypt), currentSecret).toString();
    const payload = { encryptedPayload: ciphertext };

    const url = new URL('/api/state', YAHOO_PROXY_URL);
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Auth': currentSecret,
        Authorization: `Bearer ${currentSecret}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }

    const syncEl = typeof document !== 'undefined' ? document.getElementById('cloudSyncStatus') : null;
    if (syncEl) {
      syncEl.textContent = `Synced: ${new Date().toLocaleTimeString()}`;
      syncEl.className = 'text-[10px] text-emerald-400 font-mono';
    }
    return true;
  } catch (err: any) {
    console.error('Failed to push to KV cloud:', err);
    const syncEl = typeof document !== 'undefined' ? document.getElementById('cloudSyncStatus') : null;
    if (syncEl) {
      syncEl.textContent = 'Sync failed';
      syncEl.className = 'text-[10px] text-rose-400 font-mono';
    }
    showToast(`Cloud push failed: ${err.message}`, 'error');
    return false;
  }
}

export async function syncCloudState(mode = 'push', options: SyncOptions = {}): Promise<boolean> {
  const handlers = typeof options === 'function' ? { pullCloudAndRewriteLocal: options } : options;
  if (mode === 'push') {
    const currentState = (handlers as any).state || (typeof (handlers as any).getState === 'function' ? (handlers as any).getState() : {});
    return pushCloudState(currentState, handlers);
  }
  if (mode === 'pull') {
    const result = await pullCloudState(handlers);
    return Boolean(result);
  }
  return false;
}