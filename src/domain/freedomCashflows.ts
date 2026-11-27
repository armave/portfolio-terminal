import type { BrokerCashflow } from '../types/broker';

export type NormalizedFreedomCashflow = BrokerCashflow;

const ROW_COLLECTION_KEYS = [
  "cashflows", "cashflow", "cash_flows", "cashFlows", "cash_flow",
  "flows", "transactions", "items", "rows", "operations", "row"
];
const RESPONSE_CONTAINER_KEYS = ["data", "result", "payload", "response", "report"];

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findCashflowRows(value: unknown, depth = 0): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object" || depth > 8) return null;

  const entries = Object.entries(value as Record<string, unknown>);
  for (const key of ROW_COLLECTION_KEYS) {
    const entry = entries.find(([name]) => normalizeKey(name) === normalizeKey(key));
    if (!entry) continue;
    const nested = findCashflowRows(entry[1], depth + 1);
    if (nested !== null) return nested;
  }
  for (const key of RESPONSE_CONTAINER_KEYS) {
    const entry = entries.find(([name]) => normalizeKey(name) === normalizeKey(key));
    if (!entry) continue;
    const nested = findCashflowRows(entry[1], depth + 1);
    if (nested !== null) return nested;
  }
  return null;
}

function pickValue(record: Record<string, unknown>, aliases: string[]): unknown {
  const entries = Object.entries(record);
  for (const alias of aliases) {
    const entry = entries.find(([key]) => normalizeKey(key) === normalizeKey(alias));
    if (entry && entry[1] !== null && entry[1] !== undefined && entry[1] !== "") return entry[1];
  }
  return undefined;
}

function stringifyRawValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeDate(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "number" || (typeof value === "string" && /^\d{10}(?:\d{3})?$/.test(value.trim()))) {
    const numeric = Number(value);
    const timestamp = numeric > 1e12 ? numeric : numeric > 1e9 ? numeric * 1000 : NaN;
    if (Number.isFinite(timestamp)) {
      const date = new Date(timestamp);
      if (Number.isFinite(date.getTime())) return date.toISOString();
    }
  }
  return stringifyRawValue(value).trim();
}

const EXCEL_DATE_EPOCH_MS = Date.UTC(1899, 11, 30);
const EXCEL_DAY_MS = 86_400_000;

export interface ParsedFreedomCashflowDate {
  timestamp: number;
  dateOnly: boolean;
}

function makeParsedDate(timestamp: number, dateOnly: boolean): ParsedFreedomCashflowDate | null {
  const rounded = Math.round(timestamp);
  if (!Number.isSafeInteger(rounded) || rounded <= 0 || !Number.isFinite(new Date(rounded).getTime())) return null;
  return { timestamp: rounded, dateOnly };
}

function parseUtcCalendarDate(year: number, month: number, day: number): number | null {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.getTime()
    : null;
}

/** Parse broker cashflow dates while distinguishing Excel serials from calendar-year strings. */
export function parseFreedomCashflowDate(value: unknown): ParsedFreedomCashflowDate | null {
  if (value instanceof Date) return makeParsedDate(value.getTime(), false);
  if (typeof value === "number") {
    if (value > 20_000 && value < 100_000) return makeParsedDate(EXCEL_DATE_EPOCH_MS + value * EXCEL_DAY_MS, Number.isInteger(value));
    if (value > 1_000_000_000_000) return makeParsedDate(value, false);
    if (value > 1_000_000_000) return makeParsedDate(value * 1000, false);
    return null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  if (/^\d{4,6}(?:\.\d+)?$/.test(text)) {
    const serial = Number(text);
    return serial > 20_000 && serial < 100_000
      ? makeParsedDate(EXCEL_DATE_EPOCH_MS + serial * EXCEL_DAY_MS, Number.isInteger(serial))
      : null;
  }
  if (/^\d{10}$/.test(text)) {
    const seconds = Number(text);
    return seconds > 1_000_000_000 ? makeParsedDate(seconds * 1000, false) : null;
  }
  if (/^\d{13}$/.test(text)) {
    const milliseconds = Number(text);
    return milliseconds > 1_000_000_000_000 ? makeParsedDate(milliseconds, false) : null;
  }
  if (/^\d+(?:\.\d+)?$/.test(text)) return null;
  const dmy = text.match(/^(\d{1,2})[.-](\d{1,2})[.-](\d{4})$/);
  if (dmy) {
    const timestamp = parseUtcCalendarDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
    return timestamp === null ? null : makeParsedDate(timestamp, true);
  }
  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) {
    const timestamp = parseUtcCalendarDate(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]));
    return timestamp === null ? null : makeParsedDate(timestamp, true);
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? makeParsedDate(parsed, false) : null;
}

