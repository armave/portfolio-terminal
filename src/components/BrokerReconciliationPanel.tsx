import { useMemo } from 'preact/hooks';
import type { BrokerDataSnapshot, BrokerPortfolioSnapshot } from '../types/broker';
import type { CashStockHolding, PortfolioState, PositionRecord } from '../types/portfolio';
import { reconcileBrokerPortfolio } from '../domain/brokerReconciliation';
import { getAppLanguage, translateText } from '../services/i18n';

type BrokerAccountInfo = NonNullable<PortfolioState['brokerAccountInfo']>;

interface BrokerReconciliationPanelProps {
  brokerAccountInfo?: BrokerAccountInfo;
  positions: Record<string, PositionRecord>;
  cashHoldings: readonly CashStockHolding[];
}

const STATUS_COPY = {
  matched: 'Matched',
  differences: 'Differences found',
  partial: 'Partial snapshot',
  provisional: 'Provisional comparison',
  stale: 'Stale broker snapshot',
  unavailable: 'Broker data unavailable'
} as const;

const FINDING_COPY = {
  quantity_mismatch: 'Quantity mismatch',
  missing_in_broker: 'Missing in broker',
  missing_in_app: 'Missing in app',
  currency_mismatch: 'Currency mismatch',
  balance_mismatch: 'Balance mismatch',
  unclassified_app_position: 'Unclassified app position',
  unclassified_broker_position: 'Unclassified broker position',
  unclassified_app_balance: 'Unclassified app balance',
  unclassified_broker_balance: 'Unclassified broker balance'
} as const;

function formatQuantity(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 6 }).format(value);
}


