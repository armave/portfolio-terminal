export type MarketInsightsSection = 'news' | 'fundamentals' | 'earnings' | 'analysts';

export interface MarketInsightsRequestPlan {
  news: boolean;
  deepData: boolean;
  stocktwits: boolean;
}

/** Keep provider work aligned with the visible tab; Stocktwits requires explicit opt-in. */
export function getMarketInsightsRequestPlan(
  ticker: string,
  activeSection: MarketInsightsSection,
  stocktwitsRequested: boolean
): MarketInsightsRequestPlan {
  const hasTicker = ticker.trim().length > 0;
  return {
    news: hasTicker && activeSection === 'news',
    deepData: hasTicker && activeSection !== 'news',
    stocktwits: hasTicker && stocktwitsRequested
  };
}
