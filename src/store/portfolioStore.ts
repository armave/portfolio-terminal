import {
  subscribeToActiveView as subscribeActiveViewFromStore,
  subscribeToPortfolioSelector as subscribePortfolioSelectorFromStore,
  subscribeToPortfolioState as subscribePortfolioStateFromStore,
  useActiveViewFromStore,
  usePortfolioFromStore,
  usePortfolioSelectorFromStore
} from './portfolioSubscriptions';
import {
  PortfolioState,
  PositionRecord,
  Holding,
  TrancheItem,
  PendingMutation
} from '../types/portfolio';
import {
  loadSavedState,
  saveState,
  loadBrokerRules,
  saveBrokerRules,
  getQuoteRefreshInterval
} from '../services/storage';
import { calculateCommission, normalizePortfolioTranche, resolveCommissionConfig } from '../domain/portfolio';
import { validateSaleCostBasisTranches } from '../domain/saleCostBasis';
import { allocateFifoSaleTranches, calculateSaleAccounting, calculateSaleCommission, createClosedTradeRecord, resolveClosedTradeTimestamp, settleSaleProceeds } from '../domain/portfolioTransactions';
import { createBlankPortfolioState } from './portfolioDefaults';
import { migrateLegacyHoldingsToPositions, buildHoldingsProjection } from './portfolioMigrations';
export { migrateLegacyCloudHoldingsToPositions, migrateLegacyHoldingsToPositions, buildHoldingsProjection } from './portfolioMigrations';
import { DEFAULT_BROKER_ASSUMPTIONS, normalizeBrokerAssumptions } from '../domain/brokerAssumptions';

export type PortfolioStoreChangeSource = 'durable' | 'live-quote' | 'derived';

export const PORTFOLIO_PERSISTENCE_ERROR_MESSAGE =
  'Could not save portfolio changes. The current portfolio remains open; export a backup before reloading.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate the containers at the import boundary before merging a snapshot.
 * A malformed collection must not be normalized to an empty collection and
 * accidentally replace recoverable portfolio data.
 */
