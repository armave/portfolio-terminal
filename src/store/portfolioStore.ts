import { useState, useEffect } from 'preact/hooks';
import {
  PortfolioState,
  PositionRecord,
  Holding,
  Tranche,
  TrancheItem,
  BrokerRules,
  BrokerAssumptions,
  PendingMutation,
  ClosedTrade
} from '../types/portfolio';
import {
  loadSavedState,
  saveState,
  loadBrokerRules,
  saveBrokerRules,
  getQuoteRefreshInterval
} from '../services/storage';
import { calculateCommission, calculateMarginInterest } from '../domain/portfolio';

const DEFAULT_BROKER_ASSUMPTIONS: BrokerRules = {
  broker: 'Freedom Broker Armenia (Tradernet)',
  annualRate: 0.15,
  annualBorrowRate: 0.15,
  dayCountBasis: 365,
  rolloverHour: 4,
  rolloverMinute: 0,
  rolloverTimeZone: 'Asia/Yerevan',
  dailyRolloverCutoffArmenia: '04:00',
  maintenanceMarginRatio: 0.1,
  maintenanceEquityRatio: 0.1,
  stopOutRatio: 0,
  commPerShare: 0.012,
  commissionPerShare: 0.012,
  commVolumePct: 0.0012,
  commissionRatePct: 0.0012,
  minCommOrder: 1.2,
  commissionMin: 1.2
};

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Import legacy active holdings only when a canonical position for that ticker
 * does not already exist. Existing canonical records always win.
 */
export function migrateLegacyHoldingsToPositions(
  sourcePositions: Record<string, PositionRecord>,
  legacyHoldings: Holding[],
  fallbackDate = todayIso()
): Record<string, PositionRecord> {
  const positions: Record<string, PositionRecord> = { ...(sourcePositions || {}) };

  for (const holding of Array.isArray(legacyHoldings) ? legacyHoldings : []) {
    const ticker = String(holding?.ticker || '').trim().toUpperCase();
    if (!ticker || positions[ticker]) continue;

    const tranches: TrancheItem[] = (Array.isArray(holding.tranches) ? holding.tranches : [])
      .map((tranche) => ({
        qty: Number(tranche.shares) || 0,
        price: Number(tranche.entryPrice) || 0,
        date: tranche.purchaseDate || fallbackDate
      }))
      .filter((tranche) => tranche.qty > 0 && tranche.price > 0);

    const shares = tranches.reduce((sum, tranche) => sum + tranche.qty, 0);
    if (shares <= 0) continue;

    const averagePrice = tranches.reduce((sum, tranche) => sum + tranche.qty * tranche.price, 0) / shares;
    const earliestDate = tranches
      .map((tranche) => tranche.date)
      .filter((date): date is string => Boolean(date))
      .sort()[0] || fallbackDate;

    positions[ticker] = {
      ticker,
      shares,
      currentPrice: Number(holding.currentPrice) || averagePrice,
      pt: Number(holding.analystTarget) || Number((averagePrice * 1.1).toFixed(2)),
      commBuy: 0,
      startDate: earliestDate,
      tranches
    };
  }

  return positions;
}

/** Build the read-only legacy holdings view from canonical positions. */
export function buildHoldingsProjection(
  positions: Record<string, PositionRecord>,
  legacyHoldings: Holding[],
  fallbackDate = todayIso()
): Holding[] {
  return Object.keys(positions).map((ticker) => {
    const position = positions[ticker];
    const legacy = (Array.isArray(legacyHoldings) ? legacyHoldings : []).find(
      (holding) => String(holding?.ticker || '').trim().toUpperCase() === ticker
    );
    const tranches: Tranche[] = (position.tranches || []).map((tranche, index) => ({
      id: `${ticker}-${index}`,
      shares: Number(tranche.qty) || 0,
      entryPrice: Number(tranche.price) || 0,
      purchaseDate: tranche.date || position.startDate || fallbackDate,
      targetPrice: position.pt
    }));

    return {
      ...legacy,
      ticker,
      isMargin: true,
      tranches,
      currentPrice: position.currentPrice,
      analystTarget: position.pt
    };
  });
}


