import { PortfolioState, Tranche, BrokerAssumptions } from '../types/portfolio';
import { StorageService } from '../services/storage';

export const DEFAULT_BROKER_ASSUMPTIONS: BrokerAssumptions = {
  annualBorrowRate: 0.0825,
  dayCountBasis: 360,
  dailyRolloverCutoffArmenia: '23:00',
  maintenanceEquityRatio: 0.25,
  stopOutRatio: 0.15,
  commissionMin: 1.0,
  commissionPerShare: 0.005,
  commissionRatePct: 0.001
};

export const INITIAL_STATE: PortfolioState = {
  cashBalance: 0,
  holdings: [],
  closedTrades: [],
  cashStocks: [],
  brokerAssumptions: DEFAULT_BROKER_ASSUMPTIONS,
  apiKeys: {},
  autoRefreshInterval: 0,
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
      brokerAssumptions: { ...DEFAULT_BROKER_ASSUMPTIONS, ...(loaded.brokerAssumptions || {}) }
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

  public setCashBalance(cashBalance: number): void {
    this.state = { ...this.state, cashBalance };
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
    this.state = { ...this.state, selectedTicker: ticker };
    this.notify();
  }

  public addTranche(ticker: string, trancheData: Omit<Tranche, 'id'>, isMargin = true): void {
    const symbol = ticker.toUpperCase();
    const tranche: Tranche = {
      ...trancheData,
      id: Math.random().toString(36).substring(2, 9)
    };

    const existingIndex = this.state.holdings.findIndex((h) => h.ticker === symbol);
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
        .map((h) => {
          if (h.ticker !== symbol) return h;
          return { ...h, tranches: h.tranches.filter((t) => t.id !== trancheId) };
        })
        .filter((h) => h.tranches.length > 0)
    };
    this.notify();
  }

  public sellTranche(ticker: string, sharesToSell: number, exitPrice: number, exitDate: string): void {
    const symbol = ticker.toUpperCase();
    const holding = this.state.holdings.find(h => h.ticker === symbol);
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
        .map(h => h.ticker === symbol ? { ...h, tranches: newTranches } : h)
        .filter(h => h.tranches.length > 0),
      closedTrades: [closedRecord, ...this.state.closedTrades]
    };
    this.notify();
  }

  public updatePrice(ticker: string, price: number): void {
    const symbol = ticker.toUpperCase();
    this.state = {
      ...this.state,
      holdings: this.state.holdings.map((h) =>
        h.ticker === symbol ? { ...h, currentPrice: price } : h
      )
    };
    this.notify();
  }

  public setPendingMutation(mutation: any | null): void {
    this.state = { ...this.state, pendingMutation: mutation };
    this.notify();
  }

  public setApiKey(provider: keyof PortfolioState['apiKeys'], key: string): void {
    this.state = { ...this.state, apiKeys: { ...this.state.apiKeys, [provider]: key } };
    this.notify();
  }

  public importState(newState: PortfolioState): void {
    this.state = { ...this.state, ...newState };
    this.notify();
  }
}

export const portfolioStore = new Store();