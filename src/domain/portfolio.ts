export interface TradeTranche {
  qty: number;
  shares?: number;
  price: number;
  date?: string;
  acquiredAt?: number;
  buyCommission?: number;
  [key: string]: unknown;
}

/** Collect active tranches from the canonical positions map. */
export function collectOpenPositionTranches<T extends { qty: number; price: number }>(
  positions: Record<string, { tranches?: T[] } | null | undefined>
): T[] {
  return Object.values(positions || {}).flatMap((position) =>
    Array.isArray(position?.tranches) ? position.tranches : []
  );
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

interface ClosedTrade {
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

/** Accepted broker-settings aliases used to build one validated commission contract. */
export interface CommissionRuleSource {
  commPerShare?: number;
  commissionPerShare?: number;
  commVolumePct?: number;
  commissionRatePct?: number;
  minCommOrder?: number;
  commissionMin?: number;
}

export function resolveCommissionConfig(rules: CommissionRuleSource): CommissionConfig {
  return {
    commPerShare: Number(rules.commPerShare ?? rules.commissionPerShare ?? 0.012),
    commVolumePct: Number(rules.commVolumePct ?? rules.commissionRatePct ?? 0.0012),
    minCommOrder: Number(rules.minCommOrder ?? rules.commissionMin ?? 1.2)
  };
}

/** Supported options for deterministic portfolio-level financing calculations. */
export interface MarginInterestOptions {
  dailyRate?: number;
  annualRate?: number;
  annualBorrowRate?: number;
  dayCountBasis?: number;
  marginUtilizationRatio?: number;
  marginRatio?: number;
  utilizationRatio?: number;
  marginDebt?: number;
  totalDebt?: number;
  balance?: number;
  days?: number;
  daysHeld?: number;
  holdingDays?: number;
  now?: Date | string | number;
  rolloverHour?: number;
  rolloverMinute?: number;
}

/** Canonical and legacy tranche fields accepted at the margin-interest boundary. */
export interface MarginInterestTranche {
  qty?: number;
  shares?: number;
  price?: number;
  entryPrice?: number;
  date?: string | number | Date;
  purchaseDate?: string | number | Date;
  entryDate?: string | number | Date;
  days?: number;
  daysHeld?: number;
  holdingDays?: number;
}

/** Legacy single-lot and canonical multi-lot shapes accepted by margin-interest calculations. */
export interface MarginInterestPosition extends MarginInterestOptions, MarginInterestTranche {
  tranches?: MarginInterestTranche[];
}

export interface ClosedTradeResult {
  position: MarginPosition;
  trade: ClosedTrade | null;
  marginFee: number;
}

/** Reject invalid broker fee assumptions instead of silently understating trading costs. */
function validateCommissionConfig(rules: CommissionConfig): void {
  if (!rules || ![rules.commPerShare, rules.commVolumePct, rules.minCommOrder].every(Number.isFinite) ||
      rules.commPerShare < 0 || rules.commVolumePct < 0 || rules.minCommOrder < 0) {
    throw new RangeError('Commission configuration must contain finite, non-negative rates and minimums.');
  }
}

export function calculateCommission(
  shares: number,
  totalVal: number,
  rules: CommissionConfig
): number {
  // A zero/invalid quantity remains a no-op for legacy callers, but a
  // positive transaction with an invalid proceeds value must not look free.
  if (!Number.isFinite(shares) || shares <= 0) return 0;
  if (!Number.isFinite(totalVal) || totalVal < 0) {
    throw new RangeError('Commission transaction value must be finite and non-negative.');
  }
  validateCommissionConfig(rules);
  const { commPerShare, commVolumePct, minCommOrder } = rules;
  return Math.max(minCommOrder, (commPerShare * shares) + (commVolumePct * totalVal));
}

/** Calculate execution commissions independently so each tranche retains its ticket minimum. */
export function calculateTrancheCommissions(
  tranches: Array<{ qty?: number; shares?: number; price: number }>,
  rules: CommissionConfig
): number {
  return tranches.reduce((total, tranche) => {
    const shares = Number(tranche.qty ?? tranche.shares);
    const price = Number(tranche.price);
    if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(price) || price <= 0) {
      throw new RangeError('Each commission tranche must have a positive finite quantity and price.');
    }
    return total + calculateCommission(shares, shares * price, rules);
  }, 0);
}

/**
 * Returns Armenia's local date and time parts regardless of the host machine's timezone.
 * Armenia is UTC+04:00 and does not currently observe daylight saving time.
 */
function getArmeniaClockParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Yerevan',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute')
  };
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

  if (![pYear, pMonth, pDay].every(Number.isFinite) || pMonth < 0 || pMonth > 11 || pDay < 1 || pDay > 31) return 0;

  // Date.UTC normalizes impossible dates (for example, February 31) into the
  // following month. Reject them instead of accruing interest from another date.
  const parsedPurchaseDate = new Date(Date.UTC(pYear, pMonth, pDay));
  if (parsedPurchaseDate.getUTCFullYear() !== pYear || parsedPurchaseDate.getUTCMonth() !== pMonth || parsedPurchaseDate.getUTCDate() !== pDay) return 0;

  const localNow = getArmeniaClockParts(now);
  const purchaseDay = parsedPurchaseDate.getTime();
  const currentDay = Date.UTC(localNow.year, localNow.month - 1, localNow.day);
  const diffDays = Math.round((currentDay - purchaseDay) / 86_400_000);
  if (diffDays <= 0) return 0;

  // Count today's cycle only after 04:00 in Asia/Yerevan, independent of host timezone.
  const hasPassedTodayCutoff = localNow.hour > 4 || (localNow.hour === 4 && localNow.minute >= 0);
  return hasPassedTodayCutoff ? diffDays : Math.max(0, diffDays - 1);
}