/**
 * Upgrade a legacy-only cloud snapshot without letting stale holdings override
 * canonical local positions or resurrect a ticker closed locally after its
 * latest legacy purchase.
 */
export function migrateLegacyCloudHoldingsToPositions(
  cloudState: Partial<PortfolioState>,
  localState: Partial<PortfolioState>,
  fallbackDate = todayIso()
): Partial<PortfolioState> {
  if (Object.prototype.hasOwnProperty.call(cloudState, 'positions')) return cloudState;

  const localPositions = (localState.positions || {}) as Record<string, PositionRecord>;
  const localClosedTrades = Array.isArray(localState.closedTrades) ? localState.closedTrades : [];
  const legacyHoldings = Array.isArray(cloudState.holdings) ? cloudState.holdings : [];

  const safeHoldings = legacyHoldings.filter((holding) => {
    const ticker = String(holding?.ticker || '').trim().toUpperCase();
    if (!ticker || localPositions[ticker]) return false;

    const latestClose = localClosedTrades
      .filter((trade) => String(trade?.ticker || '').trim().toUpperCase() === ticker)
      .map((trade) => {
        const value = trade.closedAt ?? trade.exitDate ?? trade.sellDate ?? trade.date;
        const timestamp = typeof value === 'number' ? value : Date.parse(String(value || ''));
        return Number.isFinite(timestamp) ? timestamp : 0;
      })
      .reduce((latest, timestamp) => Math.max(latest, timestamp), 0);

    if (!latestClose) return true;

    const latestLegacyPurchase = (Array.isArray(holding.tranches) ? holding.tranches : [])
      .map((tranche) => Date.parse(String(tranche.purchaseDate || '')))
      .filter(Number.isFinite)
      .reduce((latest, timestamp) => Math.max(latest, timestamp), 0);

    // A legacy holding is only considered reopened if it has a purchase date
    // strictly later than the most recent locally recorded exit.
    return latestLegacyPurchase > latestClose;
  });

  return {
    ...cloudState,
    positions: migrateLegacyHoldingsToPositions(localPositions, safeHoldings, fallbackDate)
  };
}

export class PortfolioStore {
  private state: PortfolioState;
  private listeners: Set<(state: PortfolioState) => void> = new Set();

  constructor() {
    this.state = this.initializeState();
  }

  private initializeState(): PortfolioState {
    const saved = loadSavedState(this.state) as Partial<PortfolioState> | null;
    const savedRules = loadBrokerRules(DEFAULT_BROKER_ASSUMPTIONS) as Partial<BrokerRules> | null;
    const refreshInterval = getQuoteRefreshInterval();

    const raw: PortfolioState = {
      positions: saved?.positions || {},
      cashCushion: saved?.cashCushion || { freeCash: 0, holdings: [] },
      balance: Number(saved?.balance) || 0,
      realizedMarginCharged: Number(saved?.realizedMarginCharged) || 0,
      tranches: saved?.tranches || [],
      startDate: saved?.startDate || todayIso(),
      activeView: saved?.activeView || 'COMBINED',
      closedTrades: Array.isArray(saved?.closedTrades) ? saved!.closedTrades : [],
      brokerAssumptions: {
        ...DEFAULT_BROKER_ASSUMPTIONS,
        ...(saved?.brokerAssumptions || {}),
        ...(savedRules || {})
      },
      lastRolloverTimestamp: saved?.lastRolloverTimestamp,
      lastUpdated: saved?.lastUpdated || Date.now(),
      gatewaySecret: saved?.gatewaySecret,
      cashBalance: Number(saved?.cashBalance ?? saved?.cashCushion?.freeCash) || 0,
      holdings: Array.isArray(saved?.holdings) ? saved!.holdings : [],
      cashStocks: Array.isArray(saved?.cashStocks) ? saved!.cashStocks : [],
      apiKeys: saved?.apiKeys || {},
      selectedTicker: saved?.selectedTicker ?? null,
      autoRefreshInterval:
        typeof refreshInterval === 'number' ? refreshInterval : saved?.autoRefreshInterval ?? 60000,
      pendingMutation: null
    };

    // Only migrate legacy holdings when the persisted snapshot truly predates the
    // canonical positions field. An explicitly empty positions map is authoritative.
    const allowLegacyMigration = !Object.prototype.hasOwnProperty.call(saved || {}, 'positions');
    return this.normalizeState(raw, allowLegacyMigration);
  }

