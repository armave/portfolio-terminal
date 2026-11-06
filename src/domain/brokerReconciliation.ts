import type {
  BrokerDataSnapshot,
  BrokerPortfolioSnapshot
} from '../types/broker';

export type BrokerReconciliationStatus =
  | 'matched'
  | 'differences'
  | 'partial'
  | 'provisional'
  | 'stale'
  | 'unavailable';

export type BrokerReconciliationFindingType =
  | 'quantity_mismatch'
  | 'missing_in_broker'
  | 'missing_in_app'
  | 'currency_mismatch'
  | 'balance_mismatch'
  | 'unclassified_app_position'
  | 'unclassified_broker_position'
  | 'unclassified_app_balance'
  | 'unclassified_broker_balance';

export interface BrokerReconciliationPositionInput {
  ticker: string;
  quantity: unknown;
  currency?: string;
}

export interface BrokerReconciliationBalanceInput {
  currency: string;
  amount: unknown;
}

export interface BrokerReconciliationFinding {
  type: BrokerReconciliationFindingType;
  subject: string;
  currency?: string;
  appCurrency?: string;
  brokerCurrency?: string;
  appValue: number | null;
  brokerValue: number | null;
  difference?: number;
  confidence: 'confirmed' | 'provisional';
}

export interface BrokerReconciliationReport {
  status: BrokerReconciliationStatus;
  provider: string | null;
  source: string | null;
  quality: 'complete' | 'partial' | 'empty' | 'unknown';
  receivedAt: number | null;
  observedAt: number | null;
  snapshotAgeMs: number | null;
  freshness: 'fresh' | 'stale' | 'unknown';
  comparedAt: number;
  quantityTolerance: number;
  amountTolerance: number;
  differenceCount: number;
  findings: BrokerReconciliationFinding[];
  warnings: string[];
}

export interface ReconcileBrokerPortfolioInput {
  brokerSnapshot: BrokerDataSnapshot<BrokerPortfolioSnapshot> | null | undefined;
  /** The caller explicitly supplies margin plus cash-backed shares. */
  appPositions: readonly BrokerReconciliationPositionInput[];
  /** Only pass a balance when its app-side meaning matches the broker field. */
  appBalances?: readonly BrokerReconciliationBalanceInput[];
  brokerStatus?: 'current' | 'stale' | 'unavailable';
  now?: number;
  maxAgeMs?: number;
  quantityTolerance?: number;
  amountTolerance?: number;
}

interface PositionTotal {
  ticker: string;
  currency: string;
  quantity: number;
}

interface BalanceTotal {
  currency: string;
  amount: number;
}

function normalizedTicker(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toUpperCase().replace(/\.US$/i, '')
    : '';
}

