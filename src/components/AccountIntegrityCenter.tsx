import { useMemo } from 'preact/hooks';
import type { BrokerDataSnapshot, BrokerPortfolioSnapshot } from '../types/broker';
import type { CashStockHolding, PortfolioState, PositionRecord } from '../types/portfolio';
import { reconcileBrokerPortfolio } from '../domain/brokerReconciliation';
import { getAppLanguage, translateText } from '../services/i18n';

type BrokerAccountInfo = NonNullable<PortfolioState['brokerAccountInfo']>;

interface IntegrityPosition {
  ticker: string;
  quantity: unknown;
  currency?: string;
}

interface AccountIntegrityCenterProps {
  brokerAccountInfo?: BrokerAccountInfo;
  positions: Record<string, PositionRecord>;
  cashHoldings: readonly CashStockHolding[];
  appPositionStatus?: 'complete' | 'partial' | 'unavailable';
}

type ReportStatus = 'matched' | 'differences' | 'partial' | 'provisional' | 'stale' | 'unavailable';

const STATUS_COPY: Record<ReportStatus, string> = {
  matched: 'Verified',
  differences: 'Discrepancies found',
  partial: 'Partial data',
  provisional: 'Provisional',
  stale: 'Stale snapshot',
  unavailable: 'Unavailable'
};

const ACCOUNT_INTEGRITY_RU_COPY: Record<string, string> = {
  'Account Integrity Center': 'Центр целостности счёта',
  'A quick view of portfolio data quality and broker verification.': 'Краткая сводка качества данных портфеля и проверки по данным брокера.',
  'Verified': 'Проверено',
  'Partial data': 'Неполные данные',
  'Provisional': 'Предварительно',
  'Stale snapshot': 'Устаревший снимок',
  'App symbols': 'Инструменты приложения',
  'Broker symbols': 'Инструменты брокера',
  'Findings': 'Результаты проверки',
  'Account integrity summary': 'Сводка целостности счёта',
  'Latest broker refresh': 'Последнее обновление данных брокера',
  'Not confirmed': 'Не подтверждено',
  'App execution history': 'История исполненных сделок приложения',
  'Cash & margin balances': 'Денежные средства и маржа',
  'Not independently compared': 'Нет независимого сравнения',
  'The current comparison covers position quantities only. Cash and margin balances are not verified because an independent app-side balance is not available.': 'Текущее сравнение охватывает только количество позиций. Денежные средства и маржа не проверены, поскольку независимый баланс со стороны приложения недоступен.',
  'All comparable positions match the verified broker snapshot.': 'Все сопоставимые позиции совпадают с проверенным снимком брокера.',
  'Discrepancies were found. Open verification details to review them.': 'Обнаружены расхождения. Откройте подробности проверки, чтобы изучить их.',
  'The comparison is incomplete. Missing rows cannot be verified.': 'Сравнение неполное. Отсутствующие строки нельзя проверить.',
  'No confirmed result is available because the broker observation time or another required input is unverified.': 'Подтверждённый результат недоступен: время наблюдения брокера или другие обязательные данные не проверены.',
  'The last saved broker snapshot is stale. Refresh before relying on this comparison.': 'Последний сохранённый снимок брокера устарел. Обновите данные, прежде чем полагаться на это сравнение.',
  'No broker snapshot is available. No reconciliation was performed.': 'Снимок брокера недоступен. Сверка не выполнялась.',
  'View verification details': 'Подробности проверки',
  'Provider and comparison evidence': 'Провайдер и данные сравнения',
  'Snapshot quality': 'Качество снимка',
  'Complete': 'Полная',
  'Partial': 'Частичная',
  'Empty': 'Пустой',
  'No comparison findings are available for this snapshot.': 'Для этого снимка нет результатов сравнения.',
  'Read-only verification. No positions, lots, cash balances, or cost basis are changed.': 'Проверка только для чтения. Позиции, лоты, денежные остатки и себестоимость не изменяются.'
};

