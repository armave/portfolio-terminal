export type ProjectionKind = 'entry' | 'today' | 'next-trading-day' | 'week-end' | 'weekly';

export interface ProjectionDate {
  date: Date;
  daysFromToday: number;
  kind: ProjectionKind;
  label?: string;
}

export function getProjectionMilestoneLabel(
  daysFromToday: number,
  kind: ProjectionKind
): string {
  if (kind === 'entry') return 'Entry';
  if (kind === 'today') return 'Today';
  if (kind === 'next-trading-day') {
    return `(NTD · +${daysFromToday}d)`;
  }
  if (kind === 'week-end') {
    return `(EOW · +${daysFromToday}d)`;
  }
  return `(+${daysFromToday}d)`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + days);
  return result;
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, occurrence: number): Date {
  const first = new Date(year, month, 1);
  const day = 1 + (weekday - first.getDay() + 7) % 7 + (occurrence - 1) * 7;
  return new Date(year, month, day);
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const last = new Date(year, month + 1, 0);
  const day = last.getDate() - (last.getDay() - weekday + 7) % 7;
  return new Date(year, month, day);
}

function observedFixedHoliday(year: number, month: number, day: number): Date {
  const holiday = new Date(year, month, day);
  if (holiday.getDay() === 6) return addDays(holiday, -1);
  if (holiday.getDay() === 0) return addDays(holiday, 1);
  return holiday;
}

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function usEquityMarketHolidays(year: number): Set<string> {
  const holidays = new Set<string>();
  const add = (date: Date) => holidays.add(dateKey(date));
  add(observedFixedHoliday(year, 0, 1));
  add(nthWeekdayOfMonth(year, 0, 1, 3));
  add(nthWeekdayOfMonth(year, 1, 1, 3));
  add(addDays(easterSunday(year), -2));
  add(lastWeekdayOfMonth(year, 4, 1));
  add(observedFixedHoliday(year, 5, 19));
  add(observedFixedHoliday(year, 6, 4));
  add(nthWeekdayOfMonth(year, 8, 1, 1));
  add(nthWeekdayOfMonth(year, 10, 4, 4));
  add(observedFixedHoliday(year, 11, 25));

  const nextNewYear = observedFixedHoliday(year + 1, 0, 1);
  if (nextNewYear.getFullYear() === year) add(nextNewYear);
  return holidays;
}

export function isStockHoliday(date: Date): boolean {
  return usEquityMarketHolidays(date.getFullYear()).has(dateKey(date));
}

export function isTradingDay(date: Date): boolean {
  const weekday = date.getDay();
  if (weekday === 0 || weekday === 6) return false;
  return !isStockHoliday(date);
}

export const isUsEquityTradingDay = isTradingDay;

export function getNextTradingDay(fromDate: Date): Date {
  let candidate = addDays(fromDate, 1);
  while (!isTradingDay(candidate)) {
    candidate = addDays(candidate, 1);
  }
  return candidate;
}

function rollForwardToTradingDay(date: Date): Date {
  let result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  while (!isTradingDay(result)) result = addDays(result, 1);
  return result;
}

function rollBackwardToTradingDay(date: Date): Date {
  let result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  while (!isTradingDay(result)) result = addDays(result, -1);
  return result;
}

export function getClosestTradingDay(date: Date): Date {
  if (isTradingDay(date)) return date;
  const forward = rollForwardToTradingDay(date);
  const backward = rollBackwardToTradingDay(date);
  const diffForward = Math.abs(calendarDayDifference(date, forward));
  const diffBackward = Math.abs(calendarDayDifference(date, backward));
  return diffForward <= diffBackward ? forward : backward;
}

function getLastTradingDayOfWeek(date: Date): Date {
  const weekday = date.getDay();
  const friday = addDays(date, 5 - weekday);
  return rollBackwardToTradingDay(friday);
}

function calendarDayDifference(from: Date, to: Date): number {
  const fromUtc = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const toUtc = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((toUtc - fromUtc) / DAY_MS);
}

export function getUsEquityProjectionDates(today = new Date(), entryDate?: string): ProjectionDate[] {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const projections: ProjectionDate[] = [];
  if (entryDate && /^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
    const [year, month, day] = entryDate.split('-').map(Number);
    const entry = new Date(year, month - 1, day);
    const isValidEntry = entry.getFullYear() === year &&
      entry.getMonth() === month - 1 &&
      entry.getDate() === day;
    if (isValidEntry && calendarDayDifference(entry, start) > 0) {
      const daysFromToday = calendarDayDifference(start, entry);
      projections.push({
        date: entry,
        daysFromToday,
        kind: 'entry',
        label: getProjectionMilestoneLabel(daysFromToday, 'entry')
      });
    }
  }

  projections.push({
    date: start,
    daysFromToday: 0,
    kind: 'today',
    label: getProjectionMilestoneLabel(0, 'today')
  });

  const isWorkingDay = isTradingDay(start);

  if (isWorkingDay) {
    const eowDate = getLastTradingDayOfWeek(start);
    const eowDays = calendarDayDifference(start, eowDate);
    if (eowDays > 0) {
      projections.push({
        date: eowDate,
        daysFromToday: eowDays,
        kind: 'week-end',
        label: getProjectionMilestoneLabel(eowDays, 'week-end')
      });
    }
  } else {
    const nextTradingDay = getNextTradingDay(start);
    const nextTradingDays = calendarDayDifference(start, nextTradingDay);
    projections.push({
      date: nextTradingDay,
      daysFromToday: nextTradingDays,
      kind: 'next-trading-day',
      label: getProjectionMilestoneLabel(nextTradingDays, 'next-trading-day')
    });
  }

  const referenceDate = getClosestTradingDay(start);
  const seenKeys = new Set<string>(projections.map((p) => dateKey(p.date)));

  for (const week of [1, 2, 3, 4, 5, 6]) {
    const targetDate = addDays(referenceDate, week * 7);
    const projectedDate = rollForwardToTradingDay(targetDate);
    const key = dateKey(projectedDate);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const daysFromToday = calendarDayDifference(start, projectedDate);
    projections.push({
      date: projectedDate,
      daysFromToday,
      kind: 'weekly',
      label: `(+${daysFromToday}d)`
    });
  }
  return projections;
}
