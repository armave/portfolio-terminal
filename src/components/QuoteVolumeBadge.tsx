import { getAppLanguage, translateText } from '../services/i18n';
import { formatQuoteDollarVolume } from '../utils/formatters';

interface QuoteVolumeBadgeProps {
  volume?: unknown;
  volumeValue?: unknown;
  price?: unknown;
  currency?: unknown;
}

export function QuoteVolumeBadge({ volume, volumeValue, price, currency }: QuoteVolumeBadgeProps) {
  const formattedVolume = formatQuoteDollarVolume(volumeValue, volume, price, currency);
  if (formattedVolume === null) return null;

  const language = getAppLanguage();
  const label = translateText(formattedVolume.estimated ? 'Estimated daily volume' : 'Daily volume', language);
  const description = translateText(
    formattedVolume.estimated
      ? 'Estimated daily volume: share volume multiplied by the latest USD share price. Use as an approximation; it is not provider-reported traded value.'
      : 'Daily volume reported by the data provider in USD.',
    language
  );
  const displayValue = (formattedVolume.estimated ? '~' : '') + formattedVolume.value;

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
