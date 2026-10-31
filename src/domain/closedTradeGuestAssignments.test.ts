import { describe, expect, it } from 'vitest';
import type { ClosedTradeAllocation } from '../types/portfolio';
import { buildClosedTradeGuestLedgerUpserts } from './closedTradeGuestAssignments';

const sourceRows = [
  { allocationKey: 'broker:sell-1', ticker: 'AAPL', name: 'Apple' },
  { allocationKey: 'broker:sell-2', ticker: 'MSFT', name: 'Microsoft' }
];

describe('closed trade guest ledger projection', () => {
  it('publishes cash-funded shares from a closed trade as a closed LOTS record', () => {
    const allocations: Record<string, ClosedTradeAllocation> = {
      'broker:sell-1': {
        fundingType: 'mix',
        cashQuantity: 2.5,
        marginQuantity: 7.5,
        guestId: 'guest-a',
        assignedAt: 120
      }
    };

    const result = buildClosedTradeGuestLedgerUpserts(allocations, [
      { ...sourceRows[0], quantity: 10, averagePrice: 123.45, purchasedAt: 50, operationAt: 160, value: 1500, netProfit: 80 }
    ], 500);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      guestId: 'guest-a',
      record: {
        ticker: 'AAPL',
        name: 'Apple',
        assignedQuantity: 2.5,
        openQuantity: 0,
        averagePrice: 123.45,
        netProfit: 20,
        operationAt: 160000,
        value: 375,
        purchasedAt: 50000,
        assignedAt: 120,
        updatedAt: 500,
        endedAt: 120,
        status: 'closed'
      }
    });
    expect(result[0].record.assignmentId).toMatch(/^closed-trade:/);
    expect(result[0].record.trancheId).toMatch(/^closed-trade:/);
  });

  it('does not publish margin-only or unassigned closed rows', () => {
    const allocations: Record<string, ClosedTradeAllocation> = {
      'broker:sell-1': { fundingType: 'margin', cashQuantity: 0, marginQuantity: 5 },
      'broker:sell-2': { fundingType: 'cash', cashQuantity: 3, marginQuantity: 0 }
    };

    expect(buildClosedTradeGuestLedgerUpserts(allocations, sourceRows, 500)).toEqual([]);
  });

  it('records a previous guest as unassigned when a closed row is reassigned', () => {
    const allocations: Record<string, ClosedTradeAllocation> = {
      'broker:sell-1': {
        fundingType: 'mix',
        cashQuantity: 4,
        marginQuantity: 6,
        guestId: 'guest-b',
        assignedAt: 300,
        guestAssignments: [
          { guestId: 'guest-a', assignedQuantity: 3, assignedAt: 100 },
          { guestId: 'guest-b', assignedQuantity: 4, assignedAt: 300 }
        ]
      }
    };

    const result = buildClosedTradeGuestLedgerUpserts(allocations, sourceRows, 500);
    expect(result).toHaveLength(2);
    expect(result.find((item) => item.guestId === 'guest-a')?.record).toMatchObject({
      assignedQuantity: 3,
      assignedAt: 100,
      status: 'unassigned',
      openQuantity: 0
    });
    expect(result.find((item) => item.guestId === 'guest-b')?.record).toMatchObject({
      assignedQuantity: 4,
      assignedAt: 300,
      status: 'closed',
      openQuantity: 0
    });
  });

  it('preserves the current guest assignment when old rows have no explicit history', () => {
    const result = buildClosedTradeGuestLedgerUpserts({
      'broker:sell-1': {
        fundingType: 'cash',
        cashQuantity: 2,
        marginQuantity: 0,
        guestId: 'guest-a'
      }
    }, sourceRows, 500);

    expect(result[0]).toMatchObject({
      guestId: 'guest-a',
      record: { assignedQuantity: 2, assignedAt: 500, status: 'closed' }
    });
  });

  it('uses per-guest FIFO cost/date and pro-rates realized net profit', () => {
    const result = buildClosedTradeGuestLedgerUpserts({
      'broker:sell-1': {
        fundingType: 'mix',
        cashQuantity: 2,
        marginQuantity: 3,
        guestId: 'guest-a',
        assignedAt: 100
      }
    }, [{
      allocationKey: 'broker:sell-1',
      ticker: 'AAPL',
      quantity: 5,
      averagePrice: 110,
      purchasedAt: 200,
      netProfit: 50,
      operationAt: 300,
      value: 500,
      guestMetrics: {
        'guest-a': { quantity: 2, averagePrice: 105, purchasedAt: 150 }
      }
    }], 500);

    expect(result[0].record).toMatchObject({
      assignedQuantity: 2,
      averagePrice: 105,
      purchasedAt: 150000,
      operationAt: 300000,
      value: 200,
      netProfit: 20
    });
  });

  it('uses stable assignment identifiers across repeated publications', () => {
    const allocations: Record<string, ClosedTradeAllocation> = {
      'broker:sell-1': {
        fundingType: 'cash',
        cashQuantity: 2,
        marginQuantity: 0,
        guestId: 'guest-a',
        assignedAt: 100
      }
    };

    const first = buildClosedTradeGuestLedgerUpserts(allocations, sourceRows, 500)[0];
    const second = buildClosedTradeGuestLedgerUpserts(allocations, sourceRows, 600)[0];
    expect(second.record.assignmentId).toBe(first.record.assignmentId);
    expect(second.record.trancheId).toBe(first.record.trancheId);
  });
});
