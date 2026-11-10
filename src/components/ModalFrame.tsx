import type { ComponentChildren, JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

type ModalPhase = 'opening' | 'open' | 'closing';
type ModalCloseRef = { current: (() => void) | null };

const MODAL_TRANSITION_MS = 200;

/**
 * Shared accessible backdrop, dialog surface, and entrance/exit lifecycle.
 * Callers keep ownership of content and visual styling; this frame adds the
 * same opacity/scale transition and delays dismissal until the exit completes.
 */
export interface ModalFrameProps {
  backdropId?: string;
  backdropClassName: string;
  backdropStyle?: JSX.IntrinsicElements['div']['style'];
  dialogId?: string;
  dialogClassName: string;
  dialogStyle?: JSX.IntrinsicElements['section']['style'];
  dialogRef?: { current: HTMLElement | null };
  closeRef: ModalCloseRef;
  onClose: () => void;
  ariaLabelledBy: string;
  children: ComponentChildren;
}

export function ModalFrame({
  backdropId,
  backdropClassName,
  backdropStyle,
  dialogId,
  dialogClassName,
  dialogStyle,
  dialogRef,
  closeRef,
  onClose,
  ariaLabelledBy,
  children
}: ModalFrameProps) {
  const [phase, setPhase] = useState<ModalPhase>('opening');
  const phaseRef = useRef<ModalPhase>('opening');
  const prefersReducedMotionRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const requestClose = useCallback(() => {
    if (phaseRef.current === 'closing') return;

    phaseRef.current = 'closing';
    setPhase('closing');

    if (prefersReducedMotionRef.current || typeof window === 'undefined') {
      onCloseRef.current();
      return;
    }

    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onCloseRef.current();
    }, MODAL_TRANSITION_MS);
  }, []);

  useEffect(() => {
    const view = typeof window === 'undefined' ? null : window;
    const prefersReducedMotion = Boolean(view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    prefersReducedMotionRef.current = prefersReducedMotion;
    closeRef.current = requestClose;

    let animationFrame: number | null = null;
    if (prefersReducedMotion || !view?.requestAnimationFrame) {
      phaseRef.current = 'open';
      setPhase('open');
    } else {
      animationFrame = view.requestAnimationFrame(() => {
        if (phaseRef.current === 'closing') return;
        phaseRef.current = 'open';
        setPhase('open');
      });
    }

    return () => {
      if (animationFrame !== null) view?.cancelAnimationFrame(animationFrame);
      if (closeTimerRef.current !== null) {
        view?.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      if (closeRef.current === requestClose) closeRef.current = null;
    };
  }, [closeRef, requestClose]);

  const isVisible = phase === 'open';
  const transition = prefersReducedMotionRef.current
    ? 'none'
    : `opacity ${MODAL_TRANSITION_MS}ms ease-out`;
  const dialogTransition = prefersReducedMotionRef.current
    ? 'none'
    : `opacity ${MODAL_TRANSITION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), transform ${MODAL_TRANSITION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;

  return (
    <div
      id={backdropId}
      class={backdropClassName}
      style={{
        ...(backdropStyle || {}),
        opacity: isVisible ? 1 : 0,
        transition
      }}
      data-modal-state={phase}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        ref={dialogRef}
        id={dialogId}
        class={dialogClassName}
        style={{
          ...(dialogStyle || {}),
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? 'translate3d(0, 0, 0) scale(1)' : 'translate3d(0, 10px, 0) scale(0.985)',
          transition: dialogTransition
        }}
        data-modal-state={phase}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        tabIndex={-1}
      >
        {children}
      </section>
    </div>
  );
}
