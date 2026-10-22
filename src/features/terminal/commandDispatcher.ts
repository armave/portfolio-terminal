import { portfolioStore } from '../../store/portfolioStore';
import { calculateCommission, calculateMarginInterest } from '../../domain/portfolio';

type SideEffectAction =
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
  const cleaned = val.replace(/[$,]/g, '').trim();
  if (!cleaned || !/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(cleaned)) return NaN;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : NaN;
}

const MONTH_LOOKUP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

function toLocalIsoDate(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parsePurchaseDate(rawDate?: string): string {
  const today = new Date();
  if (!rawDate) return toLocalIsoDate(today);

  const cleaned = rawDate
    .trim()
    .replace(/^on\s+/i, '')
    .replace(/^\[\vert{}\]$/g, '')
    .trim();

  if (!cleaned || /^today$/i.test(cleaned)) {
    return toLocalIsoDate(today);
  }

  if (/^yesterday$/i.test(cleaned)) {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    return toLocalIsoDate(y);
  }

  const daysAgoMatch = cleaned.match(/^(\d+)\s*d(?:ays?)?\s+ago$/i);
  if (daysAgoMatch) {
    const days = parseInt(daysAgoMatch[1], 10);
    const d = new Date(today);
    d.setDate(d.getDate() - days);
    return toLocalIsoDate(d);
  }

  // YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = cleaned.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10);
    const day = parseInt(ymdMatch[3], 10);
    const check = new Date(year, month - 1, day);
    if (
      check.getFullYear() === year &&
      check.getMonth() === month - 1 &&
      check.getDate() === day
    ) {
      return toLocalIsoDate(check);
    }
    throw new Error(`Invalid calendar date "${cleaned}". Use YYYY-MM-DD or "Mar 25".`);
  }

  // "Mar 25", "March 25 2026", "25 Mar", "25 Mar 2026"
  const monFirst = cleaned.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:[,\s]+(\d{4}))?$/);
  const dayFirst = cleaned.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?(?:[,\s]+(\d{4}))?$/);
  if (monFirst || dayFirst) {
    const monStr = (monFirst ? monFirst[1] : dayFirst![2]).slice(0, 3).toLowerCase();
    const day = parseInt(monFirst ? monFirst[2] : dayFirst![1], 10);
    const yearStr = monFirst ? monFirst[3] : dayFirst![3];
    const year = yearStr ? parseInt(yearStr, 10) : today.getFullYear();
    const monthIdx = MONTH_LOOKUP[monStr];

    if (monthIdx !== undefined && day >= 1 && day <= 31) {
      const check = new Date(year, monthIdx, day);
      if (check.getMonth() === monthIdx && check.getDate() === day) {
        return toLocalIsoDate(check);
      }
    }
    throw new Error(`Invalid date "${cleaned}". Use YYYY-MM-DD or "Mar 25".`);
  }

  throw new Error(
    `Unrecognized date "${cleaned}". Try "on YYYY-MM-DD", "on Mar 25", "yesterday", or "3 days ago".`
  );
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
    // An untouched optional target-price placeholder means "use the default".
    let raw = input.trim().replace(/,\s*(?:pt|target)\s+\[[^\]]+\]/gi, '').trim();
    if (!raw) return { text: '', type: 'res' };

    const unresolved = raw.match(/\[([^\]]+)\]/);
    if (unresolved) {
      return {
        text: `Please replace [${unresolved[1]}] with a value before running this command.`,
        type: 'err'
      };
    }

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
            '  • compare exits [ticker] today at <p>, tomorrow at <p>, after 4 days at <p>, 1 week later at <p>',
            '  • buy scenario <shares> <ticker> at <price> (read-only add-on purchase simulation)',
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

      const exitSeriesMatch = raw.match(/^compare\s+exits?\s+(.+)$/i);
      if (exitSeriesMatch) {
        let tickerArg: string | undefined;
        const scenarios: Array<{ label: string; days: number; price: number }> = [];
        for (const segment of exitSeriesMatch[1].split(/\\s*,\\s*/).filter(Boolean)) {
          const match = segment.match(/^(?:([A-Za-z]{1,10})\\s+)?(today|tomorrow|(?:(?:after|in)\\s+)?(?:\\d+|a|one)\\s*(?:d|days?|w|weeks?)(?:\\s+(?:later|from\\s+now))?)\\s+(?:at|for|@)\\s*([$0-9.,]+)$/i);
          if (!match) throw new Error('Usage: compare exits [TICKER] today at 190, tomorrow at 191, after 4 days at 193, 1 week later at 195');
          if (match[1]) { const found = match[1].toUpperCase(); if (tickerArg && tickerArg !== found) throw new Error('Use the same ticker for every exit scenario.'); tickerArg = found; }
          const period = match[2].toLowerCase().replace(/^(?:after|in)\\s+/, '').replace(/\\s+(?:later|from\\s+now)$/, '').replace(/^a\\s+/, '1 ').replace(/^one\\s+/, '1 ');
          let days = 0;
          if (period === 'tomorrow') days = 1;
          else if (period !== 'today') {
            const p = period.match(/^(\\d+)\\s*(d|day|days|w|week|weeks)$/);
            if (!p) throw new Error('Unrecognized exit date: ' + match[2]);
            days = Number(p[1]) * (p[2].startsWith('w') ? 7 : 1);
          }
          if (!Number.isInteger(days) || days < 0 || days > 3650) throw new Error('Exit date must be within the next 10 years.');
          const price = cleanNumber(match[3]); if (!Number.isFinite(price) || price <= 0) throw new Error('Every exit price must be a positive number.');
          scenarios.push({ label: match[2], days, price });
        }
        if (scenarios.length < 2) throw new Error('Provide at least two exit scenarios to compare.');
        return this.evaluateExitScenarios(tickerArg, scenarios);
      }
      const buyScenarioMatch = raw.match(/^buy\s+scenario\s+([0-9.,]+)\s+([A-Za-z]{1,10})\s+(?:at|for|@)\s*([$0-9.,]+)$/i);
      if (buyScenarioMatch) return this.evaluateBuyScenario(cleanNumber(buyScenarioMatch[1]), buyScenarioMatch[2].toUpperCase(), cleanNumber(buyScenarioMatch[3]));

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
        const availableShares =
          Number(pos?.shares) ||
          (pos?.tranches || []).reduce((sum: number, t: any) => sum + Number(t.qty ?? t.shares ?? 0), 0);

        if (availableShares <= 0) {
          throw new Error(`No open position found for ${sym}.`);
        }

        const qty = qtyRaw === 'all' ? availableShares : cleanNumber(qtyRaw);
        portfolioStore.sellStock(sym, qty, price, new Date().toISOString().split('T')[0]);

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

      // 6. CASH CUSHION STOCKS: "cash add 10 MSFT for 420" / "add cash stock 10 MSFT at 420"
      const cashAddMatch = raw.match(
        /^(?:cash\s+(?:add|buy|bought)|add\s+cash(?:\s+stock)?)\s+([0-9.,]+)\s+([a-zA-Z]+)(?:\s+(?:for|at|@)?\s*([$0-9.,]+))?$/i
      );
      if (cashAddMatch) {
        const qty = cleanNumber(cashAddMatch[1]);
        const sym = cashAddMatch[2].toUpperCase();
        const price = cleanNumber(cashAddMatch[3]) || 0;
        if (isNaN(qty) || qty <= 0) throw new Error('Usage: add cash stock <shares> <ticker> [price]');
        portfolioStore.addCashStock(sym, qty, price);
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
        portfolioStore.removeCashStock(sym);
        return { text: `Removed ${sym} from cash holdings.`, type: 'res', sideEffect: { type: 'SYNC_CLOUD' } };
      }

      // 7. BALANCE / FREE CASH / DEBT: "balance 5000", "debt 1500", "b: -5000"
      const balMatch = raw.match(/^(balance|b:|cash|free\s*cash|debt|margin\s*debt)\s*([-0-9$.,]+)$/i);
      if (balMatch) {
        const kind = balMatch[1].toLowerCase();
        const rawAmt = cleanNumber(balMatch[2]);
        if (!Number.isFinite(rawAmt)) throw new Error('Enter a valid finite amount.');
        if (kind === 'cash' || kind === 'free cash') {
          if (rawAmt < 0) throw new Error('Free cash cannot be negative. Use "debt <amount>" to set margin debt.');
          portfolioStore.setFreeCash(rawAmt);
          const debt = Math.abs(Number(portfolioStore.getState().balance) || 0);
          return {
            text: `Free cash set to $${rawAmt.toFixed(2)} | Margin Debt unchanged: $${debt.toFixed(2)}`,
            type: 'res',
            sideEffect: { type: 'SYNC_CLOUD' }
          };
        }
        const signed = kind.includes('debt') ? -Math.abs(rawAmt) : rawAmt;
        portfolioStore.setCashBalance(signed);
        return {
          text: signed >= 0
            ? `Free cash set to $${signed.toFixed(2)} | Margin Debt: $0.00`
            : `Margin debt synced to -${Math.abs(signed).toFixed(2)}`,
          type: 'res',
          sideEffect: { type: 'SYNC_CLOUD' }
        };
      }

      // BUY POSITION WITH OPTIONAL PT AND PURCHASE DATE
      const buyMatch = raw.match(
        /^(?:bought|buy|add)\s+([0-9.,]+)\s+([a-zA-Z]+)\s+(?:for|at|@)\s*([$0-9.,]+)(.*)$/i
      );
      if (buyMatch) {
        const qty = cleanNumber(buyMatch[1]);
        const sym = buyMatch[2].toUpperCase();
        const price = cleanNumber(buyMatch[3]);
        let tail = (buyMatch[4] || '').trim();

        if (isNaN(qty) || qty <= 0 || !sym || isNaN(price) || price <= 0) {
          throw new Error(
            'Usage: bought <shares> <ticker> for <price> [, pt <target>] [on <date>]'
          );
        }

        let pt = NaN;
        const ptExtract = tail.match(/(?:^|,|\s)(?:pt|target)\s+([$0-9.,]+)/i);
        if (ptExtract) {
          pt = cleanNumber(ptExtract[1]);
          tail = tail.replace(ptExtract[0], ' ').trim();
        }

        tail = tail.replace(/^[,\s]+|[,\s]+$/g, '');
        let dateStr = toLocalIsoDate(new Date());

        if (tail) {
          const dateExtract = tail.match(/^(?:on\s+)?(.+)$/i);
          if (dateExtract) {
            dateStr = parsePurchaseDate(dateExtract[1]);
          }
        }

        if (typeof (portfolioStore as any).buyStock === 'function') {
          portfolioStore.buyStock(
            sym,
            qty,
            price,
            dateStr,
            Number.isFinite(pt) && pt > 0 ? pt : undefined
          );
        } else if (typeof (portfolioStore as any).addTranche === 'function') {
          (portfolioStore as any).addTranche(sym, {
            shares: qty,
            entryPrice: price,
            purchaseDate: dateStr,
            ...(Number.isFinite(pt) && pt > 0 ? { targetPrice: pt } : {})
          });
        }

        const isToday = dateStr === toLocalIsoDate(new Date());
        return {
          text: `Bought ${qty} ${sym} @ ${price.toFixed(2)}${!isToday ? ` (Date: ${dateStr})` : ''
            }${Number.isFinite(pt) && pt > 0 ? ` | Target PT: ${pt.toFixed(2)}` : ''}`,
          type: 'res',
          sideEffect: { type: 'FETCH_QUOTE', ticker: sym }
        };
      }

      // 10. TARGET PRICE / PT: "target AAPL 210" or "set AAPL PT to 210"
      const ptMatch =
        raw.match(/^(?:target|pt)\s+(?:([a-zA-Z]+)\s+)?([$0-9.,]+)$/i) ||
        raw.match(/^set\s+([a-zA-Z]+)\s+(?:pt|target(?:\s+price)?)\s+(?:to\s+)?([$0-9.,]+)$/i);
      if (ptMatch) {
        const state: any = portfolioStore.getState();
        const sym = (ptMatch[1] || state.activeView || '').toUpperCase();
        const pt = cleanNumber(ptMatch[2]);

        if (!sym || isNaN(pt) || pt <= 0) {
          throw new Error('Usage: target <ticker> <price> (for an open margin position)');
        }

        portfolioStore.updateTargetPrice(sym, pt);
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
    if (!Number.isFinite(p1) || p1 <= 0 || !Number.isFinite(p2) || p2 <= 0) {
      throw new Error('Enter valid positive prices for both exit scenarios.');
    }
    if (!Number.isInteger(days) || days < 0) {
      throw new Error('Waiting period must be a whole number of days (zero or more).');
    }

    const { sym, pos, state } = this.resolveActivePosition(tickerArg);
    const rules = this.getRules(state);
    const shares = Number(pos.shares);
    if (!Number.isFinite(shares) || shares <= 0) {
      throw new Error('No valid open shares found for ' + sym + '.');
    }

    const costBasis = (pos.tranches || []).reduce((sum: number, tranche: any) =>
      sum + (Number(tranche.qty) || 0) * (Number(tranche.price) || 0), 0);
    const buyCommission = Math.max(0, Number(pos.commBuy) || 0);
    const totalDebt = Math.abs(Number(state.balance) || 0);
    const currentMargin = calculateMarginInterest(pos.tranches || [], {
      dailyRate: rules.dailyRate,
      marginDebt: totalDebt,
      totalDebt
    } as any);
    const extraCarry = totalDebt * rules.dailyRate * days;

    const grossToday = shares * p1;
    const sellCommToday = calculateCommission(shares, grossToday, rules as any);
    const marginToday = currentMargin;
    const netToday = grossToday - costBasis - buyCommission - sellCommToday - marginToday;

    const grossLater = shares * p2;
    const sellCommLater = calculateCommission(shares, grossLater, rules as any);
    const marginLater = currentMargin + extraCarry;
    const netLater = grossLater - costBasis - buyCommission - sellCommLater - marginLater;

    const diff = netLater - netToday;
    const priceChange = ((p2 - p1) / p1) * 100;
    const money = (value: number) => (value < 0 ? '-$' : '$') + Math.abs(value).toFixed(2);
    const signedMoney = (value: number) => (value > 0 ? '+$' : value < 0 ? '-$' : '$') + Math.abs(value).toFixed(2);
    const signedPercent = (value: number) => (value > 0 ? '+' : '') + value.toFixed(2) + '%';
    const winner = Math.abs(diff) < 0.005
      ? 'RESULT: Effectively tied after estimated costs.'
      : diff > 0
        ? 'RESULT: Waiting wins by ' + money(diff) + ' net.'
        : 'RESULT: Selling today wins by ' + money(-diff) + ' net.';

    return {
      type: 'res',
      text: [
        '[EXIT COMPARISON: ' + sym + '] ' + shares.toLocaleString() + ' shares | Cost basis: ' + money(costBasis),
        'Assumptions: buy commissions ' + money(buyCommission) + ' | current margin interest ' + money(currentMargin) + ' | margin debt ' + money(totalDebt),
        '',
        'A) SELL TODAY @ ' + money(p1),
        '  Gross proceeds:     ' + money(grossToday),
        '  Cost basis:        -' + money(costBasis),
        '  Buy commission:    -' + money(buyCommission),
        '  Sell commission:   -' + money(sellCommToday),
        '  Margin interest:   -' + money(marginToday),
        '  NET P&L:            ' + signedMoney(netToday),
        '',
        'B) WAIT ' + days + ' DAY' + (days === 1 ? '' : 'S') + ' @ ' + money(p2) + ' (' + signedPercent(priceChange) + ' vs today)',
        '  Gross proceeds:     ' + money(grossLater),
        '  Cost basis:        -' + money(costBasis),
        '  Buy commission:    -' + money(buyCommission),
        '  Sell commission:   -' + money(sellCommLater),
        '  Margin interest:   -' + money(marginLater) + ' (extra carry ' + money(extraCarry) + ')',
        '  NET P&L:            ' + signedMoney(netLater),
        '',
        'NET ADVANTAGE (B - A): ' + signedMoney(diff),
        winner
      ].join('\n')
    };
  }

  private static evaluateExitScenarios(tickerArg: string | undefined, scenarios: Array<{ label: string; days: number; price: number }>): CommandOutput {
    const { sym, pos, state } = this.resolveActivePosition(tickerArg), rules = this.getRules(state), shares = Number(pos.shares);
    if (!Number.isFinite(shares) || shares <= 0) throw new Error('No valid open shares found for ' + sym + '.');
    const costBasis = (pos.tranches || []).reduce((sum: number, t: any) => sum + (Number(t.qty) || 0) * (Number(t.price) || 0), 0);
    const buyCommission = Math.max(0, Number(pos.commBuy) || 0), debt = Math.abs(Number(state.balance) || 0);
    const currentMargin = calculateMarginInterest(pos.tranches || [], { dailyRate: rules.dailyRate, marginDebt: debt, totalDebt: debt } as any);
    const money = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2), signed = (n: number) => (n > 0 ? '+$' : n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
    const rows = scenarios.map(s => { const gross = shares * s.price, sellFee = calculateCommission(shares, gross, rules as any), carry = debt * rules.dailyRate * s.days, net = gross - costBasis - buyCommission - sellFee - currentMargin - carry; return { ...s, gross, sellFee, carry, net }; });
    const baseline = rows.find(r => r.days === 0)?.net ?? rows[0].net, best = rows.reduce((a, b) => b.net > a.net ? b : a, rows[0]);
    return { type: 'res', text: [
      '[MULTI-DATE EXIT COMPARISON: ' + sym + '] ' + shares.toLocaleString() + ' shares | Cost basis: ' + money(costBasis),
      'Assumptions: buy commissions ' + money(buyCommission) + ' | current margin interest ' + money(currentMargin) + ' | margin debt ' + money(debt), '',
      ...rows.map((r, i) => [(i + 1) + ') ' + r.label + ' | Exit @ ' + money(r.price) + (r.days ? ' | +' + r.days + 'd' : ''),
        '   Gross proceeds: ' + money(r.gross) + ' | Sell commission: -' + money(r.sellFee),
        '   Margin interest: -' + money(currentMargin + r.carry) + (r.carry ? ' (extra carry ' + money(r.carry) + ')' : ''),
        '   NET P&L: ' + signed(r.net) + ' | vs baseline: ' + signed(r.net - baseline)].join('\n')),
      '', 'BEST ESTIMATED EXIT: ' + best.label + ' @ ' + money(best.price) + ' → ' + signed(best.net) + ' net P&L',
      'Estimate only; prices are assumptions. Assumes shares, cost basis and margin debt remain unchanged until exit.'
    ].join('\n') };
  }

  private static evaluateBuyScenario(qty: number, ticker: string, price: number): CommandOutput {
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
      throw new Error('Usage: buy scenario <shares> <ticker> at <price>.');
    }
    const state: any = portfolioStore.getState();
    const pos = state.positions?.[ticker];
    if (!pos || !(Number(pos.shares) > 0)) {
      throw new Error('No open position found for ' + ticker + '. Buy scenarios require an existing position.');
    }

    const rules = this.getRules(state);
    const oldShares = Number(pos.shares);
    const oldCost = (pos.tranches || []).reduce(
      (sum: number, tranche: any) => sum + (Number(tranche.qty) || 0) * (Number(tranche.price) || 0), 0
    );
    const oldBuyFee = Math.max(0, Number(pos.commBuy) || 0);
    const purchaseValue = qty * price;
    const purchaseFee = calculateCommission(qty, purchaseValue, rules as any);
    const balance = Number(state.balance) || 0;
    const currentDebt = Math.max(0, -balance);
    const additionalMarginDebt = Math.max(0, purchaseValue + purchaseFee - Math.max(0, balance));
    const currentDailyMarginFee = currentDebt * rules.dailyRate;
    const projectedDailyMarginFee = (currentDebt + additionalMarginDebt) * rules.dailyRate;
    const dailyMarginFeeDifference = projectedDailyMarginFee - currentDailyMarginFee;
    const newShares = oldShares + qty;
    const newCost = oldCost + purchaseValue;
    const newBuyFee = oldBuyFee + purchaseFee;
    const quote = Number(pos.currentPrice) > 0 ? Number(pos.currentPrice) : oldCost / oldShares;
    const oldAverage = oldCost / oldShares;
    const newAverage = newCost / newShares;
    const oldValue = oldShares * quote;
    const newValue = newShares * quote;
    const oldPnl = oldValue - oldCost - oldBuyFee;
    const newPnl = newValue - newCost - newBuyFee;
    const target = Number(pos.pt);
    const hasTarget = Number.isFinite(target) && target > 0;
    const money = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
    const signed = (n: number) => (n > 0 ? '+$' : n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
    const pct = (n: number) => (n > 0 ? '+' : '') + n.toFixed(2) + '%';
    const targetOldPnl = hasTarget ? oldShares * target - oldCost - oldBuyFee : 0;
    const targetNewPnl = hasTarget ? newShares * target - newCost - newBuyFee : 0;
    const downsidePrice = quote * 0.9;
    const downsideOldPnl = oldShares * downsidePrice - oldCost - oldBuyFee;
    const downsideNewPnl = newShares * downsidePrice - newCost - newBuyFee;
    const downsideDelta = downsideNewPnl - downsideOldPnl;
    const breakEvenAfterBuy = (newCost + newBuyFee) / newShares;

    const lines = [
      '[HYPOTHETICAL BUY: ' + ticker + ']',
      'Add ' + qty.toLocaleString() + ' shares @ ' + money(price) + ' · est. fee ' + money(purchaseFee),
      'Cash required: ' + money(purchaseValue + purchaseFee),
      'Daily margin fee: ' + money(currentDailyMarginFee) + ' → ' + money(projectedDailyMarginFee) + ' (' + (dailyMarginFeeDifference >= 0 ? '+' : '-') + money(Math.abs(dailyMarginFeeDifference)) + '/day)',
      'Additional exposure: ' + money(purchaseValue) + ' before fee | New position value at quote: ' + money(newShares * quote),
      '',
      'POSITION CHANGE',
      'Shares: ' + oldShares.toLocaleString() + ' → ' + newShares.toLocaleString() + ' (+' + qty.toLocaleString() + ')',
      'Average entry: ' + money(oldAverage) + ' → ' + money(newAverage) + ' (' + signed(newAverage - oldAverage) + '/share)',
      'Cost basis: ' + money(oldCost + oldBuyFee) + ' → ' + money(newCost + newBuyFee),
      '',
      'PROFIT / LOSS COMPARISON',
      'At current quote (' + money(quote) + '): ' + signed(oldPnl) + ' → ' + signed(newPnl) + ' (' + signed(newPnl - oldPnl) + ')',
      'P&L change per $1 stock move: ' + money(oldShares) + ' → ' + money(newShares) + ' (' + signed(qty) + ' per $1 move)'
    ];
    lines.push(
      'At -10% from quote (' + money(downsidePrice) + '): ' + signed(downsideOldPnl) + ' → ' + signed(downsideNewPnl) + ' (' + signed(downsideDelta) + ' change)',
      'Break-even after adding shares (incl. estimated buy fees): ' + money(breakEvenAfterBuy),
      'Downside sensitivity: every additional $1 decline adds about ' + money(qty) + ' more loss versus current position.'
    );
    if (hasTarget) {
      lines.push(
        'At target (' + money(target) + '): ' + signed(targetOldPnl) + ' → ' + signed(targetNewPnl) + ' (' + signed(targetNewPnl - targetOldPnl) + ')',
        'Return on cost at target: ' + pct(oldCost + oldBuyFee > 0 ? targetOldPnl / (oldCost + oldBuyFee) * 100 : 0) +
          ' → ' + pct(newCost + newBuyFee > 0 ? targetNewPnl / (newCost + newBuyFee) * 100 : 0),
        'Target upside from quote: ' + pct((target / quote - 1) * 100) + ' | Added shares gross upside: ' + signed(qty * (target - price) - purchaseFee)
      );
    }
    lines.push(
      '',
      'Risk note: more shares increase both gains and losses; the -10% case is a stress test, not a forecast.',
      'Hypothetical only · no trade or portfolio changes.'
    );
    return { type: 'res', text: lines.join('\n') };
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
    const buyCommission = Math.max(0, Number(pos.commBuy) || 0);
    const netBeforeMargin = totalGross - costBasis - buyCommission - totalSellComm;
    const totalDebt = Math.abs(Number(state.balance) || 0);
    const marginCharged = calculateMarginInterest(pos.tranches || [], {
      dailyRate: rules.dailyRate,
      marginDebt: totalDebt,
      totalDebt
    } as any);
    const netAfterMargin = netBeforeMargin - marginCharged;
    const netPct = costBasis > 0 ? (netAfterMargin / costBasis) * 100 : 0;
    const money = (value: number) => (value < 0 ? '-$' : '$') + Math.abs(value).toFixed(2);
    const signedMoney = (value: number) => (value > 0 ? '+$' : value < 0 ? '-$' : '$') + Math.abs(value).toFixed(2);
    const signedPercent = (value: number) => (value > 0 ? '+' : '') + value.toFixed(2) + '%';

    return {
      type: 'res',
      text: [
        `[LADDER EXIT: ${sym}] ${totalShares.toLocaleString()} shares across ${prices.length} equal legs`,
        ...legs,
        `Average exit: ${money(avgExit)} | Gross proceeds: ${money(totalGross)}`,
        `Cost basis: -${money(costBasis)} | Buy commissions: -${money(buyCommission)} | Sell commissions: -${money(totalSellComm)}`,
        `Estimated margin interest to date: -${money(marginCharged)}`,
        `NET P&L after estimated costs: ${signedMoney(netAfterMargin)} (${signedPercent(netPct)} on cost basis)`,
        'Estimate only; equal share allocation per leg, current broker rules and current margin debt assumed.'
      ].join('\n')
    };
  }
}
