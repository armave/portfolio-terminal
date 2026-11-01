import type { BoardState, BrokerAssumptions, PositionRecord } from '../types/portfolio';
import { getPositiveMarketPrice } from './portfolioValuation';
import {
  calculateCommission,
  calculateMarginInterest,
  collectOpenPositionTranches,
  resolveCommissionConfig
} from './portfolio';

/** Returns the cost basis of all open margin-position tranches. */
export function getTotalPortfolioInvested(state?: BoardState | null): number {
  if (!state || typeof state !== 'object') return 0;
  return Object.values(state.positions || {}).reduce((acc, pos) => {
    return acc + (pos?.tranches || []).reduce((sum, tr) => sum + tr.qty * tr.price, 0);
  }, 0);
}

/** Returns free cash plus the current market value of cash-cushion holdings. */
export function getCashCushionTotal(state?: BoardState | null): number {
  if (!state?.cashCushion) return 0;
  const cashVal = Number(state.cashCushion.freeCash) || 0;
  const stocksVal = (state.cashCushion.holdings || []).reduce((sum, holding) => {
    const price = getPositiveMarketPrice(holding.currentPrice, holding.price) ?? 0;
    const shares = Number(holding.shares);
    return sum + (Number.isFinite(shares) && shares > 0 ? shares * price : 0);
  }, 0);
  return cashVal + stocksVal;
}


/** Resolve the stock symbol whose quote context backs the market-insights panel. */
export function getMarketInsightsTicker(state?: BoardState | null): string {
  if (!state) return '';
  const currentView = state.activeView;
  const isPositionView = Boolean(
    currentView &&
    !['COMBINED', 'CASH_CUSHION', 'BALANCE', 'CLOSED_HISTORY', 'SETTINGS'].includes(currentView) &&
    state.positions?.[currentView]
  );
  if (isPositionView) return currentView || '';
  const tickers = Object.keys(state.positions || {});
  const preferredTicker = state.selectedTicker;
  if (preferredTicker && state.positions?.[preferredTicker]) return preferredTicker;
  return tickers[0] || '';
}


export interface PortfolioProjectionInputs {
  gross: number;
  totalComms: number;
  debtToUse: number;
  marginChargedToUse: number;
  entryDate?: string;
  dailyRate: number;
}

/** Resolve the chronologically earliest valid acquisition date for projection rows. */
export function resolvePositionEntryDate(
  tranches: Array<{ date?: string; purchaseDate?: string; acquiredAt?: number }> | undefined,
  fallbackDate?: string,
  now: Date = new Date()
): string | undefined {
  const parseTrancheDate = (value: unknown): string | undefined => {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      const date = new Date(value);
      return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : undefined;
    }
    if (typeof value !== 'string' || !value.trim()) return undefined;
    const raw = value.trim();
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      const [, year, month, day] = iso;
      const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
      return date.getUTCFullYear() === Number(year) &&
        date.getUTCMonth() === Number(month) - 1 &&
        date.getUTCDate() === Number(day)
        ? `${year}-${month}-${day}`
        : undefined;
    }

    // Tranche dates are also persisted/displayed in the legacy "22 Oct" form.
    const short = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,})$/) ||
      raw.match(/^([A-Za-z]{3,})\s+(\d{1,2})$/);
    if (!short) return undefined;
    const dayFirst = /^\d+$/.test(short[1]);
    const day = Number(dayFirst ? short[1] : short[2]);
    const monthName = (dayFirst ? short[2] : short[1]).slice(0, 3).toLowerCase();
    const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(monthName);
    if (month < 0 || day < 1 || day > 31) return undefined;
    const year = now.getFullYear();
    const date = new Date(Date.UTC(year, month, day));
    if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return undefined;
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const activeTrancheDates = (tranches || [])
    .map((tranche) => parseTrancheDate(tranche.date ?? tranche.purchaseDate ?? tranche.acquiredAt))
    .filter((date): date is string => Boolean(date))
    .sort((a, b) => a.localeCompare(b));

  return activeTrancheDates[0] || fallbackDate;
}

