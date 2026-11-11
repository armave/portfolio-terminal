import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  saveState,
  savePortfolioSnapshot,
  savePortfolioStateSnapshot,
  loadSavedState,
  loadSavedHistory,
  saveSavedHistory,
  initializeSavedHistoryStorage,
  flushSavedHistoryPersistence,
  clearSavedHistoryPersistence,
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
  saveApiKeys,
  hasFreedomCashflowHistoryBaseline,
  hasFreedomTradeHistoryBaseline,
  markFreedomCashflowHistoryBaseline,
  markFreedomTradeHistoryBaseline
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

  beforeEach(async () => {
    storageMap.clear();
    vi.clearAllMocks();
    vi.stubGlobal('localStorage', localStorageMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await clearSavedHistoryPersistence();
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

    it('commits compact portfolio state even when the legacy localStorage history fallback is full', async () => {
      vi.stubGlobal('indexedDB', undefined);
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
        if (key === 'portfolio_closed_history_v1') {
          const error = new Error('quota exceeded') as Error & { name: string };
          error.name = 'QuotaExceededError';
          throw error;
        }
        storageMap.set(key, String(value));
      });

      expect(saveState(state, onPushToGist)).toBe(true);
      await flushSavedHistoryPersistence();
      expect(JSON.parse(storageMap.get('margin_portfolio_state_dynamic_v2')!)).toMatchObject({
        activeView: 'MSFT',
        balance: 250
      });
      expect(storageMap.get('portfolio_closed_history_v1')).toBe(previousHistory);
      expect(state.lastUpdated).not.toBe(123);
      expect(onPushToGist).toHaveBeenCalledWith(false);
    });

    it('commits blank portfolio, explicit empty IndexedDB history, and device view together', async () => {
      const state = { activeView: 'COMBINED', balance: 0, lastUpdated: 123 };
      storageMap.set('margin_portfolio_state_dynamic_v2', JSON.stringify({ activeView: 'AAPL', balance: 100 }));
      storageMap.set('portfolio_closed_history_v1', JSON.stringify({
        brokerExecutedTrades: [{ id: 'old-trade' }],
        cashflows: [{ id: 'old-fee' }]
      }));
      storageMap.set('portfolio_active_view', 'AAPL');

      expect(await savePortfolioSnapshot(
        state,
        { brokerExecutedTrades: [], cashflows: [] },
        { deviceActiveView: 'COMBINED' }
      )).toBe(true);

      expect(JSON.parse(storageMap.get('margin_portfolio_state_dynamic_v2')!)).toMatchObject({
        activeView: 'COMBINED',
        balance: 0
      });
      expect(loadSavedHistory()).toEqual({ brokerExecutedTrades: [], cashflows: [] });
      if (typeof indexedDB !== 'undefined') {
        expect(storageMap.has('portfolio_closed_history_v1')).toBe(false);
      } else {
        expect(JSON.parse(storageMap.get('portfolio_closed_history_v1')!)).toEqual({
          brokerExecutedTrades: [], cashflows: []
        });
      }
      expect(storageMap.get('portfolio_active_view')).toBe('COMBINED');
      expect(state.lastUpdated).toBeGreaterThanOrEqual(123);
    });

    it('rolls back IndexedDB history when a later device-preference write fails', async () => {
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

      expect(await savePortfolioSnapshot(
        state,
        { brokerExecutedTrades: [], cashflows: [] },
        { deviceActiveView: 'COMBINED' }
      )).toBe(false);

      expect(storageMap.get('margin_portfolio_state_dynamic_v2')).toBe(previousState);
      expect(loadSavedHistory()).toEqual(JSON.parse(previousHistory));
      expect(storageMap.get('portfolio_active_view')).toBe('AAPL');
      expect(state.lastUpdated).toBe(123);
    });

    it('does not throw when localStorage is undefined', () => {
      vi.stubGlobal('localStorage', undefined);
      expect(() => saveState({ activeView: 'TSLA' })).not.toThrow();
    });
  });

  describe('portfolio state persistence without closed-history cache rewrite', () => {
    it('saves portfolio state without rewriting an oversized local history sidecar', () => {
      const previousState = JSON.stringify({ activeView: 'AAPL', balance: 100 });
      const previousHistory = JSON.stringify({
        brokerExecutedTrades: [{ id: 'previous-history-is-retained' }],
        cashflows: [{ id: 'previous-cashflow-is-retained' }]
      });
      storageMap.set('margin_portfolio_state_dynamic_v2', previousState);
      storageMap.set('portfolio_closed_history_v1', previousHistory);
      localStorageMock.setItem.mockImplementation((key: string, value: string) => {
        if (key === 'portfolio_closed_history_v1') {
          const error = new Error('Quota exceeded') as Error & { name: string };
          error.name = 'QuotaExceededError';
          throw error;
        }
        storageMap.set(key, String(value));
      });

      const state = {
        activeView: 'COMBINED',
        balance: 250,
        brokerExecutedTrades: [{ id: 'full-history-is-checkpointed-in-cloud' }],
        cashflows: [{ id: 'full-cashflows-are-checkpointed-in-cloud' }]
      };

      expect(savePortfolioStateSnapshot(state)).toBe(true);
      expect(JSON.parse(storageMap.get('margin_portfolio_state_dynamic_v2')!)).toMatchObject({
        activeView: 'COMBINED',
        balance: 250
      });
      expect(storageMap.get('portfolio_closed_history_v1')).toBe(previousHistory);
      expect(loadSavedHistory()).toEqual({
        brokerExecutedTrades: [{ id: 'previous-history-is-retained' }],
        cashflows: [{ id: 'previous-cashflow-is-retained' }]
      });
      expect(localStorageMock.setItem).not.toHaveBeenCalledWith(
        'portfolio_closed_history_v1',
        expect.any(String)
      );
    });

    it('does not include raw execution/cashflow arrays in the compact portfolio snapshot', () => {
      const state = {
        activeView: 'COMBINED',
        balance: 0,
        brokerExecutedTrades: [{ id: 'trade-1' }],
        cashflows: [{ id: 'cashflow-1' }]
      };
      expect(savePortfolioStateSnapshot(state)).toBe(true);
      const saved = JSON.parse(storageMap.get('margin_portfolio_state_dynamic_v2')!);
      expect(saved).not.toHaveProperty('brokerExecutedTrades');
      expect(saved).not.toHaveProperty('cashflows');
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
      const logAppMessage = vi.fn();
      const secureStorageAvailable = typeof indexedDB !== 'undefined' && Boolean(globalThis.crypto?.subtle);

      const result = await saveApiKeys({
        secret: 'test-gateway-secret',
        showToast,
        logAppMessage
      });

      expect(getGatewaySecret()).toBe('test-gateway-secret');
      if (secureStorageAvailable) {
        expect(result).toBe(true);
        expect(logAppMessage).toHaveBeenCalledWith(expect.stringContaining('Remote access has not been verified'));
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
      const logAppMessage = vi.fn();

      const result = await saveApiKeys({
        secret: 'test-gateway-secret',
        showToast,
        logAppMessage
      });

      expect(result).toBe(false);
      expect(getGatewaySecret()).toBe('test-gateway-secret');
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('secure device storage failed'), 'error');
      expect(showToast).not.toHaveBeenCalledWith(expect.any(String), 'success');
      expect(logAppMessage).toHaveBeenCalledWith(expect.stringContaining('may need to be entered again after refresh'));
    });

    it('saveApiKeys rejects empty secret', async () => {
      const showToast = vi.fn();
      const result = await saveApiKeys({ secret: '   ', showToast });

      expect(result).toBe(false);
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Please enter'), 'error');
    });
  });

  describe('broker rules', () => {
    const canonicalRules = {
      broker: 'Freedom Broker Armenia (Tradernet)', annualBorrowRate: 0.12, dayCountBasis: 360 as const,
      rolloverHour: 5, rolloverMinute: 30, rolloverTimeZone: 'Asia/Yerevan',
      maintenanceEquityRatio: 0.2, stopOutRatio: 0.01, commissionMin: 2,
      commissionPerShare: 0.02, commissionRatePct: 0.002
    };
    it('round-trips canonical assumptions without changing their values', () => {
      expect(loadBrokerRules()).toBeNull();
      saveBrokerRules(canonicalRules);
      expect(loadBrokerRules()).toEqual(canonicalRules);
    });
    it('leaves legacy payloads unknown for the domain compatibility boundary', () => {
      const legacy = { annualRate: '0.13', dailyRolloverCutoffArmenia: '06:15',
        maintenanceMarginRatio: '0.18', commPerShare: '0.03' };
      storageMap.set('tradernet_rules_v1', JSON.stringify(legacy));
      expect(loadBrokerRules()).toEqual(legacy);
    });
    it('returns null for malformed JSON and absent settings', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      storageMap.set('tradernet_rules_v1', '{"broken');
      expect(loadBrokerRules()).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith('Failed to parse saved broker rules:', expect.any(SyntaxError));
      warnSpy.mockRestore();
      clearBrokerRules();
      expect(loadBrokerRules()).toBeNull();
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

    it('falls back safely when a saved interval is unsupported or malformed', () => {
      storageMap.set('quote_refresh_interval', '20000');
      storageMap.set('quote_refresh_interval_guest_v1', 'not-a-number');
      expect(getQuoteRefreshInterval(60000, 'admin')).toBe(60000);
      expect(getQuoteRefreshInterval(15000, 'guest')).toBe(15000);

      // Legacy users who previously selected Off are migrated to their role default.
      storageMap.set('quote_refresh_interval', '0');
      storageMap.set('quote_refresh_interval_guest_v1', '0');
      expect(getQuoteRefreshInterval(60000, 'admin')).toBe(60000);
      expect(getQuoteRefreshInterval(15000, 'guest')).toBe(15000);
    });

    it('does not persist unsupported or disabled refresh intervals', () => {
      saveQuoteRefreshInterval(20000, 'admin');
      saveQuoteRefreshInterval(0, 'guest');
      expect(storageMap.has('quote_refresh_interval')).toBe(false);
      expect(storageMap.has('quote_refresh_interval_guest_v1')).toBe(false);
    });
  });

  describe('separate closed history persistence', () => {
    it('migrates history embedded in a legacy portfolio snapshot without rewriting localStorage', async () => {
      const expected = {
        brokerExecutedTrades: [{ id: 'legacy-trade', ticker: 'AAPL' }],
        cashflows: [{ id: 'legacy-fee', amount: -2 }]
      };
      storageMap.set('margin_portfolio_state_dynamic_v2', JSON.stringify(expected));

      await initializeSavedHistoryStorage();
      expect(loadSavedHistory()).toEqual(expected);
      // The rows came from the compact legacy state itself, not a local sidecar.
      // The migration must not create a duplicate localStorage history record.
      expect(storageMap.has('portfolio_closed_history_v1')).toBe(false);
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

    it('persists an explicit empty IndexedDB history snapshot so a full reset cannot restore old rows', async () => {
      storageMap.set('portfolio_closed_history_v1', JSON.stringify({
        brokerExecutedTrades: [{ id: 'old-trade' }],
        cashflows: [{ id: 'old-fee' }]
      }));
      await initializeSavedHistoryStorage();

      const indexedDbAvailable = typeof indexedDB !== 'undefined';
      expect(await saveSavedHistory({ brokerExecutedTrades: [], cashflows: [] })).toBe(true);
      expect(loadSavedHistory()).toEqual({ brokerExecutedTrades: [], cashflows: [] });
      if (indexedDbAvailable) {
        expect(storageMap.has('portfolio_closed_history_v1')).toBe(false);
      } else {
        expect(JSON.parse(storageMap.get('portfolio_closed_history_v1')!)).toEqual({
          brokerExecutedTrades: [], cashflows: []
        });
      }
    });

    it('reports when IndexedDB and the bounded legacy history fallback are unavailable', async () => {
      vi.stubGlobal('indexedDB', undefined);
      await initializeSavedHistoryStorage();
      localStorageMock.setItem.mockImplementation((key: string, value: string) => {
        if (key === 'portfolio_closed_history_v1') throw new Error('quota exceeded');
        storageMap.set(key, String(value));
      });

      expect(await saveSavedHistory({
        brokerExecutedTrades: Array.from({ length: 5000 }, (_, index) => ({
          id: String(index), raw: 'large-history-row'.repeat(20)
        })),
        cashflows: []
      })).toBe(false);
    });
  });

  describe('TradeNet history baseline markers', () => {
    it('stores trade and cashflow completeness separately for each account', () => {
      expect(hasFreedomTradeHistoryBaseline('admin-a')).toBe(false);
      expect(hasFreedomCashflowHistoryBaseline('admin-a')).toBe(false);

      expect(markFreedomTradeHistoryBaseline('admin-a')).toBe(true);
      expect(hasFreedomTradeHistoryBaseline('admin-a')).toBe(true);
      expect(hasFreedomCashflowHistoryBaseline('admin-a')).toBe(false);

      expect(markFreedomCashflowHistoryBaseline('admin-a')).toBe(true);
      expect(hasFreedomCashflowHistoryBaseline('admin-a')).toBe(true);
      expect(hasFreedomTradeHistoryBaseline('admin-b')).toBe(false);
      expect(hasFreedomCashflowHistoryBaseline('admin-b')).toBe(false);
    });

    it('does not mark a missing account identity as complete', () => {
      expect(markFreedomTradeHistoryBaseline('')).toBe(false);
      expect(markFreedomCashflowHistoryBaseline('')).toBe(false);
      expect(hasFreedomTradeHistoryBaseline('')).toBe(false);
      expect(hasFreedomCashflowHistoryBaseline('')).toBe(false);
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

  describe('large history localStorage isolation', () => {
    it('stores large closed history in IndexedDB and keeps the localStorage sidecar absent', async () => {
      if (typeof indexedDB === 'undefined') return;
      const history = {
        brokerExecutedTrades: Array.from({ length: 250 }, (_, index) => ({
          id: `trade-${index}`,
          ticker: 'AAPL',
          raw: 'execution-metadata-'.repeat(120)
        })),
        cashflows: Array.from({ length: 80 }, (_, index) => ({
          id: `cashflow-${index}`,
          raw: 'cashflow-metadata-'.repeat(60)
        }))
      };
      expect(saveState({
        activeView: 'COMBINED',
        brokerExecutedTrades: history.brokerExecutedTrades,
        cashflows: history.cashflows
      })).toBe(true);
      await flushSavedHistoryPersistence();

      expect(storageMap.has('portfolio_closed_history_v1')).toBe(false);
      expect(loadSavedHistory()).toEqual(history);
    });
  });
});
