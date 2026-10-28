import { useEffect, useRef, useState } from 'preact/hooks';
import { ConsoleQuickActions } from './ConsoleQuickActions';
import { clearTerminalLog } from '../ui/notifications';
import { formatUSD, PositionRecord } from '../ui/renderBoard';

export interface TradingConsoleProps {
  position?: PositionRecord;
  onExecuteCommand: (command?: string) => void | Promise<void>;
}

export function TradingConsole({ position, onExecuteCommand }: TradingConsoleProps) {
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [command, setCommand] = useState('');
  const [aiStatus, setAiStatus] = useState('READY');

  useEffect(() => {
    const handleStatus = (event: Event) => {
      const status = (event as CustomEvent<string>).detail;
      if (status) setAiStatus(status);
    };
    window.addEventListener('terminal:ai-status', handleStatus);
    return () => window.removeEventListener('terminal:ai-status', handleStatus);
  }, []);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const ticker = position?.ticker || 'AAPL';
  const hasPosition = Boolean(position);
  const currentPrice =
    position && Number(position.currentPrice) > 0 ? Number(position.currentPrice) : null;
  const priceText = currentPrice === null ? '[price]' : formatUSD(currentPrice);
  const triggerExecute = () => {
    const value = command.trim();
    if (!value) return;
    setHistory((prev) => (prev[0] === value ? prev : [value, ...prev.slice(0, 49)]));
    setHistoryIdx(-1);
    setCommand('');
    onExecuteCommand(value);
  };

  const prefillCommand = (value: string, selectText?: string | null, instant?: boolean) => {
    setCommand(value);
    if (instant) {
      setHistory((prev) => (prev[0] === value ? prev : [value, ...prev.slice(0, 49)]));
      setHistoryIdx(-1);
      setCommand('');
      onExecuteCommand(value);
      return;
    }
    inputRef.current?.focus();
    const placeholderStart = value.indexOf('[');
    const selectionText = selectText || (placeholderStart >= 0
      ? value.slice(placeholderStart, value.indexOf(']', placeholderStart) + 1)
      : null);
    const selectionStart = selectionText ? value.lastIndexOf(selectionText) : value.length;
    const selectionEnd = selectionText ? selectionStart + selectionText.length : value.length;
    requestAnimationFrame(() => {
      resizeCommandInput();
      inputRef.current?.setSelectionRange(selectionStart, selectionEnd);
    });
  };

  const resizeCommandInput = (input = inputRef.current) => {
    if (!input) return;
    input.style.height = 'auto';
    const maxHeight = 128;
    input.style.height = `${Math.min(input.scrollHeight, maxHeight)}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const input = e.currentTarget as HTMLTextAreaElement;
    if (e.key === 'Tab') {
      const tokens = [...input.value.matchAll(/\[[^\]]+\]/g)].map((match) => ({
        text: match[0],
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length
      }));
      if (tokens.length > 0) {
        e.preventDefault();
        const selectionStart = input.selectionStart ?? 0;
        const selectionEnd = input.selectionEnd ?? selectionStart;
        const selectedIndex = tokens.findIndex((token) =>
          selectionStart === token.start && selectionEnd === token.end
        );
        const cursor = selectionEnd;
        const currentIndex = selectedIndex >= 0
          ? selectedIndex
          : tokens.findIndex((token) => cursor >= token.start && cursor <= token.end);
        let targetIndex: number;
        if (currentIndex >= 0) {
          targetIndex = (currentIndex + (e.shiftKey ? -1 : 1) + tokens.length) % tokens.length;
        } else if (e.shiftKey) {
          targetIndex = [...tokens].map((token, index) => ({ token, index }))
            .filter(({ token }) => token.start < cursor).at(-1)?.index ?? tokens.length - 1;
        } else {
          targetIndex = tokens.findIndex((token) => token.start >= cursor);
          if (targetIndex < 0) targetIndex = 0;
        }
        const target = tokens[targetIndex];
        input.focus();
        input.setSelectionRange(target.start, target.end);
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      triggerExecute();
    } else if (e.key === 'ArrowUp') {
      if (history.length === 0) return;
      e.preventDefault();
      const nextIdx = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(nextIdx);
      setCommand(history[nextIdx]);
      requestAnimationFrame(() => {
        resizeCommandInput(input);
        input.setSelectionRange(input.value.length, input.value.length);
      });
    } else if (e.key === 'ArrowDown') {
      if (historyIdx < 0) return;
      e.preventDefault();
      const nextIdx = historyIdx - 1;
      setHistoryIdx(nextIdx);
      setCommand(nextIdx >= 0 ? history[nextIdx] : '');
    } else if (e.key === 'Escape') {
      setCommand('');
      setHistoryIdx(-1);
    }
  };

  const clearTerminal = () => clearTerminalLog();

  const guideItems = [
    {
      category: 'Live / Manual Quote',
      badgeColor: 'text-amber-400 border-amber-900/60 bg-amber-950/30',
      id: 'hintLiveQuote',
      command: `quote ${hasPosition ? ticker : '[TICKER]'}`,
      display: `quote ${hasPosition ? ticker : '[TICKER]'}  or  quote ${hasPosition ? ticker : '[TICKER]'} ${priceText}`
    },
    {
      category: 'Cash / Margin Debt',
      badgeColor: 'text-emerald-400 border-emerald-900/60 bg-emerald-950/30',
      id: 'hintBalanceDebt',
      command: `balance [amount]`,
      display: `balance 5000  |  debt 5000  |  b: -5000`
    },
    {
      category: 'Non-Margin Holding',
      badgeColor: 'text-purple-400 border-purple-900/60 bg-purple-950/30',
      id: 'hintCashHolding',
      command: `add cash stock [shares] ${hasPosition ? ticker : '[TICKER]'} at ${priceText}`,
      display: `add cash stock [shares] ${hasPosition ? ticker : '[TICKER]'}  |  remove cash stock ${hasPosition ? ticker : '[TICKER]'}`
    }
  ];

  return (
    <>
      {/* Console Header */}
      <div class="flex items-center justify-between border-b border-slate-800/80 pb-2">
        <div class="flex items-center gap-2">
          <span class="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"></span>
          <span class="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono">
            Trading Console
          </span>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            onClick={() => prefillCommand('help', null, true)}
            class="rounded border border-slate-800 bg-slate-900/80 px-2 py-0.5 text-[10px] font-mono text-slate-400 hover:border-slate-700 hover:text-slate-200 transition"
            title="Show CLI command reference in terminal"
          >
            ? Help
          </button>
          <button
            type="button"
            onClick={clearTerminal}
            class="rounded border border-slate-800 bg-slate-900/80 px-2 py-0.5 text-[10px] font-mono text-slate-400 hover:border-rose-900/60 hover:text-rose-300 transition"
            title="Clear terminal log output"
          >
            Clear
          </button>
          <span
            id="aiStatus"
            class="rounded bg-slate-900 border border-slate-800 px-1.5 py-0.5 text-[9px] font-mono font-bold text-slate-400"
          >
            {aiStatus}
          </span>
        </div>
      </div>

      {/* Terminal Output Viewport */}
      <div
        id="terminalLog"
        class="h-64 overflow-y-auto rounded-lg bg-slate-950/95 p-3 font-mono text-xs space-y-1.5 border border-slate-800/90 shadow-inner leading-relaxed"
      >
        <div class="flex items-start gap-2 text-slate-400 py-0.5">
          <span class="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold text-slate-300">
            SYSTEM
          </span>
          <span>
            Portfolio CLI ready. Refresh quotes, manage balances, or click a quick action below.
          </span>
        </div>
      </div>

      {/* Command Input Bar */}
      <div class="flex items-center gap-2 rounded-lg bg-slate-900/95 border border-slate-700/90 px-3 py-2 focus-within:border-emerald-500/80 focus-within:ring-1 focus-within:ring-emerald-500/30 transition">
        <span class="text-emerald-400 font-mono font-bold text-sm select-none">❯</span>
        <textarea
          id="cmdInput"
          aria-label="Terminal command"
          ref={inputRef}
          value={command}
          onInput={(event) => {
            const input = event.currentTarget as HTMLTextAreaElement;
            setCommand(input.value);
            resizeCommandInput(input);
          }}
          rows={1}
          name="cli-entry"
          autoComplete="off"
          data-form-type="other"
          data-lpignore="true"
          data-1p-ignore="true"
          data-bwignore="true"
          data-protonpass-ignore="true"
          autocapitalize="off"
          autocorrect="off"
          enterkeyhint="go"
          spellcheck={false}
          placeholder={`e.g. quote ${hasPosition ? ticker : 'AAPL'} or refresh quotes`}
          onKeyDown={handleKeyDown}
          class="flex-1 min-w-0 min-h-[44px] max-h-32 resize-none overflow-y-hidden whitespace-pre-wrap break-words text-xs bg-transparent border-none text-base leading-5 py-2 font-mono text-white placeholder-slate-500 focus:outline-none"
        />
        <span class="hidden md:inline text-[10px] font-mono text-slate-600 select-none">
          ↑↓ History
        </span>
        <button
          type="button"
          onClick={triggerExecute}
          class="bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-slate-950 text-xs font-mono font-bold px-3.5 py-1.5 rounded transition shadow-sm"
        >
          Run ↵
        </button>
      </div>

      {/* Contextual Quick Action Pills */}
      <div
        id="consoleQuickActions"
        class="flex flex-wrap items-center gap-1.5 pt-0.5"
        aria-label="Quick actions for the selected stock"
      >
        <ConsoleQuickActions position={position} onExecuteCommand={onExecuteCommand} onPrefillCommand={prefillCommand} />
      </div>

      {/* Interactive Quick Commands Guide */}
      <div class="pt-2.5 mt-2 border-t border-slate-800/80">
        <details class="group">
          <summary class="flex items-center justify-between text-[10px] text-slate-400 uppercase tracking-wider font-mono font-bold cursor-pointer hover:text-slate-200 transition select-none py-1">
            <span class="flex items-center gap-1.5">
              <span class="text-emerald-400 transition-transform group-open:rotate-90">▸</span>
              Quick Commands Guide (Click any command to load)
            </span>
          </summary>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2">
            {guideItems.map((item) => (
              <button
                key={item.category}
                type="button"
                onClick={() => prefillCommand(item.command)}
                class="group/card flex flex-col items-start text-left rounded-lg border border-slate-800/90 bg-slate-950/70 hover:bg-slate-900/90 hover:border-slate-700 p-2 transition"
              >
                <div class="flex items-center justify-between w-full mb-1">
                  <span
                    class={`rounded border px-1.5 py-0.2 text-[9px] font-mono font-bold uppercase ${item.badgeColor}`}
                  >
                    {item.category}
                  </span>
                  <span class="text-[9px] font-mono text-slate-600 group-hover/card:text-emerald-400 transition">
                    Click to fill ↗
                  </span>
                </div>
                <code
                  id={item.id}
                  class="text-[11px] font-mono text-slate-300 group-hover/card:text-white break-all"
                >
                  {item.display}
                </code>
              </button>
            ))}
          </div>
        </details>
      </div>
    </>
  );
}