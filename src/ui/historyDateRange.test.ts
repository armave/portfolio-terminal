import { describe, expect, it } from 'vitest';
import { formatLocalDateInputValue, getHistoryDateRangeForPreset } from './historyDateRange';

describe('History date range presets', () => {
  const now = new Date(2026, 10, 18, 16, 45, 30);

  it('includes today in rolling 7, 30 and 90 day ranges', () => {
    expect(getHistoryDateRangeForPreset('7d', now))
      .toEqual({ fromDate: '2026-11-12', toDate: '2026-11-18' });
    expect(getHistoryDateRangeForPreset('30d', now))
      .toEqual({ fromDate: '2026-10-20', toDate: '2026-11-18' });
    expect(getHistoryDateRangeForPreset('90d', now))
      .toEqual({ fromDate: '2026-08-21', toDate: '2026-11-18' });
  });

  it('starts the month shortcut on the first day of the current local month', () => {
    expect(getHistoryDateRangeForPreset('month', now))
      .toEqual({ fromDate: '2026-11-01', toDate: '2026-11-18' });
  });

  it('clears both boundaries for the all-time shortcut', () => {
    expect(getHistoryDateRangeForPreset('all', now))
      .toEqual({ fromDate: '', toDate: '' });
  });

  it('formats dates from local calendar fields rather than UTC serialization', () => {
    expect(formatLocalDateInputValue(new Date(2026, 10, 18, 23, 59, 59)))
      .toBe('2026-11-18');
  });
});
