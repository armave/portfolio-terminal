export interface BrokerAssumptions {
  annualMarginRate: number;      // e.g. 13.5
  interestDayCount: 360 | 365;
  maintenanceMarginRatio: number;// e.g. 0.25 (25%)
  stopOutRatio: number;          // e.g. 0.15 (15%)
  rolloverTime: string;          // e.g. "04:00"
  commissionPerShare: number;    // e.g. 0.012
  commissionVolumeRatio: number; // e.g. 0.0012 (0.12%)
  minimumCommission: number;     // e.g. 1.20
}

export interface PositionTranche {
  shares: number;
  entryPrice: number;
  entryDate: string;
  commission: number;
}

export interface MarginPosition {
  ticker: string;
  tranches: PositionTranche[];
  accruedMarginDebt: number;
  allocatedCollateral?: number;
}

export interface CashHolding {
  ticker: string;
  shares: number;
  entryPrice?: number;
}

export interface ClosedTrade {
  id: string;
  ticker: string;
  dateClosed: string;
  shares: number;
  durationDays: number;
  totalFeesAndComms: number;
  netProfit: number;
}

export interface PortfolioState {
  positions: MarginPosition[];
  cashHoldings: CashHolding[];
  closedTrades: ClosedTrade[];
  cashBalance: number;
  gatewaySecret?: string;
  lastRolloverTimestamp?: number;
  quoteRefreshInterval?: number;
}