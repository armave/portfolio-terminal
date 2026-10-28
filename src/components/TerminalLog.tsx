import { useEffect, useRef } from 'preact/hooks';
import { setScenarioReport, type TerminalLogEntry } from '../ui/notificationStore';

interface TerminalLogProps {
  entries: TerminalLogEntry[];
}

function parseTagAndStyle(rawMessage: string, isError: boolean) {
  const tagMatch = rawMessage.match(/^\[([^\]]+)\]:?\s*([\s\S]*)$/);
  const rawTag = tagMatch ? tagMatch[1].trim() : isError ? 'ERROR' : 'INFO';
  const upperTag = rawTag.toUpperCase();
  if (isError || upperTag.includes('ERR') || upperTag.includes('FAIL')) {
    return { badge: 'ERROR', badgeClass: 'bg-rose-950/90 text-rose-300 border border-rose-800/80', rowClass: 'border-l-2 border-rose-500/80 bg-rose-950/20 text-rose-200' };
  }
  if (upperTag.includes('SIM') || upperTag.includes('COMPARISON')) {
    return { badge: rawTag, badgeClass: 'bg-purple-950/90 text-purple-300 border border-purple-800/80', rowClass: 'border-l-2 border-purple-500/80 bg-purple-950/15 text-slate-200' };
  }
  if (upperTag.includes('YAHOO') || upperTag.includes('MARKET') || upperTag.includes('QUOTE')) {
    return { badge: rawTag, badgeClass: 'bg-amber-950/90 text-amber-300 border border-amber-800/80', rowClass: 'border-l-2 border-amber-500/70 bg-amber-950/10 text-slate-200' };
  }
  if (upperTag.includes('CLI') || upperTag.includes('BALANCE') || upperTag.includes('CASH')) {
    return { badge: rawTag, badgeClass: 'bg-emerald-950/90 text-emerald-300 border border-emerald-800/80', rowClass: 'border-l-2 border-emerald-500/80 bg-emerald-950/15 text-slate-100' };
  }
  if (upperTag.includes('BROKER') || upperTag.includes('ROLLOVER')) {
    return { badge: 'BROKER', badgeClass: 'bg-cyan-950/90 text-cyan-300 border border-cyan-800/80', rowClass: 'border-l-2 border-cyan-500/70 bg-cyan-950/10 text-slate-200' };
  }
  return { badge: rawTag, badgeClass: 'bg-slate-800 text-slate-300 border border-slate-700', rowClass: 'text-slate-300' };
}

function renderFinancialTokens(line: string) {
  const pattern = /(\+\$[0-9,]+(?:\.[0-9]+)?|\+[0-9]+(?:\.[0-9]+)?%|-\$[0-9,]+(?:\.[0-9]+)?|-[0-9]+(?:\.[0-9]+)?%|(?<![+-])\$[0-9,]+(?:\.[0-9]+)?|→|\s\|\s)/g;
  const rendered: Array<string | preact.JSX.Element> = [];
  let cursor = 0;
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) rendered.push(line.slice(cursor, index));
    const token = match[0];
    const tokenClass = token.startsWith('+$') || (token.startsWith('+') && token.endsWith('%'))
      ? 'text-emerald-400 font-bold'
      : token.startsWith('-$') || (token.startsWith('-') && token.endsWith('%'))
        ? 'text-rose-400 font-bold'
        : token === '→'
          ? 'text-cyan-400 font-bold px-1'
          : token === ' | '
            ? 'text-slate-700'
            : 'text-amber-300 font-semibold';
    rendered.push(<span class={tokenClass} key={`${index}-${token}`}>{token}</span>);
    cursor = index + token.length;
  }
  if (cursor < line.length) rendered.push(line.slice(cursor));
  return rendered;
}

export function TerminalLog({ entries }: TerminalLogProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [entries]);

  return (
    <div ref={viewportRef} id="terminalLog" class="h-64 overflow-y-auto rounded-lg bg-slate-950/95 p-3 font-mono text-xs space-y-1.5 border border-slate-800/90 shadow-inner leading-relaxed">
      {entries.map((entry) => {
        if (entry.kind === 'system') {
          return <div key={entry.id} class="flex items-start gap-2 text-slate-400 py-0.5">
            <span class="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold text-slate-300">SYSTEM</span>
            <span>{entry.message}</span>
          </div>;
        }
        if (entry.scenarioReport !== undefined) {
          return <div key={entry.id} class="flex items-start justify-between gap-2 rounded border-l-2 border-purple-500/80 bg-purple-950/15 px-2.5 py-1.5 text-xs font-mono text-slate-200">
            <div class="min-w-0 flex-1">
              <span class="mr-2 rounded border border-purple-800/80 bg-purple-950/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-purple-300">WHAT-IF REPORT</span>
              <span class="break-words">{entry.scenarioReport.split('\n', 1)[0].slice(0, 180)}</span>
            </div>
            <button type="button" class="shrink-0 rounded border border-purple-800/80 px-2 py-1 text-[10px] font-bold text-purple-300 hover:bg-purple-950/70" onClick={() => setScenarioReport(entry.scenarioReport!)}>View report</button>
            <span class="shrink-0 pt-0.5 text-[9px] text-slate-600">{entry.time}</span>
          </div>;
        }
        if (entry.isUser) {
          return <div key={entry.id} class="flex items-center justify-between gap-2 rounded bg-slate-900/90 border border-slate-800 px-2.5 py-1.5 text-xs font-mono text-emerald-300">
            <div class="flex items-center gap-2 min-w-0"><span class="text-emerald-400 font-bold select-none">❯</span><span class="font-semibold truncate">{entry.message}</span></div>
            <span class="text-[9px] text-slate-600 shrink-0 select-none">{entry.time}</span>
          </div>;
        }
        const tagMatch = entry.message.match(/^\[([^\]]+)\]:?\s*([\s\S]*)$/);
        const bodyText = tagMatch ? tagMatch[2] : entry.message;
        const { badge, badgeClass, rowClass } = parseTagAndStyle(entry.message, entry.isError);
        return <div key={entry.id} class={`flex items-start justify-between gap-2 rounded px-2.5 py-1.5 text-xs font-mono ${rowClass}`}>
          <div class="flex items-start gap-2 min-w-0 flex-1">
            <span class={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${badgeClass}`}>{badge}</span>
            <div class="leading-relaxed break-words min-w-0 flex-1">{bodyText.split('\n').map((line, index) => <span key={index}>{index > 0 && <br />}{renderFinancialTokens(line)}</span>)}</div>
          </div>
          <span class="text-[9px] text-slate-600 shrink-0 select-none pt-0.5">{entry.time}</span>
        </div>;
      })}
    </div>
  );
}
