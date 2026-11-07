import type { BrokerCashflow, BrokerExecution } from '../types/broker';
import type { PortfolioTransactionEvent } from '../types/portfolioTransaction';

export type ReconciliationFeedStatus = 'complete' | 'partial' | 'unavailable';

export type BrokerActivityFindingType =
  | 'duplicate_broker_execution'
  | 'execution_missing_in_app'
  | 'execution_missing_in_broker'
  | 'execution_quantity_mismatch'
  | 'execution_price_mismatch'
  | 'execution_fee_mismatch'
  | 'execution_fee_currency_mismatch'
  | 'execution_timing_difference'
  | 'cashflow_missing_in_app'
  | 'cashflow_missing_in_broker'
  | 'cashflow_amount_mismatch'
  | 'cashflow_currency_mismatch'
  | 'cashflow_type_mismatch';

export interface BrokerActivityFinding {
  id: string;
  type: BrokerActivityFindingType;
  subject: string;
  currency?: string;
  brokerValue: number | null;
  appValue: number | null;
  difference?: number;
  confidence: 'confirmed' | 'provisional';
  brokerReferences: string[];
  appEventIds: string[];
  brokerAt?: number;
  appAt?: number;
  explanation: string;
}

export interface BrokerActivityReconciliationReport {
  status: 'matched' | 'differences' | 'partial' | 'unavailable';
  comparedAt: number;
  brokerExecutionCount: number;
  appExecutionCount: number;
  brokerCashflowCount: number;
  appCashflowCount: number;
  matchedExecutionCount: number;
  matchedCashflowCount: number;
  findings: BrokerActivityFinding[];
  warnings: string[];
}

export interface ReconcileBrokerActivityInput {
  brokerExecutions: readonly BrokerExecution[];
  brokerCashflows: readonly BrokerCashflow[];
  appEvents: readonly PortfolioTransactionEvent[];
  executionStatus: ReconciliationFeedStatus;
  cashflowStatus: ReconciliationFeedStatus;
  /** PT-02 journal coverage is still being completed; default to partial. */
  appHistoryStatus?: ReconciliationFeedStatus;
  now?: number;
  timeToleranceMs?: number;
  maxTimingDifferenceMs?: number;
  quantityTolerance?: number;
  amountTolerance?: number;
  priceTolerance?: number;
}

interface NormalizedExecution {
  id: string;
  ticker: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number | null;
  currency: string;
  fee: number | null;
  feeCurrency: string;
  at: number | null;
  source: BrokerExecution;
}

interface NormalizedCashflow {
  id: string;
  type: PortfolioTransactionEvent['type'];
  amount: number;
  currency: string;
  at: number | null;
}

