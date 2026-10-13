import { portfolioStore } from '../../store/portfolioStore';
import { calculateCommission, calculateMarginInterest } from '../../domain/portfolio';

export type SideEffectAction =
  | { type: 'FETCH_QUOTE'; ticker: string }
  | { type: 'REFRESH_ALL' }
  | { type: 'SWITCH_VIEW'; view: string }
  | { type: 'SYNC_CLOUD' }
  | { type: 'CLEAR_TERMINAL' };

export interface CommandOutput {
  text: string;
  type: 'cmd' | 'res' | 'err' | 'confirm' | 'unrecognized';
  sideEffect?: SideEffectAction;
}

function cleanNumber(val: string | undefined): number {
  if (!val) return NaN;
  return parseFloat(val.replace(/[$,]/g, ''));
}

export class CommandDispatcher {

  private static evaluateScheduledLadder(
  tickerArg: string | undefined,
  legsInput: Array<{ qty: number; price: number; days: number }>
): CommandOutput {
  const { sym, pos, state } = this.resolveActivePosition(tickerArg);
  const rules = this.getRules(state);
  const totalShares = Number(pos.shares);
  const costBasis = (pos.tranches || []).reduce((s: number, tr: any) => s + tr.qty * tr.price, 0);
  const avgEntry = costBasis / (totalShares || 1);
  const totalDebt = Math.abs(Number(state.balance) || 0);

  let totalNet = 0;
  const summaries: string[] = [];

  legsInput.forEach((leg, i) => {
    const gross = leg.qty * leg.price;
    const legCost = leg.qty * avgEntry;
    const sellComm = calculateCommission(leg.qty, gross, rules as any);
    const extraCarry = totalDebt * rules.dailyRate * leg.days * (leg.qty / (totalShares || 1));
    const legNet = gross - legCost - sellComm - extraCarry;
    totalNet += legNet;
    summaries.push(
      `Leg ${i + 1} (${leg.days === 0 ? 'Today' : `+${leg.days}d`}): ${leg.qty} sh @ $${leg.price.toFixed(2)} → ${legNet >= 0 ? '+' : '-'}$${Math.abs(legNet).toFixed(2)}`
    );
  });

  return {
    type: 'res',
    text: `[Sim ${sym} Staged Exit]: ${summaries.join(' | ')} → Combined Net P&L: ${totalNet >= 0 ? '+' : '-'}$${Math.abs(totalNet).toFixed(2)}`
  };
}

