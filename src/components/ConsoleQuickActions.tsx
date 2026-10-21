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

export function ConsoleQuickActions({ position, onExecuteCommand, onPrefillCommand }: ConsoleQuickActionsProps) {
  const currentPrice =
    position && Number(position.currentPrice) > 0 ? Number(position.currentPrice) : null;
  const priceText = currentPrice === null ? '[price]' : formatUSD(currentPrice);
  const comparisonPrice =
    currentPrice === null ? null : Number((currentPrice * 1.03).toFixed(2));
  const comparisonPriceText = comparisonPrice === null ? '[target_price]' : formatUSD(comparisonPrice);
  const targetPrice =
    position && Number(position.pt) > 0
      ? formatUSD(Number(position.pt))
      : comparisonPriceText;

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
        text: '+ Buy Position…',
        command: 'bought [shares] [TICKER] for [price], pt [target]',
        color: 'text-emerald-300 border-emerald-900/70 hover:bg-emerald-950/60',
        title: 'Log a new margin tranche with an optional price target'
      },
      {
        text: 'Set Cash…',
        command: 'balance [amount]',
        color: 'text-cyan-300 border-cyan-900/70 hover:bg-cyan-950/60',
        title: 'Set positive free cash cushion'
      },
      {
        text: 'Set Debt…',
        command: 'debt [amount]',
        color: 'text-rose-300 border-rose-900/70 hover:bg-rose-950/60',
        title: 'Set margin debt balance'
      },
      {
        text: '+ Cash Stock…',
        command: 'add cash stock [shares] [TICKER] at [price]',
        color: 'text-purple-300 border-purple-900/70 hover:bg-purple-950/60',
        title: 'Add non-margin collateral stock to Cash Cushion'
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
            onClick={() =>
              prefillTerminalInput(action.command, action.selectText, action.instant, onExecuteCommand, onPrefillCommand)
            }
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
      text: '+ Buy…',
      command: `bought [shares] ${position.ticker} for ${priceText}`,
      color: 'text-emerald-300 border-emerald-900/70 hover:bg-emerald-950/60',
      title: `Add shares to ${position.ticker}`
    },
    {
      text: '⇄ Compare Exits…',
      command: `sell ${position.ticker} today for ${priceText} vs sell 14 days later for ${comparisonPriceText}`,
      selectText: comparisonPriceText,
      color: 'text-cyan-300 border-cyan-900/70 hover:bg-cyan-950/60',
      title: 'Compare net profit after margin carry between selling today vs waiting'
    },
    {
      text: '⇧ Buy More Scenario…',
      command: `buy scenario ${Math.max(1, Math.floor(Number(position.shares) / 2))} ${position.ticker} at ${priceText}`,
      selectText: String(Math.max(1, Math.floor(Number(position.shares) / 2))),
      color: 'text-purple-300 border-purple-900/70 hover:bg-purple-950/60',
      title: `Preview how buying more ${position.ticker} shares changes average entry, exposure, and unrealized P&L without placing an order`
    },
    {
      text: '− Sell Part…',
      command: `sold [shares] ${position.ticker} for ${priceText}`,
      color: 'text-rose-300 border-rose-900/70 hover:bg-rose-950/60',
      title: `Sell partial shares of ${position.ticker}`
    },
    {
      text: '× Sell All…',
      command: `sold all ${position.ticker} for ${priceText}`,
      selectText: priceText,
      color: 'text-rose-300 border-rose-900/70 hover:bg-rose-950/60',
      title: `Close entire ${position.ticker} position`
    },
    {
      text: '◎ Target…',
      command: `target ${position.ticker} ${targetPrice}`,
      selectText: targetPrice,
      color: 'text-cyan-300 border-cyan-900/70 hover:bg-cyan-950/60',
      title: `Update ${position.ticker} price target`
    },
    {
      text: '🪜 Ladder…',
      command: `ladder ${position.ticker} ${priceText}, ${comparisonPriceText}`,
      selectText: comparisonPriceText,
      color: 'text-purple-300 border-purple-900/70 hover:bg-purple-950/60',
      title: 'Simulate scaling out across multiple price targets'
    }
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
          onClick={() =>
            prefillTerminalInput(action.command, action.selectText, action.instant, onExecuteCommand, onPrefillCommand)
          }
          class={`rounded border bg-slate-900/90 px-2.5 py-1 text-[10px] font-mono font-bold transition active:scale-95 ${action.color}`}
        >
          {action.text}
        </button>
      ))}
    </>
  );
}