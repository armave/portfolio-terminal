import { getAppLanguage, translateText } from '../services/i18n';

/** Formats a timestamp as a compact, locale-aware relative age. */
export function formatRelativeTime(timestamp: number | string | Date, now = Date.now()): string {
  const value = timestamp instanceof Date ? timestamp.getTime()
    : typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
  if (!Number.isFinite(value)) return translateText('Time unknown');

  const deltaSeconds = (value - now) / 1000;
  const absSeconds = Math.floor(Math.abs(deltaSeconds));
  const locale = getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US';
  const relativeTime = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });

  if (absSeconds < 45) {
    if (deltaSeconds > 0) return relativeTime.format(Math.max(1, Math.ceil(deltaSeconds)), 'second');
    return relativeTime.format(0, 'second');
  }

  const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute']
  ];
  for (const [seconds, unit] of units) {
    const amount = Math.floor(absSeconds / seconds);
    if (amount >= 1) return relativeTime.format(deltaSeconds > 0 ? amount : -amount, unit);
  }
  return relativeTime.format(deltaSeconds > 0 ? 1 : -1, 'minute');
}
