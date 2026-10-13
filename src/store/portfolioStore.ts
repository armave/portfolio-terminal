import {
  PortfolioState,
  Tranche,
  Holding,
  BrokerRules,
  ApiKeys,
  PendingMutation
} from '../types/portfolio';
import { StorageService } from '../services/storage';

import { useState, useEffect } from 'preact/hooks';

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
    const loaded = StorageService.loadLocal(INITIAL_STATE) as Partial<PortfolioState>;
    this.state = {
      ...INITIAL_STATE,
      ...loaded,
      positions: loaded.positions || {},
      cashCushion: loaded.cashCushion || { freeCash: 0, holdings: [] },
      holdings: loaded.holdings || [],
      closedTrades: loaded.closedTrades || [],
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
    StorageService.saveLocal(this.state as any);
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  public setCashBalance(cashBalance: number): void {
    const freeCash = Math.max(0, cashBalance);
    const balance = Math.min(0, cashBalance);
    this.state = {
      ...this.state,
      cashBalance,
      balance,
      cashCushion: {
        ...(this.state.cashCushion || { holdings: [] }),
        freeCash
      }
    };
    this.notify();
  }

  public updateAssumptions(assumptions: Partial<BrokerRules>): void {
    this.state = {
      ...this.state,
      brokerAssumptions: { ...this.state.brokerAssumptions, ...assumptions }
    };
    this.notify();
  }

  public setSelectedTicker(ticker: string | null): void {
    this.state = {
      ...this.state,
      selectedTicker: ticker,
      activeView: ticker || 'COMBINED'
    };
    this.notify();
  }

  public addTranche(ticker: string, trancheData: Omit<Tranche, 'id'>, isMargin = true): void {
    const symbol = ticker.toUpperCase();
    const tranche: Tranche = {
      ...trancheData,
      id: Math.random().toString(36).substring(2, 9)
    };

    const existingIndex = this.state.holdings.findIndex((h: Holding) => h.ticker === symbol);
    const updatedHoldings = [...this.state.holdings];

    if (existingIndex > -1) {
      const current = updatedHoldings[existingIndex];
      updatedHoldings[existingIndex] = {
        ...current,
        tranches: [...current.tranches, tranche]
      };
    } else {
      updatedHoldings.push({
        ticker: symbol,
        isMargin,
        tranches: [tranche]
      });
    }

    this.state = { ...this.state, holdings: updatedHoldings };
    this.notify();
  }

  public removeTranche(ticker: string, trancheId: string): void {
    const symbol = ticker.toUpperCase();
    this.state = {
      ...this.state,
      holdings: this.state.holdings
        .map((h: Holding) => {
          if (h.ticker !== symbol) return h;
          return { ...h, tranches: h.tranches.filter((t: Tranche) => t.id !== trancheId) };
        })
        .filter((h: Holding) => h.tranches.length > 0)
    };
    this.notify();
  }

  public sellTranche(ticker: string, sharesToSell: number, exitPrice: number, exitDate: string): void {
    const symbol = ticker.toUpperCase();
    const holding = this.state.holdings.find((h: Holding) => h.ticker === symbol);
    if (!holding) return;

    let remainingToSell = sharesToSell;
    let totalCostBasis = 0;
    const newTranches: Tranche[] = [];

    for (const t of holding.tranches) {
      if (remainingToSell <= 0) {
        newTranches.push(t);
        continue;
      }
      if (t.shares <= remainingToSell) {
        remainingToSell -= t.shares;
        totalCostBasis += t.shares * t.entryPrice;
      } else {
        totalCostBasis += remainingToSell * t.entryPrice;
        newTranches.push({ ...t, shares: t.shares - remainingToSell });
        remainingToSell = 0;
      }
    }

    const grossProceeds = sharesToSell * exitPrice;
    const netGain = grossProceeds - totalCostBasis;

    const closedRecord = {
      id: Math.random().toString(36).slice(2, 9),
      ticker: symbol,
      shares: sharesToSell,
      entryPrice: totalCostBasis / sharesToSell,
      exitPrice,
      purchaseDate: holding.tranches[0]?.purchaseDate || exitDate,
      exitDate,
      netRealizedGain: netGain,
      totalCommissions: 0,
      holdingDays: 0
    };

    this.state = {
      ...this.state,
      cashBalance: this.state.cashBalance + grossProceeds,
      holdings: this.state.holdings
        .map((h: Holding) => (h.ticker === symbol ? { ...h, tranches: newTranches } : h))
        .filter((h: Holding) => h.tranches.length > 0),
      closedTrades: [closedRecord, ...this.state.closedTrades]
    };
    this.notify();
  }

  public updatePrice(ticker: string, price: number): void {
    const symbol = ticker.toUpperCase();
    const nextPositions = { ...this.state.positions };
    if (nextPositions[symbol]) {
      nextPositions[symbol] = { ...nextPositions[symbol], currentPrice: price };
    }

    this.state = {
      ...this.state,
      positions: nextPositions,
      holdings: this.state.holdings.map((h: Holding) =>
        h.ticker === symbol ? { ...h, currentPrice: price } : h
      )
    };
    this.notify();
  }

  public setPendingMutation(mutation: PendingMutation | null): void {
    this.state = { ...this.state, pendingMutation: mutation };
    this.notify();
  }

  public setApiKey(provider: keyof ApiKeys, key: string): void {
    this.state = {
      ...this.state,
      apiKeys: { ...this.state.apiKeys, [provider]: key }
    };
    this.notify();
  }

  public importState(newState: Partial<PortfolioState>): void {
    this.state = { ...this.state, ...newState };
    this.notify();
  }
}

export function usePortfolio(): PortfolioState {
  const [state, setState] = useState<PortfolioState>(portfolioStore.getState());

  useEffect(() => {
    return portfolioStore.subscribe((next) => {
      setState({ ...next });
    });
  }, []);

  return state;
}

export const portfolioStore = new Store();