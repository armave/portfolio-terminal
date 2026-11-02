import { emitBrokerEvent } from './brokerEventBus';
import {
  fetchFreedomTradeNetActiveOrders,
  fetchFreedomTradeNetPositions,
  fetchFreedomTradeNetTrades,
  normalizeFreedomActiveOrders,
  normalizeFreedomPortfolio,
  normalizeFreedomTrades
} from './api';
import {
  hasFreedomTradeHistoryBaseline,
  loadSavedHistory,
  markFreedomTradeHistoryBaseline,
  restoreGatewaySecret
} from './storage';
import type { BrokerEventEmitter } from './portfolioBrokerRefreshRuntime';
import type { ActiveOrdersRefreshDependencies } from './activeOrdersRefresh';
import { refreshActiveOrders } from './activeOrdersRefresh';
import type { FreedomActiveOrder, FreedomPortfolioSnapshot } from './freedomAccountContracts';
import type { FreedomExecutedTrade } from '../types/freedomTrade';
import type { SessionIdentityToken } from '../utils/sessionIdentityGuard';
import { getSessionIdentityRequestKey } from '../utils/sessionIdentityGuard';
import {
  mergeBrokerExecutionHistory,
  preservePersistedBrokerFeeAllocations
} from '../domain/closedHistoryFees';
import { getLatestClosedTradeDate } from '../domain/tradeHistorySync';

export interface PortfolioBrokerDataRuntimeDependencies {
  /** Current account ID is captured by the caller for the active React session. */
  getAccountId: () => string;
  /** Session-generation guard; all asynchronous boundaries recheck it. */
  isSessionCurrent: (session: SessionIdentityToken) => boolean;
  /** Optional overrides keep provider/storage boundaries directly testable. */
  restoreGatewaySecret?: () => Promise<string>;
  fetchAccountInfo?: () => Promise<unknown>;
  normalizeAccountInfo?: (response: unknown) => FreedomPortfolioSnapshot;
  fetchExecutedTrades?: (fromDate?: string) => Promise<unknown>;
  normalizeExecutedTrades?: (response: unknown) => FreedomExecutedTrade[];
  loadSavedBrokerExecutions?: () => FreedomExecutedTrade[];
  getCurrentBrokerExecutions: () => FreedomExecutedTrade[];
  getClosedTrades: () => readonly unknown[];
  hasHistoryBaseline?: (accountId: string) => boolean;
  markHistoryBaseline?: (accountId: string) => boolean;
  setBrokerExecutions: (executions: FreedomExecutedTrade[]) => void;
  fetchActiveOrders?: () => Promise<unknown>;
  normalizeActiveOrders?: (response: unknown) => FreedomActiveOrder[];
  refreshOrders?: (
    dependencies: ActiveOrdersRefreshDependencies<unknown, FreedomActiveOrder>
  ) => Promise<void>;
  emit?: BrokerEventEmitter;
  logError?: (message: string, error: unknown) => void;
}

export interface PortfolioBrokerDataRuntime {
  loadFreedomAccount: (session: SessionIdentityToken) => Promise<boolean>;
  refreshAccountInfo: (session: SessionIdentityToken) => Promise<boolean>;
  loadExecutedTrades: (session: SessionIdentityToken) => Promise<boolean>;
  loadActiveOrders: (session: SessionIdentityToken) => Promise<boolean>;
}

/**
 * Owns administrator broker read workflows. The app injects its account session
 * guard and single portfolio-store boundary; this runtime owns request
 * coalescing, provider sequencing, fee-safe history merging, and broker events.
 */
