import React from 'react';
import { sentimentLabel } from './features/quotes/sentiment';

export function formatUSD(val: any): string {
  const num = Number(val) || 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatTrancheDate(dateStr: string): string {
  if (!dateStr || typeof dateStr !== 'string') return 'New';
  const trimmed = dateStr.trim();
  if (!trimmed || trimmed.toLowerCase() === 'new') return 'New';

  const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch) {
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    if (month >= 0 && month < 12 && day >= 1 && day <= 31) {
      return `${String(day).padStart(2, '0')} ${MONTH_NAMES[month]}`;
    }
  }

  const shortMatch = trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3,})/i) || trimmed.match(/^([A-Za-z]{3,})\s+(\d{1,2})/i);
  if (shortMatch) {
    const isFirstNum = /^\d+$/.test(shortMatch[1]);
    const day = parseInt(isFirstNum ? shortMatch[1] : shortMatch[2], 10);
    const monStr = (isFirstNum ? shortMatch[2] : shortMatch[1]).slice(0, 3).toLowerCase();
    const monthIdx = MONTH_NAMES.findIndex(m => m.toLowerCase() === monStr);
    if (monthIdx !== -1 && day >= 1 && day <= 31) {
      return `${String(day).padStart(2, '0')} ${MONTH_NAMES[monthIdx]}`;
    }
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const day = parsed.getDate();
    const month = parsed.getMonth();
    return `${String(day).padStart(2, '0')} ${MONTH_NAMES[month]}`;
  }

  return trimmed;
}

export function getTotalPortfolioInvested(state: any): number {
  if (!state || typeof state !== 'object') return 0;
  return Object.values(state.positions || {}).reduce((acc: number, pos: any) => {
    return acc + (pos?.tranches || []).reduce((sum: number, tr: any) => sum + (tr.qty * tr.price), 0);
  }, 0);
}

export function getCashCushionTotal(state: any): number {
  if (!state.cashCushion) return 0;
  const cashVal = Number(state.cashCushion.freeCash) || 0;
  const stocksVal = (state.cashCushion.holdings || []).reduce((sum: number, h: any) => {
    const price = getActivePrice(h.quoteDetails) || Number(h.currentPrice ?? h.price) || 0;
    return sum + ((Number(h.shares) || 0) * price);
  }, 0);
  return cashVal + stocksVal;
}

export function formatQuoteMetadata(holding: any, refreshIntervalMs = 60000): string {
  if (!holding.quoteUpdatedAt) return holding.quoteSource || 'Not fetched';
  const updatedAt = Number(holding.quoteUpdatedAt);
  if (!Number.isFinite(updatedAt)) return holding.quoteSource || 'Not fetched';
  const time = new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const isStale = Date.now() - updatedAt > Math.max(5 * 60 * 1000, refreshIntervalMs * 2);
  return `${isStale ? 'Stale · ' : ''}${holding.quoteSource || 'Quote'} · ${time}`;
}

export function getActivePrice(quote: any): number {
  if (!quote) return 0;
  const state = (quote.marketState || '').toUpperCase();
  if (state === 'PRE' || state === 'PREPRE') {
    return quote.preMarketPrice ?? quote.current ?? quote.price ?? 0;
  }
  if (state === 'POST' || state === 'CLOSED') {
    return quote.postMarketPrice ?? quote.current ?? quote.price ?? 0;
  }
  return quote.current ?? quote.price ?? 0;
}

export function getMarketStateBadge(marketState?: string | null): string | null {
  if (!marketState) return null;
  const state = marketState.toUpperCase();
  if (state === 'PRE' || state === 'PREPRE') return 'Pre';
  if (state === 'POST' || state === 'CLOSED') return 'Post';
  return null;
}

export function SentimentBadge({ direction }: { direction: any }) {
  const styles: any = {
    bullish: 'border-emerald-800 bg-emerald-950/50 text-emerald-300',
    bearish: 'border-rose-800 bg-rose-950/50 text-rose-300',
    neutral: 'border-slate-700 bg-slate-900 text-slate-300',
    unknown: 'border-slate-800 bg-slate-950 text-slate-500'
  };
  const label = sentimentLabel(direction);
  const title = direction === 'unknown'
    ? 'The selected data source did not provide a sentiment signal.'
    : 'A directional marker based only on the provider values shown in this section.';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${styles[direction]}`} title={title}>
      {label}
    </span>
  );
}

export function DailyQuoteLabel({ details }: { details: any }) {
  if (!details || typeof details !== 'object') return null;
  const hasChange = Number.isFinite(details.change) && Number.isFinite(details.changePercent);
  const hasRange = Number.isFinite(details.high) && Number.isFinite(details.low);
  if (!hasChange && !hasRange) return null;

  const parts = [];
  let colorClass = 'text-slate-400';
  if (hasChange) {
    const sign = details.change >= 0 ? '+' : '−';
    parts.push(`${sign}$${formatUSD(Math.abs(details.change))} (${sign}${Math.abs(details.changePercent).toFixed(2)}%)`);
    if (details.change > 0) colorClass = 'text-emerald-400';
    else if (details.change < 0) colorClass = 'text-rose-400';
  }
  if (hasRange) parts.push(`H $${formatUSD(details.high)} / L $${formatUSD(details.low)}`);

  return <span className={`mt-0.5 block text-[9px] font-normal tabular-nums ${colorClass}`}>Day: {parts.join(' · ')}</span>;
}
