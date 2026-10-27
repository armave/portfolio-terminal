import { formatRelativeTime } from '../utils/relativeTime';
import { useRef } from 'preact/hooks';
import type { BoardState, BrokerRules, QuoteDetails } from '../types/portfolio';
import { formatUSD, formatTrancheDate, formatQuoteMetadata, formatRiskTrigger, getQuoteFreshness } from '../utils/formatters';
import { getCashCushionTotal, getTotalPortfolioInvested } from '../domain/portfolioSelectors';
import {
  calculateCommission,
  calculateMarginInterest
} from '../domain/portfolio';

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

export interface SummaryMetricsGridProps {
  state: BoardState;
  rules: BrokerRules;
  refreshIntervalMs?: number;
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

export function SummaryMetricsGrid({
  state,
  rules,
  refreshIntervalMs = 60000
}: SummaryMetricsGridProps) {
  const previousPricesRef = useRef<Record<string, number>>({});
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
      totalCommSell += calculateCommission(pos.shares, valSell, rules as any);
    });

    const tranchesForCombined =
      state.tranches && state.tranches.length > 0
        ? state.tranches
        : tickers.flatMap((t) => state.positions![t]?.tranches || []);
    const openMarginCharged = calculateMarginInterest(tranchesForCombined as any, {
      dailyRate,
      marginDebt: Math.abs(Number(state.balance) || 0),
      totalDebt: Math.abs(Number(state.balance) || 0)
    } as any);
    totalMarginCharged += openMarginCharged;

    const totalComms = totalCommBuy + totalCommSell;
    const totalUnrealized = totalMarketValue - totalInvested;
    const unrealizedPct = totalInvested > 0 ? (totalUnrealized / totalInvested) * 100 : 0;
    const totalDebt = Math.abs(Number(state.balance) || 0);
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
    const quoteFreshnessClass = quoteFreshness === 'fresh'
      ? 'bg-emerald-400'
      : quoteFreshness === 'stale'
        ? 'bg-amber-400'
        : 'bg-slate-500';

    const totalAccountEquity = totalMarketValue + cushionTotal - totalDebt;
    const totalAccountAssets = totalMarketValue + cushionTotal;
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
              <span aria-hidden="true" class={`inline-block h-1.5 w-1.5 rounded-full ${quoteFreshnessClass}`}></span>
              {quoteMetaText}
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
  const commSell = calculateCommission(pos.shares, valSell, rules as any);
  const totalComms = pos.commBuy + commSell;

  const portfolioInvested = getTotalPortfolioInvested(state);
  const weight = portfolioInvested > 0 ? totalInvested / portfolioInvested : 0;

  const totalAccountDebt = Math.abs(Number(state.balance) || 0);
  const allocatedDebt = totalAccountDebt * weight;
  const totalCushion = getCashCushionTotal(state);
  const allocatedCushion = totalCushion * weight;
  const allocatedDailyAccrual = allocatedDebt * dailyRate;
  const tranches =
    pos.tranches && pos.tranches.length > 0
      ? pos.tranches
      : (state.tranches && state.tranches.length > 0 ? state.tranches : []);
  const posMarginCharged = calculateMarginInterest(tranches as any, {
    dailyRate,
    marginDebt: allocatedDebt,
    totalDebt: totalAccountDebt
  } as any);

  const currentMktVal = pos.shares * pos.currentPrice;
  const previousPrice = previousPricesRef.current[pos.ticker];
  const priceFlashClass = previousPrice === undefined || previousPrice === pos.currentPrice
    ? ''
    : pos.currentPrice > previousPrice ? 'quote-flash-up' : 'quote-flash-down';
  previousPricesRef.current[pos.ticker] = pos.currentPrice;
  const unrealized = currentMktVal - totalInvested;
  const unrealizedPct = avgPrice > 0 ? ((pos.currentPrice - avgPrice) / avgPrice) * 100 : 0;

  const tranchesText =
    pos.tranches && pos.tranches.length > 0
      ? pos.tranches
        .map((t) => `${t.qty} @ ${formatUSD(t.price)} (${formatTrancheDate(t.date)})`)
        .join(' + ')
      : 'None';

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
  const quoteFreshnessClass = quoteFreshness === 'fresh'
    ? 'bg-emerald-400'
    : quoteFreshness === 'stale'
      ? 'bg-amber-400'
      : 'bg-slate-500';

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
            <span id="boardTranches" class="portfolio-metric-value text-xs sm:text-sm">{pos.shares.toLocaleString()} shares · {tranchesText}</span>
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
            <span id="boardQuoteMeta" class="portfolio-micro-quote-meta inline-flex items-center gap-1.5 text-[10px] text-slate-500" aria-label={`Quote status: ${quoteFreshness}`}>
              <span aria-hidden="true" class={`inline-block h-1.5 w-1.5 rounded-full ${quoteFreshnessClass}`}></span>
              {' · ' + quoteMetaText}{pos.quoteUpdatedAt ? ' · ' + formatRelativeTime(pos.quoteUpdatedAt) : ''}
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