import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  saveState,
  loadSavedState,
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
  saveApiKeys
} from './storage.js';

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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('saveState', () => {
    it('persists state to localStorage and updates lastUpdated', () => {
      const state = { activeView: 'AAPL', balance: 1200, lastUpdated: Date.now() };
      const beforeTime = Date.now();

      saveState(state);

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

    it('returns fallback state when localStorage is undefined', () => {
      vi.stubGlobal('localStorage', undefined);
      const fallback = { activeView: 'COMBINED' };

      expect(loadSavedState(fallback)).toBe(fallback);
    });

    it('populates gateway secret into input element if present in DOM', () => {
      storageMap.set('gateway_secret', 'secret-token-xyz');

      const inputElement = { value: '' };
      const getElementByIdMock = vi.fn((id: string) => {
        return id === 'gatewaySecretInput' ? (inputElement as unknown as HTMLElement) : null;
      });

      if (typeof document !== 'undefined') {
        vi.spyOn(document, 'getElementById').mockImplementation(getElementByIdMock);
      } else {
        vi.stubGlobal('document', { getElementById: getElementByIdMock });
      }

      loadSavedState({});

      expect(inputElement.value).toBe('secret-token-xyz');
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

    it('obfuscates secret before writing to localStorage and recovers it on load', () => {
      const secret = 'super-secret-token-123';
      saveGatewaySecret(secret);

      const storedRaw = storageMap.get('_gw_auth');
      expect(storedRaw).toBeDefined();
      expect(storedRaw).not.toBe(secret);
      expect(storedRaw).not.toContain(secret);
      expect(storageMap.has('gateway_secret')).toBe(false);

      const recovered = loadGatewaySecret();
      expect(recovered).toBe(secret);
    });

    it('handles obfuscation helpers defensively without exposing plaintext', () => {
      const plain = 'my-gateway-password';
      const obfuscated = obfuscateSecret(plain);
      expect(obfuscated).not.toBe(plain);
      expect(obfuscated).not.toContain(plain);
      expect(deobfuscateSecret(obfuscated)).toBe(plain);

      expect(obfuscateSecret('')).toBe('');
      expect(deobfuscateSecret('')).toBe('');
      expect(deobfuscateSecret('invalid-base-64-!!!')).toBe('');
    });

    it('saveApiKeys saves gateway secret and logs status', async () => {
      const showToast = vi.fn();
      const logTerminal = vi.fn();

      const result = await saveApiKeys({
        secret: 'test-gateway-secret',
        showToast,
        logTerminal
      });

      expect(result).toBe(true);
      expect(getGatewaySecret()).toBe('test-gateway-secret');
      expect(logTerminal).toHaveBeenCalledWith(expect.stringContaining('Gateway Secret saved'));
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Gateway unlocked'), 'success');
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
