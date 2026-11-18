import { getAppLanguage, translateText } from '../services/i18n';
import { formatQuoteVolume } from '../utils/formatters';

interface QuoteVolumeBadgeProps {
  volume?: unknown;
}

export function QuoteVolumeBadge({ volume }: QuoteVolumeBadgeProps) {
  const formattedVolume = formatQuoteVolume(volume);
  if (formattedVolume === null) return null;

  const language = getAppLanguage();
  const label = translateText('Daily volume', language);
  const description = translateText('Daily share volume reported by the data provider.', language);
  const displayValue = formattedVolume + ' ' + translateText('shares', language);

  return (
    <span
      class="quote-volume-badge inline-flex items-center gap-1 rounded-full border border-slate-700/80 bg-slate-900/80 px-2 py-0.5 text-[9px] font-bold leading-none text-slate-300 tabular-nums whitespace-nowrap"
      title={description}
      aria-label={label + ' ' + displayValue}
    >
      <span class="font-semibold text-slate-400">{label}</span>
      <strong class="font-bold text-slate-100">{displayValue}</strong>
    </span>
  );
}
