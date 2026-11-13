import { portfolioStore } from '../../store/portfolioStore';
import { getAppLanguage } from '../../services/i18n';
import { calculateAccruedFees, calculateCommission, calculateMarginInterest, calculateProjectedAccountBalanceAfterSale, calculateProjectedDebt, resolveCommissionConfig } from '../../domain/portfolio';
import { calculateSaleAccounting, calculateSaleCommission } from '../../domain/portfolioTransactions';
import { validateSaleCostBasisTranches } from '../../domain/saleCostBasis';
import { getUsEquityProjectionDates } from '../../domain/tradingCalendar';
import { calculatePortfolioValuation } from '../../domain/portfolioValuation';
import { calculatePositionMetrics, getTotalPortfolioInvested } from '../../domain/portfolioSelectors';
import type { ScenarioModalData } from './scenarioContracts';
import {
  resolveBuyQuantityConstraint,
  resolveLongExitQuantityConstraint,
  type BrokerQuantityLimit
} from '../../domain/brokerScenarioLimits';

const BUY_MORE_MIN_EQUITY_RATIO = 0.20;
const BUY_MORE_MAINTENANCE_RESERVE_RATIO = 0.10;

export interface ScenarioCalculationOutput {
  text: string;
  type: 'res' | 'err';
  modal?: ScenarioModalData;
  maxSafeShares?: number;
  requiredEquityRatio?: number;
  projectedEquityRatio?: number;
  brokerMaximumShares?: number | null;
  brokerLimitStatus?: 'current' | 'stale' | 'unavailable' | 'malformed';
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

  static previewBuyMoreScenario(
    tickerArg: string, shares: number, price: number, projectionPrice?: number,
    brokerLimits?: { accountMaximum: BrokerQuantityLimit; instrumentMaximum: BrokerQuantityLimit }
  ): ScenarioCalculationOutput {
    if (!tickerArg || !/^[A-Z0-9.-]{1,16}$/i.test(tickerArg) ||
      !Number.isFinite(shares) || shares <= 0 ||
      !Number.isFinite(price) || price <= 0 ||
      !Number.isFinite(shares * price) ||
      (projectionPrice !== undefined && (!Number.isFinite(projectionPrice) || projectionPrice <= 0))) {
      return { type: 'err', text: 'Enter a valid position, positive share amount and purchase price.' };
    }
    try {
      return this.evaluateBuyScenario(shares, tickerArg.toUpperCase(), price, projectionPrice, brokerLimits);
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
    const brokerConstraint = brokerLimits
      ? resolveLongExitQuantityConstraint({
          requestedQuantity: shares,
          localMaximum: shares,
          accountMaximum: brokerLimits.accountMaximum,
          instrumentMaximum: brokerLimits.instrumentMaximum,
          heldLongQuantity: shares
        })
      : null;
    if (brokerConstraint && !brokerConstraint.allowed) {
      return {
        type: 'err',
        brokerMaximumShares: brokerConstraint.effectiveMaximum,
        brokerLimitStatus: brokerConstraint.freshness,
        text: brokerConstraint.effectiveMaximum === null
          ? 'Exit scenario blocked: current broker account and instrument sell limits could not both be verified.'
          : 'Exit scenario blocked: the broker reports a maximum sellable quantity of ' +
            brokerConstraint.effectiveMaximum.toLocaleString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 6 }) +
            ' shares, below the full position of ' + shares.toLocaleString() + '. A full close-out cannot be assumed.'
      };
    }
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
    const debt = Math.max(0, -signedBalance);
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
      const resultingAccountBalance = calculateProjectedAccountBalanceAfterSale(
        signedBalance, startingCash, accounting.netCashProceeds, rules.dailyRate, s.days
      );
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

