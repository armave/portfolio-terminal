const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NON_POSITION_VIEWS = new Set(['COMBINED', 'CASH_CUSHION', 'BALANCE', 'CLOSED_HISTORY', 'SETTINGS']);

export function formatTrancheDate(dateStr?: string | number | null): string {
  if (!dateStr || typeof dateStr !== 'string') return 'New';
  const trimmed = dateStr.trim();
  if (!trimmed || trimmed.toLowerCase() === 'new') return 'New';

  const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch) {
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    if (month >= 0 && month < 12 && day >= 1 && day <= 31) {
      return `${String(day).padStart(2, '0')} ${MONTH_NAMES[month]}`;
    }
  }

  const shortMatch =
    trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3,})/i) ||
    trimmed.match(/^([A-Za-z]{3,})\s+(\d{1,2})/i);
  if (shortMatch) {
    const isFirstNum = /^\d+$/.test(shortMatch[1]);
    const day = parseInt(isFirstNum ? shortMatch[1] : shortMatch[2], 10);
    const monStr = (isFirstNum ? shortMatch[2] : shortMatch[1]).slice(0, 3).toLowerCase();
    const monthIdx = MONTH_NAMES.findIndex((m) => m.toLowerCase() === monStr);
    if (monthIdx !== -1 && day >= 1 && day <= 31) {
      return `${String(day).padStart(2, '0')}${MONTH_NAMES[monthIdx]}`;
    }
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const day = parsed.getDate();
    const month = parsed.getMonth();
    return `${String(day).padStart(2, '0')}${MONTH_NAMES[month]}`;
  }

  return trimmed;
}

export function formatUSD(val: unknown): string {
  const num = Number(val) || 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
