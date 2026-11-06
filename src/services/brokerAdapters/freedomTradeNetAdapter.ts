import {
  normalizeFreedomActiveOrders as normalizeFreedomOrdersPayload,
  normalizeFreedomPortfolio as normalizeFreedomPortfolioPayload
} from '../freedomAccountContracts';
import {
  normalizeFreedomOrderFills as normalizeFreedomFillsPayload,
  normalizeFreedomTrades as normalizeFreedomExecutionsPayload
} from '../freedomTradeContracts';
import { normalizeFreedomCashflowRows } from '../../domain/freedomCashflows';
import {
  fetchFreedomCashflows,
  fetchFreedomTradeNetActiveOrders,
  fetchFreedomTradeNetPositions,
  fetchFreedomTradeNetTrades
} from '../api';
import type {
  BrokerAdapter,
  BrokerAdapterContext,
  BrokerAdapterError,
  BrokerAdapterErrorCode,
  BrokerAuthenticationState,
  BrokerCashflow,
  BrokerDataSnapshot,
  BrokerSnapshotQuality,
  BrokerAdapterTransport
} from '../../types/broker';

const FREEDOM_PROVIDER = 'freedom-tradenet';

const defaultTransport: BrokerAdapterTransport = {
  fetchPortfolio: fetchFreedomTradeNetPositions,
  fetchActiveOrders: fetchFreedomTradeNetActiveOrders,
  fetchExecutions: fetchFreedomTradeNetTrades,
  fetchCashflows: fetchFreedomCashflows
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function unwrapTradeNet(response: unknown): unknown {
  const envelope = asRecord(response);
  const data = asRecord(envelope?.data);
  return asRecord(data?.result) ?? data ?? asRecord(envelope?.result) ?? envelope ?? response;
}

function readOrderRows(response: unknown): unknown[] | null {
  if (Array.isArray(response)) return response;
  const root = asRecord(unwrapTradeNet(response));
  if (!root) return null;
  const orders = asRecord(root.orders);
  if (Array.isArray(orders?.order)) return orders.order;
  if (Array.isArray(root.orders)) return root.orders;
  if (Array.isArray(root.items)) return root.items;
  if (Array.isArray(root.data)) return root.data;
  return null;
}

function readExecutionRows(response: unknown): unknown[] | null {
  if (Array.isArray(response)) return response;
  const root = asRecord(unwrapTradeNet(response));
  if (!root) return null;
  const trades = asRecord(root.trades);
  if (Array.isArray(trades?.trade)) return trades.trade;
  if (Array.isArray(root.trades)) return root.trades;
  if (Array.isArray(root.items)) return root.items;
  if (Array.isArray(root.history)) return root.history;
  if (Array.isArray(root.data)) return root.data;
  return null;
}

function readOrderFillRows(response: unknown): unknown[] | null {
  const root = asRecord(response);
  const data = asRecord(root?.data) ?? root;
  const trades = asRecord(data?.trades);
  if (Array.isArray(trades?.trade)) return trades.trade;
  // An order snapshot without an embedded trade collection is valid and has
  // no new fills. An unrecognized envelope is not treated as an empty history.
  if (readOrderRows(response) !== null) return [];
  return null;
}

function createSnapshot<T>(
  data: T,
  quality: BrokerSnapshotQuality,
  context: BrokerAdapterContext = {},
  warnings: string[] = []
): BrokerDataSnapshot<T> {
  const receivedAt = context.receivedAt ?? Date.now();
  return {
    provider: FREEDOM_PROVIDER,
    data,
    quality,
    source: context.source ?? 'rest',
    receivedAt,
    ...(typeof context.observedAt === 'number' && Number.isFinite(context.observedAt)
      ? { observedAt: context.observedAt }
      : {}),
    warnings: context.observedAt === undefined
      ? [...warnings, 'The provider did not supply a verifiable observation timestamp.']
      : warnings
  };
}

function extractHttpStatus(error: unknown): number | undefined {
  const record = asRecord(error);
  const status = record?.status ?? record?.statusCode;
  return typeof status === 'number' && Number.isFinite(status) ? status : undefined;
}

class BrokerAdapterFailure extends Error implements BrokerAdapterError {
  override readonly name = 'BrokerAdapterError' as const;
  readonly provider = FREEDOM_PROVIDER;
  readonly code: BrokerAdapterErrorCode;
  readonly retryable: boolean;
  readonly requiresReauthentication: boolean;
  readonly httpStatus?: number;

  constructor(
    code: BrokerAdapterErrorCode,
    message: string,
    options: { retryable: boolean; requiresReauthentication: boolean; httpStatus?: number; cause?: unknown }
  ) {
    super(message, { cause: options.cause });
    this.code = code;
    this.retryable = options.retryable;
    this.requiresReauthentication = options.requiresReauthentication;
    this.httpStatus = options.httpStatus;
  }
}

function classifyFreedomBrokerError(error: unknown): BrokerAdapterError {
  const record = asRecord(error);
  const message = error instanceof Error
    ? error.message
    : typeof record?.message === 'string' ? record.message : 'The broker request failed.';
  const status = extractHttpStatus(error);
  const normalized = message.toLowerCase();
  let code: BrokerAdapterErrorCode = 'unknown';

  if (
    status === 401 || status === 403 || /http\s*(401|403)|status\s*(401|403)/.test(normalized) ||
    /unauthori[sz]ed|authentication|session expired|invalid session|missing.*secret|not authenticated/.test(normalized)
  ) code = 'authentication_required';
  else if (status === 429 || /http\s*429|rate.?limit|too many requests/.test(normalized)) code = 'rate_limited';
  else if (/timeout|timed out|aborterror/.test(normalized)) code = 'timeout';
  else if (/network|fetch failed|socket|connection reset|connection refused/.test(normalized)) code = 'network';
  else if (/unrecognized|malformed|invalid response|missing data\.result|not loaded yet|schema/.test(normalized)) code = 'malformed_response';
  else if (/unsupported|not supported/.test(normalized)) code = 'unsupported';
  else if (status !== undefined || /unavailable|temporarily/.test(normalized)) code = 'unavailable';

  const retryable = code === 'rate_limited' || code === 'timeout' || code === 'network' || code === 'unavailable';
  return new BrokerAdapterFailure(code, message, {
    retryable,
    requiresReauthentication: code === 'authentication_required',
    ...(status === undefined ? {} : { httpStatus: status }),
    cause: error
  });
}

function fail(error: unknown): never {
  throw classifyFreedomBrokerError(error);
}

export function createFreedomTradeNetBrokerAdapter(
  transport: BrokerAdapterTransport = defaultTransport
): BrokerAdapter {
  const classifyError = classifyFreedomBrokerError;
  return {
    provider: FREEDOM_PROVIDER,
    displayName: 'Freedom TradeNet',
    readOnly: true,
    capabilities: {
      portfolios: true,
      positions: true,
      balances: true,
      executions: true,
      activeOrders: true,
      cashflows: true,
      orderPlacement: false
    },
    fetchPortfolio: () => transport.fetchPortfolio(),
    fetchActiveOrders: () => transport.fetchActiveOrders(),
    fetchExecutions: (fromDate) => transport.fetchExecutions(fromDate),
    fetchCashflows: (fromDate) => transport.fetchCashflows(fromDate),
    getAuthenticationState: (input = {}): BrokerAuthenticationState => {
      const checkedAt = input.checkedAt ?? Date.now();
      if (input.error !== undefined) {
        const error = classifyError(input.error);
        return { status: error.requiresReauthentication ? 'expired' : 'error', checkedAt };
      }
      if (input.authenticated === true) return { status: 'authenticated', checkedAt, authenticatedAt: checkedAt };
      if (input.authenticated === false) return { status: 'unauthenticated', checkedAt };
      return { status: 'unknown', checkedAt };
    },
    normalizePortfolio: (response, context = {}) => {
      try {
        const data = normalizeFreedomPortfolioPayload(response);
        const root = asRecord(unwrapTradeNet(response));
        const ps = asRecord(root?.ps);
        const hasBalances = Array.isArray(ps?.acc);
        const hasPositions = Array.isArray(ps?.pos);
        const visibleRows = data.balances.length + data.positions.length;
        const providerRows = (Array.isArray(ps?.acc) ? ps.acc.length : 0) +
          (Array.isArray(ps?.pos) ? ps.pos.length : 0);
        const quality: BrokerSnapshotQuality = !hasBalances || !hasPositions || visibleRows < providerRows
          ? 'partial'
          : visibleRows === 0 ? 'empty' : 'complete';
        const warnings = quality === 'partial'
          ? ['Some provider rows or collections were unavailable or are outside the current USD account scope.']
          : [];
        return createSnapshot(data, quality, context, warnings);
      } catch (error) {
        return fail(error);
      }
    },
    normalizeActiveOrders: (response, context = {}) => {
      const rows = readOrderRows(response);
      if (!rows) return fail(new Error('TradeNet returned an unrecognized active-orders response.'));
      try {
        const data = normalizeFreedomOrdersPayload(response);
        const validRows = rows.filter((row) => asRecord(row) !== null).length;
        const quality: BrokerSnapshotQuality = rows.length === 0 ? 'empty'
          : validRows < rows.length ? 'partial' : 'complete';
        return createSnapshot(data, quality, context,
          quality === 'partial' ? ['Malformed order rows were ignored.'] : []);
      } catch (error) {
        return fail(error);
      }
    },
    normalizeExecutions: (response, context = {}) => {
      const rows = readExecutionRows(response);
      if (!rows) return fail(new Error('TradeNet returned an unrecognized execution-history response.'));
      try {
        const data = normalizeFreedomExecutionsPayload(response);
        const validRows = rows.filter((row) => asRecord(row) !== null).length;
        const quality: BrokerSnapshotQuality = rows.length === 0 ? 'empty'
          : validRows < rows.length ? 'partial' : 'complete';
        return createSnapshot(data, quality, context,
          quality === 'partial' ? ['Malformed execution rows were ignored.'] : []);
      } catch (error) {
        return fail(error);
      }
    },
    normalizeExecutionFills: (response, context = {}) => {
      const rows = readOrderFillRows(response);
      if (!rows) return fail(new Error('TradeNet returned an unrecognized order-fill response.'));
      try {
        const data = normalizeFreedomFillsPayload(response);
        const validRows = rows.filter((row) => asRecord(row) !== null).length;
        const quality: BrokerSnapshotQuality = rows.length === 0 ? 'empty'
          : validRows < rows.length ? 'partial' : 'complete';
        return createSnapshot(data, quality, context,
          quality === 'partial' ? ['Malformed execution-fill rows were ignored.'] : []);
      } catch (error) {
        return fail(error);
      }
    },
    normalizeCashflows: (response, context = {}) => {
      try {
        const data: BrokerCashflow[] = normalizeFreedomCashflowRows(response);
        return createSnapshot(data, data.length === 0 ? 'empty' : 'complete', context);
      } catch (error) {
        return fail(error);
      }
    },
    classifyError
  };
}

export const freedomTradeNetBrokerAdapter = createFreedomTradeNetBrokerAdapter();
