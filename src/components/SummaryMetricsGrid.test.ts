import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getMarginTranchePreview, getMarginTrancheQuantity, getMarginTrancheQuantities, getUsableMarketPrice, shouldShowMarketDepthControls } from './SummaryMetricsGrid';

describe('Margin hardcode centralization', () => {
  it('uses shared margin-risk and broker-timezone constants instead of duplicate literals', () => {
    const source = readFileSync(new URL('./SummaryMetricsGrid.tsx', import.meta.url), 'utf8');

    expect(source).toContain('ACCOUNT_EQUITY_HEALTH_REFERENCE * 100');
    expect(source).not.toMatch(/40\s*-\s*Math\.min/);
    expect(source).not.toContain("'Asia/Yerevan'");
    expect(source).toContain('FREEDOM_BROKER_TIME_ZONE');
    expect(source).not.toContain('showRiskTriggers');
    expect(source).not.toContain('summaryText.startsWith');
  });

  it('localizes visible Margin risk labels and accessible text', () => {
    const source = readFileSync(new URL('./SummaryMetricsGrid.tsx', import.meta.url), 'utf8');

    expect(source).toContain("translateText('STOP-OUT BUFFER', language)");
    expect(source).toContain("translateText('Account equity percentage', language)");
    expect(source).toContain("translateText('Across {count} assets', getAppLanguage())");
    expect(source).toContain("translateText('Show {count} tranches', getAppLanguage())");
  });
});

