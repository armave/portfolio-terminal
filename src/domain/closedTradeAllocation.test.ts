import { describe, expect, it } from 'vitest';
import { resolveClosedTradeAllocation } from './closedTradeAllocation';

describe('closed trade manual allocation resolution', () => {
  it('defaults unclassified rows to Margin', () => {
    expect(resolveClosedTradeAllocation(5, 'unclassified')).toEqual({
      fundingType: 'margin',
      cashQuantity: 0,
      marginQuantity: 5,
      guestAllocations: []
    });
  });

  it('keeps a known FIFO cash tranche and its guest attribution', () => {
    expect(resolveClosedTradeAllocation(5, 'cash', [{ guestId: 'guest-a', quantity: 3 }])).toEqual({
      fundingType: 'cash',
      cashQuantity: 5,
      marginQuantity: 0,
      guestAllocations: [{ guestId: 'guest-a', quantity: 3 }]
    });
  });

  it('lets a saved Margin override clear a previously inferred guest assignment', () => {
    expect(resolveClosedTradeAllocation(5, 'cash', [{ guestId: 'guest-a', quantity: 5 }], {
      fundingType: 'margin',
      cashQuantity: 0,
      marginQuantity: 5
    })).toEqual({
      fundingType: 'margin',
      cashQuantity: 0,
      marginQuantity: 5,
      guestAllocations: []
    });
  });

  it('assigns only the cash-funded portion of an edited Mix row to its guest', () => {
    expect(resolveClosedTradeAllocation(10, 'margin', [], {
      fundingType: 'mix',
      cashQuantity: 4,
      marginQuantity: 6,
      guestId: 'guest-mix'
    })).toEqual({
      fundingType: 'mix',
      cashQuantity: 4,
      marginQuantity: 6,
      guestAllocations: [{ guestId: 'guest-mix', quantity: 4 }]
    });
  });

  it('clamps saved Mix cash quantity to the closed row quantity', () => {
    expect(resolveClosedTradeAllocation(3, 'margin', [], {
      fundingType: 'mix',
      cashQuantity: 8,
      marginQuantity: 0,
      guestId: 'guest-a'
    })).toEqual({
      fundingType: 'mix',
      cashQuantity: 3,
      marginQuantity: 0,
      guestAllocations: [{ guestId: 'guest-a', quantity: 3 }]
    });
  });

  it('does not infer guest ownership for a Margin tranche', () => {
    expect(resolveClosedTradeAllocation(2, 'margin', [{ guestId: 'guest-a', quantity: 2 }]).guestAllocations).toEqual([]);
  });
});
