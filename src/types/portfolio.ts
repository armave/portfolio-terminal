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
  /** Freshness is unknown unless the provider supplies a verifiable observation timestamp. */
  freshness?: 'fresh' | 'stale' | 'delayed' | 'unknown';
  /** Time this client received the response; not necessarily the market observation time. */
  receivedAt?: number;
  /** Provider-reported market observation time, when available. */
  sourceTimestamp?: number;
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
  /** Local request start time used to reject out-of-order quote responses. */
  quoteRequestStartedAt?: number;
  /** Monotonic quote request ordering token, time-anchored for reload compatibility. */
  quoteRequestSequence?: number;
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
  /** Local request start time used to reject out-of-order quote responses. */
  quoteRequestStartedAt?: number;
  /** Monotonic quote request ordering token, time-anchored for reload compatibility. */
  quoteRequestSequence?: number;
}

interface CashStockHolding {
  ticker: string;
  shares: number | string;
  /** Weighted average entry price of the still-open cash-allocated purchase lots. */
  averagePrice?: number | null;
  price?: number | string;
  currentPrice?: number | string;
  quoteUpdatedAt?: number;
  /** Local request start time used to reject out-of-order quote responses. */
  quoteRequestStartedAt?: number;
  /** Monotonic quote request ordering token, time-anchored for reload compatibility. */
  quoteRequestSequence?: number;
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

export type ActiveTrancheType = 'cash' | 'margin' | 'mix';

export interface ActiveTrancheMix {
  cash: number;
  margin: number;
}

/** A guest who has been linked to a closed trade, retained for assignment history. */
interface ClosedTradeGuestAssignmentHistory {
  guestId: string;
  assignedQuantity: number;
  assignedAt: number;
}

/** Persisted administrator-editable funding and guest metadata for a closed-history row. */
export interface ClosedTradeAllocation {
  fundingType: ActiveTrancheType;
  cashQuantity: number;
  marginQuantity: number;
  guestId?: string;
  assignedAt?: number;
  guestAssignments?: ClosedTradeGuestAssignmentHistory[];
}

export interface ActiveBrokerTranche {
  /** Stable identity for the open purchase operation or a 5-minute grouped batch. */
  id: string;
  ticker: string;
  name: string;
  quantity: number;
  marketPrice: number | null;
  averagePrice: number | null;
  marketValue: number | null;
  /** Broker purchase timestamp when supplied. */
  purchasedAt: number | null;
  /** Estimated or broker-reported buy commission allocated to the still-open quantity. */
  buyCommission?: number;
}

export type GuestTrancheLedgerStatus = 'active' | 'closed' | 'unassigned';

export interface ActiveTrancheGuestAssignmentDetail {
  assignmentId: string;
  guestId: string;
  assignedAt: number;
  assignedQuantity: number;
}

/** Durable history for a cash-backed tranche assignment to one guest account. */
export interface GuestTrancheLedgerRecord {
  assignmentId: string;
  trancheId: string;
  ticker: string;
  name: string;
  assignedQuantity: number;
  openQuantity: number;
  averagePrice: number | null;
  /** Market value is optional because closed tranches have no current valuation. */
  marketPrice?: number | null;
  marketValue?: number | null;
  purchasedAt: number | null;
  assignedAt: number;
  updatedAt: number;
  endedAt: number | null;
  status: GuestTrancheLedgerStatus;
}

export interface PortfolioState {
  // Active runtime properties (used by app.ts & renderBoard.ts)
  positions: Record<string, PositionRecord>;
  /** Read-only broker snapshot; never replaces app-owned cash/margin classifications. */
  /** User's persisted cash/margin classification for each broker ticker; unknown tickers default to cash. */
  activeTrancheTypes?: Record<string, ActiveTrancheType>;
  /** Per-operation share quantities for mixed cash/margin classifications. */
  activeTrancheMixes?: Record<string, ActiveTrancheMix>;
  /** Guest account linked to each active operation's cash-funded share quantity. */
  activeTrancheGuestAssignments?: Record<string, string>;
  /** Stable per-assignment lifecycle metadata used to reconcile persistent guest history. */
  activeTrancheGuestAssignmentDetails?: Record<string, ActiveTrancheGuestAssignmentDetail>;
  /** Manual funding / guest overrides keyed by a stable closed-history row identity. */
  closedTradeAllocations?: Record<string, ClosedTradeAllocation>;
  /** Server-filtered tranche projection returned only to the signed-in guest. */
  guestPortfolioSnapshot?: { updatedAt: number; tranches: ActiveBrokerTranche[] };
  /** Server-filtered assignment history returned only to the signed-in guest. */
  guestTrancheLedger?: GuestTrancheLedgerRecord[];
  brokerAccountInfo?: {
    loaded: boolean;
    balances: Array<{ currency: string; amount: number; forecastIn: number; forecastOut: number; t2In: number; t2Out: number }>;
    positions: Array<{
      ticker: string; name: string; quantity: number; currency: string;
      marketPrice: number | null; marketValue: number | null; averagePrice: number | null;
      profitClose: number | null; accountPositionId: number | null;
    }>;
    /** Current when the latest API refresh succeeded; stale after a failed refresh. */
    status?: 'current' | 'stale' | 'unavailable';
    receivedAt: number;
  };
  cashCushion: CashCushionState;
  balance: number;
  /** Derived total equity synced with the rest of the portfolio snapshot. */
  portfolioEquity?: number;
  /** Timestamp of the last persisted equity recalculation. */
  portfolioEquityUpdatedAt?: number;
  realizedMarginCharged: number;
  tranches?: TrancheItem[];
  startDate?: string;
  activeView: string;
  closedTrades: ClosedTrade[];
  /** Persisted raw executed-trade snapshot from the broker, used to reconcile closed history and allocate broker cashflow fees. */
  brokerExecutedTrades?: Array<Record<string, any>>;
  closedHistory?: ClosedTrade[];
  /** Normalized broker-reported cashflows, stored separately from closed trade P&L. */
  cashflows?: Array<{ id: string; date: string; type: string; amount: number; currency?: string; description?: string; raw?: Record<string, string> }>;
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