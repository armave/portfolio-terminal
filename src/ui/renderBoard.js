import {
  calculateAccruedFees,
  calculateCommission,
  calculateCompoundedDebt,
  calculateMarginInterest
} from '../domain/portfolio.ts';
import { getUsEquityProjectionDates } from '../domain/tradingCalendar.ts';
import { sentimentLabel, summarizeDailyQuote } from '../features/quotes/sentiment.ts';

export function formatUSD(val) {
  const num = Number(val) || 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function getTotalPortfolioInvested(state) {
  return Object.values(state.positions || {}).reduce((acc, pos) => {
    return acc + (pos.tranches || []).reduce((sum, tr) => sum + (tr.qty * tr.price), 0);
  }, 0);
}

export function getCashCushionTotal(state) {
  if (!state.cashCushion) return 0;
  const cashVal = Number(state.cashCushion.freeCash) || 0;
  const stocksVal = (state.cashCushion.holdings || []).reduce((sum, h) => {
    const price = Number(h.currentPrice ?? h.price) || 0;
    return sum + ((Number(h.shares) || 0) * price);
  }, 0);
  return cashVal + stocksVal;
}

export function createInsightElement(tagName, className = '', text = '') {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

export function sentimentBadge(direction, label = sentimentLabel(direction)) {
  const styles = {
    bullish: 'border-emerald-800 bg-emerald-950/50 text-emerald-300',
    bearish: 'border-rose-800 bg-rose-950/50 text-rose-300',
    neutral: 'border-slate-700 bg-slate-900 text-slate-300',
    unknown: 'border-slate-800 bg-slate-950 text-slate-500'
  };
  const badge = createInsightElement(
    'span',
    `inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${styles[direction]}`,
    label
  );
  badge.dataset.sentiment = direction;
  badge.title = direction === 'unknown'
    ? 'The selected data source did not provide a sentiment signal.'
    : 'A directional marker based only on the provider values shown in this section.';
  return badge;
}

export function formatQuoteMetadata(holding, refreshIntervalMs = 60000) {
  if (!holding.quoteUpdatedAt) return holding.quoteSource || 'Not fetched';

  const updatedAt = Number(holding.quoteUpdatedAt);
  if (!Number.isFinite(updatedAt)) return holding.quoteSource || 'Not fetched';
  const time = new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const isStale = Date.now() - updatedAt > Math.max(5 * 60 * 1000, refreshIntervalMs * 2);
  return `${isStale ? 'Stale · ' : ''}${holding.quoteSource || 'Quote'} · ${time}`;
}

export function createDailyQuoteLabel(details) {
  if (!details || typeof details !== 'object') return null;
  const hasChange = Number.isFinite(details.change) && Number.isFinite(details.changePercent);
  const hasRange = Number.isFinite(details.high) && Number.isFinite(details.low);
  if (!hasChange && !hasRange) return null;

  const label = document.createElement('span');
  label.className = 'mt-0.5 block text-[9px] font-normal tabular-nums';
  const parts = [];
  if (hasChange) {
    const sign = details.change >= 0 ? '+' : '−';
    parts.push(`${sign}$${formatUSD(Math.abs(details.change))} (${sign}${Math.abs(details.changePercent).toFixed(2)}%)`);
    label.classList.add('text-slate-400');
  } else {
    label.classList.add('text-slate-400');
  }
  if (hasRange) parts.push(`H $${formatUSD(details.high)} / L $${formatUSD(details.low)}`);
  label.textContent = `Day: ${parts.join(' · ')}`;
  return label;
}

export function formatRiskTrigger(triggerValue, currentValue) {
  if (currentValue <= 0) return `Position value $${formatUSD(triggerValue)}`;

  const bufferPct = ((currentValue - triggerValue) / currentValue) * 100;
  if (bufferPct < 0) {
    return `Position value $${formatUSD(triggerValue)} (already ${Math.abs(bufferPct).toFixed(1)}% below trigger)`;
  }
  return `Position value $${formatUSD(triggerValue)} (${bufferPct.toFixed(1)}% buffer)`;
}

export function renderMarginRisk(debt, positionValue, collateral, rules) {
  const marginCallRow = document.getElementById('boardMarginCallRow');
  const stopOutRow = document.getElementById('boardStopOutRow');
  const riskSummary = document.getElementById('boardMarginRisk');
  if (!riskSummary) return;

  if (debt <= 0) {
    riskSummary.innerText = 'No margin debt';
    riskSummary.className = 'text-emerald-400 font-bold font-mono';
    marginCallRow?.classList.add('hidden');
    stopOutRow?.classList.add('hidden');
    return;
  }

  const assets = positionValue + collateral;
  const equity = assets - debt;
  const equityRatio = assets > 0 ? (equity / assets) * 100 : -Infinity;
  const maintenanceRatio = rules.maintenanceMarginRatio * 100;
  const stopOutRatio = rules.stopOutRatio * 100;
  let riskLevel;
  let riskClass;

  if (equityRatio <= stopOutRatio) {
    riskLevel = 'Stop-out level';
    riskClass = 'text-rose-400';
  } else if (equityRatio <= maintenanceRatio) {
    riskLevel = 'Margin-call level';
    riskClass = 'text-rose-400';
  } else if (equityRatio <= maintenanceRatio + 5) {
    riskLevel = 'Elevated';
    riskClass = 'text-amber-400';
  } else {
    riskLevel = 'Healthy';
    riskClass = 'text-emerald-400';
  }
  riskSummary.innerText = `${riskLevel} · ${Number.isFinite(equityRatio) ? `${equityRatio.toFixed(1)}% equity` : 'negative equity'} (${maintenanceRatio.toFixed(1)}% maintenance)`;
  riskSummary.className = `${riskClass} font-bold font-mono`;

  const marginCallAssetsRequired = debt / (1 - rules.maintenanceMarginRatio);
  const stopOutAssetsRequired = debt / (1 - rules.stopOutRatio);
  marginCallRow?.classList.toggle('hidden', collateral >= marginCallAssetsRequired);
  stopOutRow?.classList.toggle('hidden', collateral >= stopOutAssetsRequired);
  const marginCallValue = Math.max(0, marginCallAssetsRequired - collateral);
  const stopOutValue = Math.max(0, stopOutAssetsRequired - collateral);

  const marginCallEl = document.getElementById('boardMarginCall');
  const stopOutEl = document.getElementById('boardStopOut');
  if (marginCallEl && marginCallValue > 0) marginCallEl.innerText = formatRiskTrigger(marginCallValue, positionValue);
  if (stopOutEl && collateral < stopOutAssetsRequired) stopOutEl.innerText = formatRiskTrigger(stopOutValue, positionValue);
}

export function renderPositionsTable(gross, totalComms, debtToUse, marginChargedToUse, entryDate, dailyRate) {
  const tableBody = document.getElementById('projectionTableBody');
  if (!tableBody) return;
  tableBody.innerHTML = '';

  if (debtToUse > 0 || gross > 0) {
    getUsEquityProjectionDates(new Date(), entryDate).forEach(({ date, daysFromToday, kind }) => {
      const dateFormatted = date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      });
      if (kind === 'entry') {
        const entryRow = document.createElement('tr');
        entryRow.className = 'border-b border-slate-800/50 text-slate-500';
        entryRow.innerHTML = `
          <td class="py-1.5 px-3 text-[10px] font-medium text-left">Entry · ${dateFormatted}</td>
          <td colspan="4" class="py-1.5 px-3 text-[10px] italic text-left">Position opened · projection values start today</td>
        `;
        tableBody.appendChild(entryRow);
        return;
      }
      const label = kind === 'today'
        ? `${dateFormatted} <span class="ml-1 text-[9px] font-normal uppercase tracking-wide text-cyan-500/80">Today</span>`
        : kind === 'week-end'
          ? `${dateFormatted} (End of week · +${daysFromToday}d)`
          : `${dateFormatted} (+${daysFromToday}d)`;

      const b_t = calculateCompoundedDebt(debtToUse, dailyRate, daysFromToday);
      const additionalAccrual = calculateMarginInterest(debtToUse, dailyRate, daysFromToday);
      const m_d = marginChargedToUse + additionalAccrual;
      const fee_c = calculateAccruedFees(totalComms, marginChargedToUse, additionalAccrual);
      const net_p = gross - fee_c;
      const dr = b_t * dailyRate;

      const tr = document.createElement('tr');
      tr.className = kind === 'today' ? "bg-slate-900/80 font-bold" : "hover:bg-slate-900/40";
      const netClass = net_p >= 0 ? "text-emerald-400" : "text-rose-400";
      const netSign = net_p >= 0 ? "+" : "";

      tr.innerHTML = `
        <td class="py-2 px-3 text-left text-slate-300 font-semibold">${label}</td>
        <td class="py-2 px-3 text-right ${netClass} font-semibold">${netSign}$${formatUSD(net_p)}</td>
        <td class="py-2 px-3 text-right text-slate-200">$${formatUSD(fee_c)}</td>
        <td class="py-2 px-3 text-right text-slate-400">$${formatUSD(m_d)} ($${formatUSD(dr)})</td>
        <td class="py-2 px-3 text-right text-rose-400">-$${formatUSD(b_t)}</td>
      `;
      tableBody.appendChild(tr);
    });
  } else {
    tableBody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-slate-500 italic">No active position to project.</td></tr>`;
  }
}

