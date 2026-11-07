import {
  buildPerformanceSeries,
  calculateMoneyWeightedReturn,
  calculatePeriodAttribution,
  calculateTimeWeightedReturn,
  summarizePerformanceIncomeAndCosts,
  type PerformanceAdjustment,
  type PerformanceExternalCashFlow,
  type PerformanceValuationPoint,
  type PerformanceCalculation,
  type PeriodAttribution,
  type MoneyWeightedPerformance,
  type TimeWeightedPerformance,
  type PerformanceSeries,
  type PerformanceIncomeCostSummary
} from './portfolioPerformance';
import { isPortfolioPerformanceValuationSnapshot } from './portfolioPerformanceCapture';
import type {
  PortfolioPerformanceValuationSnapshot,
  PortfolioState
} from '../types/portfolio';
import type { PortfolioTransactionEvent } from '../types/portfolioTransaction';

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
    'correction',
    'cash-holding.buy',
    'cash-holding.sell',
    'cash-holding.adjustment',
    'cash.transfer',
    'corporate-action'
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

function mapAttributionItemFlows(
  events: readonly PortfolioTransactionEvent[],
  externalFlows: readonly PerformanceExternalCashFlow[],
  startAt: number,
  endAt: number,
  currency: string
): AdapterResult<Map<string, PerformanceExternalCashFlow[]>> {
  const result = new Map<string, PerformanceExternalCashFlow[]>();
  const add = (key: string, timestamp: number, amount: number) => {
    if (Math.abs(amount) < 1e-10) return;
    const flow: PerformanceExternalCashFlow = {
      timestamp,
      amount: Math.abs(amount),
      type: amount >= 0 ? 'contribution' : 'withdrawal',
      currency,
      quality: 'current'
    };
    const current = result.get(key) || [];
    current.push(flow);
    result.set(key, current);
  };

  // External flows belong to the cash bucket. Security/debt purchase and sale
  // flows below are internal reallocations and must net to zero across buckets.
  for (const flow of externalFlows) {
    add(CASH_ITEM_KEY, flow.timestamp, flow.type === 'contribution' ? flow.amount : -flow.amount);
  }

  for (const event of events) {
    if (event.effectiveAt <= startAt || event.effectiveAt > endAt) continue;
    if (event.type !== 'trade.buy' && event.type !== 'trade.sell') continue;

    const ticker = typeof event.ticker === 'string' ? event.ticker.trim().toUpperCase() : '';
    const eventCurrency = currencyCode(event.currency);
    const gross = finiteNumber(event.grossAmount);
    const cashDelta = finiteNumber(event.cashDelta);
    const debtDelta = event.marginDebtDelta === undefined ? 0 : finiteNumber(event.marginDebtDelta);
    const fees = event.fees === undefined ? 0 : finiteNumber(event.fees);
    if (!ticker || eventCurrency !== currency || gross === null || gross <= 0 ||
        cashDelta === null || debtDelta === null || fees === null || fees < 0) {
      return {
        reason: 'A buy or sell journal event is missing the currency, gross amount, cash delta, debt delta or fee evidence required for attribution.',
        warnings: []
      };
    }

    const direction = event.type === 'trade.buy' ? 1 : -1;
    const positionFlow = direction * gross;
    // cashDelta is net of commission in the store's transaction commands.
    // Add the fee back here so the fee remains investment cost, not a transfer
    // of capital between attribution buckets.
    const cashFlow = cashDelta + fees;
    // Positive marginDebtDelta increases a liability; the item value is negative debt.
    const debtItemFlow = -debtDelta;
    const netInternalFlow = positionFlow + cashFlow + debtItemFlow;
    const tolerance = Math.max(0.02, gross * 1e-8);
    if (!Number.isFinite(netInternalFlow) || Math.abs(netInternalFlow) > tolerance) {
      return {
        reason: 'A buy or sell journal event does not reconcile across security, cash and margin-debt buckets; latest-period attribution is withheld.',
        warnings: []
      };
    }

    add('position:' + ticker, event.effectiveAt, positionFlow);
    add(CASH_ITEM_KEY, event.effectiveAt, cashFlow);
    add(MARGIN_DEBT_ITEM_KEY, event.effectiveAt, debtItemFlow);
  }

  return { value: result, warnings: [] };
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
  const attributionFlowResult = mapAttributionItemFlows(
    state.transactionEvents || [],
    periodFlows,
    latestStart.timestamp,
    latestEnd.timestamp,
    currency
  );
  const latestAttribution = 'reason' in attributionFlowResult
    ? { status: 'unavailable' as const, reason: attributionFlowResult.reason, warnings: [] }
    : calculatePeriodAttribution({
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
      flows: attributionFlowResult.value.get(key) || []
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
