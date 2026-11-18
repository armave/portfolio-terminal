import { getAppLanguage, translateText } from '../services/i18n';
import { formatQuoteDollarVolume } from '../utils/formatters';

interface QuoteVolumeBadgeProps {
  volume?: unknown;
  price?: unknown;
  currency?: unknown;
}

export function QuoteVolumeBadge({ volume, price, currency }: QuoteVolumeBadgeProps) {
  const formattedVolume = formatQuoteDollarVolume(volume, price, currency);
  if (formattedVolume === null) return null;

  const language = getAppLanguage();
  const label = translateText('Volume', language);
  const description = translateText(
    'Estimated dollar volume: provider-reported volume multiplied by the current USD price. Reporting period may vary by source.',
    language
  );

  return (
    <span
      class="quote-volume-badge inline-flex items-center gap-1 rounded-full border border-slate-700/80 bg-slate-900/80 px-2 py-0.5 text-[9px] font-bold leading-none text-slate-300 tabular-nums whitespace-nowrap"
      title={description}
      aria-label={label + ' ' + formattedVolume}
    >
      <span class="font-semibold text-slate-500">{translateText('Vol.', language)}</span>
      <strong class="font-bold text-slate-200">{formattedVolume}</strong>
    </span>
  );
}
