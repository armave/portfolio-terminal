import { createRiskSnapshot } from '../domain/riskSnapshot';
import type { BoardState } from '../types/portfolio';
import { formatUSD } from '../utils/formatters';

interface RiskSnapshotPanelProps {
  state: BoardState;
}

function metricValue(value: number | null): string {
  return value === null ? 'Unknown' : formatUSD(value);
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3 min-w-0">
      <div class="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div class="mt-1 text-base sm:text-lg font-semibold font-mono text-slate-100 break-words">{value}</div>
      {detail && <div class="mt-1 text-[11px] leading-snug text-slate-500">{detail}</div>}
    </div>
  );
}

/** Read-only risk context. Unknown accounting values stay visibly unknown. */
export function RiskSnapshotPanel({ state }: RiskSnapshotPanelProps) {
  const snapshot = createRiskSnapshot(state);
  const quoteIssues = snapshot.quoteCoverage.staleOrDelayed
    + snapshot.quoteCoverage.unknown
    + snapshot.quoteCoverage.missingOrInvalid;
  const exposureLabel = snapshot.grossExposure.validity === 'valid'
    ? 'Quotes marked fresh'
    : snapshot.grossExposure.validity === 'stale'
      ? 'Stale/delayed quote coverage'
      : snapshot.grossExposure.validity === 'missing'
        ? 'Incomplete position data'
        : 'Quote freshness unverified';

  return (
    <section
      aria-label="Risk snapshot"
      class="rounded-xl border border-amber-900/50 bg-slate-950/70 p-3 sm:p-4 space-y-3"
      data-testid="risk-snapshot-panel"
    >
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 class="text-sm font-bold uppercase tracking-wide text-slate-100">Risk snapshot</h2>
          <p class="mt-1 text-xs text-slate-400">Read-only · indicative exposure, not a liquidation estimate</p>
        </div>
        <span class="rounded-full border border-amber-700/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
          Risk level unknown
        </span>
      </div>

      <div class="grid grid-cols-2 xl:grid-cols-3 gap-2">
        <Metric label="Gross exposure" value={metricValue(snapshot.grossExposure.value)} detail={exposureLabel} />
        <Metric label="Free cash" value={metricValue(snapshot.cash.value)} detail="Free cash only; holdings excluded" />
        <Metric label="Equity" value="Unknown" detail="Accounting definition not verified" />
        <Metric label="Margin debt" value="Unknown" detail="Not inferred from legacy balance" />
        <Metric label="Margin buffer" value="Unknown" detail="Maintenance threshold not applied" />
        <Metric label="Financing cost" value="Unknown" detail="Debt/rate allocation not verified" />
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <span>Quote coverage: {snapshot.quoteCoverage.fresh}/{snapshot.quoteCoverage.totalPositions} fresh</span>
        <span>{quoteIssues} stale, unknown, or unusable</span>
      </div>

      {snapshot.warnings.length > 0 && (
        <ul class="space-y-1 border-t border-slate-800 pt-3 text-xs leading-relaxed text-amber-200/90">
          {snapshot.warnings.map((warning) => <li key={warning}>• {warning}</li>)}
        </ul>
      )}
    </section>
  );
}
