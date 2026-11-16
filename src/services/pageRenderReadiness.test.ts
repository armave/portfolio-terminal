import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PAGE_RENDER_READINESS_TIMEOUT_MS,
  isPageRenderReady,
  resolveActivePageRootId,
  watchPageRenderReadiness
} from './pageRenderReadiness';

function createRoot(options: {
  loading?: boolean;
  busy?: boolean;
  images?: Array<{ complete: boolean; loading?: 'eager' | 'lazy' }>;
} = {}): Element {
  const { loading = false, busy = false, images = [] } = options;
  return {
    querySelector: (selector: string) => {
      if (selector.includes('data-page-loading') && loading) return {} as Element;
      if (selector.includes('aria-busy') && busy) return {} as Element;
      return null;
    },
    querySelectorAll: (selector: string) => selector === 'img' ? images : []
  } as unknown as Element;
}


function createReadinessWatcherFixture() {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrameId = 0;
  const cancelledFrames: number[] = [];
  const observers: Array<{ observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];

  class TestMutationObserver {
    observe = vi.fn();
    disconnect = vi.fn();

    constructor(_callback: MutationCallback) {
      observers.push(this);
    }
  }

  const target = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  } as unknown as Element;
  const browserWindow = {
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      const id = ++nextFrameId;
      frames.set(id, callback);
      return id;
    }),
    cancelAnimationFrame: vi.fn((id: number) => {
      cancelledFrames.push(id);
      frames.delete(id);
    }),
    MutationObserver: TestMutationObserver
  } as unknown as Window;
  const documentRef = {
    defaultView: browserWindow,
    getElementById: vi.fn(() => target),
    body: target,
    documentElement: target,
    fonts: { status: 'loaded', ready: Promise.resolve() }
  } as unknown as Document;

  const flushFrame = () => {
    const next = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (!next) throw new Error('No animation frame is queued.');
    frames.delete(next[0]);
    next[1](0);
  };

  return { documentRef, frames, cancelledFrames, observers, flushFrame };
}

describe('page render readiness', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('releases the full-screen startup overlay when page placeholders never settle', async () => {
    vi.useFakeTimers();
    const fixture = createReadinessWatcherFixture();
    const onReady = vi.fn();
    const onTimeout = vi.fn();

    watchPageRenderReadiness({
      document: fixture.documentRef,
      getRoot: () => null,
      onReady,
      onTimeout
    });

    expect(DEFAULT_PAGE_RENDER_READINESS_TIMEOUT_MS).toBe(12_000);
    await vi.advanceTimersByTimeAsync(DEFAULT_PAGE_RENDER_READINESS_TIMEOUT_MS);

    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(fixture.frames.size).toBe(0);
    expect(fixture.observers[0]?.disconnect).toHaveBeenCalledTimes(1);
  });

  it('cancels the fallback deadline after the active desk becomes ready', async () => {
    vi.useFakeTimers();
    const fixture = createReadinessWatcherFixture();
    const root = createRoot();
    const onReady = vi.fn();
    const onTimeout = vi.fn();

    watchPageRenderReadiness({
      document: fixture.documentRef,
      getRoot: () => root,
      onReady,
      onTimeout
    });

    await Promise.resolve();
    fixture.flushFrame();
    fixture.flushFrame();

    expect(onReady).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DEFAULT_PAGE_RENDER_READINESS_TIMEOUT_MS);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('keeps startup blocked while a lazy page fallback is mounted', () => {
    expect(isPageRenderReady(createRoot({ loading: true }))).toBe(false);
  });

  it('keeps startup blocked while an active page region is busy', () => {
    expect(isPageRenderReady(createRoot({ busy: true }))).toBe(false);
  });

  it('waits for eager images in the active page to finish loading', () => {
    expect(isPageRenderReady(createRoot({ images: [{ complete: false, loading: 'eager' }] }))).toBe(false);
    expect(isPageRenderReady(createRoot({ images: [{ complete: true, loading: 'eager' }] }))).toBe(true);
  });

  it('does not block on native lazy images outside the initial render', () => {
    expect(isPageRenderReady(createRoot({ images: [{ complete: false, loading: 'lazy' }] }))).toBe(true);
  });

  it('waits until browser fonts are ready', () => {
    expect(isPageRenderReady(createRoot(), false)).toBe(false);
    expect(isPageRenderReady(createRoot(), true)).toBe(true);
  });

  it('reports ready only after placeholders, busy regions, eager images, and fonts settle', () => {
    expect(isPageRenderReady(createRoot({
      loading: false,
      busy: false,
      images: [{ complete: true }, { complete: true }]
    }), true)).toBe(true);
  });

  it.each([
    ['COMBINED', 'mainDeskContainer'],
    ['AAPL', 'mainDeskContainer'],
    ['BALANCE', 'cashCushionContainer'],
    ['CASH_CUSHION', 'cashCushionContainer'],
    ['CLOSED_HISTORY', 'closedHistoryContainer'],
    ['GUEST_HISTORY', 'guestHistoryContainer'],
    ['SETTINGS', 'settings']
  ])('selects the active page root for %s', (view, rootId) => {
    expect(resolveActivePageRootId(view)).toBe(rootId);
  });
});
