import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';

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
  syncedAt?: string;
  digestRevision?: number;
}

interface MarginIntelligenceModalProps {
  data: MarginIntelligenceState;
  onClose: () => void;
  onRefresh: () => void;
}

function publishedLabel(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return 'Publication time unavailable';
  const date = new Date(timestamp > 1e12 ? timestamp : timestamp * 1000);
  return Number.isNaN(date.getTime()) ? 'Publication time unavailable' : date.toLocaleString();
}

function relativeSyncLabel(syncedAt?: string, now = Date.now()): string {
  if (!syncedAt) return 'Not synced yet';
  const timestamp = Date.parse(syncedAt);
  if (!Number.isFinite(timestamp)) return 'Sync time unavailable';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 10) return 'Synced just now';
  if (seconds < 60) return `Synced ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Synced ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Synced ${days}d ago`;
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
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

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
          <div class="min-w-0">
            <div class="text-[10px] font-mono font-bold uppercase tracking-widest text-cyan-400">Gemini · Margin Intelligence</div>
            <h2 id="marginIntelligenceTitle" class="mt-1 text-lg font-bold text-white">{data.title}</h2>
            <p class="mt-1 text-xs text-slate-400">Read-only · No broker orders are changed</p>
            <p class="mt-1 text-[11px] text-slate-500" title={data.syncedAt ? new Date(data.syncedAt).toLocaleString() : 'No server-synced digest yet'}>{relativeSyncLabel(data.syncedAt, now)}{data.syncedAt ? ` · ${new Date(data.syncedAt).toLocaleString()}` : ''}</p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button type="button" onClick={onRefresh} disabled={data.loading} class="rounded border border-cyan-800 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-950/50 disabled:cursor-not-allowed disabled:opacity-50">{data.loading ? 'Refreshing…' : '↻ Refresh'}</button>
            <button type="button" onClick={onClose} class="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">Close</button>
          </div>
        </header>
        <div class="min-h-0 overflow-y-auto p-4">
          {data.loading && <div class="flex items-center gap-3 rounded-lg border border-cyan-900/40 bg-cyan-950/20 p-4 text-sm text-cyan-100" role="status"><span class="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />Syncing fresh news and regenerating the review…</div>}
          {data.error && <div class="rounded-lg border border-rose-900/60 bg-rose-950/30 p-3 text-sm text-rose-200">{data.error}</div>}
          {data.analysis && <div class="break-words text-sm leading-6 text-slate-200">{renderAnalysisMarkdown(data.analysis)}</div>}
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
