import { addToast, type ToastVariant } from './notificationStore';

/** Keep diagnostic messages in the browser console without maintaining a command log UI. */
export function logAppMessage(message: string): void {
  const normalized = String(message ?? '').trim();
  if (normalized) console.info('[Portfolio]', normalized);
}

/** Publish an actionable, transient notification to the application shell. */
export function showToast(message: string, variant: ToastVariant = 'info'): void {
  addToast(message, variant);
}