/**
 * Calculates accrued margin interest using daily compounding.
 * Supports:
 * 1. calculateMarginInterest(debt: number, dailyRate: number, days: number): number
 * 2. calculateMarginInterest(principal: number, options: MarginInterestOptions, days?: number): number
 * 3. calculateMarginInterest(stateOrTranches: any, options: MarginInterestOptions, days?: number): number
 */
/**
 * Calculates accrued margin interest using daily compounding.
 * Supports numeric principal, tranche arrays, and canonical/legacy position objects.
 */
export function calculateMarginInterest(
  tranchesOrDebt: number | MarginInterestTranche[] | MarginInterestPosition,
  paramsOrDailyRate?: number | MarginInterestOptions,
  maybeDays?: number
): number {
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

    if (!Number.isFinite(principal) || !Number.isFinite(dailyRate) ||
        !Number.isFinite(days) || !Number.isFinite(marginRatio) ||
        principal <= 0 || dailyRate <= 0 || days <= 0 || marginRatio < 0) return 0;
    return principal * marginRatio * (Math.pow(1 + dailyRate, days) - 1);
  }

  let tranches: MarginInterestTranche[] = [];
  const stateObj: MarginInterestPosition = Array.isArray(tranchesOrDebt)
    ? {}
    : tranchesOrDebt as MarginInterestPosition;

  if (Array.isArray(tranchesOrDebt)) {
    tranches = tranchesOrDebt;
  } else if (Array.isArray(stateObj.tranches)) {
    tranches = stateObj.tranches;
    // An initialized but empty tranche array must not hide a valid legacy
    // single-lot position. Only fall back when the object has its own entry
    // price, so we never infer cost basis from a live quote.
    if (
      tranches.length === 0 &&
      (stateObj.shares || stateObj.qty) &&
      (stateObj.price || stateObj.entryPrice)
    ) {
      tranches = [stateObj];
    }
  } else if (stateObj.shares || stateObj.qty) {
    tranches = [stateObj];
  }

  if (tranches.length === 0) return 0;

  // Merge options: parameters passed in 2nd argument take precedence over properties on state object.
  const passedOpts: MarginInterestOptions =
    typeof paramsOrDailyRate === 'object' && paramsOrDailyRate !== null
      ? paramsOrDailyRate
      : {};
  const options: MarginInterestPosition = { ...stateObj, ...passedOpts };

  let dailyRate = 0;
  if (typeof paramsOrDailyRate === 'number') {
    dailyRate = paramsOrDailyRate;
  } else if (typeof options.dailyRate === 'number') {
    dailyRate = options.dailyRate;
  } else if (typeof options.annualRate === 'number') {
    const basis = Number(options.dayCountBasis) || 365;
    dailyRate = options.annualRate / basis;
  } else if (typeof options.annualBorrowRate === 'number') {
    const basis = Number(options.dayCountBasis) || 365;
    dailyRate = options.annualBorrowRate / basis;
  }

  if (!Number.isFinite(dailyRate) || dailyRate <= 0) return 0;

  const totalInvested = tranches.reduce((sum, tranche) => {
    const quantity = Number(tranche.qty ?? tranche.shares ?? 0) || 0;
    const price = Number(tranche.price ?? tranche.entryPrice ?? 0) || 0;
    return sum + quantity * price;
  }, 0);

  let marginRatio = 1;
  const ratioCandidate =
    options.marginUtilizationRatio ?? options.marginRatio ?? options.utilizationRatio;

  if (typeof ratioCandidate === 'number') {
    if (!Number.isFinite(ratioCandidate) || ratioCandidate < 0) return 0;
    marginRatio = ratioCandidate;
  } else if (options.marginDebt !== undefined || options.totalDebt !== undefined ||
      (typeof options.balance === 'number' && options.balance < 0)) {
    // marginDebt may be a position's allocated share of portfolio debt. Prefer
    // it over totalDebt so a position-level calculation doesn't charge the
    // entire portfolio debt against every position.
    const debt = Math.abs(Number(options.marginDebt ?? options.totalDebt ?? options.balance) || 0);
    if (totalInvested > 0) {
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

  const now = options.now instanceof Date
    ? options.now
    : options.now !== undefined
      ? new Date(options.now)
      : new Date();
  if (!Number.isFinite(now.getTime())) return 0;

  let totalInterest = 0;
  for (const tranche of tranches) {
    const quantity = Number(tranche.qty ?? tranche.shares ?? 0) || 0;
    const price = Number(tranche.price ?? tranche.entryPrice ?? 0) || 0;
    const trancheCost = quantity * price;
    if (trancheCost <= 0) continue;

    let days = 0;
    if (explicitDays !== null && Number.isFinite(explicitDays)) {
      days = Math.max(0, explicitDays);
    } else if (typeof tranche.days === 'number') {
      days = Math.max(0, tranche.days);
    } else if (typeof tranche.daysHeld === 'number') {
      days = Math.max(0, tranche.daysHeld);
    } else if (typeof tranche.holdingDays === 'number') {
      days = Math.max(0, tranche.holdingDays);
    } else {
      const rawDate = tranche.date ?? tranche.purchaseDate ?? tranche.entryDate;
      let trancheTimestamp: number;
      if (rawDate instanceof Date) {
        trancheTimestamp = rawDate.getTime();
      } else if (typeof rawDate === 'number') {
        trancheTimestamp = rawDate;
      } else {
        trancheTimestamp = resolveTradeDateTimestamp(rawDate, now.getTime());
      }
      if (!Number.isFinite(trancheTimestamp)) trancheTimestamp = now.getTime();

      // Shift timestamps by four hours, then compare calendar dates in Asia/Yerevan.
      const offsetMs = 4 * 60 * 60 * 1000;
      const localTranche = new Date(trancheTimestamp + offsetMs);
      const localNow = new Date(now.getTime() + offsetMs);
      const trancheDay = Date.UTC(localTranche.getUTCFullYear(), localTranche.getUTCMonth(), localTranche.getUTCDate());
      const nowDay = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate());
      const elapsedCalendarDays = Math.max(0, Math.round((nowDay - trancheDay) / 86400000));
      const configuredHour = Number(options.rolloverHour);
      const configuredMinute = Number(options.rolloverMinute);
      const rolloverHour = Number.isInteger(configuredHour) && configuredHour >= 0 && configuredHour <= 23
        ? configuredHour
        : 4;
      const rolloverMinute = Number.isInteger(configuredMinute) && configuredMinute >= 0 && configuredMinute <= 59
        ? configuredMinute
        : 0;
      const localMinutes = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
      const cutoffMinutes = rolloverHour * 60 + rolloverMinute;
      days = Math.max(0, elapsedCalendarDays - (localMinutes < cutoffMinutes ? 1 : 0));
    }

    totalInterest += trancheCost * marginRatio * (Math.pow(1 + dailyRate, days) - 1);
  }

  return totalInterest;
}

