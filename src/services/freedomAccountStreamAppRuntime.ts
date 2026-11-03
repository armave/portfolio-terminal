import { mergeBrokerExecutionHistory, preservePersistedBrokerFeeAllocations } from '../domain/closedHistoryFees';
import { emitBrokerEvent, addBrokerEventListener } from './brokerEventBus';
import { normalizeFreedomPortfolio, normalizeFreedomActiveOrders } from './freedomAccountContracts';
import { normalizeFreedomOrderFills, normalizeFreedomTrades } from './freedomTradeContracts';
import { createFreedomAccountStreamRuntime } from './freedomAccountStreamRuntime';
import type { FreedomAccountStreamRuntime } from './freedomAccountStreamRuntime';
import {
  markFreedomAccountStreamSnapshot,
  setFreedomAccountStreamStatus
} from './freedomAccountStreamHealth';
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

  let activeSessionKey = '';
  const runtime = createFreedomAccountStreamRuntime({
    createTicket: dependencies.createTicket,
    buildSocketUrl: dependencies.buildSocketUrl,
    getCurrentSessionKey: dependencies.getCurrentSessionKey,
    onPortfolio: (data, sessionKey) => {
      if (!dependencies.isAdmin() || dependencies.getCurrentSessionKey() !== sessionKey) return false;
      const snapshot = normalizeFreedomPortfolio(data);
      if (!snapshot.loaded) return false;
      markFreedomAccountStreamSnapshot(sessionKey, 'portfolio');
      emitBrokerEvent('broker:account-info', snapshot);
      return true;
    },
    onOrders: (data, sessionKey) => {
      if (!dependencies.isAdmin() || dependencies.getCurrentSessionKey() !== sessionKey) return false;
      const normalizedOrders = normalizeFreedomActiveOrders(data);
      markFreedomAccountStreamSnapshot(sessionKey, 'orders');
      emitBrokerEvent('broker:active-orders', normalizedOrders);
      const fills = normalizeFreedomOrderFills(data);
      if (fills.length > 0) emitBrokerEvent('broker:live-order-fills', fills);
      return true;
    },
    onStatus: (status, message) => {
      if (activeSessionKey) setFreedomAccountStreamStatus(activeSessionKey, status);
      dependencies.onStatus?.(status, message);
    }
  });

  return {
    start: (sessionKey: string) => {
      if (!dependencies.isAdmin() || !sessionKey.startsWith('admin:')) {
        runtime.stop();
        activeSessionKey = '';
        return Promise.resolve(false);
      }
      activeSessionKey = sessionKey;
      return runtime.start(sessionKey);
    },
    stop: () => {
      runtime.stop();
      activeSessionKey = '';
    },
    isConnected: () => runtime.isConnected()
  };
}
