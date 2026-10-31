import { useEffect, useRef, useState } from 'preact/hooks';
import type { ScenarioModalData } from '../features/terminal/commandDispatcher';
import { emitUiEvent } from '../ui/uiEventBus';
import { useDialogFocus } from '../ui/dialogFocus';

interface ScenarioComparisonModalProps {
  data: ScenarioModalData;
  onClose: () => void;
}

function formatNumberGroups(text: string): string {
  return text.replace(/(?<![\\w.,/-])(-?\\d{4,})(\\.\\d+)?(?![\\w/-])/g, (_match, integer: string, fraction = '') => {
    const sign = integer.startsWith('-') ? '-' : '';
    const digits = sign ? integer.slice(1) : integer;
    return sign + digits.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',') + fraction;
  });
}

export function ScenarioComparisonModal({ data, onClose }: ScenarioComparisonModalProps) {
  const [activeColumns, setActiveColumns] = useState(() => data.columns.map((_, index) => index));
  const [activePreset, setActivePreset] = useState(0);
  const [isClosing, setIsClosing] = useState(false);
  const closingRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const requestClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setIsClosing(true);
    window.setTimeout(onClose, 180);
  };
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  const isExit = data.kind === 'exit-comparison';
  const isBuyMore = data.kind === 'buy-more';

  useDialogFocus(dialogRef, { initialFocusRef: closeButtonRef, onEscape: requestClose });

  useEffect(() => {
    const onResize = () => setIsMobile(window.matchMedia('(max-width: 767px)').matches);
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const shownColumns = isBuyMore ? data.columns.map((_, index) => index) : activeColumns;
  const netRow = data.rows.find(row => row.label === 'Net P&L');
  const formatScenarioButton = (index: number) => {
    const isBest = netRow?.values[index]?.includes('BEST') ?? false;
    const value = formatNumberGroups(netRow?.values[index]?.split(' · ')[0] ?? '');
    return data.columns[index] + ' · ' + value + (isBest ? ' BEST' : '');
  };
  const selectPreset = (indexes: number[], presetIndex = activePreset) => {
    setActivePreset(presetIndex);
    setActiveColumns(indexes);
  };
  const runQuickAction = (action: NonNullable<ScenarioModalData['quickActions']>[number]) => {
    if (action.command) {
      emitUiEvent('terminal:command-prefill', { command: action.command, cursorAtEnd: true });
      requestClose();
    } else if (action.invert) {
      setActiveColumns(columns => [...columns].reverse());
    } else if (action.columnIndexes?.length) {
      const index = data.presets?.findIndex(preset => preset.columnIndexes.length === action.columnIndexes!.length && preset.columnIndexes.every((value, i) => value === action.columnIndexes![i])) ?? activePreset;
      selectPreset(action.columnIndexes, index);
    }
  };
  const rowClass = (kind?: string) => kind === 'result'
    ? 'border-b border-emerald-900/70 bg-emerald-950/25 font-semibold text-emerald-300'
    : kind === 'risk' ? 'border-b border-rose-900/60 bg-rose-950/20 text-rose-300'
    : kind === 'balance' ? 'border-b border-cyan-900/50 bg-cyan-950/20 text-cyan-200'
    : 'border-b border-slate-800/80 text-slate-300';

  return (
    <div id="scenarioComparisonModal" class={"scenario-modal-backdrop fixed inset-0 z-[1000] flex items-center justify-center p-2 sm:p-4 " + (isClosing ? "scenario-modal-closing" : "")} style={{ background: 'rgba(10, 15, 25, 0.78)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }} onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <section ref={dialogRef} id="scenarioComparisonDialog" class="scenario-modal-dialog w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-xl flex flex-col" style={{ background: '#0b0f17', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.75)' }} role="dialog" aria-modal="true" aria-labelledby="scenarioComparisonTitle" tabIndex={-1}>
        <header class="sticky top-0 z-20 flex items-start justify-between gap-3 border-b border-slate-800 px-3 py-3 sm:px-4" style={{ background: 'rgba(11,15,23,0.94)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}>
          <div class="min-w-0"><h2 id="scenarioComparisonTitle" class="text-base sm:text-lg font-bold text-white">{data.title}</h2><p class="mt-1 text-[11px] font-medium text-slate-400">{data.subtitle}</p></div>
          <button ref={closeButtonRef} id="scenarioComparisonClose" type="button" class="shrink-0 rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white" aria-label="Close scenario comparison" onClick={requestClose}>Close · Esc</button>
        </header>
        <div class={(isExit && (data.quickActions?.length || data.presets?.length)) ? 'flex flex-wrap items-center gap-1.5 border-b border-slate-800 px-3 py-2' : 'hidden'}>
          {isExit && data.quickActions?.map((action, index) => <button key={'action-'+index} type="button" class="rounded-full border border-cyan-900/80 bg-cyan-950/30 px-2.5 py-1.5 text-[10px] font-semibold text-cyan-200 hover:bg-cyan-900/50" onClick={() => runQuickAction(action)}>{action.label}</button>)}
          {isExit && isMobile && data.columns.map((_, index) => <button key={'mobile-'+index} type="button" class={'rounded-full border px-3 py-1.5 text-[11px] font-semibold ' + (activeColumns.includes(index) ? 'border-cyan-600 bg-cyan-950/60 text-cyan-100' : 'border-slate-700 text-slate-400')} onClick={() => selectPreset([index], index)}>{formatScenarioButton(index)}</button>)}
          {isExit && !isMobile && Boolean(data.presets?.length) && <><span class="mr-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Compare</span>{data.presets?.map((preset, index) => <button key={'preset-'+index} type="button" class={'rounded-md border px-2 py-1 text-[10px] font-medium ' + (activePreset === index ? 'border-cyan-700 bg-cyan-950/50 text-cyan-200' : 'border-slate-700 text-slate-300')} onClick={() => selectPreset(preset.columnIndexes, index)}>{preset.label}</button>)}</>}
        </div>
        <div class="overflow-auto px-2 py-2 sm:px-3">
          {isExit && isMobile ? (
            <div class="flex flex-col gap-2">{shownColumns.map(columnIndex => <section key={columnIndex} class="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <div class="mb-2 flex items-start justify-between gap-2 border-b border-slate-800 pb-2"><h3 class="text-xs font-semibold text-white">{data.columns[columnIndex]}</h3>{netRow?.values[columnIndex]?.includes('BEST') && <span class="rounded bg-emerald-950 px-2 py-1 text-[10px] font-bold text-emerald-300">BEST</span>}</div>
              {data.rows.map((row, rowIndex) => <div key={row.label+rowIndex} class="flex items-start justify-between gap-3 border-b border-slate-800/70 py-2 last:border-0"><span class="text-[11px] text-slate-400">{row.label}</span><span class={'text-right font-mono text-xs font-semibold ' + (row.kind === 'result' ? 'text-emerald-300' : row.kind === 'balance' ? 'text-cyan-200' : 'text-slate-200')} style={{ fontVariantNumeric: 'tabular-nums' }}>{formatNumberGroups(row.values[columnIndex] ?? '—')}{row.deltas?.[columnIndex] && <span class={'mt-1 ml-1 inline-flex rounded px-1.5 py-0.5 text-[9px] font-semibold ' + (row.deltas[columnIndex]!.includes('BEST') ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-400')}>{formatNumberGroups(row.deltas[columnIndex]!)}</span>}</span></div>)}
            </section>)}</div>
          ) : (
            <table class="w-full border-collapse text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <thead><tr class="border-b border-slate-700 text-slate-300"><th class="px-2 py-2 text-left font-semibold">{isBuyMore ? 'Projection Date' : 'Metric'}</th>{shownColumns.map(index => <th key={index} class="min-w-[90px] px-2 py-2 text-right font-semibold whitespace-nowrap" style={isBuyMore && index % 2 === 1 ? { color: '#6ee7b7' } : {}}>{data.columns[index]}</th>)}</tr></thead>
              <tbody>{data.rows.map((row, rowIndex) => <tr key={row.label+rowIndex} class={rowClass(row.kind)}><th class="px-2 py-2 text-left font-medium whitespace-nowrap">{row.label}</th>{shownColumns.map(index => <td key={index} class={'px-2 py-2 text-right font-mono whitespace-nowrap ' + (isBuyMore ? (index % 2 === 0 ? 'text-slate-400 bg-slate-950/30' : 'text-emerald-200 bg-emerald-950/20 border-l border-emerald-900/40') : '')} style={{ fontVariantNumeric: 'tabular-nums' }}><span>{formatNumberGroups(row.values[index] ?? '—')}</span>{row.deltas?.[index] && <span class={'ml-1.5 inline-flex rounded px-1.5 py-0.5 align-middle text-[9px] font-semibold ' + (row.deltas[index]!.includes('BEST') ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-400')}>{formatNumberGroups(row.deltas[index]!)}</span>}</td>)}</tr>)}</tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
