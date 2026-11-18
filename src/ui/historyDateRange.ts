export type HistoryDatePreset = 'all' | '7d' | '30d' | '90d' | 'month';

export interface HistoryDateRange {
  fromDate: string;
  toDate: string;
}

/** Format a native date-input value using the browser's local calendar date. */
export function formatLocalDateInputValue(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

/** Build inclusive, local-calendar date ranges for the guest History shortcuts. */
export function getHistoryDateRangeForPreset(
  preset: HistoryDatePreset,
  now: Date = new Date()
): HistoryDateRange {
  if (preset === 'all') return { fromDate: '', toDate: '' };

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(today);

  switch (preset) {
    case '7d':
      start.setDate(start.getDate() - 6);
      break;
    case '30d':
      start.setDate(start.getDate() - 29);
      break;
    case '90d':
      start.setDate(start.getDate() - 89);
      break;
    case 'month':
      start.setDate(1);
      break;
  }

  return {
    fromDate: formatLocalDateInputValue(start),
    toDate: formatLocalDateInputValue(today)
  };
}
