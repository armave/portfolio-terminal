import { describe, expect, it } from 'vitest';
import { DEFAULT_BROKER_ASSUMPTIONS } from './brokerAssumptions';
import {
  calculateBrokerMarginRisk, calculateHistoricalCorrelation, calculateHistoricalRisk,
  calculatePortfolioRiskSnapshot, calculateRiskStressScenario, type PortfolioRiskSnapshot,
  type RiskHistoricalSeriesInput
} from './portfolioRisk';

const currentAt = Date.UTC(2026, 10, 6, 9, 0, 0);
function makeSnapshot(overrides: Partial<PortfolioRiskSnapshot> = {}): PortfolioRiskSnapshot {
  return {
    calculatedAt: currentAt,
    positions: [
      { id: 'a1', ticker: 'AAA', quantity: 10, price: 100, currency: 'USD', quality: 'current', freshness: 'fresh', observedAt: currentAt - 60_000, sector: 'Technology', assetType: 'EQUITY', brokerId: 'freedom', accountId: 'margin' },
      { id: 'b1', ticker: 'BBB', quantity: 5, price: 50, currency: 'USD', quality: 'current', freshness: 'fresh', observedAt: currentAt - 60_000, sector: 'Healthcare', assetType: 'ETF', brokerId: 'freedom', accountId: 'margin' }
    ],
    capital: [{ currency: 'USD', cash: 200, debt: 300, quality: 'current', freshness: 'fresh', observedAt: currentAt - 60_000, brokerId: 'freedom', accountId: 'margin' }],
    brokerAssumptions: [{ brokerId: 'freedom', assumptions: DEFAULT_BROKER_ASSUMPTIONS }],
    ...overrides
  };
}
function makeHistory(ticker: string, prices: number[], options: Partial<RiskHistoricalSeriesInput> = {}): RiskHistoricalSeriesInput {
  return {
    ticker, currency: 'USD',
    points: prices.map((close, index) => ({ timestamp: currentAt - (prices.length - index) * 86_400_000, close })),
    quality: 'complete', freshness: 'fresh', observedAt: currentAt - 86_400_000, ...options
  };
}

