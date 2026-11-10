interface BuyMoreSavedRow {
  label: string;
  values: string[];
  kind?: 'section' | 'fee' | 'result' | 'risk' | 'balance';
}
export interface BuyMoreSavedResult {
  savedAt: number;
  columns: string[];
  rows: BuyMoreSavedRow[];
  note: string;
  summary: string;
}
export interface BuyMorePreferences {
  version: 1;
  ticker: string;
  shares: string;
  price: string;
  lastResult: BuyMoreSavedResult | null;
}
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
function getSafeStorage(): StorageLike | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; }
  catch { return null; }
}
function validTicker(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z0-9.-]{1,16}$/i.test(value);
}
function normalizeSavedResult(value: unknown): BuyMoreSavedResult | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as Record<string, unknown>;
  if (!Number.isFinite(Number(result.savedAt)) ||
    !Array.isArray(result.columns) || result.columns.length !== 8 ||
    !result.columns.every((entry) => typeof entry === 'string') ||
    !Array.isArray(result.rows) || result.rows.length > 3000 ||
    typeof result.note !== 'string' || typeof result.summary !== 'string') return null;
  const rows: BuyMoreSavedRow[] = [];
  for (const candidate of result.rows) {
    if (!candidate || typeof candidate !== 'object') return null;
    const row = candidate as Record<string, unknown>;
    if (typeof row.label !== 'string' || !Array.isArray(row.values) || row.values.length !== 8 ||
      !row.values.every((entry) => typeof entry === 'string')) return null;
    const kind = ['section', 'fee', 'result', 'risk', 'balance'].includes(String(row.kind))
      ? row.kind as BuyMoreSavedRow['kind'] : undefined;
    rows.push({
      label: row.label.slice(0, 120),
      values: row.values.map((entry) => (entry as string).slice(0, 100)),
      ...(kind ? { kind } : {})
    });
  }
  return {
    savedAt: Number(result.savedAt),
    columns: result.columns.map((entry) => (entry as string).slice(0, 120)),
    rows,
    note: result.note.slice(0, 1200),
    summary: result.summary.slice(0, 4000)
  };
}
export function loadBuyMorePreferences(
  key: string, storage: StorageLike | null = getSafeStorage()
): BuyMorePreferences | null {
  if (!storage || !key) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.version !== 1 || !validTicker(parsed.ticker) ||
      typeof parsed.shares !== 'string' || typeof parsed.price !== 'string') return null;
    return {
      version: 1, ticker: parsed.ticker.toUpperCase(),
      shares: parsed.shares.slice(0, 32), price: parsed.price.slice(0, 32),
      lastResult: normalizeSavedResult(parsed.lastResult)
    };
  } catch { return null; }
}
export function saveBuyMorePreferences(
  key: string, preferences: BuyMorePreferences, storage: StorageLike | null = getSafeStorage()
): boolean {
  if (!storage || !key || preferences.version !== 1 || !validTicker(preferences.ticker) ||
    typeof preferences.shares !== 'string' || typeof preferences.price !== 'string') return false;
  try {
    const normalized = normalizeSavedResult(preferences.lastResult);
    if (preferences.lastResult !== null && !normalized) return false;
    storage.setItem(key, JSON.stringify({
      version: 1, ticker: preferences.ticker.toUpperCase(),
      shares: preferences.shares.slice(0, 32), price: preferences.price.slice(0, 32),
      lastResult: normalized
    }));
    return true;
  } catch { return false; }
}
