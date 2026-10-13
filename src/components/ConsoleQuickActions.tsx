import { useEffect } from 'preact/hooks';
import { formatUSD, PositionRecord } from '../ui/renderBoard';

export interface ConsoleQuickActionsProps {
  position?: PositionRecord;
}

interface QuickActionItem {
  text: string;
  command: string;
  selectText?: string | null;
  color: string;
}

export function ConsoleQuickActions({ position }: ConsoleQuickActionsProps) {
  const ticker = position?.ticker || '[TICKER]';
  const currentPrice =
    position && Number(position.currentPrice) > 0 ? Number(position.currentPrice) : null;
  const priceText = currentPrice === null ? '[current price]' : formatUSD(currentPrice);
  const comparisonPrice =
    currentPrice === null ? null : Number((currentPrice * 1.02).toFixed(2));
  const comparisonPriceText = comparisonPrice === null ? '[price]' : formatUSD(comparisonPrice);

  // Sync dynamic placeholders and Quick Commands Guide hints
  useEffect(() => {
    const commandInput = document.getElementById('cmdInput') as HTMLInputElement | null;
    if (commandInput) {
      commandInput.placeholder = `e.g. sell today for ${priceText} vs sell 14 days later for ${comparisonPriceText}`;
    }
    const hintBuy = document.getElementById('hintBuyShares');
    if (hintBuy) hintBuy.textContent = `bought [shares] ${ticker} for ${priceText}, pt [target]`;
    const hintCash = document.getElementById('hintCashHolding');
    if (hintCash) {
      hintCash.textContent = `add cash stock [shares] ${ticker} or remove cash stock ${ticker}`;
    }
    const hintLadder = document.getElementById('hintLadderExit');
    if (hintLadder) {
      hintLadder.textContent = `sell [shares] ${ticker} for ${priceText} today and [shares] for [price] in 7 days`;
    }
    const hintComp = document.getElementById('hintExitComparison');
    if (hintComp) {
      hintComp.textContent = `sell today for ${priceText} vs sell 14 days later for ${comparisonPriceText}`;
    }
    const hintQuote = document.getElementById('hintLiveQuote');
    if (hintQuote) {
      hintQuote.textContent = `quote ${ticker} or what's the current ${ticker} price?`;
    }
    const hintClose = document.getElementById('hintClosePosition');
    if (hintClose) {
      hintClose.textContent = `sold all ${ticker} for ${priceText}`;
    }
  }, [ticker, priceText, comparisonPriceText]);

  if (!position) {
    return (
      <>
        <span class="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Quick actions
        </span>
        <span class="text-[10px] text-slate-500">
          Examples use [TICKER]; select a margin holding to use its tracked price.
        </span>
      </>
    );
  }

  const actions: QuickActionItem[] = [
    {
      text: 'Quote',
      command: `quote ${position.ticker}`,
      color: 'text-amber-300 border-amber-900/70 hover:bg-amber-950/50'
    },
    {
      text: 'Buy…',
      command: `bought [shares] ${position.ticker} for ${priceText}`,
      color: 'text-emerald-300 border-emerald-900/70 hover:bg-emerald-950/50'
    },
    {
      text: 'Sell part…',
      command: `sold [shares] ${position.ticker} for ${priceText}`,
      color: 'text-rose-300 border-rose-900/70 hover:bg-rose-950/50'
    },
    {
      text: 'Sell all…',
      command: `sold all ${position.ticker} for ${priceText}`,
      color: 'text-rose-300 border-rose-900/70 hover:bg-rose-950/50'
    },
    {
      text: 'Compare exits…',
      command: `sell today for ${priceText} vs sell 14 days later for ${comparisonPriceText}`,
      selectText: comparisonPriceText,
      color: 'text-cyan-300 border-cyan-900/70 hover:bg-cyan-950/50'
    },
    {
      text: 'Set target…',
      command: `set ${position.ticker} PT to [price]`,
      color: 'text-cyan-300 border-cyan-900/70 hover:bg-cyan-950/50'
    }
  ];

  const handleActionClick = (action: QuickActionItem) => {
    const input = document.getElementById('cmdInput') as HTMLInputElement | null;
    if (!input) return;
    input.value = action.command;
    input.focus();

    if (action.selectText) {
      const selectionStart = action.command.lastIndexOf(action.selectText);
      input.setSelectionRange(selectionStart, selectionStart + action.selectText.length);
    } else if (action.command.includes('[')) {
      const selectionStart = action.command.indexOf('[');
      const selectionEnd = action.command.indexOf(']', selectionStart) + 1;
      input.setSelectionRange(selectionStart, selectionEnd);
    } else {
      input.setSelectionRange(input.value.length, input.value.length);
    }
  };

  return (
    <>
      <span class="text-[10px] font-bold uppercase tracking-wider text-slate-500">
        {position.ticker} · {formatUSD(position.shares)} shares
      </span>
      {actions.map((action) => (
        <button
          key={action.text}
          type="button"
          onClick={() => handleActionClick(action)}
          class={`rounded border bg-slate-900 px-2.5 py-1 text-[10px] font-bold transition ${action.color}`}
        >
          {action.text}
        </button>
      ))}
    </>
  );
}