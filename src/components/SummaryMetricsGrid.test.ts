import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getHeaderBreakevenValue, getMarginTrancheQuantity, getMarginTrancheQuantities, getUsableMarketPrice, shouldShowMarketDepthControls } from './SummaryMetricsGrid';

describe('Margin risk confidence and scope disclosures', () => {
  it('keeps provisional risk styling while avoiding redundant status and period labels', () => {
    const source = readFileSync(new URL('./SummaryMetricsGrid.tsx', import.meta.url), 'utf8');
    expect(source).toContain("const isProvisionalEstimate = risk.status === 'provisional' || valuationStatus === 'provisional';");
    expect(source).not.toContain("translateText('Provisional estimate', language)");
    expect(source).not.toContain("translateText('Position to date', getAppLanguage())");
    expect(source).toContain("const marginChargedText = formatUSD(posMarginCharged);");
    expect(source).toContain('scope="account"');
    expect(source).toContain('scope="allocated-ticker"');
    expect(source).not.toContain('margin-risk-scope-note');
    expect(source).toContain("risk.summaryText.split(' · ')[0]");
  });

  it('connects the overview to explicit dollar buffers and bounded stress sensitivity', () => {
    const modal = readFileSync(new URL('./MarginRiskOverviewModal.tsx', import.meta.url), 'utf8');
    expect(modal).toContain('riskSnapshot.baseMaintenanceBuffer');
    expect(modal).toContain('riskSnapshot.maintenanceBuffer');
    expect(modal).toContain('riskSnapshot.stopOutBuffer');
    expect(modal).toContain('calculateMarginRiskStressScenarios(riskSnapshot, assumptions)');
    expect(modal).toContain("translateText('Price shock sensitivity', language)");
    expect(modal).toContain('broker call price or liquidation forecast');
    expect(modal).toContain("riskLabel === 'Stop-out level' || riskLabel === 'Margin-call level'");
  });
});

