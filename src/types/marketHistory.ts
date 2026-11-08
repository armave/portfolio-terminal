import type { MarketPricePoint } from '../services/marketDataContracts';

/** Immutable before/after evidence for one historical candle correction. */
export interface MarketHistoryCorrectionEvent {
  schemaVersion: 1;
  id: string;
  sourceId: string;
  symbol: string;
  interval: string;
  timestamp: number;
  provider: string;
  receivedAt: number;
  recordedAt: number;
  previous: MarketPricePoint | null;
  corrected: MarketPricePoint | null;
  reason: string;
}
