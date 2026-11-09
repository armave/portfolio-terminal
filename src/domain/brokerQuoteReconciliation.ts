import type { BrokerPosition, BrokerSnapshotQuality } from '../types/broker';
import type { QuoteDetails } from '../types/portfolio';

export type BrokerQuoteReconciliationStatus =
  | 'matched'
  | 'differences'
  | 'partial'
  | 'stale'
  | 'unavailable';

export interface AppQuoteHolding {
  ticker: string;
  price: unknown;
  quoteSource?: string;
  quoteUpdatedAt?: number;
  quoteDetails?: QuoteDetails;
}

export interface BrokerQuoteSnapshot {
  loaded: boolean;
  positions: readonly BrokerPosition[];
  provider?: string;
  source?: string;
  quality?: BrokerSnapshotQuality | 'unknown';
  status?: 'current' | 'stale' | 'unavailable';
  observedAt?: number;
  receivedAt?: number;
  warnings?: readonly string[];
}

interface BrokerQuoteReconciliationFinding {
  id: string;
  type:
    | 'price_mismatch'
    | 'currency_mismatch'
    | 'quote_unclassified'
    | 'ambiguous_app_quote'
    | 'ambiguous_broker_quote';
  ticker: string;
  currency?: string;
  appValue: number | null;
  brokerValue: number | null;
  difference?: number;
  confidence: 'confirmed' | 'provisional';
  appProvider?: string;
  brokerProvider?: string;
  appObservedAt?: number;
  appReceivedAt?: number;
  brokerObservedAt?: number;
  brokerReceivedAt?: number;
  explanation: string;
}

export interface BrokerQuoteReconciliationReport {
  status: BrokerQuoteReconciliationStatus;
  comparedAt: number;
  provider: string | null;
  source: string | null;
  quality: BrokerSnapshotQuality | 'unknown';
  observedAt: number | null;
  receivedAt: number | null;
  matchedCount: number;
  findings: BrokerQuoteReconciliationFinding[];
  warnings: string[];
}

export interface ReconcileBrokerQuotePricesInput {
  brokerSnapshot: BrokerQuoteSnapshot | null | undefined;
  appQuotes: readonly AppQuoteHolding[];
  now?: number;
  maxAgeMs?: number;
  priceTolerance?: number;
}

interface NormalizedAppQuote {
  ticker: string;
  price: number;
  currency: string;
  provider: string | null;
  exchange: string | null;
  observedAt: number | null;
  receivedAt: number | null;
  verified: boolean;
}

interface NormalizedBrokerQuote {
  ticker: string;
  price: number;
  currency: string;
  provider: string | null;
  observedAt: number | null;
  receivedAt: number | null;
  verified: boolean;
}

function normalizeTicker(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase().replace(/\.US$/i, '') : '';
}

function normalizeCurrency(value: unknown): string {
  const currency = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z]{3}$/.test(currency) ? currency : '';
}

