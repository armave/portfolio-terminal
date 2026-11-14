import { describe, expect, it } from 'vitest';
import { createPortfolioTransactionEvent, inspectPortfolioTransactionJournalReplayCoverage } from './portfolioTransactionJournal';
import {
  buildClosedHistoryFeeAuditUpdate,
  verifyClosedHistoryFeeCorrectionParity
} from './closedHistoryFeeAudit';
import type { ClosedTrade } from '../types/portfolio';

const sale = createPortfolioTransactionEvent({
  type: 'trade.sell',
  effectiveAt: Date.parse('2026-01-03T12:00:00.000Z'),
  ticker: 'AAPL',
  quantity: 10,
  positionQuantityDelta: -10
}, { eventId: 'sale-event-1', actor: { type: 'user', id: 'admin' }, source: 'portfolio-store' });

const before: ClosedTrade = {
  id: 'closed-trade-1', transactionEventId: sale.id, ticker: 'AAPL', shares: 10,
  sellDate: '2026-01-03T12:00:00.000Z', feesAndCommissions: 3, totalCommissions: 3,
  marginInterest: 0, marginFee: 0, marginFeeAllocations: {}, netProfit: 97
};
const after: ClosedTrade = {
  ...before, feesAndCommissions: 4, totalCommissions: 4, marginInterest: 1, marginFee: 1,
  marginFeeAllocations: { 'cashflow-1': 0.6, 'cashflow-2': 0.4 }, netProfit: 96, netRealizedGain: 96
};
const cashflows = [{ id: 'cashflow-1' }, { id: 'cashflow-2' }];

describe('Closed History fee correction audit', () => {
  it('records linked immutable history-only evidence with sources and before/after values', () => {
    const result = buildClosedHistoryFeeAuditUpdate([sale], [before], [after], cashflows, 1_800_000_000_000);
    expect(result.rejectedCount).toBe(0);
    expect(result.appendedCount).toBe(1);
    const correction = result.transactionEvents[1];
    expect(correction).toMatchObject({
      type: 'history.correction', actor: { type: 'system' }, source: 'closed-history-fee-allocation',
      relatedEventId: sale.id,
      historyFeeCorrection: {
        kind: 'closed-trade-margin-fee', closedTradeId: before.id, saleEventId: sale.id,
        before: { marginFee: 0, cashflowAllocations: [] },
        after: {
          marginFee: 1, feesAndCommissions: 4, netProfit: 96,
          cashflowAllocations: [
            { cashflowId: 'cashflow-1', amount: 0.6 },
            { cashflowId: 'cashflow-2', amount: 0.4 }
          ]
        }
      }
    });
    expect(correction.positionQuantityDelta).toBeUndefined();
    expect(correction.cashDelta).toBeUndefined();
    expect(inspectPortfolioTransactionJournalReplayCoverage(result.transactionEvents).findings.find(f => f.eventId === correction.id))
      .toMatchObject({ disposition: 'audit-only' });
    expect(verifyClosedHistoryFeeCorrectionParity(result.transactionEvents, result.closedTrades, cashflows).matches).toBe(true);
    expect(Object.isFrozen(correction.historyFeeCorrection?.after.cashflowAllocations)).toBe(true);
  });

  it('chains successive fee revisions and rejects an unexpected before-state', () => {
    const first = buildClosedHistoryFeeAuditUpdate([sale], [before], [after], cashflows, 1_800_000_000_000);
    const next = {
      ...after, feesAndCommissions: 3.5, totalCommissions: 3.5, marginInterest: 0.5,
      marginFee: 0.5, marginFeeAllocations: { 'cashflow-2': 0.5 }, netProfit: 96.5, netRealizedGain: 96.5
    };
    const second = buildClosedHistoryFeeAuditUpdate(first.transactionEvents, [after], [next], cashflows, 1_800_000_000_100);
    expect(second.appendedCount).toBe(1);
    expect(second.transactionEvents[2].historyFeeCorrection?.revisionOfEventId).toBe(first.transactionEvents[1].id);
    expect(verifyClosedHistoryFeeCorrectionParity(second.transactionEvents, second.closedTrades, cashflows).matches).toBe(true);
    const stale = { ...after, netProfit: 93 };
    const rejected = buildClosedHistoryFeeAuditUpdate(first.transactionEvents, [stale], [next], cashflows);
    expect(rejected.rejectedCount).toBeGreaterThan(0);
    expect(rejected.closedTrades[0]).toEqual(stale);
  });

  it('leaves unlinked sales and missing source rows unchanged', () => {
    expect(buildClosedHistoryFeeAuditUpdate([], [before], [after], cashflows).closedTrades[0]).toEqual(before);
    const missing = buildClosedHistoryFeeAuditUpdate([sale], [before], [after], [{ id: 'cashflow-1' }]);
    expect(missing.rejectedCount).toBeGreaterThan(0);
    expect(missing.closedTrades[0]).toEqual(before);
  });

  it('marks missing legacy source allocation provenance as unknown, not zero', () => {
    const legacyBefore: ClosedTrade = { ...before, marginFee: 0.8, marginInterest: 0.8 };
    delete legacyBefore.marginFeeAllocations;
    const legacyAfter = { ...after, marginFeeAllocations: { 'cashflow-1': 1, 'cashflow-2': 0 } };
    const result = buildClosedHistoryFeeAuditUpdate([sale], [legacyBefore], [legacyAfter], cashflows, 1_800_000_000_000);
    expect(result.rejectedCount).toBe(0);
    expect(result.transactionEvents[1].historyFeeCorrection?.before.cashflowAllocations).toBeNull();
  });
});
