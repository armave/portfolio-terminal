import { describe, expect, it } from 'vitest';
import { attributeClosedTradeExecutions } from './closedTradeAttribution';

const at = (hour: number, minute = 0) => Date.parse('2026-10-30T' + String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0') + ':00Z');
const trancheId = (ticker: string, timestamp: number, id: string) => ticker + ':' + timestamp + ':' + id;

describe('closed trade tranche attribution', () => {
  it('carries cash and margin classifications into FIFO sales and marks combined funding as Mix', () => {
    const buyCash = { id: 'cash-buy', ticker: 'AAPL.US', side: 'BUY', quantity: 2, executedAt: at(10) };
    const buyMargin = { id: 'margin-buy', ticker: 'AAPL.US', side: 'BUY', quantity: 2, executedAt: at(10, 10) };
    const sale = { id: 'sale-1', ticker: 'AAPL.US', side: 'SELL', quantity: 3, executedAt: at(11) };
    const result = attributeClosedTradeExecutions([buyCash, buyMargin, sale], {
      trancheTypes: {
        [trancheId('AAPL', at(10), 'cash-buy')]: 'cash',
        [trancheId('AAPL', at(10, 10), 'margin-buy')]: 'margin'
      },
      guestAssignments: { [trancheId('AAPL', at(10), 'cash-buy')]: 'guest-a' },
      guestAssignmentDetails: {
        [trancheId('AAPL', at(10), 'cash-buy')]: {
          assignmentId: 'assignment-a', guestId: 'guest-a', assignedAt: at(10, 30), assignedQuantity: 2
        }
      }
    }).get(sale);

    expect(result).toEqual({
      fundingType: 'mix',
      cashQuantity: 2,
      marginQuantity: 1,
      averagePrice: null,
      purchasedAt: at(10),
      guestAllocations: [{ guestId: 'guest-a', quantity: 2, averagePrice: null, purchasedAt: at(10) }],
      unmatchedQuantity: 0
    });
  });

  it('returns FIFO-weighted buy cost and tranche date for the sale and assigned guest', () => {
    const firstBuy = { id: 'buy-a', ticker: 'AAPL', side: 'BUY', quantity: 2, price: 100, executedAt: at(9) };
    const secondBuy = { id: 'buy-b', ticker: 'AAPL', side: 'BUY', quantity: 2, price: 120, executedAt: at(9, 4) };
    const sale = { id: 'sale-cost', ticker: 'AAPL', side: 'SELL', quantity: 3, price: 140, executedAt: at(12) };
    const id = trancheId('AAPL', at(9), 'buy-a');
    const result = attributeClosedTradeExecutions([firstBuy, secondBuy, sale], {
      trancheTypes: { [id]: 'cash' },
      guestAssignments: { [id]: 'guest-cost' },
      guestAssignmentDetails: {
        [id]: { assignmentId: 'assignment-cost', guestId: 'guest-cost', assignedAt: at(10), assignedQuantity: 4 }
      }
    }).get(sale);

    expect(result).toMatchObject({
      averagePrice: 106.6666666667,
      purchasedAt: at(9),
      guestAllocations: [{
        guestId: 'guest-cost',
        quantity: 3,
        averagePrice: 106.6666666667,
        purchasedAt: at(9)
      }]
    });
  });

  it('uses the cash fraction of a Mix tranche for guest ownership', () => {
    const buy = { id: 'mix-buy', ticker: 'MSFT', side: 'BUY', quantity: 10, executedAt: at(9) };
    const sale = { id: 'mix-sale', ticker: 'MSFT', side: 'SELL', quantity: 5, executedAt: at(12) };
    const id = trancheId('MSFT', at(9), 'mix-buy');
    const result = attributeClosedTradeExecutions([buy, sale], {
      trancheTypes: { [id]: 'mix' },
      trancheMixes: { [id]: { cash: 4, margin: 6 } },
      guestAssignments: { [id]: 'guest-mix' },
      guestAssignmentDetails: {
        [id]: {
          assignmentId: 'assignment-mix', guestId: 'guest-mix', assignedAt: at(10), assignedQuantity: 4
        }
      }
    }).get(sale);

    expect(result).toEqual({
      fundingType: 'mix',
      cashQuantity: 2,
      marginQuantity: 3,
      averagePrice: null,
      purchasedAt: at(9),
      guestAllocations: [{ guestId: 'guest-mix', quantity: 2, averagePrice: null, purchasedAt: at(9) }],
      unmatchedQuantity: 0
    });
  });

  it('preserves a guest assignment after the first grouped buy is fully sold', () => {
    const firstBuy = { id: 'buy-first', ticker: 'NVDA', side: 'BUY', quantity: 2, executedAt: at(9) };
    const secondBuy = { id: 'buy-second', ticker: 'NVDA', side: 'BUY', quantity: 2, executedAt: at(9, 4) };
    const firstSale = { id: 'sale-first', ticker: 'NVDA', side: 'SELL', quantity: 2, executedAt: at(11) };
    const secondSale = { id: 'sale-second', ticker: 'NVDA', side: 'SELL', quantity: 1, executedAt: at(12) };
    const id = trancheId('NVDA', at(9), 'buy-first');
    const result = attributeClosedTradeExecutions([firstBuy, secondBuy, firstSale, secondSale], {
      trancheTypes: { [id]: 'cash' },
      guestAssignments: { [id]: 'guest-nvda' },
      guestAssignmentDetails: {
        [id]: {
          assignmentId: 'assignment-nvda', guestId: 'guest-nvda', assignedAt: at(10), assignedQuantity: 4
        }
      }
    });

    expect(result.get(firstSale)?.guestAllocations).toEqual([{ guestId: 'guest-nvda', quantity: 2 }]);
    expect(result.get(secondSale)?.guestAllocations).toEqual([{ guestId: 'guest-nvda', quantity: 1 }]);
  });

  it('does not assign sales that occurred before the guest assignment', () => {
    const buy = { id: 'buy-1', ticker: 'AMD', side: 'BUY', quantity: 3, executedAt: at(9) };
    const beforeAssignment = { id: 'sale-before', ticker: 'AMD', side: 'SELL', quantity: 1, executedAt: at(10) };
    const afterAssignment = { id: 'sale-after', ticker: 'AMD', side: 'SELL', quantity: 1, executedAt: at(12) };
    const id = trancheId('AMD', at(9), 'buy-1');
    const result = attributeClosedTradeExecutions([buy, beforeAssignment, afterAssignment], {
      trancheTypes: { [id]: 'cash' },
      guestAssignments: { [id]: 'guest-amd' },
      guestAssignmentDetails: {
        [id]: {
          assignmentId: 'assignment-amd', guestId: 'guest-amd', assignedAt: at(11), assignedQuantity: 2
        }
      }
    });

    expect(result.get(beforeAssignment)?.guestAllocations).toEqual([]);
    expect(result.get(afterAssignment)?.guestAllocations).toEqual([{ guestId: 'guest-amd', quantity: 1 }]);
  });

  it('does not label a partially unmatched sell with only the matched lot category', () => {
    const buy = { id: 'buy-partial', ticker: 'TSLA', side: 'BUY', quantity: 1, executedAt: at(9) };
    const sale = { id: 'sale-partial', ticker: 'TSLA', side: 'SELL', quantity: 2, executedAt: at(12) };
    const id = trancheId('TSLA', at(9), 'buy-partial');
    expect(attributeClosedTradeExecutions([buy, sale], {
      trancheTypes: { [id]: 'cash' },
      guestAssignments: { [id]: 'guest-tsla' },
      guestAssignmentDetails: {
        [id]: {
          assignmentId: 'assignment-tsla', guestId: 'guest-tsla', assignedAt: at(10), assignedQuantity: 1
        }
      }
    }).get(sale)).toEqual({
      fundingType: 'unclassified',
      cashQuantity: 1,
      marginQuantity: 0,
      averagePrice: null,
      purchasedAt: at(9),
      guestAllocations: [{ guestId: 'guest-tsla', quantity: 1, averagePrice: null, purchasedAt: at(9) }],
      unmatchedQuantity: 1
    });
  });

  it('defaults a known buy lot to Margin when no funding type was assigned', () => {
    const buy = { id: 'default-margin-buy', ticker: 'ORCL', side: 'BUY', quantity: 3, executedAt: at(9) };
    const sale = { id: 'default-margin-sale', ticker: 'ORCL', side: 'SELL', quantity: 2, executedAt: at(12) };
    expect(attributeClosedTradeExecutions([buy, sale]).get(sale)).toEqual({
      fundingType: 'margin',
      cashQuantity: 0,
      marginQuantity: 2,
      averagePrice: null,
      purchasedAt: at(9),
      guestAllocations: [],
      unmatchedQuantity: 0
    });
  });

  it('marks unmatched sells as unclassified instead of inventing tranche ownership', () => {
    const sale = { id: 'orphan-sale', ticker: 'TSLA', side: 'SELL', quantity: 2, executedAt: at(12) };
    expect(attributeClosedTradeExecutions([sale]).get(sale)).toEqual({
      fundingType: 'unclassified',
      cashQuantity: 0,
      marginQuantity: 0,
      averagePrice: null,
      purchasedAt: null,
      guestAllocations: [],
      unmatchedQuantity: 2
    });
  });
});
