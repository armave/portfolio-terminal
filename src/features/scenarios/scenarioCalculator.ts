import { portfolioStore } from '../../store/portfolioStore';
import { getAppLanguage } from '../../services/i18n';
import { calculateAccruedFees, calculateCommission, calculateMarginInterest, calculateProjectedDebt, resolveCommissionConfig } from '../../domain/portfolio';
import { calculateSaleAccounting, calculateSaleCommission } from '../../domain/portfolioTransactions';
import { validateSaleCostBasisTranches } from '../../domain/saleCostBasis';
import { getUsEquityProjectionDates } from '../../domain/tradingCalendar';
import { calculatePortfolioValuation } from '../../domain/portfolioValuation';
import type { ScenarioModalData } from './scenarioContracts';

const BUY_MORE_MIN_EQUITY_RATIO = 0.20;
const BUY_MORE_MAINTENANCE_RESERVE_RATIO = 0.10;

export interface ScenarioCalculationOutput {
  text: string;
  type: 'res' | 'err';
  modal?: ScenarioModalData;
  maxSafeShares?: number;
  requiredEquityRatio?: number;
  projectedEquityRatio?: number;
}

export class ScenarioCalculator {
  static previewExitComparison(
    tickerArg: string,
    scenarios: Array<{ label: string; days: number; price: number }>
  ): ScenarioCalculationOutput {
    if (!tickerArg || !/^[A-Z0-9.-]{1,16}$/i.test(tickerArg) || scenarios.length !== 2 ||
      scenarios.some((scenario) => !Number.isInteger(scenario.days) || scenario.days < 0 || scenario.days > 3650 ||
        !Number.isFinite(scenario.price) || scenario.price <= 0)) {
      return { type: 'err', text: 'Enter a valid positive price and exit date for both periods.' };
    }
    try {
      return this.evaluateExitScenarios(tickerArg.toUpperCase(), scenarios);
    } catch (error) {
      return {
        type: 'err',
        text: error instanceof Error ? error.message : 'Exit comparison could not be calculated.'
      };
    }
  }

  /** Read-only entry point for the Market Tools buy-more calculator. */

  static previewBuyMoreScenario(tickerArg: string, shares: number, price: number): ScenarioCalculationOutput {
    if (!tickerArg || !/^[A-Z0-9.-]{1,16}$/i.test(tickerArg) ||
      !Number.isFinite(shares) || shares <= 0 ||
      !Number.isFinite(price) || price <= 0 ||
      !Number.isFinite(shares * price)) {
      return { type: 'err', text: 'Enter a valid position, positive share amount and purchase price.' };
    }
    try {
      return this.evaluateBuyScenario(shares, tickerArg.toUpperCase(), price);
    } catch (error) {
      return {
        type: 'err',
        text: error instanceof Error ? error.message : 'Buy More could not be calculated.'
      };
    }
  }

