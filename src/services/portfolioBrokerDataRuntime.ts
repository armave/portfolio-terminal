import { emitBrokerEvent } from './brokerEventBus';
import { normalizeFreedomOrderFills } from './freedomTradeContracts';
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
import {
  getFreedomAccountStreamSnapshotRevision,
  hasFreedomAccountStreamSnapshot,
  isFreedomAccountStreamConnected
} from './freedomAccountStreamHealth';

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
  normalizeOrderFills?: (response: unknown) => FreedomExecutedTrade[];
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
  const normalizeOrderFills = dependencies.normalizeOrderFills || normalizeFreedomOrderFills;
  const logError = dependencies.logError || ((message, error) => console.error(message, error));

  const loadFreedomAccount = async (session: SessionIdentityToken): Promise<boolean> => {
    if (!dependencies.isSessionCurrent(session)) return false;
    if (isFreedomAccountStreamConnected(session.identity)) {
      if (hasFreedomAccountStreamSnapshot(session.identity, 'portfolio')) {
        emit('broker:account-info-refresh-complete');
      }
      return true;
    }
    if (hasFreedomAccountStreamSnapshot(session.identity, 'portfolio')) {
      // The account stream already applied a current snapshot. Notify mounted
      // desks waiting for the request lifecycle even though no new payload or
      // REST request is needed.
      emit('broker:account-info-refresh-complete');
      return true;
    }
    const requestKey = getSessionIdentityRequestKey(session);
    const existing = accountRequests.get(requestKey);
    if (existing) return existing;

    const streamRevisionAtStart = getFreedomAccountStreamSnapshotRevision(session.identity, 'portfolio');
    emit('broker:account-info-refreshing');
    const request = (async () => {
      const secret = await restoreSecret();
      if (!secret.trim()) throw new Error('Gateway Secret is not available.');
      if (!dependencies.isSessionCurrent(session)) return false;
      if (isFreedomAccountStreamConnected(session.identity)) {
        emit('broker:account-info-refresh-complete');
        return true;
      }

      const response = await fetchAccountInfo();
      if (!dependencies.isSessionCurrent(session)) return false;
      if (isFreedomAccountStreamConnected(session.identity)) {
        emit('broker:account-info-refresh-complete');
        return true;
      }
      // A valid live event that arrived during the request is newer than this
      // one-shot snapshot, even if the stream disconnects before the request ends.
      if (
        getFreedomAccountStreamSnapshotRevision(session.identity, 'portfolio') > streamRevisionAtStart ||
        hasFreedomAccountStreamSnapshot(session.identity, 'portfolio')
      ) {
        emit('broker:account-info-refresh-complete');
        return true;
      }

      const snapshot = normalizeAccountInfo(response);
      if (!dependencies.isSessionCurrent(session)) return false;
      if (
        getFreedomAccountStreamSnapshotRevision(session.identity, 'portfolio') > streamRevisionAtStart ||
        hasFreedomAccountStreamSnapshot(session.identity, 'portfolio')
      ) {
        emit('broker:account-info-refresh-complete');
        return true;
      }

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
    const publishCachedExecutions = (): boolean => {
      if (!dependencies.isSessionCurrent(session)) return false;
      const cachedExecutions = mergeBrokerExecutionHistory(
        loadSavedBrokerExecutions(),
        dependencies.getCurrentBrokerExecutions()
      );
      emit('broker:executed-trades', cachedExecutions);
      return true;
    };
    if (isFreedomAccountStreamConnected(session.identity)) return publishCachedExecutions();
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
        if (isFreedomAccountStreamConnected(session.identity)) return publishCachedExecutions();

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
        if (isFreedomAccountStreamConnected(session.identity)) return publishCachedExecutions();

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
          const persistedCount = loadSavedBrokerExecutions().length;
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
    if (isFreedomAccountStreamConnected(session.identity)) return true;
    if (hasFreedomAccountStreamSnapshot(session.identity, 'orders')) return true;
    const requestKey = getSessionIdentityRequestKey(session);
    const existing = activeOrdersRequests.get(requestKey);
    if (existing) return existing;

    const streamRevisionAtStart = getFreedomAccountStreamSnapshotRevision(session.identity, 'orders');
    let succeeded = false;
    let orderStreamFills: FreedomExecutedTrade[] = [];
    const fetchActiveOrdersAndCaptureFills = async (): Promise<unknown> => {
      if (isFreedomAccountStreamConnected(session.identity)) return { streamConnected: true };
      const response = await fetchActiveOrders();
      if (dependencies.isSessionCurrent(session)) {
        orderStreamFills = normalizeOrderFills(response);
      }
      return response;
    };
    const request = (async () => {
      await refreshOrders({
        restoreGatewaySecret: restoreSecret,
        isCurrent: () => dependencies.isSessionCurrent(session),
        fetchActiveOrders: fetchActiveOrdersAndCaptureFills,
        normalizeActiveOrders,
        onSuccess: (orders) => {
          if (!dependencies.isSessionCurrent(session)) return;
          succeeded = true;
          if (isFreedomAccountStreamConnected(session.identity)) return;
          // Do not replay a cached one-shot snapshot after a newer live orders
          // event has already updated the canonical order and fill stores.
          if (
            getFreedomAccountStreamSnapshotRevision(session.identity, 'orders') > streamRevisionAtStart ||
            hasFreedomAccountStreamSnapshot(session.identity, 'orders')
          ) return;
          emit('broker:active-orders', orders);

          // The authenticated orders event embeds completed executions in each
          // order's trade[] list. Merge only new TradeNet trade IDs into the
          // canonical history, preserving app-calculated fee allocations.
          if (orderStreamFills.length > 0 && dependencies.isSessionCurrent(session)) {
            const retainedExecutions = [
              ...loadSavedBrokerExecutions(),
              ...dependencies.getCurrentBrokerExecutions()
            ];
            const knownIds = new Set(retainedExecutions.map((trade) => String(trade.id)));
            const newFills = orderStreamFills.filter((trade) => !knownIds.has(String(trade.id)));
            if (newFills.length > 0) {
              const fillsWithPersistedFees = preservePersistedBrokerFeeAllocations(
                newFills,
                retainedExecutions
              );
              const mergedTrades = mergeBrokerExecutionHistory(
                retainedExecutions,
                fillsWithPersistedFees
              );
              if (dependencies.isSessionCurrent(session)) {
                dependencies.setBrokerExecutions(mergedTrades);
                emit('broker:executed-trades', mergedTrades);
              }
            }
          }
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