export function renderCashCushion(state, options = {}) {
  const { onFetchLivePrice, onRemoveCashStock, refreshIntervalMs = 60000 } = options;
  if (!state.cashCushion) state.cashCushion = { freeCash: 0.00, holdings: [] };
  const freeCash = Number(state.cashCushion.freeCash) || 0;
  const marginDebt = Math.abs(Number(state.marginBalance) || 0);
  const signedBalance = freeCash + (Number(state.marginBalance) || 0);

  const freeCashInput = document.getElementById('freeCashInput');
  if (freeCashInput) freeCashInput.value = signedBalance.toFixed(2);

  const debtMeta = document.getElementById('cashBalanceDebtMeta');
  if (debtMeta) {
    debtMeta.textContent = `Balance: $${formatUSD(freeCash)} | Debt: -$${formatUSD(marginDebt)}`;
  }

  const tableBody = document.getElementById('cashStocksTableBody');
  const tableFooter = document.getElementById('cashStocksTableFooter');
  if (!tableBody || !tableFooter) return;
  tableBody.innerHTML = '';

  let stocksTotal = 0;
  const holdings = state.cashCushion.holdings || [];

  holdings.forEach(h => {
    const price = Number(h.currentPrice ?? h.price) || 0;
    stocksTotal += (Number(h.shares) || 0) * price;
  });

  holdings.forEach((h, idx) => {
    const shares = Number(h.shares) || 0;
    const price = Number(h.currentPrice ?? h.price) || 0;
    const val = shares * price;
    const allocation = stocksTotal > 0 ? (val / stocksTotal) * 100 : 0;
    const quoteMeta = formatQuoteMetadata(h, refreshIntervalMs);

    const tr = document.createElement('tr');
    tr.className = "hover:bg-slate-900/40";
    const addCell = (content, className) => {
      const cell = document.createElement('td');
      cell.className = className;
      cell.textContent = content;
      tr.appendChild(cell);
      return cell;
    };
    const tickerCell = addCell('', 'py-2 px-3 text-cyan-300 font-bold');
    tickerCell.append(
      createInsightElement('span', '', h.ticker),
      document.createTextNode(' '),
      sentimentBadge(
        Number.isFinite(h.quoteDetails?.change)
          ? h.quoteDetails.change > 0 ? 'bullish' : h.quoteDetails.change < 0 ? 'bearish' : 'neutral'
          : 'unknown',
        Number.isFinite(h.quoteDetails?.change) && `${h.quoteDetails.changePercent.toFixed(2)}%`
      )
    );
    addCell(shares.toLocaleString('en-US', { maximumFractionDigits: 3 }), 'py-2 px-3 text-right text-slate-200 tabular-nums');
    const priceCell = document.createElement('td');
    priceCell.className = 'py-2 px-3 text-right text-emerald-400 font-semibold tabular-nums';
    const priceLabel = document.createElement('span');
    priceLabel.textContent = `$${formatUSD(price)}`;
    const quoteLabel = document.createElement('span');
    quoteLabel.className = 'mt-0.5 block text-[9px] font-normal text-slate-500';
    quoteLabel.textContent = quoteMeta;
    priceCell.append(priceLabel);
    const dailyQuoteLabel = createDailyQuoteLabel(h.quoteDetails);
    if (dailyQuoteLabel) priceCell.append(dailyQuoteLabel);
    priceCell.append(quoteLabel);
    tr.appendChild(priceCell);
    addCell(`$${formatUSD(val)}`, 'py-2 px-3 text-right text-white font-semibold');
    addCell(`${allocation.toFixed(1)}%`, 'py-2 px-3 text-right text-slate-300 tabular-nums');
    const actionsCell = addCell('', 'py-2 px-3 text-center space-x-2');
    const refreshButton = document.createElement('button');
    refreshButton.className = 'text-cyan-400 hover:text-cyan-300 text-xs font-bold';
    refreshButton.title = 'Refresh Live Price';
    refreshButton.setAttribute('aria-label', `Refresh ${h.ticker} quote`);
    refreshButton.textContent = '↻';
    if (typeof onFetchLivePrice === 'function') {
      refreshButton.addEventListener('click', () => onFetchLivePrice(h.ticker));
    }
    const removeButton = document.createElement('button');
    removeButton.className = 'text-rose-400 hover:text-rose-300 text-xs font-bold';
    removeButton.textContent = 'Remove';
    if (typeof onRemoveCashStock === 'function') {
      removeButton.addEventListener('click', () => onRemoveCashStock(idx));
    }
    actionsCell.append(refreshButton, removeButton);
    tableBody.appendChild(tr);
  });

  if ((state.cashCushion.holdings || []).length === 0) {
    tableBody.innerHTML = `<tr><td colspan="6" class="py-3 text-center text-slate-500 italic">No cash stocks entered. Add unleveraged stocks below (price auto-fetches).</td></tr>`;
  }
  tableFooter.innerHTML = holdings.length > 0
    ? `<tr>
        <td class="py-2 px-3 text-slate-300 font-bold" colspan="3">${holdings.length} holding${holdings.length === 1 ? '' : 's'}</td>
        <td class="py-2 px-3 text-right text-white font-bold">$${formatUSD(stocksTotal)}</td>
        <td class="py-2 px-3 text-right text-slate-300 font-bold">${stocksTotal > 0 ? '100.0%' : '—'}</td>
        <td></td>
      </tr>`
    : '';
  const summaryEl = document.getElementById('cashHoldingsSummary');
  if (summaryEl) {
    summaryEl.textContent = `${holdings.length} holding${holdings.length === 1 ? '' : 's'} · $${formatUSD(stocksTotal)} market value`;
  }

  const totalCushion = freeCash + stocksTotal;
  const totalValEl = document.getElementById('cushionTotalValue');
  if (totalValEl) totalValEl.innerText = `$${formatUSD(totalCushion)}`;
}