function formatAge(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return translateText('Unknown', getAppLanguage());
  const minutes = Math.max(0, Math.floor(value / 60_000));
  const unit: Intl.RelativeTimeFormatUnit = minutes < 60 ? 'minute' : minutes < 24 * 60 ? 'hour' : 'day';
  const amount = unit === 'minute' ? minutes : unit === 'hour' ? Math.floor(minutes / 60) : Math.floor(minutes / (24 * 60));
  return new Intl.RelativeTimeFormat(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', { numeric: 'auto' }).format(-amount, unit);
}

function formatTimestamp(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return new Intl.DateTimeFormat(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function buildBrokerSnapshot(info: BrokerAccountInfo | undefined): BrokerDataSnapshot<BrokerPortfolioSnapshot> | null {
  if (!info) return null;
  const hasVerifiedQuality = info.quality === 'complete' || info.quality === 'partial' || info.quality === 'empty';
  return {
    provider: info.provider || 'unknown',
    data: {
      loaded: info.loaded,
      balances: info.balances,
      positions: info.positions
    },
    // Older persisted snapshots predate adapter quality metadata. Treat them
    // as partial instead of inferring completeness from the number of rows.
    quality: hasVerifiedQuality ? info.quality as 'complete' | 'partial' | 'empty' : 'partial',
    source: info.source || 'unknown',
    receivedAt: info.receivedAt,
    ...(info.observedAt === undefined ? {} : { observedAt: info.observedAt }),
    warnings: [
      ...(info.warnings || []),
      ...(info.lastRefreshIssue?.warnings || []),
      ...(!hasVerifiedQuality ? ['Saved broker snapshot has no verified completeness metadata.'] : []),
      ...(!info.source ? ['Saved broker snapshot has no verified source metadata.'] : [])
    ]
  };
}

function statusTone(status: keyof typeof STATUS_COPY): string {
  if (status === 'matched') return 'border-emerald-800/70 bg-emerald-950/20 text-emerald-300';
  if (status === 'differences' || status === 'stale' || status === 'unavailable') {
    return 'border-amber-800/70 bg-amber-950/20 text-amber-200';
  }
  return 'border-sky-800/70 bg-sky-950/20 text-sky-200';
}

export function BrokerReconciliationPanel({
  brokerAccountInfo,
  positions,
  cashHoldings
}: BrokerReconciliationPanelProps) {
  const brokerSnapshot = useMemo(
    () => buildBrokerSnapshot(brokerAccountInfo),
    [brokerAccountInfo]
  );
  const appPositions = useMemo(() => [
    ...Object.values(positions).map(position => ({
      ticker: position.ticker,
      quantity: position.shares,
      currency: 'USD'
    })),
    ...cashHoldings.map(holding => ({
      ticker: holding.ticker,
      quantity: holding.shares,
      currency: 'USD'
    }))
  ], [positions, cashHoldings]);
  const report = reconcileBrokerPortfolio({
    brokerSnapshot,
    appPositions,
    brokerStatus: !brokerAccountInfo?.loaded ? 'unavailable' : brokerAccountInfo.status,
    now: Date.now()
  });

  const label = (value: string) => translateText(value, getAppLanguage());
  const visibleFindings = report.findings.slice(0, 12);
  const hasMoreFindings = report.findings.length > visibleFindings.length;
  const statusKey = report.status as keyof typeof STATUS_COPY;

  return (
    <section
      aria-labelledby="brokerReconciliationTitle"
      class="rounded-xl border border-slate-800 bg-slate-950/50 p-3"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 id="brokerReconciliationTitle" class="text-sm font-bold text-slate-100">
          {label('Broker reconciliation')}
        </h3>
        <span class={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusTone(statusKey)}`}>
          {label(STATUS_COPY[statusKey])}
        </span>
      </div>

      <p class="mt-1 text-xs leading-5 text-slate-400">
        {label('Comparing app margin and cash-backed shares with broker account-wide quantities.')}
      </p>

      <div class="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-5">
        <div class="rounded-lg bg-slate-900/80 p-2">
          <div class="text-slate-500">{label('Provider')}</div>
          <div class="mt-1 truncate font-semibold text-slate-200">{report.provider || '—'}</div>
        </div>
        <div class="rounded-lg bg-slate-900/80 p-2">
          <div class="text-slate-500">{label('Snapshot source')}</div>
          <div class="mt-1 font-semibold text-slate-200">{report.source || '—'}</div>
        </div>
        <div class="rounded-lg bg-slate-900/80 p-2">
          <div class="text-slate-500">{label('Received')}</div>
          <div class="mt-1 font-semibold text-slate-200">{formatTimestamp(report.receivedAt)}</div>
        </div>
        <div class="rounded-lg bg-slate-900/80 p-2">
          <div class="text-slate-500">{label('Observed')}</div>
          <div class="mt-1 font-semibold text-slate-200">
            {report.observedAt === null ? label('Observation time unavailable') : formatTimestamp(report.observedAt)}
          </div>
        </div>
        <div class="rounded-lg bg-slate-900/80 p-2">
          <div class="text-slate-500">{label('Snapshot age')}</div>
          <div class="mt-1 font-semibold text-slate-200">{formatAge(report.snapshotAgeMs)}</div>
        </div>
      </div>

      {visibleFindings.length > 0 ? (
        <div class="mt-3 overflow-x-auto">
          <table class="w-full min-w-[420px] text-left text-xs">
            <thead class="text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" class="py-2 pr-3">{label('Finding')}</th>
                <th scope="col" class="py-2 pr-3">{label('Ticker / currency')}</th>
                <th scope="col" class="py-2 pr-3 text-right">{label('App')}</th>
                <th scope="col" class="py-2 text-right">{label('Broker')}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-800">
              {visibleFindings.map((finding, index) => (
                <tr key={`${finding.type}-${finding.subject}-${index}`}>
                  <td class="py-2 pr-3 font-medium text-amber-200">{label(FINDING_COPY[finding.type])}</td>
                  <td class="py-2 pr-3 text-slate-300">{finding.subject}{finding.type === 'currency_mismatch' ? ` · ${finding.appCurrency || '—'} → ${finding.brokerCurrency || '—'}` : finding.currency ? ` · ${finding.currency}` : ''}</td>
                  <td class="py-2 pr-3 text-right tabular-nums text-slate-200">{formatQuantity(finding.appValue)}</td>
                  <td class="py-2 text-right tabular-nums text-slate-200">{formatQuantity(finding.brokerValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasMoreFindings && (
            <p class="mt-2 text-[11px] text-slate-500">
              {label('Showing first 12 findings; more discrepancies are available in the reconciliation result.')}
            </p>
          )}
        </div>
      ) : (
        <p class="mt-3 rounded-lg bg-slate-900/70 px-3 py-2 text-xs text-slate-300" role="status">
          {report.status === 'matched'
            ? label('No quantity discrepancies found.')
            : label('No confirmed discrepancy can be reported from this snapshot.')}
        </p>
      )}

      {report.warnings.length > 0 && (
        <ul class="mt-3 space-y-1 text-[11px] leading-5 text-amber-200" aria-label={label('Snapshot warnings')}>
          {report.warnings.slice(0, 4).map((warning, index) => (
            <li key={index} class="flex gap-2">
              <span aria-hidden="true">•</span>
              <span>{label(warning)}</span>
            </li>
          ))}
        </ul>
      )}

      <p class="mt-3 border-t border-slate-800 pt-2 text-[10px] leading-4 text-slate-500">
        {label('Read-only comparison. No positions, lots, cash balances, or cost basis are changed.')}
      </p>
    </section>
  );
}
