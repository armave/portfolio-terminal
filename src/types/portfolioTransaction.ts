export const PORTFOLIO_TRANSACTION_EVENT_SCHEMA_VERSION = 1 as const;

export type PortfolioTransactionEventType =
  | 'trade.buy'
  | 'trade.sell'
  | 'cash-holding.buy'
  | 'cash-holding.sell'
  | 'cash-holding.adjustment'
  | 'position.adjustment'
  | 'history.correction'
  | 'portfolio.reset'
  | 'cash.adjustment'
  | 'cash.transfer'
  | 'dividend'
  | 'fee'
  | 'margin.adjustment'
  | 'margin.interest'
  | 'corporate-action'
  | 'correction';

export type PortfolioTransactionActorType =
  | 'user'
  | 'system'
  | 'broker'
  | 'ai'
  | 'import'
  | 'unknown';

interface PortfolioTransactionActor {
  type: PortfolioTransactionActorType;
  /** Stable user/service identity when the caller is authorized to provide one. */
  id?: string;
}

export interface PortfolioTransactionEvent {
  id: string;
  schemaVersion: typeof PORTFOLIO_TRANSACTION_EVENT_SCHEMA_VERSION;
  type: PortfolioTransactionEventType;
  actor: PortfolioTransactionActor;
  /** Origin of the command, not the storage mechanism. */
  source: string;
  /** Effective business timestamp supplied by the command or transaction date. */
  effectiveAt: number;
  /** Local commit timestamp assigned when the event is appended. */
  recordedAt: number;
  /** Optional caller-supplied key; unique within this portfolio journal. */
  idempotencyKey?: string;
  /** Non-secret canonical command fingerprint to reject key reuse for a different command. */
  requestFingerprint?: string;
  ticker?: string;
  currency?: string;
  quantity?: number;
  unitPrice?: number;
  grossAmount?: number;
  /** Fees/commissions attributed to this event in the event currency. */
  fees?: number;
  /** Financing/interest cost allocated to this transaction, separate from commissions. */
  financingCost?: number;
  /** Signed change in available free cash. */
  cashDelta?: number;
  /** Positive means margin debt increased; negative means it was repaid. */
  marginDebtDelta?: number;
  /** Net proceeds for a sale, after sell commission and before debt-first allocation. */
  netAmount?: number;
  /** Realized profit/loss when the event closes or reduces a position. */
  realizedPnl?: number;
  relatedEventId?: string;
  note?: string;
}

export interface PortfolioTransactionDraft {
  type: PortfolioTransactionEventType;
  effectiveAt: number;
  ticker?: string;
  currency?: string;
  quantity?: number;
  unitPrice?: number;
  grossAmount?: number;
  fees?: number;
  financingCost?: number;
  cashDelta?: number;
  marginDebtDelta?: number;
  netAmount?: number;
  realizedPnl?: number;
  relatedEventId?: string;
  note?: string;
}

export interface PortfolioTransactionContext {
  idempotencyKey?: string;
  requestFingerprint?: string;
  actor?: PortfolioTransactionActor;
  source?: string;
  /** Optional override for the event's business/effective timestamp. */
  effectiveAt?: number;
  /** Deterministic identifiers/timestamps are exposed for import/replay tests. */
  eventId?: string;
  recordedAt?: number;
}
