import { describe, expect, it } from 'vitest';
import {
  getNextTradingDay,
  getUsEquityProjectionDates,
  isStockHoliday,
  isTradingDay,
  isUsEquityTradingDay
} from './tradingCalendar';

function localDate(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day);
}

function dateLabel(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

describe('US equity trading calendar', () => {
  it('identifies stock holidays and excludes weekends and scheduled exchange holidays', () => {
    expect(isTradingDay(localDate(2026, 10, 10))).toBe(false);
    expect(isTradingDay(localDate(2026, 10, 12))).toBe(true);
    expect(isStockHoliday(localDate(2026, 6, 19))).toBe(true);
    expect(isTradingDay(localDate(2026, 6, 19))).toBe(false);
    expect(isStockHoliday(localDate(2026, 4, 3))).toBe(true);
    expect(isTradingDay(localDate(2026, 4, 3))).toBe(false);
    expect(isUsEquityTradingDay(localDate(2026, 10, 12))).toBe(true);
  });

  it('resolves NTD to Tuesday (+2d) when base date is Sunday before Labor Day', () => {
    const sundayBeforeLaborDay = localDate(2026, 9, 6);
    const ntd = getNextTradingDay(sundayBeforeLaborDay);
    expect(dateLabel(ntd)).toBe('2026-09-08');

    const projections = getUsEquityProjectionDates(sundayBeforeLaborDay);
    expect(projections[1]).toMatchObject({
      daysFromToday: 2,
      kind: 'next-trading-day',
      label: '(NTD · +2d)'
    });
    expect(dateLabel(projections[1].date)).toBe('2026-09-08');
  });

  it('generates projection rows anchored to NTD on Sunday Oct 11 with 7-day cadence and no EOW labels', () => {
    const projections = getUsEquityProjectionDates(localDate(2026, 10, 11));
    expect(projections.map(({ date, daysFromToday, label }) => [dateLabel(date), daysFromToday, label])).toEqual([
      ['2026-10-11', 0, 'Today'],
      ['2026-10-12', 1, '(NTD · +1d)'],
      ['2026-10-19', 8, '(+8d)'],
      ['2026-10-26', 15, '(+15d)'],
      ['2026-11-02', 22, '(+22d)'],
      ['2026-11-09', 29, '(+29d)'],
      ['2026-11-16', 36, '(+36d)'],
      ['2026-11-23', 43, '(+43d)']
    ]);

    projections.forEach(({ label }) => {
      expect(label).not.toContain('EOW');
    });
  });

  it('puts a historical entry date before today without treating it as a projection', () => {
    const projections = getUsEquityProjectionDates(localDate(2026, 10, 6), '2026-09-22');
    expect(projections.slice(0, 3).map(({ date, daysFromToday, kind }) => [
      dateLabel(date),
      daysFromToday,
      kind
    ])).toEqual([
      ['2026-09-22', -14, 'entry'],
      ['2026-10-06', 0, 'today'],
      ['2026-10-07', 1, 'next-trading-day']
    ]);
  });

  it('does not duplicate the entry date when it is today', () => {
    const projections = getUsEquityProjectionDates(localDate(2026, 10, 6), '2026-10-06');
    expect(projections[0]).toMatchObject({ daysFromToday: 0, kind: 'today' });
    expect(projections.filter(({ kind }) => kind === 'entry')).toHaveLength(0);
  });

  it('resolves NTD for Saturday Oct 10 to Monday (+2d)', () => {
    const projections = getUsEquityProjectionDates(localDate(2026, 10, 10));
    expect(projections[1]).toMatchObject({
      daysFromToday: 2,
      kind: 'next-trading-day',
      label: '(NTD · +2d)'
    });
    expect(dateLabel(projections[1].date)).toBe('2026-10-12');
  });

  it('rolls weekly milestone forward when target date lands on Juneteenth holiday', () => {
    const projections = getUsEquityProjectionDates(localDate(2026, 6, 11));
    expect(projections[1]).toMatchObject({
      daysFromToday: 1,
      kind: 'next-trading-day',
      label: '(NTD · +1d)'
    });
    expect(dateLabel(projections[1].date)).toBe('2026-06-12');

    expect(projections[2]).toMatchObject({
      daysFromToday: 11,
      kind: 'weekly',
      label: '(+11d)'
    });
    expect(dateLabel(projections[2].date)).toBe('2026-06-22');
  });
});