  static execute(input: string): CommandOutput {
    const raw = input.trim();
    if (!raw) return { text: '', type: 'res' };

    const lower = raw.toLowerCase();

    try {
      // 1. HELP & CLEAR
      if (lower === 'help' || lower === '?') {
        return {
          type: 'res',
          text: [
            'Available Frontend Commands (Zero AI/API Latency):',
            '  • bought <shares> <ticker> for <price>   (e.g. bought 10 AAPL for $185.50)',
            '  • sold <shares|all> <ticker> for <price> (e.g. sold all AAPL for $195)',
            '  • target <ticker> <price>                (e.g. target AAPL 210)',
            '  • quote <ticker> [manual_price]          (e.g. quote AAPL or quote AAPL 190)',
            '  • balance <amount> | debt <amount>       (e.g. balance 5000 or debt 1200)',
            '  • cash add <shares> <ticker> [price]     (e.g. cash add 5 MSFT 420)',
            '  • cash remove <ticker>                   (e.g. cash remove MSFT)',
            '  • sell today for <p1> vs sell <N> days later for <p2>',
            '  • sim [ticker] <price> in <days> days    (e.g. sim AAPL 205 in 14d)',
            '  • ladder [ticker] <p1>, <p2>, <p3>       (e.g. ladder AAPL 195, 200, 205)',
            '  • view <ticker|combined|cash> | refresh | clear'
          ].join('\n')
        };
      }

      if (lower === 'clear' || lower === 'cls') {
        return { text: 'Terminal cleared.', type: 'res', sideEffect: { type: 'CLEAR_TERMINAL' } };
      }

      if (lower === 'refresh' || lower === 'quotes') {
        return { text: 'Refreshing all live quotes...', type: 'cmd', sideEffect: { type: 'REFRESH_ALL' } };
      }

      // 2. VIEW SWITCHING: "view AAPL", "view combined", "view cash"
      const viewMatch = raw.match(/^(?:view|tab|show)\s+([a-zA-Z_]+)$/i);
      if (viewMatch) {
        const target = viewMatch[1].toUpperCase();
        const mapped = target === 'CASH' || target === 'BALANCE' ? 'CASH_CUSHION' : target;
        return {
          text: `Switched view to ${mapped}.`,
          type: 'res',
          sideEffect: { type: 'SWITCH_VIEW', view: mapped }
        };
      }

      // 3. COMPARISON SIMULATION: "sell today for $180 vs sell 14 days later for $185"
      const vsMatch = raw.match(
        /sell\s+(?:([a-zA-Z]+)\s+)?today\s+(?:for|at|@)\s*([$0-9.,]+)\s+(?:vs\.?|versus|or)\s+sell\s+(\d+)\s*d(?:ays?)?\s*(?:later\s+)?(?:for|at|@)\s*([$0-9.,]+)/i
      );
      if (vsMatch) {
        return this.evaluateComparison(vsMatch[1], cleanNumber(vsMatch[2]), parseInt(vsMatch[3], 10), cleanNumber(vsMatch[4]));
      }

      // 4. SINGLE SIMULATION: "sim AAPL 200 in 14 days" or "sell in 10 days for 195"
      const simMatch =
        raw.match(/^(?:sim|simulate)\s+(?:([a-zA-Z]+)\s+)?([$0-9.,]+)(?:\s+(?:in|after)\s+(\d+)\s*d(?:ays?)?)?$/i) ||
        raw.match(/^sell\s+(?:([a-zA-Z]+)\s+)?in\s+(\d+)\s*d(?:ays?)?\s+(?:for|at|@)\s*([$0-9.,]+)$/i);
      if (simMatch) {
        const isSellSyntax = raw.toLowerCase().startsWith('sell');
        const tickerArg = simMatch[1];
        const price = cleanNumber(isSellSyntax ? simMatch[3] : simMatch[2]);
        const days = parseInt((isSellSyntax ? simMatch[2] : simMatch[3]) || '0', 10);
        return this.evaluateSingleSim(tickerArg, price, days);
      }

      // 5. LADDER SIMULATION: "ladder AAPL 190, 200, 210"
      const ladderMatch = raw.match(/^ladder\s+(?:([a-zA-Z]+)\s+)?([$0-9.,\s]+)$/i);
      if (ladderMatch) {
        const prices = ladderMatch[2]
          .split(/[\s,]+/)
          .map(cleanNumber)
          .filter((n) => Number.isFinite(n) && n > 0);
        if (prices.length > 0) {
          return this.evaluateLadder(ladderMatch[1], prices);
        }
      }

      // 9. SELL POSITION (PARTIAL OR ALL): "sold 5 AAPL for $190" or "sold all AAPL for $190"
      const sellMatch = raw.match(/^(?:sold|sell|close)\s+(all|[0-9.,]+)\s+([a-zA-Z]+)\s+(?:for|at|@)\s*([$0-9.,]+)$/i);
      if (sellMatch) {
        const qtyRaw = sellMatch[1].toLowerCase();
        const sym = sellMatch[2].toUpperCase();
        const price = cleanNumber(sellMatch[3]);

        if (isNaN(price) || price <= 0) {
          throw new Error('Usage: sold <shares|all> <ticker> for <price>');
        }

        const state: any = portfolioStore.getState();
        const pos = state.positions?.[sym];
        const holding = (state.holdings || []).find((h: any) => h.ticker === sym);
        const availableShares = Number(pos?.shares) ||
          (holding?.tranches || []).reduce((sum: number, t: any) => sum + Number(t.shares || 0), 0);

        if (availableShares <= 0) {
          throw new Error(`No open position found for ${sym}.`);
        }

        const qty = qtyRaw === 'all' ? availableShares : cleanNumber(qtyRaw);
        if (isNaN(qty) || qty <= 0 || qty > availableShares) {
          throw new Error(`Invalid share quantity. Open ${sym} shares: ${availableShares}`);
        }

        if (typeof (portfolioStore as any).sellTranche === 'function') {
          (portfolioStore as any).sellTranche(sym, qty, price, new Date().toISOString().split('T')[0]);
        }

        return {
          text: `Sold ${qty} ${sym} @ $${price.toFixed(2)}`,
          type: 'res',
          sideEffect: { type: 'SYNC_CLOUD' }
        };
      }

      // 11. QUOTE FETCH OR MANUAL PRICE OVERRIDE: "quote AAPL" or "quote AAPL 195.50"
      const quoteMatch = raw.match(/^(?:quote|price|mark)\s+([a-zA-Z]+)(?:\s+([$0-9.,]+))?$/i);
      if (quoteMatch) {
        const sym = quoteMatch[1].toUpperCase();
        const manualPrice = cleanNumber(quoteMatch[2]);

        if (!isNaN(manualPrice) && manualPrice > 0) {
          portfolioStore.updatePrice(sym, manualPrice);
          return {
            text: `${sym} manually marked at $${manualPrice.toFixed(2)}`,
            type: 'res',
            sideEffect: { type: 'SYNC_CLOUD' }
          };
        }

        return {
          text: `Fetching live quote for ${sym}...`,
          type: 'cmd',
          sideEffect: { type: 'FETCH_QUOTE', ticker: sym }
        };
      }

      // A. NATURAL 2-LEG LADDER EXIT: "sell 5 AAPL for 180 today and 5 for 190 in 7 days"
      const naturalLadderMatch = raw.match(
        /^sell\s+([0-9.,]+)\s+(?:([a-zA-Z]+)\s+)?(?:for|at|@)\s*([$0-9.,]+)\s+today\s+and\s+([0-9.,]+)\s+(?:[a-zA-Z]+\s+)?(?:for|at|@)\s*([$0-9.,]+)\s+in\s+(\d+)\s*d(?:ays?)?$/i
      );
      if (naturalLadderMatch) {
        const qty1 = cleanNumber(naturalLadderMatch[1]);
        const tickerArg = naturalLadderMatch[2];
        const p1 = cleanNumber(naturalLadderMatch[3]);
        const qty2 = cleanNumber(naturalLadderMatch[4]);
        const p2 = cleanNumber(naturalLadderMatch[5]);
        const days2 = parseInt(naturalLadderMatch[6], 10);
        return this.evaluateScheduledLadder(tickerArg, [
          { qty: qty1, price: p1, days: 0 },
          { qty: qty2, price: p2, days: days2 }
        ]);
      }

      // B. CASH CUSHION STOCKS (supports "add cash stock 10 MSFT at 420" AND "cash add 10 MSFT 420")
      const cashAddMatch = raw.match(
        /^(?:cash\s+(?:add|buy|bought)|add\s+cash(?:\s+stock)?)\s+([0-9.,]+)\s+([a-zA-Z]+)(?:\s+(?:for|at|@)?\s*([$0-9.,]+))?$/i
      );
      if (cashAddMatch) {
        const qty = cleanNumber(cashAddMatch[1]);
        const sym = cashAddMatch[2].toUpperCase();
        const price = cleanNumber(cashAddMatch[3]) || 0;
        if (isNaN(qty) || qty <= 0) throw new Error('Usage: add cash stock <shares> <ticker> [price]');
        this.mutateCashHolding(sym, qty, price);
        return {
          text: `Added ${qty} ${sym} to cash holdings${price > 0 ? ` @ $${price.toFixed(2)}` : ''}.`,
          type: 'res',
          sideEffect: price > 0 ? { type: 'SYNC_CLOUD' } : { type: 'FETCH_QUOTE', ticker: sym }
        };
      }

      const cashRemMatch = raw.match(
        /^(?:cash\s+(?:remove|rm|del|delete)|remove\s+cash(?:\s+stock)?)\s+([a-zA-Z]+)$/i
      );
      if (cashRemMatch) {
        const sym = cashRemMatch[1].toUpperCase();
        const removed = this.removeCashHolding(sym);
        if (!removed) throw new Error(`${sym} not found in cash holdings.`);
        return { text: `Removed ${sym} from cash holdings.`, type: 'res', sideEffect: { type: 'SYNC_CLOUD' } };
      }

      // C. BALANCE / FREE CASH / DEBT (supports "balance 5000", "debt 1500", and shorthand "b: -5000")
      const balMatch = raw.match(/^(balance|b:|cash|free\s*cash|debt|margin\s*debt)\s*([$-0-9.,]+)$/i);
      if (balMatch) {
        const kind = balMatch[1].toLowerCase();
        const rawAmt = cleanNumber(balMatch[2]);
        if (isNaN(rawAmt)) throw new Error('Usage: balance <amount> or debt <amount>');
        const signed = kind.includes('debt') ? -Math.abs(rawAmt) : rawAmt;
        this.mutateSignedBalance(signed);
        return {
          text: signed >= 0
            ? `Free cash set to $${signed.toFixed(2)} | Margin Debt: $0.00`
            : `Margin debt synced to -$${Math.abs(signed).toFixed(2)}`,
          type: 'res',
          sideEffect: { type: 'SYNC_CLOUD' }
        };
      }

      // D. BUY POSITION WITH OPTIONAL PT: "bought 10 AAPL for $185.50, pt $205"
      const buyMatch = raw.match(
        /^(?:bought|buy|add)\s+([0-9.,]+)\s+([a-zA-Z]+)\s+(?:for|at|@)\s*([$0-9.,]+)(?:\s*,?\s*(?:pt|target)\s+([$0-9.,]+))?(?:\s+on\s+(\S+))?$/i
      );
      if (buyMatch) {
        const qty = cleanNumber(buyMatch[1]);
        const sym = buyMatch[2];
        const price = cleanNumber(buyMatch[3]);
        const pt = cleanNumber(buyMatch[4]);
        const dateStr = buyMatch[5] || new Date().toISOString().split('T')[0];

        if (isNaN(qty) || qty <= 0 || !sym || isNaN(price) || price <= 0) {
          throw new Error('Usage: bought <shares> <ticker> for <price> [, pt <target>]');
        }

        portfolioStore.addTranche(sym, {
          shares: qty,
          entryPrice: price,
          purchaseDate: dateStr,
          ...(Number.isFinite(pt) && pt > 0 ? { targetPrice: pt } : {})
        });

        if (Number.isFinite(pt) && pt > 0) {
          const state: any = { ...portfolioStore.getState() };
          if (state.positions?.[sym]) {
            state.positions[sym].pt = pt;
            portfolioStore.importState(state);
          }
        }

        return {
          text: `Bought ${qty} ${sym} @ $${price.toFixed(2)}${Number.isFinite(pt) && pt > 0 ? ` | Target PT: $${pt.toFixed(2)}` : ''}`,
          type: 'res',
          sideEffect: { type: 'SYNC_CLOUD' }
        };
      }

      // E. TARGET PRICE: supports both "target AAPL 210" AND "set AAPL PT to 210"
      const ptMatch =
        raw.match(/^(?:target|pt)\s+(?:([a-zA-Z]+)\s+)?([$0-9.,]+)$/i) ||
        raw.match(/^set\s+([a-zA-Z]+)\s+(?:pt|target(?:\s+price)?)\s+(?:to\s+)?([$0-9.,]+)$/i);
      if (ptMatch) {
        const state: any = { ...portfolioStore.getState() };
        const sym = (ptMatch[1] || state.activeView || '');
        const pt = cleanNumber(ptMatch[2]);

        if (!sym || !state.positions?.[sym] || isNaN(pt) || pt <= 0) {
          throw new Error('Usage: target <ticker> <price> (for an open margin position)');
        }

        state.positions[sym].pt = pt;
        portfolioStore.importState(state);
        return {
          text: `${sym} price target updated → $${pt.toFixed(2)}`,
          type: 'res',
          sideEffect: { type: 'SYNC_CLOUD' }
        };
      }

      return {
        text: `Command "${raw}" not matched by local CLI.`,
        type: 'unrecognized'
      };
    } catch (err: unknown) {
      return {
        text: err instanceof Error ? err.message : 'Execution failed',
        type: 'err'
      };
    }
  }

