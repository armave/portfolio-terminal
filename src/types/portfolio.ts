export interface Tranche {
  id: string;
  shares: number;
  entryPrice: number;
  purchaseDate: string; // YYYY-MM-DD
  targetPrice?: number;
  notes?: string;
}

export interface Holding {
  ticker: string;
  isMargin: boolean;
  tranches: Tranche[];
  currentPrice?: number;
  premarketPrice?: number;
  analystTarget?: number;
  notes?: string;
  quoteOverrides?: {
    finnhub?: string;
    stooq?: string;
  };
}

export interface CashStock {
  ticker: string;
  shares: number;
  currentPrice?: number;
}

export interface ClosedTrade {
  id: string;
  ticker: string;
  shares: number;
  entryPrice: number;
  exitPrice: number;
  purchaseDate: string;
  exitDate: string;
  netRealizedGain: number;
  totalCommissions: number;
  holdingDays?: number;
}

export interface BrokerAssumptions {
  annualBorrowRate: number; // e.g. 0.0825
  dayCountBasis: 360 | 365;
  dailyRolloverCutoffArmenia: string; // e.g. "23:00"
  maintenanceEquityRatio: number; // e.g. 0.25
  stopOutRatio: number; // e.g. 0.15
  commissionMin: number;
  commissionPerShare: number;
  commissionRatePct: number;
}

export interface ApiKeys {
  finnhub?: string;
  twelveData?: string;
  alphaVantage?: string;
  rapidApiYahoo?: string;
  gemini?: string;
  gistToken?: string;
  gistId?: string;
}

export interface PendingMutation {
  id: string;
  description: string;
  payload?: unknown;
  timestamp?: number;
}

export interface PortfolioState {
  cashBalance: number;
  holdings: Holding[];
  cashStocks?: CashStock[];
  closedTrades: ClosedTrade[];
  brokerAssumptions: BrokerAssumptions;
  apiKeys: ApiKeys;
  selectedTicker?: string | null;
  autoRefreshInterval?: number;
  pendingMutation?: PendingMutation | null;
  lastUpdated?: number;
}