export const STATE_STORAGE_KEY = 'margin_portfolio_state_dynamic_v2';
export const LEGACY_STATE_STORAGE_KEY = 'portfolio_state';
export const GATEWAY_SECRET_KEY = 'gateway_secret';
export const GATEWAY_AUTH_KEY = '_gw_auth';
export const TRADERNET_RULES_STORAGE_KEY = 'tradernet_rules_v1';
export const QUOTE_REFRESH_INTERVAL_KEY = 'quote_refresh_interval_ms';

const STATIC_XOR_SALT = 'portfolio-salt';

export function obfuscateSecret(str) {
  if (!str || typeof str !== 'string') return '';
  try {
    let xored = '';
    for (let i = 0; i < str.length; i++) {
      xored += String.fromCharCode(str.charCodeAt(i) ^ STATIC_XOR_SALT.charCodeAt(i % STATIC_XOR_SALT.length));
    }
    return btoa(xored);
  } catch {
    return '';
  }
}

export function deobfuscateSecret(str) {
  if (!str || typeof str !== 'string') return '';
  try {
    const decoded = atob(str);
    let result = '';
    for (let i = 0; i < decoded.length; i++) {
      result += String.fromCharCode(decoded.charCodeAt(i) ^ STATIC_XOR_SALT.charCodeAt(i % STATIC_XOR_SALT.length));
    }
    return result;
  } catch {
    return '';
  }
}

export function saveGatewaySecret(secret) {
  if (typeof localStorage === 'undefined') return;
  const trimmed = (secret || '').trim();
  if (trimmed) {
    localStorage.setItem(GATEWAY_AUTH_KEY, obfuscateSecret(trimmed));
  } else {
    localStorage.removeItem(GATEWAY_AUTH_KEY);
  }
  localStorage.removeItem(GATEWAY_SECRET_KEY);
}

export function loadGatewaySecret() {
  if (typeof localStorage === 'undefined') return '';
  const stored = localStorage.getItem(GATEWAY_AUTH_KEY);
  if (stored) {
    const recovered = deobfuscateSecret(stored);
    if (recovered) return recovered;
  }
  const legacy = localStorage.getItem(GATEWAY_SECRET_KEY);
  if (legacy) {
    const trimmed = legacy.trim();
    if (trimmed) {
      saveGatewaySecret(trimmed);
      return trimmed;
    }
  }
  return '';
}

export function getGatewaySecret() {
  return loadGatewaySecret();
}

export function setGatewaySecret(secret) {
  saveGatewaySecret(secret);
}

export function areHeaderCredentialsConfigured() {
  return getGatewaySecret().length > 0;
}

export function getGistConfig() {
  if (typeof localStorage === 'undefined') return { gistId: '', token: '' };
  return {
    gistId: (localStorage.getItem('github_gist_id') || '').trim(),
    token: (localStorage.getItem('github_pat_token') || '').trim()
  };
}

export function setGistConfig({ gistId, token } = {}) {
  if (typeof localStorage === 'undefined') return;
  if (gistId !== undefined) {
    const trimmedId = (gistId || '').trim();
    if (trimmedId) localStorage.setItem('github_gist_id', trimmedId);
    else localStorage.removeItem('github_gist_id');
  }
  if (token !== undefined) {
    const trimmedToken = (token || '').trim();
    if (trimmedToken) localStorage.setItem('github_pat_token', trimmedToken);
    else localStorage.removeItem('github_pat_token');
  }
}

export function loadBrokerRules(fallback = {}) {
  if (typeof localStorage === 'undefined') return { ...fallback };
  const raw = localStorage.getItem(TRADERNET_RULES_STORAGE_KEY);
  if (!raw) return { ...fallback };
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { ...fallback };
  } catch (e) {
    console.warn('Failed to parse saved broker rules:', e);
    return { ...fallback };
  }
}

export function saveBrokerRules(rules) {
  if (typeof localStorage === 'undefined' || !rules || typeof rules !== 'object') return;
  localStorage.setItem(TRADERNET_RULES_STORAGE_KEY, JSON.stringify(rules));
}

export function clearBrokerRules() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(TRADERNET_RULES_STORAGE_KEY);
}

