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
  settings?: { marginRate?: number;[key: string]: unknown };
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

/**
 * Broker cutoff: 04:00 AM local Armenia time (UTC+4)
 */
export function getRolloverCutoff(date: Date = new Date()): Date {
  const cutoff = new Date(date);
  cutoff.setHours(4, 0, 0, 0);
  return cutoff;
}

/**
 * Calculates overnight rollover cycles between a past purchase date and current time.
 */
export function getAccruedRolloverCycles(purchaseDateStr?: string, now: Date = new Date()): number {
  if (!purchaseDateStr) return 0;

  const parts = purchaseDateStr.split(/[-/]/);
  if (parts.length < 3) return 0;

  const pYear = parseInt(parts[0], 10);
  const pMonth = parseInt(parts[1], 10) - 1;
  const pDay = parseInt(parts[2], 10);

  const purchaseMidnight = new Date(pYear, pMonth, pDay, 0, 0, 0, 0);
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

  const diffDays = Math.round((todayMidnight.getTime() - purchaseMidnight.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 0;

  // If purchase date was yesterday or earlier, check if today's 04:00 AM cutoff has passed
  const todayCutoff = getRolloverCutoff(now);
  const hasPassedTodayCutoff = now.getTime() >= todayCutoff.getTime();

  return hasPassedTodayCutoff ? diffDays : Math.max(0, diffDays - 1);
}

/**
 * Calculates accrued margin interest using simple daily interest.
 * Supports:
 * 1. calculateMarginInterest(debt: number, dailyRate: number, days: number): number
 * 2. calculateMarginInterest(principal: number, options: MarginInterestOptions, days?: number): number
 * 3. calculateMarginInterest(stateOrTranches: any, options: MarginInterestOptions, days?: number): number
 */
export function calculateMarginInterest(
  tranchesOrDebt: any,
  paramsOrDailyRate?: any,
  maybeDays?: number
): number {
  // Signature 1: Direct number principal
  if (typeof tranchesOrDebt === 'number') {
    const principal = tranchesOrDebt;
    let dailyRate = 0;
    let marginRatio = 1;
    let days = 0;

    if (typeof paramsOrDailyRate === 'number') {
      dailyRate = paramsOrDailyRate;
      days = Number(maybeDays) || 0;
    } else if (paramsOrDailyRate && typeof paramsOrDailyRate === 'object') {
      const opts = paramsOrDailyRate;
      if (typeof opts.dailyRate === 'number') {
        dailyRate = opts.dailyRate;
      } else if (typeof opts.annualRate === 'number') {
        dailyRate = opts.annualRate / (Number(opts.dayCountBasis) || 365);
      } else if (typeof opts.annualBorrowRate === 'number') {
        dailyRate = opts.annualBorrowRate / (Number(opts.dayCountBasis) || 365);
      }

      if (typeof opts.marginUtilizationRatio === 'number') {
        marginRatio = opts.marginUtilizationRatio;
      } else if (typeof opts.marginRatio === 'number') {
        marginRatio = opts.marginRatio;
      } else if (typeof opts.utilizationRatio === 'number') {
        marginRatio = opts.utilizationRatio;
      } else if (typeof opts.marginDebt === 'number') {
        const debt = Math.abs(opts.marginDebt);
        if (typeof opts.totalDebt === 'number' && opts.totalDebt > 0) {
          marginRatio = debt / opts.totalDebt;
        } else if (principal > 0) {
          marginRatio = debt / principal;
        }
      }

      days = Number(maybeDays ?? opts.days ?? opts.daysHeld ?? opts.holdingDays) || 0;
    }

    return principal * marginRatio * dailyRate * days;
  }

  // Signature 2: Tranches array or state/holding/position object
  let tranches: any[] = [];
  const stateObj =
    typeof tranchesOrDebt === 'object' && tranchesOrDebt !== null && !Array.isArray(tranchesOrDebt)
      ? tranchesOrDebt
      : {};

  if (Array.isArray(tranchesOrDebt)) {
    tranches = tranchesOrDebt;
  } else if (stateObj) {
    if (Array.isArray(stateObj.tranches)) {
      tranches = stateObj.tranches;
    } else if (stateObj.shares || stateObj.qty) {
      tranches = [stateObj];
    }
  }

  if (tranches.length === 0) return 0;

  // Merge options: parameters passed in 2nd argument take precedence over properties on state object
  const passedOpts =
    typeof paramsOrDailyRate === 'object' && paramsOrDailyRate !== null
      ? paramsOrDailyRate
      : {};
  const options = { ...stateObj, ...passedOpts };

  let dailyRate = 0;
  if (typeof paramsOrDailyRate === 'number') {
    dailyRate = paramsOrDailyRate;
  } else if (typeof options.dailyRate === 'number' && options.dailyRate > 0) {
    dailyRate = options.dailyRate;
  } else if (typeof options.annualRate === 'number' && options.annualRate > 0) {
    const basis = Number(options.dayCountBasis) || 365;
    dailyRate = options.annualRate / basis;
  } else if (typeof options.annualBorrowRate === 'number' && options.annualBorrowRate > 0) {
    const basis = Number(options.dayCountBasis) || 365;
    dailyRate = options.annualBorrowRate / basis;
  }

  if (dailyRate <= 0) return 0;

  const totalInvested = tranches.reduce((sum: number, tr: any) => {
    const q = Number(tr.qty ?? tr.shares ?? 0) || 0;
    const p = Number(tr.price ?? tr.entryPrice ?? 0) || 0;
    return sum + q * p;
  }, 0);

  let marginRatio = 1;
  const ratioCandidate =
    options.marginUtilizationRatio ?? options.marginRatio ?? options.utilizationRatio;

  if (typeof ratioCandidate === 'number') {
    marginRatio = ratioCandidate;
  } else if (options.marginDebt !== undefined || (typeof options.balance === 'number' && options.balance < 0)) {
    const debt = Math.abs(Number(options.marginDebt ?? options.balance) || 0);
    if (typeof options.totalDebt === 'number' && options.totalDebt > 0) {
      marginRatio = debt / options.totalDebt;
    } else if (totalInvested > 0) {
      marginRatio = debt / totalInvested;
    }
  }

  const explicitDays =
    maybeDays !== undefined
      ? Number(maybeDays)
      : passedOpts.days !== undefined
        ? Number(passedOpts.days)
        : passedOpts.daysHeld !== undefined
          ? Number(passedOpts.daysHeld)
          : passedOpts.holdingDays !== undefined
            ? Number(passedOpts.holdingDays)
            : null;

  const now = options.now ? new Date(options.now) : new Date();

  let totalInterest = 0;
  for (const tr of tranches) {
    const q = Number(tr.qty ?? tr.shares ?? 0) || 0;
    const p = Number(tr.price ?? tr.entryPrice ?? 0) || 0;
    const trancheCost = q * p;
    if (trancheCost <= 0) continue;

    let days = 0;
    if (explicitDays !== null && Number.isFinite(explicitDays)) {
      days = Math.max(0, explicitDays);
    } else if (typeof tr.days === 'number') {
      days = Math.max(0, tr.days);
    } else if (typeof tr.daysHeld === 'number') {
      days = Math.max(0, tr.daysHeld);
    } else if (typeof tr.holdingDays === 'number') {
      days = Math.max(0, tr.holdingDays);
    } else {
      const rawDate = tr.date ?? tr.purchaseDate ?? tr.entryDate;
      let trancheTs: number;
      if (typeof resolveTradeDateTimestamp === 'function') {
        trancheTs = resolveTradeDateTimestamp(rawDate, now.getTime());
      } else if (rawDate instanceof Date) {
        trancheTs = rawDate.getTime();
      } else if (typeof rawDate === 'number') {
        trancheTs = rawDate;
      } else {
        trancheTs = Date.parse(String(rawDate)) || now.getTime();
      }

      const trancheDate = new Date(trancheTs);
      const dTranche = new Date(trancheDate.getFullYear(), trancheDate.getMonth(), trancheDate.getDate());
      const dNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const diffDays = Math.round((dNow.getTime() - dTranche.getTime()) / (1000 * 60 * 60 * 24));
      days = Math.max(0, diffDays);
    }

    totalInterest += trancheCost * marginRatio * dailyRate * days;
  }

  return totalInterest;
}

export function calculateProjectedDebt(principal: number, dailyRate: number, days: number): number {
  const p = Math.abs(Number(principal) || 0);
  const r = Number(dailyRate) || 0;
  const d = Number(days) || 0;
  return Number((p * (1 + r * d)).toFixed(2));
}

export function calculateAccruedFees(
  totalComms: number,
  marginCharged: number,
  additionalMargin: number
): number {
  const comms = Number(totalComms) || 0;
  const charged = Number(marginCharged) || 0;
  const addl = Number(additionalMargin) || 0;
  return Number((comms + charged + addl).toFixed(2));
}

export function calculateBreakevenDays(
  netTargetProfit: number,
  totalDebt: number,
  dailyRate: number
): number | null {
  if (totalDebt <= 0 || netTargetProfit <= 0 || dailyRate <= 0) return 0;
  const days = netTargetProfit / (totalDebt * dailyRate);
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

  if ('marginBalance' in candidate) {
    delete (candidate as Record<string, unknown>).marginBalance;
  }

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
  // The stored timestamp marks the last rollover-processing date. Start with
  // the following day's cutoff so we don't charge an extra rollover on that
  // same calendar day when the timestamp happens to be before 04:00.
  nextBoundary.setDate(nextBoundary.getDate() + 1);
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
