import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { saveState, loadSavedState } from './storage.js';

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
      const state = { activeView: 'AAPL', marginBalance: 1200 };
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
      expect(parsed.marginBalance).toBe(1200);
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
      const fallback = { activeView: 'COMBINED', marginBalance: 0 };
      const loaded = loadSavedState(fallback);

      expect(loaded).toEqual(expect.objectContaining(fallback));
    });

    it('handles empty string payload gracefully without throwing', () => {
      storageMap.set('portfolio_state', '');
      storageMap.set('margin_portfolio_state_dynamic_v2', '');

      const fallback = { activeView: 'COMBINED', marginBalance: 500 };
      let loaded: unknown;

      expect(() => {
        loaded = loadSavedState(fallback);
      }).not.toThrow();

      expect(loaded).toEqual(expect.objectContaining(fallback));
    });

    it('handles corrupted JSON payloads gracefully without throwing', () => {
      storageMap.set('portfolio_state', '{"broken_json: true,');
      storageMap.set('margin_portfolio_state_dynamic_v2', '{"broken_json: true,');

      const fallback = { activeView: 'DEFAULT', marginBalance: 1500 };
      let loaded: unknown;

      expect(() => {
        loaded = loadSavedState(fallback);
      }).not.toThrow();

      expect(loaded).toEqual(expect.objectContaining(fallback));
    });

    it('loads and merges valid state when present in localStorage', () => {
      const savedPayload = { activeView: 'GOOGL', marginBalance: 3400 };
      storageMap.set('portfolio_state', JSON.stringify(savedPayload));
      storageMap.set('margin_portfolio_state_dynamic_v2', JSON.stringify(savedPayload));

      const fallback = { activeView: 'COMBINED', marginBalance: 0, testField: 'preserved' };
      const loaded = loadSavedState(fallback);

      expect(loaded.activeView).toBe('GOOGL');
      expect(loaded.marginBalance).toBe(3400);
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
});
