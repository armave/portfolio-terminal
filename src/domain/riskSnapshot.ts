import type { BoardState, PositionRecord } from '../types/portfolio';

type DataValidity = 'valid' | 'stale' | 'missing' | 'invalid' | 'unknown';
type RiskLevel = 'normal' | 'warning' | 'critical' | 'unknown';

interface RiskMetric<T = number> {
  value: T | null;
  validity: DataValidity;
  asOf: number | null;
  explanation?: string;
}

/**
 * Read-only, deliberately conservative snapshot. It does not infer equity,
 * margin debt, or liquidation thresholds from legacy fields whose semantics
 * differ across import/runtime paths.
 */
interface RiskSnapshot {
  calculatedAt: number;
  equity: RiskMetric;
  grossExposure: RiskMetric;
  cash: RiskMetric;
  marginDebt: RiskMetric;
  estimatedFinancingCost: RiskMetric;
  marginBuffer: RiskMetric;
  level: RiskLevel;
  warnings: string[];
  quoteCoverage: {
    totalPositions: number;
    fresh: number;
    staleOrDelayed: number;
    unknown: number;
    missingOrInvalid: number;
  };
}

const unknownMetric = (explanation: string): RiskMetric => ({
  value: null,
  validity: 'unknown',
  asOf: null,
  explanation
});

function finiteNonNegative(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function quoteValidity(position: PositionRecord): DataValidity {
  const price = finiteNonNegative(position.currentPrice);
  if (price === null || price <= 0) return position.currentPrice == null ? 'missing' : 'invalid';
  const freshness = position.quoteDetails?.freshness;
  if (freshness === 'fresh') return 'valid';
  if (freshness === 'stale' || freshness === 'delayed') return 'stale';
  // quoteUpdatedAt/receivedAt are local receipt times, not proof of market
  // observation time, so they do not independently establish freshness.
  return 'unknown';
}

function metricAsOf(position: PositionRecord): number | null {
  const timestamp = position.quoteDetails?.sourceTimestamp;
  return typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0
    ? timestamp
    : null;
}

function positionExposure(position: PositionRecord): number | null {
  const shares = finiteNonNegative(position.shares);
  const price = finiteNonNegative(position.currentPrice);
  if (shares === null || price === null || shares <= 0 || price <= 0) return null;
  const value = shares * price;
  return Number.isFinite(value) ? value : null;
}

export function createRiskSnapshot(state: BoardState | null | undefined, now = Date.now()): RiskSnapshot {
  const positions = Object.values(state?.positions || {});
  const warnings: string[] = [];
  let fresh = 0;
  let staleOrDelayed = 0;
  let unknown = 0;
  let missingOrInvalid = 0;
  let exposureTotal = 0;
  let exposureUsable = true;
  let allQuotesFresh = true;
  let latestSourceTimestamp: number | null = null;

  for (const position of positions) {
    const validity = quoteValidity(position);
    if (validity === 'valid') fresh++;
    else if (validity === 'stale') {
      staleOrDelayed++;
      allQuotesFresh = false;
    } else if (validity === 'unknown') {
      unknown++;
      allQuotesFresh = false;
    } else {
      missingOrInvalid++;
      allQuotesFresh = false;
    }

    const exposure = positionExposure(position);
    if (exposure === null) exposureUsable = false;
    else exposureTotal += exposure;

    const sourceTimestamp = metricAsOf(position);
    if (sourceTimestamp !== null) {
      latestSourceTimestamp = latestSourceTimestamp === null
        ? sourceTimestamp
        : Math.min(latestSourceTimestamp, sourceTimestamp);
    }
  }

  if (staleOrDelayed > 0) warnings.push(`${staleOrDelayed} position quote(s) are marked stale or delayed.`);
  if (unknown > 0) warnings.push(`${unknown} position quote(s) have unknown freshness.`);
  if (missingOrInvalid > 0) warnings.push(`${missingOrInvalid} position quote(s) or quantities are missing or invalid.`);
  if (positions.length === 0) warnings.push('No open margin positions were found.');
  warnings.push('Equity, margin debt, financing cost, and margin buffer are unknown until their accounting semantics are verified.');

  const freeCash = finiteNonNegative(state?.cashCushion?.freeCash);
  const cashMetric: RiskMetric = freeCash === null
    ? { value: null, validity: state?.cashCushion?.freeCash == null ? 'missing' : 'invalid', asOf: null, explanation: 'Free cash is not a finite non-negative amount.' }
    : { value: freeCash, validity: 'valid', asOf: null, explanation: 'Free cash only; cash-holding market value is excluded until its quote quality is validated.' };

  const exposureMetric: RiskMetric = !exposureUsable
    ? { value: null, validity: 'missing', asOf: latestSourceTimestamp, explanation: 'At least one open position has an unusable quantity or price; aggregate exposure is withheld to avoid understating risk.' }
    : {
        value: exposureTotal,
        validity: allQuotesFresh ? 'valid' : staleOrDelayed > 0 ? 'stale' : 'unknown',
        asOf: latestSourceTimestamp,
        explanation: allQuotesFresh
          ? 'Sum of open position shares multiplied by current prices; all quotes explicitly report fresh.'
          : 'Indicative exposure only. At least one quote is stale, delayed, or has unknown freshness.'
      };

  return {
    calculatedAt: now,
    equity: unknownMetric('Not calculated: balance and cash fields have legacy/runtime meanings that must be reconciled first.'),
    grossExposure: exposureMetric,
    cash: cashMetric,
    marginDebt: unknownMetric('Not calculated: balance alone is not treated as a verified margin-debt ledger.'),
    estimatedFinancingCost: unknownMetric('Not calculated: requires verified debt allocation and broker-rate semantics.'),
    marginBuffer: unknownMetric('Not calculated: requires verified equity, debt, and broker maintenance/stop-out semantics.'),
    level: 'unknown',
    warnings,
    quoteCoverage: { totalPositions: positions.length, fresh, staleOrDelayed, unknown, missingOrInvalid }
  };
}
