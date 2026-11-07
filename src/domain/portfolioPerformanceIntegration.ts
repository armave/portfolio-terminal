import {
  buildPerformanceSeries,
  calculateMoneyWeightedReturn,
  calculatePeriodAttribution,
  calculateTimeWeightedReturn,
  summarizePerformanceIncomeAndCosts,
  type PerformanceAdjustment,
  type PerformanceExternalCashFlow,
  type PerformanceFrequency,
  type PerformanceValuationPoint,
  type PerformanceCalculation,
  type PeriodAttribution,
  type MoneyWeightedPerformance,
  type TimeWeightedPerformance,
  type PerformanceSeries,
  type PerformanceIncomeCostSummary
} from './portfolioPerformance';
import { calculatePortfolioValuation, getPortfolioValuationReliability } from './portfolioValuation';
import type {
  PortfolioPerformanceValuationSnapshot,
  PortfolioState
} from '../types/portfolio';
import type { PortfolioTransactionEvent } from '../types/portfolioTransaction';

export const MAX_PORTFOLIO_PERFORMANCE_SNAPSHOTS = 1095;
const MAX_ATTRIBUTION_POSITION_ITEMS = 40;
const CASH_ITEM_KEY = 'cash';
const MARGIN_DEBT_ITEM_KEY = 'margin-debt';
const OTHER_HOLDINGS_ITEM_KEY = 'other-holdings';

export interface PortfolioPerformanceReport {
  status: 'available' | 'provisional' | 'unavailable';
  reason?: string;
  quality?: 'current' | 'provisional';
  currency?: string;
  startAt?: number;
  endAt?: number;
  observationCount: number;
  profit?: number;
  timeWeighted?: PerformanceCalculation<TimeWeightedPerformance>;
  moneyWeighted?: PerformanceCalculation<MoneyWeightedPerformance>;
  monthlySeries?: PerformanceCalculation<PerformanceSeries>;
  incomeCosts?: PerformanceCalculation<PerformanceIncomeCostSummary>;
  latestAttribution?: PerformanceCalculation<PeriodAttribution>;
  warnings: string[];
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function currencyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const valueNormalized = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(valueNormalized) ? valueNormalized : null;
}

function quoteCurrency(
  ticker: string,
  quoteDetails: { currency?: string } | undefined,
  brokerCurrencyByTicker: Map<string, string>
): string | null {
  return currencyCode(quoteDetails?.currency) || brokerCurrencyByTicker.get(ticker.toUpperCase()) || null;
}

function quoteQuality(
  details: { freshness?: string; sourceTimestamp?: number } | undefined
): 'fresh' | 'stale' | 'delayed' | 'unknown' {
  if (!details) return 'unknown';
  if (details.freshness === 'stale') return 'stale';
  if (details.freshness === 'delayed' || details.freshness === 'indicative') return 'delayed';
  if (details.freshness !== 'fresh' || !Number.isFinite(details.sourceTimestamp)) return 'unknown';
  return 'fresh';
}

/**
 * Capture one account-currency valuation using canonical app positions and
 * cash-backed holdings. Broker aggregates are used only to resolve currency;
 * they never replace app-owned quantities or lots.
 *
 * Returns null when a comparable, single-currency equity snapshot cannot be
 * built. Stale or unverifiable inputs can be captured, but remain provisional.
 */
