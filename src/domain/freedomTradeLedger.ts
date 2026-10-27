import type { FreedomExecutedTrade } from '../services/api';
import type { PositionRecord } from '../types/portfolio';

export interface FreedomMarginLedgerResult {
  reliable: boolean;
  positions: Record<string, PositionRecord>;
  reason?: string;
}

/**
 * Rebuild active long margin stock positions from the authoritative executed
 * trade ledger. TradeNet's documented go_sum field is the initial margin per
 * execution: positive values identify margin executions, zero identifies cash,
 * and a missing value is ambiguous. Ambiguous rows fail closed.
 */
export function buildFreedomMarginLedger(
  trades: FreedomExecutedTrade[],
  currentPositions: Record<string, PositionRecord> = {}
): FreedomMarginLedgerResult {
  if (!Array.isArray(trades)) {
    return { reliable: false, positions: {}, reason: 'Trade history is not an array.' };
  }
  if (trades.some(trade => trade.marginClassification === 'unknown')) {
    return { reliable: false, positions: {}, reason: 'One or more executions lack TradeNet margin classification.' };
  }

  const ordered = [...trades].sort((a, b) => {
    const aid = Number(a.id);
    const bid = Number(b.id);
    if (Number.isFinite(aid) && Number.isFinite(bid) && aid !== bid) return aid - bid;
    const at = Date.parse(String(a.executedAt ?? ''));
    const bt = Date.parse(String(b.executedAt ?? ''));
    if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
    return String(a.id).localeCompare(String(b.id));
  });

  const ledger = new Map<string, { ticker: string; quantity: number; cost: number; commission: number; currentPrice: number }>();
  const seen = new Set<string>();
  for (const trade of ordered) {
    if (seen.has(String(trade.id))) continue;
    seen.add(String(trade.id));
    if (trade.marginClassification !== 'margin') continue;

    const ticker = String(trade.ticker ?? '').trim().toUpperCase().replace(/\\.US$/i, '');
    const quantity = Number(trade.quantity);
    const price = Number(trade.price);
    const side = String(trade.side ?? '').trim().toUpperCase();
    if (!ticker || !Number.isFinite(quantity) || quantity <= 0 ||
        !Number.isFinite(price) || price <= 0 ||
        !['BUY', '1', 'SELL', '2'].includes(side)) {
      return { reliable: false, positions: {}, reason: `Margin execution ${trade.id} is missing a valid ticker, side, quantity, or fill price.` };
    }

    const row = ledger.get(ticker) || { ticker, quantity: 0, cost: 0, commission: 0, currentPrice: 0 };
    if (side === 'BUY' || side === '1') {
      row.cost += quantity * price;
      row.quantity += quantity;
      row.commission += Number.isFinite(Number(trade.commission)) ? Number(trade.commission) : 0;
    } else {
      if (quantity > row.quantity + 1e-6) {
        return { reliable: false, positions: {}, reason: `Margin sell ${trade.id} exceeds known active margin shares for ${ticker}.` };
      }
      const averageCost = row.quantity > 0 ? row.cost / row.quantity : 0;
      row.quantity = Math.max(0, row.quantity - quantity);
      row.cost = row.quantity * averageCost;
      if (row.quantity <= 1e-6) {
        row.quantity = 0;
        row.cost = 0;
        row.commission = 0;
      }
    }
    ledger.set(ticker, row);
  }

  const positions: Record<string, PositionRecord> = {};
  for (const [ticker, row] of ledger) {
    if (row.quantity <= 1e-6) continue;
    const previous = Object.values(currentPositions).find(position =>
      String(position.ticker ?? '').trim().toUpperCase().replace(/\\.US$/i, '') === ticker
    );
    const price = Number(previous?.currentPrice);
    positions[ticker] = {
      ticker,
      shares: row.quantity,
      currentPrice: Number.isFinite(price) && price > 0 ? price : row.cost / row.quantity,
      pt: 0,
      commBuy: row.commission,
      ...(previous?.startDate ? { startDate: previous.startDate } : {}),
      ...(previous?.tranches ? { tranches: previous.tranches } : {}),
      quoteSource: previous?.quoteSource,
      ...(previous?.quoteDetails ? { quoteDetails: previous.quoteDetails } : {})
    };
  }
  return { reliable: true, positions };
}
