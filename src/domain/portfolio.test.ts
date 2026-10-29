import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateMarginInterest,
  collectOpenPositionTranches,
  createBlankState,
  createPortfolioBackupSnapshot,
  normalizePortfolioBackup,
  normalizePortfolioState,
  realizeClosedTrade,
  resolveSaleQuantity,
  resolveTradeDateTimestamp,
  calculateProjectedDebt,
  calculateAccruedFees,
  calculateBreakevenDays,
  processRollovers,
  calculateCommission,
  calculateTrancheCommissions,
  getAccruedRolloverCycles,
  type MarginPosition,
  type TradeTranche
} from './portfolio';

const basePosition: MarginPosition = {
  ticker: 'TEST',
  shares: 10,
  tranches: [{ qty: 10, price: 10, acquiredAt: 1_000, buyCommission: 2 }],
  commBuy: 2,
  marginCharged: 5
};

describe('portfolio domain', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a backup snapshot without mutating live state or exporting secret fields', () => {
    const source = {
      activeView: 'AAPL',
      balance: -100,
      gatewaySecret: 'must-not-be-exported',
      marginBalance: 500,
      positions: { AAPL: { shares: 10 } }
    };
    const original = JSON.parse(JSON.stringify(source));

    const snapshot = createPortfolioBackupSnapshot(source);

    expect(source).toEqual(original);
    expect(snapshot).toEqual({
      activeView: 'AAPL',
      balance: -100,
      positions: { AAPL: { shares: 10 } }
    });
    expect(snapshot).not.toHaveProperty('gatewaySecret');
    expect(snapshot).not.toHaveProperty('marginBalance');
  });

  it('collects active tranches from canonical positions, ignoring empty or missing entries', () => {
    const positions = {
      AAPL: { tranches: [{ qty: 10, price: 100 }, { qty: 5, price: 110 }] },
      MSFT: { tranches: [{ qty: 2, price: 400 }] },
      CLOSED: { tranches: [] },
      MISSING: null
    };

    expect(collectOpenPositionTranches(positions)).toEqual([
      { qty: 10, price: 100 },
      { qty: 5, price: 110 },
      { qty: 2, price: 400 }
    ]);
  });

  it('returns no tranches when the canonical positions map is empty', () => {
    expect(collectOpenPositionTranches({})).toEqual([]);
  });

  it('creates a stable blank state from the supplied clock', () => {
    expect(createBlankState(1_700_000_000_000)).toMatchObject({
      activeView: 'COMBINED',
      closedTrades: [],
      positions: {},
      lastUpdated: 1_700_000_000_000
    });
  });

  it('normalizes missing collections while preserving existing state', () => {
    const normalized = normalizePortfolioState({
      balance: -25,
      positions: { TEST: basePosition },
      cashCushion: { freeCash: 20, holdings: 'invalid' }
    }, 10_000);

    expect(normalized.balance).toBe(-25);
    expect(normalized.positions.TEST).toEqual(basePosition);
    expect(normalized.cashCushion).toMatchObject({ freeCash: 20, holdings: [] });
    expect(normalized.closedTrades).toEqual([]);
  });

  it('omits legacy marginBalance without mutating the source state', () => {
    const source = {
      activeView: 'AAPL',
      balance: -100,
      marginBalance: 500
    };
    const original = { ...source };

    const normalized = normalizePortfolioState(source, 10_000);

    expect(source).toEqual(original);
    expect(normalized).not.toHaveProperty('marginBalance');
  });

  it('strips Gateway credentials from imported state without mutating the source', () => {
    const source = {
      activeView: 'AAPL',
      balance: -100,
      gatewaySecret: 'stale-or-untrusted-secret',
      positions: {}
    };
    const original = { ...source };

    const normalized = normalizePortfolioBackup(source, 10_000);

    expect(source).toEqual(original);
    expect(normalized).not.toHaveProperty('gatewaySecret');
    expect(normalized.balance).toBe(-100);
  });

  it('rejects non-object imported state', () => {
    expect(() => normalizePortfolioState([])).toThrow('Portfolio state must be an object.');
  });

  it('migrates a legacy-only JSON backup into canonical positions', () => {
    const backup = normalizePortfolioBackup({
      balance: -250,
      holdings: [{
        ticker: 'wdc',
        isMargin: true,
        currentPrice: 11.5,
        analystTarget: 12.07,
        tranches: [{
          id: 'legacy-wdc',
          shares: 30,
          entryPrice: 11.5,
          purchaseDate: '2026-10-15'
        }]
      }]
    }, 1_792_000_000_000);

    expect(backup.positions.WDC).toMatchObject({
      ticker: 'WDC',
      shares: 30,
      currentPrice: 11.5,
      pt: 12.07,
      tranches: [{ qty: 30, price: 11.5, date: '2026-10-15' }]
    });
    expect(backup.balance).toBe(-250);
  });

  it('preserves imported position keys without invoking object prototype setters', () => {
    const candidate = JSON.parse(JSON.stringify({
      positions: {
        AAPL: { shares: 1, tranches: [{ qty: 1, price: 10 }] }
      }
    }));
    Object.defineProperty(candidate.positions, '__proto__', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: { shares: 2, tranches: [{ qty: 2, price: 20 }] }
    });

    const normalized = normalizePortfolioBackup(candidate, 10_000);
    expect(Object.hasOwn(normalized.positions, '__proto__')).toBe(true);
    expect(normalized.positions['__proto__']).toMatchObject({
      shares: 2,
      tranches: [{ qty: 2, price: 20 }]
    });
    expect(Object.getPrototypeOf(normalized.positions)).toBe(Object.prototype);
  });

  it('rejects malformed top-level backup containers instead of silently dropping portfolio data', () => {
    expect(() => normalizePortfolioBackup({ positions: null }, 10_000))
      .toThrow('Invalid positions in portfolio backup: expected an object keyed by ticker.');
    expect(() => normalizePortfolioBackup({ positions: [], holdings: [{ ticker: 'AAPL' }] }, 10_000))
      .toThrow('Invalid positions in portfolio backup: expected an object keyed by ticker.');
    expect(() => normalizePortfolioBackup({ holdings: {} }, 10_000))
      .toThrow('Invalid holdings in portfolio backup: expected an array.');
    expect(() => normalizePortfolioBackup({ positions: {}, cashCushion: [] }, 10_000))
      .toThrow('Invalid cashCushion in portfolio backup: expected an object.');
    expect(() => normalizePortfolioBackup({ positions: {}, closedTrades: {} }, 10_000))
      .toThrow('Invalid closedTrades in portfolio backup: expected an array.');
  });

  it('accepts recognized portfolio backups and rejects unrelated JSON objects', () => {
    expect(normalizePortfolioBackup({ positions: {} }, 10_000).positions).toEqual({});
    expect(() => normalizePortfolioBackup({ settings: {} }, 10_000)).toThrow('recognized portfolio backup');
  });

  it('rejects negative or non-finite financial quantities in canonical backup positions', () => {
    expect(() => normalizePortfolioBackup({
      positions: { AAPL: { shares: -3, tranches: [] } }
    }, 10_000)).toThrow('AAPL shares');

    expect(() => normalizePortfolioBackup({
      positions: { AAPL: { shares: 3, tranches: [{ qty: 3, price: -10 }] } }
    }, 10_000)).toThrow('AAPL tranche price');

    expect(() => normalizePortfolioBackup({
      positions: { AAPL: { shares: 3, tranches: [{ qty: 'Infinity', price: 10 }] } }
    }, 10_000)).toThrow('AAPL tranche quantity');

    expect(() => normalizePortfolioBackup({
      positions: { AAPL: { shares: 3, commBuy: -1, tranches: [] } }
    }, 10_000)).toThrow('AAPL commBuy');

    expect(() => normalizePortfolioBackup({
      positions: { AAPL: { shares: 3, currentPrice: -1, tranches: [] } }
    }, 10_000)).toThrow('AAPL currentPrice');
  });

  it('continues to accept valid zero-valued position fees and positive trade lots', () => {
    const backup = normalizePortfolioBackup({
      positions: {
        AAPL: {
          shares: 2,
          commBuy: 0,
          marginCharged: 0,
          tranches: [{ qty: 2, price: 150, buyCommission: 0 }]
        }
      }
    }, 10_000);

    expect(backup.positions.AAPL).toMatchObject({
      shares: 2,
      commBuy: 0,
      marginCharged: 0,
      tranches: [{ qty: 2, price: 150, buyCommission: 0 }]
    });
  });

  it('rejects canonical backups whose position share count disagrees with its trade lots', () => {
    expect(() => normalizePortfolioBackup({
      positions: {
        AAPL: {
          shares: 10,
          tranches: [{ qty: 8, price: 150 }]
        }
      }
    }, 10_000)).toThrow('share count (10) does not match tranche total (8)');

    expect(() => normalizePortfolioBackup({
      positions: {
        AAPL: {
          shares: 10,
          tranches: [{ qty: 10, price: 150 }, { qty: 1, price: 160 }]
        }
      }
    }, 10_000)).toThrow('share count (10) does not match tranche total (11)');
  });

  it('rejects null and blank strings instead of treating them as zero-valued backup fields', () => {
    expect(() => normalizePortfolioBackup({
      positions: { AAPL: { shares: null, tranches: [] } }
    }, 10_000)).toThrow('AAPL shares');

    expect(() => normalizePortfolioBackup({
      positions: { AAPL: { shares: 3, commBuy: ' ', tranches: [] } }
    }, 10_000)).toThrow('AAPL commBuy');
  });

  it('prevents selling more shares than the position holds', () => {
    expect(resolveSaleQuantity(10, null)).toBe(10);
    expect(resolveSaleQuantity(10, 4)).toBe(4);
    expect(resolveSaleQuantity(10, 10 + 1e-9)).toBe(10);
    expect(() => resolveSaleQuantity(10, 11)).toThrow('only 10 are available');
    expect(() => resolveSaleQuantity(0, 1)).toThrow('no valid shares');
  });

  it('calculates accrued margin interest across tranches with mixed date formats', () => {
    const tranches: TradeTranche[] = [
      { qty: 100, price: 100, date: '06 Oct' },
      { qty: 50, price: 100, date: '2026-10-08' }
    ];
    const fixedNow = new Date(2026, 9, 11, 12, 0, 0);
    const accrued = calculateMarginInterest(tranches, { now: fixedNow, annualRate: 0.15 });

    expect(Math.round(accrued)).toBe(27);
    expect(accrued).toBeCloseTo(26.71, 1);
  });

  it('uses allocated position debt instead of charging total portfolio debt to each position', () => {
    const interest = calculateMarginInterest(
      [{ qty: 10, price: 100, date: '2026-10-15' }],
      { dailyRate: 0.01, marginDebt: 200, totalDebt: 1000, days: 1 }
    );

    // $200 allocated debt at 1% for one cycle = $2, not $10 on the full $1,000 position.
    expect(interest).toBeCloseTo(2, 8);
  });

  it('calculates interest scaling with margin utilization ratio', () => {
    const state = {
      marginDebt: 5_000,
      tranches: [
        { shares: 100, price: 100, date: '2026-10-01' }
      ]
    };
    const now = new Date(2026, 9, 5, 12, 0, 0);
    const interest = calculateMarginInterest(state, { now, annualRate: 0.15 });

    const expected = 10_000 * 0.5 * (Math.pow(1 + 0.15 / 365, 4) - 1);
    expect(interest).toBeCloseTo(expected, 4);
  });

  it('honors explicit zero rates instead of falling back to alternate rate fields', () => {
    const tranches = [{ qty: 10, price: 100, date: '2026-10-15' }];

    expect(calculateMarginInterest(tranches, {
      annualRate: 0,
      annualBorrowRate: 0.15,
      days: 1
    })).toBe(0);
    expect(calculateMarginInterest(tranches, {
      dailyRate: 0,
      annualRate: 0.15,
      days: 1
    })).toBe(0);
  });

  it('falls back to a valid legacy single-lot position when its tranche array is empty', () => {
    const interest = calculateMarginInterest({
      shares: 10,
      price: 100,
      date: '2026-10-15',
      tranches: []
    }, { dailyRate: 0.01, days: 1 });

    expect(interest).toBeCloseTo(10, 8);
  });

  it('compounds margin interest across each accrued rollover cycle', () => {
    const principal = 10_000;
    const dailyRate = 0.15 / 365;
    const interest = calculateMarginInterest(principal, dailyRate, 4);
    expect(interest).toBeCloseTo(principal * (Math.pow(1 + dailyRate, 4) - 1), 8);
    expect(interest).toBeGreaterThan(principal * dailyRate * 4);
  });

  it('applies minimum commissions separately to each execution tranche', () => {
    const rules = { commPerShare: 0.01, commVolumePct: 0, minCommOrder: 1.5 };
    expect(calculateCommission(100, 1_000, rules)).toBe(1.5);
    expect(calculateTrancheCommissions([
      { qty: 10, price: 10 },
      { qty: 10, price: 10 }
    ], rules)).toBe(3);
  });

  it('parses short buy dates and falls back for invalid dates', () => {
    const ts = resolveTradeDateTimestamp('05 Oct 2026');
    const d = new Date(ts);

    // Extract local timezone year, month, and day to prevent UTC drift
    const localStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    expect(localStr).toBe('2026-10-05');
    expect(resolveTradeDateTimestamp('not a date', 1234)).toBe(1234);
  });

  it('rejects impossible calendar dates instead of normalizing into another month', () => {
    expect(resolveTradeDateTimestamp('2026-02-31', 1234)).toBe(1234);
    expect(resolveTradeDateTimestamp('31 Feb 2026', 1234)).toBe(1234);
    expect(resolveTradeDateTimestamp('2024-02-29', 1234)).toBe(Date.UTC(2024, 1, 29));
  });

  it('does not accrue rollover cycles from an impossible purchase date', () => {
    expect(getAccruedRolloverCycles('2026-02-31', new Date('2026-03-10T12:00:00Z'))).toBe(0);
  });

  it('returns no margin interest for invalid utilization ratios or non-finite rates', () => {
    expect(calculateMarginInterest(1_000, { dailyRate: 0.01, marginRatio: -1, days: 1 })).toBe(0);
    expect(calculateMarginInterest(1_000, { dailyRate: Number.POSITIVE_INFINITY, days: 1 })).toBe(0);
    expect(calculateMarginInterest([{ qty: 10, price: 100 }], { dailyRate: 0.01, marginUtilizationRatio: -0.5, days: 1 })).toBe(0);
  });

  it('realizes partial sale and carries remaining lots, commissions, and margin fees', () => {
    const result = realizeClosedTrade(basePosition, 'TEST', 4, 12, 1, 86_401_000);

    expect(result.trade).toMatchObject({
      ticker: 'TEST',
      shares: 4,
      holdingDays: 1,
      feesAndCommissions: 3.8,
      netProfit: 4.2
    });
    expect(result.position).toMatchObject({ shares: 6, commBuy: 1.2, marginCharged: 3 });
    expect(result.position.tranches).toHaveLength(1);
    expect(result.position.tranches[0]).toMatchObject({ qty: 6, buyCommission: 1.2 });
  });

  it('consumes multiple buy lots FIFO and calculates weighted duration', () => {
    const position: MarginPosition = {
      ticker: 'TEST',
      shares: 10,
      tranches: [
        { qty: 5, price: 10, acquiredAt: 1_000, buyCommission: 1 },
        { qty: 5, price: 20, acquiredAt: 86_401_000, buyCommission: 2 }
      ],
      commBuy: 3,
      marginCharged: 0
    };

    const result = realizeClosedTrade(position, 'TEST', 6, 25, 1, 172_801_000);

    expect(result.trade).toMatchObject({
      shares: 6,
      holdingDays: 1,
      feesAndCommissions: 2.4,
      netProfit: 77.6
    });
    expect(result.position.shares).toBe(4);
    expect(result.position.tranches).toHaveLength(1);
    expect(result.position.tranches[0]).toMatchObject({ qty: 4, price: 20, buyCommission: 1.6 });
  });

  it('rejects invalid closed quantities and prices without mutating the input position', () => {
    const original = structuredClone(basePosition);
    expect(() => realizeClosedTrade(basePosition, 'TEST', 0, 12, 1, 10_000)).toThrow();
    expect(() => realizeClosedTrade(basePosition, 'TEST', 11, 12, 1, 10_000)).toThrow();
    expect(() => realizeClosedTrade(basePosition, 'TEST', 1, Number.NaN, 1, 10_000)).toThrow();
    expect(() => realizeClosedTrade(basePosition, 'TEST', 1, 12, Number.NaN, 10_000)).toThrow();
    expect(() => realizeClosedTrade({ ...basePosition, shares: Number.NaN }, 'TEST', 1, 12, 1, 10_000)).toThrow();
    expect(basePosition).toEqual(original);
  });

  it('rejects materially inconsistent open shares and tranche totals before realizing a sale', () => {
    const inconsistent: MarginPosition = {
      ...basePosition,
      shares: 10,
      tranches: [{ qty: 12, price: 10, buyCommission: 2 }]
    };
    const original = structuredClone(inconsistent);
    expect(() => realizeClosedTrade(inconsistent, 'TEST', 1, 12, 1, 10_000))
      .toThrow('Position tranche total (12) exceeds recorded open shares (10)');
    expect(inconsistent).toEqual(original);
  });

  it('blocks sales when cost-basis lots are missing or understate the open quantity', () => {
    const withoutLots: MarginPosition = { ...basePosition, tranches: [] };
    const undercounted: MarginPosition = {
      ...basePosition,
      shares: 10,
      tranches: [{ qty: 8, price: 10, buyCommission: 2 }]
    };
    expect(() => realizeClosedTrade(withoutLots, 'TEST', 1, 12, 1, 10_000))
      .toThrow('Position has no cost-basis tranches');
    expect(() => realizeClosedTrade(undercounted, 'TEST', 1, 12, 1, 10_000))
      .toThrow('Recorded open shares (10) do not match tranche total (8)');
  });

  it('blocks sales when a tranche has an invalid entry price or fees exceed the aggregate commission', () => {
    const invalidPrice: MarginPosition = {
      ...basePosition,
      tranches: [{ qty: 10, price: 0, buyCommission: 2 }]
    };
    const invalidFees: MarginPosition = {
      ...basePosition,
      commBuy: 1,
      tranches: [{ qty: 10, price: 10, buyCommission: 2 }]
    };
    expect(() => realizeClosedTrade(invalidPrice, 'TEST', 1, 12, 1, 10_000))
      .toThrow('invalid cost-basis tranche');
    expect(() => realizeClosedTrade(invalidFees, 'TEST', 1, 12, 1, 10_000))
      .toThrow('Tranche entry commissions exceed');
  });

  it('projects debt with the same daily compounding model as accrued margin interest', () => {
    // 1000 * (1 + 0.01)^5 = 1051.01005, rounded to cents.
    expect(calculateProjectedDebt(1000, 0.01, 5)).toBe(1051.01);
    expect(calculateProjectedDebt(-1000, 0.01, 5)).toBe(1051.01);
    expect(calculateProjectedDebt(1000, 0.01, 0)).toBe(1000);
    expect(calculateProjectedDebt(Number.NaN, 0.01, 5)).toBe(0);
    expect(calculateProjectedDebt(1000, Number.POSITIVE_INFINITY, 5)).toBe(0);
    expect(calculateProjectedDebt(1000, 0.01, Number.NaN)).toBe(0);
  });

  it('matches live rollover cent rounding in projected debt', () => {
    const dailyRate = 1 / 365;
    const projectedDebt = calculateProjectedDebt(1.99, dailyRate, 3);
    vi.useFakeTimers();
    const state = {
      balance: -1.99,
      lastRolloverTimestamp: new Date('2026-01-01T00:00:00Z').getTime(),
      brokerAssumptions: { annualRate: 1, dayCountBasis: 365, rolloverHour: 4, rolloverMinute: 0 }
    };
    vi.setSystemTime(new Date('2026-01-04T00:00:00Z'));

    expect(processRollovers(state)).toBe(true);
    expect(Math.abs(state.balance)).toBe(2.02);
    expect(projectedDebt).toBe(2.02);
    vi.useRealTimers();
  });

  it('calculates accrued fees correctly', () => {
    expect(calculateAccruedFees(10.5, 5.25, 2.25)).toBe(18);
    expect(calculateAccruedFees(0, 0, 0)).toBe(0);
    expect(calculateAccruedFees(Number.POSITIVE_INFINITY, 5, 2)).toBe(7);
    expect(calculateAccruedFees(10, Number.NaN, 2)).toBe(12);
  });

  it('calculates breakeven days using the same daily compounding model as projected debt', () => {
    // After 10 days, $1,000 of debt at 1% daily accrues $104.62, enough to cover $100.
    expect(calculateBreakevenDays(100, 1000, 0.01)).toBe(10);
    // At 0.5% daily, 19 days accrue less than $100 and 20 days exceed it.
    expect(calculateBreakevenDays(100, 1000, 0.005)).toBe(20);
    expect(calculateProjectedDebt(1000, 0.005, 19) - 1000).toBeLessThan(100);
    expect(calculateProjectedDebt(1000, 0.005, 20) - 1000).toBeGreaterThanOrEqual(100);
    expect(calculateBreakevenDays(-10, 1000, 0.01)).toBe(0); // <= 0 profit
    expect(calculateBreakevenDays(100, 0, 0.01)).toBe(0); // 0 debt
    expect(calculateBreakevenDays(100, 1000, 0)).toBeNull(); // positive target is unreachable without interest
    expect(calculateBreakevenDays(Number.POSITIVE_INFINITY, 1000, 0.01)).toBeNull();
    expect(calculateBreakevenDays(100, 1000, -0.01)).toBeNull();
    expect(calculateBreakevenDays(100, -1000, 0.01)).toBeNull();
  });

  it('uses the cent-rounded ledger rather than the logarithmic estimate at small balances', () => {
    const principal = 1.99;
    const dailyRate = 1 / 365;
    expect(calculateProjectedDebt(principal, dailyRate, 2) - principal).toBeLessThan(0.03);
    expect(calculateProjectedDebt(principal, dailyRate, 3) - principal).toBeGreaterThanOrEqual(0.03);
    expect(calculateBreakevenDays(0.03, principal, dailyRate)).toBe(3);
  });

  it('calculates commission based on rules', () => {
    const rules = { commPerShare: 0.01, commVolumePct: 0.001, minCommOrder: 1.5 };
    expect(calculateCommission(100, 1000, rules)).toBe(2); // 100*0.01 + 1000*0.001 = 1 + 1 = 2
    expect(calculateCommission(10, 100, rules)).toBe(1.5); // 0.1 + 0.1 = 0.2 -> min 1.5
    expect(calculateCommission(0, 100, rules)).toBe(0); // 0 shares
    expect(calculateCommission(Number.NaN, 100, rules)).toBe(0);
    expect(() => calculateCommission(10, Number.NaN, rules)).toThrow(RangeError);
    expect(() => calculateCommission(10, 100, { ...rules, minCommOrder: Number.NaN })).toThrow(RangeError);
    expect(() => calculateCommission(10, 100, { ...rules, commPerShare: -1 })).toThrow(RangeError);
  });

  it('calculates rollover cycles at 04:00 in Asia/Yerevan independent of host timezone', () => {
    const purchaseDate = '2026-10-01';
    // 03:00 Armenia time on purchase day (23:00Z previous day).
    expect(getAccruedRolloverCycles(purchaseDate, new Date('2026-09-30T23:00:00Z'))).toBe(0);
    // 05:00 Armenia time on purchase day.
    expect(getAccruedRolloverCycles(purchaseDate, new Date('2026-10-01T01:00:00Z'))).toBe(0);
    // 03:00 Armenia time the next day, before the cutoff.
    expect(getAccruedRolloverCycles(purchaseDate, new Date('2026-10-01T23:00:00Z'))).toBe(0);
    // 05:00 Armenia time the next day, after the cutoff.
    expect(getAccruedRolloverCycles(purchaseDate, new Date('2026-10-02T01:00:00Z'))).toBe(1);
  });

  it('uses configured rollover hour and minute for accrued interest', () => {
    const tranches = [{ qty: 10, price: 100, date: '2026-10-01' }];
    const options = { annualRate: 0.365, dayCountBasis: 365, rolloverHour: 6, rolloverMinute: 30 };

    // 06:00 Armenia time is before the configured 06:30 cutoff.
    expect(calculateMarginInterest(tranches, {
      ...options,
      now: new Date('2026-10-02T02:00:00Z')
    })).toBe(0);

    // 07:00 Armenia time is after the configured 06:30 cutoff.
    expect(calculateMarginInterest(tranches, {
      ...options,
      now: new Date('2026-10-02T03:00:00Z')
    })).toBeCloseTo(1, 8);
  });

  it('processes a same-day rollover when the stored baseline is before the 04:00 Armenia cutoff', () => {
    vi.useFakeTimers();
    const state = {
      balance: -1000,
      lastRolloverTimestamp: new Date('2026-01-02T23:00:00Z').getTime(),
      brokerAssumptions: { annualRate: 0.365, dayCountBasis: 365, rolloverHour: 4, rolloverMinute: 0 }
    };

    // 05:00 Armenia time on Jan 3, one hour after the cutoff.
    vi.setSystemTime(new Date('2026-01-03T01:00:00Z'));
    expect(processRollovers(state)).toBe(true);
    expect(state.balance).toBe(-1001);
    expect(state.lastRolloverTimestamp).toBe(new Date('2026-01-03T00:00:00Z').getTime());

    vi.useRealTimers();
  });

  it('processes rollovers and deducts margin from balance', () => {
    vi.useFakeTimers();
    
    const state = {
      balance: -1000,
      lastRolloverTimestamp: new Date('2026-01-01T00:00:00Z').getTime(),
      settings: { marginRate: 0.365 } // 0.365 / 365 = 0.001 daily
    };
    
    // Fast forward past 2 cutoffs (Jan 2 04:00, Jan 3 04:00)
    vi.setSystemTime(new Date('2026-01-03T05:00:00Z'));
    
    const applied = processRollovers(state);
    expect(applied).toBe(true);
    
    // Day 1: -1000 - 1 = -1001
    // Day 2: -1001 - 1.001 = -1002.001 -> rounded to -1002
    expect(state.balance).toBe(-1002);
    
    vi.useRealTimers();
  });
});


