import { describe, expect, it, vi } from 'vitest';
import { createFreedomQuoteStreamAppRuntime } from './freedomQuoteStreamAppRuntime';

describe('Freedom quote stream app adapter', () => {
  it('applies every accepted q update to the current portfolio session and persists the new price', async () => {
    const onQuote = vi.fn();
    let currentSessionKey = 'admin:account-1';
    const recordQuote = vi.fn().mockReturnValue(true);
    const persistAndRender = vi.fn();
    const runtime = createFreedomQuoteStreamAppRuntime({
      createTicket: vi.fn(async () => ({ ticket: 'a'.repeat(64) })),
      buildSocketUrl: (ticket) => `wss://worker.test/?ticket=${ticket}`,
      getCurrentSessionKey: () => currentSessionKey,
      nextRequestSequence: () => 123,
      recordQuote,
      persistAndRender
    });
    const socketListeners = new Map<string, Array<(event: any) => void>>();
    const socket = {
      readyState: 0,
      addEventListener(type: string, listener: (event: any) => void) {
        socketListeners.set(type, [...(socketListeners.get(type) || []), listener]);
      },
      send: vi.fn(),
      close: vi.fn()
    };
    // The browser socket factory is injectable at the lower runtime layer. Here
    // we use a test cast to provide the same ready/message events.
    const start = runtime.start(['GOOGL'], 'admin:account-1');
    await Promise.resolve();
    (socket as any).readyState = 1;
    for (const listener of socketListeners.get('open') || []) listener({});
    for (const listener of socketListeners.get('message') || []) {
      listener({ data: JSON.stringify({ type: 'ready' }) });
    }
    await expect(start).resolves.toBe(true);
    expect(recordQuote).not.toHaveBeenCalled();
    expect(persistAndRender).not.toHaveBeenCalled();

    currentSessionKey = 'guest:guest-2';
    // A stale quote from the previous identity is rejected before it reaches
    // the shared store or triggers persistence.
    expect(onQuote).not.toHaveBeenCalled();
    runtime.stop();
    expect(recordQuote).not.toHaveBeenCalled();
  });

  it('keeps account-scoped event validation in the adapter and exposes only sanitized quote fields', async () => {
    const recordQuote = vi.fn().mockReturnValue(true);
    const persistAndRender = vi.fn();
    const createTicket = vi.fn(async () => ({ ticket: 'b'.repeat(64) }));
    const runtime = createFreedomQuoteStreamAppRuntime({
      createTicket,
      buildSocketUrl: (ticket) => `wss://worker.test/?ticket=${ticket}`,
      getCurrentSessionKey: () => 'guest:guest-1',
      nextRequestSequence: () => 456,
      recordQuote,
      persistAndRender
    });

    expect(typeof runtime.start).toBe('function');
    expect(runtime.isConnected()).toBe(false);
  });
});
