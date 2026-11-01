type YahooDisplayValue = string | number | null;

export interface YahooDeepPrice {
  current: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  preMarketPrice: number | null;
  preMarketChange: number | null;
  preMarketChangePercent: number | null;
  postMarketPrice: number | null;
  postMarketChange: number | null;
  postMarketChangePercent: number | null;
  regularMarketTime: number | null;
  preMarketTime: number | null;
  postMarketTime: number | null;
  marketState: string | null;
}

export interface YahooDeepValuation {
  peTrailing: YahooDisplayValue;
  peForward: YahooDisplayValue;
  pegRatio: YahooDisplayValue;
  shortPercentOfFloat: YahooDisplayValue;
  priceToBook: YahooDisplayValue;
}

export interface YahooDeepFinancialHealth {
  profitMargin: YahooDisplayValue;
  returnOnEquity: YahooDisplayValue;
  totalDebt: number | null;
}

export interface YahooDeepAnalystTargets {
  mean: number | null;
  high: number | null;
  low: number | null;
  median: number | null;
  numberOfAnalysts: number | null;
  consensusRecommendation: string | null;
}

export interface YahooUpgradeDowngrade {
  firm: string | null;
  toGrade: string | null;
  fromGrade: string | null;
  action: string | null;
}

export interface YahooEarningsHistoryItem {
  quarter: string | null;
  epsEstimate: YahooDisplayValue;
  epsActual: YahooDisplayValue;
  epsDifference: number | null;
  surprisePercent: YahooDisplayValue;
}

export interface YahooDeepStockData {
  symbol?: string;
  error?: string;
  price: YahooDeepPrice;
  valuation: YahooDeepValuation;
  financialHealth: YahooDeepFinancialHealth;
  analystTargets: YahooDeepAnalystTargets;
  calendar: { earningsDate: string | null };
  upgradesDowngrades: YahooUpgradeDowngrade[];
  earningsHistory: YahooEarningsHistoryItem[];
  profile: Record<string, YahooDisplayValue>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function displayValue(value: unknown): YahooDisplayValue {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function normalizePrice(value: unknown): YahooDeepPrice {
  const record = asRecord(value) ?? {};
  return {
    current: finiteNumber(record.current),
    previousClose: finiteNumber(record.previousClose),
    change: finiteNumber(record.change),
    changePercent: finiteNumber(record.changePercent),
    preMarketPrice: finiteNumber(record.preMarketPrice),
    preMarketChange: finiteNumber(record.preMarketChange),
    preMarketChangePercent: finiteNumber(record.preMarketChangePercent),
    postMarketPrice: finiteNumber(record.postMarketPrice),
    postMarketChange: finiteNumber(record.postMarketChange),
    postMarketChangePercent: finiteNumber(record.postMarketChangePercent),
    regularMarketTime: finiteNumber(record.regularMarketTime),
    preMarketTime: finiteNumber(record.preMarketTime),
    postMarketTime: finiteNumber(record.postMarketTime),
    marketState: stringValue(record.marketState)
  };
}

function normalizeValuation(value: unknown): YahooDeepValuation {
  const record = asRecord(value) ?? {};
  return {
    peTrailing: displayValue(record.peTrailing),
    peForward: displayValue(record.peForward),
    pegRatio: displayValue(record.pegRatio),
    shortPercentOfFloat: displayValue(record.shortPercentOfFloat),
    priceToBook: displayValue(record.priceToBook)
  };
}

function normalizeFinancialHealth(value: unknown): YahooDeepFinancialHealth {
  const record = asRecord(value) ?? {};
  return {
    profitMargin: displayValue(record.profitMargin),
    returnOnEquity: displayValue(record.returnOnEquity),
    totalDebt: finiteNumber(record.totalDebt)
  };
}

function normalizeAnalystTargets(value: unknown): YahooDeepAnalystTargets {
  const record = asRecord(value) ?? {};
  return {
    mean: finiteNumber(record.mean),
    high: finiteNumber(record.high),
    low: finiteNumber(record.low),
    median: finiteNumber(record.median),
    numberOfAnalysts: finiteNumber(record.numberOfAnalysts),
    consensusRecommendation: stringValue(record.consensusRecommendation)
  };
}

function normalizeUpgradeActions(value: unknown): YahooUpgradeDowngrade[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(candidate => {
    const record = asRecord(candidate);
    if (!record) return [];
    return [{
      firm: stringValue(record.firm),
      toGrade: stringValue(record.toGrade),
      fromGrade: stringValue(record.fromGrade),
      action: stringValue(record.action)
    }];
  });
}

function normalizeEarningsHistory(value: unknown): YahooEarningsHistoryItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(candidate => {
    const record = asRecord(candidate);
    if (!record) return [];
    return [{
      quarter: stringValue(record.quarter),
      epsEstimate: displayValue(record.epsEstimate),
      epsActual: displayValue(record.epsActual),
      epsDifference: finiteNumber(record.epsDifference),
      surprisePercent: displayValue(record.surprisePercent)
    }];
  });
}

function normalizeProfile(value: unknown): Record<string, YahooDisplayValue> {
  const record = asRecord(value);
  if (!record) return {};
  const profile: Record<string, YahooDisplayValue> = {};
  for (const [key, entry] of Object.entries(record)) {
    const normalized = displayValue(entry);
    if (normalized !== null) profile[key] = normalized;
  }
  return profile;
}

/**
 * Validate the Worker-normalized Yahoo deep-data payload before it enters UI
 * state. Missing/malformed leaf values become null or empty collections.
 */
export function normalizeYahooDeepStockData(value: unknown): YahooDeepStockData {
  const record = asRecord(value) ?? {};
  const calendar = asRecord(record.calendar) ?? {};
  return {
    ...(typeof record.symbol === 'string' ? { symbol: record.symbol } : {}),
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
    price: normalizePrice(record.price),
    valuation: normalizeValuation(record.valuation),
    financialHealth: normalizeFinancialHealth(record.financialHealth),
    analystTargets: normalizeAnalystTargets(record.analystTargets),
    calendar: { earningsDate: stringValue(calendar.earningsDate) },
    upgradesDowngrades: normalizeUpgradeActions(record.upgradesDowngrades),
    earningsHistory: normalizeEarningsHistory(record.earningsHistory),
    profile: normalizeProfile(record.profile)
  };
}