export function calculateProjectedDebt(principal: number, dailyRate: number, days: number): number {
  const inputs = [principal, dailyRate, days].map(Number);
  if (!inputs.every(Number.isFinite)) return 0;
  const [rawPrincipal, rawRate, rawDays] = inputs;
  const p = Math.abs(rawPrincipal);
  const r = Math.max(0, rawRate);
  const d = Math.max(0, rawDays);
  // The live rollover ledger rounds the debt to cents after each daily
  // rollover. Apply the same rounding per full cycle so projections do not
  // drift from the amount that will actually be charged.
  const fullDays = Math.floor(d);
  const fractionalDay = d - fullDays;
  let projected = p;
  for (let day = 0; day < fullDays; day++) {
    projected = Number((projected * (1 + r)).toFixed(2));
    if (!Number.isFinite(projected)) return 0;
  }
  if (fractionalDay > 0) {
    projected *= Math.pow(1 + r, fractionalDay);
  }
  return Number.isFinite(projected) ? Number(projected.toFixed(2)) : 0;
}

export function calculateAccruedFees(
  totalComms: number,
  marginCharged: number,
  additionalMargin: number
): number {
  const finiteOrZero = (value: number) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const comms = finiteOrZero(totalComms);
  const charged = finiteOrZero(marginCharged);
  const addl = finiteOrZero(additionalMargin);
  const total = comms + charged + addl;
  return Number.isFinite(total) ? Number(total.toFixed(2)) : 0;
}