  // --- LOCAL MATH & STATE HELPERS ---

  private static resolveActivePosition(tickerArg?: string) {
    const state: any = portfolioStore.getState();
    const sym = (tickerArg || state.activeView || '').toUpperCase();
    const pos = state.positions?.[sym];
    if (!pos || !(Number(pos.shares) > 0)) {
      const allTickers = Object.keys(state.positions || {});
      if (!tickerArg && allTickers.length === 1) {
        return { sym: allTickers[0], pos: state.positions[allTickers[0]], state };
      }
      throw new Error('Select a ticker tab or specify a ticker (e.g., "sell AAPL today for $180 vs sell 14 days later for $185").');
    }
    return { sym, pos, state };
  }

  private static getRules(state: any) {
    const a = state.brokerAssumptions || {};
    const annualRate = Number(a.annualRate ?? a.annualBorrowRate ?? 0.15);
    const dayCountBasis = Number(a.dayCountBasis ?? 365);
    return {
      annualRate,
      dayCountBasis,
      dailyRate: annualRate / dayCountBasis,
      commPerShare: Number(a.commPerShare ?? a.commissionPerShare ?? 0.012),
      commVolumePct: Number(a.commVolumePct ?? a.commissionRatePct ?? 0.0012),
      minCommOrder: Number(a.minCommOrder ?? a.commissionMin ?? 1.2)
    };
  }

