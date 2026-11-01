import { describe, expect, it } from 'vitest';
import { getMarketInsightsRequestPlan } from './marketInsightsRequestPolicy';

describe('market insights request policy', () => {
  it('requests news only while the News tab is selected', () => {
    expect(getMarketInsightsRequestPlan('AAPL', 'news', false)).toEqual({
      news: true,
      deepData: false,
      stocktwits: false
    });
    for (const section of ['fundamentals', 'earnings', 'analysts'] as const) {
      expect(getMarketInsightsRequestPlan('AAPL', section, false)).toEqual({
        news: false,
        deepData: true,
        stocktwits: false
      });
    }
  });

  it('keeps Stocktwits idle until the user opts in', () => {
    expect(getMarketInsightsRequestPlan('AAPL', 'fundamentals', false).stocktwits).toBe(false);
    expect(getMarketInsightsRequestPlan('AAPL', 'fundamentals', true).stocktwits).toBe(true);
  });

  it('does not request any provider when there is no selected ticker', () => {
    expect(getMarketInsightsRequestPlan('  ', 'news', true)).toEqual({
      news: false,
      deepData: false,
      stocktwits: false
    });
  });
});