export function createPortfolioBrokerDataRuntime(
  dependencies: PortfolioBrokerDataRuntimeDependencies
): PortfolioBrokerDataRuntime {
  const accountRequests = new Map<string, Promise<boolean>>();
  const tradesRequests = new Map<string, Promise<boolean>>();
  const activeOrdersRequests = new Map<string, Promise<boolean>>();
  const emit = dependencies.emit || emitBrokerEvent;
  const refreshOrders = dependencies.refreshOrders || refreshActiveOrders;
  const restoreSecret = dependencies.restoreGatewaySecret || restoreGatewaySecret;
  const fetchAccountInfo = dependencies.fetchAccountInfo || fetchFreedomTradeNetPositions;
  const normalizeAccountInfo = dependencies.normalizeAccountInfo || normalizeFreedomPortfolio;
  const fetchExecutedTrades = dependencies.fetchExecutedTrades || fetchFreedomTradeNetTrades;
  const normalizeExecutedTrades = dependencies.normalizeExecutedTrades || normalizeFreedomTrades;
  const loadSavedBrokerExecutions = dependencies.loadSavedBrokerExecutions ||
    (() => normalizeFreedomTrades(loadSavedHistory().brokerExecutedTrades));
  const hasHistoryBaseline = dependencies.hasHistoryBaseline || hasFreedomTradeHistoryBaseline;
  const markHistoryBaseline = dependencies.markHistoryBaseline || markFreedomTradeHistoryBaseline;
  const fetchActiveOrders = dependencies.fetchActiveOrders || fetchFreedomTradeNetActiveOrders;
  const normalizeActiveOrders = dependencies.normalizeActiveOrders || normalizeFreedomActiveOrders;
  const logError = dependencies.logError || ((message, error) => console.error(message, error));

  const loadFreedomAccount = async (session: SessionIdentityToken): Promise<boolean> => {
    if (!dependencies.isSessionCurrent(session)) return false;
    const requestKey = getSessionIdentityRequestKey(session);
    const existing = accountRequests.get(requestKey);
    if (existing) return existing;

    emit('broker:account-info-refreshing');
    const request = (async () => {
      const secret = await restoreSecret();
      if (!secret.trim()) throw new Error('Gateway Secret is not available.');
      if (!dependencies.isSessionCurrent(session)) return false;

      const response = await fetchAccountInfo();
      if (!dependencies.isSessionCurrent(session)) return false;

      const snapshot = normalizeAccountInfo(response);
      if (!dependencies.isSessionCurrent(session)) return false;

      emit('broker:account-info', snapshot);
      return snapshot.loaded === true;
    })();

    accountRequests.set(requestKey, request);
    try {
      return await request;
    } finally {
      if (accountRequests.get(requestKey) === request) accountRequests.delete(requestKey);
    }
  };

  const refreshAccountInfo = async (session: SessionIdentityToken): Promise<boolean> => {
    try {
      return await loadFreedomAccount(session);
    } catch {
      // An old account's rejection must never mark the next account's snapshot stale.
      if (dependencies.isSessionCurrent(session)) emit('broker:account-info-error');
      return false;
    }
  };

  const loadExecutedTrades = async (session: SessionIdentityToken): Promise<boolean> => {
    if (!dependencies.isSessionCurrent(session)) return false;
    const requestKey = getSessionIdentityRequestKey(session);
    const existing = tradesRequests.get(requestKey);
    if (existing) return existing;

    const request = (async (): Promise<boolean> => {
      try {
        // Restore the encrypted Gateway Secret before any provider request.
        const secret = await restoreSecret();
        if (!dependencies.isSessionCurrent(session)) return false;
        if (!secret.trim()) {
          emit('broker:executed-trades-error');
          return false;
        }

        const accountId = dependencies.getAccountId();
        const savedExecutions = loadSavedBrokerExecutions();
        const currentExecutions = dependencies.getCurrentBrokerExecutions();
        const hasCompleteBaseline = hasHistoryBaseline(accountId);
        const fromDate = hasCompleteBaseline
          ? getLatestClosedTradeDate(
            [...savedExecutions, ...currentExecutions],
            dependencies.getClosedTrades()
          )
          : undefined;

        const response = await fetchExecutedTrades(fromDate);
        if (!dependencies.isSessionCurrent(session)) return false;

        const normalizedPage = normalizeExecutedTrades(response);
        if (!dependencies.isSessionCurrent(session)) return false;

        // A bounded provider response is never an authoritative replacement for
        // local history. Preserve app-calculated fee allocations before merging.
        const latestSavedExecutions = loadSavedBrokerExecutions();
        const latestCurrentExecutions = dependencies.getCurrentBrokerExecutions();
        const retainedExecutions = [...latestSavedExecutions, ...latestCurrentExecutions];
        const normalizedPageWithFees = preservePersistedBrokerFeeAllocations(
          normalizedPage,
          retainedExecutions
        );
        const mergedTrades = mergeBrokerExecutionHistory(
          retainedExecutions,
          normalizedPageWithFees
        );
        dependencies.setBrokerExecutions(mergedTrades);

        if (!hasCompleteBaseline) {
          const persistedCount = dependencies.loadSavedBrokerExecutions().length;
          if (mergedTrades.length === 0 || persistedCount >= mergedTrades.length) {
            markHistoryBaseline(accountId);
          }
        }

        if (!dependencies.isSessionCurrent(session)) return false;
        // Broker executions remain separate from app-owned ClosedTrade rows.
        emit('broker:executed-trades', mergedTrades);
        return true;
      } catch (error) {
        if (!dependencies.isSessionCurrent(session)) return false;
        logError('Unable to load TradeNet executed trades:', error);
        emit('broker:executed-trades-error');
        return false;
      }
    })();

    tradesRequests.set(requestKey, request);
    try {
      return await request;
    } finally {
      if (tradesRequests.get(requestKey) === request) tradesRequests.delete(requestKey);
    }
  };

  const loadActiveOrders = async (session: SessionIdentityToken): Promise<boolean> => {
    if (!dependencies.isSessionCurrent(session)) return false;
    const requestKey = getSessionIdentityRequestKey(session);
    const existing = activeOrdersRequests.get(requestKey);
    if (existing) return existing;

    let succeeded = false;
    const request = (async () => {
      await refreshOrders({
        restoreGatewaySecret: dependencies.restoreGatewaySecret,
        isCurrent: () => dependencies.isSessionCurrent(session),
        fetchActiveOrders: dependencies.fetchActiveOrders,
        normalizeActiveOrders: dependencies.normalizeActiveOrders,
        onSuccess: (orders) => {
          if (!dependencies.isSessionCurrent(session)) return;
          succeeded = true;
          emit('broker:active-orders', orders);
        },
        onError: () => {
          if (!dependencies.isSessionCurrent(session)) return;
          succeeded = false;
          emit('broker:active-orders-error');
        },
        logError: (error) => {
          if (dependencies.isSessionCurrent(session)) {
            logError('Unable to load active TradeNet orders:', error);
          }
        }
      });
      return succeeded;
    })();

    activeOrdersRequests.set(requestKey, request);
    try {
      return await request;
    } finally {
      if (activeOrdersRequests.get(requestKey) === request) activeOrdersRequests.delete(requestKey);
    }
  };

  return { loadFreedomAccount, refreshAccountInfo, loadExecutedTrades, loadActiveOrders };
}