  private static evaluateSingleSim(tickerArg: string | undefined, simPrice: number, daysOffset: number): CommandOutput {
    if (isNaN(simPrice) || simPrice <= 0) throw new Error('Invalid simulation price.');
    const { sym, pos, state } = this.resolveActivePosition(tickerArg);
    const rules = this.getRules(state);

    const shares = Number(pos.shares);
    const costBasis = (pos.tranches || []).reduce((s: number, tr: any) => s + tr.qty * tr.price, 0);
    const grossSell = shares * simPrice;
    const commSell = calculateCommission(shares, grossSell, rules as any);
    const totalComms = (Number(pos.commBuy) || 0) + commSell;

    const totalDebt = Math.abs(Number(state.balance) || 0);
    const currentMargin = calculateMarginInterest(pos.tranches || [], {
      dailyRate: rules.dailyRate,
      marginDebt: totalDebt,
      totalDebt
    } as any);
    const projectedMargin = currentMargin + totalDebt * rules.dailyRate * daysOffset;
    const netProfit = grossSell - costBasis - totalComms - projectedMargin;

    return {
      type: 'res',
      text: `[Sim ${sym} @ $${simPrice.toFixed(2)} in ${daysOffset}d]: Gross $${(grossSell - costBasis).toFixed(2)} | Comms -$${totalComms.toFixed(2)} | Margin -$${projectedMargin.toFixed(2)} → Net P&L: ${netProfit >= 0 ? '+' : '-'}$${Math.abs(netProfit).toFixed(2)}`
    };
  }

