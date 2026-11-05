function stableSerialize(value: unknown): string {
  if (value === undefined) return '"[undefined]"';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(stableSerialize).join(',') + ']';
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record).sort().map((key) =>
    JSON.stringify(key) + ':' + stableSerialize(record[key])
  ).join(',') + '}';
}

/** Prevents an older asynchronous AI response from acting after a newer request. */
export function createAiRequestLifecycle() {
  let currentRequest = 0;
  return {
    begin(): number {
      currentRequest += 1;
      return currentRequest;
    },
    invalidate(): void {
      currentRequest += 1;
    },
    isCurrent(requestId: number): boolean {
      return requestId === currentRequest;
    }
  };
}

/**
 * Stable in-memory equality token for facts used by AI prompts and projections.
 * This is not a security hash and must never be persisted or logged.
 */
export function fingerprintAiPortfolioContext(context: unknown): string {
  return stableSerialize(context);
}

/**
 * Only intents whose result depends on the portfolio snapshot should be discarded
 * when that snapshot changes during the provider round-trip. General chat/news
 * answers are independent of portfolio state.
 */
export function aiIntentRequiresFreshPortfolioContext(
  intent: 'chat' | 'action' | 'simulation' | 'comparison' | 'fetch_quote',
  ticker: string | null
): boolean {
  return intent === 'action' || intent === 'simulation' || intent === 'comparison' ||
    (intent === 'fetch_quote' && ticker === null);
}
