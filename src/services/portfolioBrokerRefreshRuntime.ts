import { emitBrokerEvent } from './brokerEventBus';
import type { BrokerExecutionRequestPriority } from '../types/broker';

/** Typed event emitter seam used by the broker request/wait adapter. */
export type BrokerEventEmitter = typeof emitBrokerEvent;

export interface PortfolioBrokerRefreshRuntime {
  requestAccountInfo: () => void;
  requestExecutedTrades: (priority?: BrokerExecutionRequestPriority) => void;
  requestActiveOrders: () => void;
  requestAll: () => void;
  refreshAccountInfo: () => Promise<boolean>;
  refreshExecutedTrades: (priority?: BrokerExecutionRequestPriority) => Promise<boolean>;
  refreshActiveOrders: () => Promise<boolean>;
}

/**
 * Centralizes broker request events used by manual and scheduled refresh flows.
 * Response handling, broker classification, and portfolio mutations stay in
 * their existing app-owned handlers; this runtime only emits typed requests.
 */
export function createPortfolioBrokerRefreshRuntime(
  emit: BrokerEventEmitter = emitBrokerEvent
): PortfolioBrokerRefreshRuntime {
  const requestAccountInfo = (): void => emit('broker:request-account-info');
  const requestExecutedTrades = (priority?: BrokerExecutionRequestPriority): void => {
    if (priority) emit('broker:request-executed-trades', { priority });
    else emit('broker:request-executed-trades');
  };
  const requestActiveOrders = (): void => emit('broker:request-active-orders');

  const refreshAccountInfo = (): Promise<boolean> => new Promise((resolve) => {
    emit('broker:request-account-info-and-wait', { resolve });
  });
  const refreshExecutedTrades = (priority?: BrokerExecutionRequestPriority): Promise<boolean> => new Promise((resolve) => {
    emit('broker:request-executed-trades-and-wait', {
      resolve,
      ...(priority ? { priority } : {})
    });
  });
  const refreshActiveOrders = (): Promise<boolean> => new Promise((resolve) => {
    emit('broker:request-active-orders-and-wait', { resolve });
  });

  const requestAll = (): void => {
    requestAccountInfo();
    requestExecutedTrades();
    requestActiveOrders();
  };

  return {
    requestAccountInfo,
    requestExecutedTrades,
    requestActiveOrders,
    requestAll,
    refreshAccountInfo,
    refreshExecutedTrades,
    refreshActiveOrders
  };
}