function hasValidPortfolioImportShape(value: unknown): value is Partial<PortfolioState> {
  if (!isRecord(value)) return false;

  const arrayFields = [
    'closedTrades',
    'brokerExecutedTrades',
    'closedHistory',
    'cashflows',
    'tranches',
    'cashStocks',
    'guestTrancheLedger'
  ] as const;
  for (const field of arrayFields) {
    if (Object.prototype.hasOwnProperty.call(value, field) &&
        value[field] !== undefined && !Array.isArray(value[field])) {
      return false;
    }
  }

  const recordFields = [
    'positions',
    'activeTrancheTypes',
    'activeTrancheMixes',
    'activeTrancheGuestAssignments',
    'activeTrancheGuestAssignmentDetails',
    'closedTradeAllocations',
    'apiKeys',
    'brokerAssumptions'
  ] as const;
  for (const field of recordFields) {
    if (Object.prototype.hasOwnProperty.call(value, field) &&
        value[field] !== undefined && !isRecord(value[field])) {
      return false;
    }
  }

  if (Object.prototype.hasOwnProperty.call(value, 'cashCushion') && value.cashCushion !== undefined) {
    if (!isRecord(value.cashCushion)) return false;
    if (Object.prototype.hasOwnProperty.call(value.cashCushion, 'holdings') &&
        value.cashCushion.holdings !== undefined && !Array.isArray(value.cashCushion.holdings)) {
      return false;
    }
  }

  if (Object.prototype.hasOwnProperty.call(value, 'guestPortfolioSnapshot') &&
      value.guestPortfolioSnapshot !== undefined) {
    if (!isRecord(value.guestPortfolioSnapshot) ||
        !Array.isArray(value.guestPortfolioSnapshot.tranches)) {
      return false;
    }
  }

  if (Object.prototype.hasOwnProperty.call(value, 'brokerAccountInfo') &&
      value.brokerAccountInfo !== undefined) {
    if (!isRecord(value.brokerAccountInfo) ||
        !Array.isArray(value.brokerAccountInfo.balances) ||
        !Array.isArray(value.brokerAccountInfo.positions)) {
      return false;
    }
  }

  return true;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Preserve the last known daily move when a live tick omits change fields.
 * Recalculate it against the prior quote's implied previous close so the move
 * follows the latest price. Freshness and timestamps always come from the
 * incoming quote, never from the older observation.
 */
function mergeLiveQuoteDetails(
  previous: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined,
  previousPrice: unknown,
  nextPrice: number
): Record<string, unknown> | undefined {
  if (!incoming) return previous;

  const next = { ...incoming };
  const incomingChange = Number(incoming.change);
  const incomingChangePercent = Number(incoming.changePercent);
  const hasIncomingChange =
    incoming.change !== null &&
    incoming.change !== undefined &&
    incoming.change !== '' &&
    Number.isFinite(incomingChange) &&
    incoming.changePercent !== null &&
    incoming.changePercent !== undefined &&
    incoming.changePercent !== '' &&
    Number.isFinite(incomingChangePercent);
  if (hasIncomingChange) {
    next.change = incomingChange;
    next.changePercent = incomingChangePercent;
    return next;
  }

  if (!previous) return next;
  const previousChange = Number(previous.change);
  const previousChangePercent = Number(previous.changePercent);
  const hasPreviousChange =
    previous.change !== null &&
    previous.change !== undefined &&
    previous.change !== '' &&
    Number.isFinite(previousChange) &&
    previous.changePercent !== null &&
    previous.changePercent !== undefined &&
    previous.changePercent !== '' &&
    Number.isFinite(previousChangePercent);
  if (!hasPreviousChange) return next;

  const priorQuotePrice = Number(previous.price);
  const fallbackPrice = Number(previousPrice);
  const baselinePrice = Number.isFinite(priorQuotePrice) && priorQuotePrice > 0
    ? priorQuotePrice
    : fallbackPrice;
  const previousClose = baselinePrice - previousChange;
  if (!Number.isFinite(previousClose) || previousClose <= 0) {
    return { ...next, change: previousChange, changePercent: previousChangePercent };
  }

  const change = nextPrice - previousClose;
  return {
    ...next,
    change,
    changePercent: (change / previousClose) * 100
  };
}

export class PortfolioStore {
  private state: PortfolioState;
  private listeners: Set<(state: PortfolioState, source: PortfolioStoreChangeSource) => void> = new Set();
  private activeViewListeners: Set<(view: string) => void> = new Set();
  private persistenceErrorListeners: Set<(message: string) => void> = new Set();

  constructor() {
    this.state = this.initializeState();
  }

  private initializeState(): PortfolioState {
    const defaults = createBlankPortfolioState();
    // Keep the persisted snapshot's own property set intact so a truly legacy
    // holdings-only record remains distinguishable from a canonical empty map.
    const saved = loadSavedState({}) as Partial<PortfolioState> | null;
    const savedRules = loadBrokerRules();
    const refreshInterval = getQuoteRefreshInterval();

    const raw: PortfolioState = {
      ...defaults,
      ...saved,
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
      // Balance relies on the last successful broker snapshot being available on
      // the very first render. Older records may not have the newer status field.
      brokerAccountInfo: saved?.brokerAccountInfo &&
        saved.brokerAccountInfo.loaded === true &&
        Array.isArray(saved.brokerAccountInfo.balances) &&
        Array.isArray(saved.brokerAccountInfo.positions)
        ? saved.brokerAccountInfo
        : undefined,
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

  public subscribe(listener: (state: PortfolioState, source: PortfolioStoreChangeSource) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public subscribeActiveView(listener: (view: string) => void): () => void {
    this.activeViewListeners.add(listener);
    return () => {
      this.activeViewListeners.delete(listener);
    };
  }

  private notifyActiveView(): void {
    const activeView = this.state.activeView;
    this.activeViewListeners.forEach((listener) => {
      try {
        listener(activeView);
      } catch (error) {
        // A faulty view subscriber must not prevent other subscribers from
        // observing a committed navigation change.
        console.error('Failed to notify a portfolio active-view subscriber:', error);
      }
    });
  }

  public subscribePersistenceErrors(listener: (message: string) => void): () => void {
    this.persistenceErrorListeners.add(listener);
    return () => this.persistenceErrorListeners.delete(listener);
  }

  private notify(source: PortfolioStoreChangeSource = 'durable'): void {
    const state = this.state;
    this.listeners.forEach((listener) => {
      try {
        listener(state, source);
      } catch (error) {
        // State is already committed before notification. Isolate subscriber
        // failures so one consumer cannot starve the remaining subscribers or
        // make a successful mutation appear to have failed.
        console.error('Failed to notify a portfolio state subscriber:', error);
      }
    });
  }

  private notifyPersistenceFailure(): void {
    this.persistenceErrorListeners.forEach((listener) => {
      try {
        listener(PORTFOLIO_PERSISTENCE_ERROR_MESSAGE);
      } catch (error) {
        console.error('Failed to notify the UI about a portfolio persistence error:', error);
      }
    });
  }

  /**
   * Commit a candidate snapshot before making it visible to subscribers.
   * saveState mutates candidate.lastUpdated only after its storage transaction
   * succeeds, so a failed write leaves the current in-memory snapshot intact.
   */
  public update(
    updater: (state: PortfolioState) => PortfolioState,
    persist = true,
    source: PortfolioStoreChangeSource = 'durable'
  ): boolean {
    const next = updater(this.state);

    // A returned current-state reference is an intentional no-op, not a failed save.
    if (next === this.state) return true;

    const previousState = this.state;
    const candidate = this.normalizeState({
      ...next,
      lastUpdated: Date.now()
    });

    if (persist && !saveState(candidate)) {
      this.notifyPersistenceFailure();
      return false;
    }

    this.state = candidate;
    this.notify(source);
    if (this.state.activeView !== previousState.activeView) this.notifyActiveView();
    return true;
  }

  public setState(
    partial: Partial<PortfolioState>,
    persist = true,
    source: PortfolioStoreChangeSource = 'durable'
  ): boolean {
    return this.update((state) => ({
      ...state,
      ...partial
    }), persist, source);
  }

  /** Update derived display values without making them a new durable mutation. */
  public setDerivedState(partial: Partial<PortfolioState>, persist = true): boolean {
    return this.setState(partial, persist, 'derived');
  }

  public importState(newState: Partial<PortfolioState>): boolean {
    if (!hasValidPortfolioImportShape(newState)) return false;

    return this.update((state) => ({
      ...state,
      ...newState
    }));
  }

  /**
   * Clear portfolio and broker-history data while preserving device/account configuration.
   * Broker rules, provider keys, the signed-in Gateway Secret, and refresh preferences
   * are settings rather than portfolio content and intentionally remain in place.
   */
  public resetToBlankState(now = Date.now(), persist = true): boolean {
    // The selected desk is device-local and also participates in normalization.
    // Restore it when the persistent portfolio write fails so navigation cannot
    // advertise a reset while the previous portfolio is still active.
    const previousDeviceView = this.readDeviceActiveView();
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('portfolio_active_view', 'COMBINED');
    } catch {
      // Continue resetting portfolio data when browser preference storage is unavailable.
    }
    const committed = this.update((state) => ({
      ...state,
      ...createBlankPortfolioState(now),
      // Reset portfolio-owned data while retaining device/account configuration.
      brokerAssumptions: state.brokerAssumptions,
      apiKeys: state.apiKeys,
      gatewaySecret: state.gatewaySecret,
      autoRefreshInterval: state.autoRefreshInterval,
      positions: {},
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

    if (!committed) {
      try {
        if (typeof localStorage !== 'undefined') {
          if (previousDeviceView === null) localStorage.removeItem('portfolio_active_view');
          else localStorage.setItem('portfolio_active_view', previousDeviceView);
        }
      } catch (error) {
        console.error('Could not restore the previous device desk after a failed portfolio reset:', error);
      }
    }
    return committed;
  }

  private readDeviceActiveView(): string | null {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem('portfolio_active_view') : null;
    } catch {
      return null;
    }
  }

  public setActiveView(view: string): void {
    const supportedViews = ['COMBINED', 'CASH_CUSHION', 'BALANCE', 'CLOSED_HISTORY', 'GUEST_HISTORY', 'SETTINGS'];
    const nextView = supportedViews.includes(view) || this.state.positions?.[view] ? view : 'COMBINED';
    const previousActiveView = this.state.activeView;

    // A desk selection is a device-local UI preference, not a portfolio mutation.
    // Preserve portfolio collection references and avoid normalization, full-state
    // serialization, and notifications to unrelated portfolio subscribers.
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('portfolio_active_view', nextView);
    } catch {
      // Navigation still works if browser storage is unavailable.
    }

    if (previousActiveView === nextView && this.state.selectedTicker === nextView) return;
    this.state = { ...this.state, activeView: nextView, selectedTicker: nextView };
    if (previousActiveView !== nextView) this.notifyActiveView();
  }

  public selectTicker(ticker: string | null): void {
    this.setState({
      selectedTicker: ticker,
      activeView: ticker || 'COMBINED'
    });
  }

  public updateAssumptions(rules: unknown): boolean {
    let mergedRules: ReturnType<typeof normalizeBrokerAssumptions> | null = null;
    const committed = this.update((state) => {
      mergedRules = normalizeBrokerAssumptions(rules, state.brokerAssumptions || DEFAULT_BROKER_ASSUMPTIONS);
      return { ...state, brokerAssumptions: mergedRules };
    });
    if (!committed || !mergedRules) return false;
    saveBrokerRules(mergedRules);
    return true;
  }

  /** Persist a rollover boundary through the canonical store. */
  public setLastRolloverTimestamp(timestamp: number): boolean {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return false;
    return this.update((state) => ({
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
  ): boolean {
    if (![compoundedDebt, interestAccrued, timestamp].every(Number.isFinite) ||
      compoundedDebt < 0 || interestAccrued < 0 || timestamp <= 0) return false;

    return this.update((state) => ({
      ...state,
      balance: compoundedDebt > 0 ? -compoundedDebt : 0,
      lastRolloverTimestamp: timestamp,
      realizedMarginCharged: Math.max(0, Number(state.realizedMarginCharged) || 0) +
        (recordAsRealized ? interestAccrued : 0)
    }));
  }

  /** Set the cash-cushion balance without changing margin debt. */
  public setFreeCash(amount: number): boolean {
    const num = Number(amount);
    if (!Number.isFinite(num) || num < 0) {
      throw new Error('Free cash must be a finite non-negative amount.');
    }

    return this.update((state) => ({
      ...state,
      cashBalance: num,
      cashCushion: {
        ...(state.cashCushion || { freeCash: 0, holdings: [] }),
        freeCash: num
      }
    }));
  }

  public setCashBalance(amount: number): boolean {
    const num = Number(amount) || 0;
    return this.update((state) => {
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

  public setMarginDebt(debtAmount: number): boolean {
    const amount = Number(debtAmount);
    if (!Number.isFinite(amount)) return false;
    const debt = Math.abs(amount);
    return this.update((state) => ({
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
  ): boolean {
    const clean = ticker.trim().toUpperCase();
    if (!clean || !Number.isFinite(shares) || shares <= 0 || !Number.isFinite(price) || price <= 0 ) return false;

    const purchaseDate = date || todayIso();

    return this.update((state) => {

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
  ): boolean {
    return this.buyStock(
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
  ): boolean {
    const previousState = this.state;
    this.applyMarginSale(ticker, sharesToSell, sellPrice, date);
    return this.state !== previousState;
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
      // Fail closed for legacy or corrupted records without a trustworthy
      // acquisition ledger. A live quote is never a purchase-price source.
      const validatedCostBasis = validateSaleCostBasisTranches(
        pos.tranches,
        pos.shares,
        Number(pos.commBuy ?? 0),
        clean
      );
      const origTranches = validatedCostBasis.tranches as TrancheItem[];
      const earliestBuyDate =
        origTranches[0]?.date || pos.startDate || state.startDate || todayIso();

      const allocation = allocateFifoSaleTranches(
        origTranches,
        actualSold,
        pos.shares,
        validatedCostBasis.aggregateBuyCommission
      );
      const { soldCostBasis, buyCommissionAllocated: buyCommAllocated, remainingTranches: updatedTranches } = allocation;

      const sellProceeds = actualSold * sellPrice;

      // Shared with the AI-confirmed sale path to keep broker fees consistent.
      const sellComm = calculateSaleCommission(actualSold, sellProceeds, rules);

      const accounting = calculateSaleAccounting({
        tranches: origTranches,
        positions,
        positionShares: pos.shares,
        sharesSold: actualSold,
        balance: state.balance,
        brokerAssumptions: rules,
        positionMarginCharged: pos.marginCharged,
        sellProceeds,
        soldCostBasis,
        buyCommissionAllocated: buyCommAllocated,
        sellCommission: sellComm
      });
      const {
        marginInterestAllocated,
        totalCommissions,
        grossProfit,
        netProfit,
        netCashProceeds
      } = accounting;

      const totalDebt = Math.abs(Number(state.balance) || 0);
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
          commBuy: Math.max(0, validatedCostBasis.aggregateBuyCommission - buyCommAllocated),
          tranches: updatedTranches
        };
        // The sold slice has been realized below; do not carry a one-shot
        // margin charge forward and count it again on the next partial exit.
        delete remainingPosition.marginCharged;
        positions[clean] = remainingPosition;
      }

      const exitDateStr = date || todayIso();
      const exitTimestamp = new Date(exitDateStr).getTime();
      const requestedClosedAt = Number(options.closedAt);
      const fallbackTimestamp = Number.isFinite(requestedClosedAt) && requestedClosedAt > 0
        ? 0
        : Number.isFinite(exitTimestamp) ? 0 : Date.now();
      const closedTimestamp = resolveClosedTradeTimestamp(
        requestedClosedAt,
        exitTimestamp,
        fallbackTimestamp
      );

      const closedRecord = createClosedTradeRecord({
        id: `${clean}-${Date.now()}`,
        ticker: clean,
        shares: actualSold,
        soldCostBasis,
        sellPrice,
        buyDate: earliestBuyDate,
        sellDate: exitDateStr,
        closedTimestamp,
        grossProfit,
        commissions: totalCommissions,
        marginInterest: marginInterestAllocated,
        netProfit
      });

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
   * Applies volatile market data to the latest in-memory snapshot.
   * Durable callers explicitly persist their surrounding portfolio action.
   */
  public updateLiveQuote(
    ticker: string,
    quote: { price?: number; currentPrice?: number; quoteUpdatedAt?: number; quoteSource?: string; quoteDetails?: Record<string, unknown>; requestStartedAt?: number; requestSequence?: number }
  ): boolean {
    const clean = ticker.trim().toUpperCase();
    const price = Number(quote.currentPrice ?? quote.price);
    if (!clean || !Number.isFinite(price) || price <= 0) return false;

    let accepted = false;
    const committed = this.update((latestState) => {
      const positions = { ...(latestState.positions || {}) };
      const position = positions[clean];
      const cashHoldings = [...(latestState.cashCushion?.holdings || [])];
      const hasMatchingCashHolding = cashHoldings.some((holding) => holding.ticker.toUpperCase() === clean);
      const cashStocks = [...(latestState.cashStocks || [])];
      const hasMatchingCashStock = cashStocks.some((holding) => holding.ticker.toUpperCase() === clean);
      const guestPortfolioSnapshot = latestState.guestPortfolioSnapshot;
      const hasMatchingGuestTranche = Boolean(guestPortfolioSnapshot?.tranches.some(
        (tranche) => tranche.ticker.trim().toUpperCase() === clean
      ));
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
      const latestSourceTimestamp = Math.max(
        Number(position?.quoteDetails?.sourceTimestamp) || 0,
        ...cashHoldings.filter((holding) => holding.ticker.toUpperCase() === clean)
          .map((holding) => Number(holding.quoteDetails?.sourceTimestamp) || 0),
        ...cashStocks.filter((holding) => holding.ticker.toUpperCase() === clean)
          .map((holding) => Number((holding as any).quoteDetails?.sourceTimestamp) || 0),
        ...(guestPortfolioSnapshot?.tranches || [])
          .filter((tranche) => tranche.ticker.trim().toUpperCase() === clean)
          .map((tranche) => Number((tranche as any).quoteDetails?.sourceTimestamp) || 0)
      );
      const incomingSourceTimestamp = Number(quote.quoteDetails?.sourceTimestamp) || 0;

      // Request start time is the primary ordering signal. The sequence only
      // breaks ties for requests started in the same millisecond; it can reset
      // across page loads and must never make a later request look older.
      const hasRequestStartTime = quote.requestStartedAt !== undefined;
      const isOlderRequest = hasRequestStartTime
        ? requestStartedAt < latestRequestStartedAt ||
          (requestStartedAt === latestRequestStartedAt &&
            latestRequestSequence > 0 &&
            (requestSequence === undefined || requestSequence < latestRequestSequence))
        : requestSequence !== undefined &&
          latestRequestSequence > 0 &&
          requestSequence < latestRequestSequence;

      if (isOlderRequest) {
        return latestState;
      }
      // Request order protects against async races; source time separately
      // protects against a later response carrying an older market observation.
      // A persistent WebSocket delivers quote events in connection order.
      // Once a new q event arrives, its local arrival order is authoritative:
      // provider ltt timestamps can repeat or regress across reconnects/timezone
      // boundaries, but must not prevent the latest received tick rewriting the
      // ticker's local price and quote metadata. Keep source-time rejection for
      // one-shot HTTP/provider responses, where responses can complete out of order.
      const isLiveWebSocketTick = quote.quoteDetails?.transport === 'websocket';
      if (
        !isLiveWebSocketTick &&
        incomingSourceTimestamp > 0 &&
        latestSourceTimestamp > 0 &&
        incomingSourceTimestamp < latestSourceTimestamp
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

      const positionQuoteDetails = position
        ? mergeLiveQuoteDetails(position.quoteDetails, quote.quoteDetails, position.currentPrice, price)
        : undefined;
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
          ...(positionQuoteDetails ? { quoteDetails: positionQuoteDetails } : {})
        };
      }

      const updatedCashHoldings = cashHoldings.map((holding) => {
        if (holding.ticker.toUpperCase() !== clean) return holding;
        const quoteDetails = mergeLiveQuoteDetails(
          holding.quoteDetails,
          quote.quoteDetails,
          holding.currentPrice ?? holding.price,
          price
        );
        return {
          ...holding,
          currentPrice: price,
          price,
          quoteUpdatedAt: quote.quoteUpdatedAt ?? Date.now(),
          quoteRequestStartedAt: requestStartedAt,
          ...(requestSequence !== undefined ? { quoteRequestSequence: requestSequence } : {}),
          quoteSource: quote.quoteSource ?? 'Live quote',
          ...(quoteDetails ? { quoteDetails } : {})
        };
      });
      const updatedCashStocks = cashStocks.map((holding) => {
        if (holding.ticker.toUpperCase() !== clean) return holding;
        const quoteDetails = mergeLiveQuoteDetails(
          holding.quoteDetails,
          quote.quoteDetails,
          holding.currentPrice,
          price
        );
        return {
          ...holding,
          currentPrice: price,
          quoteUpdatedAt: quote.quoteUpdatedAt ?? Date.now(),
          quoteRequestStartedAt: requestStartedAt,
          ...(requestSequence !== undefined ? { quoteRequestSequence: requestSequence } : {}),
          quoteSource: quote.quoteSource ?? 'Live quote',
          ...(quoteDetails ? { quoteDetails } : {})
        };
      });
      // Guest Balance cards read cashCushion.holdings, while the standalone LOTS
      // desk reads guestPortfolioSnapshot.tranches. Keep both projections on the
      // same accepted quote so LOTS market values do not remain at admin-publish time.
      const updatedGuestPortfolioSnapshot = hasMatchingGuestTranche && guestPortfolioSnapshot
        ? {
          ...guestPortfolioSnapshot,
          tranches: guestPortfolioSnapshot.tranches.map((tranche) => {
            if (tranche.ticker.trim().toUpperCase() !== clean) return tranche;
            const quoteDetails = mergeLiveQuoteDetails(
              tranche.quoteDetails,
              quote.quoteDetails,
              tranche.marketPrice,
              price
            );
            return {
              ...tranche,
              marketPrice: price,
              marketValue: price * tranche.quantity,
              ...(quoteDetails ? { quoteDetails } : {})
            };
          })
        }
        : guestPortfolioSnapshot;

      if (!position && !hasMatchingCashHolding && !hasMatchingCashStock && !hasMatchingGuestTranche) return latestState;

      accepted = true;
      return {
        ...latestState,
        positions,
        cashStocks: updatedCashStocks,
        ...(updatedGuestPortfolioSnapshot ? { guestPortfolioSnapshot: updatedGuestPortfolioSnapshot } : {}),
        cashCushion: {
          ...(latestState.cashCushion || { freeCash: 0, holdings: [] }),
          holdings: updatedCashHoldings
        }
      };
    }, false, 'live-quote');
    return accepted && committed;
  }

  public updatePrice(ticker: string, price: number): boolean {
    return this.updateLiveQuote(ticker, { price, quoteSource: 'Manual' });
  }

  public updateTargetPrice(ticker: string, pt: number): boolean {
    const clean = ticker.trim().toUpperCase();
    if (!clean || !Number.isFinite(pt) || pt <= 0 ) return false;

    return this.update((state) => {
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

    const committed = this.update((state) => {
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

    return committed ? { ticker: clean, shares, price: resolvedPrice } : null;
  }

  /** Legacy compatibility wrapper; the canonical mutation is addCashHolding. */
  public addCashStock(ticker: string, shares: number, price: number): boolean {
    if (!Number.isFinite(price) || price <= 0 ) return false;
    return this.addCashHolding(ticker, shares, price) !== null;
  }

  public removeCashStock(indexOrTicker: number | string): boolean {
    return this.update((state) => {
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

    const committed = this.update((state) => {
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

    return committed ? result : null;
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
    const previousState = this.state;
    const result = this.applyMarginSale(clean, sharesToSell, sellPrice, date, { closedAt });
    return this.state !== previousState ? result : null;
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

export function subscribeToPortfolioState(
  listener: (state: PortfolioState) => void,
  store: Pick<PortfolioStore, 'getState' | 'subscribe'> = portfolioStore
): () => void {
  return subscribePortfolioStateFromStore(listener, store);
}

export function subscribeToPortfolioSelector<T>(
  selector: (state: PortfolioState) => T,
  listener: (selection: T) => void,
  isEqual: (previous: T, next: T) => boolean = Object.is,
  store: Pick<PortfolioStore, 'getState' | 'subscribe'> = portfolioStore
): () => void {
  return subscribePortfolioSelectorFromStore(selector, listener, store, isEqual);
}

export function usePortfolioSelector<T>(
  selector: (state: PortfolioState) => T,
  isEqual: (previous: T, next: T) => boolean = Object.is
): T {
  return usePortfolioSelectorFromStore(selector, isEqual, portfolioStore);
}

export function usePortfolio(): PortfolioState {
  return usePortfolioFromStore(portfolioStore);
}

export function subscribeToActiveView(
  listener: (view: string) => void,
  store: Pick<PortfolioStore, 'getState' | 'subscribeActiveView'> = portfolioStore
): () => void {
  return subscribeActiveViewFromStore(listener, store);
}

export function useActiveView(): string {
  return useActiveViewFromStore(portfolioStore);
}
