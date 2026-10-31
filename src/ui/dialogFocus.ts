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

interface UseDialogFocusOptions {
  active?: boolean;
  initialFocusRef?: DialogElementRef;
  onEscape?: () => void;
}

/** Shared focus containment, initial focus, scroll locking, and focus restoration for modal dialogs. */
export function useDialogFocus(
  dialogRef: DialogElementRef,
  { active = true, initialFocusRef, onEscape }: UseDialogFocusOptions = {}
): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onEscapeRef.current) {
        event.preventDefault();
        onEscapeRef.current();
        return;
      }
      trapDialogTabKey(event, dialog, document.activeElement);
    };

    document.addEventListener('keydown', onKeyDown);
    (initialFocusRef?.current ?? getDialogFocusableElements(dialog)[0] ?? dialog).focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [active, dialogRef, initialFocusRef]);
}