export function capturePortfolioPerformanceValuation(
  state: PortfolioState,
  timestamp: number,
  cashflowHistoryComplete: boolean
): PortfolioPerformanceValuationSnapshot | null {
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return null;

  const account = state.brokerAccountInfo;
  if (!account?.loaded || account.status === 'unavailable' || !Array.isArray(account.balances)) return null;

  const balanceCurrencies = new Set(
    account.balances.map(row => currencyCode(row.currency)).filter((value): value is string => value !== null)
  );
  if (balanceCurrencies.size !== 1 || account.balances.length === 0) return null;
  const currency = [...balanceCurrencies][0];

  const brokerCurrencyByTicker = new Map<string, string>();
  for (const row of account.positions || []) {
    const ticker = typeof row.ticker === 'string' ? row.ticker.trim().toUpperCase() : '';
    const rowCurrency = currencyCode(row.currency);
    if (!ticker || !rowCurrency) continue;
    const previous = brokerCurrencyByTicker.get(ticker);
    if (previous && previous !== rowCurrency) return null;
    brokerCurrencyByTicker.set(ticker, rowCurrency);
  }

  const positions = Object.values(state.positions || {}).filter(position =>
    position && finiteNumber(position.shares) !== null && Number(position.shares) > 0
  );
  const cashHoldings = (state.cashCushion?.holdings || []).filter(holding =>
    holding && finiteNumber(holding.shares) !== null && Number(holding.shares) > 0
  );

  let staleQuotes = 0;
  let delayedQuotes = 0;
  let unknownQuotes = 0;
  for (const position of positions) {
    const resolvedCurrency = quoteCurrency(position.ticker, position.quoteDetails, brokerCurrencyByTicker);
    if (resolvedCurrency !== currency) return null;
    const quality = quoteQuality(position.quoteDetails);
    if (quality === 'stale') staleQuotes += 1;
    else if (quality === 'delayed') delayedQuotes += 1;
    else if (quality === 'unknown') unknownQuotes += 1;
  }
  for (const holding of cashHoldings) {
    const resolvedCurrency = quoteCurrency(holding.ticker, holding.quoteDetails, brokerCurrencyByTicker);
    if (resolvedCurrency !== currency) return null;
    const quality = quoteQuality(holding.quoteDetails);
    if (quality === 'stale') staleQuotes += 1;
    else if (quality === 'delayed') delayedQuotes += 1;
    else if (quality === 'unknown') unknownQuotes += 1;
  }

  const valuation = calculatePortfolioValuation({
    signedAccountBalance: state.balance,
    freeCash: state.cashCushion?.freeCash,
    marginPositions: positions,
    cashHoldings
  });
  if (!valuation.accountBalanceAvailable || valuation.unpricedHoldings > 0 ||
      !Number.isFinite(valuation.equity)) return null;

  const reliability = getPortfolioValuationReliability({
    accountBalanceAvailable: valuation.accountBalanceAvailable,
    accountBalanceStale: account.status !== 'current' ||
      account.quality !== 'complete' ||
      !Number.isFinite(account.observedAt),
    unpricedHoldings: valuation.unpricedHoldings,
    staleQuotes,
    delayedQuotes,
    unknownQuotes,
    unavailableQuotes: 0
  });
  if (reliability === 'incomplete') return null;

  const marketItems = new Map<string, number>();
  for (const position of positions) {
    const key = 'position:' + position.ticker.trim().toUpperCase();
    const amount = Number(position.shares) * Number(position.currentPrice);
    if (!Number.isFinite(amount)) return null;
    marketItems.set(key, (marketItems.get(key) || 0) + amount);
  }
  for (const holding of cashHoldings) {
    const key = 'cash-holding:' + holding.ticker.trim().toUpperCase();
    const price = finiteNumber(holding.currentPrice) ?? finiteNumber(holding.price);
    const amount = Number(holding.shares) * Number(price);
    if (!Number.isFinite(amount)) return null;
    marketItems.set(key, (marketItems.get(key) || 0) + amount);
  }

  const sortedMarketItems = [...marketItems.entries()].sort((a, b) => b[1] - a[1]);
  const keptItems = sortedMarketItems.slice(0, MAX_ATTRIBUTION_POSITION_ITEMS);
  const remainingValue = sortedMarketItems.slice(MAX_ATTRIBUTION_POSITION_ITEMS)
    .reduce((sum, [, value]) => sum + value, 0);
  const items = keptItems.map(([key, value]) => ({ key, value }));
  if (remainingValue !== 0) items.push({ key: OTHER_HOLDINGS_ITEM_KEY, value: remainingValue });
  items.push({ key: CASH_ITEM_KEY, value: valuation.cashBalance });
  items.push({ key: MARGIN_DEBT_ITEM_KEY, value: -valuation.marginDebt });

  const itemTotal = items.reduce((sum, item) => sum + item.value, 0);
  if (Math.abs(itemTotal - valuation.equity) > Math.max(0.02, Math.abs(valuation.equity) * 1e-10)) {
    return null;
  }

  return {
    timestamp,
    equity: valuation.equity,
    currency,
    quality: reliability === 'current' ? 'current' : 'provisional',
    cashflowHistoryComplete,
    items,
    pricedHoldings: valuation.pricedHoldings,
    unpricedHoldings: valuation.unpricedHoldings,
    provider: account.provider || 'unknown',
    brokerObservedAt: Number.isFinite(account.observedAt) ? account.observedAt as number : null,
    brokerReceivedAt: Number.isFinite(account.receivedAt) ? account.receivedAt : null
  };
}

function utcDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** Retain one daily point, allowing only an explicit same-day quality/coverage upgrade. */
export function appendDailyPerformanceValuation(
  existing: readonly PortfolioPerformanceValuationSnapshot[] | undefined,
  incoming: PortfolioPerformanceValuationSnapshot,
  maxPoints = MAX_PORTFOLIO_PERFORMANCE_SNAPSHOTS
): PortfolioPerformanceValuationSnapshot[] {
  const safeExisting = Array.isArray(existing)
    ? existing.filter(isPortfolioPerformanceValuationSnapshot).slice().sort((a, b) => a.timestamp - b.timestamp)
    : [];
  const last = safeExisting[safeExisting.length - 1];

  if (last && utcDay(last.timestamp) === utcDay(incoming.timestamp)) {
    const coverageUpgrade = !last.cashflowHistoryComplete && incoming.cashflowHistoryComplete;
    const qualityUpgrade = last.quality === 'provisional' && incoming.quality === 'current';
    if (!coverageUpgrade && !qualityUpgrade) return safeExisting;
    safeExisting[safeExisting.length - 1] = incoming;
  } else {
    if (last && incoming.timestamp <= last.timestamp) return safeExisting;
    safeExisting.push(incoming);
  }

  const boundedMax = Number.isFinite(maxPoints) ? Math.max(2, Math.floor(maxPoints)) : MAX_PORTFOLIO_PERFORMANCE_SNAPSHOTS;
  return safeExisting.slice(-boundedMax);
}

export function isPortfolioPerformanceValuationSnapshot(value: unknown): value is PortfolioPerformanceValuationSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.timestamp) || Number(row.timestamp) <= 0) return false;
  if (typeof row.equity !== 'number' || !Number.isFinite(row.equity)) return false;
  if (currencyCode(row.currency) === null) return false;
  if (row.quality !== 'current' && row.quality !== 'provisional') return false;
  if (typeof row.cashflowHistoryComplete !== 'boolean') return false;
  if (!Array.isArray(row.items) || row.items.length === 0) return false;
  if (!row.items.every(item => item && typeof item === 'object' &&
    typeof (item as Record<string, unknown>).key === 'string' &&
    typeof (item as Record<string, unknown>).value === 'number' &&
    Number.isFinite((item as Record<string, unknown>).value))) return false;
  return true;
}

type AdapterResult<T> = { value: T; warnings: string[] } | { reason: string; warnings: string[] };

function mapExternalCashFlows(
  events: readonly PortfolioTransactionEvent[],
  startAt: number,
  endAt: number,
  currency: string
): AdapterResult<PerformanceExternalCashFlow[]> {
  const flows: PerformanceExternalCashFlow[] = [];
  const seen = new Set<string>();
  const unsupported = new Set([
    'cash.adjustment',
    'margin.adjustment',
    'position.adjustment',
    'history.correction',
    'portfolio.reconciliation',
    'portfolio.reset',
    'correction'
  ]);

  for (const event of events) {
    if (!event || !Number.isFinite(event.effectiveAt) ||
        event.effectiveAt <= startAt || event.effectiveAt > endAt) continue;

    if (unsupported.has(event.type)) {
      const amount = Math.abs(Number(event.externalCashFlowAmount ?? event.grossAmount ?? event.cashDelta ?? 0));
      if (amount > 0 || ['portfolio.reset', 'history.correction', 'portfolio.reconciliation', 'position.adjustment', 'margin.adjustment', 'correction'].includes(event.type)) {
        return { reason: 'The transaction history contains an adjustment or correction that cannot yet be classified as an external investment flow.', warnings: [] };
      }
      continue;
    }
    if (event.type !== 'cash.deposit' && event.type !== 'cash.withdrawal') continue;

    const amountValue = event.externalCashFlowAmount ?? event.grossAmount ?? event.cashDelta;
    const amount = amountValue === undefined ? NaN : Math.abs(Number(amountValue));
    const flowCurrency = currencyCode(event.currency);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { reason: 'An external cash flow is missing a valid positive amount.', warnings: [] };
    }
    if (flowCurrency !== currency) {
      return { reason: 'An external cash flow uses a different or unknown currency; historical FX conversion is not enabled.', warnings: [] };
    }

    const identity = event.externalReferenceId || event.id;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const brokerSourced = event.actor?.type === 'broker' &&
      event.source.toLowerCase().includes('freedom');
    flows.push({
      timestamp: event.effectiveAt,
      amount,
      type: event.type === 'cash.deposit' ? 'contribution' : 'withdrawal',
      currency,
      quality: brokerSourced ? 'current' : 'provisional'
    });
  }

  return {
    value: flows,
    warnings: flows.some(flow => flow.quality === 'provisional')
      ? ['One or more external flows come from app-side journal events; source coverage is provisional.']
      : []
  };
}

function parseCashflowTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const timestamp = typeof value === 'number' && parsed < 1e12 ? parsed * 1000 : parsed;
  return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : null;
}

function mapIncomeCostAdjustments(
  rows: readonly NonNullable<PortfolioState['cashflows']>[number][],
  startAt: number,
  endAt: number,
  currency: string
): AdapterResult<PerformanceAdjustment[]> {
  const adjustments: PerformanceAdjustment[] = [];
  for (const row of rows) {
    const timestamp = parseCashflowTimestamp(row.date);
    if (timestamp === null || timestamp <= startAt || timestamp > endAt) continue;
    const sourceText = [
      row.type,
      row.description,
      ...Object.values(row.raw || {})
    ].filter(Boolean).join(' ').toLowerCase();

    let type: PerformanceAdjustment['type'] | null = null;
    if (/dividend|distribution|coupon/.test(sourceText)) type = 'dividend';
    else if (/commission/.test(sourceText)) type = 'commission';
    else if (/margin|interest|financing|borrow fee/.test(sourceText)) type = 'interest';
    else if (/fee|charge|tax/.test(sourceText)) type = 'fee';
    if (!type) continue;

    const amount = Math.abs(Number(row.amount));
    const rowCurrency = currencyCode(row.currency);
    if (!Number.isFinite(amount) || rowCurrency !== currency) {
      return { reason: 'An income or cost cashflow has an invalid amount or a different/unknown currency.', warnings: [] };
    }
    adjustments.push({
      timestamp,
      type,
      amount,
      currency,
      quality: 'current'
    });
  }
  return { value: adjustments, warnings: [] };
}

