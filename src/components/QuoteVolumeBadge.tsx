import { getAppLanguage, translateText } from '../services/i18n';
import { formatQuoteTurnover } from '../utils/formatters';

interface QuoteVolumeBadgeProps {
  volumeValue?: unknown;
  currency?: unknown;
  lastTradeTime?: unknown;
  serverTime?: unknown;
  isAdmin?: boolean;
}

function getCalendarDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^(\d{4}-\d{2}-\d{2})/.exec(value.trim())?.[1] ?? null;
}

function formatSessionDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

export function QuoteVolumeBadge({ volumeValue, currency, lastTradeTime, serverTime, isAdmin = false }: QuoteVolumeBadgeProps) {
  const tradeDate = getCalendarDate(lastTradeTime);
  const observationDate = getCalendarDate(serverTime);
  const isPriorSession = Boolean(tradeDate && observationDate && tradeDate !== observationDate);
  const sessionSuffix = isPriorSession && tradeDate ? ' · ' + formatSessionDate(tradeDate) : '';

  const formattedTurnover = formatQuoteTurnover(volumeValue, currency);
  if (formattedTurnover === null) return null;

  const language = getAppLanguage();
  const label = translateText(isAdmin ? 'Vol.' : 'Daily volume', language);
  const description = translateText('Daily traded value reported by the data provider in USD.', language) + sessionSuffix;

  return (
    <span
      class="quote-volume-badge inline-flex items-center gap-1 rounded-full border border-slate-700/80 bg-slate-900/80 px-2 py-0.5 text-[9px] font-bold leading-none text-slate-300 tabular-nums whitespace-nowrap"
      title={description}
      aria-label={label + ' ' + formattedTurnover + sessionSuffix}
    >
      <span class="font-semibold text-slate-400">{label}</span>
      <strong class="font-bold text-slate-100">{formattedTurnover}</strong>
    </span>
  );
}