export function getQuoteRefreshInterval(fallback = 60000) {
  if (typeof localStorage === 'undefined') return fallback;
  const raw = localStorage.getItem(QUOTE_REFRESH_INTERVAL_KEY);
  if (raw === null || raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function saveQuoteRefreshInterval(interval) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(QUOTE_REFRESH_INTERVAL_KEY, String(interval));
}

export function saveState(state, onPushToGist) {
  if (!state || typeof state !== 'object') return;
  state.lastUpdated = Date.now();
  delete state.marginFee;
  delete state.accruedMargin;
  if (state.positions && typeof state.positions === 'object') {
    Object.values(state.positions).forEach(pos => {
      if (pos && typeof pos === 'object') {
        delete pos.marginCharged;
        delete pos.marginFee;
        delete pos.accruedMargin;
      }
    });
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
  }
  if (typeof onPushToGist === 'function') {
    onPushToGist(false);
  }
}

export function saveStateToStorage(state) {
  if (!state || typeof state !== 'object' || typeof localStorage === 'undefined') return;
  delete state.marginFee;
  delete state.accruedMargin;
  if (state.positions && typeof state.positions === 'object') {
    Object.values(state.positions).forEach(pos => {
      if (pos && typeof pos === 'object') {
        delete pos.marginCharged;
        delete pos.marginFee;
        delete pos.accruedMargin;
      }
    });
  }
  localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
}

export function loadSavedState(currentState = {}) {
  if (typeof localStorage === 'undefined') return currentState;

  const savedGateway = getGatewaySecret();
  const gatewayInput = typeof document !== 'undefined' ? document.getElementById('gatewaySecretInput') : null;
  if (savedGateway && gatewayInput) {
    gatewayInput.value = savedGateway;
  }
  const headerGatewayInput = typeof document !== 'undefined' ? document.getElementById('headerGatewaySecretInput') : null;
  if (savedGateway && headerGatewayInput) {
    headerGatewayInput.value = savedGateway;
  }

  const raw = localStorage.getItem(STATE_STORAGE_KEY) || localStorage.getItem(LEGACY_STATE_STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        delete parsed.marginFee;
        delete parsed.accruedMargin;
        if (parsed.positions && typeof parsed.positions === 'object') {
          Object.values(parsed.positions).forEach(pos => {
            if (pos && typeof pos === 'object') {
              delete pos.marginCharged;
              delete pos.marginFee;
              delete pos.accruedMargin;
            }
          });
        }
        return {
          ...currentState,
          ...parsed,
          positions: parsed.positions || currentState.positions
        };
      }
    } catch (e) {
      console.warn('Failed to parse saved state:', e);
    }
  }
  return currentState;
}

export function clearLocalData() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(LEGACY_STATE_STORAGE_KEY);
  localStorage.removeItem(STATE_STORAGE_KEY);
}

export async function saveApiKeys(options = {}) {
  const secretEl = options.secretInput || (typeof document !== 'undefined' ? (document.getElementById("headerGatewaySecretInput") || document.getElementById("gatewaySecretInput")) : null);
  const secret = (options.secret !== undefined ? options.secret : secretEl?.value)?.trim() || "";

  const showToast = options.showToast || (typeof window !== 'undefined' && typeof window.showToast === 'function' ? window.showToast : console.log);
  const logTerminal = options.logTerminal || (typeof window !== 'undefined' && typeof window.logTerminal === 'function' ? window.logTerminal : console.log);

  if (!secret) {
    showToast("Please enter the Gateway Secret.", "error");
    return false;
  }

  secretEl?.toggleAttribute('disabled', true);

  setGatewaySecret(secret);
  logTerminal("[System]: Gateway Secret saved.");
  showToast("Gateway unlocked.", "success");

  const syncFn = options.syncCloudState || (typeof window !== 'undefined' ? window.syncCloudState : null);
  const refreshFn = options.refreshAllLivePrices || (typeof window !== 'undefined' ? window.refreshAllLivePrices : null);
  const toggleFn = options.toggleHeaderCredentialsVisibility || (typeof window !== 'undefined' ? window.toggleHeaderCredentialsVisibility : null);

  if (typeof syncFn === 'function') {
    const success = await syncFn();
    if (success) {
      if (typeof refreshFn === 'function') await refreshFn();
      if (typeof toggleFn === 'function') toggleFn();
    }
  }

  secretEl?.toggleAttribute('disabled', false);
  return true;
}
