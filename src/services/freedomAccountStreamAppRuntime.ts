import { mergeBrokerExecutionHistory, preservePersistedBrokerFeeAllocations } from '../domain/closedHistoryFees';
import { emitBrokerEvent, addBrokerEventListener } from './brokerEventBus';
import {
  isCompleteFreedomActiveOrdersResponse,
  normalizeFreedomPortfolio,
  normalizeFreedomActiveOrders
} from './freedomAccountContracts';
import {
  normalizeFreedomTrades,
  parseFreedomOrderFillsResponse
} from './freedomTradeContracts';
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
  let activeSessionKey = '';
  let removeLiveFillsListener: (() => void) | null = null;

  const attachLiveFillsListener = (): void => {
    if (removeLiveFillsListener) return;
    removeLiveFillsListener = addBrokerEventListener('broker:live-order-fills', (event) => {
      if (
        !dependencies.isAdmin() ||
        event.sessionKey !== activeSessionKey ||
        event.sessionKey !== dependencies.getCurrentSessionKey() ||
        !Array.isArray(event.fills) ||
        event.fills.length === 0
      ) return;
      const savedRows = normalizeFreedomTrades(dependencies.loadSavedBrokerExecutions());
      const retainedRows = [...savedRows, ...dependencies.getCurrentBrokerExecutions()];
      const knownIds = new Set(retainedRows.map((trade) => String(trade.id)));
      const newFills = event.fills.filter((trade) => !knownIds.has(String(trade.id)));
      if (newFills.length === 0) return;
      const fillsWithPersistedFees = preservePersistedBrokerFeeAllocations(newFills, retainedRows);
      const mergedTrades = mergeBrokerExecutionHistory(retainedRows, fillsWithPersistedFees);
      emitBrokerEvent('broker:executed-trades', mergedTrades);
    });
  };

  const detachLiveFillsListener = (): void => {
    removeLiveFillsListener?.();
    removeLiveFillsListener = null;
  };
  const runtime = createFreedomAccountStreamRuntime({
    createTicket: dependencies.createTicket,
    buildSocketUrl: dependencies.buildSocketUrl,
    getCurrentSessionKey: dependencies.getCurrentSessionKey,
    onPortfolio: (data, sessionKey) => {
      if (!dependencies.isAdmin() || dependencies.getCurrentSessionKey() !== sessionKey) return false;
      try {
        const snapshot = normalizeFreedomPortfolio(data);
        if (!snapshot.loaded) return false;
        markFreedomAccountStreamSnapshot(sessionKey, 'portfolio');
        emitBrokerEvent('broker:account-info', snapshot);
        return true;
      } catch {
        // Do not mark an incomplete push as current. The REST recovery path
        // may still provide a valid snapshot while retaining last-known-good state.
        emitBrokerEvent('broker:account-info-error');
        return false;
      }
    },
    onOrders: (data, sessionKey) => {
      if (!dependencies.isAdmin() || dependencies.getCurrentSessionKey() !== sessionKey) return false;
      if (!isCompleteFreedomActiveOrdersResponse(data)) {
        emitBrokerEvent('broker:active-orders-error');
        return false;
      }
      const normalizedOrders = normalizeFreedomActiveOrders(data);
      markFreedomAccountStreamSnapshot(sessionKey, 'orders');
      emitBrokerEvent('broker:active-orders', normalizedOrders);

      const fillResponse = parseFreedomOrderFillsResponse(data);
      if (fillResponse.present && !fillResponse.valid) {
        emitBrokerEvent('broker:executed-trades-error');
      } else if (fillResponse.fills.length > 0) {
        emitBrokerEvent('broker:live-order-fills', { sessionKey, fills: fillResponse.fills });
      }
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
        detachLiveFillsListener();
        return Promise.resolve(false);
      }
      activeSessionKey = sessionKey;
      attachLiveFillsListener();
      return runtime.start(sessionKey);
    },
    stop: () => {
      runtime.stop();
      activeSessionKey = '';
      detachLiveFillsListener();
    },
    isConnected: () => runtime.isConnected()
  };
}