export function calculateBreakevenDays(
  netTargetProfit: number,
  totalDebt: number,
  dailyRate: number
): number | null {
  if (![netTargetProfit, totalDebt, dailyRate].every(Number.isFinite)) return null;
  if (netTargetProfit <= 0 || totalDebt === 0) return 0;
  if (totalDebt < 0 || dailyRate < 0) return null;
  // Positive interest coverage is impossible without a positive daily rate.
  if (dailyRate === 0) return null;

  // Search the same cent-rounded daily ledger used by projected debt. A closed
  // form logarithm can be off by a day because each rollover rounds to cents.
  const principal = Number(totalDebt.toFixed(2));
  let projected = principal;
  for (let day = 1; day <= 1_000_000; day++) {
    const next = Number((projected * (1 + dailyRate)).toFixed(2));
    if (!Number.isFinite(next) || next <= 0) return null;
    const remainingNet = Number((netTargetProfit - (next - principal)).toFixed(2));
    // The first day the debt accrual covers the target is the breakeven day.
    // The UI marks that crossing as exactly zero rather than displaying a negative balance.
    if (remainingNet <= 0) return day;
    // Cent rounding can make very small balances stationary indefinitely.
    if (next === projected) return null;
    projected = next;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** Resolve legacy/canonical tranche aliases into the quantity and price used by portfolio calculations. */
export function normalizePortfolioTranche(tranche: Record<string, unknown>): TradeTranche {
  const firstPositive = (...values: unknown[]): number => {
    for (const value of values) {
      if (value === null || value === undefined || value === '' || typeof value === 'boolean') continue;
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > 0) return numeric;
    }
    return 0;
  };
  const date = [tranche.date, tranche.purchaseDate, tranche.entryDate]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return {
    ...tranche,
    qty: firstPositive(tranche.qty, tranche.shares, tranche.quantity),
    price: firstPositive(tranche.price, tranche.entryPrice, tranche.averagePrice),
    ...(date ? { date } : {})
  } as TradeTranche;
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
    positions: {},
    activeTrancheGuestAssignments: {},
    activeTrancheGuestAssignmentDetails: {},
    guestTrancheLedger: []
  };
}

