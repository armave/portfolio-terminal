import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { 
  createBlankState, 
  resolveTradeDateTimestamp, 
  resolveSaleQuantity, 
  realizeClosedTrade, 
  calculateCommission, 
  calculateCompoundedDebt, 
  calculateMarginInterest, 
  calculateBreakevenDays 
} from '../domain/portfolio';
import { evaluateIntent, parseAiIntent } from '../features/ai/intent';
import { buildIntentPrompt } from '../features/ai/prompt';
import { fetchYahooStockData, proxyFetch, setSecretGetter, syncCloudState as syncCloudStateService } from '../services/api.js';
import { 
  loadSavedState, 
  saveState, 
  loadBrokerRules, 
  saveBrokerRules, 
  clearBrokerRules, 
  saveGatewaySecret, 
  loadGatewaySecret, 
  areHeaderCredentialsConfigured, 
  getQuoteRefreshInterval, 
  saveQuoteRefreshInterval 
} from '../services/storage.js';
import { useNotifications } from '../contexts/NotificationContext';
import { formatUSD, getTotalPortfolioInvested, getActivePrice } from '../utils';

const DEFAULT_TRADERNET_RULES = {
  broker: "Freedom Broker Armenia (Tradernet)",
  annualRate: 0.1500,
  dayCountBasis: 365,
  rolloverHour: 4,
  rolloverMinute: 0,
  rolloverTimeZone: "Asia/Yerevan",
  maintenanceMarginRatio: 0.10,
  stopOutRatio: 0.00,
  commPerShare: 0.012,
  commVolumePct: 0.0012,
  minCommOrder: 1.20
};

export const PortfolioContext = createContext<any>(null);

