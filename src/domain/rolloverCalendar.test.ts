import { describe, expect, it } from 'vitest';
import {
  getLatestRolloverTimestamp,
  getRolloverTimestampForLocalDate,
  getZonedDateParts,
  shiftCalendarDate,
  zonedLocalTimeToTimestamp
} from './rolloverCalendar';

const YEREVAN = 'Asia/Yerevan';
const timestamp = (iso: string) => new Date(iso).getTime();

describe('rollover calendar', () => {
  it('converts 04:00 Asia/Yerevan to the expected instant', () => {
    const rollover = getRolloverTimestampForLocalDate(2026, 10, 20);
    expect(new Date(rollover).toISOString()).toBe('2026-10-20T00:00:00.000Z');
    expect(getZonedDateParts(new Date(rollover), YEREVAN)).toMatchObject({
      year: 2026, month: 10, day: 20, hour: 4, minute: 0
    });
  });

  it('returns the current day rollover at and after the cutoff', () => {
    const atCutoff = timestamp('2026-10-20T00:00:00.000Z');
    expect(getLatestRolloverTimestamp(new Date(atCutoff))).toBe(atCutoff);
    expect(getLatestRolloverTimestamp(new Date(atCutoff + 60_000))).toBe(atCutoff);
  });

  it('returns the previous local day rollover just before the cutoff', () => {
    const beforeCutoff = timestamp('2026-10-19T23:59:59.000Z');
    expect(getLatestRolloverTimestamp(new Date(beforeCutoff))).toBe(timestamp('2026-10-19T00:00:00.000Z'));
  });

  it('shifts across month, year, and leap-day boundaries using calendar days', () => {
    expect(shiftCalendarDate(2026, 1, 1, -1)).toEqual({ year: 2025, month: 12, day: 31 });
    expect(shiftCalendarDate(2024, 2, 28, 1)).toEqual({ year: 2024, month: 2, day: 29 });
    expect(shiftCalendarDate(2024, 12, 31, 1)).toEqual({ year: 2025, month: 1, day: 1 });
  });

  it('supports an explicit timezone and configured cutoff', () => {
    const timestamp = zonedLocalTimeToTimestamp(2026, 1, 15, 9, 30, 'America/New_York');
    expect(getZonedDateParts(new Date(timestamp), 'America/New_York')).toMatchObject({
      year: 2026, month: 1, day: 15, hour: 9, minute: 30
    });
    const configured = getLatestRolloverTimestamp(
      new Date('2026-10-20T01:00:00.000Z'), 6, 30, YEREVAN
    );
    expect(new Date(configured).toISOString()).toBe('2026-10-20T02:30:00.000Z');
  });
});
