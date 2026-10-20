import { describe, expect, it } from 'vitest';
import {
  getNextTradingDay,
  getUsEquityProjectionDates,
  isStockHoliday,
  isTradingDay,
  isUsEquityTradingDay,
  getClosestTradingDay
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
      ['2026-10-09', 3, 'week-end']
    ]);
  });

  it('does not duplicate the entry date when it is today', () => {
    const projections = getUsEquityProjectionDates(localDate(2026, 10, 6), '2026-10-06');
    expect(projections[0]).toMatchObject({ daysFromToday: 0, kind: 'today' });
    expect(projections.filter(({ kind }) => kind === 'entry')).toHaveLength(0);
  });

  it('ignores invalid entry dates in projections', () => {
    const projections = getUsEquityProjectionDates(localDate(2026, 10, 6), 'invalid-date');
    expect(projections.some(p => p.kind === 'entry')).toBe(false);
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

  it('generates EOW row targeting Friday on Monday Oct 12 and steps weekly intervals directly from today', () => {
    const projections = getUsEquityProjectionDates(localDate(2026, 10, 12));
    expect(projections.map(({ date, daysFromToday, kind, label }) => [
      dateLabel(date),
      daysFromToday,
      kind,
      label
    ])).toEqual([
      ['2026-10-12', 0, 'today', 'Today'],
      ['2026-10-16', 4, 'week-end', '(EOW · +4d)'],
      ['2026-10-19', 7, 'weekly', '(+7d)'],
      ['2026-10-26', 14, 'weekly', '(+14d)'],
      ['2026-11-02', 21, 'weekly', '(+21d)'],
      ['2026-11-09', 28, 'weekly', '(+28d)'],
      ['2026-11-16', 35, 'weekly', '(+35d)'],
      ['2026-11-23', 42, 'weekly', '(+42d)']
    ]);
  });

  it('omits duplicate EOW row on Friday when today is already the last trading day of the week', () => {
    const projections = getUsEquityProjectionDates(localDate(2026, 10, 16));
    expect(projections.map(({ date, daysFromToday, kind, label }) => [
      dateLabel(date),
      daysFromToday,
      kind,
      label
    ])).toEqual([
      ['2026-10-16', 0, 'today', 'Today'],
      ['2026-10-23', 7, 'weekly', '(+7d)'],
      ['2026-10-30', 14, 'weekly', '(+14d)'],
      ['2026-11-06', 21, 'weekly', '(+21d)'],
      ['2026-11-13', 28, 'weekly', '(+28d)'],
      ['2026-11-20', 35, 'weekly', '(+35d)'],
      ['2026-11-27', 42, 'weekly', '(+42d)']
    ]);
    expect(projections.some(p => p.kind === 'week-end')).toBe(false);
    expect(projections.some(p => p.kind === 'next-trading-day')).toBe(false);
  });

  it('targets Thursday for EOW when Friday is Good Friday market holiday', () => {
    // 2026-04-03 is Good Friday
    const mondayBeforeEaster = localDate(2026, 3, 30);
    const projections = getUsEquityProjectionDates(mondayBeforeEaster);
    expect(projections[1]).toMatchObject({
      daysFromToday: 3,
      kind: 'week-end',
      label: '(EOW · +3d)'
    });
    expect(dateLabel(projections[1].date)).toBe('2026-04-02');
  });

  it('rolls weekly milestone forward when target date lands on Juneteenth holiday', () => {
    const projections = getUsEquityProjectionDates(localDate(2026, 6, 12));
    // 2026-06-12 is Friday. Week 1 lands on 2026-06-19 (Juneteenth), which rolls forward to Monday 2026-06-22 (+10d)
    expect(projections[1]).toMatchObject({
      daysFromToday: 10,
      kind: 'weekly',
      label: '(+10d)'
    });
    expect(dateLabel(projections[1].date)).toBe('2026-06-22');
  });

  it('finds the closest trading day correctly', () => {
    // 2026-10-10 is Saturday. Closest is Friday 10-09 (1 day diff) vs Monday 10-12 (2 days diff)
    const saturday = localDate(2026, 10, 10);
    expect(dateLabel(getClosestTradingDay(saturday))).toBe('2026-10-09');
    
    // 2026-10-11 is Sunday. Closest is Monday 10-12 (1 day diff) vs Friday 10-09 (2 days diff)
    const sunday = localDate(2026, 10, 11);
    expect(dateLabel(getClosestTradingDay(sunday))).toBe('2026-10-12');

    // 2026-10-12 is Monday (Trading Day). Should return itself.
    const monday = localDate(2026, 10, 12);
    expect(dateLabel(getClosestTradingDay(monday))).toBe('2026-10-12');
  });
});