export const PortfolioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { showToast, logTerminal } = useNotifications();
  const [isAppInitialized, setIsAppInitialized] = useState(false);
  const [state, setState] = useState(() => loadSavedState(createBlankState()));
  const [rules, setRules] = useState(() => ({ ...DEFAULT_TRADERNET_RULES, ...loadBrokerRules() }));
  const [cloudStatus, setCloudStatus] = useState({ status: 'idle', text: 'ADD SECRET' });
  const [refreshInterval, setRefreshInterval] = useState(() => getQuoteRefreshInterval(60000));
  const [marketInsightsOpen, setMarketInsightsOpen] = useState(false);
  const [activeInsightSection, setActiveInsightSection] = useState('news');
  
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const rulesRef = useRef(rules);
  useEffect(() => { rulesRef.current = rules; }, [rules]);

  const mutateState = useCallback((mutator: (draft: any) => void) => {
    setState((prev: any) => {
      const next = JSON.parse(JSON.stringify(prev));
      mutator(next);
      saveState(JSON.parse(JSON.stringify(next)), pushStateToCloud);
      return next;
    });
  }, []);

  const pushStateToCloud = useCallback(async (forceImmediate = false) => {
    if (!areHeaderCredentialsConfigured()) {
      setCloudStatus({ status: 'idle', text: 'ADD SECRET' });
      return;
    }
    setCloudStatus({ status: 'syncing', text: 'WRITING...' });
    try {
      const ok = await syncCloudStateService('push', {
        state: stateRef.current,
        getState: () => stateRef.current,
        showToast,
        logTerminal
      });
      setCloudStatus(ok ? { status: 'synced', text: 'UPDATED' } : { status: 'error', text: 'FAIL' });
    } catch (err: any) {
      logTerminal(`[KV Cloud Sync Error]: ${err.message}`);
      setCloudStatus({ status: 'error', text: 'FAIL' });
    }
  }, [showToast, logTerminal]);

  const syncCloudState = useCallback(async (mode = 'push') => {
    return syncCloudStateService(mode, {
      state: stateRef.current,
      getState: () => stateRef.current,
      pullCloudAndRewriteLocal: (parsedState: any) => {
        mutateState((draft: any) => {
          const currentView = draft.activeView;
          Object.assign(draft, parsedState);
          if (!parsedState?.activeView && currentView) draft.activeView = currentView;
        });
      },
      showToast,
      logTerminal
    });
  }, [mutateState, showToast, logTerminal]);

  const initApp = async (secret: string) => {
    if (secret) {
      saveGatewaySecret(secret);
      setSecretGetter(() => secret);
      mutateState((draft: any) => { draft.gatewaySecret = secret; });
      await syncCloudState('pull');
    }
    setIsAppInitialized(true);
  };

  useEffect(() => {
    const secret = loadGatewaySecret();
    if (secret) {
      setSecretGetter(() => secret);
      initApp(secret);
    }
  }, []);

  const setActiveView = (view: string) => {
    mutateState((draft: any) => { draft.activeView = view === 'BALANCE' ? 'CASH_CUSHION' : (view || 'COMBINED'); });
  };

  const recordTrackedPrice = (draft: any, ticker: string, price: number, sourceName: string, updatedAt: number | null = null, quoteDetails: any = null) => {
    const symbol = ticker.toUpperCase();
    let matched = false;
    const updateQuoteMetadata = (holding: any) => {
      holding.quoteSource = sourceName;
      if (updatedAt === null) delete holding.quoteUpdatedAt; else holding.quoteUpdatedAt = updatedAt;
      if (quoteDetails) holding.quoteDetails = quoteDetails; else delete holding.quoteDetails;
    };
    if (draft.positions[symbol]) {
      draft.positions[symbol].currentPrice = price;
      updateQuoteMetadata(draft.positions[symbol]);
      matched = true;
    }
    const cashHolding = draft.cashCushion?.holdings?.find((h: any) => h.ticker === symbol);
    if (cashHolding) {
      cashHolding.price = price;
      cashHolding.currentPrice = price;
      updateQuoteMetadata(cashHolding);
      matched = true;
    }
    return matched;
  };

  const fetchLivePrice = async (ticker: string, silent = false) => {
    const symbol = ticker.toUpperCase();
    try {
      const data = await fetchYahooStockData(symbol);
      const priceObj = data?.price || data;
      if (priceObj && (priceObj.current > 0 || priceObj.regularMarketPrice > 0)) {
        const current = priceObj.current ?? priceObj.regularMarketPrice ?? priceObj.price;
        const prevClose = priceObj.previousClose ?? priceObj.regularMarketPreviousClose;
        const change = priceObj.change ?? priceObj.regularMarketChange ?? (current - prevClose);
        const quoteDetails = { 
          price: current, 
          current, 
          change, 
          changePercent: prevClose ? (change / prevClose) * 100 : 0,
          marketState: priceObj.marketState,
          preMarketPrice: priceObj.preMarketPrice,
          postMarketPrice: priceObj.postMarketPrice
        };
        const activePrice = getActivePrice(quoteDetails);
        
        mutateState((draft: any) => {
          recordTrackedPrice(draft, symbol, activePrice, "Yahoo Proxy", Date.now(), quoteDetails);
        });
        if (!silent) logTerminal(`[Yahoo Proxy]: ${symbol} updated to $${formatUSD(activePrice)}.`);
        return activePrice;
      }
    } catch (e: any) {
      if (!silent) logTerminal(`[Market Data Error]: Could not fetch ${symbol}. ${e.message}`);
    }
    return null;
  };

  const refreshAllLivePrices = async () => {
    const cashHoldings = stateRef.current.cashCushion?.holdings || [];
    const allTickers = new Set([...Object.keys(stateRef.current.positions || {}), ...cashHoldings.map((h: any) => h.ticker)]);
    const tickersArray = Array.from(allTickers);
    if (tickersArray.length === 0) return;
    
    logTerminal(`[System]: Polling batch live quotes for ${tickersArray.join(',')}...`);
    try {
      const responseData = await fetchYahooStockData(tickersArray.join(','));
      const results = Array.isArray(responseData) ? responseData : [responseData];
      let updatedCount = 0;
      
      mutateState((draft: any) => {
        for (const data of results) {
          if (!data || data.error) continue;
          const priceObj = data.price || data;
          if (!priceObj || (!priceObj.current && !priceObj.regularMarketPrice && !priceObj.price)) continue;
          
          const ticker = data.symbol;
          const current = priceObj.current ?? priceObj.regularMarketPrice ?? priceObj.price;
          const previous = priceObj.previousClose ?? priceObj.regularMarketPreviousClose;
          const change = priceObj.change ?? priceObj.regularMarketChange ?? (current - previous);
          const quoteDetails = { 
            price: current, 
            current, 
            change, 
            changePercent: previous ? (change / previous) * 100 : 0,
            marketState: priceObj.marketState,
            preMarketPrice: priceObj.preMarketPrice,
            postMarketPrice: priceObj.postMarketPrice
          };
          const activePrice = getActivePrice(quoteDetails);
          
          if (recordTrackedPrice(draft, ticker, activePrice, "Yahoo Proxy", Date.now(), quoteDetails)) {
            updatedCount++;
          }
        }
      });
      if (updatedCount > 0) logTerminal(`[System]: Live market quotes refreshed for ${updatedCount} assets.`);
    } catch (err: any) {
      logTerminal(`[Market Data Error]: Batch fetch failed - ${err.message}`);
    }
  };

  useEffect(() => {
    if (refreshInterval > 0) {
      const timer = setInterval(() => { if (!document.hidden) refreshAllLivePrices(); }, refreshInterval);
      return () => clearInterval(timer);
    }
  }, [refreshInterval]);

  const getDailyRate = () => rulesRef.current.annualRate / rulesRef.current.dayCountBasis;

  const runLadderSimulation = (data: any, targetState: any) => {
    const positions = targetState?.positions || {};
    const ticker = data.ticker || (targetState.activeView !== "COMBINED" && targetState.activeView !== "CASH_CUSHION" && targetState.activeView !== "CLOSED_HISTORY" ? targetState.activeView : Object.keys(positions)[0]);
    const pos = positions[ticker];
    if (!pos || pos.shares <= 0) {
      logTerminal(`[Ladder Error]: No active position found for ${ticker}.`);
      return;
    }

    const totalInvested = (pos.tranches || []).reduce((sum: number, t: any) => sum + (t.qty * t.price), 0);
    const portfolioInvested = getTotalPortfolioInvested(targetState);
    const weight = portfolioInvested > 0 ? (totalInvested / portfolioInvested) : 1;

    let runningDebt = Math.abs(targetState.balance) * weight;
    let totalAccruedMargin = calculateMarginInterest(targetState.tranches || pos.tranches || [], {
      dailyRate: getDailyRate(),
      marginDebt: runningDebt,
      totalDebt: Math.abs(targetState.balance)
    });
    let totalComms = pos.commBuy;
    let totalGrossProceeds = 0;
    let currentDay = 0;

    const stepsRender: string[] = [];

    data.steps.forEach((step: any, idx: number) => {
      const stepDays = Math.max(0, step.days - currentDay);
      if (stepDays > 0 && runningDebt > 0) {
        const compounded = calculateCompoundedDebt(runningDebt, getDailyRate(), stepDays);
        totalAccruedMargin += calculateMarginInterest(runningDebt, getDailyRate(), stepDays);
        runningDebt = compounded;
      }
      currentDay = step.days;

      const proceeds = step.shares * step.price;
      totalGrossProceeds += proceeds;
      const commSell = calculateCommission(step.shares, proceeds, rulesRef.current);
      totalComms += commSell;

      const netCashCredited = proceeds - commSell;
      runningDebt = Math.max(0, runningDebt - netCashCredited);

      stepsRender.push(`
        <div class="border-l-2 border-cyan-500/50 pl-2 space-y-0.5">
          <div class="text-slate-200 font-semibold">Stage ${idx + 1} (${step.label || '+' + step.days + 'd'}): Sell ${step.shares} @ $${formatUSD(step.price)}</div>
          <div class="text-slate-400">Proceeds: $${formatUSD(proceeds)} | Comm: $${formatUSD(commSell)} | Remaining Debt: <span class="text-rose-400 font-mono">-$${formatUSD(runningDebt)}</span></div>
        </div>
      `);
    });

    const grossPnl = totalGrossProceeds - totalInvested;
    const netPnl = grossPnl - totalComms - totalAccruedMargin;
    const netPct = totalInvested > 0 ? (netPnl / totalInvested) * 100 : 0;
    const netColor = netPnl >= 0 ? "text-emerald-400" : "text-rose-400";
    const netSign = netPnl >= 0 ? "+" : "";

    const html = `
      <div class="border border-purple-800/80 bg-purple-950/20 p-3 rounded my-2 text-xs space-y-2">
        <div class="font-bold text-purple-300 border-b border-purple-800/60 pb-1 flex justify-between items-center">
          <span>[LADDERED SCALE-OUT SIMULATION]: ${ticker}</span>
          <span class="${netColor} font-black text-sm">${netSign}$${formatUSD(netPnl)} (${netSign}${netPct.toFixed(2)}% Net)</span>
        </div>
        <div class="space-y-1.5 py-1">
          ${stepsRender.join('')}
        </div>
        <div class="border-t border-purple-800/60 pt-1.5 grid grid-cols-2 gap-2 text-slate-300">
          <div><span class="text-slate-500">Gross Proceeds:</span> $${formatUSD(totalGrossProceeds)} (Gross: ${grossPnl >= 0 ? '+' : ''}$${formatUSD(grossPnl)})</div>
          <div><span class="text-slate-500">Total Comms:</span> $${formatUSD(totalComms)}</div>
          <div><span class="text-slate-500">Accrued Margin Drag:</span> <span class="text-rose-400">$${formatUSD(totalAccruedMargin)}</span></div>
          <div><span class="text-slate-500">Debt Reduction Benefit:</span> <span class="text-emerald-400 font-semibold">Reduced Bleed Applied</span></div>
        </div>
      </div>
    `;
    logTerminal(html, false, true);
  };

  const runComparison = (data: any, targetState: any) => {
    const positions = targetState?.positions || {};
    const ticker = data.ticker || (targetState.activeView !== "COMBINED" && targetState.activeView !== "CASH_CUSHION" && targetState.activeView !== "CLOSED_HISTORY" ? targetState.activeView : Object.keys(positions)[0]);
    const pos = positions[ticker];
    if (!pos || pos.shares <= 0) {
      logTerminal(`[Comparison Error]: No active position found for ${ticker}.`);
      return;
    }

    const totalInvested = (pos.tranches || []).reduce((sum: number, t: any) => sum + (t.qty * t.price), 0);
    const portfolioInvested = getTotalPortfolioInvested(targetState);
    const weight = portfolioInvested > 0 ? (totalInvested / portfolioInvested) : 1;
    const debtToUse = Math.abs(targetState.balance) * weight;
    const marginChargedToUse = calculateMarginInterest(targetState.tranches || pos.tranches || [], {
      dailyRate: getDailyRate(),
      marginDebt: debtToUse,
      totalDebt: Math.abs(targetState.balance)
    });

    const computed = data.scenarios.map((s: any) => {
      const grossProceeds = pos.shares * s.price;
      const grossPnl = grossProceeds - totalInvested;
      const commSell = calculateCommission(pos.shares, grossProceeds, rulesRef.current);
      const totalComms = pos.commBuy + commSell;

      const additionalMargin = calculateMarginInterest(debtToUse, getDailyRate(), s.days);
      const totalMargin = marginChargedToUse + additionalMargin;

      const netPnl = grossPnl - totalComms - totalMargin;
      const netPct = (netPnl / totalInvested) * 100;
      const resultingBalance = targetState.balance + (grossProceeds - commSell);

      return {
        ...s,
        grossProceeds,
        grossPnl,
        commSell,
        totalComms,
        totalMargin,
        additionalMargin,
        netPnl,
        netPct,
        resultingBalance
      };
    });

    const sA = computed[0];
    const sB = computed[1];
    const diffNet = sB.netPnl - sA.netPnl;
    const diffMargin = sB.totalMargin - sA.totalMargin;

    const diffColor = diffNet >= 0 ? "text-emerald-400 font-black" : "text-rose-400 font-black";
    const diffSign = diffNet >= 0 ? "+" : "";

    const html = `
      <div class="border border-cyan-800 bg-cyan-950/20 p-3 rounded my-2 text-xs space-y-3">
        <div class="font-bold text-cyan-300 border-b border-cyan-800/60 pb-1 flex justify-between items-center">
          <span>[COMPARISON]: ${pos.shares} ${ticker} — ${sA.label} VS ${sB.label}</span>
          <span class="${diffColor}">Diff: ${diffSign}$${formatUSD(diffNet)} Net</span>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div class="bg-slate-900/60 p-2.5 rounded border border-slate-800 space-y-1">
            <div class="font-bold text-slate-200 border-b border-slate-800 pb-1 flex justify-between">
              <span>${sA.label}</span>
              <span class="${sA.netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${sA.netPnl >= 0 ? '+' : ''}$${formatUSD(sA.netPnl)} (${sA.netPct.toFixed(2)}%)</span>
            </div>
            <div><span class="text-slate-500">Gross Proceeds:</span> $${formatUSD(sA.grossProceeds)}</div>
            <div><span class="text-slate-500">Commissions:</span> $${formatUSD(sA.totalComms)}</div>
            <div><span class="text-slate-500">Margin Accrued:</span> $${formatUSD(sA.totalMargin)}</div>
            <div><span class="text-slate-500">Resulting Balance:</span> <span class="${sA.resultingBalance >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${sA.resultingBalance >= 0 ? '+' : '-'}$${formatUSD(Math.abs(sA.resultingBalance))}</span></div>
          </div>

          <div class="bg-slate-900/60 p-2.5 rounded border border-slate-800 space-y-1">
            <div class="font-bold text-slate-200 border-b border-slate-800 pb-1 flex justify-between">
              <span>${sB.label}</span>
              <span class="${sB.netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${sB.netPnl >= 0 ? '+' : ''}$${formatUSD(sB.netPnl)} (${sB.netPct.toFixed(2)}%)</span>
            </div>
            <div><span class="text-slate-500">Gross Proceeds:</span> $${formatUSD(sB.grossProceeds)}</div>
            <div><span class="text-slate-500">Commissions:</span> $${formatUSD(sB.totalComms)}</div>
            <div><span class="text-slate-500">Margin Accrued:</span> $${formatUSD(sB.totalMargin)} (+${formatUSD(sB.additionalMargin)})</div>
            <div><span class="text-slate-500">Resulting Balance:</span> <span class="${sB.resultingBalance >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${sB.resultingBalance >= 0 ? '+' : '-'}$${formatUSD(Math.abs(sB.resultingBalance))}</span></div>
          </div>
        </div>

        <div class="text-[11px] text-slate-400 border-t border-slate-800 pt-1.5 flex justify-between">
          <span>Tradernet margin penalty for waiting: <strong class="text-rose-400">+$${formatUSD(diffMargin)}</strong></span>
          <span>Net advantage: <strong class="${diffColor}">${diffSign}$${formatUSD(diffNet)}</strong></span>
        </div>
      </div>
    `;

    logTerminal(html, false, true);
  };

  const runSimulation = (simPrice: number, daysOffset: number, label: string, tickerTarget: string | null, targetState: any) => {
    const positions = targetState?.positions || {};
    const ticker = tickerTarget || (targetState.activeView !== "COMBINED" && targetState.activeView !== "CASH_CUSHION" && targetState.activeView !== "CLOSED_HISTORY" ? targetState.activeView : Object.keys(positions)[0]);
    const pos = positions[ticker];
    if (!pos || pos.shares <= 0) {
      logTerminal(`[Simulation Error]: No active position open for ${ticker}.`);
      return;
    }

    const totalInvested = (pos.tranches || []).reduce((sum: number, t: any) => sum + (t.qty * t.price), 0);
    const grossProceeds = pos.shares * simPrice;
    const grossPnl = grossProceeds - totalInvested;
    const commSell = calculateCommission(pos.shares, grossProceeds, rulesRef.current);
    const totalComms = pos.commBuy + commSell;

    const portfolioInvested = getTotalPortfolioInvested(targetState);
    const weight = portfolioInvested > 0 ? (totalInvested / portfolioInvested) : 1;
    const debtToUse = Math.abs(targetState.balance) * weight;

    const additionalMargin = calculateMarginInterest(debtToUse, getDailyRate(), daysOffset);
    const currentMarginInterest = calculateMarginInterest(targetState.tranches || pos.tranches || [], {
      dailyRate: getDailyRate(),
      marginDebt: debtToUse,
      totalDebt: Math.abs(targetState.balance)
    });
    const totalMarginAtDate = currentMarginInterest + additionalMargin;

    const netPnl = grossPnl - totalComms - totalMarginAtDate;
    const netPct = totalInvested > 0 ? (netPnl / totalInvested) * 100 : 0;
    const resultingBalance = (targetState.balance + (grossProceeds - commSell));

    const netColor = netPnl >= 0 ? "text-emerald-400" : "text-rose-400";
    const netSign = netPnl >= 0 ? "+" : "";
    const balColor = resultingBalance >= 0 ? "text-emerald-400" : "text-rose-400";
    const balSign = resultingBalance >= 0 ? "+" : "-";

    const html = `
      <div class="border border-cyan-800/80 bg-cyan-950/20 p-3 rounded my-2 text-xs space-y-1">
        <div class="font-bold text-cyan-300 flex justify-between border-b border-cyan-800/50 pb-1">
          <span>[SIMULATION]: Sell ${pos.shares} ${ticker} @ $${formatUSD(simPrice)} (${label})</span>
          <span class="${netColor} font-black">${netSign}$${formatUSD(netPnl)} (${netSign}${netPct.toFixed(2)}%)</span>
        </div>
        <div class="grid grid-cols-2 gap-2 text-slate-300 pt-1">
          <div><span class="text-slate-500">Gross Proceeds:</span> $${formatUSD(grossProceeds)} (Gross: ${grossPnl >= 0 ? '+' : ''}$${formatUSD(grossPnl)})</div>
          <div><span class="text-slate-500">Commissions:</span> $${formatUSD(totalComms)} ($${formatUSD(pos.commBuy)} buy / $${formatUSD(commSell)} sell)</div>
          <div><span class="text-slate-500">Margin Accrued:</span> $${formatUSD(totalMarginAtDate)} (+$${formatUSD(additionalMargin)} over ${daysOffset}d)</div>
          <div><span class="text-slate-500">Resulting Balance:</span> <span class="${balColor} font-semibold">${balSign}$${formatUSD(Math.abs(resultingBalance))}</span></div>
        </div>
      </div>
    `;
    logTerminal(html, false, true);
  };

  const confirmAiPortfolioAction = (action: any) => {
    let ticker = typeof action.ticker === 'string' ? action.ticker.trim().toUpperCase() : '';
    if (!ticker && ['set_pt', 'set_price'].includes(action.action)) {
      ticker = stateRef.current.positions[stateRef.current.activeView] ? stateRef.current.activeView : Object.keys(stateRef.current.positions)[0] || '';
    }
    const validTicker = /^[A-Z0-9._:-]+$/.test(ticker);
    const isPositiveFinite = (value: any) => Number.isFinite(Number(value)) && Number(value) > 0;
    const isFiniteNumber = (value: any) =>
      value !== null &&
      value !== undefined &&
      !(typeof value === 'string' && value.trim() === '') &&
      Number.isFinite(Number(value));
    const actionsWithTicker = ['buy', 'sell', 'set_pt', 'set_price', 'add_cash_stock', 'remove_cash_stock'];
    if (actionsWithTicker.includes(action.action) && !validTicker) {
      logTerminal('[AI Action Error]: Gemini returned an invalid ticker. No changes were made.');
      return false;
    }

    if (action.action === 'buy' && (!isPositiveFinite(action.shares) || !isPositiveFinite(action.price))) {
      logTerminal('[AI Action Error]: Gemini returned an invalid buy quantity or price. No changes were made.');
      return false;
    }
    if (action.action === 'sell' &&
      ((action.shares !== null && action.shares !== undefined && !isPositiveFinite(action.shares)) ||
        !isPositiveFinite(action.price))) {
      logTerminal('[AI Action Error]: Gemini returned an invalid sale quantity or price. No changes were made.');
      return false;
    }
    if ((action.action === 'set_pt' && !isPositiveFinite(action.pt)) ||
      (action.action === 'set_price' && !isPositiveFinite(action.price))) {
      logTerminal('[AI Action Error]: Gemini returned an invalid price. No changes were made.');
      return false;
    }
    if (action.action === 'add_cash_stock' &&
      (!isPositiveFinite(action.shares) ||
        (action.price != null && (!Number.isFinite(Number(action.price)) || Number(action.price) < 0)))) {
      logTerminal('[AI Action Error]: Gemini returned invalid cash holding details. No changes were made.');
      return false;
    }
    if (action.action === 'set_balance' && !isFiniteNumber(action.balance)) {
      logTerminal('[AI Action Error]: Gemini returned an invalid margin balance. No changes were made.');
      return false;
    }
    if (action.action === 'set_free_cash' && !isFiniteNumber(action.amount)) {
      logTerminal('[AI Action Error]: Gemini returned an invalid account balance. No changes were made.');
      return false;
    }

    const details: any = {
      buy: `Buy ${action.shares} ${ticker} at $${action.price}?`,
      sell: `Sell ${action.shares == null ? 'all' : action.shares} ${ticker} at $${action.price}?`,
      set_pt: `Set ${ticker}'s target price to $${action.pt}?`,
      set_price: `Set ${ticker}'s tracked market price to $${action.price}?`,
      set_balance: `Set margin debt/balance to ${action.balance}?`,
      set_free_cash: `Set account balance/debt to ${action.amount}?`,
      add_cash_stock: `Add ${action.shares} shares of ${ticker} to cash holdings?`,
      remove_cash_stock: `Remove ${ticker} from cash holdings?`
    };
    const message = details[action.action];
    if (!message) {
      logTerminal(`[AI Action Error]: Unsupported action "${action.action}". No changes were made.`);
      return false;
    }
    return window.confirm(`Gemini interpreted your input as this portfolio change:\n\n${message}\n\nApply it?`);
  };

  const applyPortfolioActions = async (action: any) => {
    const todayDateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

    mutateState((draft: any) => {
      if (action.action === "buy") {
        const ticker = action.ticker.toUpperCase();
        const shares = Number(action.shares);
        const price = Number(action.price);
        const tradeCost = shares * price;
        const buyComm = calculateCommission(shares, tradeCost, rulesRef.current);
        const totalOutlay = tradeCost + buyComm;

        if (!draft.positions[ticker]) {
          draft.positions[ticker] = {
            ticker: ticker,
            shares: 0,
            tranches: [],
            currentPrice: price,
            quoteSource: 'Trade input',
            pt: action.pt ? Number(action.pt) : Number((price * 1.05).toFixed(2)),
            commBuy: 0,
            startDate: new Date().toISOString().split('T')[0]
          };
        }

        const pos = draft.positions[ticker];
        pos.shares += shares;
        pos.tranches.push({
          qty: shares,
          price: price,
          date: action.date || todayDateStr,
          acquiredAt: resolveTradeDateTimestamp(action.date),
          buyCommission: buyComm
        });
        pos.commBuy += buyComm;
        pos.currentPrice = price;
        pos.quoteSource = 'Trade input';
        delete pos.quoteUpdatedAt;
        delete pos.quoteDetails;
        if (action.pt) pos.pt = Number(action.pt);

        const currentFreeCash = Number(draft.cashCushion?.freeCash) || 0;
        const cashUsed = Math.min(currentFreeCash, totalOutlay);
        const debtAdded = totalOutlay - cashUsed;

        if (cashUsed > 0) {
          draft.cashCushion.freeCash = currentFreeCash - cashUsed;
        }

        draft.balance = draft.balance - debtAdded;
        draft.activeView = ticker;

        logTerminal(`[Executed Buy]: Added ${shares} ${ticker} @ $${formatUSD(price)}. Outlay: $${formatUSD(totalOutlay)} (Comm: $${formatUSD(buyComm)}). Funded: $${formatUSD(cashUsed)} cash | +$${formatUSD(debtAdded)} margin debt. Free Cash remaining: $${formatUSD(draft.cashCushion.freeCash)}. Total Margin Debt: -$${formatUSD(Math.abs(draft.balance))}.`);
        showToast(`${shares} ${ticker} bought at $${formatUSD(price)}.`, 'success');
      }
      else if (action.action === "sell") {
        const ticker = action.ticker.toUpperCase();
        let pos = draft.positions[ticker];
        let isCashHolding = false;
        let cashHoldingIdx = -1;

        if (!pos && draft.cashCushion && draft.cashCushion.holdings) {
          cashHoldingIdx = draft.cashCushion.holdings.findIndex((h: any) => h.ticker === ticker);
          if (cashHoldingIdx !== -1) {
            isCashHolding = true;
            pos = draft.cashCushion.holdings[cashHoldingIdx];
          }
        }

        if (!pos) {
          logTerminal(`[Error]: Position ${ticker} not found to close.`);
          return;
        }

        const hasRequestedShares = action.shares !== null && action.shares !== undefined;
        let sharesToSell;
        try {
          sharesToSell = resolveSaleQuantity(
            Number(pos.shares),
            hasRequestedShares ? Number(action.shares) : null
          );
        } catch (error: any) {
          logTerminal(`[Sell Error]: ${error.message}`);
          showToast(error.message, 'error');
          return;
        }

        const sellPrice = Number(action.price);
        if (!Number.isFinite(sellPrice) || sellPrice <= 0) {
          logTerminal(`[Sell Error]: Enter a valid sale price greater than zero for ${ticker}.`);
          showToast('Sale price must be greater than zero.', 'error');
          return;
        }
        const grossProceeds = sharesToSell * sellPrice;
        const sellComm = calculateCommission(sharesToSell, grossProceeds, rulesRef.current);
        const netCashCredited = grossProceeds - sellComm;

        const currentDebt = Math.abs(draft.balance);
        let debtRepaid = 0;
        let cashSurplus = 0;

        if (currentDebt > 0) {
          debtRepaid = Math.min(currentDebt, netCashCredited);
          draft.balance = currentDebt > debtRepaid ? -(currentDebt - debtRepaid) : 0;
          cashSurplus = netCashCredited - debtRepaid;
        } else {
          cashSurplus = netCashCredited;
        }

        if (cashSurplus > 0) {
          if (!draft.cashCushion) draft.cashCushion = { freeCash: 0.00, holdings: [] };
          draft.cashCushion.freeCash = (Number(draft.cashCushion.freeCash) || 0) + cashSurplus;
        }

        const resultMessage = `${sharesToSell} ${ticker} sold at $${formatUSD(sellPrice)}.`;

        if (isCashHolding) {
          if (sharesToSell >= pos.shares) {
            draft.cashCushion.holdings.splice(cashHoldingIdx, 1);
            logTerminal(`[Cash Holding Closed]: Sold ${sharesToSell} ${ticker} @ $${formatUSD(sellPrice)}. Net credited: +$${formatUSD(netCashCredited)} (Debt paid: $${formatUSD(debtRepaid)}, Free Cash added: $${formatUSD(cashSurplus)}).`);
          } else {
            pos.shares -= sharesToSell;
            logTerminal(`[Cash Holding Partial Sell]: Sold ${sharesToSell} ${ticker} @ $${formatUSD(sellPrice)}. Remaining: ${pos.shares} shares.`);
          }
        } else {
          const realizedTrade = realizeClosedTrade(pos, ticker, sharesToSell, sellPrice, sellComm, Date.now());
          delete realizedTrade.position.marginCharged;
          draft.positions[ticker] = realizedTrade.position;
          if (realizedTrade.trade) draft.closedTrades.push(realizedTrade.trade);
          draft.realizedMarginCharged = (draft.realizedMarginCharged || 0) + realizedTrade.marginFee;

          if (realizedTrade.position.shares <= 1e-8) {
            delete draft.positions[ticker];
            draft.activeView = "COMBINED";
            logTerminal(`[Position Closed]: Sold ${sharesToSell} ${ticker} @ $${formatUSD(sellPrice)}. Net credited: +$${formatUSD(netCashCredited)} (Debt paid: $${formatUSD(debtRepaid)}, Free Cash added: $${formatUSD(cashSurplus)}). Remaining Debt: -$${formatUSD(Math.abs(draft.balance))}. Free Cash: $${formatUSD(draft.cashCushion.freeCash)}.`);
          } else {
            logTerminal(`[Partial Sell]: Sold ${sharesToSell} ${ticker} @ $${formatUSD(sellPrice)}. Net credited: +$${formatUSD(netCashCredited)} (Debt paid: $${formatUSD(debtRepaid)}, Free Cash added: $${formatUSD(cashSurplus)}). Remaining: ${realizedTrade.position.shares} shares.`);
          }
        }
        showToast(resultMessage, 'success');
      }
      else if (action.action === "set_pt") {
        const ticker = (action.ticker ? action.ticker.toUpperCase() : null) || (draft.activeView !== "COMBINED" && draft.activeView !== "CASH_CUSHION" && draft.activeView !== "CLOSED_HISTORY" ? draft.activeView : Object.keys(draft.positions)[0]);
        if (ticker && draft.positions[ticker] && Number(action.pt) > 0) {
          draft.positions[ticker].pt = Number(action.pt);
          logTerminal(`[Target Updated]: ${ticker} PT updated to $${formatUSD(action.pt)}.`);
        }
      }
      else if (action.action === "set_price") {
        const ticker = (action.ticker ? action.ticker.toUpperCase() : null) || (draft.activeView !== "COMBINED" && draft.activeView !== "CASH_CUSHION" && draft.activeView !== "CLOSED_HISTORY" ? draft.activeView : Object.keys(draft.positions)[0]);
        const newP = Number(action.price);
        if (!newP || isNaN(newP) || newP <= 0) {
          logTerminal(`[Price Unchanged]: No valid price amount supplied. Enter: price ${ticker} <number>.`);
          return;
        }
        if (ticker && recordTrackedPrice(draft, ticker, newP, 'Manual')) {
          logTerminal(`[Price Updated]: ${ticker} market price set to $${formatUSD(newP)}.`);
        }
      }
      else if (action.action === "set_balance") {
        draft.balance = -Math.abs(Number(action.balance));
        logTerminal(`[Margin Synced]: Total margin balance explicitly set to -$${formatUSD(Math.abs(draft.balance))}.`);
      }
      else if (action.action === "set_free_cash") {
        const val = Number(action.amount);
        draft.cashCushion.freeCash = Math.max(0, val);
        draft.balance = Math.min(0, val);
        logTerminal(`[Balance]: Current balance/debt updated. Balance: $${formatUSD(draft.cashCushion.freeCash)} | Margin debt: -$${formatUSD(Math.abs(draft.balance))}.`);
      }
      else if (action.action === "add_cash_stock") {
        const ticker = action.ticker.toUpperCase();
        const shares = Number(action.shares);
        const givenPrice = Number(action.price) || 0;
        
        if (!draft.cashCushion) draft.cashCushion = { freeCash: 0, holdings: [] };
        if (!Array.isArray(draft.cashCushion.holdings)) draft.cashCushion.holdings = [];
        const existing = draft.cashCushion.holdings.find((h: any) => h.ticker === ticker);
        const currentPrice = givenPrice > 0 ? givenPrice : (Number(existing?.price) || 0);

        if (existing) {
          existing.shares = (Number(existing.shares) || 0) + shares;
        } else {
          draft.cashCushion.holdings.push({ ticker, shares, price: currentPrice });
        }
        if (givenPrice > 0) recordTrackedPrice(draft, ticker, givenPrice, 'Manual');
        
        logTerminal(`[Balance]: Added ${shares} ${ticker} to balance holdings. Syncing online quote...`);
        setTimeout(() => fetchLivePrice(ticker), 100);
      }
      else if (action.action === "remove_cash_stock") {
        const ticker = action.ticker.toUpperCase();
        if (draft.cashCushion?.holdings) {
          const idx = draft.cashCushion.holdings.findIndex((h: any) => h.ticker === ticker);
          if (idx >= 0) {
            draft.cashCushion.holdings.splice(idx, 1);
            logTerminal(`[Balance]: Removed ${ticker} from balance holdings.`);
          }
        }
      }
    });
  };

  const executeCommand = async (text: string) => {
    if (!text.trim()) return;
    logTerminal(text, true);
    
    if (/^(?:pull|sync cloud|cloud pull|pull cloud|load cloud)$/i.test(text)) {
      await syncCloudState('pull');
      return;
    }
    const balanceMatch = text.match(/^(?:b:|balance:?)\s*(-?\d+(?:\.\d+)?)$/i);
    if (balanceMatch) {
      const val = Number(balanceMatch[1]);
      mutateState((draft: any) => {
        draft.cashCushion.freeCash = Math.max(0, val);
        draft.balance = Math.min(0, val);
      });
      showToast(`Balance updated`, 'success');
      return;
    }
    const quoteMatch = text.match(/^(?:quote|price of|fetch price|get price)\s+([A-Za-z]+)$/i);
    if (quoteMatch) {
      fetchLivePrice(quoteMatch[1].toUpperCase());
      return;
    }

    try {
      const prompt = buildIntentPrompt({
        text,
        state: stateRef.current,
        activeTickers: Object.keys(stateRef.current.positions || {}),
        activeView: stateRef.current.activeView,
        today: new Date().toISOString().split("T")[0]
      });
      const data = await proxyFetch('gemini', {}, { method: "POST", body: JSON.stringify({ prompt }) });
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error("No response content generated by Gemini.");

      const parsed = evaluateIntent(parseAiIntent(rawText, stateRef.current), stateRef.current);
      
      if (parsed.intent === "ladder") {
        runLadderSimulation(parsed, stateRef.current);
        logTerminal("[Ladder Exit Evaluated via Gemini Proxy]");
      } else if (parsed.intent === "comparison") {
        runComparison(parsed, stateRef.current);
        logTerminal("[Comparison Evaluated via Gemini Proxy]");
      } else if (parsed.intent === "simulation") {
        runSimulation(parsed.simPrice, parsed.daysOffset, parsed.label, parsed.ticker, stateRef.current);
        logTerminal("[Simulation Evaluated via Gemini Proxy]");
      } else if (parsed.intent === "fetch_quote") {
        const tickerToFetch = parsed.ticker ? parsed.ticker.toUpperCase() : (stateRef.current.activeView !== "COMBINED" && stateRef.current.activeView !== "CASH_CUSHION" && stateRef.current.activeView !== "CLOSED_HISTORY" ? stateRef.current.activeView : Object.keys(stateRef.current.positions || {})[0]);
        if (tickerToFetch) fetchLivePrice(tickerToFetch as string);
        else logTerminal("[Notice]: No active ticker specified to fetch quote for.");
      } else if (parsed.intent === "action") {
        if (confirmAiPortfolioAction(parsed)) {
          await applyPortfolioActions(parsed);
        } else {
          logTerminal("[AI Action]: Cancelled. No portfolio changes were made.");
        }
      } else if (parsed.intent === "chat") {
        logTerminal(`[AI Advisor]: ${parsed.response}`);
      }
    } catch (err: any) {
      logTerminal(`[Error]: ${err.message}`);
    }
  };

  const getCombinedBreakeven = () => {
    const tickers = Object.keys(state.positions);
    const totalDebt = Math.abs(state.balance);
    let totalGrossTarget = 0, totalInvested = 0, totalComms = 0, totalMarginCharged = state.realizedMarginCharged || 0;
    const dailyRate = rules.annualRate / rules.dayCountBasis;

    tickers.forEach(t => {
      const pos = state.positions[t];
      if (pos && pos.shares > 0) {
        const cost = (pos.tranches || []).reduce((sum: number, tr: any) => sum + (tr.qty * tr.price), 0);
        totalInvested += cost;
        const valSell = pos.shares * pos.pt;
        totalGrossTarget += (valSell - cost);
        totalComms += (pos.commBuy || 0) + calculateCommission(pos.shares, valSell, rules);
      }
    });

    const tranchesForCombined = state.tranches || tickers.flatMap(t => state.positions[t]?.tranches || []);
    totalMarginCharged += calculateMarginInterest(tranchesForCombined, { dailyRate, marginDebt: totalDebt, totalDebt });
    const netTargetProfit = totalGrossTarget - totalComms - totalMarginCharged;

    if (tickers.length === 0 || totalInvested === 0) return "Combined Breakeven: No active trades";
    if (totalDebt <= 0) return "Combined Breakeven: No margin debt";
    if (netTargetProfit <= 0) return "Combined Breakeven: 0 days (Net Target ≤ $0)";
    if (dailyRate === 0) return "Combined Breakeven: 0 days (no ongoing margin interest)";

    const beDays = calculateBreakevenDays(netTargetProfit, totalDebt, dailyRate);
    if (beDays === null) return "Combined Breakeven: N/A";
    const beDate = new Date();
    beDate.setDate(beDate.getDate() + beDays);
    return `Combined Breakeven: ${beDays} days (${beDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})`;
  };

  return (
    <PortfolioContext.Provider value={{
      state, mutateState, rules, setRules, cloudStatus, isAppInitialized, initApp,
      setActiveView, fetchLivePrice, refreshAllLivePrices, executeCommand, syncCloudState,
      refreshInterval, setRefreshInterval, getCombinedBreakeven,
      marketInsightsOpen, setMarketInsightsOpen, activeInsightSection, setActiveInsightSection
    }}>
      {children}
    </PortfolioContext.Provider>
  );
};

export const usePortfolio = () => useContext(PortfolioContext);