export function normalizePortfolioState(candidate: unknown, now = Date.now()): PortfolioState {
  if (!isRecord(candidate)) throw new Error('Portfolio state must be an object.');

  // Never let imported or legacy state inject runtime credentials. These are
  // managed separately from portfolio data and must not survive normalization.
  const {
    marginBalance: _legacyMarginBalance,
    gatewaySecret: _gatewaySecret,
    ...candidateState
  } = candidate;

  const blankState = createBlankState(now);
  const sourceCashCushion = isRecord(candidate.cashCushion) ? candidate.cashCushion : {};
  const hasCanonicalPositions = Object.prototype.hasOwnProperty.call(candidate, 'positions');
  const positions: Record<string, unknown> = isRecord(candidate.positions) ? candidate.positions : {};
  // Explicitly importing a legacy-only backup is a user-requested replacement,
  // so migrate its old holdings schema only when no canonical positions field exists.
  if (!hasCanonicalPositions && Array.isArray(candidate.holdings)) {
    candidate.holdings.filter(isRecord).forEach((holding) => {
      const ticker = String(holding.ticker || '').trim().toUpperCase();
      if (!ticker || Object.prototype.hasOwnProperty.call(positions, ticker)) return;

      const tranches = (Array.isArray(holding.tranches) ? holding.tranches : [])
        .filter(isRecord)
        .map(normalizePortfolioTranche)
        .filter((tranche) => tranche.qty > 0 && tranche.price > 0);
      const shares = tranches.reduce((total, tranche) => total + tranche.qty, 0);
      if (shares <= 0) return;

      const costBasis = tranches.reduce((total, tranche) => total + tranche.qty * tranche.price, 0);
      const averagePrice = costBasis / shares;
      const startDate = tranches.map((tranche) => tranche.date).filter(Boolean).sort()[0];
      positions[ticker] = {
        ticker,
        shares,
        currentPrice: finiteNumber(holding.currentPrice, averagePrice),
        pt: finiteNumber(holding.analystTarget, Number((averagePrice * 1.1).toFixed(2))),
        commBuy: finiteNumber(holding.commBuy, 0),
        startDate,
        tranches
      };
    });
  }
  const normalizedPositions: Record<string, MarginPosition> = {};

  Object.entries(positions).forEach(([ticker, position]) => {
    if (!isRecord(position)) return;
    const tranches = Array.isArray(position.tranches)
      ? position.tranches.filter(isRecord).map(normalizePortfolioTranche)
      : [];
    // Define the property explicitly: imported JSON can contain a ticker key
    // named "__proto__", and assignment to that key on a plain object changes
    // its prototype instead of preserving the position as an enumerable entry.
    Object.defineProperty(normalizedPositions, ticker, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: {
        ...position,
        ticker: typeof position.ticker === 'string' ? position.ticker : ticker,
        shares: finiteNumber(position.shares, 0),
        tranches,
        commBuy: finiteNumber(position.commBuy, 0),
        marginCharged: finiteNumber(position.marginCharged, 0)
      }
    });
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
    ...candidateState,
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

/**
 * Creates a backup snapshot without mutating the live application state.
 * Secrets and legacy derived fields must never be included in exported backups.
 */
export function createPortfolioBackupSnapshot<T extends object>(state: T): Partial<T> {
  const snapshot: Record<string, unknown> = { ...state };
  delete snapshot.gatewaySecret;
  delete snapshot.marginBalance;
  return snapshot as Partial<T>;
}

export function normalizePortfolioBackup(candidate: unknown, now = Date.now()): PortfolioState {
  if (!isRecord(candidate)) throw new Error('Portfolio backup must be an object.');
  const recognizedFields = ['positions', 'holdings', 'balance', 'cashCushion', 'closedTrades', 'activeView', 'startDate'];
  if (!recognizedFields.some(field => Object.hasOwn(candidate, field))) {
    throw new Error('File does not contain a recognized portfolio backup.');
  }

  // Validate top-level container shapes before normalization. A present but
  // malformed canonical positions field suppresses legacy holdings migration;
  // silently turning it into {} would make an import appear successful while
  // discarding the user's positions.
  if (Object.hasOwn(candidate, 'positions') && !isRecord(candidate.positions)) {
    throw new Error('Invalid positions in portfolio backup: expected an object keyed by ticker.');
  }
  if (Object.hasOwn(candidate, 'holdings') && !Array.isArray(candidate.holdings)) {
    throw new Error('Invalid holdings in portfolio backup: expected an array.');
  }
  if (Object.hasOwn(candidate, 'cashCushion') && !isRecord(candidate.cashCushion)) {
    throw new Error('Invalid cashCushion in portfolio backup: expected an object.');
  }
  if (Object.hasOwn(candidate, 'closedTrades') && !Array.isArray(candidate.closedTrades)) {
    throw new Error('Invalid closedTrades in portfolio backup: expected an array.');
  }

  // Backups are user-supplied data. Do not silently coerce invalid financial
  // quantities to zero or accept negative shares/prices, which can corrupt
  // position valuation and realized-trade calculations after import.
  const validateNonNegativeField = (
    record: Record<string, unknown>,
    field: string,
    label: string,
    strictlyPositive = false
  ) => {
    if (!Object.hasOwn(record, field)) return;
    const rawValue = record[field];
    if (
      rawValue === null ||
      typeof rawValue === 'boolean' ||
      (typeof rawValue !== 'number' && typeof rawValue !== 'string') ||
      (typeof rawValue === 'string' && !rawValue.trim())
    ) {
      throw new Error(`Invalid ${label} in portfolio backup: expected a ${strictlyPositive ? 'positive' : 'non-negative'} finite number.`);
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value) || (strictlyPositive ? value <= 0 : value < 0)) {
      throw new Error(`Invalid ${label} in portfolio backup: expected a ${strictlyPositive ? 'positive' : 'non-negative'} finite number.`);
    }
  };

  if (isRecord(candidate.positions)) {
    for (const [ticker, rawPosition] of Object.entries(candidate.positions)) {
      if (!isRecord(rawPosition)) {
        throw new Error(`Invalid position "${ticker}" in portfolio backup.`);
      }
      for (const field of ['shares', 'currentPrice', 'pt', 'commBuy', 'marginCharged'] as const) {
        validateNonNegativeField(rawPosition, field, `${ticker} ${field}`);
      }
      if (Array.isArray(rawPosition.tranches)) {
        let trancheShares = 0;
        rawPosition.tranches.forEach((rawTranche, index) => {
          if (!isRecord(rawTranche)) {
            throw new Error(`Invalid tranche ${index + 1} for ${ticker} in portfolio backup.`);
          }
          validateNonNegativeField(rawTranche, 'qty', `${ticker} tranche quantity`, true);
          validateNonNegativeField(rawTranche, 'price', `${ticker} tranche price`, true);
          validateNonNegativeField(rawTranche, 'buyCommission', `${ticker} tranche commission`);
          trancheShares += Number(rawTranche.qty);
        });

        // Canonical positions use both the aggregate share count and FIFO lots.
        // If both are present, they must describe the same quantity; otherwise
        // a sale can invent fallback lots or silently scale down imported lots.
        if (rawPosition.tranches.length > 0 && Object.hasOwn(rawPosition, 'shares')) {
          const shares = Number(rawPosition.shares);
          const tolerance = Math.max(1e-8, Math.abs(shares) * 1e-8);
          if (Math.abs(trancheShares - shares) > tolerance) {
            throw new Error(
              `Invalid ${ticker} position in portfolio backup: share count (${shares}) does not match tranche total (${trancheShares}).`
            );
          }
        }
      }
    }
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

export function resolveTradeDateTimestamp(value: unknown, fallbackTimestamp = Date.now()): number {
  if (typeof value !== 'string' || !value.trim()) return fallbackTimestamp;
  const normalizedValue = value.trim();
  const isoDate = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) {
    const year = Number(isoDate[1]);
    const month = Number(isoDate[2]);
    const day = Number(isoDate[3]);
    const timestamp = Date.UTC(year, month - 1, day);
    const parsedDate = new Date(timestamp);
    if (
      month < 1 || month > 12 || day < 1 ||
      parsedDate.getUTCFullYear() !== year ||
      parsedDate.getUTCMonth() !== month - 1 ||
      parsedDate.getUTCDate() !== day
    ) return fallbackTimestamp;
    return timestamp;
  }

  const shortDate = normalizedValue.match(/^(\d{1,2})\s+([a-z]{3,})(?:\s+(\d{4}))?$/i);
  if (shortDate) {
    const monthIndex = new Date(`${shortDate[2]} 1, 2000`).getMonth();
    if (!Number.isNaN(monthIndex)) {
      let year = shortDate[3] ? Number(shortDate[3]) : new Date(fallbackTimestamp).getFullYear();
      const day = Number(shortDate[1]);
      let date = new Date(year, monthIndex, day);
      if (date.getMonth() !== monthIndex || date.getDate() !== day) return fallbackTimestamp;
      let timestamp = date.getTime();
      if (!shortDate[3] && timestamp > fallbackTimestamp) {
        year -= 1;
        date = new Date(year, monthIndex, day);
        if (date.getMonth() !== monthIndex || date.getDate() !== day) return fallbackTimestamp;
        timestamp = date.getTime();
      }
      return timestamp;
    }
  }

  const parsed = Date.parse(normalizedValue);
  return Number.isFinite(parsed) ? parsed : fallbackTimestamp;
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
  if (!Number.isFinite(position.shares) || position.shares <= 0 ||
      !Number.isFinite(shares) || shares <= 0 || shares - position.shares > 1e-8) {
    throw new Error('Closed share quantity must be positive and no greater than the open position.');
  }
  if (!Number.isFinite(sellPrice) || sellPrice <= 0) {
    throw new Error('Sale price must be a finite positive number.');
  }
  if (!Number.isFinite(sellCommission) || sellCommission < 0) {
    throw new Error('Sale commission must be a finite non-negative number.');
  }
  if (!Number.isFinite(closedAt)) {
    throw new Error('Close timestamp must be finite.');
  }

  const originalShares = Number(position.shares);
  const sourceTranches = Array.isArray(position.tranches) ? position.tranches : [];
  if (sourceTranches.length === 0) {
    throw new Error('Position has no cost-basis tranches; reconcile its entry cost before selling.');
  }

  const lots = sourceTranches.map((tranche) => {
    const qty = Number(tranche.qty);
    const price = Number(tranche.price);
    const buyCommission = tranche.buyCommission === undefined ? 0 : Number(tranche.buyCommission);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0 ||
        !Number.isFinite(buyCommission) || buyCommission < 0) {
      throw new Error('Position contains an invalid cost-basis tranche; reconcile lots before selling.');
    }
    return { ...tranche, qty, price, buyCommission };
  });

  const trancheShares = lots.reduce((total, tranche) => total + tranche.qty, 0);
  const shareTolerance = Math.max(1e-8, Math.abs(originalShares) * 1e-8);
  if (trancheShares - originalShares > shareTolerance) {
    throw new Error(
      `Position tranche total (${trancheShares}) exceeds recorded open shares (${originalShares}); reconcile lots before selling.`
    );
  }
  if (originalShares - trancheShares > shareTolerance) {
    throw new Error(
      `Recorded open shares (${originalShares}) do not match tranche total (${trancheShares}); reconcile lots before selling.`
    );
  }

  // Normalize only sub-tolerance floating-point drift after validating the ledger.
  const scale = trancheShares > originalShares && trancheShares > 0 ? originalShares / trancheShares : 1;
  if (scale < 1) {
    lots.forEach((tranche) => {
      tranche.qty *= scale;
      tranche.buyCommission *= scale;
    });
  }

  const rawCommission = Number(position.commBuy);
  if (!Number.isFinite(rawCommission) || rawCommission < 0) {
    throw new Error('Position entry commission must be finite and non-negative.');
  }
  const scaledCommission = scale < 1 ? rawCommission * scale : rawCommission;
  const lotCommissionTotal = lots.reduce((total, tranche) => total + tranche.buyCommission, 0);
  if (lotCommissionTotal - scaledCommission > 0.01) {
    throw new Error('Tranche entry commissions exceed the recorded position commission; reconcile fees before selling.');
  }
  const rawMarginCharged = position.marginCharged === undefined ? 0 : Number(position.marginCharged);
  if (!Number.isFinite(rawMarginCharged) || rawMarginCharged < 0) {
    throw new Error('Position financing charges must be finite and non-negative.');
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
    ? rawMarginCharged * (closedShares / originalShares)
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
      marginCharged: Math.max(0, rawMarginCharged - marginFee)
    },
    trade,
    marginFee
  };
}

