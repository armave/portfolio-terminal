import { formatRelativeTime } from '../utils/relativeTime';
import { useRef, useState } from 'preact/hooks';
import type { BrokerRules, QuoteDetails } from '../types/portfolio';
import { usePortfolio } from '../store/portfolioStore';
import { formatUSD, formatTrancheDate, formatQuoteMetadata, formatRiskTrigger, getQuoteFreshness } from '../utils/formatters';
import { getCashCushionTotal, getTotalPortfolioInvested } from '../domain/portfolioSelectors';
import { getAppLanguage } from '../services/i18n';
import { useQuoteRefreshInterval } from '../ui/useQuoteRefreshInterval';
import {
  calculateCommission,
  calculateMarginInterest,
  resolveCommissionConfig
} from '../domain/portfolio';
import { calculatePortfolioValuation } from '../domain/portfolioValuation';
import { getActiveTranchesFromTrades } from '../domain/freedomPortfolio';
import { loadSavedHistory } from '../services/storage';

function MarginRiskGaugeCard({ equityPct, risk, equityText, collateralText, rules }: { equityPct: number; risk: ReturnType<typeof computeMarginRiskDisplay>; equityText: string; collateralText: string; rules: BrokerRules }) {
  const stopOutTitle = `Estimate assumes the configured ${(rules.stopOutRatio * 100).toFixed(2)}% stop-out equity threshold and that the full allocated cushion qualifies as collateral. Actual broker requirements may differ.`;
  const marginRiskTitle = `Estimated from portfolio equity and configured thresholds: ${(rules.maintenanceMarginRatio * 100).toFixed(2)}% maintenance equity and ${(rules.stopOutRatio * 100).toFixed(2)}% stop-out equity. Not a live broker risk indicator.`;
  const equity = Number.isFinite(equityPct) ? equityPct : 0;
  const equityWidth = Math.max(0, Math.min(100, equity));
  const buffer = Number.isFinite(risk.marginCallBufferPct) ? Math.max(0, Math.min(100, risk.marginCallBufferPct)) : 0;
  const stopOutBuffer = Number.isFinite(risk.stopOutBufferPct) ? Math.max(0, Math.min(100, risk.stopOutBufferPct)) : 0;
  return (
    <section class="margin-risk-gauge-card" aria-label="Margin risk and account equity" title={marginRiskTitle}>
      <div class="margin-risk-gauge-heading">
        <div><span class="margin-risk-label">ACCOUNT EQUITY HEALTH</span><strong class="margin-risk-equity">{equityText}</strong></div>
        <span class={risk.summaryText.startsWith('Healthy') || risk.summaryText.startsWith('No margin debt') ? 'margin-risk-status healthy' : risk.summaryText.startsWith('Elevated') ? 'margin-risk-status elevated' : 'margin-risk-status danger'}>{risk.summaryText.split(' · ')[0]}</span>
      </div>
      <div class="margin-risk-meter" role="progressbar" aria-label="Account equity percentage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={equityWidth}>
        <span class="margin-risk-segment-floor" style={{ width: Math.min(100, Math.max(0, rules.maintenanceMarginRatio * 100)) + '%' }}></span><span class="margin-risk-segment-buffer" style={{ width: Math.max(0, 40 - Math.min(100, Math.max(0, rules.maintenanceMarginRatio * 100))) + '%' }}></span><span class="margin-risk-segment-capacity"></span>
        <span class="margin-risk-marker" style={{ left: equityWidth + '%' }}></span>
      </div>
      <div class="margin-risk-legend"><span>{(rules.maintenanceMarginRatio * 100).toFixed(1)}% maintenance</span><span>40% reference</span><span>100% assets</span></div>
      <div class="margin-risk-gauge-grid">
        <div class="margin-risk-gauge-item">
          <div class="margin-risk-gauge-row"><span class="margin-risk-label">MARGIN-CALL BUFFER</span><strong>{Number.isFinite(risk.marginCallBufferPct) ? risk.marginCallBufferPct.toFixed(1) + '%' : '—'}</strong></div>
          <div class="margin-risk-buffer-track" role="progressbar" aria-label="Margin-call buffer" aria-valuemin={0} aria-valuemax={100} aria-valuenow={buffer}><span class={buffer < 30 ? 'danger' : 'warning'} style={{ width: buffer + '%' }}></span></div>
          <div class="margin-risk-detail"><span>Trigger estimate</span><strong>{risk.showMarginCall ? risk.marginCallText : 'Below trigger estimate'}</strong></div>
        </div>
        <div class="margin-risk-gauge-item">
          <div class="margin-risk-gauge-row" title={stopOutTitle}><span class="margin-risk-label">STOP-OUT THRESHOLD</span><strong>{Number.isFinite(risk.stopOutBufferPct) ? risk.stopOutBufferPct.toFixed(1) + '% buffer' : '—'}</strong></div>
          <div class="margin-risk-buffer-track"><span class={stopOutBuffer < 30 ? 'danger' : 'safe'} style={{ width: stopOutBuffer + '%' }}></span></div>
          <div class="margin-risk-detail"><span>Trigger estimate</span><strong>{risk.showStopOut ? risk.stopOutText : '—'}</strong></div>
        </div>
      </div>
      <details class="margin-risk-mobile-details"><summary>Equity and collateral details</summary><div class="margin-risk-detail"><span>Account equity</span><strong>{equityText}</strong></div><div class="margin-risk-detail"><span>Cash / collateral</span><strong>{collateralText}</strong></div><div class="margin-risk-disclaimer">Estimates use configured broker thresholds and are not live broker risk indicators.</div></details>
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
  rules: BrokerRules
) {
  if (debt <= 0) {
    return {
      summaryText: 'No margin debt',
      summaryClass: 'text-emerald-400 font-bold font-mono',
      showMarginCall: false,
      marginCallText: '',
      showStopOut: false,
      stopOutText: '',
      showRiskTriggers: false,
      marginCallBufferPct: 100,
      stopOutBufferPct: 100
    };
  }

  const assets = positionValue + collateral;
  const equity = assets - debt;
  const equityRatio = assets > 0 ? (equity / assets) * 100 : -Infinity;
  const maintenanceRatio = rules.maintenanceMarginRatio * 100;
  const stopOutRatio = rules.stopOutRatio * 100;

  let riskLevel = 'Healthy';
  let riskClass = 'text-emerald-400';

  if (equityRatio <= stopOutRatio) {
    riskLevel = 'Stop-out level';
    riskClass = 'text-rose-400';
  } else if (equityRatio <= maintenanceRatio) {
    riskLevel = 'Margin-call level';
    riskClass = 'text-rose-400';
  } else if (equityRatio <= maintenanceRatio + 5) {
    riskLevel = 'Elevated';
    riskClass = 'text-amber-400';
  }

  const summaryText = `${riskLevel} · ${Number.isFinite(equityRatio) ? `${equityRatio.toFixed(1)}% equity` : 'negative equity'
    } (${maintenanceRatio.toFixed(1)}% maintenance)`;

  const marginCallAssetsRequired = debt / (1 - rules.maintenanceMarginRatio);
  const stopOutAssetsRequired = debt / (1 - rules.stopOutRatio);

  const showMarginCall = collateral < marginCallAssetsRequired;
  const showStopOut = collateral < stopOutAssetsRequired;

  const marginCallValue = Math.max(0, marginCallAssetsRequired - collateral);
  const stopOutValue = Math.max(0, stopOutAssetsRequired - collateral);
  // Match formatRiskTrigger's buffer definition: remaining position value after
  // the estimated trigger amount, expressed as a percentage of current value.
  const marginCallBufferPct =
    positionValue > 0 ? ((positionValue - marginCallValue) / positionValue) * 100 : -Infinity;
  const stopOutBufferPct =
    positionValue > 0 ? ((positionValue - stopOutValue) / positionValue) * 100 : -Infinity;
  const showRiskTriggers = showMarginCall && marginCallBufferPct < 60;

  return {
    summaryText,
    summaryClass: `${riskClass} font-bold font-mono`,
    showMarginCall,
    marginCallText: marginCallValue > 0 ? formatRiskTrigger(marginCallValue, positionValue) : '',
    showStopOut,
    stopOutText: showStopOut ? formatRiskTrigger(stopOutValue, positionValue) : '',
    showRiskTriggers,
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
    timeZone: 'Asia/Yerevan',
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

export function SummaryMetricsGrid() {
  const state = usePortfolio();
  const rules = state.brokerAssumptions;
  const refreshIntervalMs = useQuoteRefreshInterval();
  const previousPricesRef = useRef<Record<string, number>>({});
  const [expandedTrancheTicker, setExpandedTrancheTicker] = useState<string | null>(null);
  const dailyRate = rules.annualRate / rules.dayCountBasis;
  const tickers = Object.keys(state.positions || {});
  const isCombined =
    state.activeView === 'COMBINED' ||
    (tickers.length !== 1 && !state.positions?.[state.activeView || '']);

  if (isCombined) {
    let totalInvested = 0;
    let totalMarketValue = 0;
    let totalCommBuy = 0;
    let totalCommSell = 0;
    let totalMarginCharged = state.realizedMarginCharged || 0;

    tickers.forEach((t) => {
      const pos = state.positions![t];
      const cost = (pos.tranches || []).reduce((sum, tr) => sum + tr.qty * tr.price, 0);
      totalInvested += cost;
      totalMarketValue += pos.shares * pos.currentPrice;
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
    const totalUnrealized = totalMarketValue - totalInvested;
    const unrealizedPct = totalInvested > 0 ? (totalUnrealized / totalInvested) * 100 : 0;
    const totalDebt = Math.max(0, -(Number(state.balance) || 0));
    const dailyAccrual = totalDebt * dailyRate;

    const tranchesText =
      tickers.length > 0
        ? tickers
          .map((t) => `${t}: ${state.positions![t].shares}sh @ PT ${formatUSD(state.positions![t].pt)}`)
          .join(' | ')
        : 'None';

    const investedText = `${formatUSD(totalInvested)} | Across ${tickers.length} Assets`;
    const unSign = totalUnrealized >= 0 ? '+' : '';
    const marginText = `-${formatUSD(totalDebt)} (${formatUSD(dailyAccrual)}/day @ ${(
      dailyRate * 100
    ).toFixed(4)}%)`;
    const commsText = `${formatUSD(totalComms)} (${formatUSD(totalCommBuy)} buy / ${formatUSD(
      totalCommSell
    )} sell)`;
    const marginChargedText = `${formatUSD(totalMarginCharged)}`;

    const cushionTotal = getCashCushionTotal(state);
    const quotes = tickers
      .map((ticker) => state.positions![ticker])
      .filter((position) => position.quoteUpdatedAt);
    const latestQuote = quotes.sort(
      (a, b) => (b.quoteUpdatedAt || 0) - (a.quoteUpdatedAt || 0)
    )[0];
    const quoteMetaText = latestQuote
      ? `Latest portfolio quote · ${formatQuoteMetadata(latestQuote, refreshIntervalMs)}`
      : 'No live quotes fetched for margin positions';
    const quoteFreshness = latestQuote
      ? getQuoteFreshness(latestQuote, Date.now(), refreshIntervalMs)
      : 'unavailable';

    const valuation = calculatePortfolioValuation({
      signedAccountBalance: state.balance,
      freeCash: state.cashCushion?.freeCash,
      marginPositions: tickers.map((ticker) => state.positions![ticker]),
      cashHoldings: state.cashCushion?.holdings || []
    });
    const totalAccountEquity = valuation.equity;
    const totalAccountAssets = valuation.totalHoldingsValue + valuation.cashBalance;
    const equityPct = totalAccountAssets > 0 ? (totalAccountEquity / totalAccountAssets) * 100 : Number.NaN;
    const equityText = `${formatUSD(totalAccountEquity)} (${Number.isFinite(equityPct) ? equityPct.toFixed(2) + "%" : "N/A"})`;

    const risk = computeMarginRiskDisplay(totalDebt, totalMarketValue, cushionTotal, rules);

    return (
      <>
        <section class="portfolio-micro-summary" aria-label="Portfolio financial summary">
          <div class="portfolio-micro-column portfolio-micro-basis">
            <span class="portfolio-micro-heading">POSITION BASIS</span>
            <div class="portfolio-micro-row">
              <span class="portfolio-metric-label text-[10px]">Tranches / Holdings</span>
              <span id="boardTranches" class="portfolio-metric-value text-xs sm:text-sm">{tranchesText}</span>
            </div>
            <div class="portfolio-micro-row">
              <span class="portfolio-metric-label text-[10px]">Total Invested</span>
              <span id="boardInvested" class="portfolio-metric-value text-xs sm:text-sm">{investedText}</span>
            </div>
          </div>
          <div class="portfolio-micro-column portfolio-micro-market">
            <span class="portfolio-micro-heading">MARKET VALUATION</span>
            <div class="portfolio-micro-row portfolio-micro-market-primary">
              <span class="portfolio-metric-label text-[10px]">Market Value / Return</span>
              <span id="boardPrice" class="portfolio-metric-value text-xs sm:text-sm">
                {formatUSD(totalMarketValue)} -{' '}
                <span class={totalUnrealized >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  {unSign}{formatUSD(totalUnrealized)} ({unSign}{unrealizedPct.toFixed(2)}%)
                </span>
              </span>
            </div>
            <span id="boardDailyQuote" class="block text-[10px] text-slate-500"></span>
            <span id="boardQuoteMeta" class="portfolio-micro-quote-meta inline-flex items-center gap-1.5 text-[10px] text-slate-500" aria-label={`Quote status: ${quoteFreshness}`}>
              <span class="text-slate-400"> · </span><span> {quoteMetaText}</span>
            </span>
          </div>
          <div class="portfolio-micro-column portfolio-micro-costs">
            <span class="portfolio-micro-heading">DEBT &amp; CARRYING COSTS</span>
            <div class="portfolio-micro-row">
              <span class="portfolio-metric-label text-[10px]">Margin Debt</span>
              <span id="boardMargin" class="portfolio-metric-value text-xs sm:text-sm text-rose-300">{marginText}</span>
            </div>
            <div class="portfolio-micro-row">
              <span class="portfolio-metric-label text-[10px]">Total Commissions</span>
              <span id="boardComms" class="portfolio-metric-value text-xs sm:text-sm">{commsText}</span>
            </div>
            <div class="portfolio-micro-row">
              <span class="portfolio-metric-label text-[10px]">Accrued Margin Interest</span>
              <span id="boardMarginCharged" class="portfolio-metric-value text-xs sm:text-sm">{marginChargedText}</span>
            </div>
          </div>
        </section>

        <MarginRiskGaugeCard equityPct={equityPct} risk={risk} equityText={equityText} collateralText={formatUSD(cushionTotal)} rules={rules} />
      </>
    );
  }

  // Single Ticker View
  const pos =
    (state.activeView ? state.positions?.[state.activeView] : undefined) ||
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

  const currentMktVal = pos.shares * pos.currentPrice;
  const previousPrice = previousPricesRef.current[pos.ticker];
  const priceFlashClass = previousPrice === undefined || previousPrice === pos.currentPrice
    ? ''
    : pos.currentPrice > previousPrice ? 'quote-flash-up' : 'quote-flash-down';
  previousPricesRef.current[pos.ticker] = pos.currentPrice;
  const unrealized = currentMktVal - totalInvested;
  const unrealizedPct = avgPrice > 0 ? ((pos.currentPrice - avgPrice) / avgPrice) * 100 : 0;

  const positionTranches = pos.tranches || [];
  const persistedBrokerTrades = loadSavedHistory().brokerExecutedTrades;
  const brokerTrades = Array.isArray(state.brokerExecutedTrades) && state.brokerExecutedTrades.length
    ? state.brokerExecutedTrades
    : persistedBrokerTrades;
  const brokerOpenLots = getActiveTranchesFromTrades(
    brokerTrades,
    state.brokerAccountInfo as any,
    {
      commPerShare: Number(rules.commPerShare ?? rules.commissionPerShare ?? 0),
      commVolumePct: Number(rules.commVolumePct ?? rules.commissionRatePct ?? 0),
      minCommOrder: Number(rules.minCommOrder ?? rules.commissionMin ?? 0)
    },
    false
  );
  const trancheQuantities = getMarginTrancheQuantities(positionTranches, brokerOpenLots, pos.ticker);
  const tranchesExpanded = expandedTrancheTicker === pos.ticker;
  const visibleTranches = getMarginTranchePreview(positionTranches, tranchesExpanded);
  const hiddenTrancheCount = positionTranches.length;

  const investedText = `${formatUSD(totalInvested)} | ${formatUSD(avgPrice)}`;
  const unSign = unrealized >= 0 ? '+' : '';
  const dailyQuoteMeta = getDailyQuoteMeta(pos.quoteDetails);

  const isFullDebt = Math.abs(allocatedDebt - totalAccountDebt) < 0.01;
  const marginText = isFullDebt
    ? `-${formatUSD(allocatedDebt)} (${formatUSD(allocatedDailyAccrual)}/day)`
    : `-${formatUSD(allocatedDebt)} (${formatUSD(allocatedDailyAccrual)}/day) [${(
      (allocatedDebt / (totalAccountDebt || 1)) *
      100
    ).toFixed(0)}% of -${formatUSD(totalAccountDebt)} Total]`;

  const commsText = `${formatUSD(totalComms)} (${formatUSD(pos.commBuy)} buy / ${formatUSD(
    commSell
  )} sell)`;
  const marginChargedText = `${formatUSD(posMarginCharged)} (Position To Date)`;
  const quoteMetaText = formatQuoteMetadata(pos, refreshIntervalMs);
  const quoteFreshness = getQuoteFreshness(pos, Date.now(), refreshIntervalMs);

  const positionAssets = currentMktVal + allocatedCushion;
  const positionEquity = positionAssets - allocatedDebt;
  const equityPct = positionAssets > 0 ? (positionEquity / positionAssets) * 100 : Number.NaN;
  const equityText = `${formatUSD(positionEquity)} (${Number.isFinite(equityPct) ? equityPct.toFixed(2) + "%" : "N/A"})`;

  const risk = computeMarginRiskDisplay(allocatedDebt, currentMktVal, allocatedCushion, rules);

  return (
    <>
      <section class="portfolio-micro-summary" aria-label="Portfolio financial summary">
        <div class="portfolio-micro-column portfolio-micro-basis">
          <span class="portfolio-micro-heading">POSITION BASIS</span>
          <div class="portfolio-micro-row">
            <span class="portfolio-metric-label text-[10px]">Shares / Tranches</span>
            <div id="boardTranches" class="portfolio-metric-value text-xs sm:text-sm">
              <div class="flex flex-wrap justify-end gap-x-2 gap-y-1">
                <span class="whitespace-nowrap">{pos.shares.toLocaleString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US')} shares</span>
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
                    {tranchesExpanded ? 'Show less' : `Show ${hiddenTrancheCount} tranches`}
                  </button>
                </>
              )}
            </div>
          </div>
          <div class="portfolio-micro-row">
            <span class="portfolio-metric-label text-[10px]">Invested / Avg. Entry</span>
            <span id="boardInvested" class="portfolio-metric-value text-xs sm:text-sm">{investedText}</span>
          </div>
        </div>
        <div class="portfolio-micro-column portfolio-micro-market">
          <span class="portfolio-micro-heading">MARKET VALUATION</span>
          <div class="portfolio-micro-row portfolio-micro-market-primary">
            <span class="portfolio-metric-label text-[10px]">Share Price / Market Value</span>
            <span key={`${pos.ticker}-${pos.currentPrice}`} id="boardPrice" class={`portfolio-metric-value text-xs sm:text-sm ${priceFlashClass}`}>
              {formatUSD(pos.currentPrice)} | {formatUSD(currentMktVal)}{' '}
              <span class={unrealized >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {unSign}{formatUSD(unrealized)} ({unSign}{unrealizedPct.toFixed(2)}%)
              </span>
            </span>
          </div>
          <span id="boardDailyQuote" class={dailyQuoteMeta?.className || 'block text-[10px] text-slate-500'}>
            {dailyQuoteMeta?.text || ''}
            <span class="text-slate-400"> · </span>
            <span id="boardQuoteMeta" class="portfolio-micro-quote-meta inline-flex items-center gap-1.5 text-[10px] text-slate-500" aria-label={`Quote status: ${quoteFreshness}`}>
              <span>{quoteMetaText} {pos.quoteUpdatedAt ? ' · ' + formatRelativeTime(pos.quoteUpdatedAt) : ''}</span>
            </span>
          </span>
        </div>
        <div class="portfolio-micro-column portfolio-micro-costs">
          <span class="portfolio-micro-heading">DEBT &amp; CARRYING COSTS</span>
          <div class="portfolio-micro-row">
            <span class="portfolio-metric-label text-[10px]">Margin Debt</span>
            <span id="boardMargin" class="portfolio-metric-value text-xs sm:text-sm text-rose-300">{marginText}</span>
          </div>
          <div class="portfolio-micro-row">
            <span class="portfolio-metric-label text-[10px]">Total Commissions</span>
            <span id="boardComms" class="portfolio-metric-value text-xs sm:text-sm">{commsText}</span>
          </div>
          <div class="portfolio-micro-row">
            <span class="portfolio-metric-label text-[10px]">Accrued Margin Interest</span>
            <span id="boardMarginCharged" class="portfolio-metric-value text-xs sm:text-sm">{marginChargedText}</span>
          </div>
        </div>
      </section>

      <MarginRiskGaugeCard equityPct={equityPct} risk={risk} equityText={equityText} collateralText={formatUSD(allocatedCushion)} rules={rules} />
    </>
  );
}