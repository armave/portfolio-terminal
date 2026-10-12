export interface TradeTranche {
  qty: number;
  shares?: number;
  price: number;
  date?: string;
  acquiredAt?: number;
  buyCommission?: number;
  [key: string]: unknown;
}

export interface MarginPosition {
  ticker: string;
  shares: number;
  tranches: TradeTranche[];
  commBuy: number;
  marginCharged?: number;
  startDate?: string;
  [key: string]: unknown;
}

export interface ClosedTrade {
  ticker: string;
  date: number;
  shares: number;
  holdingDays: number;
  feesAndCommissions: number;
  netProfit: number;
}

export interface PortfolioState {
  activeView: string;
  balance: number;
  settings?: { marginRate?: number; [key: string]: unknown };
  realizedMarginCharged: number;
  startDate: string;
  lastRolloverTimestamp: number;
  lastUpdated: number;
  cashCushion: {
    freeCash: number;
    holdings: unknown[];
    [key: string]: unknown;
  };
  closedTrades: ClosedTrade[];
  quoteSymbols: Record<string, unknown>;
  positions: Record<string, MarginPosition>;
  [key: string]: unknown;
}

export interface CommissionConfig {
  commPerShare: number;
  commVolumePct: number;
  minCommOrder: number;
}

export interface ClosedTradeResult {
  position: MarginPosition;
  trade: ClosedTrade | null;
  marginFee: number;
}

export function calculateCommission(
  shares: number,
  totalVal: number,
  rules: CommissionConfig
): number {
  if (shares <= 0) return 0;
  return Math.max(rules.minCommOrder, (rules.commPerShare * shares) + (rules.commVolumePct * totalVal));
}

export function calculateCompoundedDebt(
  principal: number,
  dailyRate: number,
  days: number
): number {
  if (principal <= 0 || days <= 0 || dailyRate <= 0) return principal;
  return principal * Math.pow(1 + dailyRate, days);
}

export interface MarginInterestState {
  marginDebt?: number;
  balance?: number;
  totalDebt?: number;
  tranches?: Array<TradeTranche | Record<string, unknown>>;
  positions?: Record<string, MarginPosition>;
  [key: string]: unknown;
}

export interface MarginInterestOptions {
  marginDebt?: number;
  totalDebt?: number;
  annualRate?: number;
  dailyRate?: number;
  now?: Date | number | string;
  [key: string]: unknown;
}

