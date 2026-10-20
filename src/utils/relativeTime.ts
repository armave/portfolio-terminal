/** Formats a timestamp as a compact relative age (e.g. "just now", "4m ago", "2h ago"). */
export function formatRelativeTime(timestamp: number | string | Date, now = Date.now()): string {
  const value = timestamp instanceof Date ? timestamp.getTime()
    : typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
  if (!Number.isFinite(value)) return 'time unknown';
  const delta = value - now;
  const absSeconds = Math.floor(Math.abs(delta) / 1000);
  const future = delta > 0;
  if (absSeconds < 45) return future ? 'in a few seconds' : 'just now';
  const units: Array<[number, string]> = [[86400, 'd'], [3600, 'h'], [60, 'm']];
  for (const [seconds, suffix] of units) {
    const amount = Math.floor(absSeconds / seconds);
    if (amount >= 1) return future ? `in ${amount}${suffix}` : `${amount}${suffix} ago`;
  }
  return future ? 'in less than a minute' : 'less than a minute ago';
}
