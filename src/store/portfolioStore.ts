import { PortfolioState, Holding, Tranche, BrokerAssumptions, PendingMutation, BrokerRules } from '../types/portfolio';
import { StorageService } from '../services/storage';
import { calculateCommission, calculateMarginInterest } from '../domain/portfolio';
import { useEffect, useState } from 'react';

export const DEFAULT_BROKER_ASSUMPTIONS: BrokerRules = {
  broker: 'Freedom Broker Armenia (Tradernet)',
  annualRate: 0.15,
  annualBorrowRate: 0.15,
  dayCountBasis: 365,
  rolloverHour: 4,
  rolloverMinute: 0,
  rolloverTimeZone: 'Asia/Yerevan',
  dailyRolloverCutoffArmenia: '04:00',
  maintenanceMarginRatio: 0.10,
  maintenanceEquityRatio: 0.10,
  stopOutRatio: 0.00,
  commPerShare: 0.012,
  commVolumePct: 0.0012,
  minCommOrder: 1.20,
  commissionMin: 1.20,
  commissionPerShare: 0.012,
  commissionRatePct: 0.0012
};

export const INITIAL_STATE: PortfolioState = {
  positions: {},
  cashCushion: { freeCash: 0, holdings: [] },
  balance: 0,
  realizedMarginCharged: 0,
  activeView: 'COMBINED',
  cashBalance: 0,
  holdings: [],
  closedTrades: [],
  cashStocks: [],
  brokerAssumptions: DEFAULT_BROKER_ASSUMPTIONS,
  apiKeys: {},
  selectedTicker: null,
  autoRefreshInterval: 60000,
  pendingMutation: null
};

type Listener = (state: PortfolioState) => void;

class Store {
  private state: PortfolioState;
  private listeners: Set<Listener> = new Set();

  constructor() {
    const loaded = StorageService.loadLocal(INITIAL_STATE) as PortfolioState;
    this.state = {
      ...INITIAL_STATE,
      ...loaded,
      brokerAssumptions: {
        ...DEFAULT_BROKER_ASSUMPTIONS,
        ...(loaded.brokerAssumptions || {})
      },
      apiKeys: loaded.apiKeys || {}
    };
  }

