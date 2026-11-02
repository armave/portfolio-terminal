interface ValuationPositionLike {
  shares?: unknown;
  currentPrice?: unknown;
}

interface ValuationCashHoldingLike {
  shares?: unknown;
  currentPrice?: unknown;
  price?: unknown;
}

export interface PortfolioValuationInput {
  /** Signed broker/account cash balance: positive cash, negative margin debt. */
  signedAccountBalance?: unknown;
  /** App-tracked unallocated cash, kept separate from account debt. */
  freeCash?: unknown;
  marginPositions?: ValuationPositionLike[];
  cashHoldings?: ValuationCashHoldingLike[];
}

export interface PortfolioValuation {
  /** False when the signed account balance is missing or invalid. */
  accountBalanceAvailable: boolean;
  cashBalance: number;
  marginDebt: number;
  marginHoldingsValue: number;
  cashHoldingsValue: number;
  totalHoldingsValue: number;
  equity: number;
  pricedHoldings: number;
  unpricedHoldings: number;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getPositiveMarketPrice(...values: unknown[]): number | null {
  for (const value of values) {
    const price = finiteNumber(value);
    if (price !== null && price > 0) return price;
  }
  return null;
}

function marketValue(
  holding: ValuationPositionLike | ValuationCashHoldingLike,
  isCashHolding = false
): { value: number; priced: boolean; hasShares: boolean } {
  const shares = finiteNumber(holding?.shares);
  if (shares === null || shares <= 0) return { value: 0, priced: true, hasShares: false };
  const price = isCashHolding
    ? getPositiveMarketPrice(holding.currentPrice, (holding as ValuationCashHoldingLike).price)
    : getPositiveMarketPrice(holding.currentPrice);
  return {
    value: price === null ? 0 : shares * price,
    priced: price !== null,
    hasShares: true
  };
}

/**
 * Calculate current account cash and portfolio equity from tracked quantities
 * and their selected market-session prices. A signed account balance remains
 * separate from equity because the store uses it as cash/debt input for trades.
 */
export type PortfolioValuationReliability = 'current' | 'provisional' | 'incomplete';

export interface PortfolioValuationReliabilityInput {
  accountBalanceAvailable: boolean;
  unpricedHoldings: number;
  staleQuotes: number;
  delayedQuotes: number;
  unknownQuotes: number;
  unavailableQuotes: number;
}

/** Classify valuation confidence separately from its numeric estimate. */
export function getPortfolioValuationReliability(
  input: PortfolioValuationReliabilityInput
): PortfolioValuationReliability {
  if (!input.accountBalanceAvailable || input.unpricedHoldings > 0) return 'incomplete';
  if (
    input.staleQuotes > 0 ||
    input.delayedQuotes > 0 ||
    input.unknownQuotes > 0 ||
    input.unavailableQuotes > 0
  ) return 'provisional';
  return 'current';
}

export function calculatePortfolioValuation(input: PortfolioValuationInput): PortfolioValuation {
  const parsedSignedBalance = finiteNumber(input.signedAccountBalance);
  const accountBalanceAvailable = parsedSignedBalance !== null;
  const signedBalance = parsedSignedBalance ?? 0;
  const freeCashValue = finiteNumber(input.freeCash) ?? 0;
  const cashBalance = Math.max(0, signedBalance) + Math.max(0, freeCashValue);
  const marginDebt = Math.max(0, -signedBalance);

  let marginHoldingsValue = 0;
  let cashHoldingsValue = 0;
  let pricedHoldings = 0;
  let unpricedHoldings = 0;

  for (const position of Array.isArray(input.marginPositions) ? input.marginPositions : []) {
    const result = marketValue(position);
    marginHoldingsValue += result.value;
    if (result.hasShares) result.priced ? pricedHoldings++ : unpricedHoldings++;
  }
  for (const holding of Array.isArray(input.cashHoldings) ? input.cashHoldings : []) {
    const result = marketValue(holding, true);
    cashHoldingsValue += result.value;
    if (result.hasShares) result.priced ? pricedHoldings++ : unpricedHoldings++;
  }

  const totalHoldingsValue = marginHoldingsValue + cashHoldingsValue;
  return {
    accountBalanceAvailable,
    cashBalance,
    marginDebt,
    marginHoldingsValue,
    cashHoldingsValue,
    totalHoldingsValue,
    equity: cashBalance + totalHoldingsValue - marginDebt,
    pricedHoldings,
    unpricedHoldings
  };
}
