export interface NormalizedFreedomCashflow {
  id: string;
  date: string;
  type: string;
  amount: number;
  currency?: string;
  description?: string;
  raw: Record<string, string>;
}

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

function isUsableDate(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  const serial = Number(text);
  if (/^\d{4,6}(?:\.\d+)?$/.test(text) && serial > 20000 && serial < 100000) return true;
  const dmy = text.match(/^(\d{1,2})[.-](\d{1,2})[.-](\d{4})$/);
  if (dmy) {
    const date = new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])));
    return date.getUTCFullYear() === Number(dmy[3]) &&
      date.getUTCMonth() === Number(dmy[2]) - 1 &&
      date.getUTCDate() === Number(dmy[1]);
  }
  return Number.isFinite(Date.parse(text));
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
    normalized.push({
      id: brokerId ? `freedom-${brokerId}` : `freedom-${fallbackId}`,
      date,
      type,
      amount,
      currency: currency || undefined,
      description: description || undefined,
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
export function isFreedomCashflowRow(row: Pick<NormalizedFreedomCashflow, "id">): boolean {
  return row.id.startsWith("freedom-");
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
  const merged: NormalizedFreedomCashflow[] = existing.map(row => ({
    ...row,
    raw: { ...(row.raw || {}) }
  }));
  const byId = new Map<string, number>();
  merged.forEach((row, index) => {
    if (!byId.has(row.id)) byId.set(row.id, index);
  });

  for (const row of incoming) {
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
    } else {
      const index = merged.length;
      merged.push({ ...row, raw: { ...(row.raw || {}) } });
      byId.set(row.id, index);
    }
  }
  return merged;
}
