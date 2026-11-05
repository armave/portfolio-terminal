import type { AiIntent } from './intent';

function toPlainDecimal(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER) return null;
  const raw = String(value);
  if (!/[eE]/.test(raw)) return /^\d+(?:\.\d+)?$/.test(raw) ? raw : null;
  const [coefficient, exponentText] = raw.toLowerCase().split('e');
  const exponent = Number(exponentText);
  const [integer, fraction = ''] = coefficient.split('.');
  const digits = integer + fraction;
  const decimalIndex = integer.length + exponent;
  if (decimalIndex <= 0) return '0.' + '0'.repeat(-decimalIndex) + digits;
  if (decimalIndex >= digits.length) return digits + '0'.repeat(decimalIndex - digits.length);
  return digits.slice(0, decimalIndex) + '.' + digits.slice(decimalIndex);
}

function resolveTicker(requested: string | null, activeTicker?: string | null): string | null {
  const ticker = requested ?? activeTicker ?? null;
  return ticker && /^[A-Za-z]{1,10}$/.test(ticker) ? ticker.toUpperCase() : null;
}

function formatExitDate(days: number): string | null {
  if (!Number.isInteger(days) || days < 0 || days > 3650) return null;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/**
 * Route read-only AI intents into the app's deterministic local command paths.
 * Portfolio-changing intents deliberately return null and retain their separate
 * explicit-confirmation boundary.
 */
export function buildAiIntentCommand(intent: AiIntent, activeTicker?: string | null): string | null {
  if (intent.intent === 'chat' || intent.intent === 'action') return null;
  const ticker = resolveTicker(intent.ticker, activeTicker);
  if (!ticker) return null;
  if (intent.intent === 'fetch_quote') return `quote ${ticker}`;

  if (intent.intent === 'simulation') {
    const price = toPlainDecimal(intent.simPrice);
    if (!price || !Number.isInteger(intent.daysOffset) || intent.daysOffset < 0 || intent.daysOffset > 3650) return null;
    return `sim ${ticker} ${price} in ${intent.daysOffset}d`;
  }

  if (intent.intent === 'comparison') {
    if (intent.scenarios.length !== 2) return null;
    const scenarios = intent.scenarios.map((scenario) => {
      const date = formatExitDate(scenario.days);
      const price = toPlainDecimal(scenario.price);
      return date && price ? `${date} at ${price}` : null;
    });
    if (scenarios.some((scenario) => scenario === null)) return null;
    return `compare exits ${ticker} ${scenarios[0]}, ${scenarios[1]}`;
  }
  return null;
}
