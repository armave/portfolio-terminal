export interface ExitComparisonPeriodInput {
  date: string;
  price: string;
}

interface ExitComparisonSavedRow {
  label: string;
  values: [string, string];
  kind?: 'section' | 'fee' | 'result' | 'risk' | 'balance';
  deltas?: [string | undefined, string | undefined];
}

export interface ExitComparisonSavedResult {
  savedAt: number;
  columns: [string, string];
  rows: ExitComparisonSavedRow[];
  note: string;
  summary: string;
}

export interface ExitComparisonPreferences {
  version: 1;
  ticker: string;
  periods: [ExitComparisonPeriodInput, ExitComparisonPeriodInput];
  lastResult: ExitComparisonSavedResult | null;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function getSafeStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function toLocalIsoDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

/** Display-only conversion: keep the real date offset in days; use 30-day month units for compact labels. */
export interface ExitDurationParts {
  months: number;
  days: number;
}

export function getExitDurationParts(totalDays: number): ExitDurationParts | null {
  if (!Number.isInteger(totalDays) || totalDays < 0) return null;
  return {
    months: Math.floor(totalDays / 30),
    days: totalDays % 30
  };
}

export function addCalendarDays(isoDate: string, days: number): string {
  if (!isValidIsoDate(isoDate) || !Number.isInteger(days)) return '';
  const [year, month, day] = isoDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0')
  ].join('-');
}

/** Returns a calendar-day offset, rejecting past dates and horizons beyond 10 years. */
export function getExitDayOffset(exitDate: string, today = toLocalIsoDate()): number | null {
  if (!isValidIsoDate(exitDate) || !isValidIsoDate(today)) return null;
  const [year, month, day] = exitDate.split('-').map(Number);
  const [todayYear, todayMonth, todayDay] = today.split('-').map(Number);
  const exitUtc = Date.UTC(year, month - 1, day);
  const todayUtc = Date.UTC(todayYear, todayMonth - 1, todayDay);
  const days = Math.round((exitUtc - todayUtc) / 86_400_000);
  return days >= 0 && days <= 3650 ? days : null;
}

function normalizePeriod(value: unknown): ExitComparisonPeriodInput | null {
  if (!value || typeof value !== 'object') return null;
  const period = value as Record<string, unknown>;
  if (typeof period.date !== 'string' || (period.date !== '' && !isValidIsoDate(period.date))) return null;
  if (typeof period.price !== 'string') return null;
  return { date: period.date, price: period.price.slice(0, 32) };
}

function normalizeSavedResult(value: unknown): ExitComparisonSavedResult | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as Record<string, unknown>;
  if (!Number.isFinite(Number(result.savedAt)) || !Array.isArray(result.columns) || result.columns.length !== 2 ||
    !Array.isArray(result.rows) || typeof result.note !== 'string' || typeof result.summary !== 'string') return null;

  const rows: ExitComparisonSavedRow[] = [];
  for (const candidate of result.rows.slice(0, 12)) {
    if (!candidate || typeof candidate !== 'object') return null;
    const row = candidate as Record<string, unknown>;
    if (typeof row.label !== 'string' || !Array.isArray(row.values) || row.values.length !== 2 ||
      !row.values.every((entry) => typeof entry === 'string')) return null;
    const kind = ['section', 'fee', 'result', 'risk', 'balance'].includes(String(row.kind))
      ? row.kind as ExitComparisonSavedRow['kind']
      : undefined;
    const deltas: [string | undefined, string | undefined] = [
      Array.isArray(row.deltas) && typeof row.deltas[0] === 'string' ? row.deltas[0] : undefined,
      Array.isArray(row.deltas) && typeof row.deltas[1] === 'string' ? row.deltas[1] : undefined
    ];
    rows.push({
      label: row.label.slice(0, 100),
      values: [row.values[0].slice(0, 100), row.values[1].slice(0, 100)],
      ...(kind ? { kind } : {}),
      ...(deltas.some(Boolean) ? { deltas } : {})
    });
  }

  return {
    savedAt: Number(result.savedAt),
    columns: [String(result.columns[0]).slice(0, 120), String(result.columns[1]).slice(0, 120)],
    rows,
    note: result.note.slice(0, 500),
    summary: result.summary.slice(0, 2000)
  };
}

export function loadExitComparisonPreferences(
  key: string,
  storage: StorageLike | null = getSafeStorage()
): ExitComparisonPreferences | null {
  if (!storage || !key) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.version !== 1 || typeof parsed.ticker !== 'string' || !/^[A-Z0-9.-]{1,16}$/i.test(parsed.ticker) ||
      !Array.isArray(parsed.periods) || parsed.periods.length !== 2) return null;
    const first = normalizePeriod(parsed.periods[0]);
    const second = normalizePeriod(parsed.periods[1]);
    if (!first || !second) return null;
    return {
      version: 1,
      ticker: parsed.ticker.toUpperCase(),
      periods: [first, second],
      lastResult: normalizeSavedResult(parsed.lastResult)
    };
  } catch {
    return null;
  }
}

export function saveExitComparisonPreferences(
  key: string,
  preferences: ExitComparisonPreferences,
  storage: StorageLike | null = getSafeStorage()
): boolean {
  if (!storage || !key || preferences.version !== 1) return false;
  try {
    storage.setItem(key, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}
