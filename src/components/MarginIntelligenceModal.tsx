import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { formatRelativeTime } from '../utils/relativeTime';
import { getAppLanguage, translateText } from '../services/i18n';
import { useDialogFocus } from '../ui/dialogFocus';
import type { MarginIntelligenceArticle, MarginNewsCoverage } from '../features/ai/marginIntelligence';
import {
  formatMarginCoverageStatus,
  formatMarginFetchedLabel,
  formatMarginSourcesHeading
} from '../features/ai/marginIntelligenceCopy';

export interface MarginIntelligenceState {
  title: string;
  scope: 'position' | 'portfolio';
  ticker?: string;
  loading: boolean;
  analysis: string;
  articles: MarginIntelligenceArticle[];
  coverage?: MarginNewsCoverage[];
  stale?: boolean;
  staleReasons?: string[];
  error?: string;
  syncedAt?: string;
  snapshotAsOf?: string;
  digestRevision?: number;
}

interface MarginIntelligenceModalProps {
  data: MarginIntelligenceState;
  onClose: () => void;
  onRefresh: () => void;
}

function publishedLabel(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return translateText('Publication time unavailable');
  const date = new Date(timestamp > 1e12 ? timestamp : timestamp * 1000);
  const locale = getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US';
  return Number.isNaN(date.getTime())
    ? translateText('Publication time unavailable')
    : date.toLocaleString(locale);
}

function relativeSyncLabel(syncedAt?: string, now = Date.now()): string {
  if (!syncedAt) return translateText('Not synced yet');
  const timestamp = Date.parse(syncedAt);
  if (!Number.isFinite(timestamp)) return translateText('Sync time unavailable');
  return `${translateText('Synced')} ${formatRelativeTime(timestamp, now)}`;
}

function dateTimeLabel(value?: string): string {
  if (!value) return translateText('Unavailable');
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US')
    : translateText('Unavailable');
}

function renderInlineMarkdown(text: string) {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index} class="font-semibold text-slate-50">{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index} class="rounded bg-slate-800 px-1 py-0.5 text-cyan-200">{part.slice(1, -1)}</code>;
    return part;
  });
}

function renderAnalysisMarkdown(markdown: string) {
  // Older synced digests may contain inline provider IDs; source cards are the canonical citations.
  const cleanedMarkdown = markdown.replace(/\s*\((?:Yahoo|Yahoo Finance),\s*\d{6,}\)/gi, '');
  const lines = cleanedMarkdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ComponentChildren[] = [];
  let paragraph: string[] = [];
  let listItems: Array<{ text: string; ordered: boolean }> = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      const text = paragraph.join(' ').trim();
      if (text) blocks.push(<p key={`p-${blocks.length}`} class="mb-3 last:mb-0">{renderInlineMarkdown(text)}</p>);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (listItems.length) {
      const ordered = listItems[0].ordered;
      const items = listItems;
      blocks.push(ordered
        ? <ol key={`ol-${blocks.length}`} class="mb-3 list-decimal space-y-1 pl-5">{items.map((item, index) => <li key={index}>{renderInlineMarkdown(item.text)}</li>)}</ol>
        : <ul key={`ul-${blocks.length}`} class="mb-3 list-disc space-y-1 pl-5">{items.map((item, index) => <li key={index}>{renderInlineMarkdown(item.text)}</li>)}</ul>);
      listItems = [];
    }
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      return;
    }
    if (/^---+$/.test(line) || /^\*\*\*$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push(<hr key={`hr-${blocks.length}`} class="my-4 border-slate-800" />);
      return;
    }
    const heading = line.match(/^(#{1,4})\s+(.+?)\s*#*$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const className = level <= 2 ? 'mb-2 mt-4 text-base font-bold text-white first:mt-0' : 'mb-2 mt-4 text-sm font-bold text-cyan-100 first:mt-0';
      blocks.push(<h3 key={`h-${blocks.length}`} class={className}>{renderInlineMarkdown(heading[2].replace(/\*\*/g, ''))}</h3>);
      return;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (listItems.length && listItems[0].ordered !== ordered) flushList();
      listItems.push({ text: (bullet || numbered)![1], ordered });
      return;
    }
    flushList();
    paragraph.push(line);
  });
  flushParagraph();
  flushList();
  return <div class="space-y-1">{blocks}</div>;
}

