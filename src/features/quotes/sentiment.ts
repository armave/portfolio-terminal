export type SentimentDirection = 'bullish' | 'bearish' | 'neutral' | 'unknown';

export function calculateTargetUpsidePercent(targetPrice: number, currentPrice: number): number | undefined {
  if (!Number.isFinite(targetPrice) || targetPrice <= 0 || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return undefined;
  }

  const upsidePercent = ((targetPrice - currentPrice) / currentPrice) * 100;
  return Number.isFinite(upsidePercent) ? upsidePercent : undefined;
}

export function sentimentLabel(direction: SentimentDirection): string {
  if (direction === 'bullish') return 'Bullish';
  if (direction === 'bearish') return 'Bearish';
  if (direction === 'neutral') return 'Neutral';
  return 'No signal';
}
