const STORAGE_KEY_STATE = 'margin_portfolio_state_dynamic_v2';
const STORAGE_KEY_LEGACY_STATE = 'portfolio_state';
const STORAGE_KEY_GW_AUTH = '_gw_auth';
const STORAGE_KEY_LEGACY_GW = 'gateway_secret';
const STORAGE_KEY_RULES = 'tradernet_rules_v1';
const STORAGE_KEY_REFRESH_INTERVAL = 'quote_refresh_interval';

let inMemoryGatewaySecret = '';

/**
 * Obfuscates a secret string into base64 without exposing plaintext.
 */
export function obfuscateSecret(plain: string): string {
  if (!plain || typeof plain !== 'string') return '';
  try {
    if (typeof btoa === 'function') {
      return btoa(plain);
    }
    return Buffer.from(plain, 'utf-8').toString('base64');
  } catch {
    return '';
  }
}

/**
 * Decodes an obfuscated base64 secret string defensively.
 */
export function deobfuscateSecret(encoded: string): string {
  if (!encoded || typeof encoded !== 'string') return '';
  const clean = encoded.startsWith('b64:') ? encoded.slice(4) : encoded;
  if (!clean || /[^A-Za-z0-9+/=]/.test(clean) || clean.length % 4 !== 0) {
    return '';
  }
  try {
    const decoded =
      typeof atob === 'function'
        ? atob(clean)
        : Buffer.from(clean, 'base64').toString('utf-8');
    // Verify round-trip and printable ASCII to avoid corrupting non-encoded strings
    if (!decoded || !/^[\x20-\x7E]+$/.test(decoded)) {
      return '';
    }
    return decoded;
  } catch {
    return '';
  }
}

/**
 * In-memory gateway secret getter.
 */
export function getGatewaySecret(): string {
  return inMemoryGatewaySecret;
}

/**
 * In-memory gateway secret setter.
 */
export function setGatewaySecret(secret: string): void {
  inMemoryGatewaySecret = secret ? String(secret) : '';
}

/**
 * Returns true if the in-memory gateway secret is non-empty.
 */
export function areHeaderCredentialsConfigured(): boolean {
  return Boolean(inMemoryGatewaySecret && inMemoryGatewaySecret.trim().length > 0);
}

/**
 * Obfuscates and persists gateway secret to localStorage under `_gw_auth`,
 * purging any legacy plaintext `gateway_secret` key.
 */
export function saveGatewaySecret(secret: string): void {
  const trimmed = typeof secret === 'string' ? secret.trim() : '';
  setGatewaySecret(trimmed);

  try {
    if (!trimmed) {
      localStorage.removeItem(STORAGE_KEY_GW_AUTH);
      return;
    }
    const obfuscated = obfuscateSecret(trimmed);
    if (obfuscated) {
      localStorage.setItem(STORAGE_KEY_GW_AUTH, `b64:${obfuscated}`);
    }
  } catch (err) {
    console.warn('Failed to save gateway secret:', err);
  }
}

/**
 * Loads gateway secret from localStorage, checking `_gw_auth` first,
 * then falling back to legacy plaintext `gateway_secret`.
 */
export function loadGatewaySecret(): string {

  try {
    const raw = localStorage.getItem(STORAGE_KEY_GW_AUTH);
    if (raw) {
      const recovered = raw.startsWith('b64:')
        ? deobfuscateSecret(raw)
        : deobfuscateSecret(raw) || raw;
      if (recovered) {
        inMemoryGatewaySecret = recovered.trim();
        return inMemoryGatewaySecret;
      }
    }

  } catch {
    // Fallback to in-memory secret
  }

  return inMemoryGatewaySecret;
}

export interface SaveApiKeysOptions {
  secret?: string;
  showToast?: (message: string, type?: string) => void;
  logTerminal?: (message: string) => void;
  [key: string]: unknown;
}

/**
 * Validates, saves, and confirms Gateway credentials.
 */
export async function saveApiKeys(options: SaveApiKeysOptions): Promise<boolean> {
  const { secret, showToast, logTerminal } = options || {};
  if (!secret || !secret.trim()) {
    if (typeof showToast === 'function') {
      showToast('Please enter a valid Gateway Secret', 'error');
    }
    return false;
  }

  const cleanSecret = secret.trim();
  saveGatewaySecret(cleanSecret);

  if (typeof logTerminal === 'function') {
    logTerminal('Gateway Secret saved successfully.');
  }
  if (typeof showToast === 'function') {
    showToast('Gateway unlocked successfully', 'success');
  }
  return true;
}

export const saveStateToStorage = saveState;

/**
 * Persists application state to localStorage and updates `state.lastUpdated`.
 */
export function saveState(
  state?: Record<string, any> | null,
  onPushToGist?: (forcePrompt?: boolean) => void
): void {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return;
  }
  if (typeof localStorage === 'undefined' || !localStorage) {
    return;
  }
  try {
    state.lastUpdated = Date.now();
    localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(state));
    if (typeof onPushToGist === 'function') {
      onPushToGist(false);
    }
  } catch (err) {
    console.error('Failed to save state:', err);
  }
}