function isUsableDate(value: string): boolean {
  return parseFreedomCashflowDate(value) !== null;
}

function parseAmount(value: unknown): number | null {
  if (value && typeof value === "object") {
    const nested = value as Record<string, unknown>;
    value = nested.amount ?? nested.value ?? nested.sum;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const original = value.trim();
  if (!original) return null;
  const parenthesizedNegative = /^\(.*\)$/.test(original);
  let numeric = original
    .replace(/[\s\u00a0]/g, "")
    .replace(/[−–]/g, "-")
    .replace(/[^0-9,.+\-]/g, "");
  if (!/[0-9]/.test(numeric)) return null;

  const lastComma = numeric.lastIndexOf(",");
  const lastDot = numeric.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const groupingSeparator = decimalSeparator === "," ? "." : ",";
    numeric = numeric.split(groupingSeparator).join("");
    if (decimalSeparator === ",") numeric = numeric.replace(",", ".");
    else numeric = numeric.replace(/,(?=.*\.)/g, "");
  } else if (lastComma >= 0) {
    const decimals = numeric.length - lastComma - 1;
    numeric = decimals > 0 && decimals <= 2
      ? numeric.replace(",", ".")
      : numeric.replace(/,/g, "");
  }

  const parsed = Number(numeric);
  if (!Number.isFinite(parsed)) return null;
  return parenthesizedNegative ? -Math.abs(parsed) : parsed;
}

/**
 * Normalize broker cashflows into the row shape already consumed by Closed
 * History. Unknown response shapes and malformed non-empty payloads fail closed.
 */
export function normalizeFreedomCashflowRows(response: unknown): NormalizedFreedomCashflow[] {
  const rows = findCashflowRows(response);
  if (rows === null) {
    throw new Error("Freedom returned an unrecognized cashflow response. Existing cashflow history was left unchanged.");
  }
  if (rows.length === 0) return [];

  const normalized: NormalizedFreedomCashflow[] = [];
  const fallbackOccurrences = new Map<string, number>();
  for (const candidate of rows) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const row = candidate as Record<string, unknown>;
    const date = normalizeDate(pickValue(row, [
      "date", "datetime", "operation_date", "operation_datetime", "transaction_date",
      "cashflow_date", "created_at", "time", "dt", "timestamp", "booking_date", "value_date"
    ]));
    let amount = parseAmount(pickValue(row, [
      "amount", "sum", "value", "cashflow", "cashflow_amount", "operation_amount",
      "transaction_amount", "net_amount", "amt", "total"
    ]));
    if (amount === null) {
      const debit = parseAmount(pickValue(row, ["debit", "withdrawal", "expense", "outflow"]));
      const credit = parseAmount(pickValue(row, ["credit", "deposit", "income", "inflow"]));
      if (debit !== null && debit !== 0) amount = -Math.abs(debit);
      else if (credit !== null) amount = Math.abs(credit);
    }
    if (!isUsableDate(date) || amount === null) continue;

    const idValue = pickValue(row, [
      "id", "cashflow_id", "operation_id", "transaction_id", "reference",
      "external_id", "document_id", "doc_id", "op_id", "operation_no", "operation_number"
    ]);
    const typeValue = pickValue(row, [
      "type", "kind", "operation_type", "transaction_type", "cashflow_type",
      "category", "direction", "operation", "name"
    ]);
    const descriptionValue = pickValue(row, [
      "description", "comment", "details", "purpose", "remark", "note",
      "info", "operation_description", "transaction_description"
    ]);
    const currencyValue = pickValue(row, ["currency", "curr", "currency_code", "ccy"]);
    const type = stringifyRawValue(typeValue).trim() || "Cashflow";
    const description = stringifyRawValue(descriptionValue).trim();
    const currency = stringifyRawValue(currencyValue).trim();
    const raw: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) raw[key] = stringifyRawValue(value);

    const fallbackId = [date, type, amount.toFixed(8), currency, description].join("|").toLowerCase();
    const brokerId = stringifyRawValue(idValue).trim();
    const occurrence = fallbackOccurrences.get(fallbackId) || 0;
    fallbackOccurrences.set(fallbackId, occurrence + 1);
    normalized.push({
      id: brokerId ? `freedom-${brokerId}` : `freedom-${fallbackId}${occurrence ? `#duplicate-${occurrence + 1}` : ''}`,
      date,
      type,
      amount,
      currency: currency || undefined,
      description: description || undefined,
      identityQuality: brokerId ? 'provider' : 'fallback',
      raw
    });
  }

  if (normalized.length === 0) {
    throw new Error("Freedom returned cashflow rows without usable dates and amounts. Existing cashflow history was left unchanged.");
  }
  return mergeFreedomCashflowRows([], normalized);
}

