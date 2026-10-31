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

    const result = buildClosedTradeGuestLedgerUpserts(allocations, sourceRows, 500);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      guestId: 'guest-a',
      record: {
        ticker: 'AAPL',
        name: 'Apple',
        assignedQuantity: 2.5,
        openQuantity: 0,
        averagePrice: null,
        purchasedAt: null,
        assignedAt: 120,
        updatedAt: 500,
        endedAt: 500,
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