describe('financial edge cases', () => {
  it.each([0, -0.01, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid sale price %s without mutating the open position',
    (sellPrice) => {
      const position = structuredClone(basePosition);
      const original = structuredClone(position);
      expect(() => realizeClosedTrade(position, 'TEST', 1, sellPrice, 1, 86_401_000)).toThrow();
      expect(position).toEqual(original);
    }
  );

  it('keeps commission arithmetic precise to the expected monetary result', () => {
    const rules = { commPerShare: 0.005, commVolumePct: 0.001, minCommOrder: 0.01 };
    expect(calculateCommission(3, 19.99, rules)).toBeCloseTo(0.03499, 8);
    expect(calculateTrancheCommissions([
      { qty: 3, price: 19.99 },
      { qty: 2, price: 10.01 }
    ], rules)).toBeCloseTo(0.10499, 8);
  });

  it('does not accrue margin interest on non-negative cash balances', () => {
    vi.useFakeTimers();
    const state = {
      balance: 250,
      lastRolloverTimestamp: new Date('2026-01-01T00:00:00Z').getTime(),
      brokerAssumptions: { annualRate: 0.365, dayCountBasis: 365, rolloverHour: 4, rolloverMinute: 0 }
    };
    vi.setSystemTime(new Date('2026-01-02T01:00:00Z'));

    expect(processRollovers(state)).toBe(true);
    expect(state.balance).toBe(250);
    expect(state.lastRolloverTimestamp).toBe(new Date('2026-01-02T00:00:00Z').getTime());
    vi.useRealTimers();
  });

  it('does not charge interest for a negative configured annual rate', () => {
    vi.useFakeTimers();
    const state = {
      balance: -1000,
      lastRolloverTimestamp: new Date('2026-01-01T00:00:00Z').getTime(),
      brokerAssumptions: { annualRate: -0.365, dayCountBasis: 365, rolloverHour: 4, rolloverMinute: 0 }
    };
    vi.setSystemTime(new Date('2026-01-02T01:00:00Z'));

    expect(processRollovers(state)).toBe(true);
    expect(state.balance).toBe(-1000);
    vi.useRealTimers();
  });

  it.each([Number.POSITIVE_INFINITY, Number.NaN, -0.1, 1.5])(
    'does not let an invalid annual rate corrupt margin debt (%s)',
    (annualRate) => {
      vi.useFakeTimers();
      const state = {
        balance: -1000,
        lastRolloverTimestamp: new Date('2026-01-01T00:00:00Z').getTime(),
        brokerAssumptions: { annualRate, dayCountBasis: 365, rolloverHour: 4, rolloverMinute: 0 }
      };
      vi.setSystemTime(new Date('2026-01-02T01:00:00Z'));

      expect(processRollovers(state)).toBe(true);
      expect(state.balance).toBe(-1000);
      expect(Number.isFinite(state.balance)).toBe(true);
      vi.useRealTimers();
    }
  );

  it('recovers from an out-of-range rollover timestamp without throwing', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T01:00:00Z'));
    const now = Date.now();
    const state = {
      balance: -1000,
      lastRolloverTimestamp: Number.MAX_VALUE,
      brokerAssumptions: { annualRate: 0.15, dayCountBasis: 365 }
    };

    expect(() => processRollovers(state)).not.toThrow();
    expect(state.lastRolloverTimestamp).toBe(now);
    expect(state.balance).toBe(-1000);
    vi.useRealTimers();
  });

  it('returns zero for invalid transaction quantities but rejects invalid broker commission assumptions', () => {
    const rules = { commPerShare: 0.01, commVolumePct: 0.001, minCommOrder: 1.5 };
    expect(calculateCommission(-1, 100, rules)).toBe(0);
    expect(() => calculateCommission(10, -1, rules)).toThrow('Commission transaction value must be finite and non-negative.');
    expect(() => calculateCommission(10, Number.NaN, rules)).toThrow('Commission transaction value must be finite and non-negative.');
    expect(() => calculateCommission(10, 100, { ...rules, commVolumePct: Number.NaN }))
      .toThrow('Commission configuration must contain finite, non-negative rates and minimums.');
    expect(() => calculateCommission(10, 100, { ...rules, minCommOrder: -1 }))
      .toThrow(RangeError);
    expect(calculateTrancheCommissions([], rules)).toBe(0);
    expect(() => calculateTrancheCommissions([{ qty: 2, price: Number.NaN }], rules))
      .toThrow('Each commission tranche must have a positive finite quantity and price.');
  });
});
