export function areHeaderCredentialsConfigured() {
  if (typeof localStorage === 'undefined') return false;
  return (localStorage.getItem('gateway_secret') || '').trim().length > 0;
}

export function saveState(state, onPushToGist) {
  if (!state || typeof state !== 'object') return;
  state.lastUpdated = Date.now();
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('margin_portfolio_state_dynamic_v2', JSON.stringify(state));
  }
  if (typeof onPushToGist === 'function') {
    onPushToGist(false);
  }
}

export function loadSavedState(currentState = {}) {
  if (typeof localStorage === 'undefined') return currentState;

  const savedGateway = localStorage.getItem('gateway_secret');
  const gatewayInput = typeof document !== 'undefined' ? document.getElementById('gatewaySecretInput') : null;
  if (savedGateway && gatewayInput) {
    gatewayInput.value = savedGateway;
  }

  const raw = localStorage.getItem('portfolio_state');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
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
  localStorage.removeItem('portfolio_state');
  localStorage.removeItem('margin_portfolio_state_dynamic_v2');
}

export async function saveApiKeys(options = {}) {
  const secretEl = options.secretInput || (typeof document !== 'undefined' ? document.getElementById("gatewaySecretInput") : null);
  const secret = (options.secret !== undefined ? options.secret : secretEl?.value)?.trim() || "";

  const showToast = options.showToast || (typeof window !== 'undefined' && typeof window.showToast === 'function' ? window.showToast : console.log);
  const logTerminal = options.logTerminal || (typeof window !== 'undefined' && typeof window.logTerminal === 'function' ? window.logTerminal : console.log);

  if (!secret) {
    showToast("Please enter the Gateway Secret.", "error");
    return false;
  }

  secretEl?.toggleAttribute('disabled', true);

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem("gateway_secret", secret);
  }
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
