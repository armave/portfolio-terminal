export const DEFAULT_PAGE_RENDER_READINESS_TIMEOUT_MS = 12_000;

export interface PageRenderReadinessOptions {
  document: Document;
  getRoot: () => Element | null;
  onReady: () => void;
  /** Maximum time the full-screen startup overlay may wait for optional desk content. */
  timeoutMs?: number;
  /** Diagnostic hook when the active desk still has a loading placeholder at the deadline. */
  onTimeout?: () => void;
}

/** Resolve the outer container whose visible contents define each initial page. */
export function resolveActivePageRootId(activeView: string): string {
  switch (activeView) {
    case 'BALANCE':
    case 'CASH_CUSHION':
      return 'cashCushionContainer';
    case 'CLOSED_HISTORY':
      return 'closedHistoryContainer';
    case 'GUEST_HISTORY':
      return 'guestHistoryContainer';
    case 'SETTINGS':
      return 'settings';
    default:
      // Combined and per-ticker Margin desks share the same page container.
      return 'mainDeskContainer';
  }
}

/**
 * Loading placeholders and busy regions are explicit page-readiness contracts.
 * The root is scoped to the active desk so background work in hidden pages does
 * not keep the initial overlay visible. Native lazy images remain deferred.
 */
export function isPageRenderReady(
  root: Pick<Element, 'querySelector' | 'querySelectorAll'>,
  fontsReady = true
): boolean {
  if (!fontsReady) return false;
  if (root.querySelector('[data-page-loading="true"], [aria-busy="true"]')) return false;

  return Array.from(root.querySelectorAll('img')).every((image) => {
    const pageImage = image as HTMLImageElement;
    return pageImage.complete || pageImage.loading === 'lazy';
  });
}

function hasActiveFiniteAnimations(root: Element): boolean {
  if (typeof root.getAnimations !== 'function') return false;

  return root.getAnimations({ subtree: true }).some((animation) => {
    if (animation.playState !== 'running' && !animation.pending) return false;
    return animation.effect?.getComputedTiming().iterations !== Infinity;
  });
}

/**
 * Keep the startup overlay until the active page has no pending UI regions,
 * eager images/fonts have settled, and two stable paint frames have passed
 * after its finite entrance animations complete. Returns a disposer for page changes.
 */
export function watchPageRenderReadiness(
  options: PageRenderReadinessOptions
): () => void {
  const { document: documentRef, getRoot, onReady } = options;
  const windowRef = documentRef.defaultView;
  const observeTarget = documentRef.getElementById('root') ?? documentRef.body ?? documentRef.documentElement;

  if (
    !windowRef ||
    !observeTarget ||
    typeof windowRef.requestAnimationFrame !== 'function' ||
    typeof windowRef.MutationObserver !== 'function'
  ) {
    onReady();
    return () => undefined;
  }

  const browserWindow = windowRef;
  let disposed = false;
  let frameId: number | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let stableFrames = 0;
  let currentRoot: Element | null = null;

  const observer = new browserWindow.MutationObserver(() => {
    stableFrames = 0;
    scheduleCheck();
  });

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    if (frameId !== null) browserWindow.cancelAnimationFrame(frameId);
    frameId = null;
    if (timeoutId !== null) clearTimeout(timeoutId);
    timeoutId = null;
    observer.disconnect();
    observeTarget.removeEventListener('load', scheduleCheck, true);
    observeTarget.removeEventListener('error', scheduleCheck, true);
  };

  const checkReadiness = () => {
    frameId = null;
    if (disposed) return;

    const root = getRoot();
    if (root !== currentRoot) {
      currentRoot = root;
      stableFrames = 0;
    }

    const fontsReady = !documentRef.fonts || documentRef.fonts.status === 'loaded';
    const ready = Boolean(
      root &&
      isPageRenderReady(root, fontsReady) &&
      !hasActiveFiniteAnimations(root)
    );

    if (ready) {
      stableFrames += 1;
      if (stableFrames >= 2) {
        cleanup();
        onReady();
        return;
      }
    } else {
      stableFrames = 0;
    }

    scheduleCheck();
  };

  function scheduleCheck() {
    if (disposed || frameId !== null) return;
    frameId = browserWindow.requestAnimationFrame(checkReadiness);
  }

  const readinessTimeoutMs = options.timeoutMs ?? DEFAULT_PAGE_RENDER_READINESS_TIMEOUT_MS;
  if (readinessTimeoutMs > 0) {
    timeoutId = setTimeout(() => {
      if (disposed) return;
      // A stalled optional lazy chunk, eager image, or font must not retain the
      // full-screen app shell forever. The active desk keeps its own local
      // fallback while navigation and recovery controls remain available.
      cleanup();
      try {
        options.onTimeout?.();
      } finally {
        onReady();
      }
    }, readinessTimeoutMs);
  }

  observer.observe(observeTarget, {
    attributes: true,
    childList: true,
    subtree: true,
    characterData: true,
    attributeFilter: ['class', 'hidden', 'aria-busy', 'data-page-loading', 'src', 'srcset', 'loading']
  });
  observeTarget.addEventListener('load', scheduleCheck, true);
  observeTarget.addEventListener('error', scheduleCheck, true);
  void documentRef.fonts?.ready.then(scheduleCheck, scheduleCheck);
  scheduleCheck();

  return cleanup;
}