function normalizedCurrency(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function finiteNonNegative(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function aggregatePositions(
  rows: readonly BrokerReconciliationPositionInput[],
  defaultCurrency: string | undefined,
  side: 'app' | 'broker',
  findings: BrokerReconciliationFinding[],
  confidence: 'confirmed' | 'provisional'
): Map<string, PositionTotal> {
  const totals = new Map<string, PositionTotal>();
  rows.forEach((row, index) => {
    const ticker = normalizedTicker(row?.ticker);
    const currency = normalizedCurrency(row?.currency) || normalizedCurrency(defaultCurrency);
    const quantity = finiteNonNegative(row?.quantity);
    if (!ticker || !currency || quantity === null) {
      findings.push({
        type: side === 'app' ? 'unclassified_app_position' : 'unclassified_broker_position',
        subject: ticker || `row ${index + 1}`,
        currency: currency || undefined,
        appValue: side === 'app' ? quantity : null,
        brokerValue: side === 'broker' ? quantity : null,
        confidence
      });
      return;
    }
    const key = `${ticker}|${currency}`;
    const previous = totals.get(key);
    totals.set(key, {
      ticker,
      currency,
      quantity: (previous?.quantity || 0) + quantity
    });
  });
  return totals;
}

function aggregateBalances(
  rows: readonly BrokerReconciliationBalanceInput[],
  side: 'app' | 'broker',
  findings: BrokerReconciliationFinding[],
  confidence: 'confirmed' | 'provisional'
): Map<string, BalanceTotal> {
  const totals = new Map<string, BalanceTotal>();
  rows.forEach((row, index) => {
    const currency = normalizedCurrency(row?.currency);
    const amount = finiteNumber(row?.amount);
    if (!currency || amount === null) {
      findings.push({
        type: side === 'app' ? 'unclassified_app_balance' : 'unclassified_broker_balance',
        subject: currency || `row ${index + 1}`,
        currency: currency || undefined,
        appValue: side === 'app' ? amount : null,
        brokerValue: side === 'broker' ? amount : null,
        confidence
      });
      return;
    }
    const previous = totals.get(currency);
    totals.set(currency, { currency, amount: (previous?.amount || 0) + amount });
  });
  return totals;
}

function isWithinTolerance(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) <= tolerance;
}

/**
 * Compare app-owned position quantities and explicitly supplied cash balances
 * with a normalized broker snapshot. This function is read-only: it never
 * rewrites positions, cash, lots, cost basis, or broker records.
 *
 * Incomplete/stale snapshots are not used to declare missing positions.
 * Broker position rows are account-wide totals, so callers must pass both
 * app margin positions and app cash-backed holdings in appPositions.
 */
export function reconcileBrokerPortfolio(
  input: ReconcileBrokerPortfolioInput
): BrokerReconciliationReport {
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const maxAgeMs = Number.isFinite(input.maxAgeMs) && Number(input.maxAgeMs) >= 0
    ? Number(input.maxAgeMs)
    : 5 * 60 * 1000;
  const quantityTolerance = Number.isFinite(input.quantityTolerance) && Number(input.quantityTolerance) >= 0
    ? Number(input.quantityTolerance)
    : 1e-6;
  const amountTolerance = Number.isFinite(input.amountTolerance) && Number(input.amountTolerance) >= 0
    ? Number(input.amountTolerance)
    : 0.01;
  const snapshot = input.brokerSnapshot;

  if (!snapshot || input.brokerStatus === 'unavailable') {
    return {
      status: 'unavailable',
      provider: snapshot?.provider ?? null,
      source: snapshot?.source ?? null,
      quality: snapshot?.quality ?? 'unknown',
      receivedAt: snapshot?.receivedAt ?? null,
      observedAt: snapshot?.observedAt ?? null,
      snapshotAgeMs: null,
      freshness: 'unknown',
      comparedAt: now,
      quantityTolerance,
      amountTolerance,
      differenceCount: 0,
      findings: [],
      warnings: ['Broker account data is unavailable; no reconciliation was performed.']
    };
  }

  const receivedAt = finiteNumber(snapshot.receivedAt);
  const observedAt = finiteNumber(snapshot.observedAt);
  const ageReference = observedAt ?? receivedAt;
  const snapshotAgeMs = ageReference !== null
    ? Math.max(0, now - ageReference)
    : null;
  const freshness = snapshotAgeMs !== null && snapshotAgeMs > maxAgeMs
    ? 'stale'
    : observedAt === null ? 'unknown' : 'fresh';
  const stale = input.brokerStatus === 'stale' || freshness === 'stale';
  const partial = snapshot.quality === 'partial' || snapshot.quality === 'empty';
  const confidence: 'confirmed' | 'provisional' =
    snapshot.quality === 'complete' && freshness === 'fresh' && !stale
      ? 'confirmed'
      : 'provisional';
  const findings: BrokerReconciliationFinding[] = [];
  const warnings = [...(snapshot.warnings || [])];

  if (snapshot.quality === 'partial') {
    warnings.push('The broker snapshot is partial; absence-based discrepancies are suppressed.');
  } else if (snapshot.quality === 'empty') {
    warnings.push('The broker snapshot contains no account rows; absence-based discrepancies are suppressed.');
  }
  if (stale) {
    warnings.push('The broker snapshot is stale; it is not treated as current reconciliation evidence.');
  }
  if (observedAt === null) {
    warnings.push('The provider observation timestamp is unknown; comparisons are provisional.');
  }

  if (stale) {
    return {
      status: 'stale',
      provider: snapshot.provider,
      source: snapshot.source,
      quality: snapshot.quality,
      receivedAt,
      observedAt,
      snapshotAgeMs,
      freshness,
      comparedAt: now,
      quantityTolerance,
      amountTolerance,
      differenceCount: 0,
      findings: [],
      warnings: [...new Set(warnings)]
    };
  }

  const appPositions = aggregatePositions(
    input.appPositions,
    'USD',
    'app',
    findings,
    confidence
  );
  const brokerPositions = aggregatePositions(
    snapshot.data.positions.map(row => ({
      ticker: row.ticker,
      quantity: row.quantity,
      currency: row.currency
    })),
    undefined,
    'broker',
    findings,
    confidence
  );

  const allTickers = new Set([
    ...[...appPositions.values()].map(row => row.ticker),
    ...[...brokerPositions.values()].map(row => row.ticker)
  ]);
  const suppressedMissing = partial;

  for (const ticker of allTickers) {
    const appRows = [...appPositions.values()].filter(row => row.ticker === ticker);
    const brokerRows = [...brokerPositions.values()].filter(row => row.ticker === ticker);
    const appCurrencies = new Set(appRows.map(row => row.currency));
    const brokerCurrencies = new Set(brokerRows.map(row => row.currency));
    const commonCurrencies = new Set([...appCurrencies].filter(currency => brokerCurrencies.has(currency)));

    if (appRows.length && brokerRows.length && commonCurrencies.size === 0) {
      findings.push({
        type: 'currency_mismatch',
        subject: ticker,
        appCurrency: [...appCurrencies].join(', '),
        brokerCurrency: [...brokerCurrencies].join(', '),
        appValue: appRows.reduce((sum, row) => sum + row.quantity, 0),
        brokerValue: brokerRows.reduce((sum, row) => sum + row.quantity, 0),
        confidence
      });
      continue;
    }

    for (const currency of commonCurrencies) {
      const appTotal = appRows.find(row => row.currency === currency)?.quantity ?? 0;
      const brokerTotal = brokerRows.find(row => row.currency === currency)?.quantity ?? 0;
      if (!isWithinTolerance(appTotal, brokerTotal, quantityTolerance)) {
        findings.push({
          type: 'quantity_mismatch',
          subject: ticker,
          currency,
          appValue: appTotal,
          brokerValue: brokerTotal,
          difference: appTotal - brokerTotal,
          confidence
        });
      }
    }

    if (suppressedMissing) continue;
    for (const row of appRows.filter(row => !brokerCurrencies.has(row.currency))) {
      findings.push({
        type: 'missing_in_broker',
        subject: ticker,
        currency: row.currency,
        appValue: row.quantity,
        brokerValue: null,
        confidence
      });
    }
    for (const row of brokerRows.filter(row => !appCurrencies.has(row.currency))) {
      findings.push({
        type: 'missing_in_app',
        subject: ticker,
        currency: row.currency,
        appValue: null,
        brokerValue: row.quantity,
        confidence
      });
    }
  }

  if (input.appBalances !== undefined) {
    const appBalances = aggregateBalances(input.appBalances, 'app', findings, confidence);
    const brokerBalances = aggregateBalances(snapshot.data.balances, 'broker', findings, confidence);
    const currencies = new Set([...appBalances.keys(), ...brokerBalances.keys()]);
    for (const currency of currencies) {
      const appAmount = appBalances.get(currency)?.amount;
      const brokerAmount = brokerBalances.get(currency)?.amount;
      if (appAmount === undefined || brokerAmount === undefined) {
        if (suppressedMissing) continue;
        findings.push({
          type: 'balance_mismatch',
          subject: currency,
          currency,
          appValue: appAmount ?? null,
          brokerValue: brokerAmount ?? null,
          confidence
        });
      } else if (!isWithinTolerance(appAmount, brokerAmount, amountTolerance)) {
        findings.push({
          type: 'balance_mismatch',
          subject: currency,
          currency,
          appValue: appAmount,
          brokerValue: brokerAmount,
          difference: appAmount - brokerAmount,
          confidence
        });
      }
    }
  }

  const hasUnclassifiedRows = findings.some(finding =>
    finding.type === 'unclassified_app_position' ||
    finding.type === 'unclassified_broker_position' ||
    finding.type === 'unclassified_app_balance' ||
    finding.type === 'unclassified_broker_balance'
  );
  const status: BrokerReconciliationStatus = partial || hasUnclassifiedRows
    ? 'partial'
    : freshness === 'unknown'
      ? 'provisional'
      : findings.length > 0 ? 'differences' : 'matched';

  return {
    status,
    provider: snapshot.provider,
    source: snapshot.source,
    quality: snapshot.quality,
    receivedAt,
    observedAt,
    snapshotAgeMs,
    freshness,
    comparedAt: now,
    quantityTolerance,
    amountTolerance,
    differenceCount: findings.filter(finding =>
      finding.type === 'quantity_mismatch' ||
      finding.type === 'missing_in_broker' ||
      finding.type === 'missing_in_app' ||
      finding.type === 'currency_mismatch' ||
      finding.type === 'balance_mismatch'
    ).length,
    findings,
    warnings: [...new Set(warnings)]
  };
}
