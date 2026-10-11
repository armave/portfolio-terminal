import { getGatewaySecret, saveStateToStorage } from './storage.js';

export const YAHOO_PROXY_URL = 'https://trading-proxy.armenavetisyan-sa.workers.dev';

let secretGetter = null;

export function setSecretGetter(getter) {
  secretGetter = getter;
}

export function getActiveGatewaySecret(state) {
  if (state?.gatewaySecret) return state.gatewaySecret;
  if (typeof secretGetter === 'function') {
    const fromGetter = secretGetter();
    if (fromGetter) return fromGetter;
  }
  return getGatewaySecret();
}

export async function proxyFetch(action = '', queryParams = {}, fetchOptions = {}) {
  const url = new URL(YAHOO_PROXY_URL);
  if (action) url.searchParams.append('action', action);
  Object.entries(queryParams).forEach(([k, v]) => {
    if (v) url.searchParams.append(k, v);
  });

  const authSecret = fetchOptions.secret || getActiveGatewaySecret(fetchOptions.state);

  const res = await fetch(url.toString(), {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      'X-App-Auth': authSecret,
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

export async function fetchYahooStockData(ticker) {
  if (!ticker) return null;
  const cleanTicker = ticker.trim().toUpperCase();

  try {
    return await proxyFetch('', { symbol: cleanTicker });
  } catch (err) {
    console.warn(`[Yahoo Data Error for ${cleanTicker}]:`, err.message);
    return null;
  }
}

export async function syncCloudState(mode = 'push', options = {}) {
  const handlers = typeof options === 'function' ? { pullCloudAndRewriteLocal: options } : options;
  const {
    state,
    getState,
    pullCloudAndRewriteLocal,
    showToast = (msg, type) => (typeof window !== 'undefined' && typeof window.showToast === 'function' ? window.showToast(msg, type) : console.log(msg)),
    logTerminal = (msg) => (typeof window !== 'undefined' && typeof window.logTerminal === 'function' ? window.logTerminal(msg) : console.log(msg))
  } = handlers;

  const secret = getActiveGatewaySecret(state);

  if (!secret) {
    if (mode === 'pull') showToast('Gateway Secret required to access cloud state.', 'error');
    return false;
  }

  if (mode === 'push') {
    try {
      const currentState = typeof getState === 'function' ? getState() : (state || {});
      await proxyFetch('gist', {}, {
        method: 'POST',
        body: JSON.stringify({
          description: 'Portfolio State Update',
          files: { 'portfolio-state.json': { content: JSON.stringify(currentState, null, 2) } }
        })
      });

      const syncEl = typeof document !== 'undefined' ? document.getElementById('cloudSyncStatus') : null;
      if (syncEl) {
        syncEl.textContent = `Synced: ${new Date().toLocaleTimeString()}`;
        syncEl.className = 'text-[10px] text-emerald-400 font-mono';
      }
      return true;
    } catch (err) {
      console.error('Failed to sync to cloud:', err);
      const syncEl = typeof document !== 'undefined' ? document.getElementById('cloudSyncStatus') : null;
      if (syncEl) {
        syncEl.textContent = 'Sync failed';
        syncEl.className = 'text-[10px] text-rose-400 font-mono';
      }
      return false;
    }
  }

  if (mode === 'pull') {
    showToast('Pulling portfolio from cloud...', 'info');

    try {
      const data = await proxyFetch('gist');

      const marginFile = data.files?.['margin_state.json'];
      const portfolioFile = data.files?.['portfolio-state.json'];
      const fileToProcess = marginFile || portfolioFile || Object.values(data.files || {})[0];

      if (!fileToProcess || !fileToProcess.content) {
        throw new Error('Gist state payload was empty or missing content.');
      }
      if (fileToProcess.content === "[object Promise]") {
        throw new Error('Gist data is corrupted. Please manually fix the Gist in GitHub.');
      }

      let parsedState;
      try {
        parsedState = JSON.parse(fileToProcess.content);
      } catch (parseError) {
        throw new Error('Gist state payload is not valid JSON.');
      }

      if (parsedState && parsedState.payload && typeof parsedState.payload === 'string') {
        try {
          parsedState = JSON.parse(atob(parsedState.payload));
        } catch (e) {
          console.warn("Failed to decode base64 payload", e);
        }
      }

      saveStateToStorage(parsedState);
      if (typeof pullCloudAndRewriteLocal === 'function') {
        pullCloudAndRewriteLocal(parsedState);
      }

      showToast('Cloud state pulled.', 'success');
      logTerminal(`[Cloud]: Synced successfully.`);
      return true;
    } catch (err) {
      console.error('Failed to pull cloud state:', err);
      showToast(`Cloud pull failed: ${err.message}`, 'error');
      return false;
    }
  }
}
