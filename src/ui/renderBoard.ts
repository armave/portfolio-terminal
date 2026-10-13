import { render, h } from 'preact';
import { CashCushionDesk } from '../components/CashCushionDesk';

import {
  calculateAccruedFees,
  calculateCommission,
  calculateCompoundedDebt,
  calculateMarginInterest
} from '../domain/portfolio';
import { getUsEquityProjectionDates } from '../domain/tradingCalendar';
import { sentimentLabel, SentimentDirection } from '../features/quotes/sentiment';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
] as const;

export interface TrancheItem {
  qty: number;
  price: number;
  date?: string;
}

export interface QuoteDetails {
  change?: number;
  changePercent?: number;
  high?: number;
  low?: number;
  [key: string]: any;
}

export interface PositionRecord {
  ticker: string;
  shares: number;
  currentPrice: number;
  pt: number;
  commBuy: number;
  startDate?: string;
  tranches?: TrancheItem[];
  quoteUpdatedAt?: number;
  quoteSource?: string;
  quoteDetails?: QuoteDetails;
}

export interface CashStockHolding {
  ticker: string;
  shares: number | string;
  price?: number | string;
  currentPrice?: number | string;
  quoteUpdatedAt?: number;
  quoteSource?: string;
  quoteDetails?: QuoteDetails;
}

export interface CashCushionState {
  freeCash: number | string;
  holdings: CashStockHolding[];
}

export interface BoardState {
  positions?: Record<string, PositionRecord>;
  cashCushion?: CashCushionState;
  balance?: number | string;
  realizedMarginCharged?: number;
  tranches?: TrancheItem[];
  startDate?: string;
  activeView?: string;
  closedTrades?: any[];
}

export interface BrokerRules {
  annualRate: number;
  dayCountBasis: number;
  maintenanceMarginRatio: number;
  stopOutRatio: number;
  commissionMin?: number;
  commissionPerShare?: number;
  commissionRatePct?: number;
  [key: string]: any;
}

export interface RenderCashCushionOptions {
  onFetchLivePrice?: (ticker: string) => void;
  onRemoveCashStock?: (index: number) => void;
  refreshIntervalMs?: number;
}

export interface RenderSummaryCardsOptions {
  rules: BrokerRules;
  onRenderAnalystConsensus?: (ticker: string) => void;
  refreshIntervalMs?: number;
}

export interface RenderBoardOptions extends RenderCashCushionOptions {
  rules: BrokerRules;
  onSetActiveView?: (view: string) => void;
  onRenderClosedHistory?: () => void;
  onRenderAnalystConsensus?: (ticker: string) => void;
  onRenderExternalLinks?: () => void;
  onRenderConsoleQuickActions?: () => void;
  onUpdateCombinedBreakeven?: () => void;
  onSyncMarketInsightsPanel?: () => void;
  lastDeskView?: string | null;
  onUpdateLastDeskView?: (view: string) => void;
}

export function formatTrancheDate(dateStr?: string | null): string {
  if (!dateStr || typeof dateStr !== 'string') return 'New';
  const trimmed = dateStr.trim();
  if (!trimmed || trimmed.toLowerCase() === 'new') return 'New';

  const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch) {
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    if (month >= 0 && month < 12 && day >= 1 && day <= 31) {
      return `${String(day).padStart(2, '0')} ${MONTH_NAMES[month]}`;
    }
  }

  const shortMatch =
    trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3,})/i) ||
    trimmed.match(/^([A-Za-z]{3,})\s+(\d{1,2})/i);
  if (shortMatch) {
    const isFirstNum = /^\d+$/.test(shortMatch[1]);
    const day = parseInt(isFirstNum ? shortMatch[1] : shortMatch[2], 10);
    const monStr = (isFirstNum ? shortMatch[2] : shortMatch[1]).slice(0, 3).toLowerCase();
    const monthIdx = MONTH_NAMES.findIndex((m) => m.toLowerCase() === monStr);
    if (monthIdx !== -1 && day >= 1 && day <= 31) {
      return `${String(day).padStart(2, '0')} ${MONTH_NAMES[monthIdx]}`;
    }
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const day = parsed.getDate();
    const month = parsed.getMonth();
    return `${String(day).padStart(2, '0')} ${MONTH_NAMES[month]}`;
  }

  return trimmed;
}

