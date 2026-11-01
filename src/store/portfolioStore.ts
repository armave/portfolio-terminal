import { useState, useEffect } from 'preact/hooks';
import {
  PortfolioState,
  PositionRecord,
  Holding,
  Tranche,
  TrancheItem,
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
import { calculateCommission, calculateMarginInterest, normalizePortfolioTranche, createBlankState, resolveCommissionConfig } from '../domain/portfolio';
import { DEFAULT_BROKER_ASSUMPTIONS, normalizeBrokerAssumptions } from '../domain/brokerAssumptions';

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
  // Index compatibility metadata once. The previous per-position find() scanned
  // the full legacy array for every ticker, which made normalization quadratic.
  // Keep the first matching row to preserve Array.find() compatibility semantics.
  const legacyByTicker = new Map<string, Holding>();
  for (const holding of Array.isArray(legacyHoldings) ? legacyHoldings : []) {
    const legacyTicker = String(holding?.ticker || '').trim().toUpperCase();
    if (legacyTicker && !legacyByTicker.has(legacyTicker)) {
      legacyByTicker.set(legacyTicker, holding);
    }
  }

  return Object.keys(positions).map((ticker) => {
    const position = positions[ticker];
    const legacy = legacyByTicker.get(ticker);
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

  // Index the latest local exit once instead of scanning the full trade history
  // for every legacy holding. Keep the same date-field precedence and zero fallback
  // as the former per-holding filter/map/reduce sequence.
  const latestCloseByTicker = new Map<string, number>();
  for (const trade of localClosedTrades) {
    const ticker = String(trade?.ticker || '').trim().toUpperCase();
    if (!ticker) continue;

    const value = trade.closedAt ?? trade.exitDate ?? trade.sellDate ?? trade.date;
    const timestamp = typeof value === 'number' ? value : Date.parse(String(value || ''));
    const normalizedTimestamp = Number.isFinite(timestamp) ? timestamp : 0;
    const previousTimestamp = latestCloseByTicker.get(ticker) ?? 0;
    if (normalizedTimestamp > previousTimestamp) {
      latestCloseByTicker.set(ticker, normalizedTimestamp);
    }
  }

  const safeHoldings = legacyHoldings.filter((holding) => {
    const ticker = String(holding?.ticker || '').trim().toUpperCase();
    if (!ticker || localPositions[ticker]) return false;

    const latestClose = latestCloseByTicker.get(ticker) ?? 0;
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

/** Shared broker commission calculation for all confirmed stock-sale paths. */
function calculateSaleCommission(shares: number, proceeds: number, rules: BrokerAssumptions): number {
  const { commPerShare, commVolumePct, minCommOrder } = resolveCommissionConfig(rules);
  const fallback = Number(Math.max(minCommOrder, shares * commPerShare + proceeds * commVolumePct).toFixed(2));

  try {
    const calculated = calculateCommission(shares, proceeds, {
      commPerShare,
      commVolumePct,
      minCommOrder
    });
    return Number.isFinite(calculated) && calculated > 0
      ? Number(calculated.toFixed(2))
      : fallback;
  } catch {
    return fallback;
  }
}

/** Shared debt-first allocation of net sale proceeds. */
function settleSaleProceeds(
  debt: number,
  freeCash: number,
  netProceeds: number
): { remainingDebt: number; freeCash: number; debtRepaid: number; cashSurplus: number } {
  const normalizedDebt = Math.max(0, Number(debt) || 0);
  const normalizedCash = Math.max(0, Number(freeCash) || 0);
  const normalizedProceeds = Math.max(0, Number(netProceeds) || 0);
  const debtRepaid = Math.min(normalizedDebt, normalizedProceeds);
  const cashSurplus = Math.max(0, normalizedProceeds - debtRepaid);

  return {
    remainingDebt: Math.max(0, normalizedDebt - debtRepaid),
    freeCash: normalizedCash + cashSurplus,
    debtRepaid,
    cashSurplus
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
    const savedRules = loadBrokerRules();
    const refreshInterval = getQuoteRefreshInterval();

    const raw: PortfolioState = {
      positions: saved?.positions || {},
      // Operation-level cash/margin choices are canonical portfolio data and must survive reloads/cloud pulls.
      activeTrancheTypes: saved?.activeTrancheTypes && typeof saved.activeTrancheTypes === 'object'
        ? saved.activeTrancheTypes
        : {},
      activeTrancheMixes: saved?.activeTrancheMixes && typeof saved.activeTrancheMixes === 'object'
        ? saved.activeTrancheMixes
        : {},
      activeTrancheGuestAssignments: saved?.activeTrancheGuestAssignments && typeof saved.activeTrancheGuestAssignments === 'object'
        ? saved.activeTrancheGuestAssignments
        : {},
      activeTrancheGuestAssignmentDetails: saved?.activeTrancheGuestAssignmentDetails &&
        typeof saved.activeTrancheGuestAssignmentDetails === 'object'
        ? saved.activeTrancheGuestAssignmentDetails
        : {},
      closedTradeAllocations: saved?.closedTradeAllocations && typeof saved.closedTradeAllocations === 'object' && !Array.isArray(saved.closedTradeAllocations)
        ? saved.closedTradeAllocations
        : {},
      guestPortfolioSnapshot: saved?.guestPortfolioSnapshot && typeof saved.guestPortfolioSnapshot === 'object'
        ? saved.guestPortfolioSnapshot
        : undefined,
      guestTrancheLedger: Array.isArray(saved?.guestTrancheLedger) ? saved.guestTrancheLedger : [],
      cashCushion: saved?.cashCushion || { freeCash: 0, holdings: [] },
      balance: Number.isFinite(Number(saved?.balance)) ? Number(saved?.balance) : 0,
      realizedMarginCharged: Number.isFinite(Number(saved?.realizedMarginCharged))
        ? Number(saved?.realizedMarginCharged)
        : 0,
      tranches: saved?.tranches || [],
      startDate: saved?.startDate || todayIso(),
      // Keep navigation preference local to this device; cloud state must not
      // overwrite the user's current view on another device.
      activeView: this.readDeviceActiveView() || saved?.activeView || 'COMBINED',
      closedTrades: Array.isArray(saved?.closedTrades) ? saved!.closedTrades : [],
      brokerExecutedTrades: Array.isArray(saved?.brokerExecutedTrades) ? saved!.brokerExecutedTrades : [],
      cashflows: Array.isArray(saved?.cashflows) ? saved!.cashflows : [],
      brokerAssumptions: normalizeBrokerAssumptions(
        savedRules,
        normalizeBrokerAssumptions(saved?.brokerAssumptions)
      ),
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
    const candidatePositions = raw.positions && typeof raw.positions === 'object' && !Array.isArray(raw.positions)
      ? raw.positions
      : {};
    // A partially written or old snapshot must not make normalization crash or
    // expose malformed records as active positions.
    const sourcePositions = Object.fromEntries(
      Object.entries(candidatePositions).filter(([ticker, position]) => {
        if (!ticker || !position || typeof position !== 'object' || Array.isArray(position)) return false;
        const shares = Number((position as PositionRecord).shares);
        return Number.isFinite(shares) && shares > 0;
      }).map(([ticker, position]) => {
        const record = position as PositionRecord;
        const cleanTicker = String(record.ticker || ticker).trim().toUpperCase();
        return [cleanTicker, {
          ...record,
          ticker: cleanTicker,
          shares: Number(record.shares),
          currentPrice: Number.isFinite(Number(record.currentPrice)) ? Number(record.currentPrice) : 0,
          pt: Number.isFinite(Number(record.pt)) ? Number(record.pt) : 0,
          commBuy: Number.isFinite(Number(record.commBuy)) ? Number(record.commBuy) : 0,
          tranches: Array.isArray(record.tranches)
            ? record.tranches
              .filter((tranche) => tranche && typeof tranche === 'object' && !Array.isArray(tranche))
              .map((tranche) => normalizePortfolioTranche(tranche as unknown as Record<string, unknown>))
              .filter((tranche) => tranche.qty > 0 && tranche.price > 0)
            : []
        }];
      })
    ) as Record<string, PositionRecord>;
    const positions = allowLegacyMigration
      ? migrateLegacyHoldingsToPositions(sourcePositions, legacyHoldings)
      : { ...sourcePositions };
    const holdings = buildHoldingsProjection(positions, legacyHoldings);

    const cashCushion = raw.cashCushion && typeof raw.cashCushion === 'object' && !Array.isArray(raw.cashCushion)
      ? raw.cashCushion
      : { freeCash: 0, holdings: [] };
    const assignmentDetails = raw.activeTrancheGuestAssignmentDetails &&
      typeof raw.activeTrancheGuestAssignmentDetails === 'object' && !Array.isArray(raw.activeTrancheGuestAssignmentDetails)
      ? raw.activeTrancheGuestAssignmentDetails
      : {};
    const guestTrancheLedger = Array.isArray(raw.guestTrancheLedger)
      ? raw.guestTrancheLedger.filter((record) => record && typeof record === 'object' && !Array.isArray(record))
      : [];
    const rawFreeCash = Number(cashCushion.freeCash ?? raw.cashBalance);
    const freeCash = Number.isFinite(rawFreeCash) ? Math.max(0, rawFreeCash) : 0;
    const cashHoldings = Array.isArray(cashCushion.holdings)
      ? cashCushion.holdings.filter((holding) =>
          holding && typeof holding === 'object' && !Array.isArray(holding) &&
          typeof holding.ticker === 'string' && holding.ticker.trim().length > 0 &&
          Number.isFinite(Number(holding.shares)) && Number(holding.shares) > 0
        )
      : [];

    // Cloud hydration runs after the initial constructor state and can otherwise
    // overwrite the device's chosen desk with an older cloud activeView.
    const deviceView = this.readDeviceActiveView();
    const requestedView = deviceView || (typeof raw.activeView === 'string' ? raw.activeView : 'COMBINED');
    const supportedViews = ['COMBINED', 'CASH_CUSHION', 'BALANCE', 'CLOSED_HISTORY', 'GUEST_HISTORY', 'SETTINGS'];
    const activeView = supportedViews.includes(requestedView) || positions[requestedView]
      ? requestedView
      : 'COMBINED';

    return {
      ...raw,
      brokerAssumptions: normalizeBrokerAssumptions(raw.brokerAssumptions),
      activeView,
      positions,
      holdings,
      activeTrancheGuestAssignments: raw.activeTrancheGuestAssignments &&
        typeof raw.activeTrancheGuestAssignments === 'object' && !Array.isArray(raw.activeTrancheGuestAssignments)
        ? raw.activeTrancheGuestAssignments
        : {},
      activeTrancheGuestAssignmentDetails: assignmentDetails,
      guestTrancheLedger,
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

  private notify(persist = true): void {
    if (persist) saveState(this.state);
    this.listeners.forEach((listener) => listener(this.state));
  }

  public update(updater: (state: PortfolioState) => PortfolioState, persist = true): void {
    const next = updater(this.state);

    // Treat a returned current-state reference as an explicit no-op. Besides
    // avoiding unnecessary storage writes, this prevents rejected stale quote
    // responses and invalid commands from notifying every subscriber.
    if (next === this.state) return;

    this.state = this.normalizeState({
      ...next,
      lastUpdated: Date.now()
    });
    this.notify(persist);
  }

  public setState(partial: Partial<PortfolioState>, persist = true): void {
    this.update((state) => ({
      ...state,
      ...partial
    }), persist);
  }

  public importState(newState: Partial<PortfolioState>): void {
    this.update((state) => ({
      ...state,
      ...newState
    }));
  }

  /**
   * Clear portfolio and broker-history data while preserving device/account configuration.
   * Broker rules, provider keys, the signed-in Gateway Secret, and refresh preferences
   * are settings rather than portfolio content and intentionally remain in place.
   */
  public resetToBlankState(now = Date.now(), persist = true): void {
    // The selected desk is device-local and also participates in normalization.
    // Update it before normalization; a caller using persist=false can roll it back
    // if the subsequent multi-record snapshot transaction fails.
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('portfolio_active_view', 'COMBINED');
    } catch {
      // Continue resetting portfolio data when browser preference storage is unavailable.
    }
    this.update((state) => ({
      ...state,
      ...createBlankState(now),
      // The domain factory uses its MarginPosition type; the store boundary keeps PositionRecord.
      positions: {} as Record<string, PositionRecord>,
      cashCushion: {
        freeCash: 0,
        holdings: [] as PortfolioState['cashCushion']['holdings']
      },
      activeTrancheTypes: {},
      activeTrancheMixes: {},
      activeTrancheGuestAssignments: {},
      activeTrancheGuestAssignmentDetails: {},
      closedTradeAllocations: {},
      guestPortfolioSnapshot: undefined,
      brokerAccountInfo: undefined,
      portfolioEquity: undefined,
      portfolioEquityUpdatedAt: undefined,
      brokerExecutedTrades: [],
      cashflows: [],
      closedHistory: [],
      tranches: [],
      cashStocks: [],
      selectedTicker: null,
      pendingMutation: null
    }), persist);
  }

  private readDeviceActiveView(): string | null {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem('portfolio_active_view') : null;
    } catch {
      return null;
    }
  }

  public setActiveView(view: string): void {
    // Keep the preference on this device for immediate restoration, and also
    // persist it in canonical portfolio state so the existing Worker sync saves it.
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('portfolio_active_view', view);
    } catch {
      // Navigation still works if browser storage is unavailable.
    }
    this.update((state) => {
      if (state.activeView === view && state.selectedTicker === view) return state;
      return { ...state, activeView: view, selectedTicker: view };
    });
  }

  public selectTicker(ticker: string | null): void {
    this.setState({
      selectedTicker: ticker,
      activeView: ticker || 'COMBINED'
    });
  }

  public updateAssumptions(rules: unknown): void {
    this.update((state) => {
      const merged = normalizeBrokerAssumptions(rules, state.brokerAssumptions || DEFAULT_BROKER_ASSUMPTIONS);
      saveBrokerRules(merged);
      return { ...state, brokerAssumptions: merged };
    });
  }

  /** Persist a rollover boundary through the canonical store. */
  public setLastRolloverTimestamp(timestamp: number): void {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return;
    this.update((state) => ({
      ...state,
      lastRolloverTimestamp: timestamp
    }));
  }

  /**
   * Atomically commits accrued rollover debt and its accounting timestamp.
   * Realized charges are tracked separately only when no open investment can
   * carry the interest in the active-position calculations.
   */
  public applyRollover(
    compoundedDebt: number,
    interestAccrued: number,
    timestamp: number,
    recordAsRealized: boolean
  ): void {
    if (![compoundedDebt, interestAccrued, timestamp].every(Number.isFinite) ||
      compoundedDebt < 0 || interestAccrued < 0 || timestamp <= 0) return;

    this.update((state) => ({
      ...state,
      balance: compoundedDebt > 0 ? -compoundedDebt : 0,
      lastRolloverTimestamp: timestamp,
      realizedMarginCharged: Math.max(0, Number(state.realizedMarginCharged) || 0) +
        (recordAsRealized ? interestAccrued : 0)
    }));
  }

  /** Set the cash-cushion balance without changing margin debt. */
  public setFreeCash(amount: number): void {
    const num = Number(amount);
    if (!Number.isFinite(num) || num < 0) {
      throw new Error('Free cash must be a finite non-negative amount.');
    }

    this.update((state) => ({
      ...state,
      cashBalance: num,
      cashCushion: {
        ...(state.cashCushion || { freeCash: 0, holdings: [] }),
        freeCash: num
      }
    }));
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
    if (!clean || !Number.isFinite(shares) || shares <= 0 || !Number.isFinite(price) || price <= 0) return;

    const purchaseDate = date || todayIso();

    this.update((state) => {

      const totalVal = shares * price;

      // Extract broker commission rules with safe fallbacks
      const rules = state.brokerAssumptions || DEFAULT_BROKER_ASSUMPTIONS;

      // A buyStock call represents one broker execution, so enforce the minimum
      // ticket commission here rather than recalculating across the combined position.
      const buyComm = Number(calculateCommission(
        shares, totalVal, resolveCommissionConfig(rules)
      ).toFixed(2));

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
        // A confirmed execution price is newer than any previously fetched
        // quote. Invalidate quote metadata so an older in-flight response cannot
        // visually overwrite the latest trade.
        currentPrice: price,
        pt:
          pt !== undefined && Number.isFinite(pt) && pt > 0
            ? pt
            : existingPos?.pt || Number((price * 1.1).toFixed(2)),
        commBuy: nextCommBuy,
        startDate: earliestPosDate,
        tranches: nextTranches,
        quoteSource: 'Trade input',
        quoteUpdatedAt: undefined,
        quoteDetails: undefined,
        quoteRequestStartedAt: undefined,
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
    this.applyMarginSale(ticker, sharesToSell, sellPrice, date);
  }

  private applyMarginSale(
    ticker: string,
    sharesToSell: number | 'ALL',
    sellPrice: number,
    date?: string,
    options: { closedAt?: number } = {}
  ): { ticker: string; sharesSold: number; remainingShares: number; netProceeds: number; debtRepaid: number; cashSurplus: number } | null {
    const clean = ticker.trim().toUpperCase();
    if (!clean || !Number.isFinite(sellPrice) || sellPrice <= 0) return null;
    if (sharesToSell !== 'ALL' && (!Number.isFinite(sharesToSell) || sharesToSell <= 0)) return null;

    let result: { ticker: string; sharesSold: number; remainingShares: number; netProceeds: number; debtRepaid: number; cashSurplus: number } | null = null;

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
      const dailyRate = rules.annualBorrowRate / rules.dayCountBasis;

      let remainingToSell = actualSold;
      let soldCostBasis = 0;
      let buyCommAllocated = 0;
      const updatedTranches: TrancheItem[] = [];
      const origTranches = pos.tranches || [
        { qty: pos.shares, price: pos.currentPrice, date: pos.startDate }
      ];
      const hasPerTrancheCommissions = origTranches.length > 0 && origTranches.every(
        (tranche) => Number.isFinite(Number(tranche.buyCommission))
      );
      const earliestBuyDate =
        origTranches[0]?.date || pos.startDate || state.startDate || todayIso();

      for (const tr of origTranches) {
        const trQty = Number(tr.qty ?? tr.shares) || 0;
        const trPrice = Number(tr.price ?? tr.entryPrice) || 0;

        if (remainingToSell <= 0) {
          updatedTranches.push({ ...tr });
          continue;
        }

        const take = Math.min(trQty, remainingToSell);
        soldCostBasis += take * trPrice;
        remainingToSell -= take;

        const trancheBuyCommission = hasPerTrancheCommissions
          ? Math.max(0, Number(tr.buyCommission) || 0)
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

      // Shared with the AI-confirmed sale path to keep broker fees consistent.
      const sellComm = calculateSaleCommission(actualSold, sellProceeds, rules);

      // Debt and margin interest calculation
      const totalPortfolioInvested = Object.values(positions).reduce(
        (acc, p) =>
          acc +
          (p.tranches || []).reduce(
            (s, t) =>
              s +
              (Number(t.qty ?? t.shares) || 0) *
              (Number(t.price ?? t.entryPrice) || 0),
            0
          ),
        0
      );
      const posInvested = origTranches.reduce(
        (s, t) =>
          s +
          (Number(t.qty ?? t.shares) || 0) *
          (Number(t.price ?? t.entryPrice) || 0),
        0
      );
      const weight = totalPortfolioInvested > 0 ? posInvested / totalPortfolioInvested : 1;
      const totalDebt = Math.abs(Number(state.balance) || 0);
      const allocatedDebt = totalDebt * weight;

      let posMarginInterest = 0;
      try {
        posMarginInterest = calculateMarginInterest(origTranches, {
          dailyRate,
          marginDebt: allocatedDebt,
          totalDebt
        });
      } catch {
        posMarginInterest = 0;
      }
      // Keep any already-recorded position charge if the current accrual is lower.
      posMarginInterest = Math.max(posMarginInterest, Number(pos.marginCharged) || 0);
      const marginInterestAllocated = Number((posMarginInterest * sellRatio).toFixed(2));

      const totalCommissions = Number((buyCommAllocated + sellComm).toFixed(2));
      const grossProfit = Number((sellProceeds - soldCostBasis).toFixed(2));
      const netProfit = Number((grossProfit - totalCommissions - marginInterestAllocated).toFixed(2));
      // Rollover interest is already reflected in state.balance before a sale.
      // Keep it in realized P&L, but do not subtract it a second time from cash proceeds.
      const netCashProceeds = Number((sellProceeds - sellComm).toFixed(2));

      const settlement = settleSaleProceeds(
        totalDebt,
        Number(state.cashCushion?.freeCash) || 0,
        netCashProceeds
      );
      const currentDebt = settlement.remainingDebt;
      const freeCash = settlement.freeCash;

      const remainingShares = pos.shares - actualSold;
      if (remainingShares <= 0 || updatedTranches.length === 0) {
        delete positions[clean];
      } else {
        const remainingPosition = {
          ...pos,
          shares: remainingShares,
          commBuy: Math.max(0, (Number(pos.commBuy) || 0) - buyCommAllocated),
          tranches: updatedTranches
        };
        // The sold slice has been realized below; do not carry a one-shot
        // margin charge forward and count it again on the next partial exit.
        delete remainingPosition.marginCharged;
        positions[clean] = remainingPosition;
      }

      const exitDateStr = date || todayIso();
      const buyTimestamp = new Date(earliestBuyDate).getTime();
      const exitTimestamp = new Date(exitDateStr).getTime();
      const holdingDays = Math.max(
        0,
        Math.round(Math.abs(exitTimestamp - buyTimestamp) / 86400000)
      );
      const requestedClosedAt = Number(options.closedAt);
      const closedTimestamp = Number.isFinite(requestedClosedAt) && requestedClosedAt > 0
        ? requestedClosedAt
        : Number.isFinite(exitTimestamp) ? exitTimestamp : Date.now();

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
      result = {
        ticker: clean,
        sharesSold: actualSold,
        remainingShares: Math.max(0, Number(remainingShares) || 0),
        netProceeds: netCashProceeds,
        debtRepaid: settlement.debtRepaid,
        cashSurplus: settlement.cashSurplus
      };

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
        realizedMarginCharged: Math.max(0, Number(state.realizedMarginCharged) || 0) + marginInterestAllocated,
        closedTrades: [closedRecord, ...(state.closedTrades || [])]
      };
    });

    return result;
  }

  /**
   * Applies a completed quote request to the latest store snapshot.
   * This avoids applying a stale state object captured before an async request.
   */
  public updateLiveQuote(
    ticker: string,
    quote: { price?: number; currentPrice?: number; quoteUpdatedAt?: number; quoteSource?: string; quoteDetails?: Record<string, unknown>; requestStartedAt?: number; requestSequence?: number }
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
      const requestSequence = quote.requestSequence ?? (Number(quote.quoteDetails?.requestSequence) || undefined);
      const latestRequestSequence = Math.max(
        Number(position?.quoteRequestSequence) || 0,
        ...cashHoldings.filter((holding) => holding.ticker.toUpperCase() === clean)
          .map((holding) => Number(holding.quoteRequestSequence) || 0),
        ...cashStocks.filter((holding) => holding.ticker.toUpperCase() === clean)
          .map((holding) => Number(holding.quoteRequestSequence) || 0)
      );

      // Requests can finish out of order. Apply a response only if it started
      // after the last accepted request for this ticker, and never over a trade.
      if (
        (requestSequence !== undefined && latestRequestSequence > 0 && requestSequence < latestRequestSequence) ||
        (requestSequence === undefined && quote.requestStartedAt !== undefined && quote.requestStartedAt < latestRequestStartedAt) ||
        (requestSequence === undefined && quote.requestStartedAt !== undefined && quote.requestStartedAt === latestRequestStartedAt && latestRequestSequence > 0)
      ) {
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
          ...(requestSequence !== undefined ? { quoteRequestSequence: requestSequence } : {}),
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
              ...(requestSequence !== undefined ? { quoteRequestSequence: requestSequence } : {}),
              quoteSource: quote.quoteSource ?? 'Live quote',
              ...(quote.quoteDetails ? { quoteDetails: quote.quoteDetails } : {}) }
          : holding
      );
      const updatedCashStocks = cashStocks.map((holding) =>
        holding.ticker.toUpperCase() === clean
          ? { ...holding, currentPrice: price, quoteRequestStartedAt: requestStartedAt,
              ...(requestSequence !== undefined ? { quoteRequestSequence: requestSequence } : {}) }
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
    if (!clean || !Number.isFinite(pt) || pt <= 0) return;

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

  /**
   * Adds shares to a cash-cushion holding while keeping the holding mutation
   * inside the canonical store. A missing/invalid manual price preserves the
   * existing quote (or initializes a new holding at zero until quote refresh).
   */
  public addCashHolding(
    ticker: string,
    shares: number,
    price = 0
  ): { ticker: string; shares: number; price: number } | null {
    const clean = ticker.trim().toUpperCase();
    if (!clean || !Number.isFinite(shares) || shares <= 0) return null;

    const manualPrice = Number(price);
    const hasManualPrice = Number.isFinite(manualPrice) && manualPrice > 0;
    const currentHoldings = this.state.cashCushion?.holdings || [];
    const existing = currentHoldings.find((holding) => holding.ticker.trim().toUpperCase() === clean);
    const resolvedPrice = hasManualPrice ? manualPrice : Number(existing?.price) || 0;

    this.update((state) => {
      const holdings = [...(state.cashCushion?.holdings || [])];
      const existingIndex = holdings.findIndex(
        (holding) => holding.ticker.trim().toUpperCase() === clean
      );

      if (existingIndex >= 0) {
        const previous = holdings[existingIndex];
        holdings[existingIndex] = {
          ...previous,
          shares: (Number(previous.shares) || 0) + shares,
          ...(hasManualPrice ? { price: manualPrice, currentPrice: manualPrice } : {})
        };
      } else {
        holdings.push({
          ticker: clean,
          shares,
          price: resolvedPrice,
          ...(hasManualPrice ? { currentPrice: manualPrice } : {})
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

    return { ticker: clean, shares, price: resolvedPrice };
  }

  /** Legacy compatibility wrapper; the canonical mutation is addCashHolding. */
  public addCashStock(ticker: string, shares: number, price: number): void {
    if (!Number.isFinite(price) || price <= 0) return;
    this.addCashHolding(ticker, shares, price);
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

  /**
   * Sells a cash-cushion holding as one atomic balance transition. Unlike a
   * margin-position exit, this does not create a margin closed-trade record.
   */
  public sellCashHolding(
    ticker: string,
    sharesToSell: number,
    sellPrice: number
  ): { ticker: string; sharesSold: number; remainingShares: number; netProceeds: number; debtRepaid: number; cashSurplus: number } | null {
    const clean = ticker.trim().toUpperCase();
    if (!clean || !Number.isFinite(sharesToSell) || sharesToSell <= 0 ||
      !Number.isFinite(sellPrice) || sellPrice <= 0) return null;

    let result: { ticker: string; sharesSold: number; remainingShares: number; netProceeds: number; debtRepaid: number; cashSurplus: number } | null = null;

    this.update((state) => {
      const holdings = [...(state.cashCushion?.holdings || [])];
      const holdingIndex = holdings.findIndex(
        (holding) => holding.ticker.trim().toUpperCase() === clean
      );
      if (holdingIndex < 0) return state;

      const holding = holdings[holdingIndex];
      const availableShares = Number(holding.shares) || 0;
      const actualSold = Math.min(availableShares, sharesToSell);
      if (actualSold <= 0) return state;

      const grossProceeds = actualSold * sellPrice;
      const rules = state.brokerAssumptions || DEFAULT_BROKER_ASSUMPTIONS;
      const sellCommission = calculateSaleCommission(actualSold, grossProceeds, rules);
      const netProceeds = Number((grossProceeds - sellCommission).toFixed(2));
      const settlement = settleSaleProceeds(
        Math.abs(Number(state.balance) || 0),
        Number(state.cashCushion?.freeCash) || 0,
        netProceeds
      );
      const nextDebt = settlement.remainingDebt;
      const debtRepaid = settlement.debtRepaid;
      const cashSurplus = settlement.cashSurplus;
      const freeCash = settlement.freeCash;
      const remainingShares = Math.max(0, availableShares - actualSold);

      if (remainingShares <= 1e-8) {
        holdings.splice(holdingIndex, 1);
      } else {
        holdings[holdingIndex] = { ...holding, shares: remainingShares };
      }

      result = {
        ticker: clean,
        sharesSold: actualSold,
        remainingShares,
        netProceeds,
        debtRepaid,
        cashSurplus
      };

      return {
        ...state,
        balance: nextDebt > 0 ? -nextDebt : 0,
        cashBalance: freeCash,
        cashCushion: {
          ...(state.cashCushion || { freeCash: 0, holdings: [] }),
          freeCash,
          holdings
        }
      };
    });

    return result;
  }

  /**
   * Compatibility entry point for AI-confirmed sales. Terminal and AI sales
   * share the same FIFO, commission, margin-interest, debt/cash, and history path.
   */
  public sellMarginPosition(
    ticker: string,
    sharesToSell: number,
    sellPrice: number,
    closedAt = Date.now()
  ): { ticker: string; sharesSold: number; remainingShares: number; netProceeds: number; debtRepaid: number; cashSurplus: number } | null {
    const clean = ticker.trim().toUpperCase();
    const position = this.state.positions?.[clean];
    if (!clean || !position || !Number.isFinite(sharesToSell) || sharesToSell <= 0 ||
      sharesToSell - position.shares > 1e-8 || !Number.isFinite(sellPrice) || sellPrice <= 0 ||
      !Number.isFinite(closedAt) || closedAt <= 0) return null;

    const date = new Date(closedAt).toISOString().slice(0, 10);
    return this.applyMarginSale(clean, sharesToSell, sellPrice, date, { closedAt });
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

/**
 * Subscribe and immediately replay the current portfolio snapshot.
 * Registering before reading closes the render-to-effect race: a state update
 * between the initial render and effect installation cannot be missed.
 */
export function subscribeToPortfolioState(
  listener: (state: PortfolioState) => void,
  store: Pick<PortfolioStore, 'getState' | 'subscribe'> = portfolioStore
): () => void {
  const unsubscribe = store.subscribe(listener);
  listener(store.getState());
  return unsubscribe;
}

export function usePortfolio(): PortfolioState {
  const [state, setState] = useState<PortfolioState>(() => portfolioStore.getState());

  useEffect(() => {
    return subscribeToPortfolioState((newState) => {
      setState({ ...newState });
    });
  }, []);

  return state;
}

/** Subscribe to a derived slice and re-render only when that selection changes. */
export function usePortfolioSelector<T>(selector: (state: PortfolioState) => T): T {
  const [selected, setSelected] = useState<T>(() => selector(portfolioStore.getState()));

  useEffect(() => {
    let current = selector(portfolioStore.getState());
    setSelected(current);
    return portfolioStore.subscribe((nextState) => {
      const next = selector(nextState);
      if (Object.is(current, next)) return;
      current = next;
      setSelected(next);
    });
  }, [selector]);

  return selected;
}