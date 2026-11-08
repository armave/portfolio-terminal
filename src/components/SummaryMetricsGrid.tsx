import { formatRelativeTime } from '../utils/relativeTime';
import { memo } from 'preact/compat';
import { useState } from 'preact/hooks';
import type { BrokerAssumptions, QuoteDetails } from '../types/portfolio';
import { useActiveView, usePortfolio } from '../store/portfolioStore';
import { formatUSD, formatTrancheDate, formatQuoteFreshnessSummary, formatQuoteMetadata, formatQuoteVolume, formatRiskTrigger, getQuoteFreshness, summarizeQuoteFreshness } from '../utils/formatters';
import { getCashCushionTotal, getTotalPortfolioInvested } from '../domain/portfolioSelectors';
import { FREEDOM_BROKER_TIME_ZONE } from '../domain/brokerAssumptions';
import { getAppLanguage, translateText } from '../services/i18n';
import { useQuoteRefreshInterval } from '../ui/useQuoteRefreshInterval';
import {
  calculateCommission,
  calculateMarginInterest,
  resolveCommissionConfig
} from '../domain/portfolio';
import {
  calculatePortfolioValuation,
  getPortfolioValuationReliability
} from '../domain/portfolioValuation';
import { ACCOUNT_EQUITY_HEALTH_REFERENCE, calculateMarginRiskMetrics, getMarginRiskLevel } from '../domain/marginRisk';
import { getActiveTranchesFromTrades } from '../domain/freedomPortfolio';
import { loadSavedHistory } from '../services/storage';
import { brokerAdapterRegistry } from '../services/brokerAdapters/registry';
import { emitUiEvent } from '../ui/uiEventBus';
import { BoardExternalLinks } from './BoardExternalLinks';
import { QuoteProvenanceList, type QuoteProvenanceHolding } from './QuoteProvenance';

const freedomBrokerAdapter = brokerAdapterRegistry.get('freedom-tradenet');