  private static resolveActivePosition(tickerArg?: string) {
    const state = portfolioStore.getState();
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

  private static getRules(state: ReturnType<typeof portfolioStore.getState>) {
    const assumptions = state.brokerAssumptions;
    return {
      ...resolveCommissionConfig(assumptions),
      dailyRate: assumptions.annualBorrowRate / assumptions.dayCountBasis
    };
  }

  private static evaluateExitScenarios(tickerArg: string | undefined, scenarios: Array<{ label: string; days: number; price: number }>): ScenarioCalculationOutput {
    const { sym, pos, state } = this.resolveActivePosition(tickerArg);
    const rules = this.getRules(state);
    const shares = Number(pos.shares);
    if (!Number.isFinite(shares) || shares <= 0) throw new Error('No valid open shares found for ' + sym + '.');

    const validatedCostBasis = validateSaleCostBasisTranches(
      pos.tranches || [],
      shares,
      Number(pos.commBuy ?? 0),
      sym
    );
    const costBasis = validatedCostBasis.totalCostBasis;
    const buyCommission = validatedCostBasis.aggregateBuyCommission;
    const signedBalance = Number(state.balance ?? 0);
    if (!Number.isFinite(signedBalance)) throw new Error('The account margin balance is unavailable for this estimate.');
    const debt = Math.abs(signedBalance);
    const rawFreeCash = Number(state.cashCushion?.freeCash ?? state.cashBalance ?? 0);
    if (!Number.isFinite(rawFreeCash) || rawFreeCash < 0) throw new Error('The available cash balance is invalid.');
    const startingCash = rawFreeCash;
    if (!Number.isFinite(rules.dailyRate) || rules.dailyRate < 0) {
      throw new Error('The broker margin rate is invalid. Review broker assumptions before comparing exits.');
    }

    // Match the position-level financing allocation used by calculateSaleAccounting:
    // each open position receives its cost-basis share of the account's total margin debt.
    const totalPortfolioInvested = Object.entries(state.positions || {}).reduce((total, [ticker, portfolioPosition]) => {
      const tranches = portfolioPosition?.tranches;
      if (tranches === undefined || tranches === null) return total;
      if (!Array.isArray(tranches)) throw new Error('Portfolio position ' + ticker + ' tranches must be an array.');
      const invested = tranches.reduce((subtotal, tranche, index) => {
        if (!tranche || typeof tranche !== 'object' || Array.isArray(tranche)) {
          throw new Error('Portfolio position ' + ticker + ' tranche ' + (index + 1) + ' is invalid.');
        }
        const lot = tranche as unknown as Record<string, unknown>;
        const readPositiveAlias = (values: unknown[], label: string): number => {
          for (const value of values) {
            if (value === undefined || value === null || value === '') continue;
            const parsed = Number(value);
            if (Number.isFinite(parsed) && parsed > 0) return parsed;
          }
          throw new Error('Portfolio position ' + ticker + ' has an invalid tranche ' + label + '.');
        };
        const quantity = readPositiveAlias([lot.qty, lot.shares, lot.quantity], 'quantity');
        const entryPrice = readPositiveAlias([lot.price, lot.entryPrice, lot.averagePrice], 'entry price');
        const value = quantity * entryPrice;
        if (!Number.isFinite(value) || !Number.isFinite(subtotal + value)) {
          throw new Error('Portfolio position ' + ticker + ' investment value is invalid.');
        }
        return subtotal + value;
      }, 0);
      if (!Number.isFinite(total + invested)) throw new Error('Total portfolio investment is invalid.');
      return total + invested;
    }, 0);
    const positionWeight = totalPortfolioInvested > 0
      ? Math.min(1, costBasis / totalPortfolioInvested)
      : 1;

    const dollar = String.fromCharCode(36);
    const money = (n: number) => (n < 0 ? '-' : '') + dollar + Math.abs(n).toFixed(2);
    const signed = (n: number) => (n > 0 ? '+' : n < 0 ? '-' : '') + dollar + Math.abs(n).toFixed(2);
    const rows = scenarios.map(s => {
      const gross = shares * s.price;
      const sellFee = calculateSaleCommission(shares, gross, state.brokerAssumptions);
      const accounting = calculateSaleAccounting({
        tranches: validatedCostBasis.tranches,
        positions: state.positions,
        positionShares: shares,
        sharesSold: shares,
        balance: signedBalance,
        brokerAssumptions: state.brokerAssumptions,
        positionMarginCharged: pos.marginCharged,
        sellProceeds: gross,
        soldCostBasis: costBasis,
        buyCommissionAllocated: buyCommission,
        sellCommission: sellFee
      });
      // The live margin ledger compounds the whole account debt daily and rounds each
      // rollover to cents. Allocate that projected increase to this ticker by the same
      // cost-basis weight used by realized-sale accounting.
      const projectedDebt = calculateProjectedDebt(debt, rules.dailyRate, s.days);
      const portfolioCarry = Math.max(0, projectedDebt - debt);
      const carry = Number((portfolioCarry * positionWeight).toFixed(2));
      const marginFee = Number((accounting.marginInterestAllocated + carry).toFixed(2));
      const net = Number((accounting.netProfit - carry).toFixed(2));
      // Current accrued interest is already reflected in the signed account balance.
      // Only future interest changes projected debt; do not deduct historical charges twice.
      const resultingAccountBalance = Number((startingCash + accounting.netCashProceeds - projectedDebt).toFixed(2));
      const totalFeeFriction = Number((accounting.totalCommissions + marginFee).toFixed(2));
      return { ...s, gross, sellFee, carry, marginFee, totalFeeFriction, net, netProceeds: accounting.netCashProceeds, projectedDebt, resultingAccountBalance };
    });
    const best = rows.reduce((a, b) => b.net > a.net ? b : a, rows[0]);
    const dayLabel = (days: number) => days === 0 ? 'Today' : days + ' Days';
    const modal: ScenarioModalData = {
      kind: 'exit-comparison',
      title: 'Exit Comparison · ' + sym,
      subtitle: shares.toLocaleString() + ' shares · estimated net result after fees',
      columns: rows.map(r => dayLabel(r.days) + ' · ' + money(r.price) + (r === best ? ' · BEST' : '')),
      rows: [
        { label: 'Cost Basis', values: rows.map(() => money(costBasis)), kind: 'fee' },
        { label: 'Gross Proceeds', values: rows.map(r => money(r.gross)), kind: 'fee' },
        { label: 'Total Fee Friction', values: rows.map(r => money(r.totalFeeFriction)), kind: 'fee' },
        {
          label: 'Net P&L',
          values: rows.map(r => signed(r.net)),
          deltas: rows.map(r => r === best ? 'BEST' : signed(r.net - best.net)),
          kind: 'result'
        },
        { label: 'Resulting Account Balance', values: rows.map(r => money(r.resultingAccountBalance)), kind: 'balance' }
      ],
      note: 'Total fee friction includes buy commission, sell commission, and estimated margin interest. Future prices are assumptions. This is an estimate only; no order is placed and portfolio data is not changed.'
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

  private static evaluateBuyScenario(qty: number, ticker: string, price: number): ScenarioCalculationOutput {
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
      throw new Error('Usage: buy scenario <shares> <ticker> at <price>.');
    }
    const state = portfolioStore.getState();
    const pos = state.positions?.[ticker];
    if (!pos || !(Number(pos.shares) > 0)) {
      throw new Error('No open position found for ' + ticker + '. Buy scenarios require an existing position.');
    }

    const rules = this.getRules(state);
    const oldShares = Number(pos.shares);
    const oldCost = (pos.tranches || []).reduce(
      (sum, tranche) => sum + (Number(tranche.qty) || 0) * (Number(tranche.price) || 0), 0
    );
    const oldBuyFee = Math.max(0, Number(pos.commBuy) || 0);
    const quote = Number(pos.currentPrice) > 0 ? Number(pos.currentPrice) : oldCost / oldShares;
    const purchaseValue = qty * price;
    const purchaseFee = calculateCommission(qty, purchaseValue, rules);
    const totalOutlay = purchaseValue + purchaseFee;
    const balance = Number(state.balance);
    const freeCash = Number(state.cashCushion?.freeCash ?? 0);
    if (!Number.isFinite(balance) || !Number.isFinite(freeCash) || freeCash < 0) {
      throw new Error('Buy scenario blocked: account cash and margin inputs are incomplete or invalid. Refresh the portfolio and review broker assumptions before comparing.');
    }
    if (!Number.isFinite(rules.dailyRate) || rules.dailyRate < 0 ||
        !Number.isFinite(state.brokerAssumptions.maintenanceEquityRatio) ||
        state.brokerAssumptions.maintenanceEquityRatio <= 0 ||
        state.brokerAssumptions.maintenanceEquityRatio >= 1 ||
        !Number.isFinite(state.brokerAssumptions.stopOutRatio) ||
        state.brokerAssumptions.stopOutRatio < 0 ||
        state.brokerAssumptions.stopOutRatio > state.brokerAssumptions.maintenanceEquityRatio) {
      throw new Error('Buy scenario blocked: broker margin limits are unavailable or invalid. Review broker assumptions before comparing.');
    }
    // Keep the projection on the same account-wide basis as calculateMarginRiskSnapshot:
    // signed broker cash/debt + free cash + all margin and cash-cushion holdings.
    const valuation = calculatePortfolioValuation({
      signedAccountBalance: balance,
      freeCash,
      marginPositions: Object.values(state.positions || {}),
      cashHoldings: state.cashCushion?.holdings || []
    });
    if (!valuation.accountBalanceAvailable ||
        ![valuation.cashBalance, valuation.marginDebt, valuation.totalHoldingsValue].every(Number.isFinite)) {
      throw new Error('Buy scenario blocked: the account equity inputs are unavailable. Refresh the portfolio balance before comparing.');
    }
    if (valuation.unpricedHoldings > 0) {
      throw new Error('Buy scenario blocked: portfolio market valuation is incomplete. Refresh quotes for all margin and cash-cushion holdings before comparing.');
    }

    const maintenanceLimit = state.brokerAssumptions.maintenanceEquityRatio;
    const stopOutLimit = state.brokerAssumptions.stopOutRatio;
    // Maintenance is a liquidation-risk boundary, not a prudent buy-more target.
    // Keep at least a 10 percentage-point cushion and never plan below 20% equity.
    // This is an app-side planning guard, not broker-reported buying power.
    const requiredEquityRatio = Math.max(BUY_MORE_MIN_EQUITY_RATIO, maintenanceLimit + BUY_MORE_MAINTENANCE_RESERVE_RATIO);
    const projectPurchase = (sharesToBuy: number) => {
      const orderValue = sharesToBuy * price;
      const commission = calculateCommission(sharesToBuy, orderValue, rules);
      const outlay = orderValue + commission;
      const freeCashUsed = Math.min(freeCash, outlay);
      const remainingOutlay = outlay - freeCashUsed;
      // Free cash is consumed first; any remainder changes the signed broker cash
      // balance, increasing margin debt only after positive broker cash is exhausted.
      const projectedBalance = balance - remainingOutlay;
      const cashUsed = Math.min(valuation.cashBalance, outlay);
      const projectedDebt = Math.max(0, -projectedBalance);
      const projectedAssets = valuation.totalHoldingsValue + valuation.cashBalance - cashUsed + sharesToBuy * quote;
      const projectedEquity = projectedAssets - projectedDebt;
      const equityRatio = projectedAssets > 0 ? projectedEquity / projectedAssets : -Infinity;
      return { projectedBalance, equityRatio };
    };
    const projected = projectPurchase(qty);
    const projectedEquityRatio = projected.equityRatio;

    const calculateMaximumSafeShares = (): number => {
      if (requiredEquityRatio >= 1 || projectPurchase(0).equityRatio <= requiredEquityRatio) return 0;
      let low = 0;
      let high = Math.max(1, qty);
      while (high < 1_000_000_000 && projectPurchase(high).equityRatio > requiredEquityRatio) {
        low = high;
        high *= 2;
      }
      for (let iteration = 0; iteration < 56; iteration += 1) {
        const middle = (low + high) / 2;
        if (projectPurchase(middle).equityRatio > requiredEquityRatio) low = middle;
        else high = middle;
      }
      return Math.floor(low * 1_000_000) / 1_000_000;
    };

    if (!Number.isFinite(projectedEquityRatio) || projectedEquityRatio <= requiredEquityRatio ||
        projectedEquityRatio <= stopOutLimit) {
      const maxSafeShares = calculateMaximumSafeShares();
      return {
        type: 'err',
        maxSafeShares,
        requiredEquityRatio,
        projectedEquityRatio,
        text:
          'Buy scenario blocked: this purchase would leave projected account equity at ' +
          (Number.isFinite(projectedEquityRatio) ? (projectedEquityRatio * 100).toFixed(1) : 'unavailable') +
          '%, below the app planning floor of ' + (requiredEquityRatio * 100).toFixed(1) +
          '% (broker maintenance limit: ' + (maintenanceLimit * 100).toFixed(1) +
          '%). Maximum additional shares at $' + price.toFixed(2) + ': ' +
          maxSafeShares.toLocaleString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 6 }) +
          '. The planning floor is a conservative app-side buffer, not the broker’s official buying-power limit. Reduce shares, lower the price, or add cash before comparing.'
      };
    }
    const balanceAfter = projected.projectedBalance;
    const currentDebt = Math.max(0, -balance);
    const dailyMarginBefore = currentDebt * rules.dailyRate;
    const dailyMarginAfter = Math.max(0, -balanceAfter) * rules.dailyRate;
    const dailyMarginFeeDifference = dailyMarginAfter - dailyMarginBefore;
    const newShares = oldShares + qty;
    const newCost = oldCost + purchaseValue;
    const newBuyFee = oldBuyFee + purchaseFee;
    const oldAverage = oldCost / oldShares;
    const newAverage = newCost / newShares;
    const target = Number(pos.pt);
    const hasTarget = Number.isFinite(target) && target > 0;
    const downsidePrice = quote * 0.9;
    const currentMargin = calculateMarginInterest(pos.tranches || [], {
      dailyRate: rules.dailyRate, marginDebt: currentDebt, totalDebt: currentDebt
    });
    const money = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
    const signed = (n: number) => (n > 0 ? '+$' : n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
    const scenarioPnl = (shares: number, cost: number, buyFee: number, exitPrice: number) =>
      shares * exitPrice - cost - buyFee -
      calculateCommission(shares, shares * exitPrice, rules) - currentMargin;
    const modal: ScenarioModalData = {
      kind: 'buy-more',
      title: 'Buy More Projection · ' + ticker,
      subtitle: 'Hypothetical projection after buying +' + qty.toLocaleString() + ' shares at ' + money(price) + ' · no order placed',
      columns: ['NOW Net', 'AFTER Net', 'NOW F&C', 'AFTER F&C', 'NOW M Fee', 'AFTER M Fee', 'NOW Balance', 'AFTER Balance'],
      rows: (() => {
        const projectionPrice = hasTarget ? target : quote;
        const dates = getUsEquityProjectionDates(new Date(), pos.startDate || state.startDate);
        const currentComms = oldBuyFee + calculateCommission(oldShares, oldShares * projectionPrice, rules);
        const projectedComms = newBuyFee + calculateCommission(newShares, newShares * projectionPrice, rules);
        const currentDebt = Math.max(0, -balance);
        const projectedDebt = Math.max(0, -balanceAfter);
        return dates.map(item => {
          const dateLabel = item.date.toLocaleDateString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', {
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