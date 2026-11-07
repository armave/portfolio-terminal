import { calculatePortfolioValuation, getPortfolioValuationReliability } from './portfolioValuation';
import type { PortfolioPerformanceValuationSnapshot, PortfolioState } from '../types/portfolio';

const MAX_PORTFOLIO_PERFORMANCE_SNAPSHOTS = 1095;
const MAX_ATTRIBUTION_POSITION_ITEMS = 40;
const CASH_ITEM_KEY = 'cash';
const MARGIN_DEBT_ITEM_KEY = 'margin-debt';
const OTHER_HOLDINGS_ITEM_KEY = 'other-holdings';


function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function currencyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const valueNormalized = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(valueNormalized) ? valueNormalized : null;
}


function quoteCurrency(
  ticker: string,
  quoteDetails: { currency?: string } | undefined,
  brokerCurrencyByTicker: Map<string, string>
): string | null {
  return currencyCode(quoteDetails?.currency) || brokerCurrencyByTicker.get(ticker.toUpperCase()) || null;
}


function quoteQuality(
  details: { freshness?: string; sourceTimestamp?: number } | undefined
): 'fresh' | 'stale' | 'delayed' | 'unknown' {
  if (!details) return 'unknown';
  if (details.freshness === 'stale') return 'stale';
  if (details.freshness === 'delayed' || details.freshness === 'indicative') return 'delayed';
  if (details.freshness !== 'fresh' || !Number.isFinite(details.sourceTimestamp)) return 'unknown';
  return 'fresh';
}

/**
 * Capture one account-currency valuation using canonical app positions and
 * cash-backed holdings. Broker aggregates are used only to resolve currency;
 * they never replace app-owned quantities or lots.
 *
 * Returns null when a comparable, single-currency equity snapshot cannot be
 * built. Stale or unverifiable inputs can be captured, but remain provisional.
 */

export function capturePortfolioPerformanceValuation(
  state: PortfolioState,
  timestamp: number,
  cashflowHistoryComplete: boolean
): PortfolioPerformanceValuationSnapshot | null {
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return null;

  const account = state.brokerAccountInfo;
  if (!account?.loaded || account.status === 'unavailable' || !Array.isArray(account.balances)) return null;

  const balanceCurrencies = new Set(
    account.balances.map(row => currencyCode(row.currency)).filter((value): value is string => value !== null)
  );
  if (balanceCurrencies.size !== 1 || account.balances.length === 0) return null;
  const currency = [...balanceCurrencies][0];

  const brokerCurrencyByTicker = new Map<string, string>();
  for (const row of account.positions || []) {
    const ticker = typeof row.ticker === 'string' ? row.ticker.trim().toUpperCase() : '';
    const rowCurrency = currencyCode(row.currency);
    if (!ticker || !rowCurrency) continue;
    const previous = brokerCurrencyByTicker.get(ticker);
    if (previous && previous !== rowCurrency) return null;
    brokerCurrencyByTicker.set(ticker, rowCurrency);
  }

  const positions = Object.values(state.positions || {}).filter(position =>
    position && finiteNumber(position.shares) !== null && Number(position.shares) > 0
  );
  const cashHoldings = (state.cashCushion?.holdings || []).filter(holding =>
    holding && finiteNumber(holding.shares) !== null && Number(holding.shares) > 0
  );

  let staleQuotes = 0;
  let delayedQuotes = 0;
  let unknownQuotes = 0;
  for (const position of positions) {
    const resolvedCurrency = quoteCurrency(position.ticker, position.quoteDetails, brokerCurrencyByTicker);
    if (resolvedCurrency !== currency) return null;
    const quality = quoteQuality(position.quoteDetails);
    if (quality === 'stale') staleQuotes += 1;
    else if (quality === 'delayed') delayedQuotes += 1;
    else if (quality === 'unknown') unknownQuotes += 1;
  }
  for (const holding of cashHoldings) {
    const resolvedCurrency = quoteCurrency(holding.ticker, holding.quoteDetails, brokerCurrencyByTicker);
    if (resolvedCurrency !== currency) return null;
    const quality = quoteQuality(holding.quoteDetails);
    if (quality === 'stale') staleQuotes += 1;
    else if (quality === 'delayed') delayedQuotes += 1;
    else if (quality === 'unknown') unknownQuotes += 1;
  }

  const valuation = calculatePortfolioValuation({
    signedAccountBalance: state.balance,
    freeCash: state.cashCushion?.freeCash,
    marginPositions: positions,
    cashHoldings
  });
  if (!valuation.accountBalanceAvailable || valuation.unpricedHoldings > 0 ||
      !Number.isFinite(valuation.equity)) return null;

  const reliability = getPortfolioValuationReliability({
    accountBalanceAvailable: valuation.accountBalanceAvailable,
    accountBalanceStale: account.status !== 'current' ||
      account.quality !== 'complete' ||
      !Number.isFinite(account.observedAt),
    unpricedHoldings: valuation.unpricedHoldings,
    staleQuotes,
    delayedQuotes,
    unknownQuotes,
    unavailableQuotes: 0
  });
  if (reliability === 'incomplete') return null;

  const marketItems = new Map<string, number>();
  for (const position of positions) {
    const key = 'position:' + position.ticker.trim().toUpperCase();
    const amount = Number(position.shares) * Number(position.currentPrice);
    if (!Number.isFinite(amount)) return null;
    marketItems.set(key, (marketItems.get(key) || 0) + amount);
  }
  for (const holding of cashHoldings) {
    const key = 'cash-holding:' + holding.ticker.trim().toUpperCase();
    const price = finiteNumber(holding.currentPrice) ?? finiteNumber(holding.price);
    const amount = Number(holding.shares) * Number(price);
    if (!Number.isFinite(amount)) return null;
    marketItems.set(key, (marketItems.get(key) || 0) + amount);
  }

  const sortedMarketItems = [...marketItems.entries()].sort((a, b) => b[1] - a[1]);
  const keptItems = sortedMarketItems.slice(0, MAX_ATTRIBUTION_POSITION_ITEMS);
  const remainingValue = sortedMarketItems.slice(MAX_ATTRIBUTION_POSITION_ITEMS)
    .reduce((sum, [, value]) => sum + value, 0);
  const items = keptItems.map(([key, value]) => ({ key, value }));
  if (remainingValue !== 0) items.push({ key: OTHER_HOLDINGS_ITEM_KEY, value: remainingValue });
  items.push({ key: CASH_ITEM_KEY, value: valuation.cashBalance });
  items.push({ key: MARGIN_DEBT_ITEM_KEY, value: -valuation.marginDebt });

  const itemTotal = items.reduce((sum, item) => sum + item.value, 0);
  if (Math.abs(itemTotal - valuation.equity) > Math.max(0.02, Math.abs(valuation.equity) * 1e-10)) {
    return null;
  }

  return {
    timestamp,
    equity: valuation.equity,
    currency,
    quality: reliability === 'current' ? 'current' : 'provisional',
    cashflowHistoryComplete,
    items,
    pricedHoldings: valuation.pricedHoldings,
    unpricedHoldings: valuation.unpricedHoldings,
    provider: account.provider || 'unknown',
    brokerObservedAt: Number.isFinite(account.observedAt) ? account.observedAt as number : null,
    brokerReceivedAt: Number.isFinite(account.receivedAt) ? account.receivedAt : null
  };
}

function utcDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** Retain one daily point, refreshing same-day observations without downgrading verified evidence. */
export function appendDailyPerformanceValuation(
  existing: readonly PortfolioPerformanceValuationSnapshot[] | undefined,
  incoming: PortfolioPerformanceValuationSnapshot,
  maxPoints = MAX_PORTFOLIO_PERFORMANCE_SNAPSHOTS
): PortfolioPerformanceValuationSnapshot[] {
  const safeExisting = Array.isArray(existing)
    ? existing.filter(isPortfolioPerformanceValuationSnapshot).slice().sort((a, b) => a.timestamp - b.timestamp)
    : [];
  const last = safeExisting[safeExisting.length - 1];

  if (last && utcDay(last.timestamp) === utcDay(incoming.timestamp)) {
    const isNewerObservation = incoming.timestamp > last.timestamp;
    const qualityDowngrade = last.quality === 'current' && incoming.quality !== 'current';
    const coverageDowngrade = last.cashflowHistoryComplete && !incoming.cashflowHistoryComplete;
    if (!isNewerObservation || qualityDowngrade || coverageDowngrade) return safeExisting;
    safeExisting[safeExisting.length - 1] = incoming;
  } else {
    if (last && incoming.timestamp <= last.timestamp) return safeExisting;
    safeExisting.push(incoming);
  }

  const boundedMax = Number.isFinite(maxPoints) ? Math.max(2, Math.floor(maxPoints)) : MAX_PORTFOLIO_PERFORMANCE_SNAPSHOTS;
  return safeExisting.slice(-boundedMax);
}

export function isPortfolioPerformanceValuationSnapshot(value: unknown): value is PortfolioPerformanceValuationSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.timestamp) || Number(row.timestamp) <= 0) return false;
  if (typeof row.equity !== 'number' || !Number.isFinite(row.equity)) return false;
  if (currencyCode(row.currency) === null) return false;
  if (row.quality !== 'current' && row.quality !== 'provisional') return false;
  if (typeof row.cashflowHistoryComplete !== 'boolean') return false;
  if (!Array.isArray(row.items) || row.items.length === 0) return false;
  if (!row.items.every(item => item && typeof item === 'object' &&
    typeof (item as Record<string, unknown>).key === 'string' &&
    typeof (item as Record<string, unknown>).value === 'number' &&
    Number.isFinite((item as Record<string, unknown>).value))) return false;
  return true;
}


