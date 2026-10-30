import type {
  FreedomActiveOrder,
  FreedomExecutedTrade,
  FreedomPortfolioSnapshot
} from './api';

interface ActiveTrancheTypeRequest {
  ticker?: string;
  type?: 'cash' | 'margin' | 'mix';
  mix?: { cash?: number; margin?: number };
}

export interface BrokerEventPayloads {
  'broker:account-info': FreedomPortfolioSnapshot;
  'broker:account-info-error': undefined;
  'broker:executed-trades': FreedomExecutedTrade[];
  'broker:executed-trades-error': undefined;
  'broker:active-orders': FreedomActiveOrder[];
  'broker:active-orders-error': undefined;
  'broker:request-executed-trades': undefined;
  'broker:request-active-orders': undefined;
  'broker:set-active-tranche-type': ActiveTrancheTypeRequest;
}

export type BrokerEventName = keyof BrokerEventPayloads;
type BrokerListener = (payload: unknown) => void;

const listeners = new Map<BrokerEventName, Set<BrokerListener>>();

/** Publish an in-process broker update or request without using window DOM events. */
export function emitBrokerEvent<K extends BrokerEventName>(
  type: K,
  ...args: BrokerEventPayloads[K] extends undefined ? [payload?: undefined] : [payload: BrokerEventPayloads[K]]
): void {
  const payload = args[0];
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
