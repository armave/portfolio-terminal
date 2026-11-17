import { describe, expect, it } from 'vitest';
import { reconcileCloudStateSnapshots } from './cloudSnapshotReconciliation';

describe('reconcileCloudStateSnapshots', () => {
  const base = {
    positions: { AAPL: { ticker: 'AAPL', shares: 10 } },
    balance: 500,
    transactionEvents: [{ id: 'buy-1' }],
    activeView: 'AAPL',
    selectedTicker: 'AAPL',
    lastUpdated: 100
  };

  it('keeps local financial changes and applies remote navigation changes', () => {
    const merged = reconcileCloudStateSnapshots(
      base,
      {
        ...base,
        positions: { AAPL: { ticker: 'AAPL', shares: 12 } },
        balance: 300,
        lastUpdated: 120
      },
      { ...base, activeView: 'MSFT', selectedTicker: 'MSFT', lastUpdated: 130 }
    );

    expect(merged).toMatchObject({
      positions: { AAPL: { ticker: 'AAPL', shares: 12 } },
      balance: 300,
      activeView: 'MSFT',
      selectedTicker: 'MSFT',
      lastUpdated: 130
    });
    expect(merged?.transactionEvents).toEqual(base.transactionEvents);
  });

  it('keeps remote financial changes when only local navigation changed', () => {
    const merged = reconcileCloudStateSnapshots(
      base,
      { ...base, activeView: 'NVDA' },
      { ...base, positions: { AAPL: { ticker: 'AAPL', shares: 8 } }, balance: 600 }
    );
    expect(merged).toMatchObject({
      positions: { AAPL: { ticker: 'AAPL', shares: 8 } },
      balance: 600,
      activeView: 'NVDA'
    });
  });

  it('refuses divergent financial edits even when they touch different root fields', () => {
    const merged = reconcileCloudStateSnapshots(
      base,
      { ...base, positions: { AAPL: { ticker: 'AAPL', shares: 12 } } },
      { ...base, balance: 450 }
    );
    expect(merged).toBeNull();
  });

  it('allows identical financial outcomes from both devices', () => {
    const sharedChange = { positions: { AAPL: { ticker: 'AAPL', shares: 12 } }, balance: 300 };
    const merged = reconcileCloudStateSnapshots(
      base,
      { ...base, ...sharedChange, activeView: 'MSFT' },
      { ...base, ...sharedChange, selectedTicker: 'MSFT' }
    );
    expect(merged).toMatchObject({ ...sharedChange, activeView: 'MSFT', selectedTicker: 'MSFT' });
  });

  it('merges disjoint nested metadata fields but rejects same-field conflicts', () => {
    const settingsBase = {
      positions: base.positions,
      balance: base.balance,
      activeView: 'AAPL',
      selectedTicker: 'AAPL'
    };
    const independent = reconcileCloudStateSnapshots(
      settingsBase,
      { ...settingsBase, activeView: 'MSFT' },
      { ...settingsBase, selectedTicker: 'NVDA' }
    );
    expect(independent).toMatchObject({ activeView: 'MSFT', selectedTicker: 'NVDA' });

    const conflicting = reconcileCloudStateSnapshots(
      settingsBase,
      { ...settingsBase, activeView: 'MSFT' },
      { ...settingsBase, activeView: 'NVDA' }
    );
    expect(conflicting).toBeNull();
  });

  it('does not merge or append transaction arrays', () => {
    const merged = reconcileCloudStateSnapshots(
      base,
      { ...base, transactionEvents: [...base.transactionEvents, { id: 'buy-local' }] },
      { ...base, transactionEvents: [...base.transactionEvents, { id: 'buy-remote' }] }
    );
    expect(merged).toBeNull();
  });

  const protectedFinancialSnapshots: Array<{
    label: string;
    field: string;
    baseValue: unknown;
    localValue: unknown;
    remoteValue: unknown;
  }> = [
    {
      label: 'transaction events',
      field: 'transactionEvents',
      baseValue: [{ id: 'base-buy' }],
      localValue: [{ id: 'base-buy' }, { id: 'local-buy' }],
      remoteValue: [{ id: 'base-buy' }, { id: 'remote-buy' }]
    },
    {
      label: 'corporate-action events',
      field: 'corporateActionEvents',
      baseValue: [{ id: 'base-split' }],
      localValue: [{ id: 'base-split' }, { id: 'local-split' }],
      remoteValue: [{ id: 'base-split' }, { id: 'remote-split' }]
    },
    {
      label: 'market-history corrections',
      field: 'marketHistoryCorrections',
      baseValue: [{ id: 'base-correction' }],
      localValue: [{ id: 'base-correction' }, { id: 'local-correction' }],
      remoteValue: [{ id: 'base-correction' }, { id: 'remote-correction' }]
    },
    {
      label: 'closed trades',
      field: 'closedTrades',
      baseValue: [{ id: 'base-close', shares: 2, netProfit: 10 }],
      localValue: [{ id: 'base-close', shares: 2, netProfit: 10 }, { id: 'local-close' }],
      remoteValue: [{ id: 'base-close', shares: 2, netProfit: 10 }, { id: 'remote-close' }]
    },
    {
      label: 'broker executions',
      field: 'brokerExecutedTrades',
      baseValue: [{ id: 'base-execution' }],
      localValue: [{ id: 'base-execution' }, { id: 'local-execution' }],
      remoteValue: [{ id: 'base-execution' }, { id: 'remote-execution' }]
    },
    {
      label: 'external cashflows',
      field: 'cashflows',
      baseValue: [{ id: 'base-cashflow' }],
      localValue: [{ id: 'base-cashflow' }, { id: 'local-cashflow' }],
      remoteValue: [{ id: 'base-cashflow' }, { id: 'remote-cashflow' }]
    },
    {
      label: 'position snapshots and FIFO tranches',
      field: 'positions',
      baseValue: {
        AAPL: {
          ticker: 'AAPL',
          shares: 10,
          tranches: [{ id: 'base-lot', qty: 10, price: 100 }]
        }
      },
      localValue: {
        AAPL: {
          ticker: 'AAPL',
          shares: 12,
          tranches: [
            { id: 'base-lot', qty: 10, price: 100 },
            { id: 'local-lot', qty: 2, price: 120 }
          ]
        }
      },
      remoteValue: {
        AAPL: {
          ticker: 'AAPL',
          shares: 8,
          tranches: [{ id: 'base-lot', qty: 8, price: 100 }]
        }
      }
    },
    {
      label: 'cash-holding snapshots and FIFO lots',
      field: 'cashCushion',
      baseValue: {
        freeCash: 100,
        holdings: [{ ticker: 'AAPL', shares: 2, lots: [{ lotId: 'base-cash-lot', qty: 2, price: 100 }] }]
      },
      localValue: {
        freeCash: 100,
        holdings: [{ ticker: 'AAPL', shares: 3, lots: [
          { lotId: 'base-cash-lot', qty: 2, price: 100 },
          { lotId: 'local-cash-lot', qty: 1, price: 120 }
        ] }]
      },
      remoteValue: {
        freeCash: 100,
        holdings: [{ ticker: 'AAPL', shares: 1, lots: [{ lotId: 'base-cash-lot', qty: 1, price: 100 }] }]
      }
    }
  ];

  it.each(protectedFinancialSnapshots)(
    'blocks divergent local and remote changes to protected $label without merging their arrays',
    ({ field, baseValue, localValue, remoteValue }) => {
      const baseSnapshot = { ...base, [field]: baseValue };
      const local = { ...baseSnapshot, [field]: localValue };
      const remote = { ...baseSnapshot, [field]: remoteValue };

      expect(reconcileCloudStateSnapshots(baseSnapshot, local, remote)).toBeNull();
    }
  );

  it.each(protectedFinancialSnapshots)(
    'preserves a shared protected $label update exactly once when both devices reach the same outcome',
    ({ field, baseValue, localValue }) => {
      const baseSnapshot = { ...base, [field]: baseValue };
      const local = { ...baseSnapshot, [field]: localValue, activeView: 'MSFT' };
      const remote = { ...baseSnapshot, [field]: localValue, selectedTicker: 'NVDA' };

      const merged = reconcileCloudStateSnapshots(baseSnapshot, local, remote);

      expect(merged?.[field]).toEqual(localValue);
      expect(merged?.activeView).toBe('MSFT');
      expect(merged?.selectedTicker).toBe('NVDA');
    }
  );

  it('treats unknown snapshot fields as protected instead of guessing their semantics', () => {
    const merged = reconcileCloudStateSnapshots(
      { ...base, futureAccountingField: { value: 1 } },
      { ...base, futureAccountingField: { value: 2 } },
      { ...base, futureAccountingField: { value: 3 } }
    );
    expect(merged).toBeNull();
  });
});
