import { describe, expect, it } from 'vitest';
import { resolveBuyQuantityConstraint, resolveLongExitQuantityConstraint, type BrokerQuantityLimit } from './brokerScenarioLimits';

const current = (quantity: number, source: BrokerQuantityLimit['source']): BrokerQuantityLimit => ({
  quantity, freshness: 'current', observedAt: 1_800_000_000_000, source
});

describe('broker scenario quantity constraints', () => {
  it('caps Buy at the strictest local, account and instrument limit', () => {
    expect(resolveBuyQuantityConstraint({
      requestedQuantity: 6, localMaximum: 20,
      accountMaximum: current(8, 'getOPQ'), instrumentMaximum: current(5, 'getTradingLimits')
    })).toMatchObject({ allowed: false, effectiveMaximum: 5, bindingSource: 'instrument', freshness: 'current' });
  });

  it('allows a Buy at the cap and treats zero as a hard broker limit', () => {
    expect(resolveBuyQuantityConstraint({
      requestedQuantity: 5, localMaximum: 20,
      accountMaximum: current(8, 'getOPQ'), instrumentMaximum: current(5, 'getTradingLimits')
    }).allowed).toBe(true);
    expect(resolveBuyQuantityConstraint({
      requestedQuantity: 0.1, localMaximum: 20,
      accountMaximum: current(0, 'getOPQ'), instrumentMaximum: current(5, 'getTradingLimits')
    })).toMatchObject({ allowed: false, effectiveMaximum: 0, bindingSource: 'account' });
  });

  it.each(['stale', 'unavailable', 'malformed'] as const)('fails closed for an %s instrument limit', freshness => {
    expect(resolveBuyQuantityConstraint({
      requestedQuantity: 1, localMaximum: 20,
      accountMaximum: current(8, 'getOPQ'),
      instrumentMaximum: { quantity: null, freshness, observedAt: null, source: 'getTradingLimits' }
    })).toMatchObject({ allowed: false, effectiveMaximum: null, freshness });
  });

  it('rounds down to whole verified lots', () => {
    expect(resolveBuyQuantityConstraint({
      requestedQuantity: 5, localMaximum: 20,
      accountMaximum: current(8.7, 'getOPQ'), instrumentMaximum: current(5.9, 'getTradingLimits'), lotSize: 2
    })).toMatchObject({ effectiveMaximum: 4, allowed: false });
  });

  it('caps Exit by held long quantity and broker sell limit', () => {
    expect(resolveLongExitQuantityConstraint({
      requestedQuantity: 8, localMaximum: 12,
      accountMaximum: current(10, 'getOPQ'), instrumentMaximum: current(7, 'getTradingLimits'),
      heldLongQuantity: 9
    })).toMatchObject({ allowed: false, effectiveMaximum: 7, bindingSource: 'instrument' });
  });

  it('does not allow Exit beyond the holding or across zero', () => {
    expect(resolveLongExitQuantityConstraint({
      requestedQuantity: 11, localMaximum: 20,
      accountMaximum: current(20, 'getOPQ'), instrumentMaximum: current(20, 'getTradingLimits'),
      heldLongQuantity: 10
    })).toMatchObject({ allowed: false, effectiveMaximum: 10, bindingSource: 'position' });
  });

  it('rejects Exit without a verified positive long holding', () => {
    for (const heldLongQuantity of [null, 0, -3]) {
      expect(resolveLongExitQuantityConstraint({
        requestedQuantity: 1, localMaximum: 20,
        accountMaximum: current(20, 'getOPQ'), instrumentMaximum: current(20, 'getTradingLimits'),
        heldLongQuantity
      }).allowed).toBe(false);
    }
  });

  it('never lets broker limits increase a lower local cap', () => {
    expect(resolveBuyQuantityConstraint({
      requestedQuantity: 6, localMaximum: 4,
      accountMaximum: current(100, 'getOPQ'), instrumentMaximum: current(100, 'getTradingLimits')
    })).toMatchObject({ allowed: false, effectiveMaximum: 4, bindingSource: 'local' });
  });
});
