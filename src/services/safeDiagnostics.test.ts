import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifySafeDiagnosticError, logSafeDiagnostic } from './safeDiagnostics';

afterEach(() => vi.restoreAllMocks());

describe('safe client diagnostics', () => {
  it.each([
    [new DOMException('contains-secret-token', 'AbortError'), 'aborted'],
    [Object.assign(new Error('private history write details'), { name: 'TimeoutError' }), 'timeout']
    [new DOMException('contains-secret-token', 'QuotaExceededError'), 'storage-limit'],
    [new DOMException('contains-secret-token', 'SecurityError'), 'browser-security'],
    [new SyntaxError('https://private.example/path?token=secret'), 'malformed-data'],
    [new DOMException('contains-secret-token', 'OperationError'), 'crypto-operation'],
    [new TypeError('account AAPL portfolio payload'), 'type-error'],
    [new Error('untrusted provider payload'), 'unknown'],
    ['session-token-secret', 'unknown'],
    [null, 'unknown']
  ] as const)('maps errors to an allowlisted class only', (error, expected) => {
    expect(classifySafeDiagnosticError(error)).toBe(expected);
  });

  it('does not log messages, stacks, URLs, tickers or arbitrary payload fields', () => {
    const output = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('https://broker.example/private?token=secret AAPL $12,345');
    (error as Error & { accountId?: string }).accountId = 'account-secret';
    logSafeDiagnostic('error', 'cloud-sync', error);
    expect(output).toHaveBeenCalledOnce();
    const entry = String(output.mock.calls[0][0]);
    expect(entry).toContain('"category":"cloud-sync"');
    expect(entry).toContain('"errorClass":"unknown"');
    for (const secret of ['broker.example', 'token=secret', 'AAPL', '$12,345', 'account-secret']) expect(entry).not.toContain(secret);
  });
  it('keeps application lifecycle and persistence exception logging behind the safe boundary', () => {
    const sourcePaths = [
      '../main.ts',
      './storage.ts',
      './authTransportRuntime.ts',
      './browserProfileRepairRuntime.ts',
      './portfolioStartupLifecycleRuntime.ts'
    ];
    const rawErrorLog = /console\.(?:warn|error|info)\([^;\n]*,\s*(?:error|err|rollbackError|indexedDbError)\s*\);/;
    for (const path of sourcePaths) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      expect(source, path).not.toMatch(rawErrorLog);
    }
  });

});