const EXECUTION_EVENT_TYPES = new Set<PortfolioTransactionEvent['type']>([
  'trade.buy', 'trade.sell', 'cash-holding.buy', 'cash-holding.sell'
]);
const CASHFLOW_EVENT_TYPES = new Set<PortfolioTransactionEvent['type']>([
  'dividend', 'fee', 'margin.interest', 'cash.deposit', 'cash.withdrawal',
  'cash.transfer', 'cash.adjustment'
]);

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
function currency(value: unknown): string {
  return text(value).toUpperCase();
}
function ticker(value: unknown): string {
  return text(value).toUpperCase().replace(/\.US$/i, '');
}
function number(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
function timestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1e12) return value;
    if (value > 1e9) return value * 1000;
    return null;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function normalizeSide(value: unknown): 'buy' | 'sell' | null {
  const side = text(value).toLowerCase();
  if (['buy', 'b', 'purchase', '1'].includes(side)) return 'buy';
  if (['sell', 's', 'sale', 'sold', '2'].includes(side)) return 'sell';
  return null;
}
function eventSide(event: PortfolioTransactionEvent): 'buy' | 'sell' | null {
  if (event.type === 'trade.buy' || event.type === 'cash-holding.buy') return 'buy';
  if (event.type === 'trade.sell' || event.type === 'cash-holding.sell') return 'sell';
  return null;
}
function normalizeExecution(row: BrokerExecution): NormalizedExecution | null {
  const cleanTicker = ticker(row.ticker);
  const side = normalizeSide(row.side);
  const quantity = number(row.quantity);
  if (!cleanTicker || !side || quantity === null || quantity <= 0) return null;
  return {
    id: text(row.id) || `anonymous:${JSON.stringify([cleanTicker, side, quantity, row.executedAt])}`,
    ticker: cleanTicker,
    side,
    quantity,
    price: number(row.price),
    currency: currency(row.currency),
    fee: number(row.commission),
    feeCurrency: currency(row.commissionCurrency),
    at: timestamp(row.executedAt),
    source: row
  };
}
function normalizeCashflow(row: BrokerCashflow): NormalizedCashflow | null {
  const amount = number(row.amount);
  if (amount === null) return null;
  const description = `${text(row.type)} ${text(row.description)}`.toLowerCase();
  const type: PortfolioTransactionEvent['type'] = /dividend|distribution|coupon/.test(description)
    ? 'dividend'
    : /margin|interest|financing|borrow fee/.test(description)
      ? 'margin.interest'
      : /fee|commission|charge|tax/.test(description)
        ? 'fee'
        : /transfer/.test(description)
          ? 'cash.transfer'
          : /withdraw|debit/.test(description)
            ? 'cash.withdrawal'
            : /deposit|funding|credit/.test(description)
              ? 'cash.deposit'
              : 'cash.adjustment';
  return { id: text(row.id) || `anonymous:${JSON.stringify([row.date, type, amount, row.currency])}`, type, amount, currency: currency(row.currency), at: timestamp(row.date) };
}
function eventAmount(event: PortfolioTransactionEvent): number | null {
  return number(event.externalCashFlowAmount ?? event.cashDelta ?? event.grossAmount ?? event.netAmount ??
    (event.type === 'fee' ? event.fees : event.type === 'margin.interest' ? event.financingCost : undefined));
}
function makeFinding(
  finding: Omit<BrokerActivityFinding, 'confidence'>,
  confidence: BrokerActivityFinding['confidence']
): BrokerActivityFinding {
  return { ...finding, confidence };
}

/**
 * Compare broker executions/cashflows to app-authored journal events.
 * Broker-import audit events are deliberately excluded: they prove ingestion,
 * not that an app-owned trade or cashflow was recorded. This function is
 * deterministic and read-only; it never proposes or applies financial writes.
 */
