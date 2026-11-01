export interface PortfolioEquityBadgeOptions {
  equity: number;
  locale: string;
  hasPricedHoldings: boolean;
  hasUnpricedHoldings: boolean;
  empty?: boolean;
}

export function formatPortfolioEquityBadge({
  equity,
  locale,
  hasPricedHoldings,
  hasUnpricedHoldings,
  empty = false
}: PortfolioEquityBadgeOptions): string {
  if (empty) return '$0';
  if (!Number.isFinite(equity)) return '—';
  if (hasUnpricedHoldings && !hasPricedHoldings) return '—';

  const amount = Math.abs(equity).toLocaleString(locale, { maximumFractionDigits: 0 });
  const signedAmount = (equity >= 0 ? '+$' : '−$') + amount;
  return hasUnpricedHoldings ? '≥' + signedAmount : signedAmount;
}
