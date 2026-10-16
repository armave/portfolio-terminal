import {
  BoardState,
  BrokerRules,
  formatUSD,
  formatTrancheDate,
  formatQuoteMetadata,
  formatRiskTrigger,
  getCashCushionTotal,
  getTotalPortfolioInvested,
  QuoteDetails
} from '../ui/renderBoard';
import {
  calculateCommission,
  calculateMarginInterest
} from '../domain/portfolio';

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
      stopOutText: ''
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

  return {
    summaryText,
    summaryClass: `${riskClass} font-bold font-mono`,
    showMarginCall,
    marginCallText: marginCallValue > 0 ? formatRiskTrigger(marginCallValue, positionValue) : '',
    showStopOut,
    stopOutText: showStopOut ? formatRiskTrigger(stopOutValue, positionValue) : ''
  };
}

export function SummaryMetricsGrid({
  state,
  rules,
  refreshIntervalMs = 60000
}: SummaryMetricsGridProps) {
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

    const totalAccountEquity = totalMarketValue + cushionTotal - totalDebt;
    const totalAccountAssets = totalMarketValue + cushionTotal;
    const equityPct =
      totalAccountAssets > 0 ? (totalAccountEquity / totalAccountAssets) * 100 : 0;
    const equityText = `${formatUSD(totalAccountEquity)} (${equityPct.toFixed(2)}%)`;

    const risk = computeMarginRiskDisplay(totalDebt, totalMarketValue, cushionTotal, rules);

    return (
      <>
        <div class="portfolio-metric px-3 py-1.5">
          <span class="portfolio-metric-label text-[10px]">Tranches / Holdings</span>
          <span id="boardTranches" class="portfolio-metric-value text-xs sm:text-sm">
            {tranchesText}
          </span>
        </div>
        <div class="portfolio-metric px-3 py-1.5">
          <span class="portfolio-metric-label text-[10px]">Total Invested | Avg</span>
          <span id="boardInvested" class="portfolio-metric-value text-xs sm:text-sm">
            {investedText}
          </span>
        </div>
        <div class="portfolio-metric px-3 py-1.5">
          <span class="portfolio-metric-label text-[10px]">Share Price | Market Value</span>
          <span id="boardPrice" class="portfolio-metric-value text-xs sm:text-sm text-emerald-400">
            {formatUSD(totalMarketValue)} -{' '}
            <span class={totalUnrealized >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {unSign}{formatUSD(totalUnrealized)} ({unSign}
              {unrealizedPct.toFixed(2)}%)
            </span>
          </span>
          <span id="boardDailyQuote" class="block text-[10px] text-slate-500"></span>
          <span id="boardQuoteMeta" class="text-[10px] text-slate-500">
            {quoteMetaText}
          </span>
        </div>
        <div class="portfolio-metric px-3 py-1.5">
          <span class="portfolio-metric-label text-[10px]">Margin Debt</span>
          <span id="boardMargin" class="portfolio-metric-value text-xs sm:text-sm text-rose-300">
            {marginText}
          </span>
        </div>
        <div class="portfolio-metric px-3 py-1.5">
          <span class="portfolio-metric-label text-[10px]">Total Commissions</span>
          <span id="boardComms" class="portfolio-metric-value text-xs sm:text-sm">
            {commsText}
          </span>
        </div>
        <div class="portfolio-metric px-3 py-1.5">
          <span class="portfolio-metric-label text-[10px]">Margin Charged</span>
          <span id="boardMarginCharged" class="portfolio-metric-value text-xs sm:text-sm">
            {marginChargedText}
          </span>
        </div>

        <div class="portfolio-risk-summary flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-300">
          <div>
            <span class="text-slate-500">Account Equity:</span>{' '}
            <span id="boardEquity" class="text-white font-bold font-mono">
              {equityText}
            </span>
          </div>
          <div>
            <span class="text-slate-500">
              Cash / Collateral Cushion:
            </span>{' '}
            <span id="boardCushionMetric" class="text-cyan-400 font-bold font-mono">
              +{formatUSD(cushionTotal)}
            </span>
          </div>
          <div title="Estimated from portfolio equity and configured margin thresholds; not a live broker risk indicator.">
            <span class="text-slate-500">Margin Risk:</span>{' '}
            <span id="boardMarginRisk" class={risk.summaryClass}>
              {risk.summaryText}
            </span>
          </div>
          <div
            id="boardMarginCallRow"
            class={risk.showMarginCall ? '' : 'hidden'}
            title="Estimate assumes the configured maintenance-margin ratio and that the full allocated cushion qualifies as collateral. Actual broker requirements may differ."
          >
            <span class="text-slate-500">Margin-call trigger:</span>{' '}
            <span id="boardMarginCall" class="text-amber-400 font-bold font-mono">
              {risk.marginCallText}
            </span>
          </div>
          <div
            id="boardStopOutRow"
            class={risk.showStopOut ? '' : 'hidden'}
            title="Estimate assumes the configured stop-out threshold and that the full allocated cushion qualifies as collateral. Actual broker requirements may differ."
          >
            <span class="text-slate-500">Stop-out trigger:</span>{' '}
            <span id="boardStopOut" class="text-rose-400 font-bold font-mono">
              {risk.stopOutText}
            </span>
          </div>
        </div>
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

  const positionAssets = currentMktVal + allocatedCushion;
  const positionEquity = positionAssets - allocatedDebt;
  const equityPct = positionAssets > 0 ? (positionEquity / positionAssets) * 100 : 0;
  const equityText = `${formatUSD(positionEquity)} (${equityPct.toFixed(2)}%)`;

  const risk = computeMarginRiskDisplay(allocatedDebt, currentMktVal, allocatedCushion, rules);

  return (
    <>
      <div class="portfolio-metric px-3 py-1.5">
        <span class="portfolio-metric-label text-[10px]">Tranches / Holdings</span>
        <span id="boardTranches" class="portfolio-metric-value text-xs sm:text-sm">
          {tranchesText}
        </span>
      </div>
      <div class="portfolio-metric px-3 py-1.5">
        <span class="portfolio-metric-label text-[10px]">Total Invested | Avg</span>
        <span id="boardInvested" class="portfolio-metric-value text-xs sm:text-sm">
          {investedText}
        </span>
      </div>
      <div class="portfolio-metric px-3 py-1.5">
        <span class="portfolio-metric-label text-[10px]">Share Price | Market Value</span>
        <span id="boardPrice" class="portfolio-metric-value text-xs sm:text-sm text-emerald-400">
          {formatUSD(pos.currentPrice)} | {formatUSD(currentMktVal)} –{' '}
          <span class={unrealized >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
            {unSign}{formatUSD(unrealized)} ({unSign}
            {unrealizedPct.toFixed(2)}%)
          </span>
        </span>
        <span
          id="boardDailyQuote"
          class={dailyQuoteMeta?.className || 'block text-[10px] text-slate-500'}
        >
          {dailyQuoteMeta?.text || ''}
          <span id="boardQuoteMeta" class="text-[10px] text-slate-500">
            {' · ' + quoteMetaText}
          </span>
        </span>
      </div>
      <div class="portfolio-metric px-3 py-1.5">
        <span class="portfolio-metric-label text-[10px]">Margin Debt</span>
        <span id="boardMargin" class="portfolio-metric-value text-xs sm:text-sm text-rose-300">
          {marginText}
        </span>
      </div>
      <div class="portfolio-metric px-3 py-1.5">
        <span class="portfolio-metric-label text-[10px]">Total Commissions</span>
        <span id="boardComms" class="portfolio-metric-value text-xs sm:text-sm">
          {commsText}
        </span>
      </div>
      <div class="portfolio-metric px-3 py-1.5">
        <span class="portfolio-metric-label text-[10px]">Margin Charged</span>
        <span id="boardMarginCharged" class="portfolio-metric-value text-xs sm:text-sm">
          {marginChargedText}
        </span>
      </div>

      <div class="portfolio-risk-summary flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-300">
        <div>
          <span class="text-slate-500">Account Equity:</span>{' '}
          <span id="boardEquity" class="text-white font-bold font-mono">
            {equityText}
          </span>
        </div>
        <div>
          <span class="text-slate-500">
            Allocated Cash / Collateral:
          </span>{' '}
          <span id="boardCushionMetric" class="text-cyan-400 font-bold font-mono">
            +{formatUSD(allocatedCushion)}
          </span>
        </div>
        <div title="Estimated from portfolio equity and configured margin thresholds; not a live broker risk indicator.">
          <span class="text-slate-500">Margin Risk:</span>{' '}
          <span id="boardMarginRisk" class={risk.summaryClass}>
            {risk.summaryText}
          </span>
        </div>
        <div
          id="boardMarginCallRow"
          class={risk.showMarginCall ? '' : 'hidden'}
          title="Estimate assumes the configured maintenance-margin ratio and that the full allocated cushion qualifies as collateral. Actual broker requirements may differ."
        >
          <span class="text-slate-500">Margin-call trigger:</span>{' '}
          <span id="boardMarginCall" class="text-amber-400 font-bold font-mono">
            {risk.marginCallText}
          </span>
        </div>
        <div
          id="boardStopOutRow"
          class={risk.showStopOut ? '' : 'hidden'}
          title="Estimate assumes the configured stop-out threshold and that the full allocated cushion qualifies as collateral. Actual broker requirements may differ."
        >
          <span class="text-slate-500">Stop-out trigger:</span>{' '}
          <span id="boardStopOut" class="text-rose-400 font-bold font-mono">
            {risk.stopOutText}
          </span>
        </div>
      </div>
    </>
  );
}