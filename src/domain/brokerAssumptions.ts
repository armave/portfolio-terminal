import type { BrokerAssumptions, BrokerRules } from '../types/portfolio';

/** Default Freedom Broker assumptions. Rates are decimal fractions, not percentages. */
export const DEFAULT_BROKER_ASSUMPTIONS: BrokerAssumptions = {
  broker: 'Freedom Broker Armenia (Tradernet)',
  annualBorrowRate: 0.15,
  dayCountBasis: 365,
  rolloverHour: 4,
  rolloverMinute: 0,
  rolloverTimeZone: 'Asia/Yerevan',
  maintenanceEquityRatio: 0.1,
  stopOutRatio: 0,
  commissionMin: 1.2,
  commissionPerShare: 0.012,
  commissionRatePct: 0.0012
};

type UnknownRecord = Record<string, unknown> & Partial<BrokerAssumptions> & Partial<BrokerRules>;
function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}
function hasValue(value: unknown): boolean { return value !== undefined && value !== null; }
function readNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
/** Legacy runtime names take precedence when both forms exist, matching the historical load path. */
function readLegacyFirst(record: UnknownRecord, canonical: string, legacy: string): unknown {
  const oldValue = record[legacy];
  return hasValue(oldValue) ? oldValue : record[canonical];
}
function readBoundedNumber(record: UnknownRecord, canonical: string, legacy: string,
  fallback: number, min: number, max: number, includeMax = true): number {
  const value = readNumber(readLegacyFirst(record, canonical, legacy));
  if (value === undefined || value < min || (includeMax ? value > max : value >= max)) return fallback;
  return value;
}
function parseCutoff(value: unknown): { hour: number; minute: number } | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(?:([01]?[0-9]|2[0-3])):([0-5][0-9])$/.exec(value.trim());
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : undefined;
}
function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0); return true; }
  catch { return false; }
}

/** Converts persisted snapshots and imported settings into the single runtime contract. */
export function normalizeBrokerAssumptions(
  input: unknown,
  fallback: BrokerAssumptions = DEFAULT_BROKER_ASSUMPTIONS
): BrokerAssumptions {
  const record = asRecord(input) ?? {};
  const broker = typeof record.broker === 'string' && record.broker.trim() ? record.broker.trim() : fallback.broker;
  const dayCount = readNumber(record.dayCountBasis);
  const dayCountBasis: 360 | 365 = dayCount === 360 || dayCount === 365 ? dayCount : fallback.dayCountBasis;

  const legacyCutoff = parseCutoff(record.dailyRolloverCutoffArmenia);
  const rawHour = record.rolloverHour;
  const hourValue = readNumber(rawHour);
  const rolloverHour = hasValue(rawHour)
    ? hourValue !== undefined && Number.isInteger(hourValue) && hourValue >= 0 && hourValue <= 23 ? hourValue : fallback.rolloverHour
    : legacyCutoff?.hour ?? fallback.rolloverHour;
  const rawMinute = record.rolloverMinute;
  const minuteValue = readNumber(rawMinute);
  const rolloverMinute = hasValue(rawMinute)
    ? minuteValue !== undefined && Number.isInteger(minuteValue) && minuteValue >= 0 && minuteValue <= 59 ? minuteValue : fallback.rolloverMinute
    : legacyCutoff?.minute ?? fallback.rolloverMinute;
  const rolloverTimeZone = isValidTimeZone(record.rolloverTimeZone) ? record.rolloverTimeZone.trim() : fallback.rolloverTimeZone;

  const annualBorrowRate = readBoundedNumber(record, 'annualBorrowRate', 'annualRate', fallback.annualBorrowRate, 0, 1);
  const maintenanceEquityRatio = readBoundedNumber(record, 'maintenanceEquityRatio', 'maintenanceMarginRatio', fallback.maintenanceEquityRatio, 0, 1, false);
  const commissionPerShare = readBoundedNumber(record, 'commissionPerShare', 'commPerShare', fallback.commissionPerShare, 0, Number.MAX_VALUE);
  const commissionRatePct = readBoundedNumber(record, 'commissionRatePct', 'commVolumePct', fallback.commissionRatePct, 0, 1);
  const commissionMin = readBoundedNumber(record, 'commissionMin', 'minCommOrder', fallback.commissionMin, 0, Number.MAX_VALUE);
  const stopOutValue = readNumber(record.stopOutRatio);
  const stopOutRatio = stopOutValue !== undefined && stopOutValue >= 0 && stopOutValue <= maintenanceEquityRatio
    ? stopOutValue : Math.min(fallback.stopOutRatio, maintenanceEquityRatio);

  return {
    broker, annualBorrowRate, dayCountBasis, rolloverHour, rolloverMinute, rolloverTimeZone,
    maintenanceEquityRatio, stopOutRatio, commissionMin, commissionPerShare, commissionRatePct
  };
}
