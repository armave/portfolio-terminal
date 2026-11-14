import type { ClosedTrade } from '../types/portfolio';
import type {
  PortfolioTransactionEvent,
  PortfolioTransactionHistoryFeeCorrection,
  PortfolioTransactionHistoryFeeAllocation,
  PortfolioTransactionHistoryFeeSnapshot
} from '../types/portfolioTransaction';
import {
  appendPortfolioTransactionEvent,
  createPortfolioTransactionEvent,
  isPortfolioTransactionEventList
} from './portfolioTransactionJournal';

type CashflowReference = { id: string };

export interface ClosedHistoryFeeAuditUpdate {
  closedTrades: ClosedTrade[];
  transactionEvents: PortfolioTransactionEvent[];
  appendedCount: number;
  rejectedCount: number;
  rejectedTradeIds: string[];
}

export interface ClosedHistoryFeeAuditParityResult {
  matches: boolean;
  discrepancies: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function marginFeeValue(trade: ClosedTrade): number {
  const record = asRecord(trade) ?? {};
  return Math.max(Math.abs(finite(record.marginInterest) ?? 0), Math.abs(finite(record.marginFee) ?? 0));
}

function readAllocations(value: unknown): PortfolioTransactionHistoryFeeAllocation[] | null {
  const record = asRecord(value);
  if (!record) return null;
  const entries = Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length > 500) return null;
  const allocations: PortfolioTransactionHistoryFeeAllocation[] = [];
  for (const [cashflowId, rawAmount] of entries) {
    const amount = finite(rawAmount);
    if (!cashflowId.trim() || cashflowId.length > 180 || amount === null || amount < 0) return null;
    allocations.push({ cashflowId, amount: Number(amount.toFixed(2)) });
  }
  return allocations;
}

function feeSnapshot(trade: ClosedTrade, before: boolean): PortfolioTransactionHistoryFeeSnapshot | null {
  const record = asRecord(trade) ?? {};
  const marginFee = Number(marginFeeValue(trade).toFixed(2));
  const feeTotal = finite(record.feesAndCommissions) ?? finite(record.totalCommissions);
  const netProfit = finite(record.netProfit) ?? finite(record.netRealizedGain);
  let cashflowAllocations = readAllocations(record.marginFeeAllocations);
  if (cashflowAllocations === null) {
    if (!before || marginFee <= 0) {
      if (!before) return null;
      cashflowAllocations = [];
    }
  }
  if (cashflowAllocations && Math.abs(cashflowAllocations.reduce((sum, item) => sum + item.amount, 0) - marginFee) > 0.011) {
    return null;
  }
  return {
    marginFee,
    feesAndCommissions: feeTotal === null ? null : Number(feeTotal.toFixed(2)),
    netProfit: netProfit === null ? null : Number(netProfit.toFixed(2)),
    cashflowAllocations
  };
}

