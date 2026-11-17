import { createPortal } from 'preact/compat';
import { useRef } from 'preact/hooks';
import type { MarketNewsItem } from '../services/api';
import { formatNewsRelativeTime, getSafeNewsArticleUrl } from '../features/quotes/marketInsightsContent';
import { useDialogFocus } from '../ui/dialogFocus';
import { ModalFrame } from './ModalFrame';

interface MarketNewsArticleDialogProps {
  article: MarketNewsItem | null;
  restoreFocusRef: { current: HTMLButtonElement | null };
  onClose: () => void;
}

/** Owns the company-news article portal, close lifecycle, and focus restoration. */
export function MarketNewsArticleDialog({
  article,
  restoreFocusRef,
  onClose
}: MarketNewsArticleDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<(() => void) | null>(null);
  const requestClose = () => { closeRef.current?.(); };

  useDialogFocus(dialogRef, {
    active: article !== null,
    initialFocusRef: closeButtonRef,
    restoreFocusRef,
    onEscape: requestClose
  });

  if (!article || typeof document === 'undefined') return null;
  const safeArticleUrl = getSafeNewsArticleUrl(article.url);

  return createPortal(
    <ModalFrame
      backdropClassName="news-article-modal fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto overscroll-contain bg-slate-950/80 backdrop-blur-sm"
      dialogClassName="news-article-dialog flex w-full max-w-3xl min-h-0 flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl"
      dialogRef={dialogRef}
      ariaLabelledBy="newsArticleModalTitle"
      closeRef={closeRef}
      onClose={onClose}
    >
      <header class="flex shrink-0 items-start justify-between gap-4 border-b border-slate-800 p-4 sm:p-5">
        <div class="min-w-0">
          <p class="mb-1 text-[10px] font-bold uppercase tracking-widest text-cyan-400">
            {article.source || 'Company news'} · {formatNewsRelativeTime(article.datetime)}
          </p>
          <h2 id="newsArticleModalTitle" class="text-base font-bold leading-snug text-slate-100 sm:text-lg">
            {article.headline || 'Untitled article'}
          </h2>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          class="shrink-0 flex min-h-11 min-w-11 items-center justify-center rounded border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 transition hover:border-cyan-700 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
          style={{ minHeight: '44px', minWidth: '44px' }}
          onClick={requestClose}
          aria-label="Close news article"
          data-news-dialog-close
        >
          ✕
        </button>
      </header>
      <div
        class="news-article-content min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5"
        role="region"
        aria-labelledby="newsArticleModalTitle"
        tabIndex={0}
      >
        <div class="whitespace-pre-wrap break-words leading-relaxed text-slate-300">
          {article.summary || article.description || article.content || 'A summary is not available from the news provider. Open the original article for the full story.'}
        </div>
        {safeArticleUrl && (
          <a
            href={safeArticleUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex min-h-11 items-center gap-2 rounded border border-cyan-800/80 bg-cyan-950/40 px-3 py-2 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-900/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
          >
            Read full article ↗
          </a>
        )}
      </div>
    </ModalFrame>,
    document.body
  );
}