export function getUsableMarketPrice(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function MarginRiskGaugeCard({ equityPct, risk, equityText, collateralText, rules, valuationStatus = 'current', accountBalanceAvailable = true, unpricedHoldings = 0 }: {
  equityPct: number;
  risk: ReturnType<typeof computeMarginRiskDisplay>;
  equityText: string;
  collateralText: string;
  rules: BrokerAssumptions;
  valuationStatus?: 'current' | 'provisional' | 'incomplete';
  accountBalanceAvailable?: boolean;
  unpricedHoldings?: number;
}) {
  const language = getAppLanguage();
  if (valuationStatus === 'incomplete') {
    return (
      <section class="margin-risk-gauge-card" aria-label={translateText('Margin risk estimate unavailable', language)}>
        <div class="margin-risk-gauge-heading">
          <div><span class="margin-risk-label">{translateText('ACCOUNT EQUITY HEALTH', language)}</span><strong class="margin-risk-equity">—</strong></div>
          <span class="margin-risk-status elevated">{translateText('Market valuation incomplete', language)}</span>
        </div>
        <p class="mt-2 text-xs leading-relaxed text-amber-200">
          {translateText('Margin risk estimate unavailable until the account balance and every holding can be valued.', language)}
        </p>
        {!accountBalanceAvailable && (
          <p class="mt-1 text-[10px] text-slate-300">{translateText('Account balance unavailable', language)}</p>
        )}
        {unpricedHoldings > 0 && (
          <p class="mt-1 text-[10px] text-slate-400">
            {translateText('Unpriced holdings', language)}: {unpricedHoldings}
          </p>
        )}
        <p class="mt-1 text-[10px] text-slate-400">
          {translateText('Scenario interpretation may be incomplete because the current account balance or one or more holding prices are unavailable.', language)}
        </p>
      </section>
    );
  }

  const stopOutTitle = translateText(
    'Estimate assumes the configured {threshold}% stop-out equity threshold and that the full allocated cushion qualifies as collateral. Actual broker requirements may differ.',
    language
  ).replace('{threshold}', (rules.stopOutRatio * 100).toFixed(2));
  const marginRiskTitle = translateText(
    'Estimated from portfolio equity and configured thresholds: {maintenance}% maintenance equity and {stopOut}% stop-out equity. Not a live broker risk indicator.',
    language
  )
    .replace('{maintenance}', (rules.maintenanceEquityRatio * 100).toFixed(2))
    .replace('{stopOut}', (rules.stopOutRatio * 100).toFixed(2));
  const equity = Number.isFinite(equityPct) ? equityPct : 0;
  const equityWidth = Math.max(0, Math.min(100, equity));
  const referencePercent = (ACCOUNT_EQUITY_HEALTH_REFERENCE * 100).toFixed(0);
  return (
    <section class="margin-risk-gauge-card" aria-label={translateText('Margin risk and account equity', language)} title={marginRiskTitle}>
      <div class="margin-risk-gauge-heading">
        <div><span class="margin-risk-label">{translateText('ACCOUNT EQUITY HEALTH', language)}</span><strong class="margin-risk-equity">{equityText}</strong></div>
        <span class={risk.riskLevel === 'Healthy' || risk.riskLevel === 'No margin debt' ? 'margin-risk-status healthy' : risk.riskLevel === 'Elevated' ? 'margin-risk-status elevated' : 'margin-risk-status danger'}>{risk.summaryText.split(' · ')[0]}</span>
      </div>
      <div class="margin-risk-meter" role="progressbar" aria-label={translateText('Account equity percentage', language)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={equityWidth} aria-valuetext={equityWidth.toFixed(1) + '% ' + translateText('Account equity', language)}>
        <span class="margin-risk-segment-floor" style={{ width: Math.min(100, Math.max(0, rules.maintenanceEquityRatio * 100)) + '%' }}></span><span class="margin-risk-segment-buffer" style={{ width: Math.max(0, ACCOUNT_EQUITY_HEALTH_REFERENCE * 100 - Math.min(100, Math.max(0, rules.maintenanceEquityRatio * 100))) + '%' }}></span><span class="margin-risk-segment-capacity"></span>
        <span class="margin-risk-marker" style={{ left: equityWidth + '%' }}></span>
      </div>
      <div class="margin-risk-legend"><span>{(rules.maintenanceEquityRatio * 100).toFixed(1)}% {translateText('maintenance', language)}</span><span>{translateText('{value}% reference', language).replace('{value}', referencePercent)}</span><span>{translateText('100% assets', language)}</span></div>
      <div class="margin-risk-buffer-summary">
        <div class="margin-risk-buffer-stat">
          <span class="margin-risk-label">{translateText('MARGIN-CALL BUFFER', language)}</span>
          <strong>{Number.isFinite(risk.marginCallBufferPct) ? risk.marginCallBufferPct.toFixed(1) + '%' : '—'}</strong>
          {risk.showMarginCall && <span class="margin-risk-buffer-trigger">{risk.marginCallText}</span>}
        </div>
        <div class="margin-risk-buffer-stat" title={stopOutTitle}>
          <span class="margin-risk-label">{translateText('STOP-OUT BUFFER', language)}</span>
          <strong>{Number.isFinite(risk.stopOutBufferPct) ? risk.stopOutBufferPct.toFixed(1) + '%' : '—'}</strong>
          {risk.showStopOut && <span class="margin-risk-buffer-trigger">{risk.stopOutText}</span>}
        </div>
      </div>
      <details class="margin-risk-mobile-details"><summary>{translateText('Equity and collateral details', language)}</summary><div class="margin-risk-detail"><span>{translateText('Account equity', language)}</span><strong>{equityText}</strong></div><div class="margin-risk-detail"><span>{translateText('Cash / collateral', language)}</span><strong>{collateralText}</strong></div><div class="margin-risk-disclaimer">{translateText('Estimates use configured broker thresholds and are not live broker risk indicators.', language)}</div></details>
    </section>
  );
}

function getDailyQuoteMeta(details?: QuoteDetails | null): { text: string; className: string } | null {
  if (!details || typeof details !== 'object') return null;
  const hasChange = Number.isFinite(details.change) && Number.isFinite(details.changePercent);
  const hasRange = Number.isFinite(details.high) && Number.isFinite(details.low);
  if (!hasChange && !hasRange) return null;

  const parts: string[] = [];
  let colorClass = 'text-slate-400';

  if (hasChange && details.change !== undefined && details.changePercent !== undefined) {
    const sign = details.change >= 0 ? '+' : '−';
    parts.push(
      `${sign}${formatUSD(Math.abs(details.change))} (${sign}${Math.abs(
        details.changePercent
      ).toFixed(2)}%)`
    );
    colorClass =
      details.change > 0
        ? 'text-emerald-400'
        : details.change < 0
          ? 'text-rose-400'
          : 'text-slate-400';
  }

  if (hasRange) {
    parts.push(`H ${formatUSD(details.high)} / L ${formatUSD(details.low)}`);
  }

  return {
    text: `Day: ${parts.join(' · ')}`,
    className: `mt-0.5 block text-[9px] font-normal tabular-nums ${colorClass}`
  };
}

function computeMarginRiskDisplay(
  debt: number,
  positionValue: number,
  collateral: number,
  rules: BrokerAssumptions
) {
  const language = getAppLanguage();
  if (debt <= 0) {
    return {
      riskLevel: 'No margin debt' as const,
      summaryText: translateText('No margin debt', language),
      summaryClass: 'text-emerald-400 font-bold font-mono',
      showMarginCall: false,
      marginCallText: '',
      showStopOut: false,
      stopOutText: '',
      marginCallBufferPct: 100,
      stopOutBufferPct: 100
    };
  }

  const metrics = calculateMarginRiskMetrics(debt, positionValue, collateral, rules);
  const equityRatio = metrics.equityRatio * 100;
  const maintenanceRatio = rules.maintenanceEquityRatio * 100;
  const riskLevel = getMarginRiskLevel(metrics.equityRatio, rules);
  const riskClass = riskLevel === 'Healthy'
    ? 'text-emerald-400'
    : riskLevel === 'Elevated'
      ? 'text-amber-400'
      : 'text-rose-400';
  const equitySummary = Number.isFinite(equityRatio)
    ? `${equityRatio.toFixed(1)}% ${translateText('equity', language)}`
    : translateText('negative equity', language);
  const summaryText = `${translateText(riskLevel, language)} · ${equitySummary} (${maintenanceRatio.toFixed(1)}% ${translateText('maintenance', language)})`;

  const showMarginCall = metrics.showMarginCall;
  const showStopOut = metrics.showStopOut;
  const marginCallValue = metrics.marginCallValue;
  const stopOutValue = metrics.stopOutValue;
  const marginCallBufferPct = metrics.marginCallBufferPct;
  const stopOutBufferPct = metrics.stopOutBufferPct;

  return {
    riskLevel,
    summaryText,
    summaryClass: `${riskClass} font-bold font-mono`,
    showMarginCall,
    marginCallText: marginCallValue > 0 ? formatRiskTrigger(marginCallValue, positionValue) : '',
    showStopOut,
    stopOutText: showStopOut ? formatRiskTrigger(stopOutValue, positionValue) : '',
    marginCallBufferPct,
    stopOutBufferPct
  };
}

export function getMarginTranchePreview<T>(tranches: T[], expanded = false): T[] {
  return expanded ? tranches : [];
}

function getStoredMarginTrancheQuantity(tranche: unknown): number | null {
  if (!tranche || typeof tranche !== 'object') return null;
  const value = tranche as { qty?: unknown; shares?: unknown; quantity?: unknown };
  for (const candidate of [value.qty, value.shares, value.quantity]) {
    if (candidate === null || candidate === undefined || candidate === '' || typeof candidate === 'boolean') continue;
    const quantity = Number(candidate);
    if (Number.isFinite(quantity) && quantity > 0) return quantity;
  }
  return null;
}

function getTradeNetCalendarDate(timestamp: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: FREEDOM_BROKER_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(timestamp));
  const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function getTranchePriceAndDate(tranche: unknown): { price: number; date: string } | null {
  if (!tranche || typeof tranche !== 'object') return null;
  const value = tranche as {
    price?: unknown; entryPrice?: unknown; averagePrice?: unknown;
    date?: unknown; purchaseDate?: unknown; entryDate?: unknown;
  };
  const price = Number(value.price ?? value.entryPrice ?? value.averagePrice);
  const rawDate = value.date ?? value.purchaseDate ?? value.entryDate;
  if (!Number.isFinite(price) || price <= 0 || typeof rawDate !== 'string' || !rawDate.trim()) return null;
  // Persisted tranche dates are broker-local calendar dates (TradeNet Armenia).
  // Broker execution timestamps may be UTC and cross midnight relative to that date.
  const date = rawDate.trim().match(/^(\d{4}-\d{2}-\d{2})(?![T\d])/)?.[1] ||
    (() => {
      const parsed = Date.parse(rawDate);
      if (!Number.isFinite(parsed)) return rawDate;
      return getTradeNetCalendarDate(parsed);
    })();
  return { price, date };
}

/**
 * Resolve all visible lot quantities together. This allows repeated price/date
 * rows (e.g. two separate GOOGL buys at 282.00 on 29 Oct) to be paired one-to-one
 * with their FIFO broker open lots instead of treating each repeated match as
 * ambiguous in isolation.
 */
export function getMarginTrancheQuantities(
  tranches: unknown[],
  brokerLots: ReturnType<typeof getActiveTranchesFromTrades> = [],
  ticker?: string
): Array<number | null> {
  const quantities = tranches.map(getStoredMarginTrancheQuantity);
  const missingByKey = new Map<string, number[]>();
  const lotsByKey = new Map<string, typeof brokerLots>();

  tranches.forEach((tranche, index) => {
    if (quantities[index] !== null) return;
    const match = getTranchePriceAndDate(tranche);
    if (!match) return;
    const key = `${match.price.toFixed(2)}|${match.date}`;
    missingByKey.set(key, [...(missingByKey.get(key) || []), index]);
  });

  brokerLots.forEach((lot) => {
    if (ticker && lot.ticker !== ticker.toUpperCase()) return;
    if (lot.averagePrice === null || !Number.isFinite(lot.averagePrice) || lot.averagePrice <= 0 || lot.purchasedAt === null) return;
    const key = `${Number(lot.averagePrice).toFixed(2)}|${getTradeNetCalendarDate(lot.purchasedAt)}`;
    lotsByKey.set(key, [...(lotsByKey.get(key) || []), lot]);
  });

  for (const [key, indices] of missingByKey) {
    const candidates = lotsByKey.get(key) || [];
    // Assign only a complete one-to-one group. An incomplete or excess broker
    // match remains unresolved rather than inventing a quantity.
    if (candidates.length !== indices.length) continue;
    indices.forEach((index, candidateIndex) => {
      const quantity = Number(candidates[candidateIndex].quantity);
      if (Number.isFinite(quantity) && quantity > 0) quantities[index] = quantity;
    });
  }

  return quantities;
}

/** Resolve one lot quantity when its broker match is unique. */
export function getMarginTrancheQuantity(
  tranche: unknown,
  brokerLots: ReturnType<typeof getActiveTranchesFromTrades> = [],
  ticker?: string
): number | null {
  return getMarginTrancheQuantities([tranche], brokerLots, ticker)[0] ?? null;
}


function MarginMarketTools({ ticker, isAdmin }: { ticker?: string; isAdmin: boolean }) {
  const language = getAppLanguage();
  const reviewLabel = ticker ? 'News + Review' : 'Portfolio Review';
  const reviewTitle = ticker
    ? 'Review recent news and margin-position risks with Gemini'
    : 'Review recent news and risk across all margin positions with Gemini';

  return (
    <div class="portfolio-micro-column portfolio-micro-actions" aria-label={translateText('MARKET TOOLS', language)}>
      <span class="portfolio-micro-heading">{translateText('MARKET TOOLS', language)}</span>
      <div class="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          title={translateText(reviewTitle, language)}
          aria-label={translateText(reviewLabel, language)}
          onClick={() => emitUiEvent('terminal:margin-intelligence-request', ticker ? { ticker } : {})}
          class="rounded border border-cyan-800/70 bg-slate-900/90 px-2 py-1 text-[10px] font-mono font-bold text-cyan-200 transition hover:bg-cyan-950/50"
        >
          ✦ {translateText(reviewLabel, language)}
        </button>
        {ticker && isAdmin && <button
          type="button"
          title={translateText('View live market depth for {ticker}', language).replace('{ticker}', ticker)}
          aria-label={translateText('Market Depth for {ticker}', language).replace('{ticker}', ticker)}
          onClick={() => emitUiEvent('terminal:market-depth-request', { ticker })}
          class="rounded border border-emerald-800/70 bg-slate-900/90 px-2 py-1 text-[10px] font-mono font-bold text-emerald-200 transition hover:bg-emerald-950/50"
        >
          ▤ {translateText('Depth', language)}
        </button>}
      </div>
      {ticker && (
        <div class="flex flex-wrap items-center gap-1.5" aria-label={translateText('External market research links', language)}>
          <BoardExternalLinks />
        </div>
      )}
    </div>
  );
}

function SummaryMetricsGridView({ isAdmin }: { isAdmin: boolean }) {
  const state = usePortfolio();
  const activeView = useActiveView();
  const rules = state.brokerAssumptions;
  const refreshIntervalMs = useQuoteRefreshInterval();
  const [expandedTrancheTicker, setExpandedTrancheTicker] = useState<string | null>(null);
  const dailyRate = rules.annualBorrowRate / rules.dayCountBasis;
  const tickers = Object.keys(state.positions || {});
  const isCombined =
    activeView === 'COMBINED' ||
    (tickers.length !== 1 && !state.positions?.[activeView || '']);

  if (isCombined) {
    let totalInvested = 0;
    let totalMarketValue = 0;
    let totalCommBuy = 0;
    let totalCommSell = 0;
    let totalMarginCharged = state.realizedMarginCharged || 0;
    let pricedMarginPositionCount = 0;
    let unpricedMarginPositionCount = 0;

    tickers.forEach((t) => {
      const pos = state.positions![t];
      const cost = (pos.tranches || []).reduce((sum, tr) => sum + tr.qty * tr.price, 0);
      totalInvested += cost;
      const marketPrice = getUsableMarketPrice(pos.currentPrice);
      if (pos.shares > 0 && marketPrice === null) {
        unpricedMarginPositionCount += 1;
      } else if (marketPrice !== null) {
        pricedMarginPositionCount += 1;
        totalMarketValue += pos.shares * marketPrice;
      }
      totalCommBuy += pos.commBuy;
      const valSell = pos.shares * pos.pt;
      totalCommSell += calculateCommission(pos.shares, valSell, resolveCommissionConfig(rules));
    });

    const tranchesForCombined =
      state.tranches && state.tranches.length > 0
        ? state.tranches
        : tickers.flatMap((t) => state.positions![t]?.tranches || []);
    const openMarginCharged = calculateMarginInterest(tranchesForCombined, {
      dailyRate,
      marginDebt: Math.abs(Number(state.balance) || 0),
      totalDebt: Math.abs(Number(state.balance) || 0)
    });
    totalMarginCharged += openMarginCharged;

    const totalComms = totalCommBuy + totalCommSell;
    const totalUnrealized = unpricedMarginPositionCount === 0 ? totalMarketValue - totalInvested : null;
    const unrealizedPct = totalUnrealized !== null && totalInvested > 0 ? (totalUnrealized / totalInvested) * 100 : 0;
    const totalDebt = Math.max(0, -(Number(state.balance) || 0));
    const dailyAccrual = totalDebt * dailyRate;

    const tranchesText =
      tickers.length > 0
        ? tickers
          .map((t) => `${t}: ${state.positions![t].shares}sh @ PT ${formatUSD(state.positions![t].pt)}`)
          .join(' | ')
        : translateText('None', getAppLanguage());

    const investedText = `${formatUSD(totalInvested)} | ${translateText('Across {count} assets', getAppLanguage()).replace('{count}', String(tickers.length))}`;
    const unSign = (totalUnrealized ?? 0) >= 0 ? '+' : '';
    const marginText = `-${formatUSD(totalDebt)} (${formatUSD(dailyAccrual)} ${translateText('per day', getAppLanguage())} @ ${(
      dailyRate * 100
    ).toFixed(4)}%)`;
    const commsText = `${formatUSD(totalComms)} (${formatUSD(totalCommBuy)} ${translateText('buy', getAppLanguage())} / ${formatUSD(
      totalCommSell
    )} ${translateText('sell', getAppLanguage())})`;
    const marginChargedText = `${formatUSD(totalMarginCharged)}`;

    const cushionTotal = getCashCushionTotal(state);
    const quoteSummary = summarizeQuoteFreshness(
      tickers.map((ticker) => {
        const position = state.positions![ticker];
        return getUsableMarketPrice(position.currentPrice) === null
          ? { ...position, quoteUpdatedAt: undefined, quoteSource: undefined, quoteDetails: undefined }
          : position;
      }),
      Date.now(),
      refreshIntervalMs
    );
    const quoteMetaText = quoteSummary.total > 0
      ? translateText('Margin quote coverage', getAppLanguage()) + ' · ' + formatQuoteFreshnessSummary(quoteSummary)
      : translateText('No margin positions', getAppLanguage());
    const quoteStatusLabel = translateText('Quote status', getAppLanguage()) + ': ' + quoteMetaText;
    const quoteCoverageClass = unpricedMarginPositionCount > 0 || quoteSummary.stale > 0 || quoteSummary.unknown > 0 || quoteSummary.unavailable > 0
      ? 'text-amber-300'
      : quoteSummary.delayed > 0 ? 'text-sky-300' : 'text-emerald-400';
    const quoteProvenanceHoldings: QuoteProvenanceHolding[] = [
      ...tickers.map((ticker) => ({ ...state.positions![ticker], kind: 'Margin position' as const })),
      ...(state.cashCushion?.holdings || []).map((holding) => ({ ...holding, kind: 'Cash holding' as const }))
    ];

    const valuation = calculatePortfolioValuation({
      signedAccountBalance: state.balance,
      freeCash: state.cashCushion?.freeCash,
      marginPositions: tickers.map((ticker) => state.positions![ticker]),
      cashHoldings: state.cashCushion?.holdings || []
    });
    const cashHoldingsForQuotes = (state.cashCushion?.holdings || [])
      .filter((holding) => Number(holding.shares) > 0)
      .map((holding) =>
        (getUsableMarketPrice(holding.currentPrice) ?? getUsableMarketPrice(holding.price)) === null
          ? { ...holding, quoteUpdatedAt: undefined, quoteSource: undefined, quoteDetails: undefined }
          : holding
      );
    const valuationQuoteHoldings = [
      ...tickers.map((ticker) => {
        const position = state.positions![ticker];
        return getUsableMarketPrice(position.currentPrice) === null
          ? { ...position, quoteUpdatedAt: undefined, quoteSource: undefined, quoteDetails: undefined }
          : position;
      }),
      ...cashHoldingsForQuotes
    ];
    const valuationQuoteSummary = summarizeQuoteFreshness(
      valuationQuoteHoldings,
      Date.now(),
      refreshIntervalMs
    );
    const hasCurrentBrokerUsdBalance = state.brokerAccountInfo?.loaded === true &&
      Array.isArray(state.brokerAccountInfo.balances) &&
      state.brokerAccountInfo.balances.some((balance) =>
        String(balance.currency ?? '').toUpperCase() === 'USD' &&
        balance.amount !== null && balance.amount !== undefined && Number.isFinite(Number(balance.amount))
      );
    const brokerBalanceIsStale = state.brokerAccountInfo?.status === 'stale' ||
      state.brokerAccountInfo?.quality === 'partial' ||
      (state.brokerAccountInfo?.loaded === true && !hasCurrentBrokerUsdBalance);
    const valuationStatus = getPortfolioValuationReliability({
      accountBalanceAvailable: valuation.accountBalanceAvailable,
      accountBalanceStale: brokerBalanceIsStale,
      unpricedHoldings: valuation.unpricedHoldings,
      staleQuotes: valuationQuoteSummary.stale,
      delayedQuotes: valuationQuoteSummary.delayed,
      unknownQuotes: valuationQuoteSummary.unknown,
      unavailableQuotes: valuationQuoteSummary.unavailable
    });
    const totalAccountEquity = valuation.equity;
    const totalAccountAssets = valuation.totalHoldingsValue + valuation.cashBalance;
    const equityPct = valuation.accountBalanceAvailable && totalAccountAssets > 0
      ? (totalAccountEquity / totalAccountAssets) * 100
      : Number.NaN;
    const equityText = valuation.accountBalanceAvailable
      ? formatUSD(totalAccountEquity) + ' (' + (Number.isFinite(equityPct) ? equityPct.toFixed(2) + '%' : 'N/A') + ')'
      : translateText('Account balance unavailable', getAppLanguage());

    const risk = computeMarginRiskDisplay(totalDebt, totalMarketValue, cushionTotal, rules);

    return (
      <>
        <section class="portfolio-micro-summary" aria-label={translateText('Portfolio financial summary', getAppLanguage())}>
          <div class="portfolio-micro-column portfolio-micro-basis">
            <span class="portfolio-micro-heading">{translateText('POSITION BASIS', getAppLanguage())}</span>
            <div class="portfolio-micro-row">
              <span class="portfolio-metric-label text-[10px]">{translateText('Tranches / Holdings', getAppLanguage())}</span>
              <span id="boardTranches" class="portfolio-metric-value text-xs sm:text-sm">{tranchesText}</span>
            </div>
            <div class="portfolio-micro-row">
              <span class="portfolio-metric-label text-[10px]">{translateText('Total Invested', getAppLanguage())}</span>
              <span id="boardInvested" class="portfolio-metric-value text-xs sm:text-sm">{investedText}</span>
            </div>
          </div>
          <div class="portfolio-micro-column portfolio-micro-market">
            <span class="portfolio-micro-heading">{translateText('MARKET VALUATION', getAppLanguage())}</span>
            <div class="portfolio-micro-row portfolio-micro-market-primary">
              <span class="portfolio-metric-label text-[10px]">{translateText('Market Value / Return', getAppLanguage())}</span>
              <span id="boardPrice" class="portfolio-metric-value text-xs sm:text-sm">
                {unpricedMarginPositionCount > 0 ? (
                  <>
                    {pricedMarginPositionCount > 0 ? `≥${formatUSD(totalMarketValue)} · ${translateText('Priced market value', getAppLanguage())}` : '—'}
                    <span class="block text-amber-300">
                      {translateText('Unrealized return unavailable', getAppLanguage())} ({translateText('Unpriced positions', getAppLanguage())}: {unpricedMarginPositionCount})
                    </span>
                  </>
                ) : (
                  <>
                    {formatUSD(totalMarketValue)} -{' '}
                    <span class={totalUnrealized !== null && totalUnrealized >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                      {unSign}{formatUSD(totalUnrealized ?? 0)} ({unSign}{unrealizedPct.toFixed(2)}%)
                    </span>
                  </>
                )}
              </span>
            </div>
            {tickers.length > 0 && (
              <div class="mt-2 space-y-1 border-t border-slate-800/70 pt-2" aria-label={translateText('Ticker market context', getAppLanguage())}>
                {tickers.map((ticker) => {
                  const position = state.positions![ticker];
                  const volume = formatQuoteVolume(position.quoteDetails?.volume);
                  const dailyMeta = getDailyQuoteMeta(position.quoteDetails);
                  const marketPrice = getUsableMarketPrice(position.currentPrice);
                  return (
                    <div key={ticker} class="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[10px]">
                      <span class="font-semibold text-slate-300">
                        {ticker} · {marketPrice !== null ? formatUSD(position.shares * marketPrice) : '—'}
                        {dailyMeta && <span class={`ml-1 ${dailyMeta.className}`}>{dailyMeta.text}</span>}
                      </span>
                      <span class="text-slate-500">
                        <span title={translateText('Provider-reported volume; reporting period may vary by source.', getAppLanguage())}>
                          {translateText('Volume', getAppLanguage())} {volume ?? '—'}
                        </span>
                        {' · '}{formatQuoteMetadata(position, refreshIntervalMs)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <span id="boardDailyQuote" class="block text-[10px] text-slate-500"></span>
            <span id="boardQuoteMeta" class={`portfolio-micro-quote-meta inline-flex items-center gap-1.5 text-[10px] ${quoteCoverageClass}`} aria-label={quoteStatusLabel}>
              <span class="text-slate-400"> · </span><span>{quoteMetaText}</span>
            </span>
            <QuoteProvenanceList holdings={quoteProvenanceHoldings} />
          </div>
          <div class="portfolio-micro-column portfolio-micro-costs">
            <span class="portfolio-micro-heading">{translateText('DEBT & CARRYING COSTS', getAppLanguage())}</span>
            <div class="portfolio-micro-row">
              <span class="portfolio-metric-label text-[10px]">{translateText('Margin Debt', getAppLanguage())}</span>
              <span id="boardMargin" class="portfolio-metric-value text-xs sm:text-sm text-rose-300">{marginText}</span>
            </div>
            <div class="portfolio-micro-row">
              <span class="portfolio-metric-label text-[10px]">{translateText('Total Commissions', getAppLanguage())}</span>
              <span id="boardComms" class="portfolio-metric-value text-xs sm:text-sm">{commsText}</span>
            </div>
            <div class="portfolio-micro-row">
              <span class="portfolio-metric-label text-[10px]">{translateText('Accrued Margin Interest', getAppLanguage())}</span>
              <span id="boardMarginCharged" class="portfolio-metric-value text-xs sm:text-sm">{marginChargedText}</span>
            </div>
          </div>
          <MarginMarketTools isAdmin={isAdmin} />
        </section>

        <MarginRiskGaugeCard
        equityPct={equityPct}
        risk={risk}
        equityText={equityText}
        collateralText={formatUSD(cushionTotal)}
        rules={rules}
        valuationStatus={valuationStatus}
        accountBalanceAvailable={valuation.accountBalanceAvailable}
        unpricedHoldings={valuation.unpricedHoldings}
      />
      </>
    );
  }

  // Single Ticker View
  const pos =
    (activeView ? state.positions?.[activeView] : undefined) ||
    state.positions?.[tickers[0]];
  if (!pos) return null;

  const totalInvested = (pos.tranches || []).reduce((sum, t) => sum + t.qty * t.price, 0);
  const avgPrice = pos.shares > 0 ? totalInvested / pos.shares : 0;
  const valSell = pos.shares * pos.pt;
  const commSell = calculateCommission(pos.shares, valSell, resolveCommissionConfig(rules));
  const totalComms = pos.commBuy + commSell;

  const portfolioInvested = getTotalPortfolioInvested(state);
  const weight = portfolioInvested > 0 ? totalInvested / portfolioInvested : 0;

  const totalAccountDebt = Math.max(0, -(Number(state.balance) || 0));
  const allocatedDebt = totalAccountDebt * weight;
  const totalCushion = getCashCushionTotal(state);
  const allocatedCushion = totalCushion * weight;
  const allocatedDailyAccrual = allocatedDebt * dailyRate;
  const tranches =
    pos.tranches && pos.tranches.length > 0
      ? pos.tranches
      : (state.tranches && state.tranches.length > 0 ? state.tranches : []);
  const posMarginCharged = calculateMarginInterest(tranches, {
    dailyRate,
    marginDebt: allocatedDebt,
    totalDebt: totalAccountDebt
  });

  const usableMarketPrice = getUsableMarketPrice(pos.currentPrice);
  // Keep a zero market value for conservative risk calculations when no usable
  // quote exists, but never display that fallback as a real market price or P&L.
  const currentMktVal = usableMarketPrice === null ? 0 : pos.shares * usableMarketPrice;
  const unrealized = usableMarketPrice === null ? null : currentMktVal - totalInvested;
  const unrealizedPct = usableMarketPrice !== null && avgPrice > 0 ? ((usableMarketPrice - avgPrice) / avgPrice) * 100 : null;

  const positionTranches = pos.tranches || [];
  const persistedBrokerTrades = freedomBrokerAdapter.normalizeExecutions(loadSavedHistory().brokerExecutedTrades, { source: 'cache' }).data;
  const brokerTrades = Array.isArray(state.brokerExecutedTrades) && state.brokerExecutedTrades.length
    ? state.brokerExecutedTrades
    : persistedBrokerTrades;
  const brokerOpenLots = getActiveTranchesFromTrades(
    brokerTrades,
    state.brokerAccountInfo as any,
    resolveCommissionConfig(rules),
    false
  );
  const trancheQuantities = getMarginTrancheQuantities(positionTranches, brokerOpenLots, pos.ticker);
  const tranchesExpanded = expandedTrancheTicker === pos.ticker;
  const visibleTranches = getMarginTranchePreview(positionTranches, tranchesExpanded);
  const hiddenTrancheCount = positionTranches.length;

  const investedText = `${formatUSD(totalInvested)} | ${formatUSD(avgPrice)}`;
  const unSign = (unrealized ?? 0) >= 0 ? '+' : '';
  const dailyQuoteMeta = getDailyQuoteMeta(pos.quoteDetails);

  const isFullDebt = Math.abs(allocatedDebt - totalAccountDebt) < 0.01;
  const marginText = isFullDebt
    ? `-${formatUSD(allocatedDebt)} (${formatUSD(allocatedDailyAccrual)} ${translateText('per day', getAppLanguage())})`
    : `-${formatUSD(allocatedDebt)} (${formatUSD(allocatedDailyAccrual)} ${translateText('per day', getAppLanguage())}) [${(
      (allocatedDebt / (totalAccountDebt || 1)) *
      100
    ).toFixed(0)}% of -${formatUSD(totalAccountDebt)} ${translateText('Total', getAppLanguage())}]`;

  const commsText = `${formatUSD(totalComms)} (${formatUSD(pos.commBuy)} ${translateText('buy', getAppLanguage())} / ${formatUSD(
    commSell
  )} ${translateText('sell', getAppLanguage())})`;
  const marginChargedText = `${formatUSD(posMarginCharged)} (${translateText('Position to date', getAppLanguage())})`;
  const quoteMetaText = usableMarketPrice === null
    ? translateText('Quote unavailable', getAppLanguage())
    : formatQuoteMetadata(pos, refreshIntervalMs);
  const quoteFreshness = usableMarketPrice === null
    ? 'unavailable'
    : getQuoteFreshness(pos, Date.now(), refreshIntervalMs);

  const cashUnpricedHoldingCount = (state.cashCushion?.holdings || []).filter((holding) => {
    const shares = Number(holding.shares);
    const marketPrice = getUsableMarketPrice(holding.currentPrice) ?? getUsableMarketPrice(holding.price);
    return Number.isFinite(shares) && shares > 0 && marketPrice === null;
  }).length;
  const positionUnpricedHoldingCount = (usableMarketPrice === null ? 1 : 0) + cashUnpricedHoldingCount;
  const cashHoldingsForQuotes = (state.cashCushion?.holdings || [])
    .filter((holding) => Number(holding.shares) > 0)
    .map((holding) =>
      (getUsableMarketPrice(holding.currentPrice) ?? getUsableMarketPrice(holding.price)) === null
        ? { ...holding, quoteUpdatedAt: undefined, quoteSource: undefined, quoteDetails: undefined }
        : holding
    );
  const positionQuoteHolding = usableMarketPrice === null
    ? { ...pos, quoteUpdatedAt: undefined, quoteSource: undefined, quoteDetails: undefined }
    : pos;
  const positionQuoteSummary = summarizeQuoteFreshness(
    [positionQuoteHolding, ...cashHoldingsForQuotes],
    Date.now(),
    refreshIntervalMs
  );
  const accountBalanceAvailable = state.balance !== null && state.balance !== undefined &&
    Number.isFinite(Number(state.balance));
  const hasCurrentBrokerUsdBalance = state.brokerAccountInfo?.loaded === true &&
    Array.isArray(state.brokerAccountInfo.balances) &&
    state.brokerAccountInfo.balances.some((balance) =>
      String(balance.currency ?? '').toUpperCase() === 'USD' &&
      balance.amount !== null && balance.amount !== undefined &&
      Number.isFinite(Number(balance.amount))
    );
  const brokerBalanceIsStale = state.brokerAccountInfo?.status === 'stale' ||
    (state.brokerAccountInfo?.loaded === true && !hasCurrentBrokerUsdBalance);
  const positionValuationStatus = getPortfolioValuationReliability({
    accountBalanceAvailable,
    accountBalanceStale: brokerBalanceIsStale,
    unpricedHoldings: positionUnpricedHoldingCount,
    staleQuotes: positionQuoteSummary.stale,
    delayedQuotes: positionQuoteSummary.delayed,
    unknownQuotes: positionQuoteSummary.unknown,
    unavailableQuotes: positionQuoteSummary.unavailable
  });
  const positionAssets = currentMktVal + allocatedCushion;
  const positionEquity = positionAssets - allocatedDebt;
  const equityPct = accountBalanceAvailable && positionAssets > 0
    ? (positionEquity / positionAssets) * 100
    : Number.NaN;
  const equityText = accountBalanceAvailable
    ? `${formatUSD(positionEquity)} (${Number.isFinite(equityPct) ? equityPct.toFixed(2) + "%" : "N/A"})`
    : translateText('Account balance unavailable', getAppLanguage());

  const risk = computeMarginRiskDisplay(allocatedDebt, currentMktVal, allocatedCushion, rules);

  const volume = '$' + formatQuoteVolume(pos.quoteDetails?.volume);
  return (
    <>
      <section class="portfolio-micro-summary" aria-label={translateText('Portfolio financial summary', getAppLanguage())}>
        <div class="portfolio-micro-column portfolio-micro-basis">
          <span class="portfolio-micro-heading">{translateText('POSITION BASIS', getAppLanguage())}</span>
          <div class="portfolio-micro-row">
            <span class="portfolio-metric-label text-[10px]">{translateText('Shares / Tranches', getAppLanguage())}</span>
            <div id="boardTranches" class="portfolio-metric-value text-xs sm:text-sm">
              <div class="flex flex-wrap justify-end gap-x-2 gap-y-1">
                <span class="whitespace-nowrap">{pos.shares.toLocaleString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US')} {translateText('shares', getAppLanguage())}</span>
              </div>
              {hiddenTrancheCount > 0 && (
                <>
                  <div id="boardTranchesOverflow" class={`expandable-motion ${tranchesExpanded ? 'is-expanded' : ''}`} aria-hidden={!tranchesExpanded}>
                    <div class="expandable-motion__inner">
                      <div class="mt-1 flex flex-wrap justify-end gap-x-2 gap-y-1">
                        {visibleTranches.map((tranche, index) => {
                          const quantity = trancheQuantities[index];
                          const value = tranche as typeof tranche & { entryPrice?: number; averagePrice?: number; purchaseDate?: string; entryDate?: string };
                          const price = Number(tranche.price ?? value.entryPrice ?? value.averagePrice);
                          const date = tranche.date ?? value.purchaseDate ?? value.entryDate;
                          return (
                            <span key={`${pos.ticker}-overflow-${index}`}>
                              {quantity !== null ? `${quantity.toLocaleString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US')} @ ` : ''}{formatUSD(price)} <br></br> ({formatTrancheDate(date)})
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <button type="button" class="mt-1 inline-flex items-center rounded border border-slate-700/80 px-2 py-0.5 text-[10px] font-semibold text-cyan-300 hover:border-cyan-700 hover:bg-cyan-950/40" aria-expanded={tranchesExpanded} aria-controls="boardTranchesOverflow" onClick={() => setExpandedTrancheTicker((current) => current === pos.ticker ? null : pos.ticker)}>
                    {tranchesExpanded ? translateText('Show less', getAppLanguage()) : translateText('Show {count} tranches', getAppLanguage()).replace('{count}', String(hiddenTrancheCount))}
                  </button>
                </>
              )}
            </div>
          </div>
          <div class="portfolio-micro-row">
            <span class="portfolio-metric-label text-[10px]">{translateText('Invested / Avg. Entry', getAppLanguage())}</span>
            <span id="boardInvested" class="portfolio-metric-value text-xs sm:text-sm">{investedText}</span>
          </div>
        </div>
        <div class="portfolio-micro-column portfolio-micro-market">
          <span class="portfolio-micro-heading">{translateText('MARKET VALUATION', getAppLanguage())}</span>
          <div class="portfolio-micro-row portfolio-micro-market-primary">
            <span class="portfolio-metric-label text-[10px]">{translateText('Share Price / Market Value', getAppLanguage())}</span>
            <span id="boardPrice" class="portfolio-metric-value text-xs sm:text-sm">
              {usableMarketPrice !== null ? formatUSD(usableMarketPrice) : '—'} | {usableMarketPrice !== null ? formatUSD(currentMktVal) : '—'}{' '}
              {unrealized !== null && unrealizedPct !== null ? (
                <span class={unrealized >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  {unSign}{formatUSD(unrealized)} ({unSign}{unrealizedPct.toFixed(2)}%)
                </span>
              ) : (
                <span class="text-amber-300">{translateText('Unrealized return unavailable', getAppLanguage())}</span>
              )}
            </span>
          </div>
          <span id="boardDailyQuote" class={dailyQuoteMeta?.className || 'block text-[10px] text-slate-500'}>
            {dailyQuoteMeta?.text || ''}
            <span class="text-slate-400"> · </span>
            <span id="boardQuoteMeta" class="portfolio-micro-quote-meta inline-flex items-center gap-1.5 text-[10px] text-slate-500" aria-label={translateText('Quote status', getAppLanguage()) + ': ' + translateText(quoteFreshness, getAppLanguage())}>
              <span>{quoteMetaText} {pos.quoteUpdatedAt ? ' · ' + formatRelativeTime(pos.quoteUpdatedAt) : ''}</span>
            </span>
          </span>
          <span class="mt-0.5 block text-[10px] text-slate-500" title={translateText('Provider-reported volume; reporting period may vary by source.', getAppLanguage())}>
            {translateText('Volume', getAppLanguage())} {volume ?? '—'}
          </span>
          <QuoteProvenanceList holdings={[
            { ...pos, kind: 'Margin position' },
            ...(state.cashCushion?.holdings || []).map((holding) => ({ ...holding, kind: 'Cash holding' as const }))
          ]} />
        </div>
        <div class="portfolio-micro-column portfolio-micro-costs">
          <span class="portfolio-micro-heading">{translateText('DEBT & CARRYING COSTS', getAppLanguage())}</span>
          <div class="portfolio-micro-row">
            <span class="portfolio-metric-label text-[10px]">{translateText('Margin Debt', getAppLanguage())}</span>
            <span id="boardMargin" class="portfolio-metric-value text-xs sm:text-sm text-rose-300">{marginText}</span>
          </div>
          <div class="portfolio-micro-row">
            <span class="portfolio-metric-label text-[10px]">{translateText('Total Commissions', getAppLanguage())}</span>
            <span id="boardComms" class="portfolio-metric-value text-xs sm:text-sm">{commsText}</span>
          </div>
          <div class="portfolio-micro-row">
            <span class="portfolio-metric-label text-[10px]">{translateText('Accrued Margin Interest', getAppLanguage())}</span>
            <span id="boardMarginCharged" class="portfolio-metric-value text-xs sm:text-sm">{marginChargedText}</span>
          </div>
        </div>
        <MarginMarketTools ticker={pos.ticker} isAdmin={isAdmin} />
      </section>

      <MarginRiskGaugeCard
        equityPct={equityPct}
        risk={risk}
        equityText={equityText}
        collateralText={formatUSD(allocatedCushion)}
        rules={rules}
        valuationStatus={positionValuationStatus}
        accountBalanceAvailable={accountBalanceAvailable}
        unpricedHoldings={positionUnpricedHoldingCount}
      />
    </>
  );
}

export const SummaryMetricsGrid = memo(SummaryMetricsGridView);
