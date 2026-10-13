import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type {
  BrokerAssumptions,
  MarginPosition,
  CashHolding,
  ClosedTrade,
  PortfolioState
} from '../types/portfolio';
import { pullCloudState, pushCloudState, fetchStockQuote } from '../services/api';

export const DEFAULT_BROKER_RULES: BrokerAssumptions = {
  annualMarginRate: 13.5,
  interestDayCount: 365,
  maintenanceMarginRatio: 0.25,
  stopOutRatio: 0.15,
  rolloverTime: '04:00',
  commissionPerShare: 0.012,
  commissionVolumeRatio: 0.0012,
  minimumCommission: 1.20
};

export type ActiveTab = 'margin' | 'balance' | 'history' | 'settings';

interface PortfolioContextValue {
  // State
  positions: MarginPosition[];
  cashHoldings: CashHolding[];
  closedTrades: ClosedTrade[];
  cashBalance: number;
  gatewaySecret: string;
  quoteRefreshInterval: number;
  brokerAssumptions: BrokerAssumptions;
  quotes: Record<string, any>;
  activeTab: ActiveTab;
  isSyncing: boolean;
  syncError: string | null;

  // Actions
  setActiveTab: (tab: ActiveTab) => void;
  setGatewaySecret: (secret: string) => void;
  setQuoteRefreshInterval: (interval: number) => void;
  setCashBalance: (balance: number) => void;
  setBrokerAssumptions: (rules: BrokerAssumptions) => void;
  resetBrokerAssumptions: () => void;
  syncFromCloud: (secretOverride?: string) => Promise<void>;
  saveToCloud: (secretOverride?: string) => Promise<boolean>;
  refreshAllQuotes: () => Promise<void>;
  addCashStock: (ticker: string, shares: number, price?: number) => void;
  removeCashStock: (ticker: string) => void;
  resetToBlank: () => void;
}

const PortfolioContext = createContext<PortfolioContextValue | undefined>(undefined);

const STORAGE_KEY_STATE = 'portfolioState';
const STORAGE_KEY_RULES = 'brokerAssumptions';

