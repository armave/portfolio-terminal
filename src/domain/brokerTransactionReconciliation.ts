import type { BrokerCashflow, BrokerExecution } from '../types/broker';
import type { ClosedTrade } from '../types/portfolio';
import type { PortfolioTransactionEvent } from '../types/portfolioTransaction';

export type ReconciliationFeedStatus = 'complete' | 'partial' | 'unavailable';

export type BrokerExecutionLoadStatus = 'loading' | 'ready' | 'refreshing' | 'stale' | 'error';

/** A cached snapshot is not a complete current feed while a refresh is pending or has failed. */
export function getExecutionReconciliationFeedStatus(
  status: BrokerExecutionLoadStatus
): ReconciliationFeedStatus {
  return status === 'ready' ? 'complete' : 'partial';
}

// Internal evidence shapes stay private; consumers use the stable report contract only.
type BrokerActivityFindingType =
  | 'duplicate_broker_execution'
  | 'execution_revision_conflict'
  | 'execution_match_ambiguous'
  | 'execution_data_incomplete'
  | 'execution_unclassified'
  | 'execution_missing_in_app'
  | 'execution_missing_in_broker'
  | 'execution_quantity_mismatch'
  | 'execution_price_mismatch'
  | 'execution_fee_mismatch'
  | 'execution_fee_currency_mismatch'
  | 'execution_timing_difference'
  | 'duplicate_broker_cashflow'
  | 'cashflow_revision_conflict'
  | 'cashflow_unclassified'
  | 'cashflow_direction_mismatch'
  | 'cashflow_missing_in_app'
  | 'cashflow_missing_in_broker'
  | 'cashflow_amount_mismatch'
  | 'cashflow_match_ambiguous'
  | 'cashflow_currency_mismatch'
  | 'cashflow_type_mismatch';

interface BrokerActivityFinding {
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
  missingFields?: string[];
}

export interface BrokerActivityReconciliationReport {
  status: 'matched' | 'differences' | 'partial' | 'unavailable';
  comparedAt: number;
  brokerExecutionCount: number;
  appExecutionCount: number;
  brokerCashflowCount: number;
  appCashflowCount: number;
  matchedExecutionCount: number;
  /** Legacy app-authored closed-sale summaries matched without inventing buy events. */
  legacyClosedSaleCount: number;
  matchedLegacyClosedSaleCount: number;
  matchedLegacyExecutionCount: number;
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
  /** App-owned legacy sell summaries pre-dating the transaction journal. */
  legacyClosedTrades?: readonly ClosedTrade[];
  now?: number;
  timeToleranceMs?: number;
  maxTimingDifferenceMs?: number;
  quantityTolerance?: number;
  amountTolerance?: number;
  priceTolerance?: number;
}