describe('calculatePortfolioRiskSnapshot', () => {
  it('calculates exposure, equity, leverage, margin utilization and concentration with known answers', () => {
    const result = calculatePortfolioRiskSnapshot(makeSnapshot());
    expect(result.status).toBe('available');
    if (result.status === 'unavailable') return;
    const portfolio = result.value.portfolio;
    expect(portfolio.status).toBe('available');
    if (portfolio.status === 'unavailable') return;
    expect(portfolio.value.grossExposure).toBe(1_250);
    expect(portfolio.value.netExposure).toBe(1_250);
    expect(portfolio.value.cash).toBe(200);
    expect(portfolio.value.debt).toBe(300);
    expect(portfolio.value.equity).toBe(1_150);
    expect(portfolio.value.grossLeverage).toBeCloseTo(1_250 / 1_150);
    expect(portfolio.value.marginUtilization).toBeCloseTo(300 / 1_250);
    expect(portfolio.value.margin.status).toBe('available');
    if (portfolio.value.margin.status === 'unavailable') return;
    expect(portfolio.value.margin.value[0].annualInterestCost).toBeCloseTo(45);
    expect(portfolio.value.margin.value[0].dailyInterestCost).toBeCloseTo(45 / 365);
    expect(portfolio.value.margin.value[0].maintenanceState).toBe('above-maintenance');
    const concentration = result.value.concentrationByCurrency[0].value;
    expect(concentration.byTicker[0]).toMatchObject({ key: 'AAA', exposure: 1_000, percentage: 80, positions: 1 });
    expect(concentration.bySector.map(item => item.key)).toEqual(['Technology', 'Healthcare']);
  });

  it('keeps short exposure signed while using absolute exposure for concentration', () => {
    const result = calculatePortfolioRiskSnapshot(makeSnapshot({
      positions: [{ id: 'short', ticker: 'SHORT', quantity: -4, price: 25, currency: 'USD', quality: 'current', freshness: 'fresh', observedAt: currentAt }],
      capital: [{ currency: 'USD', cash: 200, debt: 0, quality: 'current', freshness: 'fresh', observedAt: currentAt, brokerId: 'freedom' }]
    }));
    expect(result.status).toBe('available');
    if (result.status === 'unavailable') return;
    const portfolio = result.value.portfolio;
    expect(portfolio.status).toBe('available');
    if (portfolio.status === 'unavailable') return;
    expect(portfolio.value.netExposure).toBe(-100);
    expect(portfolio.value.grossExposure).toBe(100);
    expect(portfolio.value.equity).toBe(100);
    expect(result.value.concentrationByCurrency[0].value.byTicker[0].percentage).toBe(100);
  });

  it('never combines unlike currencies into a consolidated total', () => {
    const snapshot = makeSnapshot({
      capital: [
        ...makeSnapshot().capital,
        { currency: 'AMD', cash: 100_000, debt: 0, quality: 'current', freshness: 'fresh', observedAt: currentAt, brokerId: 'local' }
      ]
    });
    const result = calculatePortfolioRiskSnapshot(snapshot);
    expect(result.status).toBe('available');
    if (result.status === 'unavailable') return;
    expect(result.value.currencyExposure.map(item => item.currency)).toEqual(['AMD', 'USD']);
    expect(result.value.portfolio.status).toBe('unavailable');
    expect(result.value.portfolio.status === 'unavailable' && result.value.portfolio.reason).toContain('FX conversion');
  });

  it('marks stale and unknown observations provisional, never current', () => {
    const result = calculatePortfolioRiskSnapshot(makeSnapshot({
      positions: [{ ...makeSnapshot().positions[0], freshness: 'unknown', observedAt: null }]
    }));
    expect(result.status).toBe('provisional');
    if (result.status === 'unavailable') return;
    expect(result.value.portfolio.status).toBe('provisional');
    expect(result.value.warnings.some(item => item.includes('observation time is unknown'))).toBe(true);
  });

  it('fails closed for incomplete/unpriced positions and malformed capital', () => {
    expect(calculatePortfolioRiskSnapshot(makeSnapshot({
      positions: [{ ...makeSnapshot().positions[0], quality: 'incomplete' }]
    })).status).toBe('unavailable');
    expect(calculatePortfolioRiskSnapshot(makeSnapshot({
      positions: [{ ...makeSnapshot().positions[0], price: 0 }]
    })).status).toBe('unavailable');
    expect(calculatePortfolioRiskSnapshot(makeSnapshot({
      capital: [{ ...makeSnapshot().capital[0], cash: Number.NaN }]
    })).status).toBe('unavailable');
  });

  it('keeps unknown classifications explicit rather than guessing', () => {
    const result = calculatePortfolioRiskSnapshot(makeSnapshot({
      positions: [{ ...makeSnapshot().positions[0], sector: null, assetType: null, brokerId: null, accountId: null }],
      capital: [{ ...makeSnapshot().capital[0], debt: 0, brokerId: 'Unclassified' }],
      brokerAssumptions: []
    }));
    expect(result.status).toBe('available');
    if (result.status === 'unavailable') return;
    const breakdown = result.value.concentrationByCurrency[0].value;
    expect(breakdown.bySector[0].key).toBe('Unclassified');
    expect(breakdown.byBroker[0].key).toBe('Unclassified');
    expect(breakdown.byAccount[0].key).toBe('Unclassified');
  });
});

