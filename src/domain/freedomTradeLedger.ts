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
  // An empty response is not sufficient evidence that the account has no
  // open margin positions: TradeNet can return an empty/unexpected history
  // shape while the live Balance snapshot still contains holdings. Never turn
  // an empty history payload into an authoritative liquidation of the portfolio.
  if (trades.length === 0) {
    return { reliable: false, positions: {}, reason: 'TradeNet returned no executions; refusing to infer that all margin positions are closed.' };
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

    const ticker = String(trade.ticker ?? '').trim().toUpperCase().replace(/\.US$/i, '');
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

  const transferredByTicker = new Map<string, NonNullable<PositionRecord['tranches']>>();
  for (const [key, previous] of Object.entries(currentPositions || {})) {
    const ticker = String(previous.ticker || key).trim().toUpperCase().replace(/\\.US$/i, '');
    const transfers = (previous.tranches || [])
      .filter(tranche => tranche.classificationTransfer)
      .map(tranche => ({ ...tranche, qty: Math.max(0, Number(tranche.qty) || 0) }));
    if (!ticker || transfers.length === 0) continue;
    for (const tranche of transfers) {
      const watermark = Number(tranche.afterTradeId || 0);
      const laterSells = ordered.filter(trade => {
        const tradeTicker = String(trade.ticker ?? '').trim().toUpperCase().replace(/\\.US$/i, '');
        const side = String(trade.side ?? '').trim().toUpperCase();
        const id = Number(trade.id);
        return tradeTicker === ticker && ['SELL', '2'].includes(side) &&
          Number.isFinite(id) && id > watermark;
      });
      let remaining = Math.max(0, Number(tranche.qty) || 0);
      for (const sale of laterSells) {
        const sold = Number(sale.quantity);
        if (Number.isFinite(sold) && sold > 0) remaining = Math.max(0, remaining - sold);
        if (remaining <= 1e-6) break;
      }
      tranche.qty = remaining;
    }
    const active = transfers.filter(tranche => tranche.qty > 1e-6);
    if (active.length) transferredByTicker.set(ticker, active);
  }

  const positions: Record<string, PositionRecord> = {};
  for (const [ticker, row] of ledger) {
    if (row.quantity <= 1e-6) continue;
    const previous = Object.values(currentPositions).find(position =>
      String(position.ticker ?? '').trim().toUpperCase().replace(/\.US$/i, '') === ticker
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
  // Manual cash-to-margin allocations are persisted tranches, not broker buys.
  // Add their surviving quantities after applying only post-transfer sells.
  for (const [ticker, tranches] of transferredByTicker) {
    const transferShares = tranches.reduce((sum, tranche) => sum + tranche.qty, 0);
    if (transferShares <= 1e-6) continue;
    const existing = positions[ticker];
    const previous = Object.values(currentPositions).find(position =>
      String(position.ticker ?? '').trim().toUpperCase().replace(/\\.US$/i, '') === ticker
    );
    const brokerTranches = (existing?.tranches || []).filter(tranche => !tranche.classificationTransfer);
    const allTranches = [...brokerTranches, ...tranches];
    const shares = (existing?.shares || 0) + transferShares;
    positions[ticker] = {
      ...(existing || previous || { ticker, pt: 0, commBuy: 0, currentPrice: 0 }),
      ticker,
      shares,
      tranches: allTranches,
      currentPrice: Number(existing?.currentPrice || previous?.currentPrice) ||
        (tranches.reduce((sum, tranche) => sum + tranche.qty * Number(tranche.price || 0), 0) / transferShares),
      pt: Number(existing?.pt) || 0
    };
  }
  return { reliable: true, positions };
}
