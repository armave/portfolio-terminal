import { describe, expect, it } from 'vitest';
import { createAiRequestLifecycle, fingerprintAiPortfolioContext } from './requestLifecycle';

describe('AI request lifecycle', () => {
  it('makes a new request supersede the older pending response', () => {
    const lifecycle = createAiRequestLifecycle();
    const older = lifecycle.begin();
    const newer = lifecycle.begin();
    expect(lifecycle.isCurrent(older)).toBe(false);
    expect(lifecycle.isCurrent(newer)).toBe(true);
  });

  it('invalidates pending AI work when the user resumes local interaction', () => {
    const lifecycle = createAiRequestLifecycle();
    const request = lifecycle.begin();
    lifecycle.invalidate();
    expect(lifecycle.isCurrent(request)).toBe(false);
  });
});

describe('AI portfolio context snapshot', () => {
  it('is stable when equivalent objects have different property order', () => {
    expect(fingerprintAiPortfolioContext({
      positions: { AAPL: { shares: 2, currentPrice: 100 } },
      activeView: 'AAPL',
      brokerAssumptions: { commission: 0.01 }
    })).toBe(fingerprintAiPortfolioContext({
      brokerAssumptions: { commission: 0.01 },
      activeView: 'AAPL',
      positions: { AAPL: { currentPrice: 100, shares: 2 } }
    }));
  });

  it('changes when selected view or material prompt context changes', () => {
    const base = {
      positions: { AAPL: { shares: 2, currentPrice: 100 } },
      activeView: 'AAPL', balance: -500,
      cashCushion: { freeCash: 100 },
      brokerAssumptions: { commission: 0.01 }
    };
    for (const changed of [
      { ...base, activeView: 'MSFT' },
      { ...base, balance: -600 },
      { ...base, cashCushion: { freeCash: 200 } },
      { ...base, brokerAssumptions: { commission: 0.02 } },
      { ...base, positions: { AAPL: { shares: 3, currentPrice: 100 } } }
    ]) {
      expect(fingerprintAiPortfolioContext(changed)).not.toBe(fingerprintAiPortfolioContext(base));
    }
  });
});

describe('AI intent context freshness requirements', () => {
  it('does not reject portfolio-independent chat and news responses after unrelated state updates', async () => {
    const { aiIntentRequiresFreshPortfolioContext } = await import('./requestLifecycle');
    expect(aiIntentRequiresFreshPortfolioContext('chat', null)).toBe(false);
  });

  it('keeps portfolio-dependent projections and actions protected against stale context', async () => {
    const { aiIntentRequiresFreshPortfolioContext } = await import('./requestLifecycle');
    expect(aiIntentRequiresFreshPortfolioContext('action', 'GOOGL')).toBe(true);
    expect(aiIntentRequiresFreshPortfolioContext('simulation', 'GOOGL')).toBe(true);
    expect(aiIntentRequiresFreshPortfolioContext('comparison', 'GOOGL')).toBe(true);
  });

  it('checks active selection when a quote intent omits its ticker', async () => {
    const { aiIntentRequiresFreshPortfolioContext } = await import('./requestLifecycle');
    expect(aiIntentRequiresFreshPortfolioContext('fetch_quote', null)).toBe(true);
    expect(aiIntentRequiresFreshPortfolioContext('fetch_quote', 'GOOGL')).toBe(false);
  });
});
