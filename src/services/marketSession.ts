import { isUsEquityTradingDay } from '../domain/tradingCalendar';

export type UsEquityMarketSession = 'PRE' | 'REGULAR' | 'POST' | 'CLOSED';

function newYorkParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || '';
  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    weekday: value('weekday'),
    hour: Number(value('hour')),
    minute: Number(value('minute'))
  };
}

function isEarlyCloseDay(year: number, month: number, day: number): boolean {
  const date = new Date(year, month - 1, day);
  if (month === 11) {
    const thanksgiving = new Date(year, 10, 1);
    thanksgiving.setDate(1 + (4 - thanksgiving.getDay() + 7) % 7 + 3 * 7);
    const fridayAfter = new Date(thanksgiving);
    fridayAfter.setDate(fridayAfter.getDate() + 1);
    if (date.getTime() === fridayAfter.getTime()) return true;
  }
  if (month === 12 && day === 24) return true;
  if (month === 7) {
    // Early close on the final trading session before Independence Day,
    // including years when the observed holiday moves the close to July 1 or 2.
    const julyFourth = new Date(year, 6, 4);
    const previousTradingDay = new Date(julyFourth);
    do {
      previousTradingDay.setDate(previousTradingDay.getDate() - 1);
    } while (!isUsEquityTradingDay(previousTradingDay));
    if (date.getTime() === previousTradingDay.getTime()) return true;
  }
  return false;
}

/** Resolve US equity hours in New York time, independent of the user's timezone. */
export function getUsEquityMarketSession(date = new Date()): UsEquityMarketSession {
  const parts = newYorkParts(date);
  const localDate = new Date(parts.year, parts.month - 1, parts.day);
  if (!isUsEquityTradingDay(localDate)) return 'CLOSED';

  const minutes = parts.hour * 60 + parts.minute;
  const regularClose = isEarlyCloseDay(parts.year, parts.month, parts.day) ? 13 * 60 : 16 * 60;
  const postClose = regularClose + 4 * 60;
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return 'PRE';
  if (minutes >= 9 * 60 + 30 && minutes < regularClose) return 'REGULAR';
  if (minutes >= regularClose && minutes < postClose) return 'POST';
  return 'CLOSED';
}


function marketDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Stable identity for a market session, including one continuous closed interval. */
export function getUsEquityMarketSessionKey(date = new Date()): string {
  const parts = newYorkParts(date);
  const localDate = new Date(parts.year, parts.month - 1, parts.day);
  const session = getUsEquityMarketSession(date);
  if (session !== 'CLOSED') return `${marketDateKey(localDate)}:${session}`;

  const minutes = parts.hour * 60 + parts.minute;
  let nextSessionDate = new Date(localDate);
  // Before 04:00 ET on a trading day, today's premarket is the next session.
  // Otherwise, associate closed hours with the next actual trading date.
  if (!(isUsEquityTradingDay(localDate) && minutes < 4 * 60)) {
    nextSessionDate.setDate(nextSessionDate.getDate() + 1);
    let attempts = 0;
    while (!isUsEquityTradingDay(nextSessionDate) && attempts < 14) {
      nextSessionDate.setDate(nextSessionDate.getDate() + 1);
      attempts += 1;
    }
  }
  return `${marketDateKey(nextSessionDate)}:CLOSED`;
}