/**
 * True only for cashflow rows received from the Freedom API. Older locally
 * saved file-import rows are retained for history but are not fee inputs.
 */
export function isFreedomCashflowRow(row: Pick<NormalizedFreedomCashflow, "id"> & { identityQuality?: 'provider' | 'fallback' }): boolean {
  return row.id.startsWith("freedom-") && row.identityQuality !== 'fallback' &&
    !/^freedom-\d{4}-\d{2}-\d{2}\|/i.test(row.id);
}

/**
 * Validate rows loaded from local/cloud history without changing their stable
 * IDs. Invalid legacy objects remain in persistence; only usable rows enter
 * typed calculations.
 */
export function normalizeSavedFreedomCashflows(values: readonly unknown[]): NormalizedFreedomCashflow[] {
  const normalized: NormalizedFreedomCashflow[] = [];
  for (const candidate of values) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const row = candidate as Record<string, unknown>;
    const id = stringifyRawValue(row.id).trim();
    const date = stringifyRawValue(row.date).trim();
    const amount = parseAmount(row.amount);
    if (!id || !isUsableDate(date) || amount === null) continue;
    const type = stringifyRawValue(row.type).trim() || "Cashflow";
    const currency = stringifyRawValue(row.currency).trim();
    const description = stringifyRawValue(row.description).trim();
    const rawSource = row.raw && typeof row.raw === "object" && !Array.isArray(row.raw)
      ? row.raw as Record<string, unknown>
      : {};
    const raw: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawSource)) raw[key] = stringifyRawValue(value);
    normalized.push({
      id,
      date,
      type,
      amount,
      ...(currency ? { currency } : {}),
      ...(description ? { description } : {}),
      ...(row.identityQuality === 'provider' || row.identityQuality === 'fallback'
        ? { identityQuality: row.identityQuality }
        : /^freedom-\d{4}-\d{2}-\d{2}\|/i.test(id) ? { identityQuality: 'fallback' as const } : {}),
      raw
    });
  }
  return normalized;
}

/**
 * Return an overlapping incremental cursor for the latest persisted broker
 * cashflow. Keeping the previous calendar day in the query captures late
 * corrections without re-downloading the complete account history every minute.
 */
export function getFreedomCashflowRefreshStartDate(
  values: readonly unknown[],
  overlapDays = 1
): string | undefined {
  const rows = normalizeSavedFreedomCashflows(values);
  let latestDay = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const parsedDate = parseFreedomCashflowDate(row.date);
    if (!parsedDate) continue;
    const date = new Date(parsedDate.timestamp);
    const utcDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    if (utcDay > latestDay) latestDay = utcDay;
  }
  if (!Number.isFinite(latestDay)) return undefined;
  const days = Number.isFinite(overlapDays) ? Math.max(0, Math.floor(overlapDays)) : 1;
  return new Date(latestDay - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Older saved rows may predate raw-field persistence. Normalize those at the
 * merge boundary while keeping broker rows fully typed.
 */
type CashflowMergeInput = Omit<NormalizedFreedomCashflow, "raw"> & {
  raw?: Record<string, string>;
};

/**
 * Incrementally merge broker rows by stable ID only. Existing saved history
 * is retained, and distinct broker operations are never collapsed simply
 * because their visible fields happen to match.
 */
export function mergeFreedomCashflowRows(
  existing: CashflowMergeInput[],
  incoming: CashflowMergeInput[]
): NormalizedFreedomCashflow[] {
  const merged: NormalizedFreedomCashflow[] = [];
  const byId = new Map<string, number>();

  // Normalize every source through the same ID-indexed path. Cloud history,
  // the local sidecar and the portfolio snapshot can contain overlapping
  // copies, and duplicate IDs already present in one source must not be counted
  // twice by the financing allocator.
  const mergeRow = (row: CashflowMergeInput) => {
    const matchedIndex = byId.get(row.id);
    if (matchedIndex !== undefined) {
      const previous = merged[matchedIndex];
      merged[matchedIndex] = {
        ...previous,
        ...row,
        id: previous.id,
        currency: row.currency || previous.currency,
        description: row.description || previous.description,
        raw: { ...(previous.raw || {}), ...(row.raw || {}) }
      };
      return;
    }

    const index = merged.length;
    merged.push({ ...row, raw: { ...(row.raw || {}) } });
    byId.set(row.id, index);
  };

  // Later copies within a source and later sources take precedence. Incoming
  // broker rows are processed last, so a same-ID broker correction replaces
  // the persisted amount/date/facts instead of being added to the old row.
  existing.forEach(mergeRow);
  incoming.forEach(mergeRow);
  return merged;
}