  public getState(): PortfolioState {
    return this.state;
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    StorageService.saveLocal(this.state);
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private getRules() {
    const a: any = this.state.brokerAssumptions || {};
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

  public setCashBalance(signedBalance: number): void {
    const s: any = { ...this.state };
    if (!s.cashCushion) s.cashCushion = { freeCash: 0, holdings: [] };
    s.cashCushion = {
      ...s.cashCushion,
      freeCash: Math.max(0, signedBalance)
    };
    s.balance = Math.min(0, signedBalance);
    s.cashBalance = signedBalance;
    this.state = s;
    this.notify();
  }

  public updateAssumptions(assumptions: Partial<BrokerAssumptions>): void {
    this.state = {
      ...this.state,
      brokerAssumptions: { ...this.state.brokerAssumptions, ...assumptions }
    };
    this.notify();
  }

  public setSelectedTicker(ticker: string | null): void {
    const s: any = { ...this.state, selectedTicker: ticker };
    if (ticker) s.activeView = ticker;
    this.state = s;
    this.notify();
  }

  public setPendingMutation(mutation: PendingMutation | null): void {
    this.state = { ...this.state, pendingMutation: mutation };
    this.notify();
  }

  public addTranche(
    ticker: string,
    trancheData: Omit<Tranche, 'id'> & { targetPrice?: number },
    isMargin = true
  ): void {
    const symbol = ticker.toUpperCase();
    const id = Math.random().toString(36).substring(2, 9);
    const qty = Number(trancheData.shares);
    const price = Number(trancheData.entryPrice);
    const date = trancheData.purchaseDate || new Date().toISOString().split('T')[0];

    const tranche: Tranche = {
      ...trancheData,
      id
    };

    const s: any = { ...this.state };

    // 1. Update holdings[] array
    const existingIndex = (s.holdings || []).findIndex((h: Holding) => h.ticker === symbol);
    const updatedHoldings = [...(s.holdings || [])];
    if (existingIndex > -1) {
      const current = updatedHoldings[existingIndex];
      updatedHoldings[existingIndex] = {
        ...current,
        currentPrice: price,
        tranches: [...(current.tranches || []), tranche]
      };
    } else {
      updatedHoldings.push({
        ticker: symbol,
        isMargin,
        currentPrice: price,
        tranches: [tranche]
      });
    }
    s.holdings = updatedHoldings;

    // 2. Update positions{} map (used by app.ts & renderBoard.ts)
    const rules = this.getRules();
    const buyComm = calculateCommission(qty, qty * price, rules as any);
    const positions = { ...(s.positions || {}) };
    const existingPos = positions[symbol];

    const posTranche = { id, qty, price, date };
    if (existingPos) {
      const nextTranches = [...(existingPos.tranches || []), posTranche];
      const nextShares = nextTranches.reduce((sum: number, t: any) => sum + Number(t.qty ?? t.shares ?? 0), 0);
      positions[symbol] = {
        ...existingPos,
        shares: nextShares,
        currentPrice: existingPos.currentPrice || price,
        commBuy: (Number(existingPos.commBuy) || 0) + buyComm,
        ...(trancheData.targetPrice ? { pt: trancheData.targetPrice } : {}),
        tranches: nextTranches
      };
    } else {
      positions[symbol] = {
        ticker: symbol,
        shares: qty,
        currentPrice: price,
        pt: trancheData.targetPrice || Number((price * 1.1).toFixed(2)),
        commBuy: buyComm,
        tranches: [posTranche]
      };
    }
    s.positions = positions;

    // 3. Adjust cash / margin balance for purchase cost + commission
    const totalCost = qty * price + buyComm;
    const freeCash = Number(s.cashCushion?.freeCash) || 0;
    const currentDebt = Number(s.balance) || 0; // negative or 0
    if (freeCash >= totalCost) {
      s.cashCushion = { ...(s.cashCushion || {}), freeCash: freeCash - totalCost };
      s.cashBalance = s.cashCushion.freeCash + currentDebt;
    } else {
      const remainingCost = totalCost - freeCash;
      if (s.cashCushion) s.cashCushion = { ...s.cashCushion, freeCash: 0 };
      s.balance = currentDebt - remainingCost;
      s.cashBalance = s.balance;
    }

    s.activeView = symbol;
    s.selectedTicker = symbol;
    this.state = s;
    this.notify();
  }

  public sellTranche(ticker: string, sharesToSell: number, exitPrice: number, exitDate: string): void {
    const symbol = ticker.toUpperCase();
    const s: any = { ...this.state };
    const rules = this.getRules();

    const pos = s.positions?.[symbol];
    const holding = (s.holdings || []).find((h: Holding) => h.ticker === symbol);
    if (!pos && !holding) {
      throw new Error(`No open position found for ${symbol}.`);
    }

    // Determine available shares
    const availablePosShares = pos
      ? Number(pos.shares) || (pos.tranches || []).reduce((sum: number, t: any) => sum + Number(t.qty ?? t.shares ?? 0), 0)
      : 0;
    const availableHoldingShares = holding
      ? (holding.tranches || []).reduce((sum: number, t: Tranche) => sum + Number(t.shares || 0), 0)
      : 0;
    const availableShares = Math.max(availablePosShares, availableHoldingShares);

    if (sharesToSell <= 0 || sharesToSell > availableShares) {
      throw new Error(`Invalid share quantity. Open ${symbol} shares: ${availableShares}`);
    }

    // 1. FIFO deduction on positions[symbol]
    let totalCostBasis = 0;
    let earliestDate = exitDate;
    let allocatedBuyComm = 0;
    let allocatedMarginInterest = 0;

    if (pos) {
      let rem = sharesToSell;
      const nextPosTranches: any[] = [];
      const origTranches = pos.tranches || [];
      if (origTranches[0]?.date) earliestDate = origTranches[0].date;

      const totalDebt = Math.abs(Number(s.balance) || 0);
      const totalMargin = calculateMarginInterest(origTranches, {
        dailyRate: rules.dailyRate,
        marginDebt: totalDebt,
        totalDebt
      } as any);
      const sellRatio = availableShares > 0 ? sharesToSell / availableShares : 1;
      allocatedBuyComm = (Number(pos.commBuy) || 0) * sellRatio;
      allocatedMarginInterest = totalMargin * sellRatio;

      for (const tr of origTranches) {
        const trQty = Number(tr.qty ?? tr.shares ?? 0);
        const trPrice = Number(tr.price ?? tr.entryPrice ?? 0);
        if (rem <= 0) {
          nextPosTranches.push({ ...tr });
          continue;
        }
        if (trQty <= rem) {
          rem -= trQty;
          totalCostBasis += trQty * trPrice;
        } else {
          totalCostBasis += rem * trPrice;
          nextPosTranches.push({ ...tr, qty: trQty - rem, shares: trQty - rem });
          rem = 0;
        }
      }

      const nextPositions = { ...(s.positions || {}) };
      const remainingShares = nextPosTranches.reduce((sum, t) => sum + Number(t.qty ?? t.shares ?? 0), 0);

      if (remainingShares > 0) {
        nextPositions[symbol] = {
          ...pos,
          shares: remainingShares,
          commBuy: Math.max(0, (Number(pos.commBuy) || 0) - allocatedBuyComm),
          tranches: nextPosTranches
        };
      } else {
        delete nextPositions[symbol];
        if (s.activeView === symbol) {
          const remainingKeys = Object.keys(nextPositions);
          s.activeView = remainingKeys.length > 0 ? remainingKeys[0] : 'COMBINED';
        }
      }
      s.positions = nextPositions;
    }

    // 2. FIFO deduction on holdings[] array
    if (holding) {
      let rem = sharesToSell;
      let holdingCostBasis = 0;
      const nextHoldingTranches: Tranche[] = [];
      if (holding.tranches?.[0]?.purchaseDate) earliestDate = holding.tranches[0].purchaseDate;

      for (const t of holding.tranches || []) {
        if (rem <= 0) {
          nextHoldingTranches.push(t);
          continue;
        }
        if (t.shares <= rem) {
          rem -= t.shares;
          holdingCostBasis += t.shares * t.entryPrice;
        } else {
          holdingCostBasis += rem * t.entryPrice;
          nextHoldingTranches.push({ ...t, shares: t.shares - rem });
          rem = 0;
        }
      }
      if (totalCostBasis === 0) totalCostBasis = holdingCostBasis;

      s.holdings = (s.holdings || [])
        .map((h: Holding) => (h.ticker === symbol ? { ...h, tranches: nextHoldingTranches } : h))
        .filter((h: Holding) => (h.tranches || []).length > 0);
    }

    // 3. Calculate Proceeds, Commissions, and Closed Trade Record
    const grossProceeds = sharesToSell * exitPrice;
    const sellComm = calculateCommission(sharesToSell, grossProceeds, rules as any);
    const totalCommissions = allocatedBuyComm + sellComm;
    const netProceeds = grossProceeds - sellComm;
    const netGain = grossProceeds - totalCostBasis - totalCommissions - allocatedMarginInterest;

    const closedRecord = {
      id: Math.random().toString(36).slice(2, 9),
      ticker: symbol,
      shares: sharesToSell,
      avgBuyPrice: totalCostBasis / sharesToSell,
      entryPrice: totalCostBasis / sharesToSell,
      sellPrice: exitPrice,
      exitPrice,
      buyDate: earliestDate,
      purchaseDate: earliestDate,
      sellDate: exitDate,
      exitDate,
      grossProfit: grossProceeds - totalCostBasis,
      commissions: totalCommissions,
      totalCommissions,
      marginInterest: allocatedMarginInterest,
      netProfit: netGain,
      netRealizedGain: netGain
    };

    s.closedTrades = [closedRecord, ...(s.closedTrades || [])];
    s.closedHistory = [closedRecord, ...(s.closedHistory || [])];

    // 4. Apply Net Proceeds to Margin Debt first, then Free Cash
    const currentDebt = Number(s.balance) || 0; // negative or 0
    const currentFreeCash = Number(s.cashCushion?.freeCash) || 0;
    const nextSignedBalance = currentDebt + currentFreeCash + netProceeds;

    if (nextSignedBalance >= 0) {
      s.balance = 0;
      s.cashCushion = { ...(s.cashCushion || { holdings: [] }), freeCash: nextSignedBalance };
    } else {
      s.balance = nextSignedBalance;
      s.cashCushion = { ...(s.cashCushion || { holdings: [] }), freeCash: 0 };
    }
    s.cashBalance = nextSignedBalance;

    this.state = s;
    this.notify();
  }

  public removeTranche(ticker: string, trancheId: string): void {
    const symbol = ticker.toUpperCase();
    const s: any = { ...this.state };

    s.holdings = (s.holdings || [])
      .map((h: Holding) => {
        if (h.ticker !== symbol) return h;
        return { ...h, tranches: h.tranches.filter((t) => t.id !== trancheId) };
      })
      .filter((h: Holding) => h.tranches.length > 0);

    if (s.positions?.[symbol]) {
      const nextTranches = (s.positions[symbol].tranches || []).filter((t: any) => t.id !== trancheId);
      const nextPositions = { ...s.positions };
      if (nextTranches.length > 0) {
        nextPositions[symbol] = {
          ...nextPositions[symbol],
          shares: nextTranches.reduce((sum: number, t: any) => sum + Number(t.qty ?? t.shares ?? 0), 0),
          tranches: nextTranches
        };
      } else {
        delete nextPositions[symbol];
      }
      s.positions = nextPositions;
    }

    this.state = s;
    this.notify();
  }

  public updatePrice(ticker: string, price: number): void {
    const symbol = ticker.toUpperCase();
    const s: any = { ...this.state };

    s.holdings = (s.holdings || []).map((h: Holding) =>
      h.ticker === symbol ? { ...h, currentPrice: price } : h
    );

    if (s.positions?.[symbol]) {
      s.positions = {
        ...s.positions,
        [symbol]: { ...s.positions[symbol], currentPrice: price }
      };
    }

    if (Array.isArray(s.cashCushion?.holdings)) {
      s.cashCushion = {
        ...s.cashCushion,
        holdings: s.cashCushion.holdings.map((h: any) =>
          h.ticker === symbol ? { ...h, price, currentPrice: price } : h
        )
      };
    }

    this.state = s;
    this.notify();
  }

  public setTargetPrice(ticker: string, pt: number): void {
    const symbol = ticker.toUpperCase();
    const s: any = { ...this.state };
    if (!s.positions?.[symbol]) {
      throw new Error(`No open position found for ${symbol}.`);
    }
    s.positions = {
      ...s.positions,
      [symbol]: { ...s.positions[symbol], pt }
    };
    this.state = s;
    this.notify();
  }

  public addCashStock(ticker: string, shares: number, givenPrice = 0): void {
    const symbol = ticker.toUpperCase();
    const s: any = { ...this.state };
    if (!s.cashCushion) s.cashCushion = { freeCash: 0, holdings: [] };
    const holdings = Array.isArray(s.cashCushion.holdings) ? [...s.cashCushion.holdings] : [];

    const idx = holdings.findIndex((h: any) => h.ticker === symbol);
    if (idx > -1) {
      const existing = holdings[idx];
      holdings[idx] = {
        ...existing,
        shares: (Number(existing.shares) || 0) + shares,
        price: givenPrice > 0 ? givenPrice : Number(existing.price) || 0
      };
    } else {
      holdings.push({ ticker: symbol, shares, price: givenPrice });
    }

    s.cashCushion = { ...s.cashCushion, holdings };
    this.state = s;
    this.notify();
  }

  public removeCashStock(ticker: string): boolean {
    const symbol = ticker.toUpperCase();
    const s: any = { ...this.state };
    const holdings = s.cashCushion?.holdings;
    if (!Array.isArray(holdings)) return false;

    const idx = holdings.findIndex((h: any) => h.ticker === symbol);
    if (idx < 0) return false;

    const nextHoldings = [...holdings];
    nextHoldings.splice(idx, 1);
    s.cashCushion = { ...s.cashCushion, holdings: nextHoldings };
    this.state = s;
    this.notify();
    return true;
  }

  public importState(newState: Partial<PortfolioState> | Record<string, unknown>): void {
    this.state = { ...this.state, ...(newState as PortfolioState) };
    this.notify();
  }
}

export const portfolioStore = new Store();

export function usePortfolio(): PortfolioState {
  const [state, setState] = useState<PortfolioState>(() => portfolioStore.getState());

  useEffect(() => {
    return portfolioStore.subscribe((newState) => {
      setState({ ...newState });
    });
  }, []);

  return state;
}