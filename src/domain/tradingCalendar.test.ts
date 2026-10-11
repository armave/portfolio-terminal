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

  it('resolves EOW to Thursday (+0d) when base date is Thursday before Good Friday', () => {
    const thursdayBeforeGoodFriday = localDate(2026, 4, 2);
    const projections = getUsEquityProjectionDates(thursdayBeforeGoodFriday);
    expect(projections[1]).toMatchObject({
      daysFromToday: 0,
      kind: 'week-end'
    });
    expect(dateLabel(projections[1].date)).toBe('2026-04-02');
  });

  it('starts the schedule at Friday when Friday is a trading day', () => {
    const projections = getUsEquityProjectionDates(localDate(2026, 10, 6));
    expect(projections.map(({ date, daysFromToday }) => [dateLabel(date), daysFromToday])).toEqual([
      ['2026-10-06', 0],
      ['2026-10-09', 3],
      ['2026-10-13', 7],
      ['2026-10-20', 14],
      ['2026-10-27', 21],
      ['2026-11-03', 28],
      ['2026-11-10', 35]
    ]);
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

  it('uses the following Monday when today is Friday with next trading day label', () => {
    const projections = getUsEquityProjectionDates(localDate(2026, 10, 9));
    expect(projections[1]).toMatchObject({
      daysFromToday: 3,
      kind: 'week-end',
      label: '(NTD · +3d)'
    });
    expect(dateLabel(projections[1].date)).toBe('2026-10-12');
  });

  it('resolves the first milestone to Monday (NTD) and next to Friday (EOW) when today is Saturday', () => {
    const projections = getUsEquityProjectionDates(localDate(2026, 10, 10));
    expect(projections[1]).toMatchObject({
      daysFromToday: 2,
      kind: 'next-trading-day',
      label: '(NTD · +2d)'
    });
    expect(dateLabel(projections[1].date)).toBe('2026-10-12');
    expect(projections[1].label).toContain('NTD');

    expect(projections[2]).toMatchObject({
      daysFromToday: 6,
      kind: 'week-end',
      label: '(EOW · +6d)'
    });
    expect(dateLabel(projections[2].date)).toBe('2026-10-16');
    expect(projections[2].label).toContain('EOW');
  });

  it('resolves the first milestone to Monday (NTD) and next to Friday (EOW) when today is Sunday', () => {
    const projections = getUsEquityProjectionDates(localDate(2026, 10, 11));
    expect(projections[1]).toMatchObject({
      daysFromToday: 1,
      kind: 'next-trading-day',
      label: '(NTD · +1d)'
    });
    expect(dateLabel(projections[1].date)).toBe('2026-10-12');
    expect(projections[1].label).toContain('NTD');

    expect(projections[2]).toMatchObject({
      daysFromToday: 5,
      kind: 'week-end',
      label: '(EOW · +5d)'
    });
    expect(dateLabel(projections[2].date)).toBe('2026-10-16');
    expect(projections[2].label).toContain('EOW');
  });

  it('projects multi-week intervals to subsequent Fridays when today is a weekend', () => {
    const projections = getUsEquityProjectionDates(localDate(2026, 10, 11));
    expect(projections.slice(1).map(({ date, daysFromToday }) => [dateLabel(date), daysFromToday])).toEqual([
      ['2026-10-12', 1],
      ['2026-10-16', 5],
      ['2026-10-23', 12],
      ['2026-10-30', 19],
      ['2026-11-06', 26],
      ['2026-11-13', 33],
      ['2026-11-20', 40]
    ]);
  });

  it('rolls the +7-day checkpoint forward when it lands on Juneteenth', () => {
    const projections = getUsEquityProjectionDates(localDate(2026, 6, 12));
    expect(projections[2]).toMatchObject({ daysFromToday: 10, kind: 'weekly' });
    expect(dateLabel(projections[2].date)).toBe('2026-06-22');
  });
});