export function translateAccountIntegrityText(value: string, language = getAppLanguage()): string {
  if (language === 'ru' && ACCOUNT_INTEGRITY_RU_COPY[value]) {
    return ACCOUNT_INTEGRITY_RU_COPY[value];
  }
  return translateText(value, language);
}

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

function normalizedTicker(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase().replace(/\.US$/i, '') : '';
}

function isPositiveQuantity(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

/** Count unique instruments, not shares: adding unlike tickers would be meaningless. */
export function countIntegritySymbols(rows: readonly IntegrityPosition[]): number {
  return new Set(
    rows
      .filter(row => isPositiveQuantity(row.quantity))
      .map(row => normalizedTicker(row.ticker))
      .filter(Boolean)
  ).size;
}

export interface AccountIntegrityCounts {
  appSymbols: number;
  brokerSymbols: number | null;
  findings: number;
}

/** A null broker collection means unavailable, not a verified zero-position account. */
export function getAccountIntegrityCounts(
  appPositions: readonly IntegrityPosition[],
  brokerPositions: readonly IntegrityPosition[] | null,
  findingCount: number
): AccountIntegrityCounts {
  return {
    appSymbols: countIntegritySymbols(appPositions),
    brokerSymbols: brokerPositions === null ? null : countIntegritySymbols(brokerPositions),
    findings: Number.isFinite(findingCount) ? Math.max(0, Math.floor(findingCount)) : 0
  };
}

function formatQuantity(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', {
    maximumFractionDigits: 6
  }).format(value);
}

function formatTimestamp(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return new Intl.DateTimeFormat(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function formatAge(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return translateText('Unknown', getAppLanguage());
  const minutes = Math.max(0, Math.floor(value / 60_000));
  const unit: Intl.RelativeTimeFormatUnit = minutes < 60 ? 'minute' : minutes < 24 * 60 ? 'hour' : 'day';
  const amount = unit === 'minute' ? minutes : unit === 'hour' ? Math.floor(minutes / 60) : Math.floor(minutes / (24 * 60));
  return new Intl.RelativeTimeFormat(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', {
    numeric: 'auto'
  }).format(-amount, unit);
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
      ...(!hasVerifiedQuality ? ['Broker snapshot has no verified completeness metadata.'] : []),
      ...(!info.source ? ['Broker snapshot has no verified source metadata.'] : [])
    ]
  };
}

function statusTone(status: ReportStatus): string {
  if (status === 'matched') return 'border-emerald-800/70 bg-emerald-950/30 text-emerald-300';
  if (status === 'differences') return 'border-rose-800/70 bg-rose-950/25 text-rose-200';
  if (status === 'unavailable') return 'border-slate-700 bg-slate-900 text-slate-300';
  return 'border-amber-800/70 bg-amber-950/20 text-amber-200';
}

function refreshStatus(info: BrokerAccountInfo | undefined): string {
  if (!info?.loaded || info.status === 'unavailable') return 'Unavailable';
  if (info.status === 'stale') return 'Stale';
  if (info.status === 'current') return 'Current';
  return 'Not confirmed';
}

function emptyStateCopy(status: ReportStatus): string {
  switch (status) {
    case 'matched':
      return 'All comparable positions match the verified broker snapshot.';
    case 'differences':
      return 'Discrepancies were found. Open verification details to review them.';
    case 'partial':
      return 'The comparison is incomplete. Missing rows cannot be verified.';
    case 'provisional':
      return 'No confirmed result is available because the broker observation time or another required input is unverified.';
    case 'stale':
      return 'The last saved broker snapshot is stale. Refresh before relying on this comparison.';
    default:
      return 'No broker snapshot is available. No reconciliation was performed.';
  }
}