  private static evaluateBuyScenario(
    qty: number, ticker: string, price: number, projectionPriceOverride?: number,
    brokerLimits?: { accountMaximum: BrokerQuantityLimit; instrumentMaximum: BrokerQuantityLimit }
  ): ScenarioCalculationOutput {
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
    const freeCash = Number(state.cashCushion?.freeCash ?? state.cashBalance ?? 0);
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
    const localMaximumShares = calculateMaximumSafeShares();
    const brokerConstraint = brokerLimits
      ? resolveBuyQuantityConstraint({
          requestedQuantity: qty,
          localMaximum: localMaximumShares,
          accountMaximum: brokerLimits.accountMaximum,
          instrumentMaximum: brokerLimits.instrumentMaximum
        })
      : null;
    if (brokerConstraint && !brokerConstraint.allowed) {
      return {
        type: 'err',
        maxSafeShares: brokerConstraint.effectiveMaximum ?? undefined,
        brokerMaximumShares: brokerConstraint.effectiveMaximum,
        brokerLimitStatus: brokerConstraint.freshness,
        requiredEquityRatio,
        projectedEquityRatio,
        text: brokerConstraint.effectiveMaximum === null
          ? 'Buy scenario blocked: current broker account and instrument limits could not both be verified. Refresh broker account limits before using this scenario.'
          : 'Buy scenario blocked: requested quantity exceeds the broker-constrained maximum of ' +
            brokerConstraint.effectiveMaximum.toLocaleString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 6 }) +
            ' shares. Broker limits are estimates, not execution guarantees.'
      };
    }
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
    const freeCashUsedForPurchase = Math.min(freeCash, totalOutlay);
    const remainingFreeCashAfterPurchase = Math.max(0, freeCash - freeCashUsedForPurchase);
    const currentDebt = Math.max(0, -balance);
    const currentPositionMetrics = calculatePositionMetrics(state, pos, state.brokerAssumptions, rules.dailyRate);
    const currentAllocatedDebt = currentPositionMetrics.allocatedDebt;
    const dailyMarginBefore = currentDebt * rules.dailyRate;
    const dailyMarginAfter = Math.max(0, -balanceAfter) * rules.dailyRate;
    const dailyMarginFeeDifference = dailyMarginAfter - dailyMarginBefore;
    const newShares = oldShares + qty;
    const newCost = oldCost + purchaseValue;
    const newBuyFee = oldBuyFee + purchaseFee;
    const portfolioInvestedAfter = getTotalPortfolioInvested(state) + purchaseValue;
    const afterAllocatedDebt = Math.max(0, -balanceAfter) *
      (portfolioInvestedAfter > 0 ? newCost / portfolioInvestedAfter : 1);
    // New shares have no accrued holding-period interest yet. Recalculate existing
    // tranches using the selected position's new share of total portfolio debt.
    const afterMargin = calculateMarginInterest(pos.tranches || [], {
      dailyRate: rules.dailyRate,
      marginUtilizationRatio: newCost > 0 ? afterAllocatedDebt / newCost : 0
    });
    const oldAverage = oldCost / oldShares;
    const newAverage = newCost / newShares;
    const target = Number(pos.pt);
    const hasTarget = Number.isFinite(target) && target > 0;
    const projectionPrice = projectionPriceOverride ?? (hasTarget ? target : quote);
    const downsidePrice = quote * 0.9;
    const currentMargin = currentPositionMetrics.posMarginCharged;
    const money = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
    const signed = (n: number) => (n > 0 ? '+$' : n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
    const scenarioPnl = (
      shares: number, cost: number, buyFee: number, exitPrice: number, marginCharged: number
    ) => shares * exitPrice - cost - buyFee -
      calculateCommission(shares, shares * exitPrice, rules) - marginCharged;
    const modal: ScenarioModalData = {
      kind: 'buy-more',
      title: 'Buy More Projection · ' + ticker,
      subtitle: 'Hypothetical projection after buying +' + qty.toLocaleString() + ' shares at ' + money(price) + ' · no order placed',
      columns: ['NOW Net', 'AFTER Net', 'NOW F&C', 'AFTER F&C', 'NOW Balance', 'AFTER Balance'],
      rows: (() => {
        const dates = getUsEquityProjectionDates(new Date(), pos.startDate || state.startDate);
        const currentComms = oldBuyFee + calculateCommission(oldShares, oldShares * projectionPrice, rules);
        const projectedComms = newBuyFee + calculateCommission(newShares, newShares * projectionPrice, rules);
        const currentSaleGross = oldShares * projectionPrice;
        const afterSaleGross = newShares * projectionPrice;
        const currentNetSaleProceeds = currentSaleGross - calculateSaleCommission(oldShares, currentSaleGross, state.brokerAssumptions);
        const afterNetSaleProceeds = afterSaleGross - calculateSaleCommission(newShares, afterSaleGross, state.brokerAssumptions);
        const feesWithDailyMargin = (fees: number, dailyMargin: number) =>
          money(fees) + ' {' + money(dailyMargin) + '/day}';
        return dates.map(item => {
          const dateLabel = item.date.toLocaleDateString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', {
            weekday: 'short', month: 'short', day: 'numeric'
          });
          const rowLabel = item.kind === 'today'
            ? dateLabel + ' · TODAY'
            : dateLabel + (item.label ? ' · ' + item.label.replace(/^\\(|\\)$/g, '') : '');
          if (item.kind === 'entry') {
            return { label: rowLabel, values: ['—', '—', '—', '—', '—', '—'], kind: 'fee' as const };
          }
          const currentDebtAtDate = calculateProjectedDebt(currentAllocatedDebt, rules.dailyRate, item.daysFromToday);
          const afterDebtAtDate = calculateProjectedDebt(afterAllocatedDebt, rules.dailyRate, item.daysFromToday);
          const currentAccrual = currentDebtAtDate - currentAllocatedDebt;
          const afterAccrual = afterDebtAtDate - afterAllocatedDebt;
          const currentFees = calculateAccruedFees(currentComms, currentMargin, currentAccrual);
          const afterFees = calculateAccruedFees(projectedComms, afterMargin, afterAccrual);
          const currentNet = oldShares * projectionPrice - oldCost - currentFees;
          const afterNet = newShares * projectionPrice - newCost - afterFees;
          return {
            label: rowLabel,
            values: [
              signed(currentNet),
              signed(afterNet),
              feesWithDailyMargin(currentFees, currentDebtAtDate * rules.dailyRate),
              feesWithDailyMargin(afterFees, afterDebtAtDate * rules.dailyRate),
              money(calculateProjectedAccountBalanceAfterSale(
                balance, freeCash, currentNetSaleProceeds, rules.dailyRate, item.daysFromToday
              )),
              money(calculateProjectedAccountBalanceAfterSale(
                balanceAfter, remainingFreeCashAfterPurchase, afterNetSaleProceeds, rules.dailyRate, item.daysFromToday
              ))
            ],
            kind: item.kind === 'today' ? 'result' as const : 'fee' as const
          };
        });
      })(),
      note: 'Same projection schedule and columns as the main table, recalculated for the hypothetical post-purchase position at the selected projection price. Fees include buy/sell commissions and accrued margin interest; daily margin interest is shown in braces. Balance shows account cash after selling the position, net of sell commission and projected margin interest. No portfolio mutation or order placement occurs.'
    };
    const projectionOldPnl = scenarioPnl(oldShares, oldCost, oldBuyFee, projectionPrice, currentMargin);
    const projectionNewPnl = scenarioPnl(newShares, newCost, newBuyFee, projectionPrice, afterMargin);
    const currentDelta = scenarioPnl(newShares, newCost, newBuyFee, quote, afterMargin) -
      scenarioPnl(oldShares, oldCost, oldBuyFee, quote, currentMargin);
    const downsideDelta = scenarioPnl(newShares, newCost, newBuyFee, downsidePrice, afterMargin) -
      scenarioPnl(oldShares, oldCost, oldBuyFee, downsidePrice, currentMargin);
    const lines = [
      '[BUY MORE: ' + ticker + ']',
      'Cash needed: ' + money(totalOutlay) + ' incl. fee',
      'Average entry: ' + money(oldAverage) + ' → ' + money(newAverage),
      'Net P&L at quote: ' + signed(scenarioPnl(oldShares, oldCost, oldBuyFee, quote, currentMargin)) + ' → ' + signed(scenarioPnl(newShares, newCost, newBuyFee, quote, afterMargin)),
      'Net P&L at projection price (' + money(projectionPrice) + '): ' + signed(projectionOldPnl) + ' → ' + signed(projectionNewPnl),
      'Net P&L at -10%: ' + signed(scenarioPnl(oldShares, oldCost, oldBuyFee, downsidePrice, currentMargin)) + ' → ' + signed(scenarioPnl(newShares, newCost, newBuyFee, downsidePrice, afterMargin)),
      'Final margin balance: ' + money(balance) + ' → ' + money(balanceAfter),
      'Extra margin cost: ' + money(dailyMarginFeeDifference) + '/day',
      'Trade-off: quote P&L changes by ' + signed(currentDelta) + '; downside P&L changes by ' + signed(downsideDelta) + '.',
      'Estimate only · no portfolio changes.'
    ];
    return { type: 'res', text: lines.join('\n'), modal };
  }

}