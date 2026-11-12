import { describe, expect, it } from 'vitest';
import { isPageRenderReady, resolveActivePageRootId } from './pageRenderReadiness';

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

describe('page render readiness', () => {
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
