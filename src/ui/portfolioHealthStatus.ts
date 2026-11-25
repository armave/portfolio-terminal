import type { QuoteFreshnessSummary } from '../utils/formatters';

export type PortfolioQuoteHealthState = 'current' | 'delayed' | 'attention' | 'unknown';
export type AccountStreamHealthState = 'live' | 'waiting' | 'connecting' | 'fallback';
export type TradeHistoryHealthState = 'confirmed' | 'cached' | 'unknown';

export function resolvePortfolioQuoteHealthState(summary: QuoteFreshnessSummary): PortfolioQuoteHealthState {
  if (summary.total <= 0) return 'unknown';
  if (summary.stale > 0 || summary.unknown > 0 || summary.unavailable > 0) return 'attention';
  if (summary.delayed > 0) return 'delayed';
  return 'current';
}

export function resolveAccountStreamHealthState(input: {
  connected: boolean;
  connectionStatus: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
  portfolioReceived: boolean;
  ordersReceived: boolean;
}): AccountStreamHealthState {
  if (input.connected && input.portfolioReceived && input.ordersReceived) return 'live';
  if (input.connected) return 'waiting';
  if (input.connectionStatus === 'connecting') return 'connecting';
  return 'fallback';
}

export function resolveTradeHistoryHealthState(
  lastProviderRefreshAt: number | null,
  cachedExecutionCount: number
): TradeHistoryHealthState {
  if (typeof lastProviderRefreshAt === 'number' && Number.isFinite(lastProviderRefreshAt) && lastProviderRefreshAt > 0) {
    return 'confirmed';
  }
  return Number.isFinite(cachedExecutionCount) && cachedExecutionCount > 0 ? 'cached' : 'unknown';
}
