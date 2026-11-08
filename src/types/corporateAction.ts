export type CorporateActionKind =
  | 'stock_split'
  | 'reverse_split'
  | 'cash_dividend'
  | 'symbol_change'
  | 'merger'
  | 'spin_off';

export interface CorporateActionEvent {
  id: string;
  sourceId: string;
  symbol: string;
  kind: 'stock_split' | 'reverse_split' | 'cash_dividend';
  effectiveDate: string;
  fromFactor?: number;
  toFactor?: number;
  /** New shares received per old share. A 2-for-1 split is represented as 1 -> 2. */
  sharesAfterPerShareBefore?: number;
  amountPerShare?: number | null;
  currency?: string | null;
  payDate?: string | null;
  recordDate?: string | null;
  declarationDate?: string | null;
  provider: string;
  receivedAt: number;
}

export type PortfolioCorporateActionStatus = 'applied' | 'review_required' | 'not_applicable';

export interface PortfolioCorporateActionEvent {
  schemaVersion: 1;
  id: string;
  sourceId: string;
  ticker: string;
  kind: CorporateActionKind;
  effectiveAt: number;
  recordedAt: number;
  provider: string;
  receivedAt: number;
  status: PortfolioCorporateActionStatus;
  fromFactor?: number;
  toFactor?: number;
  sharesAfterPerShareBefore?: number;
  amountPerShare?: number | null;
  currency?: string | null;
  payDate?: string;
  recordDate?: string;
  declarationDate?: string;
  newSymbol?: string;
  note?: string;
}

export type CorporateActionFeedQuality = 'complete' | 'partial' | 'unavailable';

export interface CorporateActionFeedResult {
  events: CorporateActionEvent[];
  quality: CorporateActionFeedQuality;
  issues: string[];
}
