import { useEffect, useRef } from 'preact/hooks';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

export function getDialogFocusableElements(dialog: Pick<HTMLElement, 'querySelectorAll'>): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0 && !element.closest('[hidden], [inert], [aria-hidden="true"]'));
}

export function trapDialogTabKey(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>,
  dialog: HTMLElement,
  activeElement: Element | null
): boolean {
  if (event.key !== 'Tab') return false;

  const focusable = getDialogFocusableElements(dialog);
  if (!focusable.length) {
    event.preventDefault();
    dialog.focus();
    return true;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const focusIsOutside = !dialog.contains(activeElement);

  if (event.shiftKey && (activeElement === first || activeElement === dialog || focusIsOutside)) {
    event.preventDefault();
    last.focus();
    return true;
  }

  if (!event.shiftKey && (activeElement === last || activeElement === dialog || focusIsOutside)) {
    event.preventDefault();
    first.focus();
    return true;
  }

  return false;
}

interface DialogElementRef {
  current: HTMLElement | null;
}

export function resolveDialogRestoreTarget(
  explicitTarget: HTMLElement | null | undefined,
  activeElement: HTMLElement | null
): HTMLElement | null {
  return explicitTarget?.isConnected ? explicitTarget : activeElement;
}

export function focusElementWithoutScrolling(element: HTMLElement | null | undefined): void {
  element?.focus({ preventScroll: true });
}

export function restoreScrollPositionImmediately(
  documentElement: Pick<HTMLElement, 'style'>,
  scrollTo: (x: number, y: number) => void,
  scrollX: number,
  scrollY: number
): void {
  const previousScrollBehavior = documentElement.style.scrollBehavior;
  // The app enables smooth scrolling globally; modal cleanup must restore the
  // exact offset synchronously rather than animating from the top of the page.
  documentElement.style.scrollBehavior = 'auto';
  try {
    scrollTo(scrollX, scrollY);
  } finally {
    documentElement.style.scrollBehavior = previousScrollBehavior;
  }
}

interface UseDialogFocusOptions {
  active?: boolean;
  initialFocusRef?: DialogElementRef;
  restoreFocusRef?: DialogElementRef;
  onEscape?: () => void;
}

/** Shared focus containment, initial focus, scroll locking, and focus restoration for modal dialogs. */
export function useDialogFocus(
  dialogRef: DialogElementRef,
  { active = true, initialFocusRef, restoreFocusRef, onEscape }: UseDialogFocusOptions = {}
): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousFocus = resolveDialogRestoreTarget(restoreFocusRef?.current, activeElement);
    const body = document.body;
    const documentElement = document.documentElement;
    const previousBodyStyles = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width
    };
    const previousDocumentOverflow = documentElement.style.overflow;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    // A fixed body prevents touch scrolling behind the dialog on mobile Safari.
    documentElement.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = `-${scrollX}px`;
    body.style.right = '0';
    body.style.width = '100%';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onEscapeRef.current) {
        event.preventDefault();
        onEscapeRef.current();
        return;
      }
      trapDialogTabKey(event, dialog, document.activeElement);
    };

    document.addEventListener('keydown', onKeyDown);
    focusElementWithoutScrolling(initialFocusRef?.current ?? getDialogFocusableElements(dialog)[0] ?? dialog);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      body.style.overflow = previousBodyStyles.overflow;
      body.style.position = previousBodyStyles.position;
      body.style.top = previousBodyStyles.top;
      body.style.left = previousBodyStyles.left;
      body.style.right = previousBodyStyles.right;
      body.style.width = previousBodyStyles.width;
      documentElement.style.overflow = previousDocumentOverflow;
      restoreScrollPositionImmediately(documentElement, (x, y) => window.scrollTo(x, y), scrollX, scrollY);
      if (previousFocus?.isConnected) focusElementWithoutScrolling(previousFocus);
    };
  }, [active, dialogRef, initialFocusRef, restoreFocusRef]);
}
