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

  it('treats unknown snapshot fields as protected instead of guessing their semantics', () => {
    const merged = reconcileCloudStateSnapshots(
      { ...base, futureAccountingField: { value: 1 } },
      { ...base, futureAccountingField: { value: 2 } },
      { ...base, futureAccountingField: { value: 3 } }
    );
    expect(merged).toBeNull();
  });
});
