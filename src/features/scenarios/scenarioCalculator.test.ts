import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScenarioCalculator } from './scenarioCalculator';
import { loadBuyMorePreferences, saveBuyMorePreferences, type BuyMorePreferences } from './buyMorePreferences';
import { portfolioStore } from '../../store/portfolioStore';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    values
  };
}
const validPreferences: BuyMorePreferences = {
  version: 1, ticker: 'AAPL', shares: '5', price: '105.25', projectionPrice: '130.00',
  lastResult: {
    savedAt: 100,
    columns: ['NOW Net', 'AFTER Net', 'NOW F&C', 'AFTER F&C', 'NOW Balance', 'AFTER Balance'],
    rows: [{
      label: 'Tue, Nov 10 · TODAY',
      values: ['+$10.00', '+$12.00', '$1.00 {$0.10/day}', '$1.50 {$0.12/day}', '-$1,000.00', '-$1,000.00'],
      kind: 'result'
    }],
    note: 'Estimate only.',
    summary: '[BUY MORE: AAPL]'
  }
};
describe('Buy More preferences', () => {
  it('persists account-scoped inputs and the latest complete result', () => {
    const storage = createStorage();
    expect(saveBuyMorePreferences('buy-more:user-a', validPreferences, storage)).toBe(true);
    expect(loadBuyMorePreferences('buy-more:user-a', storage)).toEqual(validPreferences);
    expect(loadBuyMorePreferences('buy-more:user-b', storage)).toBeNull();
  });
  it('restores older version-1 preferences without a projection price', () => {
    const storage = createStorage();
    const legacy = { ...validPreferences } as Partial<BuyMorePreferences>;
    delete legacy.projectionPrice;
    storage.setItem('legacy', JSON.stringify(legacy));
    expect(loadBuyMorePreferences('legacy', storage)?.projectionPrice).toBeUndefined();
  });
  it('normalizes ticker casing and rejects malformed snapshots', () => {
    const storage = createStorage();
    expect(saveBuyMorePreferences('buy-more', { ...validPreferences, ticker: 'aapl' }, storage)).toBe(true);
    expect(loadBuyMorePreferences('buy-more', storage)?.ticker).toBe('AAPL');
    storage.setItem('invalid', JSON.stringify({
      ...validPreferences, lastResult: { ...validPreferences.lastResult, columns: ['only one'] }
    }));
    expect(loadBuyMorePreferences('invalid', storage)?.lastResult).toBeNull();
    storage.setItem('bad', JSON.stringify({ ...validPreferences, ticker: '../secret' }));
    expect(loadBuyMorePreferences('bad', storage)).toBeNull();
  });
  it('fails safely when browser storage is unavailable or throws', () => {
    expect(loadBuyMorePreferences('buy-more', null)).toBeNull();
    expect(saveBuyMorePreferences('buy-more', validPreferences, null)).toBe(false);
    const throwing = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('quota'); }
    };
    expect(loadBuyMorePreferences('buy-more', throwing)).toBeNull();
    expect(saveBuyMorePreferences('buy-more', validPreferences, throwing)).toBe(false);
  });
});
describe('Market Tools Buy More preview', () => {
  it('reuses the existing deterministic scenario engine without mutating the portfolio', () => {
    const state = portfolioStore.getState();
    vi.spyOn(portfolioStore, 'getState').mockReturnValue({
      ...state, activeView: 'AAPL',
      positions: { ...state.positions, AAPL: {
        ticker: 'AAPL', shares: 10, currentPrice: 110, pt: 120, commBuy: 2,
        tranches: [{ qty: 10, price: 100, buyCommission: 2 }]
      } }
    } as any);
    const buyStock = vi.spyOn(portfolioStore, 'buyStock');
    const sellStock = vi.spyOn(portfolioStore, 'sellStock');
    const result = ScenarioCalculator.previewBuyMoreScenario('aapl', 5, 105);
    expect(result.type).toBe('res');
    expect(result.modal?.kind).toBe('buy-more');
    expect(result.modal?.columns).toHaveLength(6);
    expect(result.modal?.rows.length).toBeGreaterThan(0);
    expect(result.modal?.rows.every(row => row.values.length === 6)).toBe(true);
    expect(buyStock).not.toHaveBeenCalled();
    expect(sellStock).not.toHaveBeenCalled();
    expect(ScenarioCalculator.previewBuyMoreScenario('AAPL', 0, 105).type).toBe('err');
    expect(ScenarioCalculator.previewBuyMoreScenario('AAPL', 5, 0).type).toBe('err');
    expect(ScenarioCalculator.previewBuyMoreScenario('AAPL', 5, 105, 0).type).toBe('err');
    expect(ScenarioCalculator.previewBuyMoreScenario('!!!', 5, 105).type).toBe('err');
  });

  it('uses a supplied projected target price for P&L and the compact cash/fee columns', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-11T08:00:00.000Z'));
    const state = portfolioStore.getState();
    vi.spyOn(portfolioStore, 'getState').mockReturnValue({
      ...state,
      balance: -1_000,
      cashCushion: { ...(state.cashCushion || { holdings: [] }), freeCash: 100 },
      brokerAssumptions: { ...state.brokerAssumptions, annualBorrowRate: 36.5, dayCountBasis: 365 },
      positions: {
        AAPL: {
          ticker: 'AAPL', shares: 10, currentPrice: 110, pt: 120, commBuy: 2,
          startDate: '2026-11-10',
          tranches: [{ qty: 10, price: 100, buyCommission: 2 }]
        },
        MSFT: {
          ticker: 'MSFT', shares: 20, currentPrice: 100, pt: 100, commBuy: 0,
          tranches: [{ qty: 20, price: 100 }]
        }
      }
    } as any);

    const baseline = ScenarioCalculator.previewBuyMoreScenario('AAPL', 5, 105);
    const custom = ScenarioCalculator.previewBuyMoreScenario('AAPL', 5, 105, 150);
    const today = custom.modal?.rows.find(row => row.kind === 'result');

    expect(baseline.type).toBe('res');
    expect(custom.type).toBe('res');
    expect(custom.modal?.columns).toEqual([
      'NOW Net', 'AFTER Net', 'NOW F&C', 'AFTER F&C', 'NOW Balance', 'AFTER Balance'
    ]);
    expect(custom.text).toContain('Net P&L at projection price ($150.00):');
    expect(today?.values).toHaveLength(6);
    expect(today?.values[0]).not.toBe(baseline.modal?.rows.find(row => row.kind === 'result')?.values[0]);
    expect(today?.values[2]).toMatch(/\{\$[\d.]+\/day\}$/);
    expect(today?.values[3]).toMatch(/\{\$[\d.]+\/day\}$/);
    // Balance is the signed broker ledger. Cash Cushion free cash funds the order first;
    // only the shortfall reduces the broker balance, and daily interest compounds debt.
    expect(today?.values[4]).toBe('-$1,000.00');
    const cashNeeded = Number(custom.text.match(/Cash needed: \$([\d.]+)/)?.[1]);
    const balanceAfter = -1_000 - Math.max(0, cashNeeded - 100);
    expect(Number(today?.values[5].replace(/[$,]/g, ''))).toBeCloseTo(balanceAfter, 2);
    const later = custom.modal?.rows.find(row => row.kind === 'fee' && row.values[4] !== '—');
    const parseSignedMoney = (value: string | undefined) =>
      Number(String(value ?? '').replace(/−/g, '-').replace(/[^\d.-]/g, ''));
    expect(parseSignedMoney(later?.values[4])).toBeLessThan(-1_000);
    expect(parseSignedMoney(later?.values[5])).toBeLessThan(balanceAfter);
  });
});


