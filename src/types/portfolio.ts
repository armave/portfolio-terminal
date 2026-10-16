export interface Tranche {
  id: string;
  shares: number;
  entryPrice: number;
  purchaseDate: string;
  targetPrice?: number;
  notes?: string;
}

export interface TrancheItem {
  qty: number;
  price: number;
  date?: string;
  acquiredAt?: number;
  buyCommission?: number;
}

export interface QuoteDetails {
  change?: number;
  changePercent?: number;
  high?: number;
  low?: number;
  marketState?: string;
  price?: number;
  [key: string]: any;
}

export interface PositionRecord {
  ticker: string;
  shares: number;
  currentPrice: number;
  pt: number;
  commBuy: number;
  startDate?: string;
  tranches?: TrancheItem[];
  quoteUpdatedAt?: number;
  quoteSource?: string;
  quoteDetails?: QuoteDetails;
  /** Timestamp of the most recent manual trade; protects it from older quote responses. */
  lastTradeAt?: number;
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

interface CashStock {
  ticker: string;
  shares: number;
  currentPrice?: number;
}

interface CashStockHolding {
  ticker: string;
  shares: number | string;
  price?: number | string;
  currentPrice?: number | string;
  quoteUpdatedAt?: number;
  quoteSource?: string;
  quoteDetails?: QuoteDetails;
}

interface CashCushionState {
  freeCash: number | string;
  holdings: CashStockHolding[];
}

export interface ClosedTrade {
  id?: string;
  ticker: string;
  shares: number;
  avgBuyPrice?: number;
  entryPrice?: number;
  sellPrice?: number;
  exitPrice?: number;
  buyDate?: string;
  purchaseDate?: string;
  sellDate?: string;
  exitDate?: string;
  date?: number | string;
  closedAt?: number | string;
  grossProfit?: number;
  commissions?: number;
  feesAndCommissions?: number;
  totalCommissions?: number;
  marginInterest?: number;
  netProfit?: number;
  netRealizedGain?: number;
  holdingDays?: number;
}

export interface BrokerAssumptions {
  annualBorrowRate: number;
  dayCountBasis: 360 | 365;
  dailyRolloverCutoffArmenia: string;
  maintenanceEquityRatio: number;
  stopOutRatio: number;
  commissionMin: number;
  commissionPerShare: number;
  commissionRatePct: number;
  annualRate?: number;
  maintenanceMarginRatio?: number;
  commPerShare?: number;
  commVolumePct?: number;
  minCommOrder?: number;
}

export interface BrokerRules {
  broker?: string;
  annualRate: number;
  dayCountBasis: number;
  rolloverHour?: number;
  rolloverMinute?: number;
  rolloverTimeZone?: string;
  maintenanceMarginRatio: number;
  stopOutRatio: number;
  commPerShare?: number;
  commVolumePct?: number;
  minCommOrder?: number;
  annualBorrowRate?: number;
  dailyRolloverCutoffArmenia?: string;
  maintenanceEquityRatio?: number;
  commissionMin?: number;
  commissionPerShare?: number;
  commissionRatePct?: number;
  [key: string]: any;
}

interface ApiKeys {
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
  commit?: () => void;
  rollback?: () => void;
}

export interface PortfolioState {
  // Active runtime properties (used by app.ts & renderBoard.ts)
  positions: Record<string, PositionRecord>;
  cashCushion: CashCushionState;
  balance: number;
  realizedMarginCharged: number;
  tranches?: TrancheItem[];
  startDate?: string;
  activeView: string;
  closedTrades: ClosedTrade[];
  closedHistory?: ClosedTrade[];
  brokerAssumptions: BrokerRules;
  lastRolloverTimestamp?: number;
  lastUpdated?: number;
  gatewaySecret?: string;

  // Compatibility projections. Active positions are canonical; holdings is
  // regenerated from positions during normalization and must not be mutated directly.
  cashBalance: number;
  /** @deprecated Legacy bridge; derive from positions instead of treating as source data. */
  holdings: Holding[];
  cashStocks?: CashStock[];
  apiKeys: ApiKeys;
  selectedTicker?: string | null;
  autoRefreshInterval?: number;
  pendingMutation?: PendingMutation | null;
}

export type BoardState = Partial<PortfolioState>;