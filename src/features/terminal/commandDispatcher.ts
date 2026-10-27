import { portfolioStore } from '../../store/portfolioStore';
import { calculateAccruedFees, calculateCommission, calculateMarginInterest, calculateProjectedDebt } from '../../domain/portfolio';
import { getUsEquityProjectionDates } from '../../domain/tradingCalendar';

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
  modal?: ScenarioModalData;
}

export interface ScenarioModalData {
  kind: 'buy-more' | 'exit-comparison';
  title: string;
  subtitle: string;
  columns: string[];
  rows: Array<{
    label: string;
    values: string[];
    kind?: 'section' | 'fee' | 'result' | 'risk' | 'balance';
    deltas?: Array<string | undefined>;
  }>;
  presets?: Array<{ label: string; columnIndexes: number[] }>;
  quickActions?: Array<{ label: string; command?: string; columnIndexes?: number[]; invert?: boolean }>;
  action?: { label: string; command: string };
  note: string;
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

function parseRelativeExitDays(rawDate: string): number {
  const cleaned = rawDate.trim().toLowerCase().replace(/\s+/g, ' ');
  if (cleaned === 'today') return 0;
  if (cleaned === 'tomorrow') return 1;
  const normalized = cleaned
    .replace(/^(?:after|in)\s+/, '')
    .replace(/\s+(?:later|from\s+now)$/, '')
    .replace(/^a\s+/, '1 ')
    .replace(/^one\s+/, '1 ');
  const match = normalized.match(/^(\d+)\s*(d|day|days|w|week|weeks|m|month|months)$/);
  if (!match) throw new Error('Unrecognized exit date: ' + rawDate);
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit.startsWith('m')) {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth() + amount, now.getDate());
    if (target.getDate() !== now.getDate()) target.setDate(0);
    return Math.round((new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
  }
  return amount * (unit.startsWith('w') ? 7 : 1);
}

export class CommandDispatcher {

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
            '  • Margin stock quantities and fill prices sync automatically from Freedom Broker.',
            '  • Manual buy/sell entries and target prices are not required for margin holdings.',
            '  • quote <ticker> [manual_price]          (e.g. quote AAPL or quote AAPL 190)',
            '  • balance <amount> | debt <amount>       (e.g. balance 5000 or debt 1200)',
            '  • cash add <shares> <ticker> [price]     (e.g. cash add 5 MSFT 420)',
            '  • cash remove <ticker>                   (e.g. cash remove MSFT)',
            '  • move <shares> <ticker> to <margin|cash> (e.g. move 10 GOOGL to margin)',
            '  • sell today for <p1> vs sell <N> days later for <p2>',
            '  • sim [ticker] <price> in <days> days    (e.g. sim AAPL 205 in 14d)',
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
        for (const segment of exitSeriesMatch[1].split(/\s*,\s*/).filter(Boolean)) {
          const match = segment.match(/^(?:(?!(?:after|in)\s)([A-Za-z]{1,10})\s+)?(today|tomorrow|(?:(?:after|in)\s+)?(?:\d+|a|one)\s*(?:d|days?|w|weeks?|m|months?)(?:\s+(?:later|from\s+now))?)\s+(?:at|for|@)\s*([$0-9.,]+)$/i);
          if (!match) throw new Error('Usage: compare exits [TICKER] today at 190, tomorrow at 191, after 4 days at 193, in 2 weeks at 195, 1 month later at 200');
          if (match[1]) { const found = match[1].toUpperCase(); if (tickerArg && tickerArg !== found) throw new Error('Use the same ticker for every exit scenario.'); tickerArg = found; }
          const period = match[2].toLowerCase()
            .replace(/^(?:after|in)\s+/, '')
            .replace(/\s+(?:later|from\s+now)$/, '')
            .replace(/^a\s+/, '1 ')
            .replace(/^one\s+/, '1 ');
          let days = 0;
          if (period === 'tomorrow') days = 1;
          else if (period !== 'today') {
            const p = period.match(/^(\d+)\s*(d|day|days|w|week|weeks|m|month|months)$/);
            if (!p) throw new Error('Unrecognized exit date: ' + match[2]);
            const amount = Number(p[1]);
            const unit = p[2];
            if (unit.startsWith('m')) {
              const now = new Date();
              const target = new Date(now.getFullYear(), now.getMonth() + amount, now.getDate());
              // If the target month is shorter (e.g. Jan 31 + 1 month), clamp to its last day.
              if (target.getDate() !== now.getDate()) target.setDate(0);
              days = Math.round((new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime() -
                new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
            } else {
              days = amount * (unit.startsWith('w') ? 7 : 1);
            }
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

      // 3. NATURAL-LANGUAGE EXIT COMPARISON:
      // "sell GOOGL tomorrow for 333.10 vs sell 14 days later for 343.09"
      const vsMatch = raw.match(
        /^sell\s+(?:(?!(?:after|in|today|tomorrow)\s)([a-zA-Z]{1,10})\s+)?(today|tomorrow|(?:(?:after|in)\s+)?(?:\d+|a|one)\s*(?:d|days?|w|weeks?|m|months?)(?:\s+(?:later|from\s+now))?)\s+(?:for|at|@)\s*([$0-9.,]+)\s+(?:vs\.?|versus|or)\s+sell\s+(?:(?!(?:after|in|today|tomorrow)\s)[a-zA-Z]{1,10}\s+)?(today|tomorrow|(?:(?:after|in)\s+)?(?:\d+|a|one)\s*(?:d|days?|w|weeks?|m|months?)(?:\s+(?:later|from\s+now))?)\s+(?:for|at|@)\s*([$0-9.,]+)$/i
      );
      if (vsMatch) {
        const firstDate = vsMatch[2];
        const firstPrice = cleanNumber(vsMatch[3]);
        const secondDate = vsMatch[4];
        const secondPrice = cleanNumber(vsMatch[5]);
        const firstDays = parseRelativeExitDays(firstDate);
        const secondDays = parseRelativeExitDays(secondDate);
        if (firstDays > 3650 || secondDays > 3650) throw new Error('Exit date must be within the next 10 years.');
        return this.evaluateExitScenarios(vsMatch[1], [
          { label: firstDate, days: firstDays, price: firstPrice },
          { label: secondDate, days: secondDays, price: secondPrice }
        ]);
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

      // Reclassify existing holdings without simulating a buy/sell or changing cash/debt.
      const moveStockMatch = raw.match(/^move\\s+([0-9.,]+)\\s+([a-zA-Z]+)\\s+to\\s+(margin|cash)$/i);
      if (moveStockMatch) {
        const qty = cleanNumber(moveStockMatch[1]);
        const sym = moveStockMatch[2].toUpperCase();
        const destination = moveStockMatch[3].toLowerCase() as 'margin' | 'cash';
        if (!Number.isFinite(qty) || qty <= 0) throw new Error('Usage: move <shares> <ticker> to <margin|cash>');
        const moved = portfolioStore.moveStockClassification(sym, qty, destination);
        if (!moved) throw new Error(`Could not move shares: verify ${sym} has enough active shares in the source bucket and a valid cost/market price.`);
        return {
          text: `Moved ${moved.shares} ${sym} to ${destination} at recorded basis $ ${moved.price.toFixed(2)} per share. No broker order was placed; cash/debt unchanged.`.replace('$ ', '
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

  private static evaluateExitScenarios(tickerArg: string | undefined, scenarios: Array<{ label: string; days: number; price: number }>): CommandOutput {
    const { sym, pos, state } = this.resolveActivePosition(tickerArg);
    const rules = this.getRules(state);
    const shares = Number(pos.shares);
    if (!Number.isFinite(shares) || shares <= 0) throw new Error('No valid open shares found for ' + sym + '.');

    const costBasis = (pos.tranches || []).reduce((sum: number, t: any) => sum + (Number(t.qty) || 0) * (Number(t.price) || 0), 0);
    const buyCommission = Math.max(0, Number(pos.commBuy) || 0);
    const balance = Number(state.balance) || 0;
    const startingCash = Number(state.cashBalance ?? state.cashCushion?.freeCash) || 0;
    const debt = Math.max(0, -balance);
    const currentMargin = calculateMarginInterest(pos.tranches || [], { dailyRate: rules.dailyRate, marginDebt: debt, totalDebt: debt } as any);
    const money = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
    const signed = (n: number) => (n > 0 ? '+$' : n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
    const rows = scenarios.map(s => {
      const gross = shares * s.price;
      const sellFee = calculateCommission(shares, gross, rules as any);
      const carry = debt * rules.dailyRate * s.days;
      const marginFee = currentMargin + carry;
      const net = gross - costBasis - buyCommission - sellFee - marginFee;
      const netProceeds = Math.max(0, gross - sellFee);
      const debtRepaid = Math.min(debt, netProceeds);
      const finalBalance = debt > 0 ? -(debt - debtRepaid) : balance;
      const cashSurplus = debt > 0 ? Math.max(0, netProceeds - debt) : netProceeds;
      // Project post-exit account equity from the actual current account state:
      // available cash + sale proceeds after sell commission - current margin debt
      // - estimated interest through the selected exit date. Buy commission is historical
      // and already reflected in the current account state, so do not deduct it again.
      const resultingAccountBalance = startingCash + netProceeds - debt - marginFee;
      return { ...s, gross, sellFee, carry, marginFee, net, netProceeds, debtRepaid, finalBalance, cashSurplus, resultingAccountBalance };
    });
    const best = rows.reduce((a, b) => b.net > a.net ? b : a, rows[0]);
    const dayLabel = (days: number) => days === 0 ? 'Today' : days + ' Days';
    const presets = rows.slice(0, -1).map((row, index) => ({
      label: dayLabel(row.days) + ' vs ' + dayLabel(rows[index + 1].days),
      columnIndexes: [index, index + 1]
    }));
    const modal: ScenarioModalData = {
      kind: 'exit-comparison',
      title: 'Exit Comparison · ' + sym,
      subtitle: shares.toLocaleString() + ' shares · estimated net result after fees',
      columns: rows.map(r => dayLabel(r.days) + ' · ' + money(r.price) + (r === best ? ' · BEST' : '')),
      presets,
      quickActions: [
        ...(rows.some(r => r.days === 7) ? [{ label: 'Switch to 7d', columnIndexes: [rows.findIndex(r => r.days === 7)] }] : []),
        ...(rows.some(r => r.days === 14) ? [{ label: 'Lock 14d Best', command: 'target ' + sym + ' ' + rows.find(r => r.days === 14)!.price.toFixed(2) }] : []),
        ...(rows.length > 1 ? [{ label: 'Invert Comparison', invert: true }] : [])
      ],
      action: { label: 'Stage target command', command: 'target ' + sym + ' ' + best.price.toFixed(2) },
      rows: [
        { label: 'Cost Basis', values: rows.map(() => money(costBasis)), kind: 'fee' },
        { label: 'Gross Proceeds', values: rows.map(r => money(r.gross)), kind: 'fee' },
        { label: 'Total Fee Friction', values: rows.map(r => money(buyCommission + r.sellFee + r.marginFee)), kind: 'fee' },
        {
          label: 'Net P&L',
          values: rows.map(r => signed(r.net)),
          deltas: rows.map(r => r === best ? 'BEST' : signed(r.net - best.net)),
          kind: 'result'
        },
        { label: 'Resulting Account Balance', values: rows.map(r => money(r.resultingAccountBalance)), kind: 'balance' }
      ],
      note: 'Total fee friction includes buy commission, sell commission, and estimated margin interest. Future prices are assumptions. The action stages a target-price command in the terminal; it does not submit a broker order.'
    };
    const text = [
      '[EXIT COMPARISON: ' + sym + ']',
      ...rows.map(r => r.label + ' · ' + money(r.price) + ' → ' + signed(r.net) + ' net P&L' + (r.net === best.net ? ' · BEST' : '')),
      'BEST: ' + best.label + ' at ' + money(best.price) + ' · ' + signed(best.net) + ' net',
      'Fees included: buy commission, sell commission, estimated margin interest.',
      'Estimate only · no portfolio changes.'
    ].join('\n');
    return { type: 'res', text, modal };
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
    const totalOutlay = purchaseValue + purchaseFee;
    const balance = Number(state.balance) || 0;
    const freeCash = Math.max(0, Number(state.cashCushion?.freeCash) || 0);
    const additionalDebt = Math.max(0, totalOutlay - freeCash);
    const balanceAfter = balance - additionalDebt;
    const currentDebt = Math.max(0, -balance);
    const dailyMarginBefore = currentDebt * rules.dailyRate;
    const dailyMarginAfter = Math.max(0, -balanceAfter) * rules.dailyRate;
    const dailyMarginFeeDifference = dailyMarginAfter - dailyMarginBefore;
    const newShares = oldShares + qty;
    const newCost = oldCost + purchaseValue;
    const newBuyFee = oldBuyFee + purchaseFee;
    const quote = Number(pos.currentPrice) > 0 ? Number(pos.currentPrice) : oldCost / oldShares;
    const oldAverage = oldCost / oldShares;
    const newAverage = newCost / newShares;
    const target = Number(pos.pt);
    const hasTarget = Number.isFinite(target) && target > 0;
    const downsidePrice = quote * 0.9;
    const currentMargin = calculateMarginInterest(pos.tranches || [], {
      dailyRate: rules.dailyRate, marginDebt: currentDebt, totalDebt: currentDebt
    } as any);
    const money = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
    const signed = (n: number) => (n > 0 ? '+$' : n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
    const scenarioPnl = (shares: number, cost: number, buyFee: number, exitPrice: number) =>
      shares * exitPrice - cost - buyFee -
      calculateCommission(shares, shares * exitPrice, rules as any) - currentMargin;
    const modal: ScenarioModalData = {
      kind: 'buy-more',
      title: 'Buy More Projection · ' + ticker,
      subtitle: 'Hypothetical projection after buying +' + qty.toLocaleString() + ' shares at ' + money(price) + ' · no order placed',
      columns: ['NOW Net', 'AFTER Net', 'NOW F&C', 'AFTER F&C', 'NOW M Fee', 'AFTER M Fee', 'NOW Balance', 'AFTER Balance'],
      rows: (() => {
        const projectionPrice = hasTarget ? target : quote;
        const dates = getUsEquityProjectionDates(new Date(), pos.startDate || state.startDate);
        const currentComms = oldBuyFee + calculateCommission(oldShares, oldShares * projectionPrice, rules as any);
        const projectedComms = newBuyFee + calculateCommission(newShares, newShares * projectionPrice, rules as any);
        const currentDebt = Math.max(0, -balance);
        const projectedDebt = Math.max(0, -balanceAfter);
        return dates.map(item => {
          const dateLabel = item.date.toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric'
          });
          const rowLabel = item.kind === 'today'
            ? dateLabel + ' · TODAY'
            : dateLabel + (item.label ? ' · ' + item.label.replace(/^\\(|\\)$/g, '') : '');
          if (item.kind === 'entry') {
            return { label: rowLabel, values: ['—', '—', '—', '—', '—', '—', '—', '—'], kind: 'fee' as const };
          }
          const currentDebtAtDate = calculateProjectedDebt(currentDebt, rules.dailyRate, item.daysFromToday);
          const afterDebtAtDate = calculateProjectedDebt(projectedDebt, rules.dailyRate, item.daysFromToday);
          const currentAccrual = currentDebtAtDate - currentDebt;
          const afterAccrual = afterDebtAtDate - projectedDebt;
          const currentFees = calculateAccruedFees(currentComms, currentMargin, currentAccrual);
          const afterFees = calculateAccruedFees(projectedComms, currentMargin, afterAccrual);
          const currentNet = oldShares * projectionPrice - oldCost - currentFees;
          const afterNet = newShares * projectionPrice - newCost - afterFees;
          return {
            label: rowLabel,
            values: [
              signed(currentNet),
              signed(afterNet),
              money(currentFees),
              money(afterFees),
              money(currentMargin + currentAccrual) + ' (' + money(currentDebtAtDate * rules.dailyRate) + ')',
              money(currentMargin + afterAccrual) + ' (' + money(afterDebtAtDate * rules.dailyRate) + ')',
              '−' + money(currentDebtAtDate),
              '−' + money(afterDebtAtDate)
            ],
            kind: item.kind === 'today' ? 'result' as const : 'fee' as const
          };
        });
      })(),
      note: 'Same projection schedule and columns as the main table, recalculated for the hypothetical post-purchase position at the target price (or current quote if no target is set). Fees include buy/sell commissions and accrued margin interest. No portfolio mutation or order placement occurs.'
    };
    const targetOldPnl = hasTarget ? scenarioPnl(oldShares, oldCost, oldBuyFee, target) : 0;
    const targetNewPnl = hasTarget ? scenarioPnl(newShares, newCost, newBuyFee, target) : 0;
    const currentDelta = scenarioPnl(newShares, newCost, newBuyFee, quote) - scenarioPnl(oldShares, oldCost, oldBuyFee, quote);
    const downsideDelta = scenarioPnl(newShares, newCost, newBuyFee, downsidePrice) - scenarioPnl(oldShares, oldCost, oldBuyFee, downsidePrice);
    const lines = [
      '[BUY MORE: ' + ticker + ']',
      'Cash needed: ' + money(totalOutlay) + ' incl. fee',
      'Average entry: ' + money(oldAverage) + ' → ' + money(newAverage),
      'Net P&L at quote: ' + signed(scenarioPnl(oldShares, oldCost, oldBuyFee, quote)) + ' → ' + signed(scenarioPnl(newShares, newCost, newBuyFee, quote)),
      ...(hasTarget ? ['Net P&L at target: ' + signed(targetOldPnl) + ' → ' + signed(targetNewPnl)] : []),
      'Net P&L at -10%: ' + signed(scenarioPnl(oldShares, oldCost, oldBuyFee, downsidePrice)) + ' → ' + signed(scenarioPnl(newShares, newCost, newBuyFee, downsidePrice)),
      'Final margin balance: ' + money(balance) + ' → ' + money(balanceAfter),
      'Extra margin cost: ' + money(dailyMarginFeeDifference) + '/day',
      'Trade-off: quote P&L changes by ' + signed(currentDelta) + '; downside P&L changes by ' + signed(downsideDelta) + '.',
      'Estimate only · no portfolio changes.'
    ];
    return { type: 'res', text: lines.join('\n'), modal };
  }



}
),
          type: 'res',
          sideEffect: { type: 'SYNC_CLOUD' }
        };
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

  private static evaluateExitScenarios(tickerArg: string | undefined, scenarios: Array<{ label: string; days: number; price: number }>): CommandOutput {
    const { sym, pos, state } = this.resolveActivePosition(tickerArg);
    const rules = this.getRules(state);
    const shares = Number(pos.shares);
    if (!Number.isFinite(shares) || shares <= 0) throw new Error('No valid open shares found for ' + sym + '.');

    const costBasis = (pos.tranches || []).reduce((sum: number, t: any) => sum + (Number(t.qty) || 0) * (Number(t.price) || 0), 0);
    const buyCommission = Math.max(0, Number(pos.commBuy) || 0);
    const balance = Number(state.balance) || 0;
    const startingCash = Number(state.cashBalance ?? state.cashCushion?.freeCash) || 0;
    const debt = Math.max(0, -balance);
    const currentMargin = calculateMarginInterest(pos.tranches || [], { dailyRate: rules.dailyRate, marginDebt: debt, totalDebt: debt } as any);
    const money = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
    const signed = (n: number) => (n > 0 ? '+$' : n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
    const rows = scenarios.map(s => {
      const gross = shares * s.price;
      const sellFee = calculateCommission(shares, gross, rules as any);
      const carry = debt * rules.dailyRate * s.days;
      const marginFee = currentMargin + carry;
      const net = gross - costBasis - buyCommission - sellFee - marginFee;
      const netProceeds = Math.max(0, gross - sellFee);
      const debtRepaid = Math.min(debt, netProceeds);
      const finalBalance = debt > 0 ? -(debt - debtRepaid) : balance;
      const cashSurplus = debt > 0 ? Math.max(0, netProceeds - debt) : netProceeds;
      // Project post-exit account equity from the actual current account state:
      // available cash + sale proceeds after sell commission - current margin debt
      // - estimated interest through the selected exit date. Buy commission is historical
      // and already reflected in the current account state, so do not deduct it again.
      const resultingAccountBalance = startingCash + netProceeds - debt - marginFee;
      return { ...s, gross, sellFee, carry, marginFee, net, netProceeds, debtRepaid, finalBalance, cashSurplus, resultingAccountBalance };
    });
    const best = rows.reduce((a, b) => b.net > a.net ? b : a, rows[0]);
    const dayLabel = (days: number) => days === 0 ? 'Today' : days + ' Days';
    const presets = rows.slice(0, -1).map((row, index) => ({
      label: dayLabel(row.days) + ' vs ' + dayLabel(rows[index + 1].days),
      columnIndexes: [index, index + 1]
    }));
    const modal: ScenarioModalData = {
      kind: 'exit-comparison',
      title: 'Exit Comparison · ' + sym,
      subtitle: shares.toLocaleString() + ' shares · estimated net result after fees',
      columns: rows.map(r => dayLabel(r.days) + ' · ' + money(r.price) + (r === best ? ' · BEST' : '')),
      presets,
      quickActions: [
        ...(rows.some(r => r.days === 7) ? [{ label: 'Switch to 7d', columnIndexes: [rows.findIndex(r => r.days === 7)] }] : []),
        ...(rows.some(r => r.days === 14) ? [{ label: 'Lock 14d Best', command: 'target ' + sym + ' ' + rows.find(r => r.days === 14)!.price.toFixed(2) }] : []),
        ...(rows.length > 1 ? [{ label: 'Invert Comparison', invert: true }] : [])
      ],
      action: { label: 'Stage target command', command: 'target ' + sym + ' ' + best.price.toFixed(2) },
      rows: [
        { label: 'Cost Basis', values: rows.map(() => money(costBasis)), kind: 'fee' },
        { label: 'Gross Proceeds', values: rows.map(r => money(r.gross)), kind: 'fee' },
        { label: 'Total Fee Friction', values: rows.map(r => money(buyCommission + r.sellFee + r.marginFee)), kind: 'fee' },
        {
          label: 'Net P&L',
          values: rows.map(r => signed(r.net)),
          deltas: rows.map(r => r === best ? 'BEST' : signed(r.net - best.net)),
          kind: 'result'
        },
        { label: 'Resulting Account Balance', values: rows.map(r => money(r.resultingAccountBalance)), kind: 'balance' }
      ],
      note: 'Total fee friction includes buy commission, sell commission, and estimated margin interest. Future prices are assumptions. The action stages a target-price command in the terminal; it does not submit a broker order.'
    };
    const text = [
      '[EXIT COMPARISON: ' + sym + ']',
      ...rows.map(r => r.label + ' · ' + money(r.price) + ' → ' + signed(r.net) + ' net P&L' + (r.net === best.net ? ' · BEST' : '')),
      'BEST: ' + best.label + ' at ' + money(best.price) + ' · ' + signed(best.net) + ' net',
      'Fees included: buy commission, sell commission, estimated margin interest.',
      'Estimate only · no portfolio changes.'
    ].join('\n');
    return { type: 'res', text, modal };
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
    const totalOutlay = purchaseValue + purchaseFee;
    const balance = Number(state.balance) || 0;
    const freeCash = Math.max(0, Number(state.cashCushion?.freeCash) || 0);
    const additionalDebt = Math.max(0, totalOutlay - freeCash);
    const balanceAfter = balance - additionalDebt;
    const currentDebt = Math.max(0, -balance);
    const dailyMarginBefore = currentDebt * rules.dailyRate;
    const dailyMarginAfter = Math.max(0, -balanceAfter) * rules.dailyRate;
    const dailyMarginFeeDifference = dailyMarginAfter - dailyMarginBefore;
    const newShares = oldShares + qty;
    const newCost = oldCost + purchaseValue;
    const newBuyFee = oldBuyFee + purchaseFee;
    const quote = Number(pos.currentPrice) > 0 ? Number(pos.currentPrice) : oldCost / oldShares;
    const oldAverage = oldCost / oldShares;
    const newAverage = newCost / newShares;
    const target = Number(pos.pt);
    const hasTarget = Number.isFinite(target) && target > 0;
    const downsidePrice = quote * 0.9;
    const currentMargin = calculateMarginInterest(pos.tranches || [], {
      dailyRate: rules.dailyRate, marginDebt: currentDebt, totalDebt: currentDebt
    } as any);
    const money = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
    const signed = (n: number) => (n > 0 ? '+$' : n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
    const scenarioPnl = (shares: number, cost: number, buyFee: number, exitPrice: number) =>
      shares * exitPrice - cost - buyFee -
      calculateCommission(shares, shares * exitPrice, rules as any) - currentMargin;
    const modal: ScenarioModalData = {
      kind: 'buy-more',
      title: 'Buy More Projection · ' + ticker,
      subtitle: 'Hypothetical projection after buying +' + qty.toLocaleString() + ' shares at ' + money(price) + ' · no order placed',
      columns: ['NOW Net', 'AFTER Net', 'NOW F&C', 'AFTER F&C', 'NOW M Fee', 'AFTER M Fee', 'NOW Balance', 'AFTER Balance'],
      rows: (() => {
        const projectionPrice = hasTarget ? target : quote;
        const dates = getUsEquityProjectionDates(new Date(), pos.startDate || state.startDate);
        const currentComms = oldBuyFee + calculateCommission(oldShares, oldShares * projectionPrice, rules as any);
        const projectedComms = newBuyFee + calculateCommission(newShares, newShares * projectionPrice, rules as any);
        const currentDebt = Math.max(0, -balance);
        const projectedDebt = Math.max(0, -balanceAfter);
        return dates.map(item => {
          const dateLabel = item.date.toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric'
          });
          const rowLabel = item.kind === 'today'
            ? dateLabel + ' · TODAY'
            : dateLabel + (item.label ? ' · ' + item.label.replace(/^\\(|\\)$/g, '') : '');
          if (item.kind === 'entry') {
            return { label: rowLabel, values: ['—', '—', '—', '—', '—', '—', '—', '—'], kind: 'fee' as const };
          }
          const currentDebtAtDate = calculateProjectedDebt(currentDebt, rules.dailyRate, item.daysFromToday);
          const afterDebtAtDate = calculateProjectedDebt(projectedDebt, rules.dailyRate, item.daysFromToday);
          const currentAccrual = currentDebtAtDate - currentDebt;
          const afterAccrual = afterDebtAtDate - projectedDebt;
          const currentFees = calculateAccruedFees(currentComms, currentMargin, currentAccrual);
          const afterFees = calculateAccruedFees(projectedComms, currentMargin, afterAccrual);
          const currentNet = oldShares * projectionPrice - oldCost - currentFees;
          const afterNet = newShares * projectionPrice - newCost - afterFees;
          return {
            label: rowLabel,
            values: [
              signed(currentNet),
              signed(afterNet),
              money(currentFees),
              money(afterFees),
              money(currentMargin + currentAccrual) + ' (' + money(currentDebtAtDate * rules.dailyRate) + ')',
              money(currentMargin + afterAccrual) + ' (' + money(afterDebtAtDate * rules.dailyRate) + ')',
              '−' + money(currentDebtAtDate),
              '−' + money(afterDebtAtDate)
            ],
            kind: item.kind === 'today' ? 'result' as const : 'fee' as const
          };
        });
      })(),
      note: 'Same projection schedule and columns as the main table, recalculated for the hypothetical post-purchase position at the target price (or current quote if no target is set). Fees include buy/sell commissions and accrued margin interest. No portfolio mutation or order placement occurs.'
    };
    const targetOldPnl = hasTarget ? scenarioPnl(oldShares, oldCost, oldBuyFee, target) : 0;
    const targetNewPnl = hasTarget ? scenarioPnl(newShares, newCost, newBuyFee, target) : 0;
    const currentDelta = scenarioPnl(newShares, newCost, newBuyFee, quote) - scenarioPnl(oldShares, oldCost, oldBuyFee, quote);
    const downsideDelta = scenarioPnl(newShares, newCost, newBuyFee, downsidePrice) - scenarioPnl(oldShares, oldCost, oldBuyFee, downsidePrice);
    const lines = [
      '[BUY MORE: ' + ticker + ']',
      'Cash needed: ' + money(totalOutlay) + ' incl. fee',
      'Average entry: ' + money(oldAverage) + ' → ' + money(newAverage),
      'Net P&L at quote: ' + signed(scenarioPnl(oldShares, oldCost, oldBuyFee, quote)) + ' → ' + signed(scenarioPnl(newShares, newCost, newBuyFee, quote)),
      ...(hasTarget ? ['Net P&L at target: ' + signed(targetOldPnl) + ' → ' + signed(targetNewPnl)] : []),
      'Net P&L at -10%: ' + signed(scenarioPnl(oldShares, oldCost, oldBuyFee, downsidePrice)) + ' → ' + signed(scenarioPnl(newShares, newCost, newBuyFee, downsidePrice)),
      'Final margin balance: ' + money(balance) + ' → ' + money(balanceAfter),
      'Extra margin cost: ' + money(dailyMarginFeeDifference) + '/day',
      'Trade-off: quote P&L changes by ' + signed(currentDelta) + '; downside P&L changes by ' + signed(downsideDelta) + '.',
      'Estimate only · no portfolio changes.'
    ];
    return { type: 'res', text: lines.join('\n'), modal };
  }



}
