import { formatUSD, PositionRecord } from '../ui/renderBoard';

export interface ConsoleQuickActionsProps {
  position?: PositionRecord;
  onExecuteCommand?: (command?: string) => void | Promise<void>;
  onPrefillCommand?: (command: string, selectText?: string | null, instant?: boolean) => void;
}

interface QuickActionItem {
  text: string;
  command: string;
  selectText?: string | null;
  instant?: boolean;
  color: string;
  title?: string;
  onClick?: () => void;
}

function prefillTerminalInput(
  command: string,
  selectText?: string | null,
  instant?: boolean,
  onExecuteCommand?: (command?: string) => void | Promise<void>,
  onPrefillCommand?: (command: string, selectText?: string | null, instant?: boolean) => void
) {
  if (onPrefillCommand) {
    onPrefillCommand(command, selectText, instant);
    return;
  }
  if (instant && onExecuteCommand) onExecuteCommand(command);
}

function requestMarginIntelligence(ticker?: string) {
  window.dispatchEvent(new CustomEvent('terminal:margin-intelligence-request', { detail: { ticker } }));
}

export function ConsoleQuickActions({ position, onExecuteCommand, onPrefillCommand }: ConsoleQuickActionsProps) {
  const currentPrice =
    position && Number(position.currentPrice) > 0 ? Number(position.currentPrice) : null;
  const priceText = currentPrice === null ? '[price]' : formatUSD(currentPrice);
  const comparisonPrice =
    currentPrice === null ? '[target_price]' : formatUSD(Number((currentPrice * 1.03).toFixed(2)));
  // Portfolio-level quick actions when on COMBINED or BALANCE tab
  if (!position) {
    const globalActions: QuickActionItem[] = [
      {
        text: '↻ Refresh Quotes',
        command: 'refresh',
        instant: true,
        color: 'text-amber-300 border-amber-900/70 hover:bg-amber-950/60',
        title: 'Fetch live quotes for all tracked holdings immediately'
      },
      {
        text: '✦ Portfolio Review',
        command: '',
        onClick: () => requestMarginIntelligence(),
        color: 'text-cyan-200 border-cyan-800/70 hover:bg-cyan-950/50',
        title: 'Use Gemini to review recent news and risk across all margin positions'
      },
      {
        text: '? Help',
        command: 'help',
        instant: true,
        color: 'text-slate-300 border-slate-700 hover:bg-slate-800',
        title: 'Print all local CLI commands'
      }
    ];

    return (
      <>
        <span class="text-[10px] font-bold font-mono uppercase tracking-wider text-slate-400 bg-slate-900/90 border border-slate-800 px-2 py-0.5 rounded">
          Portfolio Actions
        </span>
        {globalActions.map((action) => (
          <button
            key={action.text}
            type="button"
            title={action.title}
            onClick={() => action.onClick ? action.onClick() : prefillTerminalInput(action.command, action.selectText, action.instant, onExecuteCommand, onPrefillCommand)}
            class={`rounded border bg-slate-900/90 px-2.5 py-1 text-[10px] font-mono font-bold transition active:scale-95 ${action.color}`}
          >
            {action.text}
          </button>
        ))}
      </>
    );
  }

  // Ticker-specific quick actions when a position tab is selected
  const tickerActions: QuickActionItem[] = [
    {
      text: '⚡ Quote',
      command: `quote ${position.ticker}`,
      instant: true,
      color: 'text-amber-300 border-amber-900/70 hover:bg-amber-950/60',
      title: `Immediately pull latest quote for ${position.ticker}`
    },
    {
      text: '✦ News + Review',
      command: '',
      onClick: () => requestMarginIntelligence(position.ticker),
      color: 'text-cyan-200 border-cyan-800/70 hover:bg-cyan-950/50',
      title: `Review recent news and margin-position risks for ${position.ticker} with Gemini`
    },
    {
      text: '⇄ Compare Exits…',
      command: `sell ${position.ticker} today for ${priceText} vs sell 14 days later for ${comparisonPrice}`,
      selectText: comparisonPrice,
      color: 'text-cyan-300 border-cyan-900/70 hover:bg-cyan-950/60',
      title: 'Compare exit scenarios without placing a trade'
    },
    {
      text: '⇧ Buy More Scenario…',
      command: `buy scenario ${Math.max(1, Math.floor(Number(position.shares) / 2))} ${position.ticker} at ${priceText}`,
      selectText: String(Math.max(1, Math.floor(Number(position.shares) / 2))),
      color: 'text-purple-300 border-purple-900/70 hover:bg-purple-950/60',
      title: `Preview how buying more ${position.ticker} shares changes average entry and exposure without placing an order`
    },
  ];

  return (
    <>
      <span class="text-[10px] font-bold font-mono uppercase tracking-wider text-emerald-400 bg-emerald-950/30 border border-emerald-900/60 px-2 py-0.5 rounded">
        {position.ticker} · {formatUSD(position.shares)} sh
      </span>
      {tickerActions.map((action) => (
        <button
          key={action.text}
          type="button"
          title={action.title}
          onClick={() => action.onClick ? action.onClick() : prefillTerminalInput(action.command, action.selectText, action.instant, onExecuteCommand, onPrefillCommand)}
          class={`rounded border bg-slate-900/90 px-2.5 py-1 text-[10px] font-mono font-bold transition active:scale-95 ${action.color}`}
        >
          {action.text}
        </button>
      ))}
    </>
  );
}