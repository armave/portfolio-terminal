/** Normalized, client-safe Freedom TradeNet execution history row. */
export interface FreedomExecutedTrade {
  id: string;
  ticker: string;
  side: string;
  quantity: number | null;
  price: number | null;
  currency: string;
  executedAt: string | null;
  tradeValue: number | null;
  profit: number | null;
  /** Margin financing fee for this specific execution/stock, when supplied by a source. */
  marginFee: number | null;
  commission: number | null;
  commissionCurrency: string;
  /** Raw row is retained only in the normalizer result; compact persisted rows use an empty object. */
  raw: Record<string, unknown>;
  /** Client-calculated fee metadata is kept separate from broker-reported execution facts. */
  marginFeeAllocations?: Record<string, number>;
  feesAndCommissions?: number;
  netProfit?: number | null;
}
