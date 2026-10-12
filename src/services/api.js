import CryptoJS from 'crypto-js';
import { processRollovers } from '../domain/portfolio.ts';
import { getGatewaySecret } from './storage.js';

export const YAHOO_PROXY_URL = 'https://trading-proxy.armenavetisyan-sa.workers.dev';
export { processRollovers };

export function setSecretGetter(_getter) {}

export function getActiveGatewaySecret(state) {
  if (state?.gatewaySecret) return state.gatewaySecret;
  const stored = getGatewaySecret();
  if (stored) return stored;
  return '';
}

export async function proxyFetch(action = '', queryParams = {}, fetchOptions = {}) {
  const url = new URL(YAHOO_PROXY_URL);
  if (action) {
    if (action.startsWith('/')) {
      url.pathname = action;
    } else {
      url.searchParams.append('action', action);
    }
  }
  Object.entries(queryParams).forEach(([k, v]) => {
    if (v) url.searchParams.append(k, v);
  });

  const authSecret = fetchOptions.secret || getActiveGatewaySecret(fetchOptions.state);

  const res = await fetch(url.toString(), {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      'X-App-Auth': authSecret,
      'Authorization': `Bearer ${authSecret}`,
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

export async function pullCloudState(secret) {
  if (!secret) {
    throw new Error('Gateway Secret required to access cloud state.');
  }

  const url = new URL('/api/state', YAHOO_PROXY_URL);
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-App-Auth': secret,
      'Authorization': `Bearer ${secret}`
    }
  });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `HTTP ${res.status}`);
  }

  const data = await res.json();
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid state payload from KV.');
  }

  let parsedState;
  if (typeof data.encryptedPayload === 'string') {
    const bytes = CryptoJS.AES.decrypt(data.encryptedPayload, secret);
    const decryptedStr = bytes ? bytes.toString(CryptoJS.enc.Utf8) : '';
    if (!decryptedStr) {
      throw new Error("Decryption failed — verify Gateway Secret matches the encryption key.");
    }
    try {
      parsedState = JSON.parse(decryptedStr);
    } catch (parseErr) {
      throw new Error(`Invalid JSON in decrypted state: ${parseErr.message}`);
    }
  } else {
    parsedState = data;
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

  processRollovers(parsedState);

  return parsedState;
}

export async function pushCloudState(state, secret) {
  if (!secret) {
    throw new Error('Gateway Secret required to access cloud state.');
  }

  const stateToEncrypt = { ...state };
  delete stateToEncrypt.gatewaySecret;
  if ('marginBalance' in stateToEncrypt) {
    delete stateToEncrypt.marginBalance;
  }

  const ciphertext = CryptoJS.AES.encrypt(JSON.stringify(stateToEncrypt), secret).toString();
  const payload = { encryptedPayload: ciphertext };

  const url = new URL('/api/state', YAHOO_PROXY_URL);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-App-Auth': secret,
      'Authorization': `Bearer ${secret}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `HTTP ${res.status}`);
  }

  return true;
}