  private static evaluateComparison(tickerArg: string | undefined, p1: number, days: number, p2: number): CommandOutput {
    const { sym, pos, state } = this.resolveActivePosition(tickerArg);
    const rules = this.getRules(state);

    const shares = Number(pos.shares);
    const costBasis = (pos.tranches || []).reduce((s: number, tr: any) => s + tr.qty * tr.price, 0);
    const totalDebt = Math.abs(Number(state.balance) || 0);
    const baseMargin = calculateMarginInterest(pos.tranches || [], {
      dailyRate: rules.dailyRate,
      marginDebt: totalDebt,
      totalDebt
    } as any);

    const gross1 = shares * p1;
    const comm1 = (Number(pos.commBuy) || 0) + calculateCommission(shares, gross1, rules as any);
    const net1 = gross1 - costBasis - comm1 - baseMargin;

    const extraCarry = totalDebt * rules.dailyRate * days;
    const gross2 = shares * p2;
    const comm2 = (Number(pos.commBuy) || 0) + calculateCommission(shares, gross2, rules as any);
    const net2 = gross2 - costBasis - comm2 - (baseMargin + extraCarry);

    const diff = net2 - net1;
    const verdict = diff > 0
      ? `Waiting ${days}d yields +$${diff.toFixed(2)} MORE net profit (beats $${extraCarry.toFixed(2)} carry cost).`
      : `Selling today yields +$${Math.abs(diff).toFixed(2)} MORE net profit (waiting doesn't beat $${extraCarry.toFixed(2)} carry cost).`;

    return {
      type: 'res',
      text: `[${sym} Comparison]: Today @ $${p1.toFixed(2)} (Net: $${net1.toFixed(2)}) vs +${days}d @ $${p2.toFixed(2)} (Net: $${net2.toFixed(2)}, Extra Carry: -$${extraCarry.toFixed(2)}). ${verdict}`
    };
  }

