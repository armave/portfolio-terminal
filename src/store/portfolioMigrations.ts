import type { Holding, PortfolioState, PositionRecord, Tranche, TrancheItem } from '../types/portfolio';

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Import legacy active holdings only when a canonical position for that ticker
 * does not already exist. Existing canonical records always win.
 */
export function migrateLegacyHoldingsToPositions(
  sourcePositions: Record<string, PositionRecord>,
  legacyHoldings: Holding[],
  fallbackDate = todayIso()
): Record<string, PositionRecord> {
  const positions: Record<string, PositionRecord> = { ...(sourcePositions || {}) };

  for (const holding of Array.isArray(legacyHoldings) ? legacyHoldings : []) {
    const ticker = String(holding?.ticker || '').trim().toUpperCase();
    if (!ticker || positions[ticker]) continue;

    const tranches: TrancheItem[] = (Array.isArray(holding.tranches) ? holding.tranches : [])
      .map((tranche) => ({
        qty: Number(tranche.shares) || 0,
        price: Number(tranche.entryPrice) || 0,
        date: tranche.purchaseDate || fallbackDate
      }))
      .filter((tranche) => tranche.qty > 0 && tranche.price > 0);

    const shares = tranches.reduce((sum, tranche) => sum + tranche.qty, 0);
    if (shares <= 0) continue;

    const averagePrice = tranches.reduce((sum, tranche) => sum + tranche.qty * tranche.price, 0) / shares;
    const earliestDate = tranches
      .map((tranche) => tranche.date)
      .filter((date): date is string => Boolean(date))
      .sort()[0] || fallbackDate;

    positions[ticker] = {
      ticker,
      shares,
      currentPrice: Number(holding.currentPrice) || averagePrice,
      pt: Number(holding.analystTarget) || Number((averagePrice * 1.1).toFixed(2)),
      commBuy: 0,
      startDate: earliestDate,
      tranches
    };
  }

  return positions;
}

/** Build the read-only legacy holdings view from canonical positions. */
export function buildHoldingsProjection(
  positions: Record<string, PositionRecord>,
  legacyHoldings: Holding[],
  fallbackDate = todayIso()
): Holding[] {
  // Index compatibility metadata once. The previous per-position find() scanned
  // the full legacy array for every ticker, which made normalization quadratic.
  // Keep the first matching row to preserve Array.find() compatibility semantics.
  const legacyByTicker = new Map<string, Holding>();
  for (const holding of Array.isArray(legacyHoldings) ? legacyHoldings : []) {
    const legacyTicker = String(holding?.ticker || '').trim().toUpperCase();
    if (legacyTicker && !legacyByTicker.has(legacyTicker)) {
      legacyByTicker.set(legacyTicker, holding);
    }
  }

  return Object.keys(positions).map((ticker) => {
    const position = positions[ticker];
    const legacy = legacyByTicker.get(ticker);
    const tranches: Tranche[] = (position.tranches || []).map((tranche, index) => ({
      id: `${ticker}-${index}`,
      shares: Number(tranche.qty) || 0,
      entryPrice: Number(tranche.price) || 0,
      purchaseDate: tranche.date || position.startDate || fallbackDate,
      targetPrice: position.pt
    }));

    return {
      ...legacy,
      ticker,
      isMargin: true,
      tranches,
      currentPrice: position.currentPrice,
      analystTarget: position.pt
    };
  });
}


/**
 * Upgrade a legacy-only cloud snapshot without letting stale holdings override
 * canonical local positions or resurrect a ticker closed locally after its
 * latest legacy purchase.
 */
export function migrateLegacyCloudHoldingsToPositions(
  cloudState: Partial<PortfolioState>,
  localState: Partial<PortfolioState>,
  fallbackDate = todayIso()
): Partial<PortfolioState> {
  if (Object.prototype.hasOwnProperty.call(cloudState, 'positions')) return cloudState;

  const localPositions = (localState.positions || {}) as Record<string, PositionRecord>;
  const localClosedTrades = Array.isArray(localState.closedTrades) ? localState.closedTrades : [];
  const legacyHoldings = Array.isArray(cloudState.holdings) ? cloudState.holdings : [];

  // Index the latest local exit once instead of scanning the full trade history
  // for every legacy holding. Keep the same date-field precedence and zero fallback
  // as the former per-holding filter/map/reduce sequence.
  const latestCloseByTicker = new Map<string, number>();
  for (const trade of localClosedTrades) {
    const ticker = String(trade?.ticker || '').trim().toUpperCase();
    if (!ticker) continue;

    const value = trade.closedAt ?? trade.exitDate ?? trade.sellDate ?? trade.date;
    const timestamp = typeof value === 'number' ? value : Date.parse(String(value || ''));
    const normalizedTimestamp = Number.isFinite(timestamp) ? timestamp : 0;
    const previousTimestamp = latestCloseByTicker.get(ticker) ?? 0;
    if (normalizedTimestamp > previousTimestamp) {
      latestCloseByTicker.set(ticker, normalizedTimestamp);
    }
  }

  const safeHoldings = legacyHoldings.filter((holding) => {
    const ticker = String(holding?.ticker || '').trim().toUpperCase();
    if (!ticker || localPositions[ticker]) return false;

    const latestClose = latestCloseByTicker.get(ticker) ?? 0;
    if (!latestClose) return true;

    const latestLegacyPurchase = (Array.isArray(holding.tranches) ? holding.tranches : [])
      .map((tranche) => Date.parse(String(tranche.purchaseDate || '')))
      .filter(Number.isFinite)
      .reduce((latest, timestamp) => Math.max(latest, timestamp), 0);

    // A legacy holding is only considered reopened if it has a purchase date
    // strictly later than the most recent locally recorded exit.
    return latestLegacyPurchase > latestClose;
  });

  return {
    ...cloudState,
    positions: migrateLegacyHoldingsToPositions(localPositions, safeHoldings, fallbackDate)
  };
}