export function formatUSD(val: number | string | undefined | null): string {
  const num = Number(val) || 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function getTotalPortfolioInvested(state: BoardState | null | undefined): number {
  if (!state || typeof state !== 'object') return 0;
  return Object.values(state.positions || {}).reduce((acc, pos) => {
    return acc + (pos?.tranches || []).reduce((sum, tr) => sum + tr.qty * tr.price, 0);
  }, 0);
}

export function getCashCushionTotal(state: BoardState): number {
  if (!state.cashCushion) return 0;
  const cashVal = Number(state.cashCushion.freeCash) || 0;
  const stocksVal = (state.cashCushion.holdings || []).reduce((sum, h) => {
    const price = Number(h.currentPrice ?? h.price) || 0;
    return sum + (Number(h.shares) || 0) * price;
  }, 0);
  return cashVal + stocksVal;
}

export function createInsightElement(
  tagName: string,
  className = '',
  text = ''
): HTMLElement {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

export function sentimentBadge(
  direction: SentimentDirection | string,
  label: string = sentimentLabel(direction as SentimentDirection)
): HTMLElement {
  const styles: Record<string, string> = {
    bullish: 'border-emerald-800 bg-emerald-950/50 text-emerald-300',
    bearish: 'border-rose-800 bg-rose-950/50 text-rose-300',
    neutral: 'border-slate-700 bg-slate-900 text-slate-300',
    unknown: 'border-slate-800 bg-slate-950 text-slate-500'
  };
  const badge = createInsightElement(
    'span',
    `inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${styles[direction] || styles.unknown}`,
    label
  );
  badge.dataset.sentiment = direction;
  badge.title =
    direction === 'unknown'
      ? 'The selected data source did not provide a sentiment signal.'
      : 'A directional marker based only on the provider values shown in this section.';
  return badge;
}

export function formatQuoteMetadata(
  holding: { quoteUpdatedAt?: number; quoteSource?: string },
  refreshIntervalMs = 60000
): string {
  if (!holding.quoteUpdatedAt) return holding.quoteSource || 'Not fetched';

  const updatedAt = Number(holding.quoteUpdatedAt);
  if (!Number.isFinite(updatedAt)) return holding.quoteSource || 'Not fetched';
  const time = new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const isStale = Date.now() - updatedAt > Math.max(5 * 60 * 1000, refreshIntervalMs * 2);
  return `${isStale ? 'Stale · ' : ''}${holding.quoteSource || 'Quote'} · ${time}`;
}

export function createDailyQuoteLabel(details?: QuoteDetails | null): HTMLElement | null {
  if (!details || typeof details !== 'object') return null;
  const hasChange = Number.isFinite(details.change) && Number.isFinite(details.changePercent);
  const hasRange = Number.isFinite(details.high) && Number.isFinite(details.low);
  if (!hasChange && !hasRange) return null;

  const label = document.createElement('span');
  label.className = 'mt-0.5 block text-[9px] font-normal tabular-nums';
  const parts: string[] = [];
  if (hasChange && details.change !== undefined && details.changePercent !== undefined) {
    const sign = details.change >= 0 ? '+' : '−';
    parts.push(
      `${sign}$${formatUSD(Math.abs(details.change))} (${sign}${Math.abs(details.changePercent).toFixed(2)}%)`
    );
    label.classList.add(
      details.change > 0
        ? 'text-emerald-400'
        : details.change < 0
          ? 'text-rose-400'
          : 'text-slate-400'
    );
  } else {
    label.classList.add('text-slate-400');
  }
  if (hasRange) parts.push(`H $${formatUSD(details.high)} / L $${formatUSD(details.low)}`);
  label.textContent = `Day: ${parts.join(' · ')}`;
  return label;
}

export function formatRiskTrigger(triggerValue: number, currentValue: number): string {
  if (currentValue <= 0) return `Position value $${formatUSD(triggerValue)}`;

  const bufferPct = ((currentValue - triggerValue) / currentValue) * 100;
  if (bufferPct < 0) {
    return `Position value $${formatUSD(triggerValue)} (already ${Math.abs(bufferPct).toFixed(1)}% below trigger)`;
  }
  return `Position value $${formatUSD(triggerValue)} (${bufferPct.toFixed(1)}% buffer)`;
}

export function renderMarginRisk(
  debt: number,
  positionValue: number,
  collateral: number,
  rules: BrokerRules
): void {
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
  let riskLevel: string;
  let riskClass: string;

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
  riskSummary.innerText = `${riskLevel} · ${Number.isFinite(equityRatio) ? `${equityRatio.toFixed(1)}% equity` : 'negative equity'
    } (${maintenanceRatio.toFixed(1)}% maintenance)`;
  riskSummary.className = `${riskClass} font-bold font-mono`;

  const marginCallAssetsRequired = debt / (1 - rules.maintenanceMarginRatio);
  const stopOutAssetsRequired = debt / (1 - rules.stopOutRatio);
  marginCallRow?.classList.toggle('hidden', collateral >= marginCallAssetsRequired);
  stopOutRow?.classList.toggle('hidden', collateral >= stopOutAssetsRequired);
  const marginCallValue = Math.max(0, marginCallAssetsRequired - collateral);
  const stopOutValue = Math.max(0, stopOutAssetsRequired - collateral);

  const marginCallEl = document.getElementById('boardMarginCall');
  const stopOutEl = document.getElementById('boardStopOut');
  if (marginCallEl && marginCallValue > 0)
    marginCallEl.innerText = formatRiskTrigger(marginCallValue, positionValue);
  if (stopOutEl && collateral < stopOutAssetsRequired)
    stopOutEl.innerText = formatRiskTrigger(stopOutValue, positionValue);
}

export function renderPositionsTable(
  gross: number,
  totalComms: number,
  debtToUse: number,
  marginChargedToUse: number,
  entryDate?: string,
  dailyRate: number = 0
): void {
  const tableBody = document.getElementById('projectionTableBody');
  if (!tableBody) return;

  const table = tableBody.closest('table');
  if (table) {
    const parent = table.parentElement;
    if (parent && parent.id === 'projectionTableContainer') {
      parent.classList.add('table-scroll-wrapper');
    } else if (parent && !parent.classList.contains('table-scroll-wrapper')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'table-scroll-wrapper';
      parent.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    }
  }

  tableBody.innerHTML = '';

  if (debtToUse > 0 || gross > 0) {
    getUsEquityProjectionDates(new Date(), entryDate).forEach((item) => {
      const { date, daysFromToday, kind } = item;
      const dateFormatted = date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      });
      if (kind === 'entry') {
        const entryRow = document.createElement('tr');
        entryRow.className = 'border-b border-slate-800/50 text-slate-500';
        entryRow.innerHTML = `
          <td class="py-1.5 px-3 text-left projection-date-cell">
            <span class="text-[10px] font-medium text-slate-400">Entry</span>
            <span class="text-[10px] text-slate-500 font-mono">${dateFormatted}</span>
          </td>
          <td colspan="4" class="py-1.5 px-3 text-[10px] italic text-left">Position opened · projection values start today</td>
        `;
        tableBody.appendChild(entryRow);
        return;
      }

      let subtext = '';
      if (kind === 'today') {
        subtext = '<span class="text-xs text-sky-400 font-mono">TODAY</span>';
      } else if (kind === 'next-trading-day' || kind === 'week-end') {
        const defaultTag = kind === 'week-end' ? `EOW · +${daysFromToday}d` : `NTD · +${daysFromToday}d`;
        const tag = (item.label || defaultTag).replace(/^\(\vert{}\)$/g, '');
        subtext = `<span class="text-xs text-slate-400 font-mono">${tag}</span>`;
      } else {
        const tag = (item.label || `+${daysFromToday}d`).replace(/^\(\vert{}\)$/g, '');
        subtext = `<span class="text-xs text-slate-500 font-mono">${tag}</span>`;
      }

      const b_t = calculateCompoundedDebt(debtToUse, dailyRate, daysFromToday);
      const additionalAccrual = calculateMarginInterest(debtToUse, dailyRate, daysFromToday);
      const m_d = marginChargedToUse + additionalAccrual;
      const fee_c = calculateAccruedFees(totalComms, marginChargedToUse, additionalAccrual);
      const net_p = gross - fee_c;
      const dr = b_t * dailyRate;

      const tr = document.createElement('tr');
      tr.className = kind === 'today' ? 'bg-slate-900/80 font-bold' : 'hover:bg-slate-900/40';
      const netClass = net_p >= 0 ? 'text-emerald-400' : 'text-rose-400';
      const netSign = net_p >= 0 ? '+' : '';

      tr.innerHTML = `
        <td class="py-2 px-3 text-left text-slate-300 font-semibold projection-date-cell">
          <span>${dateFormatted}</span>
          ${subtext}
        </td>
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

export function renderCashCushion(state: BoardState, options: RenderCashCushionOptions = {}): void {
  const { onFetchLivePrice, onRemoveCashStock, refreshIntervalMs = 60000 } = options;
  if (!state.cashCushion) state.cashCushion = { freeCash: 0.0, holdings: [] };

  const container = document.getElementById('cashCushionContainer');
  if (container && !document.getElementById('cashBalanceDebtMeta')) {
    render(
      h(CashCushionDesk, {
        onFetchLivePrice,
        onRemoveCashStock,
        refreshIntervalMs
      }),
      container
    );
    return;
  }

  const freeCash = Number(state.cashCushion.freeCash) || 0;
  const marginDebt = Math.abs(Number(state.balance) || 0);
  const signedBalance = freeCash + (Number(state.balance) || 0);

  const freeCashInput = document.getElementById('freeCashInput') as HTMLInputElement | null;
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

  holdings.forEach((h) => {
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
    tr.className = 'hover:bg-slate-900/40';
    const addCell = (content: string, className: string): HTMLElement => {
      const cell = document.createElement('td');
      cell.className = className;
      cell.textContent = content;
      tr.appendChild(cell);
      return cell;
    };
    const tickerCell = addCell('', 'py-2 px-3 text-cyan-300 font-bold');
    const tickerContainer = createInsightElement('div', 'inline-flex items-center gap-1.5');
    tickerContainer.append(
      createInsightElement('span', '', h.ticker),
      sentimentBadge(
        Number.isFinite(h.quoteDetails?.change)
          ? (h.quoteDetails!.change! > 0
            ? 'bullish'
            : h.quoteDetails!.change! < 0
              ? 'bearish'
              : 'neutral')
          : 'unknown',
        Number.isFinite(h.quoteDetails?.change)
          ? `${h.quoteDetails!.changePercent!.toFixed(2)}%`
          : undefined
      )
    );
    tickerCell.appendChild(tickerContainer);
    addCell(
      shares.toLocaleString('en-US', { maximumFractionDigits: 3 }),
      'py-2 px-3 text-right text-slate-200 tabular-nums w-20 whitespace-nowrap'
    );
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
  tableFooter.innerHTML =
    holdings.length > 0
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

export function renderSummaryCards(
  state: BoardState,
  options: RenderSummaryCardsOptions
): void {
  const { rules, onRenderAnalystConsensus, refreshIntervalMs = 60000 } = options;
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
    let totalGrossTarget = 0;
    let totalMarginCharged = state.realizedMarginCharged || 0;

    tickers.forEach((t) => {
      const pos = state.positions![t];
      const cost = (pos.tranches || []).reduce((sum, tr) => sum + tr.qty * tr.price, 0);
      totalInvested += cost;
      totalMarketValue += pos.shares * pos.currentPrice;
      totalCommBuy += pos.commBuy;
      const valSell = pos.shares * pos.pt;
      totalCommSell += calculateCommission(pos.shares, valSell, rules as any);
      totalGrossTarget += valSell - cost;
    });

    const tranchesForCombined =
      state.tranches || tickers.flatMap((t) => state.positions![t]?.tranches || []);
    const openMarginCharged = calculateMarginInterest(tranchesForCombined as any, {
      dailyRate,
      marginDebt: Math.abs(Number(state.balance) || 0),
      totalDebt: Math.abs(Number(state.balance) || 0)
    } as any);
    totalMarginCharged += openMarginCharged;

    const totalComms = totalCommBuy + totalCommSell;
    const net0 = totalGrossTarget - totalComms - totalMarginCharged;
    const netPct = totalInvested > 0 ? (net0 / totalInvested) * 100 : 0;
    const totalUnrealized = totalMarketValue - totalInvested;
    const unrealizedPct = totalInvested > 0 ? (totalUnrealized / totalInvested) * 100 : 0;
    const totalDebt = Math.abs(Number(state.balance) || 0);
    const dailyAccrual = totalDebt * dailyRate;

    const titleEl = document.getElementById('boardTitle');
    if (titleEl) {
      titleEl.innerText =
        tickers.length > 0
          ? `COMBINED PORTFOLIO (${tickers.length} Positions | ${netPct >= 0 ? '+' : ''}${netPct.toFixed(2)}% Net Combined Target)`
          : `NO ACTIVE MARGIN POSITIONS`;
    }

    const tranchesEl = document.getElementById('boardTranches');
    if (tranchesEl) {
      tranchesEl.innerText =
        tickers.length > 0
          ? tickers
            .map((t) => `${t}: ${state.positions![t].shares}sh @ PT $${formatUSD(state.positions![t].pt)}`)
            .join(' | ')
          : 'None';
    }

    const investedEl = document.getElementById('boardInvested');
    if (investedEl) {
      investedEl.innerText = `$${formatUSD(totalInvested)} | Across ${tickers.length} Assets`;
    }

    const unSign = totalUnrealized >= 0 ? '+' : '';
    const priceEl = document.getElementById('boardPrice');
    if (priceEl) {
      priceEl.innerHTML = `$${formatUSD(totalMarketValue)} – <span class="${totalUnrealized >= 0 ? 'text-emerald-400' : 'text-rose-400'
        }">${unSign}$${formatUSD(totalUnrealized)} (${unSign}${unrealizedPct.toFixed(2)}%)</span>`;
    }

    const marginEl = document.getElementById('boardMargin');
    if (marginEl) {
      marginEl.innerText = `-$${formatUSD(totalDebt)} ($${formatUSD(dailyAccrual)}/day @ ${(dailyRate * 100).toFixed(4)}%)`;
    }

    const commsEl = document.getElementById('boardComms');
    if (commsEl) {
      commsEl.innerText = `$${formatUSD(totalComms)} ($${formatUSD(totalCommBuy)} buy / $${formatUSD(totalCommSell)} sell)`;
    }

    const marginChargedEl = document.getElementById('boardMarginCharged');
    if (marginChargedEl) {
      marginChargedEl.innerText = `$${formatUSD(totalMarginCharged)}`;
    }

    const cushionTotal = getCashCushionTotal(state);
    const cushionLabelEl = document.getElementById('boardCushionLabel');
    if (cushionLabelEl) cushionLabelEl.innerText = 'Cash / Collateral Cushion:';
    const cushionMetricEl = document.getElementById('boardCushionMetric');
    if (cushionMetricEl) cushionMetricEl.innerText = `+$${formatUSD(cushionTotal)}`;

    const quotes = tickers
      .map((ticker) => state.positions![ticker])
      .filter((position) => position.quoteUpdatedAt);
    const latestQuote = quotes.sort(
      (a, b) => (b.quoteUpdatedAt || 0) - (a.quoteUpdatedAt || 0)
    )[0];
    const quoteMetaEl = document.getElementById('boardQuoteMeta');
    if (quoteMetaEl) {
      quoteMetaEl.innerText = latestQuote
        ? `Latest portfolio quote · ${formatQuoteMetadata(latestQuote, refreshIntervalMs)}`
        : 'No live quotes fetched for margin positions';
    }

    const moveEl = document.getElementById('boardDailyMove');
    if (moveEl) moveEl.classList.remove('hidden');

    if (typeof onRenderAnalystConsensus === 'function' && tickers[0]) {
      onRenderAnalystConsensus(tickers[0]);
    }

    const totalAccountEquity = totalMarketValue + cushionTotal - totalDebt;
    const totalAccountAssets = totalMarketValue + cushionTotal;
    const equityPct =
      totalAccountAssets > 0 ? (totalAccountEquity / totalAccountAssets) * 100 : 0;
    const equityEl = document.getElementById('boardEquity');
    if (equityEl) {
      equityEl.innerText = `$${formatUSD(totalAccountEquity)} (${equityPct.toFixed(2)}%)`;
    }

    renderMarginRisk(totalDebt, totalMarketValue, cushionTotal, rules);
    renderPositionsTable(
      totalGrossTarget,
      totalComms,
      totalDebt,
      totalMarginCharged,
      state.startDate,
      dailyRate
    );
  } else {
    const pos =
      (state.activeView ? state.positions?.[state.activeView] : undefined) ||
      state.positions?.[tickers[0]];
    if (!pos) return;
    const totalInvested = (pos.tranches || []).reduce((sum, t) => sum + t.qty * t.price, 0);
    const avgPrice = pos.shares > 0 ? totalInvested / pos.shares : 0;
    const valSell = pos.shares * pos.pt;
    const commSell = calculateCommission(pos.shares, valSell, rules as any);
    const totalComms = pos.commBuy + commSell;
    const gross = valSell - totalInvested;

    const portfolioInvested = getTotalPortfolioInvested(state);
    const weight = portfolioInvested > 0 ? totalInvested / portfolioInvested : 1;

    const totalAccountDebt = Math.abs(Number(state.balance) || 0);
    const allocatedDebt = totalAccountDebt * weight;
    const totalCushion = getCashCushionTotal(state);
    const allocatedCushion = totalCushion * weight;
    const allocatedDailyAccrual = allocatedDebt * dailyRate;
    const tranches = state.tranches || pos.tranches || [];
    const posMarginCharged = calculateMarginInterest(tranches as any, {
      dailyRate,
      marginDebt: allocatedDebt,
      totalDebt: totalAccountDebt
    } as any);

    const net0 = gross - totalComms - posMarginCharged;
    const netPct = totalInvested > 0 ? (net0 / totalInvested) * 100 : 0;

    const currentMktVal = pos.shares * pos.currentPrice;
    const unrealized = currentMktVal - totalInvested;
    const unrealizedPct = avgPrice > 0 ? ((pos.currentPrice - avgPrice) / avgPrice) * 100 : 0;

    const titleEl = document.getElementById('boardTitle');
    if (titleEl) {
      titleEl.innerText = `${pos.ticker} (${pos.shares} Shares @ $${formatUSD(pos.pt)} PT | ${netPct >= 0 ? '+' : ''
        }${netPct.toFixed(2)}% Net Target)`;
    }

    const tranchesEl = document.getElementById('boardTranches');
    if (tranchesEl) {
      tranchesEl.innerText =
        pos.tranches && pos.tranches.length > 0
          ? pos.tranches
            .map((t) => `${t.qty} @ $${formatUSD(t.price)} (${formatTrancheDate(t.date)})`)
            .join(' + ')
          : 'None';
    }

    const investedEl = document.getElementById('boardInvested');
    if (investedEl) {
      investedEl.innerText = `$${formatUSD(totalInvested)} | $${formatUSD(avgPrice)}`;
    }

    const unSign = unrealized >= 0 ? '+' : '';
    const priceEl = document.getElementById('boardPrice');
    if (priceEl) {
      priceEl.innerHTML = `$${formatUSD(pos.currentPrice)} | $${formatUSD(currentMktVal)} – <span class="${unrealized >= 0 ? 'text-emerald-400' : 'text-rose-400'
        }">${unSign}$${formatUSD(unrealized)} (${unSign}${unrealizedPct.toFixed(2)}%)</span>`;
    }

    const boardDailyQuote = document.getElementById('boardDailyQuote');
    const dailyQuoteLabel = createDailyQuoteLabel(pos.quoteDetails);
    if (boardDailyQuote) {
      boardDailyQuote.textContent = dailyQuoteLabel?.textContent || '';
      boardDailyQuote.className =
        dailyQuoteLabel?.className || 'block text-[10px] text-slate-500';
    }

    if (typeof onRenderAnalystConsensus === 'function') {
      onRenderAnalystConsensus(pos.ticker);
    }

    const isFullDebt = Math.abs(allocatedDebt - totalAccountDebt) < 0.01;
    const marginEl = document.getElementById('boardMargin');
    if (marginEl) {
      marginEl.innerText = isFullDebt
        ? `-$${formatUSD(allocatedDebt)} ($${formatUSD(allocatedDailyAccrual)}/day)`
        : `-$${formatUSD(allocatedDebt)} ($${formatUSD(allocatedDailyAccrual)}/day) [${(
          (allocatedDebt / (totalAccountDebt || 1)) *
          100
        ).toFixed(0)}% of -$${formatUSD(totalAccountDebt)} Total]`;
    }

    const commsEl = document.getElementById('boardComms');
    if (commsEl) {
      commsEl.innerText = `$${formatUSD(totalComms)} ($${formatUSD(pos.commBuy)} buy / $${formatUSD(commSell)} sell)`;
    }

    const marginChargedEl = document.getElementById('boardMarginCharged');
    if (marginChargedEl) {
      marginChargedEl.innerText = `$${formatUSD(posMarginCharged)} (Position To Date)`;
    }

    const cushionLabelEl = document.getElementById('boardCushionLabel');
    if (cushionLabelEl) cushionLabelEl.innerText = 'Allocated Cash / Collateral:';
    const cushionMetricEl = document.getElementById('boardCushionMetric');
    if (cushionMetricEl) cushionMetricEl.innerText = `+$${formatUSD(allocatedCushion)}`;

    const quoteMetaEl = document.getElementById('boardQuoteMeta');
    if (quoteMetaEl) quoteMetaEl.innerText = formatQuoteMetadata(pos, refreshIntervalMs);

    const positionAssets = currentMktVal + allocatedCushion;
    const positionEquity = positionAssets - allocatedDebt;
    const equityPct = positionAssets > 0 ? (positionEquity / positionAssets) * 100 : 0;
    const equityEl = document.getElementById('boardEquity');
    if (equityEl) {
      equityEl.innerText = `$${formatUSD(positionEquity)} (${equityPct.toFixed(2)}%)`;
    }

    renderMarginRisk(allocatedDebt, currentMktVal, allocatedCushion, rules);
    renderPositionsTable(
      gross,
      totalComms,
      allocatedDebt,
      posMarginCharged,
      pos.startDate || state.startDate,
      dailyRate
    );
  }
}