  private static evaluateLadder(tickerArg: string | undefined, prices: number[]): CommandOutput {
    const { sym, pos, state } = this.resolveActivePosition(tickerArg);
    const rules = this.getRules(state);
    const totalShares = Number(pos.shares);
    const trancheShares = totalShares / prices.length;
    const costBasis = (pos.tranches || []).reduce((s: number, tr: any) => s + tr.qty * tr.price, 0);

    let totalGross = 0;
    let totalSellComm = 0;
    const legs: string[] = [];

    prices.forEach((p, idx) => {
      const legVal = trancheShares * p;
      const legComm = calculateCommission(trancheShares, legVal, rules as any);
      totalGross += legVal;
      totalSellComm += legComm;
      legs.push(`Leg ${idx + 1}: ${trancheShares.toFixed(2)} sh @ $${p.toFixed(2)}`);
    });

    const avgExit = totalGross / totalShares;
    const netBeforeMargin = totalGross - costBasis - (Number(pos.commBuy) || 0) - totalSellComm;

    return {
      type: 'res',
      text: `[${sym} Ladder Exit (${legs.join(' | ')})]: Avg Exit $${avgExit.toFixed(2)} | Sell Comms -$${totalSellComm.toFixed(2)} | Net (ex-margin): $${netBeforeMargin.toFixed(2)}`
    };
  }

  private static mutateSignedBalance(signedBalance: number) {
    const state: any = { ...portfolioStore.getState() };
    if (!state.cashCushion) state.cashCushion = { freeCash: 0, holdings: [] };
    state.cashCushion.freeCash = Math.max(0, signedBalance);
    state.balance = Math.min(0, signedBalance);
    portfolioStore.setCashBalance(signedBalance);
    portfolioStore.importState(state);
  }

  private static mutateCashHolding(symbol: string, shares: number, givenPrice: number) {
    const state: any = { ...portfolioStore.getState() };
    if (!state.cashCushion) state.cashCushion = { freeCash: 0, holdings: [] };
    if (!Array.isArray(state.cashCushion.holdings)) state.cashCushion.holdings = [];

    const existing = state.cashCushion.holdings.find((h: any) => h.ticker === symbol);
    const price = givenPrice > 0 ? givenPrice : Number(existing?.price) || 0;

    if (existing) {
      existing.shares = (Number(existing.shares) || 0) + shares;
      if (givenPrice > 0) existing.price = givenPrice;
    } else {
      state.cashCushion.holdings.push({ ticker: symbol, shares, price });
    }
    portfolioStore.importState(state);
  }

  private static removeCashHolding(symbol: string) {
    const state: any = { ...portfolioStore.getState() };
    const holdings = state.cashCushion?.holdings;
    if (!Array.isArray(holdings)) return null;
    const idx = holdings.findIndex((h: any) => h.ticker === symbol);
    if (idx < 0) return null;
    const [removed] = holdings.splice(idx, 1);
    portfolioStore.importState(state);
    return removed;
  }
}