function stableHash(value: string): string {
  let a = 2166136261;
  let b = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    a = Math.imul(a ^ code, 16777619);
    b = Math.imul(b ^ code, 2246822519);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

function canonical(value: unknown): string {
  return JSON.stringify(value);
}

function latestCorrections(events: readonly PortfolioTransactionEvent[], closedTradeId: string): PortfolioTransactionEvent[] {
  const corrections = events.filter(event =>
    event.type === 'history.correction' && event.historyFeeCorrection?.closedTradeId === closedTradeId
  );
  const superseded = new Set(corrections
    .map(event => event.historyFeeCorrection?.revisionOfEventId)
    .filter((value): value is string => Boolean(value)));
  return corrections.filter(event => !superseded.has(event.id));
}

function saleEventForTrade(events: readonly PortfolioTransactionEvent[], trade: ClosedTrade): PortfolioTransactionEvent | undefined {
  const saleEventId = String(trade.transactionEventId ?? '').trim();
  if (!saleEventId) return undefined;
  return events.find(event => event.id === saleEventId && event.type === 'trade.sell');
}

function snapshotMatchesTrade(snapshot: PortfolioTransactionHistoryFeeSnapshot, trade: ClosedTrade): boolean {
  const actual = feeSnapshot(trade, false);
  return actual !== null && canonical(actual) === canonical(snapshot);
}

/**
 * Records app-side Closed History Sync fee revisions. Rows without an immutable
 * trade ID, linked app sale event, or source cashflow evidence are left unchanged.
 */
export function buildClosedHistoryFeeAuditUpdate(
  currentEvents: readonly PortfolioTransactionEvent[],
  previousTrades: readonly ClosedTrade[],
  candidateTrades: readonly ClosedTrade[],
  cashflows: readonly CashflowReference[],
  recordedAt = Date.now()
): ClosedHistoryFeeAuditUpdate {
  if (!isPortfolioTransactionEventList(currentEvents)) {
    throw new TypeError('Portfolio transaction event history is malformed.');
  }
  const cashflowIds = new Set(cashflows
    .filter(row => row && typeof row.id === 'string')
    .map(row => row.id));
  const transactionEvents = [...currentEvents];
  const closedTrades = [...candidateTrades];
  const previousById = new Map<string, ClosedTrade[]>();
  previousTrades.forEach(trade => {
    const id = String(trade.id ?? '').trim();
    if (!id) return;
    const group = previousById.get(id) ?? [];
    group.push(trade);
    previousById.set(id, group);
  });
  const seenIds = new Set<string>();
  const rejectedTradeIds: string[] = [];
  let appendedCount = 0;
  let rejectedCount = 0;

  for (let index = 0; index < candidateTrades.length; index += 1) {
    const candidate = candidateTrades[index];
    const id = String(candidate.id ?? '').trim();
    const previousGroup = id ? previousById.get(id) : undefined;
    const previous = previousGroup?.length === 1 ? previousGroup[0] : undefined;
    if (!previous) {
      if (canonical(candidate) !== canonical(previousTrades[index])) {
        closedTrades[index] = previousTrades[index] ?? candidate;
        rejectedCount += 1;
        rejectedTradeIds.push(id || `row:${index}`);
      }
      continue;
    }
    if (seenIds.has(id)) {
      closedTrades[index] = previous;
      rejectedCount += 1;
      rejectedTradeIds.push(id);
      continue;
    }
    seenIds.add(id);

    const before = feeSnapshot(previous, true);
    const after = feeSnapshot(candidate, false);
    if (!before || !after) {
      if (canonical(candidate) !== canonical(previous)) {
        closedTrades[index] = previous;
        rejectedCount += 1;
        rejectedTradeIds.push(id);
      }
      continue;
    }
    if (canonical(before) === canonical(after)) continue;

    const saleEvent = saleEventForTrade(currentEvents, previous);
    if (!saleEvent || String(candidate.transactionEventId ?? '') !== saleEvent.id ||
        !after.cashflowAllocations ||
        after.cashflowAllocations.some(allocation => !cashflowIds.has(allocation.cashflowId))) {
      closedTrades[index] = previous;
      rejectedCount += 1;
      rejectedTradeIds.push(id);
      continue;
    }

    const heads = latestCorrections(transactionEvents, id);
    if (heads.length > 1) {
      closedTrades[index] = previous;
      rejectedCount += 1;
      rejectedTradeIds.push(id);
      continue;
    }
    const priorCorrection = heads[0];
    if (priorCorrection) {
      const priorSnapshot = priorCorrection.historyFeeCorrection?.after;
      if (priorCorrection.historyFeeCorrection?.saleEventId !== saleEvent.id ||
          !priorSnapshot || canonical(priorSnapshot) !== canonical(before)) {
        closedTrades[index] = previous;
        rejectedCount += 1;
        rejectedTradeIds.push(id);
        continue;
      }
    }

    const correction: PortfolioTransactionHistoryFeeCorrection = {
      kind: 'closed-trade-margin-fee',
      closedTradeId: id,
      saleEventId: saleEvent.id,
      ...(priorCorrection ? { revisionOfEventId: priorCorrection.id } : {}),
      before,
      after
    };
    const fingerprint = stableHash(canonical(correction));
    const event = createPortfolioTransactionEvent({
      type: 'history.correction',
      effectiveAt: parseClosedTradeTime(previous, recordedAt),
      relatedEventId: saleEvent.id,
      historyFeeCorrection: correction,
      note: 'Closed-trade margin-fee allocation revision from broker cashflow evidence. History-only; no cash, debt, quantity, cost-basis or position posting.'
    }, {
      actor: { type: 'system' },
      source: 'closed-history-fee-allocation',
      idempotencyKey: `closed-history-fee:${stableHash(saleEvent.id)}:${fingerprint}`,
      requestFingerprint: `closed-history-fee-v1:${fingerprint}`,
      recordedAt
    }, recordedAt);
    const appended = appendPortfolioTransactionEvent(transactionEvents, event);
    transactionEvents.splice(0, transactionEvents.length, ...appended.events);
    if (appended.appended) appendedCount += 1;
  }

  const parity = verifyClosedHistoryFeeCorrectionParity(transactionEvents, closedTrades, cashflows);
  if (!parity.matches) {
    return {
      closedTrades: [...previousTrades],
      transactionEvents: [...currentEvents],
      appendedCount: 0,
      rejectedCount: Math.max(rejectedCount, parity.discrepancies.length),
      rejectedTradeIds: [...new Set([...rejectedTradeIds, ...parity.discrepancies])]
    };
  }
  return { closedTrades, transactionEvents, appendedCount, rejectedCount, rejectedTradeIds };
}

function parseClosedTradeTime(trade: ClosedTrade, fallback: number): number {
  const value = trade.exitDate ?? trade.sellDate ?? trade.closedAt ?? trade.date;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

/** Validate fee-correction lineage, cashflow references and latest canonical after-state. */
export function verifyClosedHistoryFeeCorrectionParity(
  events: readonly PortfolioTransactionEvent[],
  closedTrades: readonly ClosedTrade[],
  cashflows: readonly CashflowReference[]
): ClosedHistoryFeeAuditParityResult {
  const discrepancies: string[] = [];
  const cashflowIds = new Set(cashflows.map(row => row.id));
  const byId = new Map(events.map(event => [event.id, event]));
  const correctionEvents = events.filter(event => event.historyFeeCorrection);
  const latestByTrade = new Map<string, PortfolioTransactionEvent[]>();

  for (const event of correctionEvents) {
    const correction = event.historyFeeCorrection;
    if (!correction) continue;
    const sale = byId.get(correction.saleEventId);
    if (event.type !== 'history.correction' || event.relatedEventId !== correction.saleEventId ||
        sale?.type !== 'trade.sell' || hasJournalDeltas(event)) {
      discrepancies.push(`${correction.closedTradeId}:invalid-sale-link-or-balance-delta`);
      continue;
    }
    const allocations = correction.after.cashflowAllocations ?? [];
    if (allocations.some(allocation => !cashflowIds.has(allocation.cashflowId)) ||
        Math.abs(allocations.reduce((sum, allocation) => sum + allocation.amount, 0) - correction.after.marginFee) > 0.011) {
      discrepancies.push(`${correction.closedTradeId}:cashflow-allocation-mismatch`);
    }
    if (correction.revisionOfEventId) {
      const previous = byId.get(correction.revisionOfEventId);
      if (previous?.type !== 'history.correction' ||
          previous.historyFeeCorrection?.closedTradeId !== correction.closedTradeId ||
          previous.historyFeeCorrection?.saleEventId !== correction.saleEventId ||
          canonical(previous.historyFeeCorrection.after) !== canonical(correction.before)) {
        discrepancies.push(`${correction.closedTradeId}:broken-revision-chain`);
      }
    }
    const group = latestByTrade.get(correction.closedTradeId) ?? [];
    group.push(event);
    latestByTrade.set(correction.closedTradeId, group);
  }

  for (const [closedTradeId, group] of latestByTrade) {
    const superseded = new Set(group
      .map(event => event.historyFeeCorrection?.revisionOfEventId)
      .filter((value): value is string => Boolean(value)));
    const heads = group.filter(event => !superseded.has(event.id));
    if (heads.length !== 1) {
      discrepancies.push(`${closedTradeId}:competing-revision-heads`);
      continue;
    }
    const tradeMatches = closedTrades.filter(trade => trade.id === closedTradeId);
    if (tradeMatches.length === 1) {
      const snapshot = heads[0].historyFeeCorrection?.after;
      if (!snapshot || !snapshotMatchesTrade(snapshot, tradeMatches[0])) {
        discrepancies.push(`${closedTradeId}:canonical-after-state-mismatch`);
      }
    } else if (tradeMatches.length > 1) {
      discrepancies.push(`${closedTradeId}:ambiguous-canonical-trade-id`);
    }
  }
  return { matches: discrepancies.length === 0, discrepancies };
}

function hasJournalDeltas(event: PortfolioTransactionEvent): boolean {
  return [
    event.positionQuantityDelta,
    event.cashHoldingQuantityDelta,
    event.cashDelta,
    event.marginDebtDelta,
    event.realizedMarginChargeDelta
  ].some(value => value !== undefined);
}
