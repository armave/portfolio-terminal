export type SafeDiagnosticLevel = 'info' | 'warn' | 'error';
export type SafeDiagnosticCategory =
  | 'browser-storage' | 'credential-storage' | 'cloud-sync' | 'closed-history'
  | 'market-data' | 'broker-stream' | 'broker-data' | 'portfolio-rollover' | 'startup' | 'portfolio-store' | 'auth';

type SafeErrorClass = 'aborted' | 'timeout' | 'storage-limit' | 'browser-security' | 'malformed-data' | 'crypto-operation' | 'type-error' | 'unknown';

export function classifySafeDiagnosticError(error: unknown): SafeErrorClass {
  if (error === null || typeof error !== 'object') return 'unknown';
  const name = (error as { name?: unknown }).name;
  switch (name) {
    case 'AbortError': return 'aborted';
    case 'TimeoutError': return 'timeout';
    case 'QuotaExceededError': return 'storage-limit';
    case 'SecurityError': return 'browser-security';
    case 'DataError':
    case 'SyntaxError': return 'malformed-data';
    case 'OperationError': return 'crypto-operation';
    case 'TypeError': return 'type-error';
    default: return 'unknown';
  }
}

/** Never serializes the original error, message, stack, URL, request or payload. */
export function logSafeDiagnostic(level: SafeDiagnosticLevel, category: SafeDiagnosticCategory, error?: unknown): void {
  const entry = JSON.stringify({ type: 'client_diagnostic', category, errorClass: classifySafeDiagnosticError(error) });
  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else console.info(entry);
}
