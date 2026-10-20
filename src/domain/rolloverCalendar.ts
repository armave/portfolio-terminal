export interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Extract calendar/time parts in the supplied IANA timezone. */
export function getZonedDateParts(date: Date, timeZone = 'Asia/Yerevan'): ZonedDateParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(
    parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)])
  ) as unknown as ZonedDateParts;
}

/** Convert a local wall-clock time in an IANA timezone to its UTC timestamp. */
export function zonedLocalTimeToTimestamp(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone = 'Asia/Yerevan'
): number {
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute);
  let timestamp = targetUtc;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = getZonedDateParts(new Date(timestamp), timeZone);
    const representedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const adjustment = targetUtc - representedUtc;
    if (adjustment === 0) return timestamp;
    timestamp += adjustment;
  }
  return timestamp;
}

/** Shift a calendar date by whole days without local DST affecting the result. */
export function shiftCalendarDate(year: number, month: number, day: number, offset: number): {
  year: number;
  month: number;
  day: number;
} {
  const shifted = new Date(Date.UTC(year, month - 1, day + offset));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

export function getRolloverTimestampForLocalDate(
  year: number,
  month: number,
  day: number,
  rolloverHour = 4,
  rolloverMinute = 0,
  timeZone = 'Asia/Yerevan'
): number {
  return zonedLocalTimeToTimestamp(year, month, day, rolloverHour, rolloverMinute, timeZone);
}

/** Return the most recent configured rollover instant at or before now. */
export function getLatestRolloverTimestamp(
  now = new Date(),
  rolloverHour = 4,
  rolloverMinute = 0,
  timeZone = 'Asia/Yerevan'
): number {
  const local = getZonedDateParts(now, timeZone);
  let rollover = getRolloverTimestampForLocalDate(
    local.year, local.month, local.day, rolloverHour, rolloverMinute, timeZone
  );
  if (rollover > now.getTime()) {
    const previousDate = shiftCalendarDate(local.year, local.month, local.day, -1);
    rollover = getRolloverTimestampForLocalDate(
      previousDate.year, previousDate.month, previousDate.day, rolloverHour, rolloverMinute, timeZone
    );
  }
  return rollover;
}