export interface RolloverState {
  balance: number;
  lastRolloverTimestamp?: number;
  brokerAssumptions?: {
    annualRate?: number | string;
    annualBorrowRate?: number | string;
    dayCountBasis?: number | string;
    rolloverHour?: number;
    rolloverMinute?: number;
  };
  settings?: {
    marginRate?: number | string;
  };
}

export function processRollovers(state: RolloverState | null | undefined): boolean {
  if (!state || typeof state !== 'object') return false;

  if (!state.lastRolloverTimestamp) {
    state.lastRolloverTimestamp = Date.now();
    return false;
  }

  const rules = state.brokerAssumptions || {};
  const configuredRate = Number(
    rules.annualRate ?? rules.annualBorrowRate ?? state.settings?.marginRate ?? 0.15
  );
  // Corrupted cloud/imported settings must never turn debt into Infinity.
  // Match the supported broker-settings range; invalid rates accrue no interest.
  const annualRate = Number.isFinite(configuredRate) && configuredRate >= 0 && configuredRate <= 1
    ? configuredRate
    : 0;
  const configuredDayCount = Number(rules.dayCountBasis ?? 365);
  const dayCountBasis = [360, 365].includes(configuredDayCount) ? configuredDayCount : 365;
  const dailyRate = annualRate / dayCountBasis;
  const configuredHour = rules.rolloverHour;
  const configuredMinute = rules.rolloverMinute;
  const rolloverHour = Number.isInteger(configuredHour) && configuredHour >= 0 && configuredHour <= 23
    ? configuredHour
    : 4;
  const rolloverMinute = Number.isInteger(configuredMinute) && configuredMinute >= 0 && configuredMinute <= 59
    ? configuredMinute
    : 0;
  const now = new Date();
  const lastTimestamp = Number(state.lastRolloverTimestamp);
  const lastDate = new Date(lastTimestamp);
  if (!Number.isFinite(lastTimestamp) || lastTimestamp <= 0 || !Number.isFinite(lastDate.getTime())) {
    state.lastRolloverTimestamp = now.getTime();
    return false;
  }

  const lastParts = getArmeniaClockParts(lastDate);
  // Armenia uses UTC+04:00 and currently has no daylight-saving transitions.
  const boundaryFor = (year: number, month: number, day: number) =>
    Date.UTC(year, month - 1, day, rolloverHour, rolloverMinute) - 4 * 60 * 60 * 1000;
  let boundary = boundaryFor(lastParts.year, lastParts.month, lastParts.day);

  // If the stored timestamp is at or after today's cutoff, start tomorrow.
  if (boundary <= lastTimestamp) {
    const nextDay = new Date(Date.UTC(lastParts.year, lastParts.month - 1, lastParts.day + 1));
    boundary = boundaryFor(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate());
  }

  let rolloversApplied = 0;
  let totalDeducted = 0;
  let lastProcessedBoundary = lastTimestamp;

  while (boundary <= now.getTime()) {
    if (state.balance < 0 && dailyRate > 0) {
      const before = Math.abs(Number(state.balance) || 0);
      const after = Number((before * (1 + dailyRate)).toFixed(2));
      state.balance = -after;
      totalDeducted += after - before;
    }
    rolloversApplied++;
    lastProcessedBoundary = boundary;

    const boundaryDate = new Date(boundary + 4 * 60 * 60 * 1000);
    boundary = boundaryFor(
      boundaryDate.getUTCFullYear(),
      boundaryDate.getUTCMonth() + 1,
      boundaryDate.getUTCDate() + 1
    );
  }

  if (rolloversApplied > 0) {
    // Persist the actual last cutoff, not the time of this sync, so later
    // pulls cannot skip or double-count a rollover.
    state.lastRolloverTimestamp = lastProcessedBoundary;
    console.log(
      `[System]: Applied ${rolloversApplied} missed ${String(rolloverHour).padStart(2, '0')}:${String(rolloverMinute).padStart(2, '0')} Asia/Yerevan rollovers. Deducted $${totalDeducted.toFixed(2)} total margin.`
    );
    return true;
  }
  return false;
}
