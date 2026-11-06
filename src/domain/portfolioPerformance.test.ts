import { describe, expect, it } from 'vitest';
import {
  buildPerformanceSeries,
  comparePerformanceToBenchmark,
  calculateMoneyWeightedReturn,
  calculatePeriodAttribution,
  calculateTimeWeightedReturn,
  summarizePerformanceIncomeAndCosts,
  type PerformanceExternalCashFlow,
  type PerformanceValuationPoint
} from './portfolioPerformance';

const DAY = 24 * 60 * 60 * 1000;
const YEAR = 365 * DAY;
const current = 'current' as const;

function valuation(
  timestamp: number,
  equity: number,
  quality: PerformanceValuationPoint['quality'] = current
): PerformanceValuationPoint {
  return { timestamp, equity, currency: 'USD', quality };
}

function flow(
  timestamp: number,
  amount: number,
  type: PerformanceExternalCashFlow['type'] = 'contribution',
  quality: PerformanceExternalCashFlow['quality'] = current
): PerformanceExternalCashFlow {
  return { timestamp, amount, type, currency: 'USD', quality };
}

describe('calculateTimeWeightedReturn', () => {
  it('links Modified Dietz subperiods and weights an in-period contribution by remaining time', () => {
    const result = calculateTimeWeightedReturn({
      valuations: [valuation(0, 1000), valuation(2 * DAY, 1200), valuation(3 * DAY, 1210)],
      externalCashFlows: [flow(DAY, 100)]
    });

    expect(result.status).toBe('available');
    if (result.status === 'unavailable') return;
    expect(result.value.method).toBe('linked-modified-dietz');
    expect(result.value.periods[0]).toMatchObject({
      externalFlow: 100,
      weightedExternalFlow: 50,
      capitalBase: 1050,
      profit: 100
    });
    expect(result.value.periods[0].returnRate).toBeCloseTo(100 / 1050, 12);
    expect(result.value.periods[1].returnRate).toBeCloseTo(10 / 1200, 12);
    expect(result.value.totalReturn).toBeCloseTo((1 + 100 / 1050) * (1 + 10 / 1200) - 1, 12);
  });

  it('treats an external flow at the opening timestamp as already included in opening value', () => {
    const result = calculateTimeWeightedReturn({
      valuations: [valuation(0, 1100), valuation(YEAR, 1210)],
      externalCashFlows: [flow(0, 100)]
    });
    expect(result.status).toBe('available');
    if (result.status !== 'unavailable') expect(result.value.totalReturn).toBeCloseTo(0.1, 12);
  });

  it('uses withdrawal as negative portfolio capital flow', () => {
    const result = calculateTimeWeightedReturn({
      valuations: [valuation(0, 1000), valuation(2 * DAY, 900)],
      externalCashFlows: [flow(DAY, 200, 'withdrawal')]
    });
    expect(result.status).toBe('available');
    if (result.status !== 'unavailable') {
      expect(result.value.periods[0].capitalBase).toBe(900);
      expect(result.value.periods[0].profit).toBe(100);
      expect(result.value.periods[0].returnRate).toBeCloseTo(100 / 900, 12);
    }
  });

  it('does not present incomplete or mixed-currency observations as a return', () => {
    expect(calculateTimeWeightedReturn({
      valuations: [valuation(0, 1000), valuation(YEAR, 1100, 'incomplete')]
    }).status).toBe('unavailable');
    expect(calculateTimeWeightedReturn({
      valuations: [valuation(0, 1000), { ...valuation(YEAR, 1100), currency: 'AMD' }]
    }).status).toBe('unavailable');
  });

  it('marks a valid calculation provisional when source observations are provisional', () => {
    const result = calculateTimeWeightedReturn({
      valuations: [valuation(0, 1000), valuation(YEAR, 1100, 'provisional')]
    });
    expect(result.status).toBe('provisional');
    if (result.status !== 'unavailable') expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('rejects duplicate timestamps, zero opening equity, and invalid external flows', () => {
    expect(calculateTimeWeightedReturn({
      valuations: [valuation(0, 1000), valuation(0, 1100)]
    }).status).toBe('unavailable');
    expect(calculateTimeWeightedReturn({
      valuations: [valuation(0, 0), valuation(YEAR, 100)]
    }).status).toBe('unavailable');
    expect(calculateTimeWeightedReturn({
      valuations: [valuation(0, 1000), valuation(YEAR, 1100)],
      externalCashFlows: [flow(YEAR / 2, Number.NaN)]
    }).status).toBe('unavailable');
  });
});

describe('buildPerformanceSeries', () => {
  it('builds deterministic daily, monthly, and yearly UTC buckets from valuation cadence', () => {
    const input = {
      valuations: [
        valuation(Date.parse('2025-12-31T00:00:00.000Z'), 100),
        valuation(Date.parse('2026-01-01T00:00:00.000Z'), 110),
        valuation(Date.parse('2026-02-01T00:00:00.000Z'), 121)
      ]
    };
    const daily = buildPerformanceSeries(input, 'daily');
    const monthly = buildPerformanceSeries(input, 'monthly');
    const yearly = buildPerformanceSeries(input, 'yearly');

    expect(daily.status).toBe('available');
    expect(monthly.status).toBe('available');
    expect(yearly.status).toBe('available');
    if (monthly.status !== 'unavailable') {
      expect(monthly.value.points.map((point) => point.period)).toEqual(['2026-01', '2026-02']);
      expect(monthly.value.points[0].periodReturn).toBeCloseTo(0.1, 12);
      expect(monthly.value.points[1].periodReturn).toBeCloseTo(0.1, 12);
      expect(monthly.value.sinceInceptionReturn).toBeCloseTo(0.21, 12);
    }
    if (yearly.status !== 'unavailable') {
      expect(yearly.value.points).toHaveLength(1);
      expect(yearly.value.points[0].period).toBe('2026');
      expect(yearly.value.sinceInceptionReturn).toBeCloseTo(0.21, 12);
    }
  });

  it('rejects unsupported frequency values', () => {
    expect(buildPerformanceSeries(
      { valuations: [valuation(0, 100), valuation(YEAR, 110)] },
      'weekly' as never
    ).status).toBe('unavailable');
  });
});

describe('calculateMoneyWeightedReturn', () => {
  it('calculates annualized XIRR for a single opening investment and terminal value', () => {
    const result = calculateMoneyWeightedReturn({
      valuations: [valuation(0, 100), valuation(YEAR, 121)]
    });
    expect(result.status).toBe('available');
    if (result.status !== 'unavailable') expect(result.value.annualizedReturn).toBeCloseTo(0.21, 9);
  });

  it('solves an irregular contribution stream with ACT/365 timing', () => {
    const result = calculateMoneyWeightedReturn({
      valuations: [valuation(0, 100), valuation(YEAR, 100 * 1.2 + 100 * Math.sqrt(1.2))],
      externalCashFlows: [flow(YEAR / 2, 100)]
    });
    expect(result.status).toBe('available');
    if (result.status !== 'unavailable') expect(result.value.annualizedReturn).toBeCloseTo(0.2, 9);
  });

  it('rejects an ambiguous multiple-sign-change cash-flow stream', () => {
    const result = calculateMoneyWeightedReturn({
      valuations: [valuation(0, 100), valuation(YEAR, 250)],
      externalCashFlows: [
        flow(YEAR / 4, 50, 'contribution'),
        flow(YEAR / 2, 20, 'withdrawal'),
        flow(3 * YEAR / 4, 10, 'contribution')
      ]
    });
    expect(result.status).toBe('unavailable');
  });

  it('does not calculate MWR when no unique investment-to-inflow root exists', () => {
    expect(calculateMoneyWeightedReturn({
      valuations: [valuation(0, 100), valuation(YEAR, 0)]
    }).status).toBe('unavailable');
  });
});

describe('calculatePeriodAttribution', () => {
  it('reconciles item profit and contribution percentages to portfolio Modified Dietz return', () => {
    const result = calculatePeriodAttribution({
      startAt: 0,
      endAt: 2 * DAY,
      currency: 'USD',
      startPortfolioValue: 1000,
      endPortfolioValue: 1120,
      quality: 'current',
      externalCashFlows: [flow(DAY, 100)],
      items: [
        {
          key: 'position:A',
          currency: 'USD',
          startValue: 600,
          endValue: 660,
          quality: 'current',
          flows: [{ timestamp: DAY, amount: 100, currency: 'USD', quality: 'current' }]
        },
        { key: 'cash', currency: 'USD', startValue: 400, endValue: 460, quality: 'current', flows: [] }
      ]
    });

    expect(result.status).toBe('available');
    if (result.status !== 'unavailable') {
      expect(result.value.profit).toBe(20);
      expect(result.value.periodReturn).toBeCloseTo(20 / 1050, 12);
      expect(result.value.items.map((item) => item.profit)).toEqual([-40, 60]);
      expect(result.value.items.reduce((sum, item) => sum + item.contribution, 0))
        .toBeCloseTo(result.value.periodReturn, 12);
    }
  });

  it('fails closed when item valuations do not reconcile to portfolio equity', () => {
    const result = calculatePeriodAttribution({
      startAt: 0,
      endAt: YEAR,
      currency: 'USD',
      startPortfolioValue: 100,
      endPortfolioValue: 110,
      quality: 'current',
      items: [{
        key: 'cash',
        currency: 'USD',
        startValue: 99,
        endValue: 110,
        quality: 'current',
        flows: []
      }]
    });
    expect(result.status).toBe('unavailable');
  });
});

describe('summarizePerformanceIncomeAndCosts', () => {
  it('reports dividends and costs separately without changing return cash-flow treatment', () => {
    const result = summarizePerformanceIncomeAndCosts([
      { timestamp: 1, type: 'dividend', amount: 20, currency: 'USD', quality: 'current' },
      { timestamp: 2, type: 'fee', amount: 2, currency: 'USD', quality: 'current' },
      { timestamp: 3, type: 'commission', amount: 3, currency: 'USD', quality: 'current' },
      { timestamp: 4, type: 'interest', amount: 4, currency: 'USD', quality: 'current' }
    ], 'usd');
    expect(result.status).toBe('available');
    if (result.status !== 'unavailable') {
      expect(result.value).toEqual({
        currency: 'USD',
        dividends: 20,
        fees: 2,
        commissions: 3,
        interest: 4,
        netIncomeAndCosts: 11
      });
    }
  });

  it('rejects mixed currencies and incomplete adjustment data', () => {
    expect(summarizePerformanceIncomeAndCosts([
      { timestamp: 1, type: 'dividend', amount: 1, currency: 'AMD', quality: 'current' }
    ], 'USD').status).toBe('unavailable');
    expect(summarizePerformanceIncomeAndCosts([
      { timestamp: 1, type: 'fee', amount: 1, currency: 'USD', quality: 'incomplete' }
    ], 'USD').status).toBe('unavailable');
  });
});


describe('comparePerformanceToBenchmark', () => {
  it('compares flow-adjusted portfolio returns with an aligned total-return index', () => {
    const result = comparePerformanceToBenchmark({
      valuations: [valuation(0, 100), valuation(YEAR, 110)]
    }, {
      identifier: 'SP500-TR',
      returnType: 'total-return-index',
      valuations: [valuation(0, 200), valuation(YEAR, 220)]
    });

    expect(result.status).toBe('available');
    if (result.status !== 'unavailable') {
      expect(result.value.benchmarkIdentifier).toBe('SP500-TR');
      expect(result.value.currency).toBe('USD');
      expect(result.value.portfolioReturn).toBeCloseTo(0.1, 12);
      expect(result.value.benchmarkReturn).toBeCloseTo(0.1, 12);
      expect(result.value.activeReturn).toBeCloseTo(0, 12);
      expect(result.value.relativeReturn).toBeCloseTo(0, 12);
    }
  });

  it('requires exact opening/closing timestamps, matching currency, and a total-return index', () => {
    const portfolio = { valuations: [valuation(0, 100), valuation(YEAR, 110)] };
    expect(comparePerformanceToBenchmark(portfolio, {
      identifier: 'SP500-TR',
      returnType: 'total-return-index',
      valuations: [valuation(1, 200), valuation(YEAR, 220)]
    }).status).toBe('unavailable');

    expect(comparePerformanceToBenchmark(portfolio, {
      identifier: 'SP500-TR',
      returnType: 'total-return-index',
      valuations: [valuation(0, 200), { ...valuation(YEAR, 220), currency: 'AMD' }]
    }).status).toBe('unavailable');

    expect(comparePerformanceToBenchmark(portfolio, {
      identifier: 'SP500-PRICE',
      returnType: 'price-index' as never,
      valuations: [valuation(0, 200), valuation(YEAR, 220)]
    }).status).toBe('unavailable');
  });

  it('preserves provisional quality and does not invent a relative return after total benchmark loss', () => {
    const provisional = comparePerformanceToBenchmark({
      valuations: [valuation(0, 100), valuation(YEAR, 110)]
    }, {
      identifier: 'PROVISIONAL-TR',
      returnType: 'total-return-index',
      valuations: [valuation(0, 200), valuation(YEAR, 220, 'provisional')]
    });
    expect(provisional.status).toBe('provisional');

    const wipedOut = comparePerformanceToBenchmark({
      valuations: [valuation(0, 100), valuation(YEAR, 110)]
    }, {
      identifier: 'TOTAL-LOSS-TR',
      returnType: 'total-return-index',
      valuations: [valuation(0, 200), valuation(YEAR, 0)]
    });
    expect(wipedOut.status).toBe('available');
    if (wipedOut.status !== 'unavailable') {
      expect(wipedOut.value.benchmarkReturn).toBe(-1);
      expect(wipedOut.value.relativeReturn).toBeNull();
      expect(wipedOut.value.activeReturn).toBeCloseTo(1.1, 12);
    }
  });
});


describe('leveraged portfolio equity crossing zero', () => {
  it('reports a finite loss beyond 100% when positive opening equity turns negative', () => {
    const result = calculateTimeWeightedReturn({
      valuations: [valuation(0, 100), valuation(YEAR, -20)]
    });
    expect(result.status).toBe('available');
    if (result.status !== 'unavailable') {
      expect(result.value.periods[0].returnRate).toBeCloseTo(-1.2, 12);
      expect(result.value.totalReturn).toBeCloseTo(-1.2, 12);
    }
  });

  it('does not calculate a subsequent standard return period from non-positive opening equity', () => {
    const result = calculateTimeWeightedReturn({
      valuations: [valuation(0, 100), valuation(YEAR, -20), valuation(2 * YEAR, 10)]
    });
    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(result.reason).toContain('positive opening equity');
    }
  });
});
