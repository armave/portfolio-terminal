import type { MarginIntelligenceArticle, MarginNewsCoverage } from './marginIntelligence';

export interface MarginIntelligenceState {
  title: string;
  scope: 'position' | 'portfolio';
  ticker?: string;
  loading: boolean;
  analysis: string;
  articles: MarginIntelligenceArticle[];
  coverage?: MarginNewsCoverage[];
  stale?: boolean;
  staleReasons?: string[];
  error?: string;
  syncedAt?: string;
  snapshotAsOf?: string;
  digestRevision?: number;
}

export interface MarginIntelligenceRequestIdentity {
  scope: 'position' | 'portfolio';
  ticker?: string;
}

/** Return previous state only when it belongs to the same margin-intelligence request. */
export function getMatchingMarginIntelligenceState<T extends MarginIntelligenceRequestIdentity>(
  state: T | null | undefined,
  request: MarginIntelligenceRequestIdentity
): T | null {
  if (!state || state.scope !== request.scope || state.ticker !== request.ticker) return null;
  return state;
}