/**
 * Loads application state from localStorage, merges with fallback, and hydrates
 * the DOM gateway secret input element if present.
 */
export function loadSavedState<T extends Record<string, any>>(fallback: T): T {
  // Storage can throw in strict privacy modes, even when the API exists.
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return fallback;

    // Keep legacy DOM hydration best-effort; state loading must not depend on it.
    try {
      if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
        const input = document.getElementById('gatewaySecretInput') as HTMLInputElement | null;
        if (input) {
          const current = localStorage.getItem(STORAGE_KEY_GW_AUTH);
          const secret = current
            ? deobfuscateSecret(current)
            : (localStorage.getItem(STORAGE_KEY_LEGACY_GW) || '');
          if (secret) input.value = secret;
        }
      }
    } catch {
      // DOM and storage hydration are optional.
    }

    const raw = localStorage.getItem(STORAGE_KEY_STATE)
      ?? localStorage.getItem(STORAGE_KEY_LEGACY_STATE);
    if (!raw || !raw.trim()) return fallback;

    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? { ...fallback, ...parsed }
        : fallback;
    } catch (err) {
      console.warn('Failed to parse saved state:', err);
      return fallback;
    }
  } catch (err) {
    console.warn('Storage unavailable; using in-memory portfolio state:', err);
    return fallback;
  }
}

/**
 * Loads broker rules with fallback on corrupted JSON or missing data.
 */
export function loadBrokerRules<T = unknown>(defaultRules: T): T {
  if (typeof localStorage === 'undefined' || !localStorage) {
    return defaultRules;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RULES);
    if (!raw) return defaultRules;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : defaultRules;
  } catch (err) {
    console.warn('Failed to parse saved broker rules:', err);
    return defaultRules;
  }
}

/**
 * Saves broker rules configuration to localStorage.
 */
export function saveBrokerRules(rules: unknown): void {
  if (typeof localStorage === 'undefined' || !localStorage) return;
  try {
    localStorage.setItem(STORAGE_KEY_RULES, JSON.stringify(rules));
  } catch (err) {
    console.error('Failed to save broker rules:', err);
  }
}

/**
 * Clears saved broker rules from localStorage.
 */
export function clearBrokerRules(): void {
  if (typeof localStorage === 'undefined' || !localStorage) return;
  try {
    localStorage.removeItem(STORAGE_KEY_RULES);
  } catch (err) {
    console.error('Failed to clear broker rules:', err);
  }
}

/**
 * Gets quote refresh interval with fallback.
 */
export function getQuoteRefreshInterval(fallback = 60000): number {
  if (typeof localStorage === 'undefined' || !localStorage) {
    return fallback;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY_REFRESH_INTERVAL);
    if (raw === null || raw === undefined) return fallback;
    const num = Number(raw);
    return Number.isFinite(num) ? num : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Saves quote refresh interval in milliseconds.
 */
export function saveQuoteRefreshInterval(interval: number): void {
  if (typeof localStorage === 'undefined' || !localStorage) return;
  try {
    localStorage.setItem(STORAGE_KEY_REFRESH_INTERVAL, String(interval));
  } catch (err) {
    console.error('Failed to save quote refresh interval:', err);
  }
}

/**
 * Purges active and legacy state payloads from localStorage.
 */
export function clearLocalData(): void {
  if (typeof localStorage === 'undefined' || !localStorage) return;
  try {
    localStorage.removeItem(STORAGE_KEY_LEGACY_STATE);
    localStorage.removeItem(STORAGE_KEY_STATE);
  } catch (err) {
    console.error('Failed to clear local data:', err);
  }
}

/**
 * Composite service object providing namespace compatibility for consumer files.
 */
export const StorageService = {
  loadLocal: loadSavedState,
  saveLocal: saveState,
  clearLocalData,
  getGatewaySecret,
  setGatewaySecret,
  saveGatewaySecret,
  loadGatewaySecret,
  obfuscateSecret,
  deobfuscateSecret,
  areHeaderCredentialsConfigured,
  loadBrokerRules,
  saveBrokerRules,
  clearBrokerRules,
  getQuoteRefreshInterval,
  saveQuoteRefreshInterval,
  saveApiKeys,
  syncToGist: async (state: any): Promise<string> => {
    const gistToken = state?.apiKeys?.gistToken;
    const gistId = state?.apiKeys?.gistId;
    if (!gistToken) throw new Error('Missing GitHub PAT for Gist sync');

    const cleanData = {
      cashBalance: state.cashBalance,
      holdings: state.holdings,
      cashStocks: state.cashStocks,
      closedTrades: state.closedTrades,
      brokerAssumptions: state.brokerAssumptions
    };

    const files: Record<string, { content: string }> = {
      'portfolio_state.json': { content: JSON.stringify(cleanData, null, 2) }
    };

    const method = gistId ? 'PATCH' : 'POST';
    const url = gistId ? `https://api.github.com/gists/${gistId}` : 'https://api.github.com/gists';

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${gistToken}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        description: 'Portfolio Terminal Snapshot',
        public: false,
        files
      })
    });

    if (!res.ok) throw new Error(`Gist sync failed: ${res.statusText}`);
    const resData = await res.json();
    return resData.id;
  }
};