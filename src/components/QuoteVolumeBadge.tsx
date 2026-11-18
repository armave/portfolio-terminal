import { getAppLanguage, translateText } from '../services/i18n';
import { formatQuoteTurnover } from '../utils/formatters';

interface QuoteVolumeBadgeProps {
  volumeValue?: unknown;
  currency?: unknown;
  isAdmin?: boolean;
}

export function QuoteVolumeBadge({ volumeValue, currency, isAdmin = false }: QuoteVolumeBadgeProps) {
  const formattedTurnover = formatQuoteTurnover(volumeValue, currency);
  if (formattedTurnover === null) return null;

  const language = getAppLanguage();
  const label = translateText(isAdmin ? 'Vol.' : 'Daily volume', language);
  const description = translateText('Daily traded value reported by the data provider in USD.', language);

  return (
    <span
      class="quote-volume-badge inline-flex items-center gap-1 rounded-full border border-slate-700/80 bg-slate-900/80 px-2 py-0.5 text-[9px] font-bold leading-none text-slate-300 tabular-nums whitespace-nowrap"
      title={description}
      aria-label={label + ' ' + formattedTurnover}
    >
      <span class="font-semibold text-slate-400">{label}</span>
      <strong class="font-bold text-slate-100">{formattedTurnover}</strong>
    </span>
  );
}
