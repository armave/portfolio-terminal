export interface FreedomPortfolioSnapshotLike {
  loaded: boolean;
  balances: Array<{ currency: string; amount: number; [key: string]: unknown }>;
  positions: Array<{ ticker: string; quantity: number; marketPrice: number | null; [key: string]: unknown }>;
  [key: string]: unknown;
}

interface FreedomQuantityMismatch {
  ticker: string;
  marginQuantity: number;
  freedomQuantity: number;
}

export interface FreedomReconciliationResult {
  brokerUsdBalance?: { amount: number };
  positions: Record<string, any>;
  cashStocks: any[];
  mismatches: FreedomQuantityMismatch[];
}

function tickerKey(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/\.US$/i, '');
}

function positiveFinite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * Prefer Freedom's live account snapshot without rewriting app-owned trade lots.
 * Broker quantities represent account totals; app-managed margin lots are
 * subtracted to derive cash holdings. Ambiguous quantity mismatches preserve
 * affected local cash quantities and are reported instead of guessed.
 */
export function reconcileFreedomPortfolio(
  snapshot: FreedomPortfolioSnapshotLike,
  sourcePositions: Record<string, any>,
  sourceCashHoldings: any[],
  receivedAt = Date.now()
): FreedomReconciliationResult {
  const usdBalance = snapshot.balances.find(
    item => String(item.currency ?? '').toUpperCase() === 'USD' && Number.isFinite(Number(item.amount))
  );

  const activeSourcePositions = Object.fromEntries(
    Object.entries(sourcePositions || {}).filter(([, position]) => {
      const shares = Number(position?.shares);
      return Number.isFinite(shares) && shares > 1e-6;
    })
  );
  const positions: Record<string, any> = { ...activeSourcePositions };
  const marginQuantities = new Map<string, number>();
  const marginPositionKeys = new Map<string, string[]>();

  for (const [key, position] of Object.entries(activeSourcePositions)) {
    const ticker = tickerKey(position?.ticker || key);
    const shares = Number(position?.shares);
    if (!ticker || !Number.isFinite(shares) || shares <= 0) continue;
    marginQuantities.set(ticker, (marginQuantities.get(ticker) || 0) + shares);
    marginPositionKeys.set(ticker, [...(marginPositionKeys.get(ticker) || []), key]);
  }

  const brokerByTicker = new Map<string, { ticker: string; quantity: number; marketPrice: number | null }>();
  for (const item of snapshot.positions) {
    const ticker = tickerKey(item?.ticker);
    const quantity = Number(item?.quantity);
    if (!ticker || !Number.isFinite(quantity) || quantity < 0) continue;
    const previous = brokerByTicker.get(ticker);
    const price = positiveFinite(item?.marketPrice);
    brokerByTicker.set(ticker, {
      ticker,
      quantity: (previous?.quantity || 0) + quantity,
      marketPrice: price ?? previous?.marketPrice ?? null
    });
  }

  // Broker prices update valuation only. Lots, quantities, cost basis, targets,
  // and app-owned commissions are deliberately unchanged.
  for (const [ticker, brokerPosition] of brokerByTicker) {
    if (brokerPosition.marketPrice === null) continue;
    for (const key of marginPositionKeys.get(ticker) || []) {
      const position = positions[key];
      positions[key] = {
        ...position,
        currentPrice: brokerPosition.marketPrice,
        quoteSource: 'Freedom TradeNet',
        quoteDetails: {
          ...(position.quoteDetails || {}),
          price: brokerPosition.marketPrice,
          freshness: 'unknown',
          receivedAt
        }
      };
    }
  }

  const mismatches: FreedomQuantityMismatch[] = [];
  const cashStocks: Array<Record<string, any>> = [];
  const priorCashByTicker = new Map<string, Record<string, any>>();
  for (const holding of Array.isArray(sourceCashHoldings) ? sourceCashHoldings : []) {
    const ticker = tickerKey(holding?.ticker);
    if (ticker && !priorCashByTicker.has(ticker)) priorCashByTicker.set(ticker, holding);
  }

  for (const [ticker, brokerPosition] of brokerByTicker) {
    const marginQuantity = marginQuantities.get(ticker) || 0;
    const freedomQuantity = brokerPosition.quantity;
    if (freedomQuantity + 1e-6 < marginQuantity) {
      mismatches.push({ ticker, marginQuantity, freedomQuantity });
      continue;
    }

    const cashQuantity = freedomQuantity - marginQuantity;
    if (cashQuantity > 1e-6) {
      cashStocks.push({
        ...(priorCashByTicker.get(ticker) || {}),
        ticker,
        shares: cashQuantity,
        ...(brokerPosition.marketPrice !== null ? { currentPrice: brokerPosition.marketPrice } : {})
      });
    }
  }

  for (const [ticker, marginQuantity] of marginQuantities) {
    if (!brokerByTicker.has(ticker) && marginQuantity > 1e-6) {
      mismatches.push({ ticker, marginQuantity, freedomQuantity: 0 });
    }
  }

  return {
    ...(usdBalance ? { brokerUsdBalance: { amount: Number(usdBalance.amount) } } : {}),
    positions,
    cashStocks,
    mismatches
  };
}
