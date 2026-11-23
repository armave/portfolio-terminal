import type {
  FreedomActiveOrder,
  FreedomPortfolioSnapshot
} from './api';
import type { BrokerDataQualityIssue, BrokerDataSnapshot, BrokerExecutionRequestPriority } from '../types/broker';
import type { FreedomExecutedTrade } from '../types/freedomTrade';

interface ActiveTrancheTypeRequest {
  ticker?: string;
  type?: 'cash' | 'margin' | 'mix';
  mix?: { cash?: number; margin?: number };
}

interface ActiveTrancheGuestAssignmentRequest {
  trancheId?: string;
  guestId?: string;
}

interface ClosedTradeAllocationRequest {
  rowId?: string;
  allocation?: {
    fundingType?: 'cash' | 'margin' | 'mix';
    cashQuantity?: number;
    marginQuantity?: number;
    guestId?: string;
  };
}

export interface BrokerEventPayloads {
  'broker:account-info': FreedomPortfolioSnapshot;
  /** Full normalized snapshot metadata; the legacy data-only event remains for existing consumers. */
  'broker:account-info-snapshot': BrokerDataSnapshot<FreedomPortfolioSnapshot>;
  'broker:account-info-refreshing': undefined;
  'broker:account-info-refresh-complete': undefined;
  'broker:account-info-error': BrokerDataQualityIssue | undefined;
  'broker:executed-trades': FreedomExecutedTrade[];
  'broker:executed-trades-refresh-complete': {
    source: 'rest';
    completedAt: number;
    sessionIdentity: string;
  };
  'broker:live-order-fills': FreedomExecutedTrade[];
  'broker:executed-trades-error': undefined;
  'broker:active-orders': FreedomActiveOrder[];
  'broker:active-orders-error': undefined;
  'broker:request-account-info': undefined;
  'broker:request-account-info-and-wait': { resolve: (success: boolean) => void };
  'broker:request-executed-trades': { priority?: BrokerExecutionRequestPriority } | undefined;
  'broker:request-executed-trades-and-wait': {
    resolve: (success: boolean) => void;
    priority?: BrokerExecutionRequestPriority;
  };
  'broker:request-closed-history-sync-and-wait': {
    mode: 'refresh' | 'recalculate';
    forceRefresh?: boolean;
    resolve: (success: boolean) => void;
  };
  'broker:request-active-orders': undefined;
  'broker:request-active-orders-and-wait': { resolve: (success: boolean) => void };
  'broker:set-active-tranche-type': ActiveTrancheTypeRequest;
  'broker:assign-active-tranche-guest': ActiveTrancheGuestAssignmentRequest;
  'broker:set-closed-trade-allocation': ClosedTradeAllocationRequest;
}

export type BrokerEventName = keyof BrokerEventPayloads;
type BrokerListener = (payload: unknown) => void;

const listeners = new Map<BrokerEventName, Set<BrokerListener>>();
const lastExecutedTradesRefreshBySession = new Map<string, number>();

/** Return the last provider-confirmed execution-history refresh for this session. */
export function getLastExecutedTradesRefreshAt(sessionIdentity: string): number | null {
  const timestamp = lastExecutedTradesRefreshBySession.get(sessionIdentity);
  return typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

/** Publish an in-process broker update or request without using window DOM events. */
export function emitBrokerEvent<K extends BrokerEventName>(
  type: K,
  ...args: undefined extends BrokerEventPayloads[K] ? [payload?: BrokerEventPayloads[K]] : [payload: BrokerEventPayloads[K]]
): void {
  const payload = args[0];
  if (type === 'broker:executed-trades-refresh-complete') {
    const refresh = payload as BrokerEventPayloads['broker:executed-trades-refresh-complete'];
    if (refresh && typeof refresh.sessionIdentity === 'string' && refresh.sessionIdentity.length > 0 &&
      Number.isFinite(refresh.completedAt) && refresh.completedAt > 0) {
      lastExecutedTradesRefreshBySession.delete(refresh.sessionIdentity);
      lastExecutedTradesRefreshBySession.set(refresh.sessionIdentity, refresh.completedAt);
      if (lastExecutedTradesRefreshBySession.size > 32) {
        const oldestSession = lastExecutedTradesRefreshBySession.keys().next().value;
        if (oldestSession !== undefined) lastExecutedTradesRefreshBySession.delete(oldestSession);
      }
    }
  }
  listeners.get(type)?.forEach((listener) => listener(payload));
}

/** Subscribe to a broker event. The returned disposer is safe to call more than once. */
export function addBrokerEventListener<K extends BrokerEventName>(
  type: K,
  listener: (payload: BrokerEventPayloads[K]) => void
): () => void {
  const bucket = listeners.get(type) ?? new Set<BrokerListener>();
  const wrapped: BrokerListener = (payload) => listener(payload as BrokerEventPayloads[K]);
  bucket.add(wrapped);
  listeners.set(type, bucket);

  return () => {
    bucket.delete(wrapped);
    if (bucket.size === 0) listeners.delete(type);
  };
}
