import type { AppToast, ToastVariant } from '../ui/notificationStore';

export interface ToastViewportProps {
  toasts: readonly AppToast[];
}

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  error: 'border-rose-800 text-rose-200',
  warning: 'border-amber-800 text-amber-200',
  success: 'border-emerald-800 text-emerald-200',
  info: 'border-slate-700 text-slate-200'
};

/** Shared, responsive notification renderer; notificationStore retains timer and dismissal ownership. */
export function ToastViewport({ toasts }: ToastViewportProps) {
  return (
    <div
      id="toastContainer"
      class="pointer-events-none fixed left-3 right-3 top-3 z-50 flex flex-col items-end gap-2 sm:left-auto sm:right-4 sm:top-4"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.variant === 'error' ? 'alert' : 'status'}
          class={`pointer-events-auto max-w-full rounded-lg border bg-slate-900/95 px-3.5 py-2 text-xs font-mono font-semibold shadow-lg backdrop-blur transition-[opacity,transform] duration-200 ease-out ${VARIANT_CLASSES[toast.variant]} ${toast.isClosing ? 'opacity-0 translate-x-2' : ''}`.trim()}
          data-toast-variant={toast.variant}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
