import { useEffect, useMemo, useState } from 'preact/hooks';
import { usePortfolioSelector } from '../store/portfolioStore';
import { getAppLanguage, translateText } from '../services/i18n';
import { addBrokerEventListener, getLastExecutedTradesRefreshAt } from '../services/brokerEventBus';
import {
  getFreedomAccountStreamHealth,
  subscribeFreedomAccountStreamHealth
} from '../services/freedomAccountStreamHealth';
import { useQuoteRefreshInterval } from '../ui/useQuoteRefreshInterval';
import { DEFAULT_ADMIN_REFRESH_INTERVAL_MS } from '../services/portfolioAutoRefresh';
import {
  formatQuoteFreshnessSummary,
  summarizeQuoteFreshness
} from '../utils/formatters';
import {
  formatExactSyncTimestamp,
  formatRelativeSyncTime,
  resolveCloudSyncLabel,
  resolveCloudSyncTone
} from './CloudSyncIndicator';
import {
  resolveAccountStreamHealthState,
  resolvePortfolioQuoteHealthState,
  resolveTradeHistoryHealthState
} from '../ui/portfolioHealthStatus';
import type { CloudStatus } from '../ui/uiStateStore';

type HealthTone = 'current' | 'delayed' | 'attention' | 'pending' | 'neutral' | 'error';

