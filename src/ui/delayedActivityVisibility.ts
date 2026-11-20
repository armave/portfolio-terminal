import { useEffect, useRef, useState } from 'preact/hooks';

export const ACTIVITY_INDICATOR_SHOW_DELAY_MS = 400;
export const ACTIVITY_INDICATOR_MIN_VISIBLE_MS = 650;

export interface DelayedActivityVisibilityController {
  setActive: (active: boolean) => void;
  isVisible: () => boolean;
  subscribe: (listener: (visible: boolean) => void) => () => void;
  dispose: () => void;
}

export interface DelayedActivityVisibilityOptions {
  showDelayMs?: number;
  minimumVisibleMs?: number;
  now?: () => number;
}

function normalizeDelay(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : fallback;
}

/**
 * Smooths short background tasks without hiding a genuinely long-running task.
 * The controller is deliberately presentation-only and owns no portfolio state.
 */
export function createDelayedActivityVisibilityController(
  options: DelayedActivityVisibilityOptions = {}
): DelayedActivityVisibilityController {
  const showDelayMs = normalizeDelay(options.showDelayMs, ACTIVITY_INDICATOR_SHOW_DELAY_MS);
  const minimumVisibleMs = normalizeDelay(options.minimumVisibleMs, ACTIVITY_INDICATOR_MIN_VISIBLE_MS);
  const now = options.now || Date.now;
  const listeners = new Set<(visible: boolean) => void>();
  let active = false;
  let visible = false;
  let visibleSince = 0;
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const notify = (): void => {
    listeners.forEach((listener) => listener(visible));
  };

  const clearShowTimer = (): void => {
    if (showTimer === null) return;
    clearTimeout(showTimer);
    showTimer = null;
  };

  const clearHideTimer = (): void => {
    if (hideTimer === null) return;
    clearTimeout(hideTimer);
    hideTimer = null;
  };

  const setActive = (nextActive: boolean): void => {
    if (disposed) return;
    active = nextActive;

    if (active) {
      clearHideTimer();
      if (visible || showTimer !== null) return;
      showTimer = setTimeout(() => {
        showTimer = null;
        if (disposed || !active || visible) return;
        visible = true;
        visibleSince = now();
        notify();
      }, showDelayMs);
      return;
    }

    clearShowTimer();
    if (!visible || hideTimer !== null) return;

    const elapsed = Math.max(0, now() - visibleSince);
    const remaining = Math.max(0, minimumVisibleMs - elapsed);
    hideTimer = setTimeout(() => {
      hideTimer = null;
      if (disposed || active || !visible) return;
      visible = false;
      visibleSince = 0;
      notify();
    }, remaining);
  };

  return {
    setActive,
    isVisible: () => visible,
    subscribe: (listener) => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      listener(visible);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearShowTimer();
      clearHideTimer();
      listeners.clear();
    }
  };
}

/**
 * Preact hook for delayed, minimum-duration background activity indicators.
 * Timing options are captured when the hook first mounts and should be stable.
 */
export function useDelayedActivityVisibility(
  active: boolean,
  options: DelayedActivityVisibilityOptions = {}
): boolean {
  const controllerRef = useRef<DelayedActivityVisibilityController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createDelayedActivityVisibilityController(options);
  }
  const [visible, setVisible] = useState(controllerRef.current.isVisible());

  useEffect(() => {
    const controller = controllerRef.current!;
    const unsubscribe = controller.subscribe(setVisible);
    controller.setActive(active);
    return unsubscribe;
  }, [active]);

  useEffect(() => () => controllerRef.current?.dispose(), []);

  return visible;
}
