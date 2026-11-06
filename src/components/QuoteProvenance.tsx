import type { QuoteDetails } from '../types/portfolio';
import { getQuoteFreshness } from '../utils/formatters';
import { getAppLanguage, translateText } from '../services/i18n';

export interface QuoteProvenanceHolding {
  ticker?: string;
  shares?: unknown;
  currentPrice?: unknown;
  price?: unknown;
  quoteSource?: string;
  quoteUpdatedAt?: number;
  quoteDetails?: QuoteDetails;
  kind: 'Margin position' | 'Cash holding';
}

function formatQuoteTimestamp(value: unknown): string | null {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return new Intl.DateTimeFormat(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(timestamp);
}

export function QuoteProvenanceList({ holdings }: { holdings: QuoteProvenanceHolding[] }) {
  const language = getAppLanguage();
  const observed = translateText('Observed', language);
  const received = translateText('Received', language);
  const unavailable = translateText('Observation time unavailable', language);
  const entries = holdings.filter((holding) => {
    const shares = Number(holding.shares);
    return Number.isFinite(shares) && shares > 0;
  });
  if (entries.length === 0) return null;

  return (
    <details class="mt-1 text-[10px] text-slate-400">
      <summary class="min-h-7 cursor-pointer py-1 underline decoration-dotted underline-offset-2">
        {translateText('Quote sources and observation times', language)}
      </summary>
      <ul class="space-y-1 pl-3">
        {entries.map((holding, index) => {
          const freshness = getQuoteFreshness(holding);
          const freshnessLabel = freshness === 'fresh' ? 'Fresh'
            : freshness === 'stale' ? 'Stale'
              : freshness === 'delayed' ? 'Delayed'
                : freshness === 'unknown' ? 'Time unknown' : 'Not fetched';
          const sourceTimestamp = holding.quoteDetails?.sourceTimestamp;
          const receivedAt = holding.quoteDetails?.receivedAt ?? holding.quoteUpdatedAt;
          const observedAt = formatQuoteTimestamp(sourceTimestamp);
          const receivedAtText = formatQuoteTimestamp(receivedAt);
          const instrumentContext = [
            holding.quoteDetails?.currency,
            holding.quoteDetails?.exchange
          ].filter((value): value is string => typeof value === 'string' && value.length > 0).join(' · ');
          return (
            <li key={`${holding.kind}-${holding.ticker || index}`}>
              <span class="font-semibold text-slate-300">{translateText(holding.kind, language)} {holding.ticker || '—'}</span>
              <span> · {holding.quoteDetails?.provider || holding.quoteSource || translateText('Source unavailable', language)} · {translateText(freshnessLabel, language)}{instrumentContext ? ' · ' + instrumentContext : ''}</span>
              <span class="block">
                {observedAt ? `${observed}: ${observedAt}` : unavailable}
                {receivedAtText ? ` · ${received}: ${receivedAtText}` : ''}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