describe('Margin hardcode centralization', () => {
  it('uses shared margin-risk and broker-timezone constants instead of duplicate literals', () => {
    const source = readFileSync(new URL('./SummaryMetricsGrid.tsx', import.meta.url), 'utf8');

    expect(source).toContain('referenceRatio * 100');
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
    expect(source).toContain("translateText('View {count} tranches', getAppLanguage())");
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

  it('keeps quote freshness compact without the expandable source and timestamp disclosure', () => {
    const source = readFileSync(new URL('./SummaryMetricsGrid.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('QuoteProvenanceList');
    expect(source).not.toContain('Quote sources and observation times');
    expect(source).toContain('formatQuoteFreshnessSummary(quoteSummary)');
    expect(source).toContain('quoteMetaText');
  });

  it('shows available per-ticker volume and quote metadata in both margin views', () => {
    const source = readFileSync(new URL('./SummaryMetricsGrid.tsx', import.meta.url), 'utf8');

    expect(source).toContain('Ticker market context');
    expect(source).toContain('<QuoteVolumeBadge volumeValue={position.quoteDetails?.volumeValue} currency={position.quoteDetails?.currency} lastTradeTime={position.quoteDetails?.lastTradeTime} serverTime={position.quoteDetails?.serverTime} isAdmin={isAdmin} />');
    expect(source).toContain('<QuoteVolumeBadge volumeValue={pos.quoteDetails?.volumeValue} currency={pos.quoteDetails?.currency} lastTradeTime={pos.quoteDetails?.lastTradeTime} serverTime={pos.quoteDetails?.serverTime} isAdmin={isAdmin} />');
    expect(source).not.toContain('formatQuoteVolume');
    expect(source).toContain('formatQuoteMetadata(position, refreshIntervalMs)');
    expect(source).toContain('id="boardDailyQuote" class="mt-0.5 flex flex-wrap items-center justify-end gap-1.5 text-[10px]"');
  });
});

describe('shared data-quality notice integration', () => {
  it('routes aggregate valuation quality through the reusable notice without changing the quality decision', () => {
    const source = readFileSync(new URL('./SummaryMetricsGrid.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<DataQualityNotice');
    expect(source).toContain('status={dataQualityStatus}');
    expect(source).toContain("const dataQualityStatus = valuationStatus === 'incomplete'");
    expect(source).toContain("risk.status === 'unavailable'");
    expect(source).toContain('Missing or stale inputs are not treated as zero.');
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

describe('daily quote context localization', () => {
  it('localizes the day, high and low labels in margin quote context', () => {
    const source = readFileSync(new URL('./SummaryMetricsGrid.tsx', import.meta.url), 'utf8');
    expect(source).toContain("translateText('Day:', getAppLanguage())");
    expect(source).toContain("translateText('High', getAppLanguage())");
    expect(source).toContain("translateText('Low', getAppLanguage())");
    expect(source).not.toContain('text: `Day:');
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


describe('header carry-break-even formatting', () => {
  it('removes only the legacy internal prefix while preserving status and date text', () => {
    expect(getHeaderBreakevenValue('Post-sale floor: 94 days (Feb 20, 2027)')).toBe('94 days (Feb 20, 2027)');
    expect(getHeaderBreakevenValue('Post-sale floor: Already below floor')).toBe('Already below floor');
    expect(getHeaderBreakevenValue('Post-sale floor: —')).toBe('—');
    expect(getHeaderBreakevenValue('')).toBe('—');
  });
});

describe('cross-device financial header hierarchy', () => {
  const source = readFileSync(new URL('./SummaryMetricsGrid.tsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');

  it('keeps decision KPIs and stacks the compact financial summary above Account Equity Health', () => {
    expect(source).toContain('data-header-metric={metric}');
    const combinedView = source.slice(source.indexOf('if (isCombined)'), source.indexOf('// Single Ticker View'));
    const headline = combinedView.slice(combinedView.indexOf('class="portfolio-header-kpis'), combinedView.indexOf('</section>'));
    expect(headline).toContain('metric="account-equity"');
    expect(headline).toContain('metric="margin-market-value"');
    expect(headline).toContain('metric="gross-unrealized-pnl"');
    expect(headline).toContain('metric="margin-debt"');
    expect(headline).toContain('metric="margin-risk"');
    expect(headline).not.toContain('metric="net-target-return"');
    expect(headline).not.toContain('metric="carry-break-even"');
    expect(combinedView).toContain('class="portfolio-scenario-outlook"');
    expect(combinedView).toContain('metric="net-target-return"');
    expect(combinedView).toContain('metric="carry-break-even"');
    expect(combinedView.indexOf('class="portfolio-header-kpis"')).toBeLessThan(
      combinedView.indexOf('class="portfolio-risk-tools-row"')
    );
    const healthColumn = combinedView.slice(
      combinedView.indexOf('class="portfolio-health-summary-column"'),
      combinedView.indexOf('<div class="portfolio-market-tools-row">')
    );
    expect(healthColumn.indexOf('class="portfolio-micro-summary"')).toBeLessThan(
      healthColumn.indexOf('<MarginRiskGaugeCard')
    );
    expect(healthColumn).toContain(`role="group" aria-label={translateText('POSITION BASIS', getAppLanguage())}`);
    expect(healthColumn).toContain(`role="group" aria-label={translateText('MARKET VALUATION', getAppLanguage())}`);
    expect(healthColumn).toContain(`role="group" aria-label={translateText('Fees & accrued interest', getAppLanguage())}`);
    const combinedTranchesPanel = healthColumn.slice(
      healthColumn.indexOf('class="portfolio-micro-column portfolio-micro-basis"'),
      healthColumn.indexOf('<MarginRiskGaugeCard')
    );
    expect(combinedTranchesPanel).toContain('class="portfolio-micro-costs"');
    expect(combinedTranchesPanel).toContain('id="boardComms"');
    expect(combinedTranchesPanel).toContain('id="boardMarginCharged"');
    expect(healthColumn).not.toContain('class="portfolio-micro-column portfolio-micro-costs"');
    expect(styles).toContain('.portfolio-health-summary-column .portfolio-micro-column {');
    expect(styles).toContain('.portfolio-health-summary-column .portfolio-micro-row .portfolio-metric-value {');
    expect(source).not.toContain('class="portfolio-micro-heading"');
    expect(source).toContain('id={valueId}');
    expect(combinedView).toContain('valueId="boardNetTargetReturn"');
    expect(combinedView).toContain('valueId="daysToBreakeven"');
    expect(combinedView).toContain('valueId="boardMargin"');
  });

  it('keeps ticker PT in its title and stacks compact financial details above ticker equity health', () => {
    const singleTickerView = source.slice(source.indexOf('// Single Ticker View'));
    expect(source).toContain("translateText('Shares / Your PT', getAppLanguage())");
    expect(singleTickerView).toContain('metric="carry-break-even"');
    expect(singleTickerView).toContain('metric="allocated-equity"');
    expect(singleTickerView).toContain('metric="margin-debt"');
    expect(singleTickerView).toContain('metric="margin-risk"');
    expect(singleTickerView).not.toContain('metric="net-target-return"');
    expect(singleTickerView).not.toContain('id="boardNetTargetReturn"');
    expect(singleTickerView).not.toContain('Your PT / Net return at target');
    expect(singleTickerView).not.toContain('calculatePositionMetrics');
    const healthColumn = singleTickerView.slice(
      singleTickerView.indexOf('class="portfolio-health-summary-column"'),
      singleTickerView.indexOf('<div class="portfolio-market-tools-row">')
    );
    expect(healthColumn.indexOf('class="portfolio-micro-summary"')).toBeLessThan(
      healthColumn.indexOf('<MarginRiskGaugeCard')
    );
    expect(healthColumn).toContain(`role="group" aria-label={translateText('MARKET VALUATION', getAppLanguage())}`);
    const tickerTranchesPanel = healthColumn.slice(
      healthColumn.indexOf('class="portfolio-micro-column portfolio-micro-basis"'),
      healthColumn.indexOf('<MarginRiskGaugeCard')
    );
    expect(tickerTranchesPanel).toContain('class="portfolio-micro-costs"');
    expect(tickerTranchesPanel).toContain('id="boardComms"');
    expect(tickerTranchesPanel).toContain('id="boardMarginCharged"');
    expect(healthColumn).not.toContain('class="portfolio-micro-column portfolio-micro-costs"');
  });

  it('keeps the financial summary and Account Equity Health in the first column beside Market Tools', () => {
    expect(source).toContain('<div class="portfolio-risk-tools-row">');
    expect(source).toContain('<div class="portfolio-health-summary-column">');
    expect(source).toContain('<MarginRiskGaugeCard');
    expect(source).toContain('<MarginMarketTools');
    expect(styles).toContain('.portfolio-health-summary-column {');
    expect(styles.replaceAll(' ', '').replaceAll(String.fromCharCode(10), '')).toContain('.portfolio-health-summary-column>.margin-risk-gauge-card{');
    expect(styles.replaceAll(' ', '').replaceAll(String.fromCharCode(10), '')).toContain('.portfolio-risk-tools-row>.portfolio-market-tools-row');
    expect(styles).toContain('@media (min-width: 768px)');
    expect(styles).toContain('grid-template-columns: minmax(0, 1.2fr) minmax(18rem, 0.95fr)');
    expect(styles).toContain('@media (max-width: 767px)');
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr)');
  });

  it('groups Market Tools into two-up scenario and intelligence sections', () => {
    const toolsStart = source.indexOf('function MarginMarketTools');
    const toolsEnd = source.indexOf('function SummaryMetricsGridView', toolsStart);
    const toolsComponent = source.slice(toolsStart, toolsEnd);
    expect(toolsComponent).toContain('Portfolio actions');
    expect(toolsComponent).toContain("translateText('MARKET TOOLS', language)");
    expect(toolsComponent).toContain('market-tools-section--scenario');
    expect(toolsComponent).toContain('market-tools-section--intelligence');
    expect(toolsComponent).toContain('market-tools-section--single-action');
    expect(toolsComponent).toContain("translateText('SCENARIO PLANNING', language)");
    expect(toolsComponent).toContain("translateText('MARKET INTELLIGENCE', language)");
    expect(toolsComponent).toContain("translateText('Simulate Buy', language)");
    expect(toolsComponent).toContain("translateText('Compare Exits', language)");
    expect(toolsComponent).toContain("const reviewLabel = ticker ? 'AI Risk Review' : 'AI Portfolio Review';");
    expect(toolsComponent).toContain("translateText('Live Order Book', language)");
    expect(toolsComponent).toContain('market-tools-external');
    expect(styles).toContain('.market-tools-section--scenario .market-tools-grid');
    expect(styles).toContain('.market-tools-section--intelligence:not(.market-tools-section--single-action) .market-tools-grid');
    expect(styles).toContain('.market-tool-card:focus-visible {');
    expect(styles).toContain('.market-tools-section--portfolio .market-tools-grid {');
    expect(styles).toContain('@media (max-width: 767px)');
  });

  it('keeps External Research at the bottom of Market Tools, not in the health column', () => {
    const singleTickerView = source.slice(source.indexOf('// Single Ticker View'));
    const healthColumn = singleTickerView.slice(
      singleTickerView.indexOf('class="portfolio-health-summary-column"'),
      singleTickerView.indexOf('<div class="portfolio-market-tools-row">')
    );
    const toolsComponent = source.slice(
      source.indexOf('function MarginMarketTools'),
      source.indexOf('function SummaryMetricsGridView')
    );
    expect(toolsComponent.indexOf("translateText('MARKET INTELLIGENCE', language)")).toBeGreaterThan(-1);
    expect(toolsComponent.indexOf('market-tools-external')).toBeGreaterThan(
      toolsComponent.indexOf("translateText('MARKET INTELLIGENCE', language)")
    );
    expect(toolsComponent).toContain("translateText('EXTERNAL RESEARCH', language)");
    expect(toolsComponent).toContain('<BoardExternalLinks />');
    expect(healthColumn).not.toContain('market-tools-external');
  });

  it('aligns the ticker Tranches control and prevents narrow-column overflow', () => {
    const singleTickerView = source.slice(source.indexOf('// Single Ticker View'));
    expect(singleTickerView).toContain('id="boardTranches" class="portfolio-metric-value portfolio-tranches-value');
    expect(styles.replaceAll(' ', '').replaceAll(String.fromCharCode(10), '')).toContain('.portfolio-micro-basis>.portfolio-micro-row{');
    expect(styles).toContain('.portfolio-micro-basis .portfolio-tranches-value {');
    expect(styles).toContain('align-items: flex-end;');
    expect(styles).toContain('align-items: center;');
    expect(styles).toMatch(/\.portfolio-micro-basis\s*\.portfolio-tranches-value\s*>button\s*\{[^}]*max-width:\s*100%;[^}]*min-width:\s*0;[^}]*white-space:\s*normal;/s);
    expect(styles).toMatch(/\.portfolio-micro-tranches-row\s*>\s*#boardTranches\s*>\s*\.tranche-details-trigger\s*\{[^}]*flex:\s*0\s+1\s+auto;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;[^}]*white-space:\s*normal;/s);
    expect(styles).toMatch(/\.portfolio-micro-basis\s*\.tranche-details-trigger\s*>\s*span:first-child\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
    expect(styles).toMatch(/\.portfolio-micro-basis\s*\.tranche-details-trigger\s*>\s*\.tranche-details-trigger-icon\s*\{[^}]*flex:\s*0\s+0\s+auto;/s);
  });


  it('keeps the Combined view summary as text and provides a ticker-only Tranches action', () => {
    const combinedView = source.slice(source.indexOf('if (isCombined)'), source.indexOf('// Single Ticker View'));
    const singleTickerView = source.slice(source.indexOf('// Single Ticker View'));
    expect(combinedView).toContain('{tranchesText}');
    expect(combinedView).not.toContain('data-tranche-details-trigger');
    expect(singleTickerView).toContain('data-tranche-details-trigger');
    expect(singleTickerView).toContain('aria-haspopup="dialog"');
    expect(singleTickerView).toContain('onClick={() => setTrancheModalOpen(true)}');
  });

  it('opens all ticker purchase lots in the lazy tranche details dialog instead of expanding inline', () => {
    const singleTickerView = source.slice(source.indexOf('// Single Ticker View'));
    expect(singleTickerView).toContain('data-tranche-details-trigger');
    expect(singleTickerView).toContain('aria-haspopup="dialog"');
    expect(singleTickerView).toContain('<TrancheDetailsModal');
    expect(singleTickerView).not.toContain('boardTranchesOverflow');
    expect(singleTickerView).not.toContain('expandedTrancheTicker');
  });

describe('Combined Margin data quality and position comparison', () => {
  it('shows input quality and adds a separate position comparison surface', () => {
    const source = readFileSync(new URL('./SummaryMetricsGrid.tsx', import.meta.url), 'utf8');
    expect(source).toContain('class="portfolio-data-quality-summary"');
    expect(source).toContain('data-valuation-quality={dataQualityLabel}');
    expect(source).toContain('marginQuoteIssueTickers.map');
    expect(source).toContain("view: 'BALANCE'");
    expect(source).toContain("translateText('Missing or stale inputs are not treated as zero.'");
    expect(source).toContain('<CombinedPositionsTable');
    const positionsSource = readFileSync(new URL('./CombinedPositionsTable.tsx', import.meta.url), 'utf8');
    expect(positionsSource).toContain('getMarginPositionMarketSummaries(positions)');
  });
});

});