describe('Market Tools Exit Comparison preview', () => {
  it('reuses the deterministic two-period scenario engine without mutating the portfolio', () => {
    const state = portfolioStore.getState();
    vi.spyOn(portfolioStore, 'getState').mockReturnValue({
      ...state, activeView: 'GOOGL', balance: -1000,
      positions: { ...state.positions, GOOGL: {
        ticker: 'GOOGL', shares: 10, currentPrice: 330, pt: 350, commBuy: 2,
        tranches: [{ qty: 10, price: 320, buyCommission: 2 }]
      } }
    } as any);
    const sellStock = vi.spyOn(portfolioStore, 'sellStock');
    const updateTargetPrice = vi.spyOn(portfolioStore, 'updateTargetPrice');

    const result = ScenarioCalculator.previewExitComparison('GOOGL', [
      { label: 'Today', days: 0, price: 330 },
      { label: 'In 14 days', days: 14, price: 345 }
    ]);

    expect(result.type).toBe('res');
    expect(result.modal?.kind).toBe('exit-comparison');
    expect(result.modal?.columns).toHaveLength(2);
    expect(result.modal?.rows.map(row => row.label)).toEqual([
      'Cost Basis', 'Gross Proceeds', 'Total Fee Friction', 'Net P&L', 'Resulting Account Balance'
    ]);
    expect(sellStock).not.toHaveBeenCalled();
    expect(updateTargetPrice).not.toHaveBeenCalled();
  });

  it('uses sale accounting, compounded carry, and signed cash settlement for exit estimates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T08:30:00.000Z'));
    const state = portfolioStore.getState();
    const positions = {
      GOOGL: {
        ticker: 'GOOGL',
        shares: 10,
        currentPrice: 120,
        pt: 130,
        commBuy: 10,
        marginCharged: 7,
        tranches: [{ qty: 10, price: 100, date: '2026-11-09', buyCommission: 10 }]
      },
      AAPL: {
        ticker: 'AAPL',
        shares: 10,
        currentPrice: 100,
        pt: 110,
        commBuy: 0,
        tranches: [{ qty: 10, price: 100, date: '2026-11-09', buyCommission: 0 }]
      }
    };
    vi.spyOn(portfolioStore, 'getState').mockReturnValue({
      ...state,
      activeView: 'GOOGL',
      balance: -1000,
      cashBalance: 0,
      cashCushion: { ...(state.cashCushion || { holdings: [] }), freeCash: 200 },
      brokerAssumptions: {
        ...state.brokerAssumptions,
        annualBorrowRate: 3.65,
        dayCountBasis: 365,
        commissionPerShare: 0,
        commissionRatePct: 0,
        commissionMin: 1
      },
      positions
    } as any);

    const result = ScenarioCalculator.previewExitComparison('GOOGL', [
      { label: 'Today', days: 0, price: 120 },
      { label: 'In 2 days', days: 2, price: 125 }
    ]);
    const row = (label: string) => result.modal?.rows.find((candidate) => candidate.label === label)?.values;

    expect(result.type).toBe('res');
    expect(row('Cost Basis')).toEqual(['$1000.00', '$1000.00']);
    expect(row('Gross Proceeds')).toEqual(['$1200.00', '$1250.00']);
    expect(row('Total Fee Friction')).toEqual(['$18.00', '$28.05']);
    expect(row('Net P&L')).toEqual(['+$182.00', '+$221.95']);
    expect(row('Resulting Account Balance')).toEqual(['$399.00', '$428.90']);
  });

  it('rejects invalid Market Tools exit preview inputs', () => {
    expect(ScenarioCalculator.previewExitComparison('GOOGL', [
      { label: 'Today', days: -1, price: 330 },
      { label: 'In 14 days', days: 14, price: 345 }
    ]).type).toBe('err');
    expect(ScenarioCalculator.previewExitComparison('GOOGL', [
      { label: 'Today', days: 0, price: 0 },
      { label: 'In 14 days', days: 14, price: 345 }
    ]).type).toBe('err');
    expect(ScenarioCalculator.previewExitComparison('GOOGL', [
      { label: 'Today', days: 0, price: 330 }
    ]).type).toBe('err');
    expect(ScenarioCalculator.previewExitComparison('GOOGL', [
      { label: 'Today', days: 0.5, price: 330 },
      { label: 'In 14 days', days: 14, price: 345 }
    ]).type).toBe('err');
  });
});

