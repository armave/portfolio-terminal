import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  saveState,
  savePortfolioSnapshot,
  loadSavedState,
  loadSavedHistory,
  saveSavedHistory,
  clearLocalData,
  getGatewaySecret,
  setGatewaySecret,
  saveGatewaySecret,
  loadGatewaySecret,
  restoreGatewaySecret,
  persistGatewaySecret,
  obfuscateSecret,
  deobfuscateSecret,
  areHeaderCredentialsConfigured,
  loadBrokerRules,
  saveBrokerRules,
  clearBrokerRules,
  getQuoteRefreshInterval,
  saveQuoteRefreshInterval,
  saveApiKeys
} from './storage.ts';

describe('storage service', () => {
  const storageMap = new Map<string, string>();

  const localStorageMock = {
    getItem: vi.fn((key: string) => storageMap.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storageMap.set(key, String(value));
    }),
    removeItem: vi.fn((key: string) => {
      storageMap.delete(key);
    }),
    clear: vi.fn(() => {
      storageMap.clear();
    }),
    key: vi.fn((index: number) => Array.from(storageMap.keys())[index] ?? null),
    get length() {
      return storageMap.size;
    }
  };

  beforeEach(() => {
    storageMap.clear();
    vi.clearAllMocks();
    vi.stubGlobal('localStorage', localStorageMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    localStorageMock.setItem.mockImplementation((key: string, value: string) => {
      storageMap.set(key, String(value));
    });
    vi.unstubAllGlobals();
  });

  describe('saveState', () => {
    it('persists state to localStorage and updates lastUpdated', () => {
      const state = { activeView: 'AAPL', balance: 1200, lastUpdated: Date.now() };
      const beforeTime = Date.now();

      expect(saveState(state)).toBe(true);

      const afterTime = Date.now();
      expect(state.lastUpdated).toBeGreaterThanOrEqual(beforeTime);
      expect(state.lastUpdated).toBeLessThanOrEqual(afterTime);

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'margin_portfolio_state_dynamic_v2',
        expect.any(String)
      );

      const savedJson = storageMap.get('margin_portfolio_state_dynamic_v2');
      expect(savedJson).toBeDefined();

      const parsed = JSON.parse(savedJson!);
      expect(parsed.activeView).toBe('AAPL');
      expect(parsed.balance).toBe(1200);
      expect(parsed.lastUpdated).toBe(state.lastUpdated);
    });

    it('never persists gatewaySecret from the runtime state', () => {
      const state = { activeView: 'AAPL', gatewaySecret: 'plaintext-sensitive-secret' };
      expect(saveState(state)).toBe(true);
      const persisted = JSON.parse(storageMap.get('margin_portfolio_state_dynamic_v2')!);
      expect(persisted).not.toHaveProperty('gatewaySecret');
      expect(state.gatewaySecret).toBe('plaintext-sensitive-secret');
    });

    it('triggers onPushToGist callback with false when provided', () => {
      const onPushToGist = vi.fn();
      const state = { activeView: 'NVDA' };

      saveState(state, onPushToGist);

      expect(onPushToGist).toHaveBeenCalledTimes(1);
      expect(onPushToGist).toHaveBeenCalledWith(false);
    });

    it('handles null, undefined, and non-object states gracefully without throwing', () => {
      expect(() => saveState(null)).not.toThrow();
      expect(() => saveState(undefined)).not.toThrow();
      expect(() => saveState('non-object' as unknown as Record<string, unknown>)).not.toThrow();
      expect(() => saveState(123 as unknown as Record<string, unknown>)).not.toThrow();
      expect(localStorageMock.setItem).not.toHaveBeenCalled();
    });

    it('returns false when persistence fails and does not trigger a sync callback', () => {
      const onPushToGist = vi.fn();
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new Error('quota exceeded');
      });

      expect(saveState({ activeView: 'AAPL' }, onPushToGist)).toBe(false);
      expect(onPushToGist).not.toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    it('rolls back the portfolio state when its changed history sidecar cannot be saved', () => {
      const previousState = JSON.stringify({ activeView: 'AAPL', balance: 100 });
      const previousHistory = JSON.stringify({
        brokerExecutedTrades: [{ id: 'old-trade' }],
        cashflows: [{ id: 'old-fee' }]
      });
      storageMap.set('margin_portfolio_state_dynamic_v2', previousState);
      storageMap.set('portfolio_closed_history_v1', previousHistory);
      const state = {
        activeView: 'MSFT',
        balance: 250,
        lastUpdated: 123,
        brokerExecutedTrades: [{ id: 'new-trade' }],
        cashflows: [{ id: 'new-fee' }]
      };
      const onPushToGist = vi.fn();
      localStorageMock.setItem.mockImplementation((key: string, value: string) => {
        if (key === 'portfolio_closed_history_v1') throw new Error('quota exceeded');
        storageMap.set(key, String(value));
      });

      expect(saveState(state, onPushToGist)).toBe(false);
      expect(storageMap.get('margin_portfolio_state_dynamic_v2')).toBe(previousState);
      expect(storageMap.get('portfolio_closed_history_v1')).toBe(previousHistory);
      expect(state.lastUpdated).toBe(123);
      expect(onPushToGist).not.toHaveBeenCalled();
    });

    it('commits blank portfolio, explicit empty history, and device view together', () => {
      const state = { activeView: 'COMBINED', balance: 0, lastUpdated: 123 };
      storageMap.set('margin_portfolio_state_dynamic_v2', JSON.stringify({ activeView: 'AAPL', balance: 100 }));
      storageMap.set('portfolio_closed_history_v1', JSON.stringify({
        brokerExecutedTrades: [{ id: 'old-trade' }],
        cashflows: [{ id: 'old-fee' }]
      }));
      storageMap.set('portfolio_active_view', 'AAPL');

      expect(savePortfolioSnapshot(
        state,
        { brokerExecutedTrades: [], cashflows: [] },
        { deviceActiveView: 'COMBINED' }
      )).toBe(true);

      expect(JSON.parse(storageMap.get('margin_portfolio_state_dynamic_v2')!)).toMatchObject({
        activeView: 'COMBINED',
        balance: 0
      });
      expect(JSON.parse(storageMap.get('portfolio_closed_history_v1')!)).toEqual({
        brokerExecutedTrades: [],
        cashflows: []
      });
      expect(storageMap.get('portfolio_active_view')).toBe('COMBINED');
      expect(state.lastUpdated).toBeGreaterThanOrEqual(123);
    });

    it('rolls back portfolio and history when a later device-preference write fails', () => {
      const previousState = JSON.stringify({ activeView: 'AAPL', balance: 100 });
      const previousHistory = JSON.stringify({
        brokerExecutedTrades: [{ id: 'old-trade' }],
        cashflows: [{ id: 'old-fee' }]
      });
      storageMap.set('margin_portfolio_state_dynamic_v2', previousState);
      storageMap.set('portfolio_closed_history_v1', previousHistory);
      storageMap.set('portfolio_active_view', 'AAPL');
      const state = { activeView: 'COMBINED', balance: 0, lastUpdated: 123 };
      localStorageMock.setItem.mockImplementation((key: string, value: string) => {
        if (key === 'portfolio_active_view') throw new Error('storage unavailable');
        storageMap.set(key, String(value));
      });

      expect(savePortfolioSnapshot(
        state,
        { brokerExecutedTrades: [], cashflows: [] },
        { deviceActiveView: 'COMBINED' }
      )).toBe(false);

      expect(storageMap.get('margin_portfolio_state_dynamic_v2')).toBe(previousState);
      expect(storageMap.get('portfolio_closed_history_v1')).toBe(previousHistory);
      expect(storageMap.get('portfolio_active_view')).toBe('AAPL');
      expect(state.lastUpdated).toBe(123);
    });

    it('does not throw when localStorage is undefined', () => {
      vi.stubGlobal('localStorage', undefined);
      expect(() => saveState({ activeView: 'TSLA' })).not.toThrow();
    });
  });

  describe('loadSavedState', () => {
    it('handles missing payload gracefully and returns fallback state', () => {
      const fallback = { activeView: 'COMBINED', balance: 0 };
      const loaded = loadSavedState(fallback);

      expect(loaded).toEqual(expect.objectContaining(fallback));
    });

    it('handles empty string payload gracefully and returns fallback state', () => {
      storageMap.set('portfolio_state', '');
      storageMap.set('margin_portfolio_state_dynamic_v2', '');

      const fallback = { activeView: 'COMBINED', balance: 500 };
      const loaded = loadSavedState(fallback);

      expect(loaded).toEqual(fallback);
    });

    it('handles corrupted JSON payloads gracefully and returns exact fallback state', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      storageMap.set('portfolio_state', '{"broken_json: true,');
      storageMap.set('margin_portfolio_state_dynamic_v2', '{"broken_json: true,');

      const fallback = { activeView: 'DEFAULT', balance: 1500 };
      const loaded = loadSavedState(fallback);

      expect(loaded).toEqual(fallback);
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to parse saved state:',
        expect.any(SyntaxError)
      );
      warnSpy.mockRestore();
    });

    it('loads and merges valid state when present in localStorage', () => {
      const savedPayload = { activeView: 'GOOGL', balance: 3400 };
      storageMap.set('portfolio_state', JSON.stringify(savedPayload));
      storageMap.set('margin_portfolio_state_dynamic_v2', JSON.stringify(savedPayload));

      const fallback = { activeView: 'COMBINED', balance: 0, testField: 'preserved' };
      const loaded = loadSavedState(fallback);

      expect(loaded.activeView).toBe('GOOGL');
      expect(loaded.balance).toBe(3400);
    });

    it('recovers the legacy snapshot when the current snapshot contains invalid JSON', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      storageMap.set('margin_portfolio_state_dynamic_v2', '{"broken');
      storageMap.set('portfolio_state', JSON.stringify({ activeView: 'MSFT', balance: -250 }));

      expect(loadSavedState({ activeView: 'COMBINED', balance: 0 })).toEqual({
        activeView: 'MSFT',
        balance: -250
      });
      expect(warnSpy).toHaveBeenCalledWith('Failed to parse saved state:', expect.any(SyntaxError));
      warnSpy.mockRestore();
    });

    it('recovers the legacy snapshot when the current snapshot is not an object', () => {
      storageMap.set('margin_portfolio_state_dynamic_v2', JSON.stringify(['invalid-shape']));
      storageMap.set('portfolio_state', JSON.stringify({ activeView: 'AAPL', balance: 125 }));

      expect(loadSavedState({ activeView: 'COMBINED', balance: 0 })).toEqual({
        activeView: 'AAPL',
        balance: 125
      });
    });

    it('returns fallback state when localStorage is undefined', () => {
      vi.stubGlobal('localStorage', undefined);
      const fallback = { activeView: 'COMBINED' };

      expect(loadSavedState(fallback)).toBe(fallback);
    });

    it('does not access or mutate DOM elements while loading saved state', () => {
      storageMap.set('gateway_secret', 'secret-token-xyz');
      const getElementById = vi.fn();

      if (typeof document !== 'undefined') {
        vi.spyOn(document, 'getElementById').mockImplementation(getElementById);
      } else {
        vi.stubGlobal('document', { getElementById });
      }

      const fallback = { activeView: 'COMBINED' };
      expect(loadSavedState(fallback)).toBe(fallback);
      expect(getElementById).not.toHaveBeenCalled();
    });
  });

  describe('gateway secret & header credentials', () => {
    it('gets, sets and clears gateway secret', () => {
      expect(getGatewaySecret()).toBe('');
      expect(areHeaderCredentialsConfigured()).toBe(false);

      setGatewaySecret('my-secret-key');
      expect(getGatewaySecret()).toBe('my-secret-key');
      expect(areHeaderCredentialsConfigured()).toBe(true);

      setGatewaySecret('');
      expect(getGatewaySecret()).toBe('');
      expect(areHeaderCredentialsConfigured()).toBe(false);
    });

    it('keeps gateway secret in memory and purges persisted legacy credentials', () => {
      const secret = 'super-secret-token-123';
      storageMap.set('_gw_auth', 'b64:c3VwZXItc2VjcmV0LXRva2VuLTEyMw==');
      storageMap.set('gateway_secret', secret);

      saveGatewaySecret(secret);

      expect(getGatewaySecret()).toBe(secret);
      expect(storageMap.has('_gw_auth')).toBe(false);
      expect(storageMap.has('gateway_secret')).toBe(false);
      expect(loadGatewaySecret()).toBe(secret);
    });

    it('does not store the Gateway Secret in plaintext and safely falls back when secure storage is unavailable', async () => {
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.stubGlobal('indexedDB', undefined);
      saveGatewaySecret('private-device-secret');
      const persisted = await persistGatewaySecret();

      expect(persisted).toBe(false);
      expect(getGatewaySecret()).toBe('private-device-secret');
      expect(storageMap.has('_gw_auth')).toBe(false);
      expect(storageMap.has('gateway_secret')).toBe(false);
      expect([...storageMap.values()].join('|')).not.toContain('private-device-secret');

      setGatewaySecret('');
      expect(await restoreGatewaySecret()).toBe('');
      warning.mockRestore();
    });

    it('does not create reversible client-side secret encodings', () => {
      expect(obfuscateSecret('my-gateway-password')).toBe('');
      expect(deobfuscateSecret('b64:bXktZ2F0ZXdheS1wYXNzd29yZA==')).toBe('');
      expect(obfuscateSecret('')).toBe('');
      expect(deobfuscateSecret('')).toBe('');
    });

    it('saveApiKeys reports the actual device-persistence result', async () => {
      const showToast = vi.fn();
      const logTerminal = vi.fn();
      const secureStorageAvailable = typeof indexedDB !== 'undefined' && Boolean(globalThis.crypto?.subtle);

      const result = await saveApiKeys({
        secret: 'test-gateway-secret',
        showToast,
        logTerminal
      });

      expect(getGatewaySecret()).toBe('test-gateway-secret');
      if (secureStorageAvailable) {
        expect(result).toBe(true);
        expect(logTerminal).toHaveBeenCalledWith(expect.stringContaining('Remote access has not been verified'));
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Remote access has not been verified'), 'success');
      } else {
        expect(result).toBe(false);
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('secure device storage failed'), 'error');
        expect(showToast).not.toHaveBeenCalledWith(expect.any(String), 'success');
      }
    });

    it('preserves encrypted device credentials when IndexedDB is temporarily unavailable', async () => {
      setGatewaySecret('');
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const encryptedPayload = JSON.stringify({ version: 1, iv: Array(12).fill(1), data: [2, 3, 4] });
      storageMap.set('gateway_secret_encrypted_v1', encryptedPayload);
      vi.stubGlobal('indexedDB', undefined);

      expect(await restoreGatewaySecret()).toBe('');
      expect(storageMap.get('gateway_secret_encrypted_v1')).toBe(encryptedPayload);
      expect(getGatewaySecret()).toBe('');

      warning.mockRestore();
    });

    it('saveApiKeys reports secure storage failure instead of success', async () => {
      vi.stubGlobal('indexedDB', undefined);
      const showToast = vi.fn();
      const logTerminal = vi.fn();

      const result = await saveApiKeys({
        secret: 'test-gateway-secret',
        showToast,
        logTerminal
      });

      expect(result).toBe(false);
      expect(getGatewaySecret()).toBe('test-gateway-secret');
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('secure device storage failed'), 'error');
      expect(showToast).not.toHaveBeenCalledWith(expect.any(String), 'success');
      expect(logTerminal).toHaveBeenCalledWith(expect.stringContaining('may need to be entered again after refresh'));
    });

    it('saveApiKeys rejects empty secret', async () => {
      const showToast = vi.fn();
      const result = await saveApiKeys({ secret: '   ', showToast });

      expect(result).toBe(false);
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Please enter'), 'error');
    });
  });

  describe('broker rules', () => {
    it('manages broker rules with defensive fallback on corrupted JSON', () => {
      const defaultRules = { annualRate: 0.15, dayCountBasis: 365 };
      expect(loadBrokerRules(defaultRules)).toEqual(defaultRules);

      const customRules = { annualRate: 0.12, dayCountBasis: 360 };
      saveBrokerRules(customRules);
      expect(loadBrokerRules(defaultRules)).toEqual(customRules);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      storageMap.set('tradernet_rules_v1', '{"broken');
      expect(loadBrokerRules(defaultRules)).toEqual(defaultRules);
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to parse saved broker rules:',
        expect.any(SyntaxError)
      );
      warnSpy.mockRestore();

      clearBrokerRules();
      expect(loadBrokerRules(defaultRules)).toEqual(defaultRules);
    });
  });

  describe('quote refresh interval', () => {
    it('gets and sets refresh interval with fallback', () => {
      expect(getQuoteRefreshInterval(60000)).toBe(60000);
      saveQuoteRefreshInterval(15000);
      expect(getQuoteRefreshInterval(60000)).toBe(15000);
    });

    it('keeps guest refresh defaults and preferences separate from admin settings', () => {
      saveQuoteRefreshInterval(60000, 'admin');

      expect(getQuoteRefreshInterval(15000, 'guest')).toBe(15000);
      expect(getQuoteRefreshInterval(60000, 'admin')).toBe(60000);

      saveQuoteRefreshInterval(30000, 'guest');
      expect(getQuoteRefreshInterval(15000, 'guest')).toBe(30000);
      expect(getQuoteRefreshInterval(60000, 'admin')).toBe(60000);
    });
  });

  describe('separate closed history persistence', () => {
    it('migrates history embedded in a legacy portfolio snapshot when the sidecar is absent', () => {
      const expected = {
        brokerExecutedTrades: [{ id: 'legacy-trade', ticker: 'AAPL' }],
        cashflows: [{ id: 'legacy-fee', amount: -2 }]
      };
      storageMap.set('margin_portfolio_state_dynamic_v2', JSON.stringify(expected));

      expect(loadSavedHistory()).toEqual(expected);
      expect(JSON.parse(storageMap.get('portfolio_closed_history_v1')!)).toEqual(expected);
    });

    it('recovers embedded history without overwriting an unreadable sidecar', () => {
      const damagedSidecar = '{"brokerExecutedTrades":';
      const expected = {
        brokerExecutedTrades: [{ id: 'recoverable-trade', ticker: 'MSFT' }],
        cashflows: [{ id: 'recoverable-fee', amount: -3 }]
      };
      storageMap.set('portfolio_closed_history_v1', damagedSidecar);
      storageMap.set('margin_portfolio_state_dynamic_v2', JSON.stringify(expected));
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(loadSavedHistory()).toEqual(expected);
      expect(storageMap.get('portfolio_closed_history_v1')).toBe(damagedSidecar);
      expect(warning).toHaveBeenCalledWith('Failed to parse saved closed history:', expect.any(SyntaxError));
    });

    it('persists an explicit empty history snapshot so a full reset cannot restore old rows', () => {
      storageMap.set('portfolio_closed_history_v1', JSON.stringify({
        brokerExecutedTrades: [{ id: 'old-trade' }],
        cashflows: [{ id: 'old-fee' }]
      }));

      expect(saveSavedHistory({ brokerExecutedTrades: [], cashflows: [] })).toBe(true);
      expect(loadSavedHistory()).toEqual({ brokerExecutedTrades: [], cashflows: [] });
      expect(JSON.parse(storageMap.get('portfolio_closed_history_v1')!)).toEqual({
        brokerExecutedTrades: [],
        cashflows: []
      });
    });

    it('reports when the separate history record cannot be persisted', () => {
      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new Error('quota exceeded');
      });

      expect(saveSavedHistory({ brokerExecutedTrades: [], cashflows: [] })).toBe(false);
    });
  });

  describe('clearLocalData', () => {
    it('clears state items from storage', () => {
      storageMap.set('portfolio_state', 'data1');
      storageMap.set('margin_portfolio_state_dynamic_v2', 'data2');

      clearLocalData();

      expect(storageMap.has('portfolio_state')).toBe(false);
      expect(storageMap.has('margin_portfolio_state_dynamic_v2')).toBe(false);
    });
  });
});
