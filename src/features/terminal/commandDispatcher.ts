import { portfolioStore } from '../../store/portfolioStore';

export interface CommandOutput {
  text: string;
  type: 'cmd' | 'res' | 'err' | 'confirm';
}

export class CommandDispatcher {
  static execute(input: string): CommandOutput {
    const raw = input.trim();
    if (!raw) return { text: '', type: 'res' };

    const parts = raw.split(/\s+/);
    const verb = parts[0].toLowerCase();

    try {
      if (verb === 'balance') {
        const amt = parseFloat(parts[1]);
        if (isNaN(amt)) throw new Error('Usage: balance <amount>');
        portfolioStore.setCashBalance(amt);
        return { text: `Cash balance set to $${amt.toFixed(2)}`, type: 'res' };
      }

      if (verb === 'bought') {
        // Syntax: bought <qty> <sym> for <price>
        const qty = parseFloat(parts[1]);
        const sym = parts[2]?.toUpperCase();
        const price = parseFloat(parts[4]);
        if (isNaN(qty) || !sym || isNaN(price)) {
          throw new Error('Usage: bought <shares> <ticker> for <price>');
        }
        portfolioStore.addTranche(sym, {
          shares: qty,
          entryPrice: price,
          purchaseDate: new Date().toISOString().split('T')[0]
        });
        return { text: `Added position: ${qty} ${sym} @ $${price.toFixed(2)}`, type: 'res' };
      }

      if (verb === 'quote') {
        const sym = parts[1]?.toUpperCase();
        if (!sym) throw new Error('Usage: quote <ticker>');

        // This acts as a manual price override via terminal
        const manualPrice = parseFloat(parts[2]);
        if (!isNaN(manualPrice)) {
          portfolioStore.updatePrice(sym, manualPrice);
          return { text: `${sym} manually marked at $${manualPrice.toFixed(2)}`, type: 'res' };
        }

        return { text: `Fetching quote for ${sym} (handled by UI listener)...`, type: 'cmd' };
      }

      return {
        text: `Unrecognized CLI command "${verb}". Try natural language for AI parsing.`,
        type: 'err'
      };
    } catch (err: unknown) {
      return {
        text: err instanceof Error ? err.message : 'Execution failed',
        type: 'err'
      };
    }
  }
}