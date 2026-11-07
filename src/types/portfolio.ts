  purchasedAt: number | null;
  assignedAt: number;
  updatedAt: number;
  endedAt: number | null;
  status: GuestTrancheLedgerStatus;
}

interface PortfolioPerformanceValuationItem {
  key: string;
  value: number;
}

/** Bounded account-currency valuation evidence used by deterministic performance calculations. */
export interface PortfolioPerformanceValuationSnapshot {
  timestamp: number;
  equity: number;
  currency: string;
  quality: 'current' | 'provisional';
  cashflowHistoryComplete: boolean;
  items: PortfolioPerformanceValuationItem[];
  pricedHoldings: number;
  unpricedHoldings: number;
  provider: string;
  brokerObservedAt: number | null;
  brokerReceivedAt: number | null;
}

export interface PortfolioState {
  // Active runtime properties (used by app.ts & renderBoard.ts)
  positions: Record<string, PositionRecord>;
  /** Read-only broker snapshot; never replaces app-owned cash/margin classifications. */
  /** User's persisted cash/margin classification for each broker ticker; unknown tickers default to cash. */
  activeTrancheTypes?: Record<string, ActiveTrancheType>;
  /** Per-operation share quantities for mixed cash/margin classifications. */
  activeTrancheMixes?: Record<string, ActiveTrancheMix>;