export function renderSummaryCards(state, options = {}) {
  const { rules, onRenderAnalystConsensus, refreshIntervalMs = 60000 } = options;
  const dailyRate = rules.annualRate / rules.dayCountBasis;
  const tickers = Object.keys(state.positions || {});
  const isCombined = state.activeView === "COMBINED" || tickers.length !== 1 && !state.positions[state.activeView];

  if (isCombined) {
    let totalInvested = 0;
    let totalMarketValue = 0;
    let totalCommBuy = 0;
    let totalCommSell = 0;
    let totalGrossTarget = 0;
    let totalMarginCharged = state.realizedMarginCharged || 0;

    tickers.forEach(t => {
      const pos = state.positions[t];
      const cost = (pos.tranches || []).reduce((sum, tr) => sum + (tr.qty * tr.price), 0);
      totalInvested += cost;
      totalMarketValue += pos.shares * pos.currentPrice;
      totalCommBuy += pos.commBuy;
      const valSell = pos.shares * pos.pt;
      totalCommSell += calculateCommission(pos.shares, valSell, rules);
      totalGrossTarget += (valSell - cost);
      totalMarginCharged += (pos.marginCharged || 0.00);
    });

    const totalComms = totalCommBuy + totalCommSell;
    const net0 = totalGrossTarget - totalComms - totalMarginCharged;
    const netPct = totalInvested > 0 ? (net0 / totalInvested) * 100 : 0;
    const totalUnrealized = totalMarketValue - totalInvested;
    const unrealizedPct = totalInvested > 0 ? (totalUnrealized / totalInvested) * 100 : 0;
    const totalDebt = Math.abs(state.marginBalance);
    const dailyAccrual = totalDebt * dailyRate;

    document.getElementById('boardTitle').innerText = tickers.length > 0
      ? `COMBINED PORTFOLIO (${tickers.length} Positions | ${netPct >= 0 ? '+' : ''}${netPct.toFixed(2)}% Net Combined Target)`
      : `NO ACTIVE MARGIN POSITIONS`;

    document.getElementById('boardTranches').innerText = tickers.length > 0
      ? tickers.map(t => `${t}: ${state.positions[t].shares}sh @ PT $${formatUSD(state.positions[t].pt)}`).join(' | ')
      : "None";

    document.getElementById('boardInvested').innerText = `$${formatUSD(totalInvested)} | Across ${tickers.length} Assets`;

    const unSign = totalUnrealized >= 0 ? '+' : '';
    document.getElementById('boardPrice').innerHTML = `$${formatUSD(totalMarketValue)} – <span class="${totalUnrealized >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${unSign}$${formatUSD(totalUnrealized)} (${unSign}${unrealizedPct.toFixed(2)}%)</span>`;

    document.getElementById('boardMargin').innerText = `-$${formatUSD(totalDebt)} ($${formatUSD(dailyAccrual)}/day @ ${(dailyRate * 100).toFixed(4)}%)`;
    document.getElementById('boardComms').innerText = `$${formatUSD(totalComms)} ($${formatUSD(totalCommBuy)} buy / $${formatUSD(totalCommSell)} sell)`;
    document.getElementById('boardMarginCharged').innerText = `$${formatUSD(totalMarginCharged)}`;

    const cushionTotal = getCashCushionTotal(state);
    document.getElementById('boardCushionLabel').innerText = 'Cash / Collateral Cushion:';
    document.getElementById('boardCushionMetric').innerText = `+$${formatUSD(cushionTotal)}`;

    const quotes = tickers.map(ticker => state.positions[ticker]).filter(position => position.quoteUpdatedAt);
    const latestQuote = quotes.sort((a, b) => b.quoteUpdatedAt - a.quoteUpdatedAt)[0];
    document.getElementById('boardQuoteMeta').innerText = latestQuote
      ? `Latest portfolio quote · ${formatQuoteMetadata(latestQuote, refreshIntervalMs)}`
      : 'No live quotes fetched for margin positions';

    const moveEl = document.getElementById('boardDailyMove');
    if (moveEl) moveEl.classList.remove('hidden');

    if (typeof onRenderAnalystConsensus === 'function') {
      onRenderAnalystConsensus(tickers[0]);
    }

    const totalAccountEquity = (totalMarketValue + cushionTotal) - totalDebt;
    const totalAccountAssets = totalMarketValue + cushionTotal;
    const equityPct = totalAccountAssets > 0 ? (totalAccountEquity / totalAccountAssets) * 100 : 0;
    document.getElementById('boardEquity').innerText = `$${formatUSD(totalAccountEquity)} (${equityPct.toFixed(2)}%)`;

    renderMarginRisk(totalDebt, totalMarketValue, cushionTotal, rules);
    renderPositionsTable(totalGrossTarget, totalComms, totalDebt, totalMarginCharged, state.startDate, dailyRate);
  } else {
    const pos = state.positions[state.activeView] || state.positions[tickers[0]];
    if (!pos) return;
    const totalInvested = (pos.tranches || []).reduce((sum, t) => sum + (t.qty * t.price), 0);
    const avgPrice = pos.shares > 0 ? totalInvested / pos.shares : 0;
    const valSell = pos.shares * pos.pt;
    const commSell = calculateCommission(pos.shares, valSell, rules);
    const totalComms = pos.commBuy + commSell;
    const gross = valSell - totalInvested;

    const portfolioInvested = getTotalPortfolioInvested(state);
    const weight = portfolioInvested > 0 ? (totalInvested / portfolioInvested) : 1;

    const totalAccountDebt = Math.abs(state.marginBalance);
    const allocatedDebt = totalAccountDebt * weight;
    const totalCushion = getCashCushionTotal(state);
    const allocatedCushion = totalCushion * weight;
    const allocatedDailyAccrual = allocatedDebt * dailyRate;
    const posMarginCharged = pos.marginCharged || 0.00;

    const net0 = gross - totalComms - posMarginCharged;
    const netPct = totalInvested > 0 ? (net0 / totalInvested) * 100 : 0;

    const currentMktVal = pos.shares * pos.currentPrice;
    const unrealized = currentMktVal - totalInvested;
    const unrealizedPct = avgPrice > 0 ? ((pos.currentPrice - avgPrice) / avgPrice) * 100 : 0;

    document.getElementById('boardTitle').innerText = `${pos.ticker} (${pos.shares} Shares @ $${formatUSD(pos.pt)} PT | ${netPct >= 0 ? '+' : ''}${netPct.toFixed(2)}% Net Target)`;
    document.getElementById('boardTranches').innerText = (pos.tranches && pos.tranches.length > 0)
      ? pos.tranches.map(t => `${t.qty} @ $${formatUSD(t.price)} (${t.date || 'New'})`).join(' + ')
      : "None";
    document.getElementById('boardInvested').innerText = `$${formatUSD(totalInvested)} | $${formatUSD(avgPrice)}`;

    const unSign = unrealized >= 0 ? '+' : '';
    document.getElementById('boardPrice').innerHTML = `$${formatUSD(pos.currentPrice)} | $${formatUSD(currentMktVal)} – <span class="${unrealized >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${unSign}$${formatUSD(unrealized)} (${unSign}${unrealizedPct.toFixed(2)}%)</span>`;
    const boardDailyQuote = document.getElementById('boardDailyQuote');
    const dailyQuoteLabel = createDailyQuoteLabel(pos.quoteDetails);
    if (boardDailyQuote) {
      boardDailyQuote.textContent = dailyQuoteLabel?.textContent || '';
      boardDailyQuote.className = dailyQuoteLabel?.className || 'block text-[10px] text-slate-500';
    }

    if (typeof onRenderAnalystConsensus === 'function') {
      onRenderAnalystConsensus(pos.ticker);
    }

    const isFullDebt = Math.abs(allocatedDebt - totalAccountDebt) < 0.01;
    document.getElementById('boardMargin').innerText = isFullDebt
      ? `-$${formatUSD(allocatedDebt)} ($${formatUSD(allocatedDailyAccrual)}/day)`
      : `-$${formatUSD(allocatedDebt)} ($${formatUSD(allocatedDailyAccrual)}/day) [${((allocatedDebt / (totalAccountDebt || 1)) * 100).toFixed(0)}% of -$${formatUSD(totalAccountDebt)} Total]`;

    document.getElementById('boardComms').innerText = `$${formatUSD(totalComms)} ($${formatUSD(pos.commBuy)} buy / $${formatUSD(commSell)} sell)`;
    document.getElementById('boardMarginCharged').innerText = `$${formatUSD(posMarginCharged)} (Position To Date)`;

    document.getElementById('boardCushionLabel').innerText = 'Allocated Cash / Collateral:';
    document.getElementById('boardCushionMetric').innerText = `+$${formatUSD(allocatedCushion)}`;
    document.getElementById('boardQuoteMeta').innerText = formatQuoteMetadata(pos, refreshIntervalMs);

    const positionAssets = currentMktVal + allocatedCushion;
    const positionEquity = positionAssets - allocatedDebt;
    const equityPct = positionAssets > 0 ? (positionEquity / positionAssets) * 100 : 0;
    document.getElementById('boardEquity').innerText = `$${formatUSD(positionEquity)} (${equityPct.toFixed(2)}%)`;

    renderMarginRisk(allocatedDebt, currentMktVal, allocatedCushion, rules);
    renderPositionsTable(gross, totalComms, allocatedDebt, posMarginCharged, pos.startDate || state.startDate, dailyRate);
  }
}

