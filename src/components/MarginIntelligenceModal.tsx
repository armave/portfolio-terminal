import { useEffect } from 'preact/hooks';

export interface MarginIntelligenceArticle {
  ticker: string;
  headline: string;
  source: string;
  url: string;
  publishedAt?: number;
  summary?: string;
}

export interface MarginIntelligenceState {
  title: string;
  scope: 'position' | 'portfolio';
  ticker?: string;
  loading: boolean;
  analysis: string;
  articles: MarginIntelligenceArticle[];
  error?: string;
}

interface MarginIntelligenceModalProps {
  data: MarginIntelligenceState;
  onClose: () => void;
}

function publishedLabel(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return 'Publication time unavailable';
  const date = new Date(timestamp > 1e12 ? timestamp : timestamp * 1000);
  return Number.isNaN(date.getTime()) ? 'Publication time unavailable' : date.toLocaleString();
}

export function MarginIntelligenceModal({ data, onClose }: MarginIntelligenceModalProps) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div class="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/80 p-2 backdrop-blur-sm sm:p-4" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section class="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-cyan-900/60 bg-slate-950 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="marginIntelligenceTitle">
        <header class="flex items-start justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <div>
            <div class="text-[10px] font-mono font-bold uppercase tracking-widest text-cyan-400">Gemini · Margin Intelligence</div>
            <h2 id="marginIntelligenceTitle" class="mt-1 text-lg font-bold text-white">{data.title}</h2>
            <p class="mt-1 text-xs text-slate-400">News-grounded decision support · Read-only · No broker orders are changed</p>
          </div>
          <button type="button" onClick={onClose} class="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">Close</button>
        </header>
        <div class="min-h-0 overflow-y-auto p-4">
          {data.loading && <div class="flex items-center gap-3 rounded-lg border border-cyan-900/40 bg-cyan-950/20 p-4 text-sm text-cyan-100" role="status"><span class="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />Fetching recent news and asking Gemini to assess your portfolio…</div>}
          {data.error && <div class="rounded-lg border border-rose-900/60 bg-rose-950/30 p-3 text-sm text-rose-200">{data.error}</div>}
          {data.analysis && <div class="whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{data.analysis}</div>}
          {!data.loading && !data.error && data.articles.length === 0 && data.analysis && <p class="mt-4 rounded border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-200">No news articles were returned by the connected provider. Treat any news-dependent conclusions as limited.</p>}
          {data.articles.length > 0 && <section class="mt-5 border-t border-slate-800 pt-4">
            <h3 class="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Sources reviewed ({data.articles.length})</h3>
            <ul class="space-y-2">
              {data.articles.map((article, index) => <li key={article.url + index} class="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                <div class="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-500"><span class="font-bold text-cyan-300">{article.ticker}</span><span>{article.source || 'News source'}</span><span>{publishedLabel(article.publishedAt)}</span></div>
                {article.url ? <a href={article.url} target="_blank" rel="noreferrer" class="text-sm font-semibold text-slate-100 underline decoration-slate-600 underline-offset-2 hover:text-cyan-300">{article.headline}</a> : <p class="text-sm font-semibold text-slate-100">{article.headline}</p>}
                {article.summary && <p class="mt-1 text-xs leading-5 text-slate-400">{article.summary}</p>}
              </li>)}
            </ul>
          </section>}
        </div>
        <footer class="border-t border-slate-800 px-4 py-3 text-[10px] leading-4 text-slate-500">AI-generated analysis can be wrong or incomplete. Verify material facts from original sources. This is not personalized financial advice; use your own judgment before changing a position.</footer>
      </section>
    </div>
  );
}