export function reconcileBrokerActivity(
  input: ReconcileBrokerActivityInput
): BrokerActivityReconciliationReport {
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const timeTolerance = input.timeToleranceMs ?? 5 * 60 * 1000;
  const maxTimingDifference = input.maxTimingDifferenceMs ?? 24 * 60 * 60 * 1000;
  const quantityTolerance = input.quantityTolerance ?? 1e-6;
  const amountTolerance = input.amountTolerance ?? 0.01;
  const priceTolerance = input.priceTolerance ?? 0.01;
  const appStatus = input.appHistoryStatus ?? 'partial';
  const confidence: BrokerActivityFinding['confidence'] =
    input.executionStatus === 'complete' && input.cashflowStatus === 'complete' && appStatus === 'complete'
      ? 'confirmed' : 'provisional';
  const warnings: string[] = [];
  if (input.executionStatus !== 'complete') warnings.push('Broker execution history is incomplete; absence-based findings are suppressed.');
  if (input.cashflowStatus !== 'complete') warnings.push('Broker cashflow history is incomplete; absence-based findings are suppressed.');
  if (appStatus !== 'complete') warnings.push('App transaction journal coverage is incomplete; unmatched records are provisional and are not treated as confirmed omissions.');

  const findings: BrokerActivityFinding[] = [];
  const brokerRows = input.brokerExecutions.map(normalizeExecution).filter((row): row is NormalizedExecution => row !== null);
  const uniqueBrokerRows: NormalizedExecution[] = [];
  const seenExecutionIds = new Map<string, NormalizedExecution>();
  for (const row of brokerRows) {
    const prior = seenExecutionIds.get(row.id);
    if (prior) {
      findings.push(makeFinding({
        id: `duplicate-execution:${row.id}:${uniqueBrokerRows.length}`,
        type: 'duplicate_broker_execution',
        subject: `${row.ticker} ${row.side.toUpperCase()}`,
        currency: row.currency || undefined,
        brokerValue: row.quantity,
        appValue: null,
        brokerReferences: [row.id],
        appEventIds: [],
        brokerAt: row.at ?? undefined,
        explanation: 'The broker history contains the same execution identifier more than once.'
      }, confidence));
      continue;
    }
    seenExecutionIds.set(row.id, row);
    uniqueBrokerRows.push(row);
  }

  const appExecutions = input.appEvents.filter(event => EXECUTION_EVENT_TYPES.has(event.type));
  const unmatchedBroker = new Set(uniqueBrokerRows.map((_, index) => index));
  const unmatchedApp = new Set(appExecutions.map((_, index) => index));
  const matchedPairs: Array<{ broker: NormalizedExecution; app: PortfolioTransactionEvent }> = [];

  const compareCandidate = (broker: NormalizedExecution, app: PortfolioTransactionEvent) => {
    const side = eventSide(app);
    if (ticker(app.ticker) !== broker.ticker || side !== broker.side) return false;
    if (currency(app.currency) && broker.currency && currency(app.currency) !== broker.currency) return false;
    return true;
  };

  // Exact/fallback one-to-one matches first; stable IDs are preferred when present.
  uniqueBrokerRows.forEach((broker, brokerIndex) => {
    const candidates = [...unmatchedApp].map(index => ({ index, event: appExecutions[index] }))
      .filter(candidate => compareCandidate(broker, candidate.event))
      .map(candidate => {
        const event = candidate.event;
        const quantity = number(event.quantity);
        const price = number(event.unitPrice);
        const eventAt = event.effectiveAt;
        const timeDelta = broker.at === null ? null : Math.abs(broker.at - eventAt);
        const quantityMatch = quantity !== null && Math.abs(quantity - broker.quantity) <= quantityTolerance;
        const priceMatch = broker.price === null || price === null || Math.abs(price - broker.price) <= priceTolerance;
        // App trade dates are often recorded at UTC midnight while broker fills
        // carry intraday timestamps. A same-calendar-day date-only event is not
        // a timing discrepancy; explicit app timestamps still use the tolerance.
        const appDate = new Date(eventAt);
        const brokerDate = broker.at === null ? null : new Date(broker.at);
        const validAppDate = Number.isFinite(appDate.getTime());
        const validBrokerDate = brokerDate !== null && Number.isFinite(brokerDate.getTime());
        const appDateOnly = validAppDate && appDate.getUTCHours() === 0 &&
          appDate.getUTCMinutes() === 0 && appDate.getUTCSeconds() === 0 &&
          appDate.getUTCMilliseconds() === 0;
        const sameUtcDay = validBrokerDate && validAppDate &&
          brokerDate!.getUTCFullYear() === appDate.getUTCFullYear() &&
          brokerDate!.getUTCMonth() === appDate.getUTCMonth() &&
          brokerDate!.getUTCDate() === appDate.getUTCDate();
        const exactTime = timeDelta === null || timeDelta <= timeTolerance || (appDateOnly && sameUtcDay);
        const acceptableTime = timeDelta === null || timeDelta <= maxTimingDifference;
        const sameGroup = uniqueBrokerRows.filter(other =>
          other.ticker === broker.ticker &&
          other.side === broker.side &&
          (!broker.currency || !other.currency || other.currency === broker.currency) &&
          (other.at === null || Math.abs(other.at - eventAt) <= maxTimingDifference)
        );
        const groupedQuantity = sameGroup.reduce((sum, row) => sum + row.quantity, 0);
        const partialFillAggregateMatch = sameGroup.length > 1 &&
          quantity !== null && Math.abs(groupedQuantity - quantity) <= quantityTolerance;
        const identityMatch = Boolean(text(event.externalReferenceId)) && text(event.externalReferenceId) === broker.id;
        const score = (identityMatch ? 1000 : 0) +
          (quantityMatch ? 100 : partialFillAggregateMatch ? -1000 : 0) +
          (priceMatch ? 30 : 0) + (exactTime ? 20 : 0) +
          (acceptableTime ? 10 : 0) - (timeDelta ?? 0) / Math.max(maxTimingDifference, 1);
        return { ...candidate, quantityMatch, priceMatch, exactTime, acceptableTime, timeDelta, score, partialFillAggregateMatch, identityMatch };
      })
      .filter(candidate => candidate.acceptableTime && (!candidate.partialFillAggregateMatch || candidate.identityMatch))
      .sort((a, b) => b.score - a.score || a.event.recordedAt - b.event.recordedAt);
    const best = candidates[0];
    if (!best) return;
    unmatchedBroker.delete(brokerIndex);
    unmatchedApp.delete(best.index);
    matchedPairs.push({ broker, app: best.event });
    if (!best.quantityMatch) {
      findings.push(makeFinding({
        id: `execution-quantity:${broker.id}:${best.event.id}`,
        type: 'execution_quantity_mismatch',
        subject: `${broker.ticker} ${broker.side.toUpperCase()}`,
        currency: broker.currency || undefined,
        brokerValue: broker.quantity,
        appValue: number(best.event.quantity),
        difference: broker.quantity - (number(best.event.quantity) ?? 0),
        brokerReferences: [broker.id],
        appEventIds: [best.event.id],
        brokerAt: broker.at ?? undefined,
        appAt: best.event.effectiveAt,
        explanation: 'The broker fill quantity differs from the app transaction quantity.'
      }, confidence));
    }
    if (!best.priceMatch) {
      findings.push(makeFinding({
        id: `execution-price:${broker.id}:${best.event.id}`,
        type: 'execution_price_mismatch',
        subject: `${broker.ticker} ${broker.side.toUpperCase()}`,
        currency: broker.currency || undefined,
        brokerValue: broker.price,
        appValue: number(best.event.unitPrice),
        difference: (broker.price ?? 0) - (number(best.event.unitPrice) ?? 0),
        brokerReferences: [broker.id],
        appEventIds: [best.event.id],
        brokerAt: broker.at ?? undefined,
        appAt: best.event.effectiveAt,
        explanation: 'The broker execution price differs from the app transaction price.'
      }, confidence));
    }
    const appFee = number(best.event.fees);
    const brokerFeeCurrency = broker.feeCurrency || broker.currency;
    const appFeeCurrency = currency(best.event.feeCurrency) || currency(best.event.currency);
    if (best.event.type !== 'trade.sell' && broker.fee !== null && appFee !== null &&
      brokerFeeCurrency && appFeeCurrency && brokerFeeCurrency !== appFeeCurrency) {
      findings.push(makeFinding({
        id: `execution-fee-currency:${broker.id}:${best.event.id}`,
        type: 'execution_fee_currency_mismatch',
        subject: `${broker.ticker} ${broker.side.toUpperCase()}`,
        currency: brokerFeeCurrency,
        brokerValue: Math.abs(broker.fee),
        appValue: Math.abs(appFee),
        brokerReferences: [broker.id],
        appEventIds: [best.event.id],
        brokerAt: broker.at ?? undefined,
        appAt: best.event.effectiveAt,
        explanation: 'The broker and app transaction fees use different currencies; no conversion was attempted.'
      }, confidence));
    }
    if (best.event.type !== 'trade.sell' && broker.fee !== null && appFee !== null &&
      (!broker.feeCurrency || !best.event.feeCurrency || broker.feeCurrency === currency(best.event.feeCurrency)) &&
      Math.abs(Math.abs(broker.fee) - Math.abs(appFee)) > amountTolerance) {
      findings.push(makeFinding({
        id: `execution-fee:${broker.id}:${best.event.id}`,
        type: 'execution_fee_mismatch',
        subject: `${broker.ticker} ${broker.side.toUpperCase()}`,
        currency: broker.feeCurrency || currency(best.event.feeCurrency) || undefined,
        brokerValue: Math.abs(broker.fee),
        appValue: Math.abs(appFee),
        difference: Math.abs(broker.fee) - Math.abs(appFee),
        brokerReferences: [broker.id],
        appEventIds: [best.event.id],
        brokerAt: broker.at ?? undefined,
        appAt: best.event.effectiveAt,
        explanation: 'The broker commission differs from the app-recorded transaction fee.'
      }, confidence));
    }
    if (!best.exactTime && best.timeDelta !== null) {
      findings.push(makeFinding({
        id: `execution-time:${broker.id}:${best.event.id}`,
        type: 'execution_timing_difference',
        subject: `${broker.ticker} ${broker.side.toUpperCase()}`,
        currency: broker.currency || undefined,
        brokerValue: broker.at,
        appValue: best.event.effectiveAt,
        difference: best.timeDelta,
        brokerReferences: [broker.id],
        appEventIds: [best.event.id],
        brokerAt: broker.at ?? undefined,
        appAt: best.event.effectiveAt,
        explanation: 'The broker and app transaction timestamps differ beyond the normal matching tolerance.'
      }, confidence));
    }
  });

  // Remaining app and broker rows with same instrument/side/currency/date can
  // represent one app order filled by multiple broker partial executions.
  for (const appIndex of [...unmatchedApp]) {
    const app = appExecutions[appIndex];
    const side = eventSide(app);
    const appQuantity = number(app.quantity);
    const appPrice = number(app.unitPrice);
    if (!side || appQuantity === null) continue;
    const candidates = [...unmatchedBroker].filter(index => {
      const broker = uniqueBrokerRows[index];
      if (broker.ticker !== ticker(app.ticker) || broker.side !== side) return false;
      if (currency(app.currency) && broker.currency && currency(app.currency) !== broker.currency) return false;
      return broker.at === null || Math.abs(broker.at - app.effectiveAt) <= maxTimingDifference;
    }).sort((a, b) => (uniqueBrokerRows[a].at ?? 0) - (uniqueBrokerRows[b].at ?? 0));
    if (candidates.length < 2) continue;
    const selected: number[] = [];
    let quantityTotal = 0;
    let grossTotal = 0;
    for (const index of candidates) {
      const broker = uniqueBrokerRows[index];
      selected.push(index);
      quantityTotal += broker.quantity;
      grossTotal += broker.quantity * (broker.price ?? appPrice ?? 0);
      if (quantityTotal >= appQuantity - quantityTolerance) break;
    }
    if (Math.abs(quantityTotal - appQuantity) > quantityTolerance || !selected.length) continue;
    const weightedPrice = quantityTotal > 0 ? grossTotal / quantityTotal : null;
    if (appPrice !== null && weightedPrice !== null && Math.abs(weightedPrice - appPrice) > priceTolerance) continue;
    selected.forEach(index => unmatchedBroker.delete(index));
    unmatchedApp.delete(appIndex);
    const refs = selected.map(index => uniqueBrokerRows[index].id);
    const totalFees = selected.reduce((sum, index) => sum + (uniqueBrokerRows[index].fee ?? 0), 0);
    const appFee = number(app.fees);
    if (appFee !== null && selected.some(index => uniqueBrokerRows[index].fee !== null) &&
      Math.abs(totalFees - Math.abs(appFee)) > amountTolerance) {
      findings.push(makeFinding({
        id: `partial-fill-fee:${app.id}`,
        type: 'execution_fee_mismatch',
        subject: `${ticker(app.ticker)} ${side.toUpperCase()}`,
        currency: currency(app.feeCurrency) || undefined,
        brokerValue: totalFees,
        appValue: Math.abs(appFee),
        difference: totalFees - Math.abs(appFee),
        brokerReferences: refs,
        appEventIds: [app.id],
        appAt: app.effectiveAt,
        explanation: 'The combined commissions for broker partial fills differ from the app-recorded transaction fee.'
      }, confidence));
    }
  }

  for (const index of unmatchedBroker) {
    const row = uniqueBrokerRows[index];
    findings.push(makeFinding({
      id: `execution-unmatched-broker:${row.id}`,
      type: 'execution_missing_in_app',
      subject: `${row.ticker} ${row.side.toUpperCase()}`,
      currency: row.currency || undefined,
      brokerValue: row.quantity,
      appValue: null,
      brokerReferences: [row.id],
      appEventIds: [],
      brokerAt: row.at ?? undefined,
      explanation: 'No corresponding app-authored trade was found in the available transaction journal.'
    }, confidence));
  }
  for (const index of unmatchedApp) {
    const row = appExecutions[index];
    findings.push(makeFinding({
      id: `execution-unmatched-app:${row.id}`,
      type: 'execution_missing_in_broker',
      subject: `${ticker(row.ticker)} ${eventSide(row)?.toUpperCase() || ''}`.trim(),
      currency: currency(row.currency) || undefined,
      brokerValue: null,
      appValue: number(row.quantity),
      brokerReferences: [],
      appEventIds: [row.id],
      appAt: row.effectiveAt,
      explanation: 'No corresponding broker execution was found in the available provider history.'
    }, confidence));
  }

  const appCashflows = input.appEvents.filter(event => CASHFLOW_EVENT_TYPES.has(event.type) && event.actor.type !== 'broker');
  const brokerCashflows = input.brokerCashflows.map(normalizeCashflow).filter((row): row is NormalizedCashflow => row !== null);
  const unmatchedCashflowBroker = new Set(brokerCashflows.map((_, index) => index));
  let matchedCashflowCount = 0;
  const unmatchedCashflowApp = new Set(appCashflows.map((_, index) => index));
  for (const broker of brokerCashflows) {
    const candidate = [...unmatchedCashflowApp].map(index => ({ index, event: appCashflows[index] }))
      .filter(({ event }) => event.type === broker.type && (!broker.currency || !event.currency || currency(event.currency) === broker.currency))
      .map(({ index, event }) => {
        const appAmount = eventAmount(event);
        const delta = appAmount === null ? Number.POSITIVE_INFINITY : Math.abs(Math.abs(appAmount) - Math.abs(broker.amount));
        const timeDelta = Math.abs(event.effectiveAt - (broker.at ?? event.effectiveAt));
        return { index, event, appAmount, delta, timeDelta };
      })
      .filter(candidate => candidate.delta <= amountTolerance && candidate.timeDelta <= maxTimingDifference)
      .sort((a, b) => a.timeDelta - b.timeDelta);
    if (candidate[0]) {
      unmatchedCashflowBroker.delete(brokerCashflows.indexOf(broker));
      unmatchedCashflowApp.delete(candidate[0].index);
      matchedCashflowCount += 1;
      continue;
    }
    const classificationMismatch = [...unmatchedCashflowApp].map(index => ({ index, event: appCashflows[index] }))
      .find(({ event }) => event.type !== broker.type &&
        (!broker.currency || !event.currency || currency(event.currency) === broker.currency) &&
        Math.abs(Math.abs(eventAmount(event) ?? 0) - Math.abs(broker.amount)) <= amountTolerance &&
        Math.abs(event.effectiveAt - (broker.at ?? event.effectiveAt)) <= maxTimingDifference);
    if (classificationMismatch) {
      unmatchedCashflowBroker.delete(brokerCashflows.indexOf(broker));
      unmatchedCashflowApp.delete(classificationMismatch.index);
      findings.push(makeFinding({
        id: `cashflow-type:${broker.id}:${classificationMismatch.event.id}`,
        type: 'cashflow_type_mismatch',
        subject: broker.type,
        currency: broker.currency || undefined,
        brokerValue: broker.amount,
        appValue: eventAmount(classificationMismatch.event),
        brokerReferences: [broker.id],
        appEventIds: [classificationMismatch.event.id],
        brokerAt: broker.at ?? undefined,
        appAt: classificationMismatch.event.effectiveAt,
        explanation: 'The broker and app classify the same cashflow differently.'
      }, confidence));
      continue;
    }
    const amountMismatch = [...unmatchedCashflowApp].map(index => ({ index, event: appCashflows[index] }))
      .map(candidate => ({
        ...candidate,
        appAmount: eventAmount(candidate.event),
        timeDelta: Math.abs(candidate.event.effectiveAt - (broker.at ?? candidate.event.effectiveAt))
      }))
      .filter(candidate => candidate.event.type === broker.type &&
        (!broker.currency || !candidate.event.currency || currency(candidate.event.currency) === broker.currency) &&
        candidate.appAmount !== null &&
        Math.abs(Math.abs(candidate.appAmount) - Math.abs(broker.amount)) > amountTolerance &&
        candidate.timeDelta <= maxTimingDifference)
      .sort((a, b) => a.timeDelta - b.timeDelta)[0];
    if (amountMismatch) {
      unmatchedCashflowBroker.delete(brokerCashflows.indexOf(broker));
      unmatchedCashflowApp.delete(amountMismatch.index);
      findings.push(makeFinding({
        id: `cashflow-amount:${broker.id}:${amountMismatch.event.id}`,
        type: 'cashflow_amount_mismatch',
        subject: broker.type,
        currency: broker.currency || undefined,
        brokerValue: broker.amount,
        appValue: amountMismatch.appAmount,
        difference: broker.amount - (amountMismatch.appAmount ?? 0),
        brokerReferences: [broker.id],
        appEventIds: [amountMismatch.event.id],
        brokerAt: broker.at ?? undefined,
        appAt: amountMismatch.event.effectiveAt,
        explanation: 'The broker and app cashflow amounts differ; no balance adjustment was made.'
      }, confidence));
      continue;
    }
    const currencyMismatch = [...unmatchedCashflowApp].map(index => ({ index, event: appCashflows[index] }))
      .find(({ event }) => event.type === broker.type &&
        Math.abs(Math.abs(eventAmount(event) ?? 0) - Math.abs(broker.amount)) <= amountTolerance &&
        Boolean(currency(event.currency)) && Boolean(broker.currency) &&
        currency(event.currency) !== broker.currency);
    if (currencyMismatch) {
      unmatchedCashflowBroker.delete(brokerCashflows.indexOf(broker));
      unmatchedCashflowApp.delete(currencyMismatch.index);
      findings.push(makeFinding({
        id: `cashflow-currency:${broker.id}:${currencyMismatch.event.id}`,
        type: 'cashflow_currency_mismatch',
        subject: broker.type,
        currency: broker.currency || undefined,
        brokerValue: broker.amount,
        appValue: eventAmount(currencyMismatch.event),
        brokerReferences: [broker.id],
        appEventIds: [currencyMismatch.event.id],
        brokerAt: broker.at ?? undefined,
        appAt: currencyMismatch.event.effectiveAt,
        explanation: 'The broker and app cashflow records use different currencies; no conversion was attempted.'
      }, confidence));
    }
  }
  for (const index of unmatchedCashflowBroker) {
    const row = brokerCashflows[index];
    findings.push(makeFinding({
      id: `cashflow-unmatched-broker:${row.id}`,
      type: 'cashflow_missing_in_app',
      subject: row.type,
      currency: row.currency || undefined,
      brokerValue: row.amount,
      appValue: null,
      brokerReferences: [row.id],
      appEventIds: [],
      brokerAt: row.at ?? undefined,
      explanation: 'No corresponding app-authored cashflow event was found in the available journal.'
    }, confidence));
  }
  for (const index of unmatchedCashflowApp) {
    const row = appCashflows[index];
    findings.push(makeFinding({
      id: `cashflow-unmatched-app:${row.id}`,
      type: 'cashflow_missing_in_broker',
      subject: row.type,
      currency: currency(row.currency) || undefined,
      brokerValue: null,
      appValue: eventAmount(row),
      brokerReferences: [],
      appEventIds: [row.id],
      appAt: row.effectiveAt,
      explanation: 'No corresponding broker cashflow was found in the available provider history.'
    }, confidence));
  }

  const unavailable = input.executionStatus === 'unavailable' && input.cashflowStatus === 'unavailable';
  const partial = input.executionStatus !== 'complete' || input.cashflowStatus !== 'complete' || appStatus !== 'complete';
  return {
    status: unavailable ? 'unavailable' : partial ? 'partial' : findings.length ? 'differences' : 'matched',
    comparedAt: now,
    brokerExecutionCount: uniqueBrokerRows.length,
    appExecutionCount: appExecutions.length,
    brokerCashflowCount: brokerCashflows.length,
    appCashflowCount: appCashflows.length,
    matchedExecutionCount: matchedPairs.length,
    matchedCashflowCount,
    findings,
    warnings: [...new Set(warnings)]
  };
}
