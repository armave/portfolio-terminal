import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isOnlyOpenAppClient,
  isPageRefreshNavigation,
  PWA_REFRESH_CLIENT_QUERY,
  PWA_REFRESH_CLIENT_QUERY_RESULT
} from './pwaRefreshUpdate';

class FakePort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  peer: FakePort | null = null;
  closed = false;

  postMessage(data: unknown): void {
    this.peer?.onmessage?.({ data } as MessageEvent<unknown>);
  }

  close(): void {
    this.closed = true;
  }
}

class FakeMessageChannel {
  port1 = new FakePort();
  port2 = new FakePort();

  constructor() {
    this.port1.peer = this.port2;
    this.port2.peer = this.port1;
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('PWA refresh update policy', () => {
  it('recognizes browser refresh navigation without treating ordinary launches as refreshes', () => {
    expect(isPageRefreshNavigation('reload')).toBe(true);
    expect(isPageRefreshNavigation('navigate')).toBe(false);
    expect(isPageRefreshNavigation('back_forward')).toBe(false);
    expect(isPageRefreshNavigation(undefined)).toBe(false);
  });

  it('allows activation only when the waiting worker reports this is the sole app client', async () => {
    vi.stubGlobal('MessageChannel', FakeMessageChannel);
    const worker = {
      postMessage: vi.fn((_message: unknown, ports: Transferable[]) => {
        (ports[0] as unknown as FakePort).postMessage({
          type: PWA_REFRESH_CLIENT_QUERY_RESULT,
          clientCount: 1
        });
      })
    };

    await expect(isOnlyOpenAppClient(worker)).resolves.toBe(true);
    expect(worker.postMessage).toHaveBeenCalledWith(
      { type: PWA_REFRESH_CLIENT_QUERY },
      expect.any(Array)
    );
  });

  it('keeps the update staged when another app tab is open', async () => {
    vi.stubGlobal('MessageChannel', FakeMessageChannel);
    const worker = {
      postMessage: vi.fn((_message: unknown, ports: Transferable[]) => {
        (ports[0] as unknown as FakePort).postMessage({
          type: PWA_REFRESH_CLIENT_QUERY_RESULT,
          clientCount: 2
        });
      })
    };

    await expect(isOnlyOpenAppClient(worker)).resolves.toBe(false);
  });

  it('fails closed when the waiting worker does not reply', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('MessageChannel', FakeMessageChannel);
    const worker = { postMessage: vi.fn() };

    const result = isOnlyOpenAppClient(worker, 100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe(false);
  });

  it('fails closed when the worker message cannot be sent', async () => {
    vi.stubGlobal('MessageChannel', FakeMessageChannel);
    const worker = { postMessage: vi.fn(() => { throw new Error('worker unavailable'); }) };

    await expect(isOnlyOpenAppClient(worker)).resolves.toBe(false);
  });
});