export function AccountIntegrityCenter({
  brokerAccountInfo,
  positions,
  cashHoldings,
  appPositionStatus
}: AccountIntegrityCenterProps) {
  const brokerSnapshot = useMemo(() => buildBrokerSnapshot(brokerAccountInfo), [brokerAccountInfo]);
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
    appPositionStatus,
    now: Date.now()
  });

  const label = (value: string) => translateAccountIntegrityText(value);
  const status = report.status as ReportStatus;
  const brokerPositions = brokerAccountInfo?.loaded ? brokerAccountInfo.positions : null;
  const counts = getAccountIntegrityCounts(appPositions, brokerPositions, report.findings.length);
  const currentRefreshStatus = refreshStatus(brokerAccountInfo);
  
  return (
    <section
      aria-labelledby="accountIntegrityTitle"
      class="rounded-xl border border-slate-800 bg-slate-950/50 p-3"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0">
          <h3 id="accountIntegrityTitle" class="text-sm font-bold text-slate-100">
            {label('Account Integrity Center')}
          </h3>
          <p class="mt-0.5 text-[11px] leading-4 text-slate-400">
            {label('A quick view of portfolio data quality and broker verification.')}
          </p>
        </div>
        <span class={'shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold ' + statusTone(status)}>
          {label(STATUS_COPY[status])}
        </span>
      </div>

      <div class="mt-3 grid grid-cols-3 gap-2" aria-label={label('Account integrity summary')}>
        <div class="min-w-0 rounded-lg border border-slate-800 bg-slate-900/70 p-2">
          <div class="text-[10px] text-slate-500">{label('App symbols')}</div>
          <div class="mt-1 font-mono text-xl font-bold tabular-nums text-slate-100">{counts.appSymbols}</div>
        </div>
        <div class="min-w-0 rounded-lg border border-slate-800 bg-slate-900/70 p-2">
          <div class="text-[10px] text-slate-500">{label('Broker symbols')}</div>
          <div class="mt-1 font-mono text-xl font-bold tabular-nums text-slate-100">
            {counts.brokerSymbols === null ? '—' : counts.brokerSymbols}
          </div>
        </div>
        <div class="min-w-0 rounded-lg border border-slate-800 bg-slate-900/70 p-2">
          <div class="text-[10px] text-slate-500">{label('Findings')}</div>
          <div class={'mt-1 font-mono text-xl font-bold tabular-nums ' + (counts.findings > 0 ? 'text-amber-200' : 'text-slate-100')}>
            {counts.findings}
          </div>
        </div>
      </div>

      <div class="mt-3 grid gap-2 text-[11px] sm:grid-cols-2">
        <div class="flex items-center justify-between gap-3 rounded-lg bg-slate-900/60 px-3 py-2">
          <span class="text-slate-400">{label('Latest broker refresh')}</span>
          <span class={'font-semibold ' + (currentRefreshStatus === 'Current' ? 'text-emerald-300' : 'text-amber-200')}>
            {label(currentRefreshStatus)}
          </span>
        </div>
        <div class="flex items-center justify-between gap-3 rounded-lg bg-slate-900/60 px-3 py-2">
          <span class="text-slate-400">{label('App execution history')}</span>
          <span class="font-semibold text-slate-200">
            {label(appPositionStatus === 'complete' ? 'Complete' : appPositionStatus === 'partial' ? 'Partial' : 'Unavailable')}
          </span>
        </div>
        <div class="flex items-center justify-between gap-3 rounded-lg bg-slate-900/60 px-3 py-2 sm:col-span-2">
          <span class="text-slate-400">{label('Cash & margin balances')}</span>
          <span class="font-semibold text-amber-200">{label('Not independently compared')}</span>
        </div>
      </div>

      <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-4 text-slate-500">
        <span>{label('Snapshot source')}: {report.source || '—'}</span>
        <span>{label('Received')}: {formatTimestamp(report.receivedAt)}</span>
        <span>{label('Snapshot age')}: {formatAge(report.snapshotAgeMs)}</span>
        <span>{report.observedAt === null ? label('Observation time unavailable') : label('Observed') + ': ' + formatTimestamp(report.observedAt)}</span>
      </div>

      <p class="mt-2 text-[10px] leading-4 text-slate-500">
        {label('The current comparison covers position quantities only. Cash and margin balances are not verified because an independent app-side balance is not available.')}
      </p>

      <div class="mt-3 rounded-lg bg-slate-900/60 px-3 py-2 text-xs text-slate-300" role="status" aria-live="polite">
        {label(emptyStateCopy(status))}
      </div>

      <details class="mt-3 border-t border-slate-800 pt-2">
        <summary class="flex cursor-pointer list-none items-center justify-between gap-3 py-1 text-xs font-semibold text-cyan-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
          <span>{label('View verification details')}</span>
          <span class="text-[10px] font-normal text-slate-500">{label('Provider and comparison evidence')}</span>
        </summary>

        <div class="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3">
          <div class="rounded-lg bg-slate-900/70 p-2">
            <div class="text-slate-500">{label('Provider')}</div>
            <div class="mt-1 truncate font-semibold text-slate-200">{report.provider || '—'}</div>
          </div>
          <div class="rounded-lg bg-slate-900/70 p-2">
            <div class="text-slate-500">{label('Snapshot source')}</div>
            <div class="mt-1 font-semibold text-slate-200">{report.source || '—'}</div>
          </div>
          <div class="rounded-lg bg-slate-900/70 p-2">
            <div class="text-slate-500">{label('Snapshot quality')}</div>
            <div class="mt-1 font-semibold text-slate-200">{label(report.quality === 'complete' ? 'Complete' : report.quality === 'partial' ? 'Partial' : report.quality === 'empty' ? 'Empty' : 'Unknown')}</div>
          </div>
          <div class="rounded-lg bg-slate-900/70 p-2">
            <div class="text-slate-500">{label('Received')}</div>
            <div class="mt-1 font-semibold text-slate-200">{formatTimestamp(report.receivedAt)}</div>
          </div>
          <div class="rounded-lg bg-slate-900/70 p-2">
            <div class="text-slate-500">{label('Observed')}</div>
            <div class="mt-1 font-semibold text-slate-200">
              {report.observedAt === null ? label('Observation time unavailable') : formatTimestamp(report.observedAt)}
            </div>
          </div>
          <div class="rounded-lg bg-slate-900/70 p-2">
            <div class="text-slate-500">{label('Snapshot age')}</div>
            <div class="mt-1 font-semibold text-slate-200">{formatAge(report.snapshotAgeMs)}</div>
          </div>
        </div>

        {report.findings.length > 0 ? (
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
                {report.findings.map((finding, index) => (
                  <tr key={finding.type + '-' + finding.subject + '-' + index}>
                    <td class="py-2 pr-3 font-medium text-amber-200">{label(FINDING_COPY[finding.type])}</td>
                    <td class="py-2 pr-3 text-slate-300">
                      {finding.subject}
                      {finding.type === 'currency_mismatch'
                        ? ' · ' + (finding.appCurrency || '—') + ' → ' + (finding.brokerCurrency || '—')
                        : finding.currency ? ' · ' + finding.currency : ''}
                    </td>
                    <td class="py-2 pr-3 text-right tabular-nums text-slate-200">{formatQuantity(finding.appValue)}</td>
                    <td class="py-2 text-right tabular-nums text-slate-200">{formatQuantity(finding.brokerValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p class="mt-3 text-xs text-slate-400">
            {label('No comparison findings are available for this snapshot.')}
          </p>
        )}

        {report.warnings.length > 0 && (
          <ul class="mt-3 space-y-1 text-[11px] leading-5 text-amber-200" aria-label={label('Snapshot warnings')}>
            {report.warnings.map((warning, index) => (
              <li key={index} class="flex gap-2">
                <span aria-hidden="true">•</span>
                <span>{label(warning)}</span>
              </li>
            ))}
          </ul>
        )}
      </details>

      <p class="mt-3 border-t border-slate-800 pt-2 text-[10px] leading-4 text-slate-500">
        {label('Read-only verification. No positions, lots, cash balances, or cost basis are changed.')}
      </p>
    </section>
  );
}
