export const ENTRY_BUNDLE_BUDGET = Object.freeze({
  maxBytes: 500_000,
  maxGzipBytes: 165_000
});

/**
 * @param {{ assetName: string, bytes: number, gzipBytes: number }} result
 * @param {{ maxBytes?: number, maxGzipBytes?: number }} [budget]
 */
export function assertEntryBundleBudget(result, budget = ENTRY_BUNDLE_BUDGET) {
  const maxBytes = budget.maxBytes ?? ENTRY_BUNDLE_BUDGET.maxBytes;
  const maxGzipBytes = budget.maxGzipBytes ?? ENTRY_BUNDLE_BUDGET.maxGzipBytes;

  if (!Number.isSafeInteger(result.bytes) || result.bytes < 0) {
    throw new Error('Entry bundle raw size must be a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(result.gzipBytes) || result.gzipBytes < 0) {
    throw new Error('Entry bundle gzip size must be a non-negative safe integer.');
  }

  const violations = [];
  if (result.bytes > maxBytes) {
    violations.push(`minified size ${result.bytes} B exceeds ${maxBytes} B`);
  }
  if (result.gzipBytes > maxGzipBytes) {
    violations.push(`gzip size ${result.gzipBytes} B exceeds ${maxGzipBytes} B`);
  }

  if (violations.length > 0) {
    throw new Error(`Entry bundle budget exceeded (${result.assetName}): ${violations.join('; ')}.`);
  }

  return true;
}