export function renderBoard(state: BoardState, options: RenderBoardOptions): void {
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
    onUpdateLastDeskView = () => { }
  } = options;

  const tickers = Object.keys(state.positions || {});
  const tabsContainer = document.getElementById('tickerTabs');
  if (tabsContainer) tabsContainer.innerHTML = '';

  const isCushionActive =
    state.activeView === 'CASH_CUSHION' || state.activeView === 'BALANCE';
  const isClosedHistoryActive = state.activeView === 'CLOSED_HISTORY';
  const isSettingsActive = state.activeView === 'SETTINGS';

  const emptyPanel = document.getElementById('emptyStatePanel');
  if (emptyPanel) {
    emptyPanel.classList.toggle(
      'hidden',
      !(tickers.length === 0 && !isCushionActive && !isClosedHistoryActive)
    );
  }

  if (tabsContainer) {
    if (tickers.length > 0) {
      const updateQuotesBtn = document.createElement('button');
      updateQuotesBtn.title = 'Update quotes';
      updateQuotesBtn.className =
        'h-8 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-cyan-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center justify-center text-center gap-1';
      updateQuotesBtn.id = 'refreshQuotesButton';
      updateQuotesBtn.innerHTML = `<span>↻</span>`;
      updateQuotesBtn.onclick = () => {
        if (
          typeof window !== 'undefined' &&
          typeof (window as any).refreshAllLivePrices === 'function'
        ) {
          (window as any).refreshAllLivePrices();
        }
      };
      tabsContainer.appendChild(updateQuotesBtn);
    }

    if (tickers.length === 0) {
      if (!isCushionActive && !isClosedHistoryActive && !isSettingsActive) {
        setTimeout(() => onSetActiveView?.('COMBINED'), 0);
      }
      const emptyLabel = document.createElement('span');
      emptyLabel.className = 'text-xs font-bold text-slate-500 uppercase tracking-wider';
      emptyLabel.innerText = 'NO ACTIVE TRADES';
      tabsContainer.appendChild(emptyLabel);
    } else if (tickers.length === 1) {
      if (
        !isCushionActive &&
        !isClosedHistoryActive &&
        !isSettingsActive &&
        state.activeView !== tickers[0]
      ) {
        setTimeout(() => onSetActiveView?.(tickers[0]), 0);
      }
      const btn = document.createElement('button');
      btn.className = `px-3 py-1 rounded text-xs font-bold transition ${state.activeView === tickers[0]
        ? 'bg-emerald-600 text-black'
        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
        }`;
      btn.innerText = `MARGIN: ${tickers[0]}`;
      btn.onclick = () => onSetActiveView?.(tickers[0]);
      tabsContainer.appendChild(btn);
    } else {
      if (
        !isCushionActive &&
        !isClosedHistoryActive &&
        !isSettingsActive &&
        state.activeView !== 'COMBINED' &&
        !state.positions?.[state.activeView || '']
      ) {
        setTimeout(() => onSetActiveView?.('COMBINED'), 0);
      }

      const combinedBtn = document.createElement('button');
      combinedBtn.className = `px-3 py-1 rounded text-xs font-bold transition ${state.activeView === 'COMBINED'
        ? 'bg-emerald-600 text-black'
        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
        }`;
      combinedBtn.innerText = 'COMBINED PORTFOLIO';
      combinedBtn.onclick = () => onSetActiveView?.('COMBINED');
      tabsContainer.appendChild(combinedBtn);

      tickers.forEach((t) => {
        const btn = document.createElement('button');
        btn.className = `px-3 py-1 rounded text-xs font-bold transition ${state.activeView === t
          ? 'bg-emerald-600 text-black'
          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
          }`;
        btn.innerText = t;
        btn.onclick = () => onSetActiveView?.(t);
        tabsContainer.appendChild(btn);
      });
    }

    const cushionTotal = getCashCushionTotal(state);
    const cushionBtn = document.createElement('button');
    cushionBtn.className = `px-3 py-1 rounded text-xs font-bold transition flex items-center gap-1.5 ${isCushionActive
      ? 'bg-cyan-500 text-black'
      : 'bg-slate-900 border border-cyan-800/60 text-cyan-400 hover:bg-slate-800'
      }`;
    cushionBtn.innerHTML = `<span>🛡️ BALANCE</span> <span class="text-[10px] px-1.5 py-0.2 rounded ${isCushionActive ? 'bg-cyan-800 text-white' : 'bg-cyan-950 text-cyan-300 font-mono'
      }">+$${cushionTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>`;
    cushionBtn.onclick = () => onSetActiveView?.('CASH_CUSHION');
    tabsContainer.appendChild(cushionBtn);

    const closedTrades = state.closedTrades || [];
    const closedHistoryBtn = document.createElement('button');
    closedHistoryBtn.className = `px-3 py-1 rounded text-xs font-bold transition ${isClosedHistoryActive
      ? 'bg-purple-500 text-black'
      : 'bg-slate-900 border border-purple-800/60 text-purple-300 hover:bg-slate-800'
      }`;
    closedHistoryBtn.innerText = `CLOSED HISTORY (${closedTrades.length})`;
    closedHistoryBtn.onclick = () => onSetActiveView?.('CLOSED_HISTORY');
    tabsContainer.appendChild(closedHistoryBtn);
    const closedTradesCount = document.getElementById('closedTradesCount');
    if (closedTradesCount) {
      closedTradesCount.textContent = `${closedTrades.length} realized exit${closedTrades.length === 1 ? '' : 's'
        }`;
    }

    const settingsBtn = document.createElement('button');
    settingsBtn.className = isSettingsActive
      ? 'px-3 py-1.5 rounded text-xs font-bold bg-blue-600 text-white transition'
      : 'px-3 py-1.5 rounded text-xs font-bold border-blue-600 text-white border border-slate-700 hover:bg-slate-800 transition';
    settingsBtn.id = 'settingsBtn';
    settingsBtn.innerHTML = `<span>⚙️ SETTINGS</span>`;
    settingsBtn.onclick = () => onSetActiveView?.('SETTINGS');
    tabsContainer.appendChild(settingsBtn);
  }

  const mainDesk = document.getElementById('mainDeskContainer');
  const cushionDesk = document.getElementById('cashCushionContainer');
  const closedHistoryDesk = document.getElementById('closedHistoryContainer');
  const settingsDesk = document.getElementById('settings');

  let activeDesk: HTMLElement | null = null;
  let activeDeskView: string | null = null;

  if (isCushionActive) {
    mainDesk?.classList.add('hidden');
    settingsDesk?.classList.add('hidden');
    cushionDesk?.classList.remove('hidden');
    closedHistoryDesk?.classList.add('hidden');
    renderCashCushion(state, { onFetchLivePrice, onRemoveCashStock, refreshIntervalMs });
    activeDesk = cushionDesk;
    activeDeskView = 'CASH_CUSHION';
  } else if (isClosedHistoryActive) {
    mainDesk?.classList.add('hidden');
    cushionDesk?.classList.add('hidden');
    settingsDesk?.classList.add('hidden');
    closedHistoryDesk?.classList.remove('hidden');
    onRenderClosedHistory?.();
    activeDesk = closedHistoryDesk;
    activeDeskView = 'CLOSED_HISTORY';
  } else if (isSettingsActive) {
    mainDesk?.classList.add('hidden');
    cushionDesk?.classList.add('hidden');
    closedHistoryDesk?.classList.add('hidden');
    activeDesk = settingsDesk;
    activeDeskView = 'SETTINGS';
    settingsDesk?.classList.remove('hidden');
  } else {
    mainDesk?.classList.remove('hidden');
    cushionDesk?.classList.add('hidden');
    closedHistoryDesk?.classList.add('hidden');
    settingsDesk?.classList.add('hidden');

    renderSummaryCards(state, { rules, onRenderAnalystConsensus, refreshIntervalMs });
    activeDesk = mainDesk;
    activeDeskView = state.activeView || null;
  }

  onRenderExternalLinks?.();
  onRenderConsoleQuickActions?.();

  if (activeDesk && activeDeskView && activeDeskView !== lastDeskView) {
    activeDesk.classList.remove('ui-view-enter');
    void activeDesk.offsetWidth;
    activeDesk.classList.add('ui-view-enter');
    activeDesk.addEventListener(
      'animationend',
      () => activeDesk?.classList.remove('ui-view-enter'),
      { once: true }
    );
    onUpdateLastDeskView(activeDeskView);
  }

  onUpdateCombinedBreakeven?.();
  onSyncMarketInsightsPanel?.();
}