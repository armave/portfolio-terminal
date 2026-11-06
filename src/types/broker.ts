export type BrokerProviderId = string;

type BrokerAuthenticationStatus =
  | 'unknown' | 'unauthenticated' | 'authenticating' | 'authenticated' | 'expired' | 'error';

export interface BrokerAuthenticationState {
  status: BrokerAuthenticationStatus;
  checkedAt?: number;
  authenticatedAt?: number;
  expiresAt?: number;
}

export type BrokerSnapshotQuality = 'complete' | 'partial' | 'empty';
type BrokerSnapshotSource = 'rest' | 'websocket' | 'cache' | 'manual';

export interface BrokerAdapterContext {
  receivedAt?: number;
  /** Set only when the provider supplies a verifiable source observation timestamp. */
  observedAt?: number;
  source?: BrokerSnapshotSource;
}

export interface BrokerDataSnapshot<T> {
  provider: BrokerProviderId;
  data: T;
  quality: BrokerSnapshotQuality;
  source: BrokerSnapshotSource;
  receivedAt: number;
  observedAt?: number;
  warnings: string[];
}

/** Safe quality-only context for rejecting an incomplete broker snapshot. */
export interface BrokerDataQualityIssue {
  provider: BrokerProviderId;
  quality: BrokerSnapshotQuality;
  source: BrokerSnapshotSource;
  receivedAt: number;
  observedAt?: number;
  warnings: string[];
}

export interface BrokerCashBalance {
  currency: string;
  amount: number;
  forecastIn: number;
  forecastOut: number;
  t2In: number;
  t2Out: number;
}

export interface BrokerPosition {
  ticker: string;
  name: string;
  quantity: number;
  currency: string;
  marketPrice: number | null;
  marketValue: number | null;
  averagePrice: number | null;
  profitClose: number | null;
  accountPositionId: number | null;
}

export interface BrokerPortfolioSnapshot {
  loaded: boolean;
  balances: BrokerCashBalance[];
  positions: BrokerPosition[];
}

export interface BrokerActiveOrder {
  id: string;
  ticker: string;
  operation: number | null;
  orderType: number | null;
  limitPrice: number | null;
  remainingQuantity: number | null;
  date?: string | number | null;
  status: string;
  raw: Record<string, unknown>;
}

export interface BrokerExecution {
  id: string;
  ticker: string;
  side: string;
  quantity: number | null;
  price: number | null;
  currency: string;
  executedAt: string | null;
  tradeValue: number | null;
  profit: number | null;
  marginFee: number | null;
  commission: number | null;
  commissionCurrency: string;
  raw: Record<string, unknown>;
  /** App-calculated/persisted metadata is kept distinct from broker-reported facts. */
  marginFeeAllocations?: Record<string, number>;
  feesAndCommissions?: number;
  netProfit?: number | null;
}

export interface BrokerCashflow {
  id: string;
  date: string;
  type: string;
  amount: number;
  currency?: string;
  description?: string;
  raw: Record<string, string>;
}

export type BrokerAdapterErrorCode =
  | 'authentication_required' | 'rate_limited' | 'timeout' | 'network'
  | 'malformed_response' | 'unsupported' | 'unavailable' | 'unknown';

export interface BrokerAdapterError {
  name: 'BrokerAdapterError';
  provider: BrokerProviderId;
  code: BrokerAdapterErrorCode;
  message: string;
  retryable: boolean;
  requiresReauthentication: boolean;
  httpStatus?: number;
  cause?: unknown;
}

interface BrokerAdapterCapabilities {
  readonly portfolios: boolean;
  readonly positions: boolean;
  readonly balances: boolean;
  readonly executions: boolean;
  readonly activeOrders: boolean;
  readonly cashflows: boolean;
  readonly orderPlacement: false;
}

export interface BrokerAdapterTransport {
  fetchPortfolio(): Promise<unknown>;
  fetchActiveOrders(): Promise<unknown>;
  fetchExecutions(fromDate?: string): Promise<unknown>;
  fetchCashflows(fromDate?: string): Promise<unknown>;
}

/**
 * Provider boundary. Implementations translate provider payloads to the shared
 * contracts above; portfolio, performance, risk, and presentation code must
 * not inspect provider-specific response shapes.
 */
export interface BrokerAdapter {
  readonly provider: BrokerProviderId;
  readonly displayName: string;
  readonly readOnly: true;
  readonly capabilities: BrokerAdapterCapabilities;
  readonly fetchPortfolio: () => Promise<unknown>;
  readonly fetchActiveOrders: () => Promise<unknown>;
  readonly fetchExecutions: (fromDate?: string) => Promise<unknown>;
  readonly fetchCashflows: (fromDate?: string) => Promise<unknown>;
  readonly getAuthenticationState: (input?: {
    authenticated?: boolean;
    error?: unknown;
    checkedAt?: number;
  }) => BrokerAuthenticationState;
  readonly normalizePortfolio: (
    response: unknown,
    context?: BrokerAdapterContext
  ) => BrokerDataSnapshot<BrokerPortfolioSnapshot>;
  readonly normalizeActiveOrders: (
    response: unknown,
    context?: BrokerAdapterContext
  ) => BrokerDataSnapshot<BrokerActiveOrder[]>;
  readonly normalizeExecutions: (
    response: unknown,
    context?: BrokerAdapterContext
  ) => BrokerDataSnapshot<BrokerExecution[]>;
  readonly normalizeExecutionFills: (
    response: unknown,
    context?: BrokerAdapterContext
  ) => BrokerDataSnapshot<BrokerExecution[]>;
  readonly normalizeCashflows: (
    response: unknown,
    context?: BrokerAdapterContext
  ) => BrokerDataSnapshot<BrokerCashflow[]>;
  readonly classifyError: (error: unknown) => BrokerAdapterError;
}