function hasUsablePrice(value: unknown): boolean {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function healthToneClass(tone: HealthTone): string {
  switch (tone) {
    case 'current': return 'text-emerald-300';
    case 'delayed': return 'text-sky-300';
    case 'attention': return 'text-amber-300';
    case 'pending': return 'text-cyan-300';
    case 'error': return 'text-rose-300';
    default: return 'text-slate-300';
  }
}

function HealthItem({ title, status, detail, tone }: {
  title: string;
  status: string;
  detail: string;
  tone: HealthTone;
}) {
  return (
    <article class="min-w-0 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
      <h3 class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <p class={'mt-1 text-sm font-semibold ' + healthToneClass(tone)}>{status}</p>
      <p class="mt-1 break-words text-[11px] leading-5 text-slate-400">{detail}</p>
    </article>
  );
}

export function PortfolioHealthCenter({
  accountId,
  cloudStatus,
  cloudSyncStatus,
  onOpenReconciliation
}: {
  accountId: string;
  cloudStatus: CloudStatus;
  cloudSyncStatus: CloudStatus;
  onOpenReconciliation: () => void;
}) {
  const language = getAppLanguage();
  const sessionKey = 'admin:' + accountId;
  const refreshIntervalMs = useQuoteRefreshInterval(DEFAULT_ADMIN_REFRESH_INTERVAL_MS, 'admin');
  const portfolioSnapshot = usePortfolioSelector(
    (state) => ({
      positions: state.positions || {},
      cashHoldings: state.cashCushion?.holdings || [],
      brokerExecutionCount: state.brokerExecutedTrades?.length || 0
    }),
    (previous, next) =>
      previous.positions === next.positions &&
      previous.cashHoldings === next.cashHoldings &&
      previous.brokerExecutionCount === next.brokerExecutionCount
  );

  const [streamHealth, setStreamHealth] = useState(() => getFreedomAccountStreamHealth(sessionKey));
  useEffect(() => {
    setStreamHealth(getFreedomAccountStreamHealth(sessionKey));
    return subscribeFreedomAccountStreamHealth((changedSession) => {
      if (changedSession === sessionKey) setStreamHealth(getFreedomAccountStreamHealth(sessionKey));
    });
  }, [sessionKey]);

  const [lastTradeRefreshAt, setLastTradeRefreshAt] = useState(
    () => getLastExecutedTradesRefreshAt(sessionKey)
  );
  useEffect(() => {
    setLastTradeRefreshAt(getLastExecutedTradesRefreshAt(sessionKey));
    return addBrokerEventListener('broker:executed-trades-refresh-complete', (refresh) => {
      if (refresh.sessionIdentity === sessionKey) setLastTradeRefreshAt(refresh.completedAt);
    });
  }, [sessionKey]);

  const quoteHoldings = useMemo(() => {
    const marginHoldings = Object.values(portfolioSnapshot.positions)
      .filter((position) => Number(position.shares) > 0)
      .map((position) => hasUsablePrice(position.currentPrice)
        ? position
        : { ...position, quoteUpdatedAt: undefined, quoteSource: undefined, quoteDetails: undefined });
    const cashHoldings = portfolioSnapshot.cashHoldings
      .filter((holding) => Number(holding.shares) > 0)
      .map((holding) => {
        const price = hasUsablePrice(holding.currentPrice) ? holding.currentPrice : holding.price;
        return hasUsablePrice(price)
          ? { ...holding, currentPrice: price }
          : { ...holding, quoteUpdatedAt: undefined, quoteSource: undefined, quoteDetails: undefined };
      });
    return [...marginHoldings, ...cashHoldings];
  }, [portfolioSnapshot.positions, portfolioSnapshot.cashHoldings]);
  const quoteSummary = useMemo(
    () => summarizeQuoteFreshness(quoteHoldings, Date.now(), refreshIntervalMs),
    [quoteHoldings, refreshIntervalMs]
  );
  const quoteState = resolvePortfolioQuoteHealthState(quoteSummary);
  const streamState = resolveAccountStreamHealthState(streamHealth);
  const tradeState = resolveTradeHistoryHealthState(lastTradeRefreshAt, portfolioSnapshot.brokerExecutionCount);
  const cloudTone = resolveCloudSyncTone(cloudStatus, cloudSyncStatus);
  const cloudLabel = resolveCloudSyncLabel(cloudStatus, cloudTone, language);
  const lastCloudSyncAt = cloudSyncStatus.lastSyncedAt ?? cloudStatus.lastSyncedAt ?? null;
  const lastCloudSyncRelative = formatRelativeSyncTime(lastCloudSyncAt, Date.now(), language);
  const lastCloudSyncExact = formatExactSyncTimestamp(lastCloudSyncAt, language);

  const streamStatus = streamState === 'live' ? translateText('Live', language)
    : streamState === 'waiting' ? translateText('Waiting for snapshots', language)
      : streamState === 'connecting' ? translateText('Connecting', language)
        : translateText('REST fallback', language);
  const streamDetail = streamState === 'live'
    ? translateText('Account and active orders confirmed on the live stream.', language)
    : streamState === 'waiting'
      ? translateText('The socket is connected; waiting for validated account and order snapshots.', language)
      : streamState === 'connecting'
        ? translateText('Opening the private account stream.', language)
        : translateText('The stream is unavailable; REST snapshots are the fallback path.', language);

  const quoteStatus = quoteState === 'current' ? translateText('Current', language)
    : quoteState === 'delayed' ? translateText('Delayed', language)
      : quoteState === 'attention' ? translateText('Attention', language)
        : translateText('Unavailable', language);
  const quoteDetail = quoteSummary.total > 0
    ? formatQuoteFreshnessSummary(quoteSummary)
    : translateText('No tracked holdings to price.', language);

  const tradeStatus = tradeState === 'confirmed' ? translateText('Provider-confirmed', language)
    : tradeState === 'cached' ? translateText('Cached only', language)
      : translateText('Not confirmed', language);
  const tradeDetail = lastTradeRefreshAt
    ? translateText('Last provider refresh', language) + ': ' +
      formatRelativeSyncTime(lastTradeRefreshAt, Date.now(), language)
    : portfolioSnapshot.brokerExecutionCount > 0
      ? translateText('Saved execution history is available, but no provider refresh is confirmed.', language)
      : translateText('No provider refresh has been confirmed yet.', language);

  const cloudVisualTone: HealthTone = cloudTone === 'success' ? 'current'
    : cloudTone === 'pending' ? 'pending'
      : cloudTone === 'conflict' || cloudTone === 'error' ? 'error'
        : cloudTone === 'warning' ? 'attention' : 'neutral';
  const cloudDetail = cloudTone === 'conflict'
    ? translateText('Cloud sync conflict — recovery required', language)
    : cloudTone === 'error'
      ? translateText('The last confirmed cloud save is retained after a sync error.', language)
      : lastCloudSyncRelative
        ? translateText('Last confirmed save', language) + ': ' + lastCloudSyncRelative
        : translateText('No confirmed cloud save yet.', language);

  return (
    <section class="space-y-3 rounded-xl border border-slate-800 bg-slate-900/30 p-3 sm:p-4" aria-labelledby="portfolioHealthTitle" data-portfolio-health-center="true">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="portfolioHealthTitle" class="text-sm font-bold text-slate-100">{translateText('Portfolio health', language)}</h2>
          <p class="mt-1 text-[11px] leading-5 text-slate-400">
            {translateText('Source connectivity and confirmed update times. Quote quality and cloud synchronization are reported separately.', language)}
          </p>
        </div>
      </div>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <HealthItem
          title={translateText('TradeNet account stream', language)}
          status={streamStatus}
          detail={streamDetail}
          tone={streamState === 'live' ? 'current' : streamState === 'waiting' || streamState === 'connecting' ? 'pending' : 'attention'}
        />
        <HealthItem
          title={translateText('Market quotes', language)}
          status={quoteStatus}
          detail={quoteDetail}
          tone={quoteState === 'current' ? 'current' : quoteState === 'delayed' ? 'delayed' : quoteState === 'attention' ? 'attention' : 'neutral'}
        />
        <HealthItem
          title={translateText('Trade history', language)}
          status={tradeStatus}
          detail={tradeDetail}
          tone={tradeState === 'confirmed' ? 'current' : tradeState === 'cached' ? 'neutral' : 'attention'}
        />
        <HealthItem
          title={translateText('Cloud portfolio', language)}
          status={cloudLabel}
          detail={cloudDetail}
          tone={cloudVisualTone}
        />
      </div>
      <div class="flex flex-col gap-2 border-t border-slate-800 pt-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="min-w-0">
          <h3 class="text-xs font-semibold text-slate-200">{translateText('Broker reconciliation', language)}</h3>
          <p class="mt-1 text-[11px] leading-5 text-slate-400">
            {translateText('Compare broker executions, cashflows and quote evidence with app journal records. The review is read-only.', language)}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenReconciliation}
          class="inline-flex min-h-10 shrink-0 items-center justify-center rounded border border-cyan-800/70 px-3 py-2 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-950/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
        >
          {translateText('Review broker activity', language)}
        </button>
      </div>
      {lastCloudSyncExact && <span class="sr-only">{translateText('Last confirmed save', language)}: {lastCloudSyncExact}</span>}
    </section>
  );
}
