export type ProjectedCashDebtStatus = 'debt' | 'cash' | 'settled' | 'unavailable';

/** Parse signed currency values without losing a Unicode minus or treating placeholders as zero. */
export function parseScenarioSignedMoney(value?: string | null): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const normalized = value.trim()
    .replace(/,/g, '')
    .replace(/\\$/g, '')
    .replace(/−/g, '-')
    .replace(/\\s+/g, '');
  if (!/^[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getProjectedCashDebtStatus(value: string): ProjectedCashDebtStatus {
  const amount = parseScenarioSignedMoney(value);
  if (amount === null) return 'unavailable';
  if (amount < 0) return 'debt';
  if (amount > 0) return 'cash';
  return 'settled';
}

/** Format an ISO calendar date as a locale-aware date without UTC day shifting. */
export function formatExitComparisonDate(dateValue: string, language: 'en' | 'ru'): string {
  const match = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(dateValue);
  if (!match) return dateValue;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return dateValue;
  return new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', { dateStyle: 'medium' }).format(date);
}