interface NormalizedExecution {
  id: string;
  orderId?: string;
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

interface NormalizedLegacyClosedSale {
  id: string;
  ticker: string;
  quantity: number;
  price: number;
  at: number;
  dateOnly: boolean;
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
    ...(text(row.orderId) || text(row.raw?.order_id) || text(row.raw?.orderId)
      ? { orderId: text(row.orderId) || text(row.raw?.order_id) || text(row.raw?.orderId) }
      : {}),
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
function normalizeLegacyClosedSale(row: ClosedTrade, index: number): NormalizedLegacyClosedSale | null {
  const cleanTicker = ticker(row.ticker);
  const quantity = number(row.shares);
  const rawPrice = number(row.sellPrice);
  const price = rawPrice !== null && rawPrice > 0 ? rawPrice : number(row.exitPrice);
  // Closed-trade rows describe the sale, not the underlying buy executions.
  // Require a sale price and date so this fallback cannot infer an opening lot.
  const rawSaleDate = row.sellDate ?? row.exitDate ?? row.closedAt ?? row.date;
  const at = timestamp(row.sellDate) ?? timestamp(row.exitDate) ?? timestamp(row.closedAt) ?? timestamp(row.date);
  const dateOnly = typeof rawSaleDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawSaleDate.trim());
  if (!cleanTicker || quantity === null || quantity <= 0 || price === null || price <= 0 || at === null) return null;
  return {
    id: text(row.id) || `legacy-closed-sale:${cleanTicker}:${at}:${quantity}:${price}:${index}`,
    ticker: cleanTicker,
    quantity,
    price,
    at,
    dateOnly
  };
}

function normalizeCashflow(row: BrokerCashflow): NormalizedCashflow | null {
  const amount = number(row.amount);
  if (amount === null) return null;
  const description = `${text(row.type)} ${text(row.description)}`.toLowerCase();
  const type: PortfolioTransactionEvent['type'] | null = /dividend|distribution|coupon/.test(description)
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
              : /\badjustment\b|\bcorrection\b/.test(description)
                ? 'cash.adjustment'
                : null;
  // A generic/unknown provider cashflow must not be guessed to be an account
  // adjustment: that could falsely reconcile an unrelated operation with a
  // manual balance adjustment in the app journal.
  if (!type) return null;
  // Some broker cashflow feeds encode withdrawals as positive magnitudes and
  // rely on the operation type for direction. Normalize deposits/withdrawals
  // to signed account movement before comparing them with the app journal.
  const signedAmount = type === 'cash.deposit'
    ? Math.abs(amount)
    : type === 'cash.withdrawal' ? -Math.abs(amount) : amount;
  return { id: text(row.id) || `anonymous:${JSON.stringify([row.date, type, signedAmount, row.currency])}`, type, amount: signedAmount, currency: currency(row.currency), at: timestamp(row.date) };
}
function eventAmount(event: PortfolioTransactionEvent): number | null {
  return number(event.externalCashFlowAmount ?? event.cashDelta ?? event.grossAmount ?? event.netAmount ??
    (event.type === 'fee' ? event.fees : event.type === 'margin.interest' ? event.financingCost : undefined));
}
function sameExecutionObservation(left: NormalizedExecution, right: NormalizedExecution): boolean {
  return left.orderId === right.orderId &&
    left.ticker === right.ticker &&
    left.side === right.side &&
    left.quantity === right.quantity &&
    left.price === right.price &&
    left.currency === right.currency &&
    left.fee === right.fee &&
    left.feeCurrency === right.feeCurrency &&
    left.at === right.at;
}

function sameCashflowObservation(left: NormalizedCashflow, right: NormalizedCashflow): boolean {
  return left.type === right.type &&
    left.amount === right.amount &&
    left.currency === right.currency &&
    left.at === right.at;
}

const SIGNED_CASHFLOW_EVENT_TYPES = new Set<PortfolioTransactionEvent['type']>([
  'cash.deposit', 'cash.withdrawal', 'cash.transfer', 'cash.adjustment', 'dividend'
]);

function hasExplicitSignedCashflowAmount(event: PortfolioTransactionEvent): boolean {
  return SIGNED_CASHFLOW_EVENT_TYPES.has(event.type) &&
    (event.externalCashFlowAmount !== undefined || event.cashDelta !== undefined);
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
  let confidence: BrokerActivityFinding['confidence'] =
    input.executionStatus === 'complete' && input.cashflowStatus === 'complete' && appStatus === 'complete'
      ? 'confirmed' : 'provisional';
  const warnings: string[] = [];
  if (input.executionStatus !== 'complete') warnings.push('Broker execution history is incomplete; absence-based findings are suppressed.');
  if (input.cashflowStatus !== 'complete') warnings.push('Broker cashflow history is incomplete; absence-based findings are suppressed.');
  if (appStatus !== 'complete') warnings.push('App transaction journal coverage is incomplete; unmatched records are provisional and are not treated as confirmed omissions.');

  const findings: BrokerActivityFinding[] = [];
  let sourceDataIncomplete = false;
  const normalizedExecutionRows: NormalizedExecution[] = [];
  input.brokerExecutions.forEach((raw, index) => {
    const row = normalizeExecution(raw);
    if (row) {
      normalizedExecutionRows.push(row);
      if (/^(?:anonymous:|fallback-)/i.test(row.id)) {
        sourceDataIncomplete = true;
        warnings.push('One or more broker executions lack a provider-stable execution ID; matching is provisional.');
      }
      return;
    }
    sourceDataIncomplete = true;
    warnings.push('One or more broker execution rows could not be classified; affected rows were excluded from matching.');
    const tickerValue = ticker((raw as BrokerExecution | null)?.ticker);
    const ref = text((raw as BrokerExecution | null)?.id);
    findings.push(makeFinding({
      id: `execution-unclassified:${ref || index}`,
      type: 'execution_unclassified',
      subject: tickerValue || `Broker execution row ${index + 1}`,
      currency: currency((raw as BrokerExecution | null)?.currency) || undefined,
      brokerValue: number((raw as BrokerExecution | null)?.quantity),
      appValue: null,
      brokerReferences: ref ? [ref] : [],
      appEventIds: [],
      brokerAt: timestamp((raw as BrokerExecution | null)?.executedAt) ?? undefined,
      explanation: 'The broker execution is missing a usable instrument, supported side or positive quantity and was excluded from matching.'
    }, 'provisional'));
  });

  const uniqueBrokerRows: NormalizedExecution[] = [];
  const executionRowsById = new Map<string, NormalizedExecution[]>();
  for (const row of normalizedExecutionRows) {
    const group = executionRowsById.get(row.id) || [];
    group.push(row);
    executionRowsById.set(row.id, group);
  }
  for (const [id, rows] of [...executionRowsById.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const orderedRows = [...rows].sort((a, b) =>
      JSON.stringify([
        a.orderId ?? '', a.ticker, a.side, a.quantity, a.price, a.currency,
        a.fee, a.feeCurrency, a.at
      ]).localeCompare(JSON.stringify([
        b.orderId ?? '', b.ticker, b.side, b.quantity, b.price, b.currency,
        b.fee, b.feeCurrency, b.at
      ]))
    );
    const representative = orderedRows[0];
    if (orderedRows.every(row => sameExecutionObservation(representative, row))) {
      uniqueBrokerRows.push(representative);
      if (orderedRows.length > 1) {
        findings.push(makeFinding({
          id: `duplicate-execution:${id}`,
          type: 'duplicate_broker_execution',
          subject: `${representative.ticker} ${representative.side.toUpperCase()}`,
          currency: representative.currency || undefined,
          brokerValue: representative.quantity,
          appValue: null,
          brokerReferences: [id],
          appEventIds: [],
          brokerAt: representative.at ?? undefined,
          explanation: 'The broker history contains the same execution identifier and facts more than once.'
        }, confidence));
      }
      continue;
    }

    sourceDataIncomplete = true;
    findings.push(makeFinding({
      id: `execution-revision-conflict:${id}`,
      type: 'execution_revision_conflict',
      subject: `${representative.ticker} ${representative.side.toUpperCase()}`,
      currency: representative.currency || undefined,
      brokerValue: null,
      appValue: null,
      brokerReferences: [id],
      appEventIds: [],
      explanation: 'The same broker execution identifier appears with conflicting facts. No revision was selected because the feed does not identify which record supersedes the other.'
    }, 'provisional'));
    warnings.push('One or more broker execution IDs have conflicting revisions; affected records were excluded from matching.');
  }
  uniqueBrokerRows.sort((a, b) => a.id.localeCompare(b.id));
  if (sourceDataIncomplete) confidence = 'provisional';

  const appExecutions = input.appEvents
    .filter(event => EXECUTION_EVENT_TYPES.has(event.type))
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  const legacyClosedSales = (input.legacyClosedTrades ?? [])
    .map(normalizeLegacyClosedSale)
    .filter((row): row is NormalizedLegacyClosedSale => row !== null);
  const unmatchedBroker = new Set(uniqueBrokerRows.map((_, index) => index));
  const unmatchedApp = new Set(appExecutions.map((_, index) => index));
  const ambiguousBrokerIndices = new Set<number>();
  const ambiguousAppIndices = new Set<number>();
  const matchedPairs: Array<{ broker: NormalizedExecution; app: PortfolioTransactionEvent }> = [];

  const compareCandidate = (broker: NormalizedExecution, app: PortfolioTransactionEvent) => {
    const side = eventSide(app);
    if (ticker(app.ticker) !== broker.ticker || side !== broker.side) return false;
    if (currency(app.currency) && broker.currency && currency(app.currency) !== broker.currency) return false;
    return true;
  };

  type ExecutionMatchCandidate = {
    brokerIndex: number;
    broker: NormalizedExecution;
    index: number;
    event: PortfolioTransactionEvent;
    quantityMatch: boolean;
    quantityComparable: boolean;
    priceMatch: boolean;
    priceComparable: boolean;
    exactTime: boolean;
    acceptableTime: boolean;
    timeDelta: number | null;
    score: number;
    partialFillAggregateMatch: boolean;
    multipleFillsForOrder: boolean;
    identityMatch: boolean;
  };

  const candidatesByBroker = new Map<number, ExecutionMatchCandidate[]>();

  // Build the full candidate graph before consuming any records. This prevents
  // the one-to-one matcher from depending on the provider's array order.
  for (const brokerIndex of unmatchedBroker) {
    const broker = uniqueBrokerRows[brokerIndex];
    const candidates = [...unmatchedApp]
      .map(index => ({ index, event: appExecutions[index] }))
      .filter(candidate => {
        if (!compareCandidate(broker, candidate.event)) return false;
        const appOrderReference = text(candidate.event.externalOrderReferenceId);
        return !appOrderReference ||
          broker.orderId === appOrderReference ||
          text(candidate.event.externalReferenceId) === broker.id;
      })
      .map(candidate => {
        const event = candidate.event;
        const quantity = number(event.quantity);
        const price = number(event.unitPrice);
        const eventAt = event.effectiveAt;
        const timeDelta = broker.at === null ? null : Math.abs(broker.at - eventAt);
        const quantityComparable = quantity !== null;
        const quantityMatch = quantityComparable && Math.abs(quantity! - broker.quantity) <= quantityTolerance;
        const priceComparable = broker.price !== null && price !== null;
        const priceMatch = priceComparable && Math.abs(price! - broker.price!) <= priceTolerance;
        const identityMatch = Boolean(text(event.externalReferenceId)) &&
          text(event.externalReferenceId) === broker.id;

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
        const exactTime = timeDelta !== null
          ? timeDelta <= timeTolerance || (appDateOnly && sameUtcDay)
          : identityMatch;
        // A timestamp-free fallback is not enough evidence to match two rows.
        // An exact provider fill reference can still identify a pair, but the
        // missing timestamp is exposed as incomplete evidence after matching.
        const acceptableTime = timeDelta !== null
          ? timeDelta <= maxTimingDifference
          : identityMatch;

        // Partial fills may only be aggregated within an explicit provider order.
        // Same-symbol/side/time proximity is not enough to prove common order identity.
        const sameGroup = broker.orderId
          ? uniqueBrokerRows.filter(other =>
            other.orderId === broker.orderId &&
            other.ticker === broker.ticker &&
            other.side === broker.side &&
            (!broker.currency || !other.currency || other.currency === broker.currency) &&
            (other.at === null || Math.abs(other.at - eventAt) <= maxTimingDifference)
          )
          : [broker];
        const groupedQuantity = sameGroup.reduce((sum, row) => sum + row.quantity, 0);
        const multipleFillsForOrder = Boolean(broker.orderId) && sameGroup.length > 1;
        const partialFillAggregateMatch = multipleFillsForOrder &&
          quantity !== null && Math.abs(groupedQuantity - quantity) <= quantityTolerance;
        const appOrderReference = text(event.externalOrderReferenceId);
        const otherCandidateExecutions = uniqueBrokerRows.filter(other =>
          other.id !== broker.id &&
          other.ticker === broker.ticker &&
          other.side === broker.side &&
          (!broker.currency || !other.currency || other.currency === broker.currency) &&
          (!appOrderReference || other.orderId === appOrderReference) &&
          (other.at === null || Math.abs(other.at - eventAt) <= maxTimingDifference)
        );
        const ambiguousUnlinkedFill = quantity !== null &&
          Math.abs(quantity - broker.quantity) > quantityTolerance &&
          otherCandidateExecutions.length > 0 &&
          (!broker.orderId || otherCandidateExecutions.some(other => other.orderId !== broker.orderId));
        const ambiguousBrokerReferences = ambiguousUnlinkedFill
          ? [broker.id, ...otherCandidateExecutions.map(other => other.id)]
          : [];
        const score = (identityMatch ? 1_000 : 0) +
          (quantityMatch ? 100 : partialFillAggregateMatch ? -1_000 : 0) +
          (priceMatch ? 30 : 0) + (exactTime ? 20 : 0) +
          (acceptableTime ? 10 : 0) - (timeDelta ?? 0) / Math.max(maxTimingDifference, 1);
        return {
          ...candidate,
          brokerIndex,
          broker,
          quantityMatch,
          quantityComparable,
          priceMatch,
          priceComparable,
          exactTime,
          acceptableTime,
          timeDelta,
          score,
          partialFillAggregateMatch,
          multipleFillsForOrder,
          identityMatch,
          ambiguousUnlinkedFill,
          ambiguousBrokerReferences
        };
      })
      .filter(candidate => {
        if (candidate.ambiguousUnlinkedFill) {
          sourceDataIncomplete = true;
          confidence = 'provisional';
          ambiguousBrokerIndices.add(brokerIndex);
          ambiguousAppIndices.add(candidate.index);
          const brokerReferences = [...new Set(candidate.ambiguousBrokerReferences)].sort();
          const findingId = `execution-match-ambiguous-unlinked:${candidate.event.id}:${brokerReferences.join('|')}`;
          if (!findings.some(finding => finding.id === findingId)) {
            findings.push(makeFinding({
              id: findingId,
              type: 'execution_match_ambiguous',
              subject: `${broker.ticker} ${broker.side.toUpperCase()}`,
              currency: broker.currency || undefined,
              brokerValue: broker.quantity,
              appValue: number(candidate.event.quantity),
              brokerReferences,
              appEventIds: [candidate.event.id],
              brokerAt: broker.at ?? undefined,
              appAt: candidate.event.effectiveAt,
              explanation: 'Multiple nearby broker fills could represent this app transaction, but they do not share a verified order ID. No fills were grouped.'
            }, 'provisional'));
          }
          warnings.push('Multiple nearby broker fills lack a shared verified order ID; partial-fill matching was not attempted.');
        }
        return candidate.acceptableTime && !candidate.ambiguousUnlinkedFill &&
          (!candidate.multipleFillsForOrder || candidate.identityMatch);
      })
      .sort((a, b) => b.score - a.score || a.event.id.localeCompare(b.event.id));
    candidatesByBroker.set(brokerIndex, candidates);
  }

  // First reserve app events for which one broker execution has equally strong
  // alternatives. Input order and recordedAt are not execution identity.
  for (const [brokerIndex, candidates] of candidatesByBroker) {
    if (ambiguousBrokerIndices.has(brokerIndex) || candidates.length < 2) continue;
    const bestScore = candidates[0].score;
    const tiedBest = candidates.filter(candidate => Math.abs(candidate.score - bestScore) <= 1e-9);
    if (tiedBest.length < 2) continue;

    sourceDataIncomplete = true;
    confidence = 'provisional';
    ambiguousBrokerIndices.add(brokerIndex);
    tiedBest.forEach(candidate => ambiguousAppIndices.add(candidate.index));
    const broker = uniqueBrokerRows[brokerIndex];
    const appEventIds = [...new Set(tiedBest.map(candidate => candidate.event.id))].sort();
    const findingId = `execution-match-ambiguous-fallback:${broker.id}:${appEventIds.join('|')}`;
    if (!findings.some(finding => finding.id === findingId)) {
      findings.push(makeFinding({
        id: findingId,
        type: 'execution_match_ambiguous',
        subject: `${broker.ticker} ${broker.side.toUpperCase()}`,
        currency: broker.currency || undefined,
        brokerValue: broker.quantity,
        appValue: null,
        brokerReferences: [broker.id],
        appEventIds,
        brokerAt: broker.at ?? undefined,
        explanation: 'More than one app-authored transaction is an equally strong fallback match for this broker execution. recordedAt does not establish execution identity, so no candidate was selected.'
      }, 'provisional'));
    }
    warnings.push('A broker execution has multiple equally strong app fallback candidates; manual review is required.');
  }

  // Then detect multiple broker rows competing equally for a single app event.
  const candidatesByApp = new Map<number, ExecutionMatchCandidate[]>();
  for (const [brokerIndex, candidates] of candidatesByBroker) {
    if (ambiguousBrokerIndices.has(brokerIndex)) continue;
    for (const candidate of candidates) {
      const group = candidatesByApp.get(candidate.index) || [];
      group.push(candidate);
      candidatesByApp.set(candidate.index, group);
    }
  }
  for (const [appIndex, candidates] of candidatesByApp) {
    if (ambiguousAppIndices.has(appIndex)) continue;
    const activeCandidates = candidates.filter(candidate =>
      !ambiguousBrokerIndices.has(candidate.brokerIndex)
    );
    if (activeCandidates.length < 2) continue;
    activeCandidates.sort((a, b) =>
      b.score - a.score || a.broker.id.localeCompare(b.broker.id)
    );
    const bestScore = activeCandidates[0].score;
    const tiedBest = activeCandidates.filter(candidate => Math.abs(candidate.score - bestScore) <= 1e-9);
    if (tiedBest.length < 2) continue;

    sourceDataIncomplete = true;
    confidence = 'provisional';
    ambiguousAppIndices.add(appIndex);
    tiedBest.forEach(candidate => ambiguousBrokerIndices.add(candidate.brokerIndex));
    const app = appExecutions[appIndex];
    const brokerReferences = [...new Set(tiedBest.map(candidate => candidate.broker.id))].sort();
    findings.push(makeFinding({
      id: `execution-match-ambiguous-contenders:${app.id}:${brokerReferences.join('|')}`,
      type: 'execution_match_ambiguous',
      subject: `${ticker(app.ticker)} ${eventSide(app)?.toUpperCase() || ''}`.trim(),
      currency: currency(app.currency) || undefined,
      brokerValue: null,
      appValue: number(app.quantity),
      brokerReferences,
      appEventIds: [app.id],
      appAt: app.effectiveAt,
      explanation: 'Multiple broker executions are equally strong candidates for one app transaction. No execution was selected.'
    }, 'provisional'));
    warnings.push('Multiple broker executions are equally plausible for one app transaction; manual review is required.');
  }

  // Resolve only unambiguous pairs in stable score order. Any ambiguous row
  // remains unconsumed and is excluded from absence-based findings.
  const orderedCandidates = [...candidatesByBroker.entries()]
    .filter(([brokerIndex]) => !ambiguousBrokerIndices.has(brokerIndex))
    .flatMap(([, candidates]) => candidates.filter(candidate =>
      !ambiguousAppIndices.has(candidate.index)
    ))
    .sort((a, b) =>
      b.score - a.score ||
      a.broker.id.localeCompare(b.broker.id) ||
      a.event.id.localeCompare(b.event.id)
    );
  for (const candidate of orderedCandidates) {
    if (!unmatchedBroker.has(candidate.brokerIndex) || !unmatchedApp.has(candidate.index)) continue;
    unmatchedBroker.delete(candidate.brokerIndex);
    unmatchedApp.delete(candidate.index);
    matchedPairs.push({ broker: candidate.broker, app: candidate.event });

    if (candidate.quantityComparable && !candidate.quantityMatch) {
      findings.push(makeFinding({
        id: `execution-quantity:${candidate.broker.id}:${candidate.event.id}`,
        type: 'execution_quantity_mismatch',
        subject: `${candidate.broker.ticker} ${candidate.broker.side.toUpperCase()}`,
        currency: candidate.broker.currency || undefined,
        brokerValue: candidate.broker.quantity,
        appValue: number(candidate.event.quantity),
        difference: candidate.broker.quantity - number(candidate.event.quantity)!,
        brokerReferences: [candidate.broker.id],
        appEventIds: [candidate.event.id],
        brokerAt: candidate.broker.at ?? undefined,
        appAt: candidate.event.effectiveAt,
        explanation: 'The broker fill quantity differs from the app transaction quantity.'
      }, confidence));
    }
    if (candidate.priceComparable && !candidate.priceMatch) {
      findings.push(makeFinding({
        id: `execution-price:${candidate.broker.id}:${candidate.event.id}`,
        type: 'execution_price_mismatch',
        subject: `${candidate.broker.ticker} ${candidate.broker.side.toUpperCase()}`,
        currency: candidate.broker.currency || undefined,
        brokerValue: candidate.broker.price,
        appValue: number(candidate.event.unitPrice),
        difference: candidate.broker.price! - (number(candidate.event.unitPrice) ?? 0),
        brokerReferences: [candidate.broker.id],
        appEventIds: [candidate.event.id],
        brokerAt: candidate.broker.at ?? undefined,
        appAt: candidate.event.effectiveAt,
        explanation: 'The broker execution price differs from the app transaction price.'
      }, confidence));
    }

    const appFee = number(candidate.event.fees);
    const brokerFeeCurrency = candidate.broker.feeCurrency || candidate.broker.currency;
    const appFeeCurrency = currency(candidate.event.feeCurrency) || currency(candidate.event.currency);
    if (candidate.event.type !== 'trade.sell' && candidate.broker.fee !== null && appFee !== null &&
      brokerFeeCurrency && appFeeCurrency && brokerFeeCurrency !== appFeeCurrency) {
      findings.push(makeFinding({
        id: `execution-fee-currency:${candidate.broker.id}:${candidate.event.id}`,
        type: 'execution_fee_currency_mismatch',
        subject: `${candidate.broker.ticker} ${candidate.broker.side.toUpperCase()}`,
        currency: brokerFeeCurrency,
        brokerValue: Math.abs(candidate.broker.fee),
        appValue: Math.abs(appFee),
        brokerReferences: [candidate.broker.id],
        appEventIds: [candidate.event.id],
        brokerAt: candidate.broker.at ?? undefined,
        appAt: candidate.event.effectiveAt,
        explanation: 'The broker and app transaction fees use different currencies; no conversion was attempted.'
      }, confidence));
    }
    if (candidate.event.type !== 'trade.sell' && candidate.broker.fee !== null && appFee !== null &&
      (!candidate.broker.feeCurrency || !candidate.event.feeCurrency || candidate.broker.feeCurrency === currency(candidate.event.feeCurrency)) &&
      Math.abs(Math.abs(candidate.broker.fee) - Math.abs(appFee)) > amountTolerance) {
      findings.push(makeFinding({
        id: `execution-fee:${candidate.broker.id}:${candidate.event.id}`,
        type: 'execution_fee_mismatch',
        subject: `${candidate.broker.ticker} ${candidate.broker.side.toUpperCase()}`,
        currency: candidate.broker.feeCurrency || currency(candidate.event.feeCurrency) || undefined,
        brokerValue: Math.abs(candidate.broker.fee),
        appValue: Math.abs(appFee),
        difference: Math.abs(candidate.broker.fee) - Math.abs(appFee),
        brokerReferences: [candidate.broker.id],
        appEventIds: [candidate.event.id],
        brokerAt: candidate.broker.at ?? undefined,
        appAt: candidate.event.effectiveAt,
        explanation: 'The broker commission differs from the app-recorded transaction fee.'
      }, confidence));
    }
    if (!candidate.exactTime && candidate.timeDelta !== null) {
      findings.push(makeFinding({
        id: `execution-time:${candidate.broker.id}:${candidate.event.id}`,
        type: 'execution_timing_difference',
        subject: `${candidate.broker.ticker} ${candidate.broker.side.toUpperCase()}`,
        currency: candidate.broker.currency || undefined,
        brokerValue: candidate.broker.at,
        appValue: candidate.event.effectiveAt,
        difference: candidate.timeDelta,
        brokerReferences: [candidate.broker.id],
        appEventIds: [candidate.event.id],
        brokerAt: candidate.broker.at ?? undefined,
        appAt: candidate.event.effectiveAt,
        explanation: 'The broker and app transaction timestamps differ beyond the normal matching tolerance.'
      }, confidence));
    }

    const missingFields: string[] = [];
    if (number(candidate.event.quantity) === null) missingFields.push('App execution quantity');
    if (candidate.broker.price === null) missingFields.push('Broker execution price');
    if (number(candidate.event.unitPrice) === null) missingFields.push('App execution price');
    if (candidate.broker.at === null) missingFields.push('Broker execution timestamp');
    if (!candidate.broker.currency) missingFields.push('Broker execution currency');
    if (!currency(candidate.event.currency)) missingFields.push('App transaction currency');
    if (candidate.event.type !== 'trade.sell') {
      if (candidate.broker.fee === null) missingFields.push('Broker execution commission');
      if (appFee === null) missingFields.push('App transaction commission');
    }
    if (missingFields.length > 0) {
      sourceDataIncomplete = true;
      confidence = 'provisional';
      findings.push(makeFinding({
        id: `execution-data-incomplete:${candidate.broker.id}:${candidate.event.id}`,
        type: 'execution_data_incomplete',
        subject: `${candidate.broker.ticker} ${candidate.broker.side.toUpperCase()}`,
        currency: candidate.broker.currency || currency(candidate.event.currency) || undefined,
        brokerValue: candidate.broker.price,
        appValue: number(candidate.event.unitPrice),
        brokerReferences: [candidate.broker.id],
        appEventIds: [candidate.event.id],
        brokerAt: candidate.broker.at ?? undefined,
        appAt: candidate.event.effectiveAt,
        explanation: 'The matched execution is missing one or more source values needed for a complete comparison. Missing values were not treated as zero.',
        missingFields
      }, 'provisional'));
      warnings.push('One or more matched executions lack verifiable price, commission, currency or timestamp evidence; affected comparisons are provisional.');
    }
  }
  // Remaining app and broker rows with same instrument/side/currency/date can
  // represent one app order filled by multiple broker partial executions.
  for (const appIndex of [...unmatchedApp]) {
    if (ambiguousAppIndices.has(appIndex)) continue;
    const app = appExecutions[appIndex];
    const side = eventSide(app);
    const appQuantity = number(app.quantity);
    const appPrice = number(app.unitPrice);
    if (!side || appQuantity === null) continue;
    const candidates = [...unmatchedBroker].filter(index => {
      if (ambiguousBrokerIndices.has(index)) return false;
      const broker = uniqueBrokerRows[index];
      if (!broker.orderId) return false;
      if (broker.ticker !== ticker(app.ticker) || broker.side !== side) return false;
      if (currency(app.currency) && broker.currency && currency(app.currency) !== broker.currency) return false;
      return broker.at === null || Math.abs(broker.at - app.effectiveAt) <= maxTimingDifference;
    });
    const byOrder = new Map<string, number[]>();
    for (const index of candidates) {
      const orderId = uniqueBrokerRows[index].orderId!;
      const group = byOrder.get(orderId) || [];
      group.push(index);
      byOrder.set(orderId, group);
    }
    const matchingOrderGroups = [...byOrder.entries()].filter(([, indices]) => {
      if (indices.length < 2) return false;
      const quantityTotal = indices.reduce((sum, index) => sum + uniqueBrokerRows[index].quantity, 0);
      if (Math.abs(quantityTotal - appQuantity) > quantityTolerance) return false;
      const pricedRows = indices.map(index => uniqueBrokerRows[index]).filter(row => row.price !== null);
      if (appPrice !== null && pricedRows.length === indices.length) {
        const grossTotal = pricedRows.reduce((sum, row) => sum + row.quantity * (row.price ?? 0), 0);
        const weightedPrice = quantityTotal > 0 ? grossTotal / quantityTotal : null;
        if (weightedPrice !== null && Math.abs(weightedPrice - appPrice) > priceTolerance) return false;
      }
      return true;
    });
    const explicitOrderReference = text(app.externalOrderReferenceId);
    const matchingGroups = explicitOrderReference
      ? matchingOrderGroups
        .filter(([orderId]) => orderId === explicitOrderReference)
        .map(([, indices]) => indices)
      : matchingOrderGroups.map(([, indices]) => indices);
    if (matchingGroups.length > 1) {
      sourceDataIncomplete = true;
      confidence = 'provisional';
      findings.push(makeFinding({
        id: `execution-match-ambiguous:${app.id}`,
        type: 'execution_match_ambiguous',
        subject: `${ticker(app.ticker)} ${side.toUpperCase()}`,
        currency: currency(app.currency) || undefined,
        brokerValue: matchingGroups[0].reduce((sum, index) => sum + uniqueBrokerRows[index].quantity, 0),
        appValue: appQuantity,
        brokerReferences: matchingGroups.flatMap(indices => indices.map(index => uniqueBrokerRows[index].id)),
        appEventIds: [app.id],
        appAt: app.effectiveAt,
        explanation: 'More than one broker order has fills that match this app transaction. No order was selected without a unique match.'
      }, 'provisional'));
      matchingGroups.flatMap(indices => indices).forEach(index => ambiguousBrokerIndices.add(index));
      ambiguousAppIndices.add(appIndex);
      warnings.push('More than one broker order has fills that match an app transaction; manual review is required.');
      continue;
    }
    if (matchingGroups.length !== 1) continue;
    const selected = matchingGroups[0];
    selected.forEach(index => {
      unmatchedBroker.delete(index);
      matchedPairs.push({ broker: uniqueBrokerRows[index], app });
    });
    unmatchedApp.delete(appIndex);
    const refs = selected.map(index => uniqueBrokerRows[index].id);
    const selectedFees = selected.map(index => uniqueBrokerRows[index].fee);
    const feesComplete = selectedFees.every((fee): fee is number => fee !== null);
    const totalFees = feesComplete ? selectedFees.reduce((sum, fee) => sum + fee, 0) : null;
    const appFee = number(app.fees);
    if (appFee !== null && totalFees !== null &&
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

  // Legacy closed-trade summaries pre-date PT-02 journal events. They are
  // app-owned sale evidence, so use them only to match SELL executions with an
  // exact ticker, quantity, price and sale date. Never derive BUY events from
  // their average entry price: it can combine multiple FIFO acquisition lots.
  const unmatchedLegacyClosedSales = new Set(legacyClosedSales.map((_, index) => index));
  let matchedLegacyClosedSaleCount = 0;
  let matchedLegacyExecutionCount = 0;
  const sameUtcDay = (left: number, right: number): boolean => {
    const a = new Date(left);
    const b = new Date(right);
    return a.getUTCFullYear() === b.getUTCFullYear() &&
      a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
  };
  const legacySaleTimeMatches = (broker: NormalizedExecution, sale: NormalizedLegacyClosedSale) =>
    broker.at !== null && (sale.dateOnly
      ? sameUtcDay(broker.at, sale.at)
      : Math.abs(broker.at - sale.at) <= maxTimingDifference);

  // Match unambiguous one-fill/one-sale pairs first. Require both quantity and
  // price: ticker/date alone is not enough to identify a historical execution.
  let foundLegacyPair = true;
  while (foundLegacyPair) {
    foundLegacyPair = false;
    for (const brokerIndex of [...unmatchedBroker]) {
      if (ambiguousBrokerIndices.has(brokerIndex)) continue;
      const broker = uniqueBrokerRows[brokerIndex];
      if (broker.side !== 'sell' || broker.at === null || broker.price === null) continue;
      const candidates = [...unmatchedLegacyClosedSales].filter(saleIndex => {
        const sale = legacyClosedSales[saleIndex];
        return sale.ticker === broker.ticker && legacySaleTimeMatches(broker, sale) &&
          Math.abs(sale.quantity - broker.quantity) <= quantityTolerance &&
          Math.abs(sale.price - broker.price!) <= priceTolerance;
      });
      if (candidates.length !== 1) continue;
      const saleIndex = candidates[0];
      const sale = legacyClosedSales[saleIndex];
      const reverseCandidates = [...unmatchedBroker].filter(candidateIndex => {
        if (ambiguousBrokerIndices.has(candidateIndex)) return false;
        const candidate = uniqueBrokerRows[candidateIndex];
        return candidate.side === 'sell' && candidate.at !== null && candidate.price !== null &&
          candidate.ticker === sale.ticker && legacySaleTimeMatches(candidate, sale) &&
          Math.abs(candidate.quantity - sale.quantity) <= quantityTolerance &&
          Math.abs(candidate.price - sale.price) <= priceTolerance;
      });
      if (reverseCandidates.length !== 1) continue;
      unmatchedBroker.delete(brokerIndex);
      unmatchedLegacyClosedSales.delete(saleIndex);
      matchedLegacyClosedSaleCount += 1;
      matchedLegacyExecutionCount += 1;
      foundLegacyPair = true;
      break;
    }
  }

  // A legacy sell command may be represented by several provider partial fills.
  // Aggregate only when one legacy sale is the sole app summary for that ticker
  // and UTC day and the complete set of same-day broker fills agrees exactly.
  for (const saleIndex of [...unmatchedLegacyClosedSales]) {
    const sale = legacyClosedSales[saleIndex];
    const sameDaySales = legacyClosedSales.filter(other =>
      other.ticker === sale.ticker && sameUtcDay(other.at, sale.at)
    );
    if (sameDaySales.length !== 1) continue;
    const candidates = [...unmatchedBroker].filter(index => {
      const broker = uniqueBrokerRows[index];
      return broker.side === 'sell' && broker.ticker === sale.ticker &&
        broker.at !== null && broker.price !== null && sameUtcDay(broker.at, sale.at);
    });
    if (candidates.length < 2) continue;
    const quantityTotal = candidates.reduce((sum, index) => sum + uniqueBrokerRows[index].quantity, 0);
    if (Math.abs(quantityTotal - sale.quantity) > quantityTolerance) continue;
    const weightedPrice = candidates.reduce((sum, index) => {
      const broker = uniqueBrokerRows[index];
      return sum + broker.quantity * (broker.price ?? 0);
    }, 0) / quantityTotal;
    if (Math.abs(weightedPrice - sale.price) > priceTolerance) continue;
    candidates.forEach(index => unmatchedBroker.delete(index));
    unmatchedLegacyClosedSales.delete(saleIndex);
    matchedLegacyClosedSaleCount += 1;
    matchedLegacyExecutionCount += candidates.length;
  }

  for (const index of unmatchedBroker) {
    if (ambiguousBrokerIndices.has(index)) continue;
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
    if (ambiguousAppIndices.has(index)) continue;
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
  const normalizedCashflowRows: NormalizedCashflow[] = [];
  input.brokerCashflows.forEach((raw, index) => {
    const row = normalizeCashflow(raw);
    if (row) {
      normalizedCashflowRows.push(row);
      if (/^anonymous:/i.test(row.id) || /^freedom-\d{4}-\d{2}-\d{2}\|/i.test(row.id)) {
        sourceDataIncomplete = true;
        warnings.push('One or more broker cashflows lack a provider-stable cashflow ID; matching is provisional.');
      }
      return;
    }
    sourceDataIncomplete = true;
    warnings.push('One or more broker cashflow rows could not be classified; affected rows were excluded from matching.');
    const ref = text((raw as BrokerCashflow | null)?.id);
    findings.push(makeFinding({
      id: `cashflow-unclassified:${ref || index}`,
      type: 'cashflow_unclassified',
      subject: text((raw as BrokerCashflow | null)?.type) || `Broker cashflow row ${index + 1}`,
      currency: currency((raw as BrokerCashflow | null)?.currency) || undefined,
      brokerValue: null,
      appValue: null,
      brokerReferences: ref ? [ref] : [],
      appEventIds: [],
      explanation: 'The broker cashflow could not be safely classified or had no usable amount and was excluded from matching.'
    }, 'provisional'));
  });

  const brokerCashflowById = new Map<string, NormalizedCashflow>();
  const conflictingCashflowIds = new Set<string>();
  const brokerCashflows: NormalizedCashflow[] = [];
  for (const row of normalizedCashflowRows) {
    if (conflictingCashflowIds.has(row.id)) continue;
    const prior = brokerCashflowById.get(row.id);
    if (prior) {
      if (sameCashflowObservation(prior, row)) {
        findings.push(makeFinding({
          id: `duplicate-cashflow:${row.id}`,
          type: 'duplicate_broker_cashflow',
          subject: row.type,
          currency: row.currency || undefined,
          brokerValue: row.amount,
          appValue: null,
          brokerReferences: [row.id],
          appEventIds: [],
          brokerAt: row.at ?? undefined,
          explanation: 'The broker history contains the same cashflow identifier and facts more than once.'
        }, confidence));
      } else {
        sourceDataIncomplete = true;
        conflictingCashflowIds.add(row.id);
        const priorIndex = brokerCashflows.findIndex(candidate => candidate.id === row.id);
        if (priorIndex >= 0) brokerCashflows.splice(priorIndex, 1);
        findings.push(makeFinding({
          id: `cashflow-revision-conflict:${row.id}`,
          type: 'cashflow_revision_conflict',
          subject: row.type,
          currency: row.currency || undefined,
          brokerValue: row.amount,
          appValue: prior.amount,
          brokerReferences: [row.id],
          appEventIds: [],
          brokerAt: row.at ?? undefined,
          explanation: 'The same broker cashflow identifier appears with conflicting facts. No revision was selected because the feed does not identify which record supersedes the other.'
        }, 'provisional'));
        warnings.push('One or more broker cashflow IDs have conflicting revisions; affected records were excluded from matching.');
      }
      continue;
    }
    brokerCashflowById.set(row.id, row);
    brokerCashflows.push(row);
  }
  if (sourceDataIncomplete) confidence = 'provisional';
  appCashflows.forEach(event => {
    if (eventAmount(event) === null) {
      sourceDataIncomplete = true;
      confidence = 'provisional';
      warnings.push('One or more app cashflow events have no usable amount; matching is provisional.');
    }
  });
  const unmatchedCashflowBroker = new Set(brokerCashflows.map((_, index) => index));
  let matchedCashflowCount = 0;
  const unmatchedCashflowApp = new Set(appCashflows.map((_, index) => index));
  const ambiguousCashflowAppIndices = new Set<number>();
  const ambiguousCashflowBrokerIndices = new Set<number>();

  const selectUniqueClosestCashflowCandidate = (
    brokerIndex: number,
    broker: NormalizedCashflow,
    candidates: Array<{
      index: number;
      event: PortfolioTransactionEvent;
      appAmount: number | null;
      timeDelta: number;
    }>
  ): { candidate: typeof candidates[number] | null; ambiguous: boolean } => {
    if (candidates.length === 0) return { candidate: null, ambiguous: false };
    const ranked = [...candidates].sort((a, b) =>
      a.timeDelta - b.timeDelta || a.event.id.localeCompare(b.event.id)
    );
    const bestTimeDelta = ranked[0].timeDelta;
    const tied = ranked.filter(candidate => Math.abs(candidate.timeDelta - bestTimeDelta) <= 1e-9);
    const bestAlreadyAmbiguous = ambiguousCashflowAppIndices.has(ranked[0].index);
    if (tied.length > 1 || bestAlreadyAmbiguous) {
      sourceDataIncomplete = true;
      confidence = 'provisional';
      ambiguousCashflowBrokerIndices.add(brokerIndex);
      tied.forEach(candidate => ambiguousCashflowAppIndices.add(candidate.index));
      const appEventIds = [...new Set(tied.map(candidate => candidate.event.id))].sort();
      const findingId = `cashflow-match-ambiguous:${broker.id}:${appEventIds.join('|')}`;
      if (!findings.some(finding => finding.id === findingId)) {
        findings.push(makeFinding({
          id: findingId,
          type: 'cashflow_match_ambiguous',
          subject: broker.type,
          currency: broker.currency || undefined,
          brokerValue: broker.amount,
          appValue: null,
          brokerReferences: [broker.id],
          appEventIds,
          brokerAt: broker.at ?? undefined,
          explanation: 'More than one app-authored cashflow is an equally strong fallback match for this broker cashflow. No candidate was selected.'
        }, 'provisional'));
      }
      warnings.push('A broker cashflow has multiple equally strong app fallback candidates; manual review is required.');
      return { candidate: null, ambiguous: true };
    }
    return { candidate: ranked[0], ambiguous: false };
  };

  for (let brokerIndex = 0; brokerIndex < brokerCashflows.length; brokerIndex += 1) {
    if (ambiguousCashflowBrokerIndices.has(brokerIndex)) continue;
    const broker = brokerCashflows[brokerIndex];
    // Keep earlier ambiguous candidates visible so a second broker row cannot
    // claim one of them as a unique match merely because another row was seen first.
    const availableAppIndices = [...unmatchedCashflowApp];

    const signedDirectionCandidates = availableAppIndices.map(index => {
      const event = appCashflows[index];
      const appAmount = eventAmount(event);
      return {
        index,
        event,
        appAmount,
        timeDelta: Math.abs(event.effectiveAt - (broker.at ?? event.effectiveAt))
      };
    }).filter(candidate =>
      candidate.event.type === broker.type &&
      (!broker.currency || !candidate.event.currency || currency(candidate.event.currency) === broker.currency) &&
      candidate.appAmount !== null &&
      hasExplicitSignedCashflowAmount(candidate.event) &&
      Math.abs(Math.abs(candidate.appAmount) - Math.abs(broker.amount)) <= amountTolerance &&
      candidate.timeDelta <= maxTimingDifference &&
      Math.sign(candidate.appAmount) !== 0 &&
      Math.sign(broker.amount) !== 0 &&
      Math.sign(candidate.appAmount) !== Math.sign(broker.amount)
    );
    const directionSelection = selectUniqueClosestCashflowCandidate(
      brokerIndex, broker, signedDirectionCandidates
    );
    if (directionSelection.ambiguous) continue;
    if (directionSelection.candidate) {
      const selected = directionSelection.candidate;
      unmatchedCashflowBroker.delete(brokerIndex);
      unmatchedCashflowApp.delete(selected.index);
      findings.push(makeFinding({
        id: `cashflow-direction:${broker.id}:${selected.event.id}`,
        type: 'cashflow_direction_mismatch',
        subject: broker.type,
        currency: broker.currency || undefined,
        brokerValue: broker.amount,
        appValue: selected.appAmount,
        difference: broker.amount - (selected.appAmount ?? 0),
        brokerReferences: [broker.id],
        appEventIds: [selected.event.id],
        brokerAt: broker.at ?? undefined,
        appAt: selected.event.effectiveAt,
        explanation: 'The broker and app record opposite signed cash movements for the same cashflow. No balance adjustment was made.'
      }, confidence));
      continue;
    }

    const exactCandidates = availableAppIndices.map(index => {
      const event = appCashflows[index];
      const appAmount = eventAmount(event);
      return {
        index,
        event,
        appAmount,
        timeDelta: Math.abs(event.effectiveAt - (broker.at ?? event.effectiveAt))
      };
    }).filter(candidate =>
      candidate.event.type === broker.type &&
      (!broker.currency || !candidate.event.currency || currency(candidate.event.currency) === broker.currency) &&
      candidate.appAmount !== null &&
      Math.abs(Math.abs(candidate.appAmount) - Math.abs(broker.amount)) <= amountTolerance &&
      candidate.timeDelta <= maxTimingDifference
    );
    const exactSelection = selectUniqueClosestCashflowCandidate(brokerIndex, broker, exactCandidates);
    if (exactSelection.ambiguous) continue;
    if (exactSelection.candidate) {
      unmatchedCashflowBroker.delete(brokerIndex);
      unmatchedCashflowApp.delete(exactSelection.candidate.index);
      matchedCashflowCount += 1;
      continue;
    }

    const classificationCandidates = availableAppIndices.map(index => {
      const event = appCashflows[index];
      const appAmount = eventAmount(event);
      return {
        index,
        event,
        appAmount,
        timeDelta: Math.abs(event.effectiveAt - (broker.at ?? event.effectiveAt))
      };
    }).filter(candidate =>
      candidate.event.type !== broker.type &&
      (!broker.currency || !candidate.event.currency || currency(candidate.event.currency) === broker.currency) &&
      candidate.appAmount !== null &&
      Math.abs(Math.abs(candidate.appAmount) - Math.abs(broker.amount)) <= amountTolerance &&
      candidate.timeDelta <= maxTimingDifference
    );
    const classificationSelection = selectUniqueClosestCashflowCandidate(
      brokerIndex, broker, classificationCandidates
    );
    if (classificationSelection.ambiguous) continue;
    if (classificationSelection.candidate) {
      const selected = classificationSelection.candidate;
      unmatchedCashflowBroker.delete(brokerIndex);
      unmatchedCashflowApp.delete(selected.index);
      findings.push(makeFinding({
        id: `cashflow-type:${broker.id}:${selected.event.id}`,
        type: 'cashflow_type_mismatch',
        subject: broker.type,
        currency: broker.currency || undefined,
        brokerValue: broker.amount,
        appValue: selected.appAmount,
        brokerReferences: [broker.id],
        appEventIds: [selected.event.id],
        brokerAt: broker.at ?? undefined,
        appAt: selected.event.effectiveAt,
        explanation: 'The broker and app classify the same cashflow differently.'
      }, confidence));
      continue;
    }

    const amountMismatchCandidates = availableAppIndices.map(index => {
      const event = appCashflows[index];
      const appAmount = eventAmount(event);
      return {
        index,
        event,
        appAmount,
        timeDelta: Math.abs(event.effectiveAt - (broker.at ?? event.effectiveAt))
      };
    }).filter(candidate =>
      candidate.event.type === broker.type &&
      (!broker.currency || !candidate.event.currency || currency(candidate.event.currency) === broker.currency) &&
      candidate.appAmount !== null &&
      Math.abs(Math.abs(candidate.appAmount) - Math.abs(broker.amount)) > amountTolerance &&
      candidate.timeDelta <= maxTimingDifference
    );
    const amountSelection = selectUniqueClosestCashflowCandidate(
      brokerIndex, broker, amountMismatchCandidates
    );
    if (amountSelection.ambiguous) continue;
    if (amountSelection.candidate) {
      const selected = amountSelection.candidate;
      unmatchedCashflowBroker.delete(brokerIndex);
      unmatchedCashflowApp.delete(selected.index);
      findings.push(makeFinding({
        id: `cashflow-amount:${broker.id}:${selected.event.id}`,
        type: 'cashflow_amount_mismatch',
        subject: broker.type,
        currency: broker.currency || undefined,
        brokerValue: broker.amount,
        appValue: selected.appAmount,
        difference: broker.amount - (selected.appAmount ?? 0),
        brokerReferences: [broker.id],
        appEventIds: [selected.event.id],
        brokerAt: broker.at ?? undefined,
        appAt: selected.event.effectiveAt,
        explanation: 'The broker and app cashflow amounts differ; no balance adjustment was made.'
      }, confidence));
      continue;
    }

    const currencyMismatchCandidates = availableAppIndices.map(index => {
      const event = appCashflows[index];
      const appAmount = eventAmount(event);
      return {
        index,
        event,
        appAmount,
        timeDelta: Math.abs(event.effectiveAt - (broker.at ?? event.effectiveAt))
      };
    }).filter(candidate =>
      candidate.event.type === broker.type &&
      candidate.appAmount !== null &&
      Math.abs(Math.abs(candidate.appAmount) - Math.abs(broker.amount)) <= amountTolerance &&
      Boolean(currency(candidate.event.currency)) &&
      Boolean(broker.currency) &&
      currency(candidate.event.currency) !== broker.currency &&
      candidate.timeDelta <= maxTimingDifference
    );
    const currencySelection = selectUniqueClosestCashflowCandidate(
      brokerIndex, broker, currencyMismatchCandidates
    );
    if (currencySelection.ambiguous) continue;
    if (currencySelection.candidate) {
      const selected = currencySelection.candidate;
      unmatchedCashflowBroker.delete(brokerIndex);
      unmatchedCashflowApp.delete(selected.index);
      findings.push(makeFinding({
        id: `cashflow-currency:${broker.id}:${selected.event.id}`,
        type: 'cashflow_currency_mismatch',
        subject: broker.type,
        currency: broker.currency || undefined,
        brokerValue: broker.amount,
        appValue: selected.appAmount,
        brokerReferences: [broker.id],
        appEventIds: [selected.event.id],
        brokerAt: broker.at ?? undefined,
        appAt: selected.event.effectiveAt,
        explanation: 'The broker and app cashflow records use different currencies; no conversion was attempted.'
      }, confidence));
    }
  }
  for (const index of unmatchedCashflowBroker) {
    if (ambiguousCashflowBrokerIndices.has(index)) continue;
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
    if (ambiguousCashflowAppIndices.has(index)) continue;
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
  const partial = input.executionStatus !== 'complete' || input.cashflowStatus !== 'complete' ||
    appStatus !== 'complete' || sourceDataIncomplete;
  return {
    status: unavailable ? 'unavailable' : partial ? 'partial' : findings.length ? 'differences' : 'matched',
    comparedAt: now,
    brokerExecutionCount: uniqueBrokerRows.length,
    appExecutionCount: appExecutions.length,
    brokerCashflowCount: brokerCashflows.length,
    appCashflowCount: appCashflows.length,
    matchedExecutionCount: matchedPairs.length,
    legacyClosedSaleCount: legacyClosedSales.length,
    matchedLegacyClosedSaleCount,
    matchedLegacyExecutionCount,
    matchedCashflowCount,
    findings,
    warnings: [...new Set(warnings)]
  };
}
