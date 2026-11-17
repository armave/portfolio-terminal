import type { PortfolioState } from '../types/portfolio';
import { summarizeQuoteFreshness, type QuoteFreshnessSummary } from '../utils/formatters';

export type BrokerSnapshotHealth = 'current' | 'partial' | 'empty' | 'stale' | 'unavailable' | 'unknown';
export type QuoteFreshnessHealth = 'fresh' | 'stale' | 'delayed' | 'unknown' | 'unavailable' | 'none';

type BrokerAccountSnapshot = NonNullable<PortfolioState['brokerAccountInfo']>;
type GuestPortfolioSnapshot = NonNullable<PortfolioState['guestPortfolioSnapshot']>;

export type PortfolioDataHealthSource =
  | {
      role: 'admin';
      brokerAccountInfo: PortfolioState['brokerAccountInfo'];
      positions: PortfolioState['positions'];
      cashHoldings: PortfolioState['cashCushion']['holdings'];
    }
  | {
      role: 'guest';
      guestSnapshot: PortfolioState['guestPortfolioSnapshot'];
    };

/**
 * Select only the data visible to the active role. In particular, a guest
 * selection never contains the administrator broker snapshot or owner positions.
 */
export function selectPortfolioDataHealthSource(
  state: PortfolioState,
  isAdmin: boolean
): PortfolioDataHealthSource {
  if (!isAdmin) {
    return {
      role: 'guest',
      guestSnapshot: state.guestPortfolioSnapshot
    };
  }

  return {
    role: 'admin',
    brokerAccountInfo: state.brokerAccountInfo,
    positions: state.positions,
    cashHoldings: state.cashCushion?.holdings || []
  };
}

export function arePortfolioDataHealthSourcesEqual(
  previous: PortfolioDataHealthSource,
  next: PortfolioDataHealthSource
): boolean {
  if (previous.role !== next.role) return false;
  if (previous.role === 'guest' && next.role === 'guest') {
    return previous.guestSnapshot === next.guestSnapshot;
  }
  if (previous.role === 'admin' && next.role === 'admin') {
    return previous.brokerAccountInfo === next.brokerAccountInfo &&
      previous.positions === next.positions &&
      previous.cashHoldings === next.cashHoldings;
  }
  return false;
}

/** Resolve broker provenance conservatively; receipt time never substitutes for observation time. */
export function getBrokerSnapshotHealth(
  snapshot: BrokerAccountSnapshot | null | undefined
): BrokerSnapshotHealth {
  if (!snapshot) return 'unknown';
  if (snapshot.status === 'unavailable') return 'unavailable';
  if (snapshot.status === 'stale') return 'stale';
  if (snapshot.loaded !== true || snapshot.status !== 'current') return 'unknown';

  const quality = snapshot.quality ?? snapshot.snapshotQuality ?? 'unknown';
  const sourceQuality = snapshot.snapshotQuality ?? quality;
  if (quality === 'empty' || sourceQuality === 'empty') return 'empty';
  if (quality === 'partial' || sourceQuality === 'partial' ||
      (snapshot.positionIntegrityIssues?.length || 0) > 0) return 'partial';
  if (quality !== 'complete' || sourceQuality !== 'complete') return 'unknown';

  if (typeof snapshot.observedAt !== 'number' ||
      !Number.isSafeInteger(snapshot.observedAt) ||
      snapshot.observedAt <= 0) return 'unknown';

  return 'current';
}

function hasUsablePositivePrice(value: unknown): boolean {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return false;
  const price = Number(value);
  return Number.isFinite(price) && price > 0;
}

/** Match the Margin summary's quote-coverage rules without performing valuation. */
export function summarizeAdminPortfolioQuoteFreshness(
  input: {
    positions: PortfolioState['positions'];
    cashHoldings: PortfolioState['cashCushion']['holdings'];
  },
  now = Date.now(),
  refreshIntervalMs?: number
): QuoteFreshnessSummary {
  const marginQuotes = Object.values(input.positions || {}).map((position) =>
    hasUsablePositivePrice(position.currentPrice)
      ? position
      : { quoteUpdatedAt: undefined, quoteSource: undefined, quoteDetails: undefined }
  );
  const cashQuotes = (input.cashHoldings || [])
    .filter((holding) => Number(holding.shares) > 0)
    .map((holding) =>
      hasUsablePositivePrice(holding.currentPrice) || hasUsablePositivePrice(holding.price)
        ? holding
        : { quoteUpdatedAt: undefined, quoteSource: undefined, quoteDetails: undefined }
    );

  return summarizeQuoteFreshness(
    [...marginQuotes, ...cashQuotes],
    now,
    refreshIntervalMs
  );
}

/** Guests see quote provenance only for their server-filtered assigned tranches. */
export function summarizeGuestPortfolioQuoteFreshness(
  snapshot: GuestPortfolioSnapshot | null | undefined,
  now = Date.now(),
  refreshIntervalMs?: number
): QuoteFreshnessSummary {
  const holdings = (snapshot?.tranches || []).map((tranche) => {
    if (!hasUsablePositivePrice(tranche.marketPrice)) return {};
    return {
      quoteSource: tranche.quoteDetails?.provider || 'unknown',
      quoteDetails: tranche.quoteDetails
    };
  });
  return summarizeQuoteFreshness(holdings, now, refreshIntervalMs);
}

export function getQuoteFreshnessHealth(summary: QuoteFreshnessSummary): QuoteFreshnessHealth {
  if (summary.total === 0) return 'none';
  if (summary.stale > 0) return 'stale';
  if (summary.delayed > 0) return 'delayed';
  if (summary.unknown > 0) return 'unknown';
  if (summary.unavailable > 0) return 'unavailable';
  if (summary.fresh === summary.total) return 'fresh';
  return 'unknown';
}
