import { describe, expect, it } from 'vitest';
import { addUiEventListener, emitUiEvent, removeUiEventListener } from './uiEventBus';

describe('typed UI event bus', () => {
  it('delivers market intelligence requests with their typed details', () => {
    const received: unknown[] = [];
    const listener = (event: { detail: { ticker?: string; refresh?: boolean } }) => received.push(event.detail);
    addUiEventListener('margin:intelligence-request', listener);
    emitUiEvent('margin:intelligence-request', { ticker: 'AAPL', refresh: true });
    expect(received).toEqual([{ ticker: 'AAPL', refresh: true }]);
    removeUiEventListener('margin:intelligence-request', listener);
    emitUiEvent('margin:intelligence-request', { ticker: 'MSFT' });
    expect(received).toHaveLength(1);
  });

  it('delivers market-depth and scenario requests through app-scoped event names', () => {
    const received: Array<{ kind: string; detail: unknown }> = [];
    const depth = (event: { detail: { ticker: string } }) => received.push({ kind: 'depth', detail: event.detail });
    const exit = (event: { detail: { ticker?: string } }) => received.push({ kind: 'exit', detail: event.detail });
    const buy = (event: { detail: { ticker?: string } }) => received.push({ kind: 'buy', detail: event.detail });
    addUiEventListener('market:depth-request', depth);
    addUiEventListener('scenario:exit-comparison-request', exit);
    addUiEventListener('scenario:buy-more-request', buy);
    emitUiEvent('market:depth-request', { ticker: 'AAPL.US' });
    emitUiEvent('scenario:exit-comparison-request', { ticker: 'GOOGL' });
    emitUiEvent('scenario:buy-more-request', {});
    expect(received).toEqual([
      { kind: 'depth', detail: { ticker: 'AAPL.US' } },
      { kind: 'exit', detail: { ticker: 'GOOGL' } },
      { kind: 'buy', detail: {} }
    ]);
    removeUiEventListener('market:depth-request', depth);
    removeUiEventListener('scenario:exit-comparison-request', exit);
    removeUiEventListener('scenario:buy-more-request', buy);
  });

  it('delivers authentication, backup, and application lifecycle requests', () => {
    const received: string[] = [];
    const auth = () => received.push('auth');
    const backup = () => received.push('backup');
    const retry = () => received.push('retry');
    addUiEventListener('auth:visibility', auth);
    addUiEventListener('settings:backup-import-request', backup);
    addUiEventListener('app:startup-retry', retry);
    emitUiEvent('auth:visibility', { isOpen: true });
    emitUiEvent('settings:backup-import-request');
    emitUiEvent('app:startup-retry');
    expect(received).toEqual(['auth', 'backup', 'retry']);
    removeUiEventListener('auth:visibility', auth);
    removeUiEventListener('settings:backup-import-request', backup);
    removeUiEventListener('app:startup-retry', retry);
  });

  it('supports synchronous workspace-scroll notifications', () => {
    let calls = 0;
    const listener = () => { calls += 1; };
    addUiEventListener('app:scroll-workspace', listener);
    emitUiEvent('app:scroll-workspace');
    removeUiEventListener('app:scroll-workspace', listener);
    emitUiEvent('app:scroll-workspace');
    expect(calls).toBe(1);
  });
});