  /**
   * Positions are the canonical active-trade structure. Legacy `holdings`
   * entries are imported only for tickers missing from positions, then rebuilt
   * as a compatibility projection from the canonical positions map.
   */
  private normalizeState(raw: PortfolioState, allowLegacyMigration = false): PortfolioState {
    const legacyHoldings: Holding[] = Array.isArray(raw.holdings) ? raw.holdings : [];
    const sourcePositions = raw.positions || {};
    const positions = allowLegacyMigration
      ? migrateLegacyHoldingsToPositions(sourcePositions, legacyHoldings)
      : { ...sourcePositions };
    const holdings = buildHoldingsProjection(positions, legacyHoldings);

    const freeCash = Math.max(0, Number(raw.cashCushion?.freeCash ?? raw.cashBalance) || 0);
    const cashHoldings = Array.isArray(raw.cashCushion?.holdings)
      ? raw.cashCushion.holdings
      : [];

    return {
      ...raw,
      positions,
      holdings,
      cashBalance: freeCash,
      cashCushion: {
        freeCash,
        holdings: cashHoldings
      }
    };
  }

  public getState(): PortfolioState {
    return this.state;
  }

  public subscribe(listener: (state: PortfolioState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    saveState(this.state as any);
    this.listeners.forEach((listener) => listener(this.state));
  }

  public update(updater: (state: PortfolioState) => PortfolioState): void {
    const next = updater(this.state);
    this.state = this.normalizeState({
      ...next,
      lastUpdated: Date.now()
    });
    this.notify();
  }

  public setState(partial: Partial<PortfolioState>): void {
    this.update((state) => ({
      ...state,
      ...partial
    }));
  }

  public importState(newState: Partial<PortfolioState>): void {
    this.update((state) => ({
      ...state,
      ...newState
    }));
  }

  public setActiveView(view: string): void {
    this.setState({ activeView: view, selectedTicker: view });
  }

  public selectTicker(ticker: string | null): void {
    this.setState({
      selectedTicker: ticker,
      activeView: ticker || 'COMBINED'
    });
  }

  private finiteAssumption(value: unknown, fallback: number): number {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  public updateAssumptions(rules: Partial<BrokerRules & BrokerAssumptions>): void {
    this.update((state) => {
      const merged: BrokerRules = {
        ...DEFAULT_BROKER_ASSUMPTIONS,
        ...state.brokerAssumptions,
        ...rules,
        annualRate: this.finiteAssumption(
          rules.annualRate ?? rules.annualBorrowRate ?? state.brokerAssumptions.annualRate,
          DEFAULT_BROKER_ASSUMPTIONS.annualRate
        ),
        annualBorrowRate: this.finiteAssumption(
          rules.annualBorrowRate ?? rules.annualRate ?? state.brokerAssumptions.annualBorrowRate,
          DEFAULT_BROKER_ASSUMPTIONS.annualRate
        ),
        maintenanceMarginRatio: this.finiteAssumption(
          rules.maintenanceMarginRatio ?? rules.maintenanceEquityRatio ?? state.brokerAssumptions.maintenanceMarginRatio,
          DEFAULT_BROKER_ASSUMPTIONS.maintenanceMarginRatio
        ),
        maintenanceEquityRatio: this.finiteAssumption(
          rules.maintenanceEquityRatio ?? rules.maintenanceMarginRatio ?? state.brokerAssumptions.maintenanceEquityRatio,
          DEFAULT_BROKER_ASSUMPTIONS.maintenanceMarginRatio
        )
      };
      saveBrokerRules(merged as any);
      return {
        ...state,
        brokerAssumptions: merged
      };
    });
  }

  public setCashBalance(amount: number): void {
    const num = Number(amount) || 0;
    this.update((state) => {
      const freeCash = Math.max(0, num);
      // A positive balance entry represents available cash and clears any old margin debt.
      const balance = num < 0 ? num : 0;
      return {
        ...state,
        balance,
        cashBalance: freeCash,
        cashCushion: {
          ...(state.cashCushion || { freeCash: 0, holdings: [] }),
          freeCash
        }
      };
    });
  }

  public setMarginDebt(debtAmount: number): void {
    const debt = Math.abs(Number(debtAmount) || 0);
    this.update((state) => ({
      ...state,
      balance: -debt
    }));
  }

  public buyStock(
    ticker: string,
    shares: number,
    price: number,
    date?: string,
    pt?: number
  ): void {
    const clean = ticker.trim().toUpperCase();
    if (!clean || shares <= 0 || price <= 0) return;

    const purchaseDate = date || todayIso();

    this.update((state) => {

      const totalVal = shares * price;

      // Extract broker commission rules with safe fallbacks
      const rules = state.brokerAssumptions || DEFAULT_BROKER_ASSUMPTIONS;
      const commPerShare = Number(rules.commPerShare ?? rules.commissionPerShare ?? 0.02);
      const commVolumePct = Number(rules.commVolumePct ?? rules.commissionRatePct ?? 0.0005);
      const minCommOrder = Number(rules.minCommOrder ?? rules.commissionMin ?? 1.50);

      // A buyStock call represents one broker execution, so enforce the minimum
      // ticket commission here rather than recalculating across the combined position.
      const buyComm = Number(calculateCommission(shares, totalVal, {
        commPerShare,
        commVolumePct,
        minCommOrder
      }).toFixed(2));

      const positions = { ...(state.positions || {}) };
      const existingPos = positions[clean];

      const nextTranches: TrancheItem[] = [
        ...(existingPos?.tranches || []),
        { qty: shares, price, date: purchaseDate, buyCommission: buyComm }
      ];

      const nextShares = (Number(existingPos?.shares) || 0) + shares;
      const nextCommBuy = (Number(existingPos?.commBuy) || 0) + buyComm;

      const earliestPosDate =
        nextTranches
          .map((t) => t.date)
          .filter((d): d is string => Boolean(d))
          .sort()[0] || purchaseDate;

      positions[clean] = {
        ...existingPos,
        ticker: clean,
        shares: nextShares,
        currentPrice: existingPos?.currentPrice || price,
        pt:
          pt !== undefined && Number.isFinite(pt) && pt > 0
            ? pt
            : existingPos?.pt || Number((price * 1.1).toFixed(2)),
        commBuy: nextCommBuy,
        startDate: earliestPosDate,
        tranches: nextTranches,
        lastTradeAt: Date.now()
      } as PositionRecord;

      const allDates = Object.values(positions)
        .flatMap((p) => (p.tranches || []).map((t) => t.date))
        .filter((d): d is string => Boolean(d))
        .sort();
      const earliestPortfolioDate = allDates[0] || state.startDate || purchaseDate;

      let freeCash = Math.max(0, Number(state.cashCushion?.freeCash) || 0);
      let currentDebt = Math.abs(Number(state.balance) || 0);
      const totalOrderCost = totalVal + buyComm;

      if (freeCash >= totalOrderCost) {
        freeCash -= totalOrderCost;
      } else {
        const remainingCost = totalOrderCost - freeCash;
        freeCash = 0;
        currentDebt += remainingCost;
      }

      return {
        ...state,
        positions,
        startDate: earliestPortfolioDate,
        activeView: clean,
        balance: currentDebt > 0 ? -currentDebt : 0,
        cashBalance: freeCash,
        cashCushion: {
          ...(state.cashCushion || { freeCash: 0, holdings: [] }),
          freeCash
        }
      };
    });
  }

  public addTranche(
    ticker: string,
    tranche: { shares: number; entryPrice: number; purchaseDate?: string; targetPrice?: number }
  ): void {
    this.buyStock(
      ticker,
      Number(tranche.shares) || 0,
      Number(tranche.entryPrice) || 0,
      tranche.purchaseDate,
      tranche.targetPrice
    );
  }

  public removeTranche(ticker: string, trancheId: string): void {
    const clean = ticker.trim().toUpperCase();
    this.update((state) => {
      const positions = { ...(state.positions || {}) };
      const pos = positions[clean];
      if (!pos) return state;

      const idxMatch = trancheId.match(/-(\d+)$/);
      const idxToRemove = idxMatch ? parseInt(idxMatch[1], 10) : -1;
      const nextTranches = (pos.tranches || []).filter((_, i) => i !== idxToRemove);

      if (nextTranches.length === 0) {
        delete positions[clean];
      } else {
        const nextShares = nextTranches.reduce((s, t) => s + t.qty, 0);
        positions[clean] = {
          ...pos,
          shares: nextShares,
          tranches: nextTranches
        };
      }

      return {
        ...state,
        positions
      };
    });
  }

  public sellStock(
    ticker: string,
    sharesToSell: number | 'ALL',
    sellPrice: number,
    date?: string
  ): void {
    const clean = ticker.trim().toUpperCase();
    if (!clean || sellPrice <= 0) return;

    this.update((state) => {
      const positions = { ...(state.positions || {}) };
      const pos = positions[clean];
      if (!pos || pos.shares <= 0) return state;

      const actualSold =
        sharesToSell === 'ALL'
          ? pos.shares
          : Math.min(pos.shares, Math.max(0, Number(sharesToSell) || 0));
      if (actualSold <= 0) return state;

      const rules = state.brokerAssumptions || DEFAULT_BROKER_ASSUMPTIONS;
      const annualRate = this.finiteAssumption(
        rules.annualRate ?? rules.annualBorrowRate,
        DEFAULT_BROKER_ASSUMPTIONS.annualRate
      );
      const dailyRate = annualRate / (Number(rules.dayCountBasis) || 365);

      let remainingToSell = actualSold;
      let soldCostBasis = 0;
      let buyCommAllocated = 0;
      const updatedTranches: TrancheItem[] = [];
      const origTranches = pos.tranches || [
        { qty: pos.shares, price: pos.currentPrice, date: pos.startDate }
      ];
      const hasPerTrancheCommissions = origTranches.length > 0 && origTranches.every(
        (tranche) => Number.isFinite(Number((tranche as any).buyCommission))
      );
      const earliestBuyDate =
        origTranches[0]?.date || pos.startDate || state.startDate || todayIso();

      for (const tr of origTranches) {
        const trQty = Number((tr as any).qty ?? (tr as any).shares) || 0;
        const trPrice = Number((tr as any).price ?? (tr as any).entryPrice) || 0;

        if (remainingToSell <= 0) {
          updatedTranches.push({ ...tr });
          continue;
        }

        const take = Math.min(trQty, remainingToSell);
        soldCostBasis += take * trPrice;
        remainingToSell -= take;

        const trancheBuyCommission = hasPerTrancheCommissions
          ? Math.max(0, Number((tr as any).buyCommission) || 0)
          : 0;
        const commissionForTake = hasPerTrancheCommissions && trQty > 0
          ? Number((trancheBuyCommission * take / trQty).toFixed(2))
          : 0;
        buyCommAllocated += commissionForTake;

        if (trQty - take > 0) {
          updatedTranches.push({
            ...tr,
            qty: trQty - take,
            ...(hasPerTrancheCommissions
              ? { buyCommission: Number((trancheBuyCommission - commissionForTake).toFixed(2)) }
              : {})
          });
        }
      }

      if (soldCostBasis <= 0 && pos.currentPrice > 0) {
        soldCostBasis = actualSold * pos.currentPrice;
      }

      const sellRatio = pos.shares > 0 ? actualSold / pos.shares : 1;
      if (hasPerTrancheCommissions) {
        buyCommAllocated = Number(buyCommAllocated.toFixed(2));
      } else {
        // Legacy positions may have only an aggregate commission. Preserve the
        // historical proportional allocation until their lots carry commission data.
        buyCommAllocated = Number(((Number(pos.commBuy) || 0) * sellRatio).toFixed(2));
      }
      const sellProceeds = actualSold * sellPrice;

      // Calculate sell commissions
      const commPerShare = Number((rules as any).commPerShare ?? (rules as any).commissionPerShare ?? 0.02);
      const commVolumePct = Number((rules as any).commVolumePct ?? (rules as any).commissionRatePct ?? 0.0005);
      const minCommOrder = Number((rules as any).minCommOrder ?? (rules as any).commissionMin ?? 1.50);

      const rawSellComm = actualSold * commPerShare + sellProceeds * commVolumePct;
      let sellComm = Number(Math.max(minCommOrder, rawSellComm).toFixed(2));

      try {
        const calculated = calculateCommission(actualSold, sellProceeds, rules as any);
        if (Number.isFinite(calculated) && calculated > 0) {
          sellComm = Number(calculated.toFixed(2));
        }
      } catch {
        // Fallback to rawSellComm
      }

      // Debt and margin interest calculation
      const totalPortfolioInvested = Object.values(positions).reduce(
        (acc, p) =>
          acc +
          (p.tranches || []).reduce(
            (s, t) =>
              s +
              (Number((t as any).qty ?? (t as any).shares) || 0) *
              (Number((t as any).price ?? (t as any).entryPrice) || 0),
            0
          ),
        0
      );
      const posInvested = origTranches.reduce(
        (s, t) =>
          s +
          (Number((t as any).qty ?? (t as any).shares) || 0) *
          (Number((t as any).price ?? (t as any).entryPrice) || 0),
        0
      );
      const weight = totalPortfolioInvested > 0 ? posInvested / totalPortfolioInvested : 1;
      const totalDebt = Math.abs(Number(state.balance) || 0);
      const allocatedDebt = totalDebt * weight;

      let posMarginInterest = 0;
      try {
        posMarginInterest = calculateMarginInterest(origTranches as any, {
          dailyRate,
          marginDebt: allocatedDebt,
          totalDebt
        } as any);
      } catch {
        posMarginInterest = 0;
      }
      const marginInterestAllocated = Number((posMarginInterest * sellRatio).toFixed(2));

      const totalCommissions = Number((buyCommAllocated + sellComm).toFixed(2));
      const grossProfit = Number((sellProceeds - soldCostBasis).toFixed(2));
      const netProfit = Number((grossProfit - totalCommissions - marginInterestAllocated).toFixed(2));
      // Rollover interest is already reflected in state.balance before a sale.
      // Keep it in realized P&L, but do not subtract it a second time from cash proceeds.
      const netCashProceeds = Number((sellProceeds - sellComm).toFixed(2));

      let currentDebt = totalDebt;
      let freeCash = Math.max(0, Number(state.cashCushion?.freeCash) || 0);

      if (currentDebt >= netCashProceeds) {
        currentDebt -= netCashProceeds;
      } else {
        const surplus = netCashProceeds - currentDebt;
        currentDebt = 0;
        freeCash += surplus;
      }

      const remainingShares = pos.shares - actualSold;
      if (remainingShares <= 0 || updatedTranches.length === 0) {
        delete positions[clean];
      } else {
        positions[clean] = {
          ...pos,
          shares: remainingShares,
          commBuy: Math.max(0, (Number(pos.commBuy) || 0) - buyCommAllocated),
          tranches: updatedTranches
        };
      }

      const exitDateStr = date || todayIso();
      const buyTimestamp = new Date(earliestBuyDate).getTime();
      const exitTimestamp = new Date(exitDateStr).getTime();
      const holdingDays = Math.max(
        0,
        Math.round(Math.abs(exitTimestamp - buyTimestamp) / 86400000)
      );
      const closedTimestamp = Number.isFinite(exitTimestamp) ? exitTimestamp : Date.now();

      const closedRecord: ClosedTrade = {
        id: `${clean}-${Date.now()}`,
        ticker: clean,
        shares: actualSold,
        avgBuyPrice: soldCostBasis / actualSold,
        entryPrice: soldCostBasis / actualSold,
        sellPrice,
        exitPrice: sellPrice,
        buyDate: earliestBuyDate,
        purchaseDate: earliestBuyDate,
        sellDate: exitDateStr,
        exitDate: exitDateStr,
        date: closedTimestamp,
        closedAt: new Date(closedTimestamp).toISOString(),
        grossProfit,
        commissions: totalCommissions,
        feesAndCommissions: totalCommissions,
        totalCommissions,
        marginInterest: marginInterestAllocated,
        netProfit,
        netRealizedGain: netProfit,
        holdingDays
      };

      const nextActiveView = positions[clean] ? clean : 'COMBINED';

      return {
        ...state,
        positions,
        activeView: nextActiveView,
        selectedTicker: nextActiveView === 'COMBINED' ? null : state.selectedTicker,
        balance: currentDebt > 0 ? -currentDebt : 0,
        cashBalance: freeCash,
        cashCushion: {
          ...(state.cashCushion || { freeCash: 0, holdings: [] }),
          freeCash
        },
        closedTrades: [closedRecord, ...(state.closedTrades || [])]
      };
    });
  }

  /**
   * Applies a completed quote request to the latest store snapshot.
   * This avoids applying a stale state object captured before an async request.
   */
  public updateLiveQuote(
    ticker: string,
    quote: { price?: number; currentPrice?: number; quoteUpdatedAt?: number; quoteSource?: string; quoteDetails?: Record<string, unknown>; requestStartedAt?: number }
  ): void {
    const clean = ticker.trim().toUpperCase();
    const price = Number(quote.currentPrice ?? quote.price);
    if (!clean || !Number.isFinite(price) || price <= 0) return;

    this.update((latestState) => {
      const positions = { ...(latestState.positions || {}) };
      const position = positions[clean];
      const cashHoldings = [...(latestState.cashCushion?.holdings || [])];
      const hasMatchingCashHolding = cashHoldings.some((holding) => holding.ticker.toUpperCase() === clean);
      const cashStocks = [...(latestState.cashStocks || [])];
      const hasMatchingCashStock = cashStocks.some((holding) => holding.ticker.toUpperCase() === clean);
      const latestRequestStartedAt = Math.max(
        Number(position?.quoteRequestStartedAt) || 0,
        ...cashHoldings.filter((holding) => holding.ticker.toUpperCase() === clean)
          .map((holding) => Number(holding.quoteRequestStartedAt) || 0),
        ...cashStocks.filter((holding) => holding.ticker.toUpperCase() === clean)
          .map((holding) => Number(holding.quoteRequestStartedAt) || 0)
      );
      const requestStartedAt = quote.requestStartedAt ?? Date.now();

      // Requests can finish out of order. Apply a response only if it started
      // after the last accepted request for this ticker, and never over a trade.
      if (quote.requestStartedAt !== undefined && quote.requestStartedAt < latestRequestStartedAt) {
        return latestState;
      }
      if (
        position &&
        quote.requestStartedAt !== undefined &&
        Number(position.lastTradeAt || 0) > quote.requestStartedAt
      ) {
        return latestState;
      }

      if (position) {
        positions[clean] = {
          ...position,
          currentPrice: price,
          quoteUpdatedAt: quote.quoteUpdatedAt ?? Date.now(),
          quoteRequestStartedAt: requestStartedAt,
          quoteSource: quote.quoteSource ?? 'Live quote',
          ...(quote.requestStartedAt === undefined && quote.quoteSource === 'Manual'
            ? { lastTradeAt: requestStartedAt }
            : {}),
          ...(quote.quoteDetails ? { quoteDetails: quote.quoteDetails } : {})
        };
      }

      const updatedCashHoldings = cashHoldings.map((holding) =>
        holding.ticker.toUpperCase() === clean
          ? { ...holding, currentPrice: price, price, quoteUpdatedAt: quote.quoteUpdatedAt ?? Date.now(),
              quoteRequestStartedAt: requestStartedAt,
              quoteSource: quote.quoteSource ?? 'Live quote',
              ...(quote.quoteDetails ? { quoteDetails: quote.quoteDetails } : {}) }
          : holding
      );
      const updatedCashStocks = cashStocks.map((holding) =>
        holding.ticker.toUpperCase() === clean
          ? { ...holding, currentPrice: price, quoteRequestStartedAt: requestStartedAt }
          : holding
      );

      if (!position && !hasMatchingCashHolding && !hasMatchingCashStock) return latestState;

      return {
        ...latestState,
        positions,
        cashStocks: updatedCashStocks,
        cashCushion: {
          ...(latestState.cashCushion || { freeCash: 0, holdings: [] }),
          holdings: updatedCashHoldings
        }
      };
    });
  }

  public updatePrice(ticker: string, price: number): void {
    this.updateLiveQuote(ticker, { price, quoteSource: 'Manual' });
  }

  public updateTargetPrice(ticker: string, pt: number): void {
    const clean = ticker.trim().toUpperCase();
    if (!clean || pt <= 0) return;

    this.update((state) => {
      const positions = { ...(state.positions || {}) };
      if (!positions[clean]) return state;
      positions[clean] = {
        ...positions[clean],
        pt
      };
      return {
        ...state,
        positions
      };
    });
  }

  public addCashStock(ticker: string, shares: number, price: number): void {
    const clean = ticker.trim().toUpperCase();
    if (!clean || shares <= 0 || price <= 0) return;

    this.update((state) => {
      const holdings = [...(state.cashCushion?.holdings || [])];
      const existingIdx = holdings.findIndex((h) => h.ticker.toUpperCase() === clean);
      if (existingIdx >= 0) {
        const prev = holdings[existingIdx];
        holdings[existingIdx] = {
          ...prev,
          shares: (Number(prev.shares) || 0) + shares,
          price,
          currentPrice: price
        };
      } else {
        holdings.push({
          ticker: clean,
          shares,
          price,
          currentPrice: price
        });
      }

      return {
        ...state,
        cashCushion: {
          ...(state.cashCushion || { freeCash: 0, holdings: [] }),
          holdings
        }
      };
    });
  }

  public removeCashStock(indexOrTicker: number | string): void {
    this.update((state) => {
      const holdings = [...(state.cashCushion?.holdings || [])];
      const nextHoldings =
        typeof indexOrTicker === 'number'
          ? holdings.filter((_, idx) => idx !== indexOrTicker)
          : holdings.filter((h) => h.ticker.toUpperCase() !== indexOrTicker.toUpperCase());

      return {
        ...state,
        cashCushion: {
          ...(state.cashCushion || { freeCash: 0, holdings: [] }),
          holdings: nextHoldings
        }
      };
    });
  }

  public deleteClosedTrade(index: number): void {
    this.update((state) => {
      const nextClosed = (state.closedTrades || []).filter((_, idx) => idx !== index);
      return {
        ...state,
        closedTrades: nextClosed
      };
    });
  }

  public setPendingMutation(mutation: PendingMutation | null): void {
    this.setState({ pendingMutation: mutation });
  }

  public setApiKey(provider: keyof PortfolioState['apiKeys'], key: string): void {
    this.update((state) => ({
      ...state,
      apiKeys: {
        ...(state.apiKeys || {}),
        [provider]: key
      }
    }));
  }
}

export const portfolioStore = new PortfolioStore();

export function usePortfolio(): PortfolioState {
  const [state, setState] = useState<PortfolioState>(() => portfolioStore.getState());

  useEffect(() => {
    return portfolioStore.subscribe((newState) => {
      setState({ ...newState });
    });
  }, []);

  return state;
}