export function renderBoard(state, options = {}) {
  const {
    rules,
    onSetActiveView,
    onRenderClosedHistory,
    onRenderAnalystConsensus,
    onFetchLivePrice,
    onRemoveCashStock,
    onRenderExternalLinks,
    onRenderConsoleQuickActions,
    onUpdateCombinedBreakeven,
    onSyncMarketInsightsPanel,
    refreshIntervalMs = 60000,
    lastDeskView = null,
    onUpdateLastDeskView = () => {}
  } = options;

  const tickers = Object.keys(state.positions || {});
  const tabsContainer = document.getElementById('tickerTabs');
  if (tabsContainer) tabsContainer.innerHTML = '';

  const isCushionActive = state.activeView === "CASH_CUSHION";
  const isClosedHistoryActive = state.activeView === "CLOSED_HISTORY";
  const emptyPanel = document.getElementById('emptyStatePanel');
  if (emptyPanel) {
    emptyPanel.classList.toggle('hidden', !(tickers.length === 0 && !isCushionActive && !isClosedHistoryActive));
  }

  if (tabsContainer) {
    if (tickers.length === 0) {
      if (!isCushionActive && !isClosedHistoryActive) state.activeView = "COMBINED";
      const emptyLabel = document.createElement('span');
      emptyLabel.className = "text-xs font-bold text-slate-500 uppercase tracking-wider";
      emptyLabel.innerText = "NO ACTIVE TRADES";
      tabsContainer.appendChild(emptyLabel);
    } else if (tickers.length === 1) {
      if (!isCushionActive && !isClosedHistoryActive) state.activeView = tickers[0];
      const btn = document.createElement('button');
      btn.className = `px-3 py-1 rounded text-xs font-bold transition ${state.activeView === tickers[0] ? 'bg-emerald-600 text-black' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`;
      btn.innerText = `MARGIN: ${tickers[0]}`;
      btn.onclick = () => onSetActiveView?.(tickers[0]);
      tabsContainer.appendChild(btn);
    } else {
      if (!isCushionActive && !isClosedHistoryActive && state.activeView !== "COMBINED" && !state.positions[state.activeView]) {
        state.activeView = "COMBINED";
      }

      const combinedBtn = document.createElement('button');
      combinedBtn.className = `px-3 py-1 rounded text-xs font-bold transition ${state.activeView === "COMBINED" ? 'bg-emerald-600 text-black' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`;
      combinedBtn.innerText = "COMBINED PORTFOLIO";
      combinedBtn.onclick = () => onSetActiveView?.("COMBINED");
      tabsContainer.appendChild(combinedBtn);

      tickers.forEach(t => {
        const btn = document.createElement('button');
        btn.className = `px-3 py-1 rounded text-xs font-bold transition ${state.activeView === t ? 'bg-emerald-600 text-black' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`;
        btn.innerText = t;
        btn.onclick = () => onSetActiveView?.(t);
        tabsContainer.appendChild(btn);
      });
    }

    const cushionTotal = getCashCushionTotal(state);
    const cushionBtn = document.createElement('button');
    cushionBtn.className = `px-3 py-1 rounded text-xs font-bold transition flex items-center gap-1.5 ${isCushionActive ? 'bg-cyan-500 text-black' : 'bg-slate-900 border border-cyan-800/60 text-cyan-400 hover:bg-slate-800'}`;
    cushionBtn.innerHTML = `<span>🛡️ BALANCE</span> <span class="text-[10px] px-1.5 py-0.2 rounded ${isCushionActive ? 'bg-cyan-800 text-white' : 'bg-cyan-950 text-cyan-300 font-mono'}">+$${cushionTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>`;
    cushionBtn.onclick = () => onSetActiveView?.("CASH_CUSHION");
    tabsContainer.appendChild(cushionBtn);

    const closedTrades = state.closedTrades || [];
    const closedHistoryBtn = document.createElement('button');
    closedHistoryBtn.className = `px-3 py-1 rounded text-xs font-bold transition ${isClosedHistoryActive ? 'bg-purple-500 text-black' : 'bg-slate-900 border border-purple-800/60 text-purple-300 hover:bg-slate-800'}`;
    closedHistoryBtn.innerText = `CLOSED HISTORY (${closedTrades.length})`;
    closedHistoryBtn.onclick = () => onSetActiveView?.("CLOSED_HISTORY");
    tabsContainer.appendChild(closedHistoryBtn);
    const closedTradesCount = document.getElementById('closedTradesCount');
    if (closedTradesCount) {
      closedTradesCount.textContent = `${closedTrades.length} realized exit${closedTrades.length === 1 ? '' : 's'}`;
    }
  }

  const mainDesk = document.getElementById('mainDeskContainer');
  const cushionDesk = document.getElementById('cashCushionContainer');
  const closedHistoryDesk = document.getElementById('closedHistoryContainer');
  let activeDesk;
  let activeDeskView;

  if (isCushionActive) {
    mainDesk?.classList.add('hidden');
    cushionDesk?.classList.remove('hidden');
    closedHistoryDesk?.classList.add('hidden');
    renderCashCushion(state, { onFetchLivePrice, onRemoveCashStock, refreshIntervalMs });
    activeDesk = cushionDesk;
    activeDeskView = 'CASH_CUSHION';
  } else if (isClosedHistoryActive) {
    mainDesk?.classList.add('hidden');
    cushionDesk?.classList.add('hidden');
    closedHistoryDesk?.classList.remove('hidden');
    onRenderClosedHistory?.();
    activeDesk = closedHistoryDesk;
    activeDeskView = 'CLOSED_HISTORY';
  } else {
    mainDesk?.classList.remove('hidden');
    cushionDesk?.classList.add('hidden');
    closedHistoryDesk?.classList.add('hidden');

    renderSummaryCards(state, { rules, onRenderAnalystConsensus, refreshIntervalMs });
    activeDesk = mainDesk;
    activeDeskView = state.activeView;
  }

  onRenderExternalLinks?.();
  onRenderConsoleQuickActions?.();

  if (activeDesk && activeDeskView !== lastDeskView) {
    activeDesk.classList.remove('ui-view-enter');
    void activeDesk.offsetWidth;
    activeDesk.classList.add('ui-view-enter');
    activeDesk.addEventListener('animationend', () => activeDesk.classList.remove('ui-view-enter'), { once: true });
    onUpdateLastDeskView(activeDeskView);
  }

  onUpdateCombinedBreakeven?.();
  onSyncMarketInsightsPanel?.();
}