export function buildPortfolioPerformanceReport(
  state: Pick<PortfolioState, 'performanceValuations' | 'transactionEvents' | 'cashflows'>
): PortfolioPerformanceReport {
  const snapshots = (state.performanceValuations || [])
    .filter(isPortfolioPerformanceValuationSnapshot)
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);

  if (snapshots.length < 2) {
    return {
      status: 'unavailable',
      reason: 'Portfolio valuation history is being collected. At least two daily observations are required.',
      observationCount: snapshots.length,
      warnings: []
    };
  }

  const firstComplete = snapshots.findIndex(snapshot => snapshot.cashflowHistoryComplete);
  if (firstComplete < 0) {
    return {
      status: 'unavailable',
      reason: 'A complete broker cashflow-history baseline is required before cash-flow-adjusted performance can be calculated.',
      observationCount: snapshots.length,
      warnings: []
    };
  }

  const usableSnapshots = snapshots.slice(firstComplete);
  if (usableSnapshots.length < 2 || usableSnapshots.some(snapshot => !snapshot.cashflowHistoryComplete)) {
    return {
      status: 'unavailable',
      reason: 'The valuation history does not contain two observations with continuous, verified cashflow coverage.',
      observationCount: snapshots.length,
      warnings: []
    };
  }

  const currency = usableSnapshots[0].currency;
  if (usableSnapshots.some(snapshot => snapshot.currency !== currency)) {
    return {
      status: 'unavailable',
      reason: 'Portfolio valuation history contains mixed currencies. Historical FX conversion is not enabled.',
      observationCount: usableSnapshots.length,
      warnings: []
    };
  }

  const valuations: PerformanceValuationPoint[] = usableSnapshots.map(snapshot => ({
    timestamp: snapshot.timestamp,
    equity: snapshot.equity,
    currency: snapshot.currency,
    quality: snapshot.quality
  }));
  const startAt = valuations[0].timestamp;
  const endAt = valuations[valuations.length - 1].timestamp;
  const externalFlowResult = mapExternalCashFlows(
    state.transactionEvents || [],
    startAt,
    endAt,
    currency
  );
  if ('reason' in externalFlowResult) {
    return {
      status: 'unavailable',
      reason: externalFlowResult.reason,
      observationCount: usableSnapshots.length,
      warnings: externalFlowResult.warnings
    };
  }

  const input = { valuations, externalCashFlows: externalFlowResult.value };
  const timeWeighted = calculateTimeWeightedReturn(input);
  const moneyWeighted = calculateMoneyWeightedReturn(input);
  const monthlySeries = buildPerformanceSeries(input, 'monthly');
  if (timeWeighted.status === 'unavailable') {
    return {
      status: 'unavailable',
      reason: timeWeighted.reason,
      observationCount: usableSnapshots.length,
      timeWeighted,
      moneyWeighted,
      monthlySeries,
      warnings: [...externalFlowResult.warnings, ...timeWeighted.warnings]
    };
  }

  const incomeCostResult = mapIncomeCostAdjustments(
    state.cashflows || [],
    startAt,
    endAt,
    currency
  );
  const incomeCosts = 'reason' in incomeCostResult
    ? { status: 'unavailable' as const, reason: incomeCostResult.reason, warnings: [] }
    : summarizePerformanceIncomeAndCosts(incomeCostResult.value, currency);

  const latestStart = usableSnapshots[usableSnapshots.length - 2];
  const latestEnd = usableSnapshots[usableSnapshots.length - 1];
  const periodFlows = externalFlowResult.value.filter(flow =>
    flow.timestamp > latestStart.timestamp && flow.timestamp <= latestEnd.timestamp
  );
  const allItemKeys = new Set([
    ...latestStart.items.map(item => item.key),
    ...latestEnd.items.map(item => item.key)
  ]);
  const startItems = new Map(latestStart.items.map(item => [item.key, item.value]));
  const endItems = new Map(latestEnd.items.map(item => [item.key, item.value]));
  const quality = latestStart.quality === 'provisional' || latestEnd.quality === 'provisional'
    ? 'provisional'
    : 'current';
  const itemFlows = periodFlows.map(flow => ({
    timestamp: flow.timestamp,
    amount: flow.type === 'contribution' ? flow.amount : -flow.amount,
    currency,
    quality: flow.quality
  }));
  const latestAttribution = calculatePeriodAttribution({
    startAt: latestStart.timestamp,
    endAt: latestEnd.timestamp,
    currency,
    startPortfolioValue: latestStart.equity,
    endPortfolioValue: latestEnd.equity,
    quality,
    externalCashFlows: periodFlows,
    items: [...allItemKeys].map(key => ({
      key,
      currency,
      startValue: startItems.get(key) ?? 0,
      endValue: endItems.get(key) ?? 0,
      quality,
      flows: key === CASH_ITEM_KEY ? itemFlows : []
    })),
    tolerance: 0.05
  });

  const profit = timeWeighted.value.periods.reduce((sum, period) => sum + period.profit, 0);
  const warnings = [
    ...externalFlowResult.warnings,
    ...timeWeighted.warnings,
    ...(moneyWeighted.status === 'unavailable' ? [moneyWeighted.reason] : moneyWeighted.warnings),
    ...(incomeCosts.status === 'unavailable' ? [incomeCosts.reason] : incomeCosts.warnings),
    ...(latestAttribution.status === 'unavailable' ? [latestAttribution.reason] : latestAttribution.warnings)
  ];
  const status = timeWeighted.status === 'provisional' ||
    (moneyWeighted.status !== 'unavailable' && moneyWeighted.status === 'provisional')
    ? 'provisional'
    : 'available';

  return {
    status,
    quality: status === 'available' ? 'current' : 'provisional',
    currency,
    startAt,
    endAt,
    observationCount: usableSnapshots.length,
    profit,
    timeWeighted,
    moneyWeighted,
    monthlySeries,
    incomeCosts,
    latestAttribution,
    warnings: [...new Set(warnings)]
  };
}
