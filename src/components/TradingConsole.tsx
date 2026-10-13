import { ConsoleQuickActions } from './ConsoleQuickActions';
import { PositionRecord } from '../ui/renderBoard';

export interface TradingConsoleProps {
  position?: PositionRecord;
  onExecuteCommand: () => void | Promise<void>;
}

export function TradingConsole({ position, onExecuteCommand }: TradingConsoleProps) {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onExecuteCommand();
    }
  };

  return (
    <>
      <div class="text-xs font-bold text-slate-400 uppercase tracking-wider flex justify-between items-center">
        <span>
          Trading Console{' '}
          <span class="hidden sm:inline">(Deterministic AI Engine)</span>
        </span>
        <span id="aiStatus" class="text-slate-500 text-[8px]">
          READY
        </span>
      </div>

      <div
        id="terminalLog"
        class="h-64 overflow-y-auto bg-slate-950 p-3 rounded text-xs space-y-2 border border-slate-800/80"
      >
        <div class="text-slate-500">
          [System]: Portfolio ready. Check the KV cloud status indicator for sync.
        </div>
      </div>

      <div class="flex gap-2">
        <input
          id="cmdInput"
          type="text"
          placeholder="e.g. sell today for [current price] vs sell 14 days later for [target price]"
          onKeyDown={handleKeyDown}
          class="flex-1 bg-slate-900 border border-slate-700 text-xs px-3 py-2 rounded focus:outline-none focus:border-emerald-500 text-white"
        />
        <button
          type="button"
          onClick={() => onExecuteCommand()}
          class="bg-emerald-600 hover:bg-emerald-500 text-black text-xs font-bold px-4 py-2 rounded transition"
        >
          Send
        </button>
      </div>

      <div
        id="consoleQuickActions"
        class="flex flex-wrap items-center gap-2"
        aria-label="Quick actions for the selected stock"
      >
        <ConsoleQuickActions position={position} />
      </div>

      {/* Quick Commands Reference */}
      <div class="pt-3 mt-3 border-t border-slate-800">
        <details class="space-y-2">
          <summary class="text-[10px] text-slate-500 uppercase tracking-wider font-bold cursor-pointer hover:text-slate-300 transition">
            View Quick Commands Guide
          </summary>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 pt-1 text-xs text-slate-400">
            <div>
              <span class="text-emerald-400 font-bold">Buy Shares:</span>{' '}
              <span id="hintBuyShares"></span>
            </div>
            <div>
              <span class="text-cyan-400 font-bold">Non-Margin Holding:</span>{' '}
              <span id="hintCashHolding"></span>
            </div>
            <div>
              <span class="text-cyan-400 font-bold">Balance / Margin Debt:</span> balance 5000{' '}
              <span class="text-slate-600 italic">or</span> balance -5000
            </div>
            <div>
              <span class="text-purple-400 font-bold">Ladder Exit:</span>{' '}
              <span id="hintLadderExit"></span>
            </div>
            <div>
              <span class="text-cyan-400 font-bold">Exit Comparison:</span>{' '}
              <span id="hintExitComparison"></span>
            </div>
            <div>
              <span class="text-amber-400 font-bold">Live Market Quote:</span>{' '}
              <span id="hintLiveQuote"></span>
            </div>
            <div>
              <span class="text-emerald-400 font-bold">Sync Margin Debt:</span> b: -5000
            </div>
            <div>
              <span class="text-rose-400 font-bold">Close Position:</span>{' '}
              <span id="hintClosePosition"></span>
            </div>
          </div>
        </details>
      </div>
    </>
  );
}