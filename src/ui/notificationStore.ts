import { useEffect, useState } from 'preact/hooks';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface AppToast {
  id: string;
  message: string;
  variant: ToastVariant;
  isClosing: boolean;
}

const MAX_TOASTS = 4;
const TOAST_DURATION_MS = 4_500;
const TOAST_EXIT_MS = 180;
let sequence = 0;
let toasts: AppToast[] = [];
const toastListeners = new Set<(items: AppToast[]) => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function publishToasts(): void {
  toastListeners.forEach((listener) => listener(toasts));
}

function removeToast(id: string): void {
  const timer = timers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(id);
  toasts = toasts.filter((toast) => toast.id !== id);
  publishToasts();
}

export function dismissToast(id: string): void {
  const toast = toasts.find((item) => item.id === id);
  if (!toast || toast.isClosing) return;
  toasts = toasts.map((item) => item.id === id ? { ...item, isClosing: true } : item);
  publishToasts();
  const timer = setTimeout(() => removeToast(id), TOAST_EXIT_MS);
  timers.set(id, timer);
}

export function addToast(message: string, variant: ToastVariant = 'info'): void {
  const normalized = String(message ?? '').trim();
  if (!normalized) return;
  const id = `app-toast-${++sequence}`;
  toasts = [...toasts, {
    id,
    message: normalized.slice(0, 180),
    variant,
    isClosing: false
  }].slice(-MAX_TOASTS);
  publishToasts();
  const timer = setTimeout(() => dismissToast(id), TOAST_DURATION_MS);
  timers.set(id, timer);
}

/** Subscribe to transient app notifications and immediately deliver the current snapshot. */
export function subscribeToasts(listener: (items: AppToast[]) => void): () => void {
  toastListeners.add(listener);
  listener(toasts);
  return () => toastListeners.delete(listener);
}

export function useToasts(): AppToast[] {
  const [items, setItems] = useState(toasts);
  useEffect(() => subscribeToasts(setItems), []);
  return items;
}