export function MarginIntelligenceModal({ data, onClose, onRefresh }: MarginIntelligenceModalProps) {
  const [now, setNow] = useState(Date.now());
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const coverage = Array.isArray(data.coverage) ? data.coverage : [];
  useDialogFocus(dialogRef, { initialFocusRef: closeButtonRef, onEscape: onClose });
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div class="margin-intelligence-overlay fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/80 p-2 backdrop-blur-sm sm:p-4" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} class="margin-intelligence-dialog flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-cyan-900/60 bg-slate-950 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="marginIntelligenceTitle" tabIndex={-1}>
        <header class="flex items-start justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <div class="min-w-0">
            <div class="text-[10px] font-mono font-bold uppercase tracking-widest text-cyan-400">{translateText('Gemini · Margin Intelligence', getAppLanguage())}</div>
            <h2 id="marginIntelligenceTitle" class="mt-1 text-lg font-bold text-white">{data.title}</h2>
            <p class="mt-1 text-xs text-slate-400">{translateText('Read-only · No broker orders are changed', getAppLanguage())}</p>
            <p class="mt-1 text-[11px] text-slate-500" title={data.syncedAt ? new Date(data.syncedAt).toLocaleString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US') : translateText('No server-synced digest yet', getAppLanguage())}>{relativeSyncLabel(data.syncedAt, now)}{data.syncedAt ? ` · ${new Date(data.syncedAt).toLocaleString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US')}` : ''}</p>
            <p class="mt-1 text-[11px] text-slate-500">{translateText('Portfolio snapshot', getAppLanguage())}: {dateTimeLabel(data.snapshotAsOf)}</p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button type="button" onClick={onRefresh} disabled={data.loading} aria-label={translateText('Refresh margin intelligence', getAppLanguage())} class="min-h-11 rounded border border-cyan-800 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-50">{data.loading ? translateText('Refreshing…', getAppLanguage()) : translateText('↻ Refresh', getAppLanguage())}</button>
            <button ref={closeButtonRef} type="button" onClick={onClose} aria-label={translateText('Close margin intelligence', getAppLanguage())} class="min-h-11 rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">{translateText('Close', getAppLanguage())}</button>
          </div>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto p-4" role="region" aria-labelledby="marginIntelligenceTitle" tabIndex={0}>
          {data.stale && <div class="mb-3 rounded-lg border border-amber-800/60 bg-amber-950/25 p-3 text-xs leading-5 text-amber-200" role="status">
            {translateText('This saved review may no longer match the current portfolio or news. Refresh it before relying on its conclusions.', getAppLanguage())}
            {data.staleReasons?.includes('snapshot-changed') && <span class="block">{translateText('The portfolio facts have changed since this review was generated.', getAppLanguage())}</span>}
            {data.staleReasons?.includes('prompt-changed') && <span class="block">{translateText('The review instructions have changed since this analysis was generated.', getAppLanguage())}</span>}
            {data.staleReasons?.includes('news-old') && <span class="block">{translateText('The news evidence is more than 24 hours old or its timestamp is unavailable.', getAppLanguage())}</span>}
            {data.staleReasons?.includes('metadata-missing') && <span class="block">{translateText('This review predates the current evidence and freshness metadata.', getAppLanguage())}</span>}
          </div>}
          {data.loading && <div class="flex items-center gap-3 rounded-lg border border-cyan-900/40 bg-cyan-950/20 p-4 text-sm text-cyan-100" role="status"><span class="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />{translateText('Syncing fresh news and regenerating the review…', getAppLanguage())}</div>}
          {data.error && <div class="rounded-lg border border-rose-900/60 bg-rose-950/30 p-3 text-sm text-rose-200">{data.error}</div>}
          {data.analysis && <div data-animate-content class="break-words text-sm leading-6 text-slate-200">{renderAnalysisMarkdown(data.analysis)}</div>}
          {coverage.length > 0 && <section class="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
            <h3 class="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">{translateText('News coverage by position', getAppLanguage())}</h3>
            <ul class="grid gap-1 text-xs sm:grid-cols-2">
              {coverage.map(item => <li key={item.ticker} class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span class="font-semibold text-cyan-200">{item.ticker}</span>
                <span class={item.status === 'error' ? 'text-rose-300' : item.status === 'empty' ? 'text-amber-300' : 'text-slate-300'}>
                  {formatMarginCoverageStatus(item, getAppLanguage())}
                </span>
                <span class="w-full text-right text-[10px] text-slate-500">{formatMarginFetchedLabel(dateTimeLabel(item.fetchedAt), getAppLanguage())}</span>
              </li>)}
            </ul>
          </section>}
          {!data.loading && !data.error && data.articles.length === 0 && data.analysis && <p class="mt-4 rounded border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-200">
            {coverage.some(item => item.status === 'error')
              ? translateText('Some news feeds failed. No source-backed news claims should be inferred from those positions.', getAppLanguage())
              : translateText('No articles were available from the connected news feeds. News-dependent conclusions are limited.', getAppLanguage())}
          </p>}
          {data.articles.length > 0 && <section class="mt-5 border-t border-slate-800 pt-4">
            <h3 class="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">{formatMarginSourcesHeading(data.articles.length, getAppLanguage())}</h3>
            <ul class="space-y-2">
              {data.articles.map((article, index) => <li key={article.url + index} data-animate-content class="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                <div class="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-500"><span class="font-bold text-cyan-300">{article.ticker}</span>{article.sourceId && <span class="rounded border border-cyan-900/70 px-1 text-cyan-200">[{article.sourceId}]</span>}<span>{article.source || translateText('News source', getAppLanguage())}</span><span>{publishedLabel(article.publishedAt)}</span></div>
                {article.url ? <a href={article.url} target="_blank" rel="noreferrer" class="text-sm font-semibold text-slate-100 underline decoration-slate-600 underline-offset-2 hover:text-cyan-300">{article.headline}</a> : <p class="text-sm font-semibold text-slate-100">{article.headline}</p>}
                {article.summary && <p class="mt-1 text-xs leading-5 text-slate-400">{article.summary}</p>}
              </li>)}
            </ul>
          </section>}
        </div>
        <footer class="border-t border-slate-800 px-4 py-3 text-[10px] leading-4 text-slate-500">{translateText('AI-generated analysis can be wrong or incomplete. Verify material facts from original sources. This is not personalized financial advice; use your own judgment before changing a position.', getAppLanguage())}</footer>
      </section>
    </div>
  );
}