describe('Market Tools Buy More guardrails', () => {
  it('includes free cash and cash-cushion holdings when calculating maintenance headroom', () => {
    const state = portfolioStore.getState();
    vi.spyOn(portfolioStore, 'getState').mockReturnValue({
      ...state,
      balance: -22_363.64,
      cashBalance: 0,
      cashCushion: {
        freeCash: 5_000,
        holdings: [{ ticker: 'CASHETF', shares: 20, currentPrice: 297.63 }]
      },
      brokerAssumptions: { ...state.brokerAssumptions, maintenanceEquityRatio: 0.10, stopOutRatio: 0 },
      positions: {
        GOOGL: {
          ticker: 'GOOGL', shares: 68, currentPrice: 288.10, pt: 385, commBuy: 27.17,
          tranches: [{ qty: 68, price: 322.96 }]
        }
      }
    } as any);

    const result = ScenarioCalculator.previewBuyMoreScenario('GOOGL', 1, 288.11);

    expect(result.type).toBe('res');
    expect(result.modal?.kind).toBe('buy-more');
    expect(result.text).toContain('[BUY MORE: GOOGL]');
  });

  it('blocks oversized purchases and reports a conservative maximum share count', () => {
    const state = portfolioStore.getState();
    vi.spyOn(portfolioStore, 'getState').mockReturnValue({
      ...state,
      balance: -22_363.64,
      cashCushion: {
        freeCash: 0,
        holdings: [{ ticker: 'CASHETF', shares: 38, currentPrice: 289.50 }]
      },
      brokerAssumptions: { ...state.brokerAssumptions, maintenanceEquityRatio: 0.10, stopOutRatio: 0 },
      positions: {
        GOOGL: {
          ticker: 'GOOGL', shares: 68, currentPrice: 288.18, pt: 335, commBuy: 27.17,
          tranches: [{ qty: 68, price: 322.96 }]
        }
      }
    } as any);

    const result = ScenarioCalculator.previewBuyMoreScenario('GOOGL', 180, 288.11);

    expect(result.type).toBe('err');
    expect(result.modal).toBeUndefined();
    expect(result.projectedEquityRatio).toBeLessThan(0.20);
    expect(result.requiredEquityRatio).toBe(0.20);
    expect(result.maxSafeShares).toBeGreaterThan(0);
    expect(result.maxSafeShares).toBeLessThan(180);
    expect(result.text).toContain('app planning floor of 20.0%');
    expect(result.text).toContain('Maximum additional shares');
  });

  it('blocks a proposed purchase that breaches maintenance or stop-out limits', () => {
    const state = portfolioStore.getState();
    vi.spyOn(portfolioStore, 'getState').mockReturnValue({
      ...state,
      balance: -9_000,
      cashCushion: { ...state.cashCushion, freeCash: 0 },
      brokerAssumptions: { ...state.brokerAssumptions, maintenanceEquityRatio: 0.25, stopOutRatio: 0.1 },
      positions: {
        ...state.positions,
        AAPL: {
          ticker: 'AAPL', shares: 10, currentPrice: 100, pt: 120, commBuy: 0,
          tranches: [{ qty: 10, price: 100 }]
        }
      }
    } as any);

    const result = ScenarioCalculator.previewBuyMoreScenario('AAPL', 100, 100);

    expect(result.type).toBe('err');
    expect(result.modal).toBeUndefined();
    expect(result.text).toContain('this purchase would leave projected account equity');
    expect(result.text).toContain('maintenance limit');
  });

  it('blocks Buy More previews when portfolio market value is unavailable', () => {
    const state = portfolioStore.getState();
    vi.spyOn(portfolioStore, 'getState').mockReturnValue({
      ...state,
      balance: 0,
      cashCushion: { ...state.cashCushion, freeCash: 1_000 },
      positions: {
        AAPL: { ticker: 'AAPL', shares: 10, currentPrice: 0, pt: 120, commBuy: 0, tranches: [] }
      }
    } as any);

    const result = ScenarioCalculator.previewBuyMoreScenario('AAPL', 1, 100);

    expect(result.type).toBe('err');
    expect(result.modal).toBeUndefined();
    expect(result.text).toContain('portfolio market valuation is incomplete');
  });
});