export const PortfolioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [positions, setPositions] = useState<MarginPosition[]>([]);
  const [cashHoldings, setCashHoldings] = useState<CashHolding[]>([]);
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>([]);
  const [cashBalance, setCashBalanceState] = useState<number>(0);
  const [gatewaySecret, setGatewaySecretState] = useState<string>('');
  const [quoteRefreshInterval, setQuoteRefreshIntervalState] = useState<number>(0);
  const [brokerAssumptions, setBrokerAssumptionsState] = useState<BrokerAssumptions>(DEFAULT_BROKER_RULES);
  const [quotes, setQuotes] = useState<Record<string, any>>({});
  const [activeTab, setActiveTab] = useState<ActiveTab>('margin');
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // 1. Initial LocalStorage Hydration
  useEffect(() => {
    try {
      const storedRules = localStorage.getItem(STORAGE_KEY_RULES);
      if (storedRules) {
        setBrokerAssumptionsState(JSON.parse(storedRules));
      }

      const storedState = localStorage.getItem(STORAGE_KEY_STATE);
      if (storedState) {
        const parsed: PortfolioState = JSON.parse(storedState);
        if (parsed.positions) setPositions(parsed.positions);
        if (parsed.cashHoldings) setCashHoldings(parsed.cashHoldings);
        if (parsed.closedTrades) setClosedTrades(parsed.closedTrades);
        if (typeof parsed.cashBalance === 'number') setCashBalanceState(parsed.cashBalance);
        if (parsed.gatewaySecret) setGatewaySecretState(parsed.gatewaySecret);
        if (typeof parsed.quoteRefreshInterval === 'number') {
          setQuoteRefreshIntervalState(parsed.quoteRefreshInterval);
        }

        // Silent background pull if secret was saved
        if (parsed.gatewaySecret) {
          pullCloudState(parsed.gatewaySecret)
            .then((cloudData) => {
              if (cloudData) applyState(cloudData);
            })
            .catch((err) => console.warn('[Auto-Sync Warning]', err.message));
        }
      }
    } catch (err) {
      console.error('[Hydration Error]', err);
    }
  }, []);

  // Helper to persist local snapshot
  const persistLocally = useCallback((overrides?: Partial<PortfolioState>, rulesOverride?: BrokerAssumptions) => {
    try {
      const currentState: PortfolioState = {
        positions,
        cashHoldings,
        closedTrades,
        cashBalance,
        gatewaySecret,
        quoteRefreshInterval,
        ...overrides
      };
      localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(currentState));
      if (rulesOverride) {
        localStorage.setItem(STORAGE_KEY_RULES, JSON.stringify(rulesOverride));
      }
    } catch (e) {
      console.error('[Storage Persist Error]', e);
    }
  }, [positions, cashHoldings, closedTrades, cashBalance, gatewaySecret, quoteRefreshInterval]);

  const applyState = useCallback((newState: PortfolioState) => {
    setPositions(newState.positions || []);
    setCashHoldings(newState.cashHoldings || []);
    setClosedTrades(newState.closedTrades || []);
    setCashBalanceState(Number(newState.cashBalance) || 0);
    if (newState.gatewaySecret !== undefined) setGatewaySecretState(newState.gatewaySecret);
    if (typeof newState.quoteRefreshInterval === 'number') {
      setQuoteRefreshIntervalState(newState.quoteRefreshInterval);
    }
    persistLocally(newState);
  }, [persistLocally]);

  // Cloud Actions
  const syncFromCloud = useCallback(async (secretOverride?: string) => {
    const secret = secretOverride ?? gatewaySecret;
    if (!secret?.trim()) {
      setSyncError('Gateway Secret is empty.');
      return;
    }

    setIsSyncing(true);
    setSyncError(null);
    try {
      const data = await pullCloudState(secret);
      if (data) {
        applyState(data);
      }
    } catch (err: any) {
      setSyncError(err.message || 'Cloud pull failed');
      throw err;
    } finally {
      setIsSyncing(false);
    }
  }, [gatewaySecret, applyState]);

  const saveToCloud = useCallback(async (secretOverride?: string): Promise<boolean> => {
    const secret = secretOverride ?? gatewaySecret;
    if (!secret?.trim()) {
      setSyncError('Gateway Secret is empty.');
      return false;
    }

    setIsSyncing(true);
    setSyncError(null);
    try {
      const stateToPush: PortfolioState = {
        positions,
        cashHoldings,
        closedTrades,
        cashBalance,
        quoteRefreshInterval
      };
      const ok = await pushCloudState(stateToPush, secret);
      persistLocally({ gatewaySecret: secret });
      return ok;
    } catch (err: any) {
      setSyncError(err.message || 'Cloud push failed');
      throw err;
    } finally {
      setIsSyncing(false);
    }
  }, [positions, cashHoldings, closedTrades, cashBalance, quoteRefreshInterval, gatewaySecret, persistLocally]);

  // Quotes Management
  const refreshAllQuotes = useCallback(async () => {
    const tickers = new Set<string>();
    positions.forEach((p) => tickers.add(p.ticker.toUpperCase()));
    cashHoldings.forEach((c) => tickers.add(c.ticker.toUpperCase()));

    if (tickers.size === 0) return;

    const updated: Record<string, any> = {};
    for (const t of tickers) {
      const quote = await fetchStockQuote(t, gatewaySecret);
      if (quote) updated[t] = quote;
    }

    setQuotes((prev) => ({ ...prev, ...updated }));
  }, [positions, cashHoldings, gatewaySecret]);

  // Auto Quote Refresh Polling
  useEffect(() => {
    if (quoteRefreshInterval <= 0) return;
    const timer = setInterval(() => {
      refreshAllQuotes().catch((e) => console.warn('[Auto-Quote Error]', e));
    }, quoteRefreshInterval);
    return () => clearInterval(timer);
  }, [quoteRefreshInterval, refreshAllQuotes]);

  // Local State Setters with Auto-Persist
  const setGatewaySecret = (secret: string) => {
    setGatewaySecretState(secret);
    persistLocally({ gatewaySecret: secret });
  };

  const setQuoteRefreshInterval = (interval: number) => {
    setQuoteRefreshIntervalState(interval);
    persistLocally({ quoteRefreshInterval: interval });
  };

  const setCashBalance = (balance: number) => {
    setCashBalanceState(balance);
    persistLocally({ cashBalance: balance });
  };

  const setBrokerAssumptions = (rules: BrokerAssumptions) => {
    setBrokerAssumptionsState(rules);
    localStorage.setItem(STORAGE_KEY_RULES, JSON.stringify(rules));
  };

  const resetBrokerAssumptions = () => {
    setBrokerAssumptionsState(DEFAULT_BROKER_RULES);
    localStorage.setItem(STORAGE_KEY_RULES, JSON.stringify(DEFAULT_BROKER_RULES));
  };

  const addCashStock = (ticker: string, shares: number, entryPrice?: number) => {
    const cleanTicker = ticker.trim().toUpperCase();
    if (!cleanTicker || shares <= 0) return;

    const existingIndex = cashHoldings.findIndex((h) => h.ticker.toUpperCase() === cleanTicker);
    let nextHoldings: CashHolding[];

    if (existingIndex >= 0) {
      nextHoldings = cashHoldings.map((h, i) =>
        i === existingIndex ? { ...h, shares: h.shares + shares } : h
      );
    } else {
      nextHoldings = [...cashHoldings, { ticker: cleanTicker, shares, entryPrice }];
    }

    setCashHoldings(nextHoldings);
    persistLocally({ cashHoldings: nextHoldings });
  };

  const removeCashStock = (ticker: string) => {
    const cleanTicker = ticker.trim().toUpperCase();
    const nextHoldings = cashHoldings.filter((h) => h.ticker.toUpperCase() !== cleanTicker);
    setCashHoldings(nextHoldings);
    persistLocally({ cashHoldings: nextHoldings });
  };

  const resetToBlank = () => {
    setPositions([]);
    setCashHoldings([]);
    setClosedTrades([]);
    setCashBalanceState(0);
    setQuotes({});
    localStorage.removeItem(STORAGE_KEY_STATE);
  };

  const value = useMemo(
    () => ({
      positions,
      cashHoldings,
      closedTrades,
      cashBalance,
      gatewaySecret,
      quoteRefreshInterval,
      brokerAssumptions,
      quotes,
      activeTab,
      isSyncing,
      syncError,
      setActiveTab,
      setGatewaySecret,
      setQuoteRefreshInterval,
      setCashBalance,
      setBrokerAssumptions,
      resetBrokerAssumptions,
      syncFromCloud,
      saveToCloud,
      refreshAllQuotes,
      addCashStock,
      removeCashStock,
      resetToBlank
    }),
    [
      positions,
      cashHoldings,
      closedTrades,
      cashBalance,
      gatewaySecret,
      quoteRefreshInterval,
      brokerAssumptions,
      quotes,
      activeTab,
      isSyncing,
      syncError,
      syncFromCloud,
      saveToCloud,
      refreshAllQuotes,
      persistLocally
    ]
  );

  return <PortfolioContext.Provider value={ value }> { children } </PortfolioContext.Provider>;
};

export function usePortfolio(): PortfolioContextValue {
  const context = useContext(PortfolioContext);
  if (!context) {
    throw new Error('usePortfolio must be used within a PortfolioProvider');
  }
  return context;
}