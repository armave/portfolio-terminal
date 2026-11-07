import { emitUiEvent } from '../ui/uiEventBus';
import { getAppLanguage, translateText } from '../services/i18n';
import { BoardExternalLinks } from './BoardExternalLinks';

export function MarginMarketTools({ ticker, isAdmin }: { ticker?: string; isAdmin: boolean }) {
  const language = getAppLanguage();
  const reviewLabel = ticker ? 'News + Review' : 'Portfolio Review';
  const reviewTitle = ticker
    ? 'Review recent news and margin-position risks with Gemini'
    : 'Review recent news and risk across all margin positions with Gemini';

  return (
    <div class="portfolio-micro-column portfolio-micro-actions" aria-label={translateText('MARKET TOOLS', language)}>
      <span class="portfolio-micro-heading">{translateText('MARKET TOOLS', language)}</span>
      <div class="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          title={translateText(reviewTitle, language)}
          aria-label={translateText(reviewLabel, language)}
          onClick={() => emitUiEvent('terminal:margin-intelligence-request', ticker ? { ticker } : {})}
          class="rounded border border-cyan-800/70 bg-slate-900/90 px-2 py-1 text-[10px] font-mono font-bold text-cyan-200 transition hover:bg-cyan-950/50"
        >
          ✦ {translateText(reviewLabel, language)}
        </button>
        {ticker && isAdmin && <button
          type="button"
          title={`View live market depth for ${ticker}`}
          aria-label={`Market Depth for ${ticker}`}
          onClick={() => emitUiEvent('terminal:market-depth-request', { ticker })}
          class="rounded border border-emerald-800/70 bg-slate-900/90 px-2 py-1 text-[10px] font-mono font-bold text-emerald-200 transition hover:bg-emerald-950/50"
        >
          ▤ Depth
        </button>}
      </div>
      {ticker && (
        <div class="flex flex-wrap items-center gap-1.5" aria-label={translateText('External market research links', language)}>
          <BoardExternalLinks />
        </div>
      )}
    </div>
  );
}