describe('broker margin estimates', () => {
  it('uses configured assumptions and clearly labels margin estimates', () => {
    const snapshot = makeSnapshot();
    const result = calculateBrokerMarginRisk({
      brokerId: 'freedom', debt: 300, positions: snapshot.positions, capital: snapshot.capital,
      assumptions: DEFAULT_BROKER_ASSUMPTIONS
    });
    expect(result.status).toBe('available');
    if (result.status === 'unavailable') return;
    expect(result.value.annualInterestCost).toBeCloseTo(45);
    expect(result.value.maintenanceEquityRatio).toBe(0.1);
    expect(result.value.disclaimer).toContain('not a broker maintenance calculation');
  });
  it('rejects invalid assumptions and debt without a currency source', () => {
    expect(calculateBrokerMarginRisk({
      brokerId: 'freedom', debt: 10, positions: [], capital: [],
      assumptions: { ...DEFAULT_BROKER_ASSUMPTIONS, maintenanceEquityRatio: 1 }
    }).status).toBe('unavailable');
    expect(calculateBrokerMarginRisk({
      brokerId: 'freedom', debt: 1, positions: [], capital: [], assumptions: DEFAULT_BROKER_ASSUMPTIONS
    }).status).toBe('unavailable');
  });
});

describe('historical risk analytics', () => {
  const prices = Array.from({ length: 31 }, (_, index) => 100 + index);
  const history = makeHistory('AAA', prices);
  it('calculates annualized sample volatility, maximum drawdown and historical 5th-percentile loss', () => {
    const result = calculateHistoricalRisk(history);
    expect(result.status).toBe('available');
    if (result.status === 'unavailable') return;
    expect(result.value.returnObservations).toBe(30);
    expect(result.value.annualizedVolatility).toBeGreaterThan(0);
    expect(result.value.maximumDrawdown).toBe(0);
    expect(result.value.historicalDownsideLoss95).toBe(0);
  });
  it('does not report complete analytics for missing or insufficient history', () => {
    expect(calculateHistoricalRisk({ ...history, quality: 'unavailable' }).status).toBe('unavailable');
    expect(calculateHistoricalRisk(makeHistory('AAA', prices.slice(0, 10))).status).toBe('unavailable');
    expect(calculateHistoricalRisk({ ...history, quality: 'partial' }).status).toBe('provisional');
  });
  it('correlates only exact aligned observations using a shared currency', () => {
    const a = makeHistory('AAA', prices), b = makeHistory('BBB', prices.map(value => value * 2));
    const result = calculateHistoricalCorrelation(a, b);
    expect(result.status).toBe('available');
    if (result.status === 'unavailable') return;
    expect(result.value.correlation).toBeCloseTo(1);
    expect(result.value.pairedReturns).toBe(30);
    expect(calculateHistoricalCorrelation(a, { ...b, currency: 'AMD' }).status).toBe('unavailable');
    expect(calculateHistoricalCorrelation(a, makeHistory('CCC', prices.slice(0, 10))).status).toBe('unavailable');
  });
});

describe('deterministic stress scenarios', () => {
  it('calculates ticker shock impact and stressed equity without mutating the snapshot', () => {
    const snapshot = makeSnapshot(), before = JSON.stringify(snapshot);
    const result = calculateRiskStressScenario(snapshot, [{ ticker: 'AAA', priceShock: -0.2 }, { ticker: 'BBB', priceShock: 0.1 }]);
    expect(result.status).toBe('available');
    if (result.status === 'unavailable') return;
    expect(result.value.totalPnlImpact).toBe(-175);
    expect(result.value.stressedEquity).toBe(975);
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(result.value.disclaimer).toContain('not a probability estimate');
  });
  it('rejects empty, duplicate, unknown and out-of-range shocks', () => {
    const snapshot = makeSnapshot();
    expect(calculateRiskStressScenario(snapshot, []).status).toBe('unavailable');
    expect(calculateRiskStressScenario(snapshot, [{ ticker: 'AAA', priceShock: 0.1 }, { ticker: 'AAA', priceShock: 0.2 }]).status).toBe('unavailable');
    expect(calculateRiskStressScenario(snapshot, [{ ticker: 'UNKNOWN', priceShock: 0.1 }]).status).toBe('unavailable');
    expect(calculateRiskStressScenario(snapshot, [{ ticker: 'AAA', priceShock: -1.1 }]).status).toBe('unavailable');
  });
});