export function parseTrancheDate(
  dateStr: unknown,
  fallbackYear = new Date().getFullYear()
): Date {
  if (dateStr instanceof Date) return dateStr;
  if (typeof dateStr === 'number' && Number.isFinite(dateStr)) return new Date(dateStr);
  if (typeof dateStr !== 'string') return new Date();

  const trimmed = dateStr.trim();
  if (/^\d{1,2}\s+[A-Za-z]{3,}$/i.test(trimmed)) {
    return new Date(`${trimmed} ${fallbackYear}`);
  }

  const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdMatch) {
    return new Date(Number(ymdMatch[1]), Number(ymdMatch[2]) - 1, Number(ymdMatch[3]));
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function getDaysPassed(startDate: Date, endDate: Date = new Date()): number {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  return Math.floor((end.getTime() - start.getTime()) / 86400000);
}

export function calculateMarginInterest(
  principal: number,
  dailyRate: number,
  days: number
): number;
export function calculateMarginInterest(
  stateOrTranches: MarginInterestState | Array<TradeTranche | Record<string, unknown>>,
  optionsOrRate?: number | MarginInterestOptions,
  maybeOptions?: MarginInterestOptions
): number;
export function calculateMarginInterest(
  target: number | MarginInterestState | Array<TradeTranche | Record<string, unknown>>,
  arg2?: number | MarginInterestOptions,
  arg3?: number | MarginInterestOptions
): number {
  if (typeof target === 'number') {
    const dailyRate = typeof arg2 === 'number' ? arg2 : 0;
    const days = typeof arg3 === 'number' ? arg3 : 0;
    return Math.max(0, calculateCompoundedDebt(target, dailyRate, days) - target);
  }

  const options: MarginInterestOptions = {
    ...(typeof arg2 === 'object' && arg2 !== null ? arg2 : {}),
    ...(typeof arg3 === 'object' && arg3 !== null ? arg3 : {})
  };

  const annualRate = typeof arg2 === 'number'
    ? arg2
    : typeof arg3 === 'number'
      ? arg3
      : (options.annualRate ?? 0.15);

  const endDate = options.now instanceof Date
    ? options.now
    : (options.now ? new Date(options.now) : new Date());

  let tranches: Array<TradeTranche | Record<string, unknown>> = [];
  let debtValue: number | undefined;

  if (Array.isArray(target)) {
    tranches = target;
    debtValue = options.marginDebt ?? options.totalDebt;
  } else if (isRecord(target)) {
    if (typeof target.balance === 'number' && target.balance >= 0 && target.marginDebt === undefined) {
      return 0;
    }
    if (target.marginDebt === 0 || target.totalDebt === 0) {
      return 0;
    }
    if (Array.isArray(target.tranches)) {
      tranches = target.tranches as Array<TradeTranche | Record<string, unknown>>;
    } else if (isRecord(target.positions)) {
      tranches = Object.values(target.positions).flatMap(p => (isRecord(p) && Array.isArray(p.tranches) ? p.tranches : []));
    }
    const targetDebt = target.marginDebt ?? (typeof target.balance === 'number' && target.balance < 0 ? target.balance : undefined) ?? target.totalDebt;
    debtValue = typeof targetDebt === 'number' ? targetDebt : (options.marginDebt ?? options.totalDebt);
  }

  if (!tranches || tranches.length === 0) return 0;

  let totalInvested = 0;
  for (const tranche of tranches) {
    if (!isRecord(tranche)) continue;
    const shares = Number(tranche.shares ?? tranche.qty) || 0;
    const price = Number(tranche.price) || 0;
    totalInvested += shares * price;
  }

  if (!Number.isFinite(totalInvested) || totalInvested <= 0) return 0;

  const marginDebt = typeof debtValue === 'number' ? Math.abs(debtValue) : totalInvested;
  if (marginDebt <= 0) return 0;
  const marginRatio = Math.min(1, marginDebt / totalInvested);

  let totalAccruedInterest = 0;
  for (const tranche of tranches) {
    if (!isRecord(tranche)) continue;
    const shares = Number(tranche.shares ?? tranche.qty) || 0;
    const price = Number(tranche.price) || 0;
    const trancheCost = shares * price;
    const rawDate = tranche.date ?? tranche.acquiredAt;
    const days = getDaysPassed(parseTrancheDate(rawDate, endDate.getFullYear()), endDate);
    const trancheInterest = trancheCost * marginRatio * (annualRate / 365) * Math.max(0, days);
    totalAccruedInterest += trancheInterest;
  }

  return Math.max(0, totalAccruedInterest);
}

export function calculateAccruedFees(
  totalComms: number,
  marginCharged: number,
  additionalAccrual = 0
): number {
  return totalComms + marginCharged + additionalAccrual;
}

export function calculateBreakevenDays(
  netTargetProfit: number,
  totalDebt: number,
  dailyRate: number
): number | null {
  if (totalDebt <= 0 || netTargetProfit <= 0 || dailyRate <= 0) return 0;
  const days = Math.log(1 + (netTargetProfit / totalDebt)) / Math.log(1 + dailyRate);
  return Number.isFinite(days) ? Math.ceil(days) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function resolveTradeDateTimestamp(value: unknown, fallbackTimestamp = Date.now()): number {
  if (typeof value !== 'string' || !value.trim()) return fallbackTimestamp;
  const shortDate = value.trim().match(/^(\d{1,2})\s+([a-z]{3,})(?:\s+(\d{4}))?$/i);
  if (shortDate) {
    const monthIndex = new Date(`${shortDate[2]} 1, 2000`).getMonth();
    if (!Number.isNaN(monthIndex)) {
      let year = shortDate[3] ? Number(shortDate[3]) : new Date(fallbackTimestamp).getFullYear();
      let timestamp = new Date(year, monthIndex, Number(shortDate[1])).getTime();
      if (!shortDate[3] && timestamp > fallbackTimestamp) {
        year -= 1;
        timestamp = new Date(year, monthIndex, Number(shortDate[1])).getTime();
      }
      return timestamp;
    }
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallbackTimestamp;
}

export function createBlankState(now = Date.now()): PortfolioState {
  return {
    activeView: 'COMBINED',
    balance: 0,
    realizedMarginCharged: 0,
    startDate: new Date(now).toISOString().split('T')[0],
    lastRolloverTimestamp: now,
    lastUpdated: now,
    cashCushion: {
      freeCash: 0,
      holdings: []
    },
    closedTrades: [],
    quoteSymbols: {},
    positions: {}
  };
}

export function normalizePortfolioState(candidate: unknown, now = Date.now()): PortfolioState {
  if (!isRecord(candidate)) throw new Error('Portfolio state must be an object.');

  const blankState = createBlankState(now);
  const sourceCashCushion = isRecord(candidate.cashCushion) ? candidate.cashCushion : {};
  const positions = isRecord(candidate.positions) ? candidate.positions : {};
  const normalizedPositions: Record<string, MarginPosition> = {};

  Object.entries(positions).forEach(([ticker, position]) => {
    if (!isRecord(position)) return;
    const tranches = Array.isArray(position.tranches)
      ? position.tranches.filter(isRecord).map(tranche => ({
          ...tranche,
          qty: finiteNumber(tranche.qty, 0),
          price: finiteNumber(tranche.price, 0)
        }))
      : [];
    normalizedPositions[ticker] = {
      ...position,
      ticker: typeof position.ticker === 'string' ? position.ticker : ticker,
      shares: finiteNumber(position.shares, 0),
      tranches,
      commBuy: finiteNumber(position.commBuy, 0),
      marginCharged: finiteNumber(position.marginCharged, 0)
    };
  });

  const sourceTimestamp = Number(candidate.lastRolloverTimestamp);
  const closedTrades = Array.isArray(candidate.closedTrades)
    ? candidate.closedTrades.filter(isRecord).map(trade => ({
        ticker: typeof trade.ticker === 'string' ? trade.ticker : '',
        date: finiteNumber(trade.date, now),
        shares: finiteNumber(trade.shares, 0),
        holdingDays: finiteNumber(trade.holdingDays, 0),
        feesAndCommissions: finiteNumber(trade.feesAndCommissions, 0),
        netProfit: finiteNumber(trade.netProfit, 0)
      }))
    : [];
  return {
    ...blankState,
    ...candidate,
    activeView: typeof candidate.activeView === 'string' ? candidate.activeView : blankState.activeView,
    balance: finiteNumber(candidate.balance, blankState.balance),
    realizedMarginCharged: finiteNumber(candidate.realizedMarginCharged, blankState.realizedMarginCharged),
    lastUpdated: finiteNumber(candidate.lastUpdated, blankState.lastUpdated),
    cashCushion: {
      ...blankState.cashCushion,
      ...sourceCashCushion,
      freeCash: finiteNumber(sourceCashCushion.freeCash, 0),
      holdings: Array.isArray(sourceCashCushion.holdings) ? sourceCashCushion.holdings : []
    },
    closedTrades,
    positions: normalizedPositions,
    quoteSymbols: isRecord(candidate.quoteSymbols) ? candidate.quoteSymbols : {},
    lastRolloverTimestamp: Number.isFinite(sourceTimestamp) && sourceTimestamp > 0 ? sourceTimestamp : now,
    startDate: typeof candidate.startDate === 'string' && candidate.startDate
      ? candidate.startDate
      : blankState.startDate
  };
}

export function normalizePortfolioBackup(candidate: unknown, now = Date.now()): PortfolioState {
  if (!isRecord(candidate)) throw new Error('Portfolio backup must be an object.');
  const recognizedFields = ['positions', 'balance', 'cashCushion', 'closedTrades', 'activeView', 'startDate'];
  if (!recognizedFields.some(field => Object.hasOwn(candidate, field))) {
    throw new Error('File does not contain a recognized portfolio backup.');
  }
  return normalizePortfolioState(candidate, now);
}

export function resolveSaleQuantity(availableShares: number, requestedShares: number | null): number {
  if (!Number.isFinite(availableShares) || availableShares <= 0) {
    throw new Error('Position has no valid shares to sell.');
  }
  if (requestedShares === null) return availableShares;
  if (!Number.isFinite(requestedShares) || requestedShares <= 0) {
    throw new Error('Sell quantity must be greater than zero.');
  }
  if (requestedShares - availableShares > 1e-8) {
    throw new Error(`Cannot sell ${requestedShares} shares; only ${availableShares} are available.`);
  }
  return Math.min(availableShares, requestedShares);
}

function resolveTrancheAcquiredAt(tranche: TradeTranche, fallbackDate: string | undefined, now: number): number {
  const acquiredAt = Number(tranche.acquiredAt);
  if (Number.isFinite(acquiredAt) && acquiredAt > 0) return acquiredAt;
  return resolveTradeDateTimestamp(tranche.date || fallbackDate, now);
}

export function realizeClosedTrade(
  position: MarginPosition,
  ticker: string,
  shares: number,
  sellPrice: number,
  sellCommission: number,
  closedAt: number
): ClosedTradeResult {
  if (!Number.isFinite(shares) || shares <= 0 || shares > position.shares) {
    throw new Error('Closed share quantity must be positive and no greater than the open position.');
  }
  if (!Number.isFinite(sellPrice) || sellPrice <= 0) {
    throw new Error('Sale price must be a finite positive number.');
  }

  const originalShares = Number(position.shares) || 0;
  const sourceTranches = Array.isArray(position.tranches) ? position.tranches : [];
  const trancheShares = sourceTranches.reduce((total, tranche) => total + Math.max(0, Number(tranche.qty) || 0), 0);
  const scale = trancheShares > originalShares && trancheShares > 0 ? originalShares / trancheShares : 1;
  const lots = sourceTranches
    .map(tranche => ({
      ...tranche,
      qty: Math.max(0, Number(tranche.qty) || 0) * scale,
      price: Math.max(0, Number(tranche.price) || 0),
      buyCommission: Math.max(0, Number(tranche.buyCommission) || 0) * scale
    }))
    .filter(tranche => tranche.qty > 0);
  const scaledCommission = scale < 1 ? (Number(position.commBuy) || 0) * scale : Number(position.commBuy) || 0;
  const scaledTrancheShares = lots.reduce((total, tranche) => total + tranche.qty, 0);
  const fallbackShares = Math.max(0, originalShares - scaledTrancheShares);
  if (fallbackShares > 0) {
    lots.push({
      qty: fallbackShares,
      price: scaledTrancheShares > 0
        ? lots.reduce((total, tranche) => total + (tranche.qty * tranche.price), 0) / scaledTrancheShares
        : 0,
      buyCommission: 0,
      acquiredAt: resolveTradeDateTimestamp(position.startDate, closedAt)
    });
  }

  const lotBuyCommissions = lots.reduce((total, tranche) => total + Math.max(0, Number(tranche.buyCommission) || 0), 0);
  const unassignedBuyCommission = Math.max(0, scaledCommission - lotBuyCommissions);
  const closedLots: { qty: number; cost: number; buyCommission: number; acquiredAt: number }[] = [];
  let remainingToClose = shares;

  lots.forEach(tranche => {
    if (remainingToClose <= 0) return;
    const closedQty = Math.min(tranche.qty, remainingToClose);
    if (closedQty <= 0) return;

    const trancheCommission = Math.max(0, Number(tranche.buyCommission) || 0);
    const legacyCommissionShare = originalShares > 0 ? (unassignedBuyCommission / originalShares) * closedQty : 0;
    closedLots.push({
      qty: closedQty,
      cost: closedQty * tranche.price,
      buyCommission: (trancheCommission * (closedQty / tranche.qty)) + legacyCommissionShare,
      acquiredAt: resolveTrancheAcquiredAt(tranche, position.startDate, closedAt)
    });
    tranche.buyCommission = Math.max(0, trancheCommission * (1 - (closedQty / tranche.qty)));
    tranche.qty -= closedQty;
    remainingToClose -= closedQty;
  });

  const closedShares = shares - remainingToClose;
  const remainingLots = lots.filter(tranche => tranche.qty > 1e-8);
  const costBasis = closedLots.reduce((total, lot) => total + lot.cost, 0);
  const buyCommission = closedLots.reduce((total, lot) => total + lot.buyCommission, 0);
  const durationWeightedMs = closedLots.reduce(
    (total, lot) => total + (Math.max(0, closedAt - lot.acquiredAt) * lot.qty),
    0
  );
  const holdingDays = closedShares > 0
    ? Math.floor(durationWeightedMs / closedShares / 86400000)
    : 0;
  const marginFee = originalShares > 0
    ? (Number(position.marginCharged) || 0) * (closedShares / originalShares)
    : 0;
  const feesAndCommissions = buyCommission + sellCommission + marginFee;
  const trade = closedShares > 0
    ? {
        ticker,
        date: closedAt,
        shares: closedShares,
        holdingDays,
        feesAndCommissions,
        netProfit: (closedShares * sellPrice) - costBasis - feesAndCommissions
      }
    : null;

  return {
    position: {
      ...position,
      shares: Math.max(0, originalShares - closedShares),
      tranches: remainingLots,
      commBuy: Math.max(0, scaledCommission - buyCommission),
      marginCharged: Math.max(0, (Number(position.marginCharged) || 0) - marginFee)
    },
    trade,
    marginFee
  };
}

export function processRollovers(state: any): boolean {
  if (!state || typeof state !== 'object') return false;

  if (!state.lastRolloverTimestamp) {
    state.lastRolloverTimestamp = Date.now();
    return false;
  }

  const now = new Date();
  let lastTime = new Date(state.lastRolloverTimestamp);
  let rolloversApplied = 0;
  let totalDeducted = 0;

  // Find the very next 04:00 AM boundary after the last recorded timestamp
  let nextBoundary = new Date(lastTime);
  if (nextBoundary.getHours() >= 4) {
    nextBoundary.setDate(nextBoundary.getDate() + 1);
  }
  nextBoundary.setHours(4, 0, 0, 0);

  // Time-travel loop: execute for every 04:00 AM passed
  while (nextBoundary <= now) {
    if (state.balance < 0) {
      // Dynamically fetch margin rate (fallback to 0.15 if not explicitly defined in settings)
      const marginRate = state.settings?.marginRate || 0.15; 
      const dailyFee = Math.abs(state.balance) * (marginRate / 365);
      
      state.balance -= dailyFee; // Deduct fee (compounding the negative balance)
      state.balance = Math.round(state.balance * 100) / 100;
      totalDeducted += dailyFee;
    }
    rolloversApplied++;
    nextBoundary.setDate(nextBoundary.getDate() + 1); // Advance to next day's 04:00 AM
  }

  if (rolloversApplied > 0) {
    state.lastRolloverTimestamp = Date.now();
    console.log(`[System]: Applied ${rolloversApplied} missed 04:00 AM rollovers. Deducted $${totalDeducted.toFixed(2)} total margin.`);
    return true;
  }
  return false;
}
