import type { BoardState } from '../types/portfolio';

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
  const stocksVal = (state.cashCushion.holdings || []).reduce((sum, h) => {
    const price = Number(h.currentPrice ?? h.price) || 0;
    return sum + (Number(h.shares) || 0) * price;
  }, 0);
  return cashVal + stocksVal;
}
