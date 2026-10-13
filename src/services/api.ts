import CryptoJS from 'crypto-js';
import { processRollovers } from '../domain/portfolio';
import type { PortfolioState } from '../types/portfolio';

export const YAHOO_PROXY_URL = 'https://trading-proxy.armenavetisyan-sa.workers.dev';

export interface ProxyFetchOptions extends RequestInit {
  secret?: string;
}

export async function proxyFetch<T = any>(
  action = '',
  queryParams: Record<string, string> = {},
  options: ProxyFetchOptions = {}
): Promise<T> {
  const url = new URL(YAHOO_PROXY_URL);

  if (action) {
    if (action.startsWith('/')) {
      url.pathname = action;
    } else {
      url.searchParams.append('action', action);
    }
  }

  Object.entries(queryParams).forEach(([key, val]) => {
    if (val) url.searchParams.append(key, val);
  });

  const authSecret = options.secret || '';

  const res = await fetch(url.toString(), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(authSecret ? { 'X-App-Auth': authSecret, Authorization: `Bearer ${authSecret}` } : {}),
      ...(options.headers || {})
    }
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const errorMsg = typeof payload === 'object' && payload ? payload.error || payload.message : payload;
    throw new Error(errorMsg || `HTTP ${res.status}`);
  }

  return payload as T;
}

export async function fetchStockQuote(ticker: string, secret?: string): Promise<any | null> {
  if (!ticker) return null;
  const cleanTicker = ticker.trim().toUpperCase();

  try {
    return await proxyFetch('', { symbol: cleanTicker }, { secret });
  } catch (err: any) {
    console.warn(`[Proxy Quote Error: ${cleanTicker}]`, err.message);
    return null;
  }
}

export async function pullCloudState(secret: string): Promise<PortfolioState | null> {
  if (!secret?.trim()) {
    throw new Error('Gateway Secret is required to pull cloud state.');
  }

  const url = new URL('/api/state', YAHOO_PROXY_URL);
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-App-Auth': secret,
      Authorization: `Bearer ${secret}`
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
    throw new Error('Invalid state payload received from KV.');
  }

  let parsedState: any;

  if (typeof data.encryptedPayload === 'string') {
    const bytes = CryptoJS.AES.decrypt(data.encryptedPayload, secret);
    const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);

    if (!decryptedStr) {
      throw new Error('Decryption failed. Confirm the Gateway Secret matches the encryption key.');
    }

    try {
      parsedState = JSON.parse(decryptedStr);
    } catch (parseErr: any) {
      throw new Error(`Corrupted JSON payload in decrypted state: ${parseErr.message}`);
    }
  } else {
    parsedState = data;
  }

  if (!parsedState || typeof parsedState !== 'object') {
    throw new Error('Invalid portfolio structure inside decrypted state.');
  }

  if ('marginBalance' in parsedState) {
    delete parsedState.marginBalance;
  }

  if (!parsedState.lastRolloverTimestamp) {
    parsedState.lastRolloverTimestamp = Date.now();
  }

  // Pure domain processing for date rollovers
  processRollovers(parsedState);

  return {
    positions: parsedState.positions || [],
    cashHoldings: parsedState.cashHoldings || [],
    closedTrades: parsedState.closedTrades || [],
    cashBalance: Number(parsedState.cashBalance) || 0,
    gatewaySecret: secret,
    lastRolloverTimestamp: parsedState.lastRolloverTimestamp,
    quoteRefreshInterval: parsedState.quoteRefreshInterval || 0
  };
}

export async function pushCloudState(state: PortfolioState, secret: string): Promise<boolean> {
  if (!secret?.trim()) {
    throw new Error('Gateway Secret is required to push cloud state.');
  }

  const stateToEncrypt: Record<string, any> = { ...state };
  delete stateToEncrypt.gatewaySecret;
  delete stateToEncrypt.marginBalance;

  const ciphertext = CryptoJS.AES.encrypt(JSON.stringify(stateToEncrypt), secret).toString();
  const payload = { encryptedPayload: ciphertext };

  const url = new URL('/api/state', YAHOO_PROXY_URL);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-App-Auth': secret,
      Authorization: `Bearer ${secret}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `HTTP ${res.status}`);
  }

  return true;
}