describe('broker margin fee metric visibility', () => {
  it('removes the incorrect Open Broker Margin Fees row from combined and single-ticker views while retaining accrued interest', () => {
    const source = readFileSync(new URL('./SummaryMetricsGrid.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain("translateText('Open Broker Margin Fees'");
    expect(source).not.toContain('boardBrokerMarginFee');
    expect(source).not.toContain('totalBrokerMarginFees');
    expect(source).toContain("translateText('Accrued Margin Interest', getAppLanguage())");
    expect(source).toContain('boardMarginCharged');
  });
});

describe('broker history adapter boundary', () => {
  it('normalizes saved executions through the provider adapter', () => {
    const source = readFileSync(new URL('./SummaryMetricsGrid.tsx', import.meta.url), 'utf8');
    expect(source).toContain("import { brokerAdapterRegistry } from '../services/brokerAdapters/registry';");
    expect(source).toContain("freedomBrokerAdapter.normalizeExecutions(loadSavedHistory().brokerExecutedTrades, { source: 'cache' }).data");
    expect(source).not.toContain('normalizeFreedomTrades');
  });
});

describe('usable margin market prices', () => {
  it('accepts only finite positive prices', () => {
    expect(getUsableMarketPrice(123.45)).toBe(123.45);
    expect(getUsableMarketPrice('123.45')).toBe(123.45);
    expect(getUsableMarketPrice(0)).toBeNull();
    expect(getUsableMarketPrice(-1)).toBeNull();
    expect(getUsableMarketPrice(Number.NaN)).toBeNull();
    expect(getUsableMarketPrice(Number.POSITIVE_INFINITY)).toBeNull();
    expect(getUsableMarketPrice(null)).toBeNull();
    expect(getUsableMarketPrice(undefined)).toBeNull();
    expect(getUsableMarketPrice('')).toBeNull();
  });
});

describe('portfolio metric quote updates', () => {
  it('updates the displayed quote without remounting or animating its metric element', () => {
    const source = readFileSync(new URL('./SummaryMetricsGrid.tsx', import.meta.url), 'utf8');
    const priceMetricStart = source.indexOf('id="boardPrice"');
    const priceMetricEnd = source.indexOf('>', priceMetricStart);
    const priceMetric = source.slice(priceMetricStart, priceMetricEnd);

    expect(priceMetricStart).toBeGreaterThan(-1);
    expect(priceMetric).not.toContain('key=');
    expect(priceMetric).not.toContain('quote-flash');
    expect(source).not.toContain('previousPricesRef');
  });

  it('exposes source timestamps and provisional valuation warnings for all holdings', () => {
    const source = readFileSync(new URL('./SummaryMetricsGrid.tsx', import.meta.url), 'utf8');
    const provenance = readFileSync(new URL('./QuoteProvenance.tsx', import.meta.url), 'utf8');

    expect(source).toContain('<QuoteProvenanceList holdings={quoteProvenanceHoldings} />');
    expect(provenance).toContain('quoteDetails?.sourceTimestamp');
    expect(provenance).toContain('Observation time unavailable');
    expect(source).toContain('kind: \'Cash holding\'');
  });

  it('shows available per-ticker volume and quote metadata in both margin views', () => {
    const source = readFileSync(new URL('./SummaryMetricsGrid.tsx', import.meta.url), 'utf8');

    expect(source).toContain('Ticker market context');
    expect(source).toContain('formatQuoteVolume(position.quoteDetails?.volume)');
    expect(source).toContain('formatQuoteVolume(pos.quoteDetails?.volume)');
    expect(source).toContain('formatQuoteMetadata(position, refreshIntervalMs)');
    expect(source).toContain('Provider-reported volume; reporting period may vary by source.');
  });
});

describe('margin tranche preview', () => {
  it('hides every individual tranche by default', () => {
    expect(getMarginTranchePreview(['oldest', 'second', 'third', 'fourth'])).toEqual([]);
  });

  it('shows every tranche when expanded, without a three-lot cutoff', () => {
    const tranches = ['oldest', 'second', 'third', 'fourth', 'newest'];
    expect(getMarginTranchePreview(tranches, true)).toEqual(tranches);
  });

  it('does not mutate the stored tranche array', () => {
    const tranches = [1, 2, 3, 4];
    getMarginTranchePreview(tranches, true);
    expect(tranches).toEqual([1, 2, 3, 4]);
  });
});

describe('margin tranche quantity display', () => {
  it('uses canonical qty first and supports legacy shares and broker quantity fields', () => {
    expect(getMarginTrancheQuantity({ qty: 5, shares: 9, quantity: 12 })).toBe(5);
    expect(getMarginTrancheQuantity({ shares: 9 })).toBe(9);
    expect(getMarginTrancheQuantity({ quantity: 12 })).toBe(12);
  });

  it('falls through empty canonical placeholders to valid legacy quantity fields', () => {
    expect(getMarginTrancheQuantity({ qty: 0, shares: 5 })).toBe(5);
    expect(getMarginTrancheQuantity({ qty: '', quantity: 14 })).toBe(14);
    expect(getMarginTrancheQuantity({ qty: 'invalid', shares: 10 })).toBe(10);
  });

  it('returns null for missing, invalid, or non-positive quantities', () => {
    expect(getMarginTrancheQuantity({})).toBeNull();
    expect(getMarginTrancheQuantity({ qty: 'invalid' })).toBeNull();
    expect(getMarginTrancheQuantity({ qty: 0, shares: 0 })).toBeNull();
  });

  it('recovers a missing persisted lot quantity from one exact broker execution-log match', () => {
    const purchasedAt = Date.parse('2026-10-22T09:30:00.000Z');
    const brokerLots = [{
      id: 'GOOGL:lot-1',
      ticker: 'GOOGL',
      name: 'GOOGL',
      quantity: 10,
      marketPrice: 423,
      averagePrice: 328,
      marketValue: 4230,
      purchasedAt
    }];
    expect(getMarginTrancheQuantity({
      price: 328,
      date: '2026-10-22'
    }, brokerLots, 'GOOGL')).toBe(10);
  });

  it('does not guess when broker execution matches are ambiguous or mismatched', () => {
    const brokerLots = [{
      id: 'GOOGL:lot-1',
      ticker: 'GOOGL',
      name: 'GOOGL',
      quantity: 10,
      marketPrice: 423,
      averagePrice: 328,
      marketValue: 4230,
      purchasedAt: Date.parse('2026-10-22T09:30:00.000Z')
    }];
    expect(getMarginTrancheQuantity({ price: 328, date: '2026-10-22' }, [...brokerLots, ...brokerLots], 'GOOGL')).toBeNull();
    expect(getMarginTrancheQuantity({ price: 328, date: '2026-10-22' }, brokerLots, 'AAPL')).toBeNull();
    expect(getMarginTrancheQuantity({ price: 329, date: '2026-10-22' }, brokerLots, 'GOOGL')).toBeNull();
  });

  it('matches broker UTC timestamps against the TradeNet Armenia calendar date', () => {
    const brokerLots = [{
      id: 'GOOGL:late-utc-buy',
      ticker: 'GOOGL',
      name: 'GOOGL',
      quantity: 5,
      marketPrice: 423,
      averagePrice: 282,
      marketValue: 2115,
      // 01:00 on 29 Oct in Armenia is still 28 Oct in UTC.
      purchasedAt: Date.parse('2026-10-28T21:00:00.000Z')
    }];

    expect(getMarginTrancheQuantities([
      { price: 282, date: '2026-10-29' }
    ], brokerLots, 'GOOGL')).toEqual([5]);
  });

  it('pairs repeated GOOGL price/date rows one-to-one with matching broker open lots', () => {
    const tranches = [
      { price: 282, date: '2026-10-29' },
      { price: 282, date: '2026-10-29' },
      { price: 328, date: '2026-10-22' },
      { price: 336.3, date: '2026-10-21' },
      { price: 341.4, date: '2026-10-20' }
    ];
    const lot = (quantity: number, averagePrice: number, date: string, id: string) => ({
      id,
      ticker: 'GOOGL',
      name: 'GOOGL',
      quantity,
      marketPrice: 423,
      averagePrice,
      marketValue: quantity * 423,
      purchasedAt: Date.parse(date + 'T09:30:00.000Z')
    });
    const brokerLots = [
      lot(5, 282, '2026-10-29', 'lot-1'),
      lot(14, 282, '2026-10-29', 'lot-2'),
      lot(10, 328, '2026-10-22', 'lot-3'),
      lot(20, 336.3, '2026-10-21', 'lot-4'),
      lot(20, 341.4, '2026-10-20', 'lot-5')
    ];

    expect(getMarginTrancheQuantities(tranches, brokerLots, 'GOOGL')).toEqual([5, 14, 10, 20, 20]);
  });
});

describe('canonical margin risk integration', () => {
  it('routes combined and single-ticker dashboard risk through the same risk snapshot', () => {
    const source = readFileSync(new URL('./SummaryMetricsGrid.tsx', import.meta.url), 'utf8');
    expect(source).toContain('calculateMarginRiskSnapshot');
    expect(source).toContain('hasUnresolvedBrokerPositionIntegrity(state.brokerAccountInfo)');
    expect(source).toContain('positionIntegrityComplete');
    expect(source).toContain('longExposure: valuation.totalHoldingsValue');
    expect(source).toContain('cashBalance: valuation.cashBalance');
    expect(source).toContain('longExposure: allocatedLongExposure');
    expect(source).not.toContain('calculateMarginRiskMetrics(');
  });

  it('passes the complete risk snapshot into the overview instead of dropping source details', () => {
    const source = readFileSync(new URL('./SummaryMetricsGrid.tsx', import.meta.url), 'utf8');
    const modal = readFileSync(new URL('./MarginRiskOverviewModal.tsx', import.meta.url), 'utf8');
    expect(source).toContain('snapshot: metrics');
    expect(source).toContain('riskSnapshot={risk.snapshot}');
    expect(modal).toContain('riskSnapshot.observedAt');
    expect(modal).toContain('riskSnapshot.freshness');
    expect(modal).toContain('riskSnapshot.eligibleCollateralSource');
    expect(modal).toContain('riskSnapshot.initialMarginRequirement.source');
    expect(modal).toContain('riskSnapshot.maintenanceMarginRequirement.source');
    expect(modal).toContain("translateText('Configured maintenance threshold', language)");
    expect(modal).toContain("translateText('Configured stop-out buffer', language)");
  });

  it('keeps cash-cushion securities out of assumed cash collateral', () => {
    const source = readFileSync(new URL('./SummaryMetricsGrid.tsx', import.meta.url), 'utf8');
    expect(source).toContain("eligibleCollateralSource: 'configured-assumption'");
    expect(source).toContain('eligibleCollateral: allocatedCashBalance');
    expect(source).toContain('eligibleCollateral: valuation.cashBalance');
    expect(source).toContain('allocatedCashHoldingsValue');
  });

  it('preserves unknown margin inputs and their explicit percentage mappings without implying a complete broker buffer', () => {
    const source = readFileSync(new URL('./SummaryMetricsGrid.tsx', import.meta.url), 'utf8');
    expect(source).toContain("risk.status === 'unavailable'");
    expect(source).toContain('maintenanceState: metrics.maintenanceState');
    expect(source).toContain('stopOutState: metrics.stopOutState');
    expect(source).toContain('baseMaintenanceBufferPct: metrics.baseMaintenanceBufferPct ?? Number.NaN');
    expect(source).toContain('marginCallBufferPct: metrics.marginCallBufferPct ?? Number.NaN');
    expect(source).toContain('stopOutBufferPct: metrics.stopOutBufferPctOfLongExposure ?? Number.NaN');
  });
});

describe('Margin Intelligence risk context integration', () => {
  it('uses the canonical risk calculation and carries its provenance into the AI snapshot', () => {
    const source = readFileSync(new URL('../features/ai/marginIntelligenceContext.ts', import.meta.url), 'utf8');
    expect(source).toContain('calculateMarginRiskSnapshot');
    expect(source).toContain('hasUnresolvedBrokerPositionIntegrity(snapshot.brokerAccountInfo)');
    expect(source).toContain('positionIntegrityComplete');
    expect(source).toContain('eligibleCollateralSource: \'configured-assumption\'');
    expect(source).toContain('observedAt: marginRisk.value.observedAt');
    expect(source).toContain('freshness: marginRisk.value.freshness');
    expect(source).toContain('initialMarginRequirement: marginRisk.value.initialMarginRequirement');
    expect(source).not.toContain('calculateMarginRiskMetrics(');
  });
});


describe('market depth action session visibility', () => {
  it('keeps depth controls available during premarket, regular, and postmarket sessions', () => {
    expect(shouldShowMarketDepthControls(new Date('2026-11-02T12:00:00.000Z'))).toBe(true);
    expect(shouldShowMarketDepthControls(new Date('2026-11-02T15:00:00.000Z'))).toBe(true);
    expect(shouldShowMarketDepthControls(new Date('2026-11-02T22:00:00.000Z'))).toBe(true);
  });

  it('hides depth controls after postmarket, on weekends, and on market holidays', () => {
    expect(shouldShowMarketDepthControls(new Date('2026-11-03T02:00:00.000Z'))).toBe(false);
    expect(shouldShowMarketDepthControls(new Date('2026-11-07T15:00:00.000Z'))).toBe(false);
    expect(shouldShowMarketDepthControls(new Date('2026-11-26T15:00:00.000Z'))).toBe(false);
  });
});

describe('margin-call buffer presentation', () => {
  it('always labels the buffer as margin-call buffer and displays a percentage without bottom captions', () => {
    const source = readFileSync(new URL('./SummaryMetricsGrid.tsx', import.meta.url), 'utf8');
    expect(source).toContain("translateText('MARGIN-CALL BUFFER', language)");
    expect(source).not.toContain("'BASE MAINTENANCE BUFFER'");
    expect(source).toContain("Number.isFinite(risk.marginCallBufferPct)");
    expect(source).toContain("Number.isFinite(risk.baseMaintenanceBufferPct) ? risk.baseMaintenanceBufferPct.toFixed(1) + '%' : '—'");
    expect(source).not.toContain('formatUSD(risk.baseMaintenanceBuffer)');
    expect(source).not.toContain("translateText('Before concentration add-on', language)");
    expect(source).not.toContain('Complete maintenance buffer unavailable because the concentration add-on was not reported.');
    expect(source).not.toContain('Margin risk is provisional because some collateral or broker margin requirements are assumed or unavailable.');
    expect(source).toContain('baseMaintenanceBufferPct: metrics.baseMaintenanceBufferPct ?? Number.NaN');
  });
});


describe('accessible Margin Health overview action', () => {
  it('opens the risk overview from native, translated buttons rather than clickable sections', () => {
    const source = readFileSync(new URL('./SummaryMetricsGrid.tsx', import.meta.url), 'utf8');
    const modal = readFileSync(new URL('./MarginRiskOverviewModal.tsx', import.meta.url), 'utf8');
    expect(source).toContain('margin-risk-overview-trigger');
    expect(source.match(/class="margin-risk-overview-trigger"/g)).toHaveLength(2);
    expect(source).toContain('onClick={openOverview}');
    expect(source).toContain('aria-haspopup="dialog"');
    expect(source).toContain("translateText('Open margin risk overview', language)");
    expect(source).not.toContain('role="button"');
    expect(source).not.toContain('onKeyDown={cardKeyDown}');
    expect(modal).toContain('<ModalFrame');
    expect(modal).toContain('ariaLabelledBy="marginRiskOverviewTitle"');
    expect(modal).toContain('onEscape: requestClose');
    expect(modal).not.toContain('role="tablist"');
    expect(modal).not.toContain('MarginRiskModalTab');
  });
});
