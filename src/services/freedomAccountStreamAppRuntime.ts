import { mergeBrokerExecutionHistory, preservePersistedBrokerFeeAllocations } from '../domain/closedHistoryFees';
import { emitBrokerEvent, addBrokerEventListener } from './brokerEventBus';
import { normalizeFreedomPortfolio, normalizeFreedomActiveOrders } from './freedomAccountContracts';
import { normalizeFreedomOrderFills, normalizeFreedomTrades } from './freedomTradeContracts';
import { createFreedomAccountStreamRuntime } from './freedomAccountStreamRuntime';
import type { FreedomAccountStreamRuntime } from './freedomAccountStreamRuntime';
import type { FreedomExecutedTrade } from '../types/freedomTrade';

export interface FreedomAccountStreamAppDependencies {
  createTicket: () => Promise<{ ticket: string }>;
  buildSocketUrl: (ticket: string) => string;
  getCurrentSessionKey: () => string;
  isAdmin: () => boolean;
  loadSavedBrokerExecutions: () => FreedomExecutedTrade[];
  getCurrentBrokerExecutions: () => FreedomExecutedTrade[];
  onStatus?: (status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected', message?: string) => void;
}

/** Connects sanitized TradeNet events to the app's existing broker event and history contracts. */
export function createFreedomAccountStreamAppRuntime(
  dependencies: FreedomAccountStreamAppDependencies
): FreedomAccountStreamRuntime {
  addBrokerEventListener('broker:live-order-fills', (fills) => {
    if (!dependencies.isAdmin() || !Array.isArray(fills) || fills.length === 0) return;
    const savedRows = normalizeFreedomTrades(dependencies.loadSavedBrokerExecutions());
    const retainedRows = [...savedRows, ...dependencies.getCurrentBrokerExecutions()];
    const knownIds = new Set(retainedRows.map((trade) => String(trade.id)));
    const newFills = fills.filter((trade) => !knownIds.has(String(trade.id)));
    if (newFills.length === 0) return;
    const fillsWithPersistedFees = preservePersistedBrokerFeeAllocations(newFills, retainedRows);
    const mergedTrades = mergeBrokerExecutionHistory(retainedRows, fillsWithPersistedFees);
    emitBrokerEvent('broker:executed-trades', mergedTrades);
  });

  const runtime = createFreedomAccountStreamRuntime({
    createTicket: dependencies.createTicket,
    buildSocketUrl: dependencies.buildSocketUrl,
    getCurrentSessionKey: dependencies.getCurrentSessionKey,
    onPortfolio: (data, sessionKey) => {
      if (!dependencies.isAdmin() || dependencies.getCurrentSessionKey() !== sessionKey) return;
      const snapshot = normalizeFreedomPortfolio(data);
      if (snapshot.loaded) emitBrokerEvent('broker:account-info', snapshot);
    },
    onOrders: (data, sessionKey) => {
      if (!dependencies.isAdmin() || dependencies.getCurrentSessionKey() !== sessionKey) return;
      emitBrokerEvent('broker:active-orders', normalizeFreedomActiveOrders(data));
      const fills = normalizeFreedomOrderFills(data);
      if (fills.length > 0) emitBrokerEvent('broker:live-order-fills', fills);
    },
    onStatus: dependencies.onStatus
  });

  return {
    start: (sessionKey: string) => {
      if (!dependencies.isAdmin() || !sessionKey.startsWith('admin:')) {
        runtime.stop();
        return Promise.resolve(false);
      }
      return runtime.start(sessionKey);
    },
    stop: () => runtime.stop(),
    isConnected: () => runtime.isConnected()
  };
}
