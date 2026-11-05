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
