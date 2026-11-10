import type { ComponentChildren, JSX } from 'preact';

export interface ModalFrameProps {
  backdropId?: string;
  backdropClassName: string;
  backdropStyle?: JSX.IntrinsicElements['div']['style'];
  dialogId?: string;
  dialogClassName: string;
  dialogStyle?: JSX.IntrinsicElements['section']['style'];
  dialogRef?: { current: HTMLElement | null };
  ariaLabelledBy: string;
  onBackdropClick?: () => void;
  children: ComponentChildren;
}

/**
 * Shared accessible backdrop and dialog surface. Visual treatment and content
 * remain owned by each modal so existing layouts and transitions are preserved.
 */
export function ModalFrame({
  backdropId,
  backdropClassName,
  backdropStyle,
  dialogId,
  dialogClassName,
  dialogStyle,
  dialogRef,
  ariaLabelledBy,
  onBackdropClick,
  children
}: ModalFrameProps) {
  return (
    <div
      id={backdropId}
      class={backdropClassName}
      style={backdropStyle}
      role="presentation"
      onClick={onBackdropClick ? (event) => {
        if (event.target === event.currentTarget) onBackdropClick();
      } : undefined}
    >
      <section
        ref={dialogRef}
        id={dialogId}
        class={dialogClassName}
        style={dialogStyle}
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
