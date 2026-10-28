import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChild } from 'preact';

interface ScenarioReportModalProps {
  report: string;
  onClose: () => void;
}

function renderFinancialLine(rawLine: string): ComponentChild[] {
  const tokenPattern = /([+-]?\$[0-9,]+(?:\.[0-9]+)?|[+-]?\d+(?:\.[0-9]+)?%|→)/g;
  const content: ComponentChild[] = [];
  let cursor = 0;
  for (const match of rawLine.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) content.push(rawLine.slice(cursor, index));
    const token = match[0];
    const colorClass = token === '→'
      ? 'mx-1 font-bold text-cyan-300'
      : token.startsWith('+$') || (token.startsWith('+') && token.endsWith('%'))
        ? 'font-bold text-emerald-300'
        : token.startsWith('-$') || (token.startsWith('-') && token.endsWith('%'))
          ? 'font-bold text-rose-300'
          : token.startsWith('$')
            ? 'font-semibold text-amber-200'
            : 'font-semibold text-slate-100';
    content.push(<span key={`${index}-${token}`} class={colorClass}>{token}</span>);
    cursor = index + token.length;
  }
  if (cursor < rawLine.length) content.push(rawLine.slice(cursor));
  return content;
}

function reportLineClass(rawLine: string): string {
  const trimmed = rawLine.trim();
  if (/^(?:[A-Z][A-Z /&()_-]{2,}|[A-Z][A-Z0-9 /&()_-]{2,}:|\d+[.)]\s|[A-Z]\)\s)/.test(trimmed) ||
      /^(?:BEST ESTIMATED EXIT|NET ADVANTAGE|RESULT:|PRICE SENSITIVITY:|RISK NOTE:)/i.test(trimmed) ||
      /^(?:PROFIT \/ LOSS COMPARISON|POSITION CHANGE|RISK|UPSIDE|DOWNSIDE)/i.test(trimmed)) {
    return 'mt-2 border-l-2 border-cyan-400/80 bg-cyan-400/[0.07] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-cyan-100';
  }
  if (/(?:-\$|loss|downside|worse|decrease|commission|interest)/i.test(rawLine)) return 'rounded-md px-3 py-1 leading-snug my-0.5 bg-rose-400/[0.045] text-slate-200';
  if (/(?:\+\$|\+\d|profit|gain|upside|better|increase|NET P&L)/i.test(rawLine)) return 'rounded-md px-3 py-1 leading-snug my-0.5 bg-emerald-400/[0.06] text-slate-100';
  if (rawLine.includes('|')) return 'rounded-md px-3 py-1 leading-snug my-0 odd:bg-white/[0.025] text-slate-200';
  return 'rounded-md px-3 py-1 leading-snug text-slate-200';
}

function renderReportLines(report: string): ComponentChild[] {
  const content: ComponentChild[] = [];
  let previousWasSpacer = false;
  report.split('\n').slice(1).forEach((rawLine, index) => {
    if (!rawLine.trim()) {
      if (!previousWasSpacer) content.push(<div key={index} class="h-1" aria-hidden="true" />);
      previousWasSpacer = true;
      return;
    }
    previousWasSpacer = false;
    if (/^\s*(?:[-=]{3,}|_{3,})\s*$/.test(rawLine)) {
      content.push(<div key={index} class="my-3 border-t border-slate-700/80" aria-hidden="true" />);
      return;
    }
    content.push(<div key={index} class={reportLineClass(rawLine)}>{renderFinancialLine(rawLine)}</div>);
  });
  return content;
}

export function ScenarioReportModal({ report, onClose }: ScenarioReportModalProps) {
  const [isClosing, setIsClosing] = useState(false);
  const closingRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setIsClosing(true);
    window.setTimeout(onClose, 200);
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []);
      if (!focusable.length) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    closeButtonRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [requestClose]);

  const header = report.split('\n', 1)[0].toUpperCase();
  const title = report.split('\n', 1)[0].replace(/^\[|\]$/g, '') || 'Scenario report';
  const subtitle = header.startsWith('[HYPOTHETICAL BUY:')
    ? 'Current position vs. proposed purchase · profit, downside, exposure and fees'
    : header.startsWith('[MULTI-DATE EXIT COMPARISON:')
      ? 'Sell now vs. future exits · estimated net results after costs'
      : 'Before vs. after · estimated values';

  return (
    <div id="scenarioReportModal" class={'scenario-modal-overlay fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm transition-opacity duration-200 ease-out sm:p-6 ' + (isClosing ? 'opacity-0' : 'opacity-100')} role="presentation" onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <section ref={dialogRef} class={'scenario-modal-dialog flex max-h-[min(90vh,900px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-purple-800/70 bg-slate-950 shadow-2xl shadow-black/50 ring-1 ring-white/5 transition-[opacity,transform] duration-200 sm:max-h-[90vh] ' + (isClosing ? 'translate-y-3 scale-[0.985] opacity-0' : 'translate-y-0 scale-100 opacity-100')} role="dialog" aria-modal="true" aria-labelledby="scenarioReportTitle" tabIndex={-1}>
        <header class="flex items-start justify-between gap-4 border-b border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900 to-purple-950/40 px-4 py-4 sm:px-6">
          <div class="min-w-0">
            <div class="mb-1.5 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-purple-300">What-if analysis</div>
            <h2 id="scenarioReportTitle" class="break-words text-base font-bold tracking-tight text-white sm:text-lg">{title}</h2>
            <p class="mt-1.5 max-w-xl text-xs leading-relaxed text-slate-400">{subtitle}</p>
          </div>
          <button ref={closeButtonRef} type="button" class="shrink-0 rounded-lg border border-slate-700/80 bg-slate-950/40 px-3 py-1.5 text-xs font-semibold text-slate-300 transition-colors duration-150 hover:border-slate-500 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400" onClick={requestClose} aria-label="Close scenario report">Close</button>
        </header>
        <div class="scenario-report-content min-h-0 flex-1 overflow-auto break-words bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900/90 px-3 py-3 text-[13px] leading-snug selection:bg-violet-500/30 sm:px-5 sm:py-4 sm:text-sm" aria-label="Scenario report details">{renderReportLines(report)}</div>
        <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-900/80 px-4 py-3.5 sm:px-6">
          <p class="max-w-xl text-[11px] leading-relaxed text-slate-400">Estimates only · actual results may differ.</p>
          <button type="button" class="rounded-lg bg-purple-400 px-5 py-2.5 text-xs font-bold text-slate-950 shadow-lg shadow-purple-950/30 transition duration-150 hover:-translate-y-px hover:bg-purple-300 hover:shadow-purple-900/30 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950" onClick={requestClose}>Done</button>
        </footer>
      </section>
    </div>
  );
}