function finitePositive(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function finiteTimestamp(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function withinTolerance(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= Math.max(tolerance, Math.abs(right) * 0.0001);
}

function normalizeAppQuote(row: AppQuoteHolding, now: number, maxAgeMs: number): NormalizedAppQuote | null {
  const ticker = normalizeTicker(row?.ticker);
  const price = finitePositive(row?.price);
  const details = row?.quoteDetails;
  const currency = normalizeCurrency(details?.currency);
  if (!ticker || price === null) return null;

  const observedAt = finiteTimestamp(details?.sourceTimestamp);
  const receivedAt = finiteTimestamp(details?.receivedAt ?? row?.quoteUpdatedAt);
  const provider = typeof (details?.provider || row?.quoteSource) === 'string'
    ? String(details?.provider || row?.quoteSource).trim().toUpperCase() || null
    : null;
  const exchange = typeof details?.exchange === 'string'
    ? details.exchange.trim().toUpperCase() || null
    : null;
  const observationAgeMs = observedAt === null ? null : now - observedAt;
  const observationFresh = observationAgeMs !== null &&
    observationAgeMs >= -60_000 && observationAgeMs <= maxAgeMs;
  const verified = Boolean(
    currency &&
    provider &&
    observedAt &&
    receivedAt &&
    observationFresh &&
    details?.freshness === 'fresh' &&
    details?.delayClass === 'live' &&
    details?.dataQuality === 'complete' &&
    details?.cacheStatus !== 'stale-fallback'
  );

  return { ticker, price, currency, provider, exchange, observedAt, receivedAt, verified };
}

function normalizeBrokerQuote(
  row: BrokerPosition,
  snapshot: BrokerQuoteSnapshot,
  now: number,
  maxAgeMs: number
): NormalizedBrokerQuote | null {
  const ticker = normalizeTicker(row?.ticker);
  const price = finitePositive(row?.marketPrice);
  const currency = normalizeCurrency(row?.currency);
  if (!ticker || price === null) return null;

  const observedAt = finiteTimestamp(snapshot.observedAt);
  const receivedAt = finiteTimestamp(snapshot.receivedAt);
  const ageReference = observedAt ?? receivedAt;
  const ageMs = ageReference === null ? null : now - ageReference;
  const timestampUsable = ageMs !== null && ageMs >= -60_000 && ageMs <= maxAgeMs;
  const provider = typeof snapshot.provider === 'string'
    ? snapshot.provider.trim().toUpperCase() || null
    : null;

  return {
    ticker,
    price,
    currency,
    provider,
    observedAt,
    receivedAt,
    verified: Boolean(
      currency &&
      provider &&
      snapshot.status === 'current' &&
      snapshot.quality === 'complete' &&
      observedAt &&
      receivedAt &&
      timestampUsable
    )
  };
}

/**
 * Compare app-owned quote observations with broker-reported position prices.
 *
 * This function is deterministic and read-only. It does not fetch data, infer
 * currency/FX, change a position, update cost basis, or apply a reconciliation.
 * A finding is confirmed only when both quote sources have explicit, complete,
 * fresh provenance. Otherwise any observed price difference remains provisional.
 */
export function reconcileBrokerQuotePrices(
  input: ReconcileBrokerQuotePricesInput
): BrokerQuoteReconciliationReport {
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const maxAgeMs = Number.isFinite(input.maxAgeMs) && Number(input.maxAgeMs) >= 0
    ? Number(input.maxAgeMs)
    : 5 * 60 * 1000;
  const priceTolerance = Number.isFinite(input.priceTolerance) && Number(input.priceTolerance) >= 0
    ? Number(input.priceTolerance)
    : 0.01;
  const snapshot = input.brokerSnapshot;
  const provider = snapshot?.provider?.trim() || null;
  const source = snapshot?.source?.trim() || null;
  const quality = snapshot?.quality ?? 'unknown';
  const observedAt = finiteTimestamp(snapshot?.observedAt);
  const receivedAt = finiteTimestamp(snapshot?.receivedAt);
  const warnings = [...(snapshot?.warnings ?? [])];
  const emptyReport = (
    status: BrokerQuoteReconciliationStatus,
    extraWarnings: string[] = []
  ): BrokerQuoteReconciliationReport => ({
    status,
    comparedAt: now,
    provider,
    source,
    quality,
    observedAt,
    receivedAt,
    matchedCount: 0,
    findings: [],
    warnings: [...new Set([...warnings, ...extraWarnings])]
  });

  if (!snapshot || snapshot.loaded !== true || snapshot.status === 'unavailable') {
    return emptyReport('unavailable', ['Broker portfolio prices are unavailable; no price comparison was performed.']);
  }

  const ageReference = observedAt ?? receivedAt;
  const ageMs = ageReference === null ? null : now - ageReference;
  if (snapshot.status === 'stale' || (ageMs !== null && ageMs > maxAgeMs)) {
    return emptyReport('stale', ['The broker quote snapshot is stale; it is not used as current price evidence.']);
  }

  if (observedAt === null) {
    warnings.push('The broker provider observation timestamp is unknown; price findings cannot be confirmed.');
  }
  if (quality !== 'complete') {
    warnings.push('The broker position snapshot is incomplete; price findings are provisional.');
  }

  const appGroups = new Map<string, Map<string, NormalizedAppQuote[]>>();
  input.appQuotes.forEach((row, index) => {
    const normalized = normalizeAppQuote(row, now, maxAgeMs);
    const ticker = normalizeTicker(row?.ticker);
    if (!normalized) {
      if (ticker) warnings.push(`The app quote for ${ticker} is missing a usable positive price and was excluded.`);
      else warnings.push(`App quote row ${index + 1} has no usable ticker or price and was excluded.`);
      return;
    }
    if (!normalized.currency) {
      warnings.push(`The app quote currency for ${normalized.ticker} is unknown; no currency or FX pair was inferred.`);
      return;
    }
    const currencies = appGroups.get(normalized.ticker) ?? new Map<string, NormalizedAppQuote[]>();
    const rows = currencies.get(normalized.currency) ?? [];
    rows.push(normalized);
    currencies.set(normalized.currency, rows);
    appGroups.set(normalized.ticker, currencies);
  });

  const brokerGroups = new Map<string, Map<string, NormalizedBrokerQuote[]>>();
  snapshot.positions.forEach((row) => {
    const normalized = normalizeBrokerQuote(row, snapshot, now, maxAgeMs);
    if (!normalized) {
      if (normalizeTicker(row?.ticker)) warnings.push('One or more broker position prices were invalid or lacked a supported currency and were excluded.');
      return;
    }
    const currencies = brokerGroups.get(normalized.ticker) ?? new Map<string, NormalizedBrokerQuote[]>();
    const rows = currencies.get(normalized.currency) ?? [];
    rows.push(normalized);
    currencies.set(normalized.currency, rows);
    brokerGroups.set(normalized.ticker, currencies);
  });

  const findings: BrokerQuoteReconciliationFinding[] = [];
  let matchedCount = 0;
  const tickers = [...new Set([...appGroups.keys(), ...brokerGroups.keys()])].sort();
  for (const ticker of tickers) {
    const appCurrencies = appGroups.get(ticker);
    const brokerCurrencies = brokerGroups.get(ticker);
    if (!appCurrencies || !brokerCurrencies) continue;

    const commonCurrencies = [...appCurrencies.keys()].filter(currency => brokerCurrencies.has(currency));
    if (commonCurrencies.length === 0) {
      findings.push({
        id: `currency:${ticker}`,
        type: 'currency_mismatch',
        ticker,
        appValue: null,
        brokerValue: null,
        confidence: 'provisional',
        explanation: 'App and broker quotes use different or unverified currencies. No conversion was attempted.'
      });
      continue;
    }

    for (const currency of commonCurrencies.sort()) {
      const appRows = appCurrencies.get(currency) ?? [];
      const brokerRows = brokerCurrencies.get(currency) ?? [];
      const appPrices = appRows.map(row => row.price);
      const brokerPrices = brokerRows.map(row => row.price);
      const appMin = Math.min(...appPrices);
      const appMax = Math.max(...appPrices);
      const brokerMin = Math.min(...brokerPrices);
      const brokerMax = Math.max(...brokerPrices);

      if (appMax - appMin > Math.max(priceTolerance, appMax * 0.0001)) {
        findings.push({
          id: `ambiguous-app:${ticker}:${currency}`,
          type: 'ambiguous_app_quote',
          ticker,
          currency,
          appValue: null,
          brokerValue: brokerPrices.length === 1 ? brokerPrices[0] : null,
          confidence: 'provisional',
          explanation: 'Multiple app holdings for this instrument have conflicting quote prices; no source was selected.'
        });
        continue;
      }
      if (brokerMax - brokerMin > Math.max(priceTolerance, brokerMax * 0.0001)) {
        findings.push({
          id: `ambiguous-broker:${ticker}:${currency}`,
          type: 'ambiguous_broker_quote',
          ticker,
          currency,
          appValue: appPrices.length === 1 ? appPrices[0] : null,
          brokerValue: null,
          confidence: 'provisional',
          explanation: 'Multiple broker rows for this instrument have conflicting prices; no source was selected.'
        });
        continue;
      }

      const app = appRows[0];
      const broker = brokerRows[0];
      matchedCount += 1;

      if (!withinTolerance(app.price, broker.price, priceTolerance)) {
        const verified = app.verified && broker.verified;
        findings.push({
          id: `price:${ticker}:${currency}`,
          type: 'price_mismatch',
          ticker,
          currency,
          appValue: app.price,
          brokerValue: broker.price,
          difference: app.price - broker.price,
          confidence: verified ? 'confirmed' : 'provisional',
          appProvider: app.provider ?? undefined,
          brokerProvider: broker.provider ?? undefined,
          appObservedAt: app.observedAt ?? undefined,
          appReceivedAt: app.receivedAt ?? undefined,
          brokerObservedAt: broker.observedAt ?? undefined,
          brokerReceivedAt: broker.receivedAt ?? undefined,
          explanation: verified
            ? 'The app and broker report different prices for the same currency-qualified instrument with fresh source observations.'
            : 'The reported prices differ, but one or both source observations are incomplete, stale, delayed, or unverifiable.'
        });
      }
    }
  }

  const hasUnverifiedAppQuotes = [...appGroups.values()].some(currencies =>
    [...currencies.values()].some(rows => rows.some(row => !row.verified))
  );
  const snapshotVerified = snapshot.status === 'current' && quality === 'complete' &&
    Boolean(provider && observedAt && receivedAt && ageMs !== null && ageMs >= -60_000 && ageMs <= maxAgeMs);
  const hasProvisionalFinding = findings.some(finding => finding.confidence === 'provisional');
  const hasConfirmedFinding = findings.some(finding => finding.confidence === 'confirmed');
  const hasEvidenceWarnings = warnings.length > 0 || hasUnverifiedAppQuotes || !snapshotVerified;
  const status: BrokerQuoteReconciliationStatus = hasConfirmedFinding
    ? 'differences'
    : hasProvisionalFinding || hasEvidenceWarnings || matchedCount === 0
      ? 'partial'
      : 'matched';

  if (hasUnverifiedAppQuotes) {
    warnings.push('One or more app quote observations are not verified as fresh, live, and complete.');
  }
  if (matchedCount === 0) {
    warnings.push('No matching ticker and currency pairs were available for price comparison.');
  }

  return {
    status,
    comparedAt: now,
    provider,
    source,
    quality,
    observedAt,
    receivedAt,
    matchedCount,
    findings,
    warnings: [...new Set(warnings)]
  };
}