/** Calculate combined-view financial inputs shared by board summary and projections. */
export function calculateCombinedMetrics(
  state: BoardState,
  rules: BrokerAssumptions,
  tickers = Object.keys(state.positions || {}),
  dailyRate = rules.annualBorrowRate / rules.dayCountBasis
) {
  let totalInvested = 0;
  let totalCommBuy = 0;
  let totalCommSell = 0;
  let totalGrossTarget = 0;

  tickers.forEach((ticker) => {
    const position = state.positions?.[ticker];
    if (!position) return;
    const cost = (position.tranches || []).reduce((sum, tranche) => sum + tranche.qty * tranche.price, 0);
    totalInvested += cost;
    totalCommBuy += position.commBuy;
    const valueAtTarget = position.shares * position.pt;
    totalCommSell += calculateCommission(position.shares, valueAtTarget, resolveCommissionConfig(rules));
    totalGrossTarget += valueAtTarget - cost;
  });

  const totalDebt = Math.abs(Number(state.balance) || 0);
  const openMarginCharged = calculateMarginInterest(
    collectOpenPositionTranches(state.positions || {}),
    { dailyRate, marginDebt: totalDebt, totalDebt }
  );
  const totalMarginCharged = (state.realizedMarginCharged || 0) + openMarginCharged;
  const totalComms = totalCommBuy + totalCommSell;
  const net0 = totalGrossTarget - totalComms - totalMarginCharged;
  const netPct = totalInvested > 0 ? (net0 / totalInvested) * 100 : 0;

  return { totalInvested, totalGrossTarget, totalComms, totalMarginCharged, totalDebt, netPct };
}

/** Calculate the same single-position target, debt allocation, and financing inputs used by projections. */
export function calculatePositionMetrics(
  state: BoardState,
  position: PositionRecord,
  rules: BrokerAssumptions,
  dailyRate = rules.annualBorrowRate / rules.dayCountBasis
) {
  const totalInvested = (position.tranches || []).reduce((sum, tranche) => sum + tranche.qty * tranche.price, 0);
  const valueAtTarget = position.shares * position.pt;
  const commissionSell = calculateCommission(position.shares, valueAtTarget, resolveCommissionConfig(rules));
  const totalComms = position.commBuy + commissionSell;
  const gross = valueAtTarget - totalInvested;

  const portfolioInvested = getTotalPortfolioInvested(state);
  const weight = portfolioInvested > 0 ? totalInvested / portfolioInvested : 1;
  const totalAccountDebt = Math.abs(Number(state.balance) || 0);
  const allocatedDebt = totalAccountDebt * weight;

  const positionMarginCharged = calculateMarginInterest(position.tranches || [], {
    dailyRate,
    marginDebt: allocatedDebt,
    totalDebt: totalAccountDebt
  });
  const net0 = gross - totalComms - positionMarginCharged;
  const netPct = totalInvested > 0 ? (net0 / totalInvested) * 100 : 0;

  return { gross, totalComms, allocatedDebt, posMarginCharged: positionMarginCharged, netPct };
}

/** Derive the projections row inputs directly from canonical portfolio state. */
export function getPortfolioProjectionInputs(
  state: BoardState,
  rules: BrokerAssumptions
): PortfolioProjectionInputs {
  const tickers = Object.keys(state.positions || {});
  const dailyRate = rules.annualBorrowRate / rules.dayCountBasis;
  const isCombined = state.activeView === 'COMBINED' ||
    (tickers.length !== 1 && !state.positions?.[state.activeView || '']);

  if (isCombined) {
    const metrics = calculateCombinedMetrics(state, rules, tickers, dailyRate);
    return {
      gross: metrics.totalGrossTarget,
      totalComms: metrics.totalComms,
      debtToUse: metrics.totalDebt,
      marginChargedToUse: metrics.totalMarginCharged,
      entryDate: resolvePositionEntryDate(collectOpenPositionTranches(state.positions || {}), state.startDate),
      dailyRate
    };
  }

  const position = (state.activeView ? state.positions?.[state.activeView] : undefined) ||
    state.positions?.[tickers[0]];
  if (!position) {
    return { gross: 0, totalComms: 0, debtToUse: 0, marginChargedToUse: 0, dailyRate };
  }
  const metrics = calculatePositionMetrics(state, position, rules, dailyRate);
  return {
    gross: metrics.gross,
    totalComms: metrics.totalComms,
    debtToUse: metrics.allocatedDebt,
    marginChargedToUse: metrics.posMarginCharged,
    entryDate: resolvePositionEntryDate(position.tranches, position.startDate || state.startDate),
    dailyRate
  };
}
