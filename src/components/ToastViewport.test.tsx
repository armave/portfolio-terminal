import { describe, expect, it } from 'vitest';
import { ToastViewport } from './ToastViewport';

describe('ToastViewport', () => {
  it('renders typed notifications with the correct live announcement semantics', () => {
    const viewport = ToastViewport({
      toasts: [
        { id: 'notice-1', message: 'Saved successfully.', variant: 'success', isClosing: false },
        { id: 'notice-2', message: 'Sync failed.', variant: 'error', isClosing: true }
      ]
    });
    const items = viewport.props.children as Array<{ props: Record<string, unknown> }>;

    expect(viewport.props.id).toBe('toastContainer');
    expect(viewport.props['aria-live']).toBe('polite');
    expect(viewport.props['aria-relevant']).toBe('additions text');
    expect(items[0].props.role).toBe('status');
    expect(items[0].props['data-toast-variant']).toBe('success');
    expect(String(items[0].props.class)).toContain('border-emerald-800');
    expect(items[1].props.role).toBe('alert');
    expect(items[1].props['data-toast-variant']).toBe('error');
    expect(String(items[1].props.class)).toContain('opacity-0 translate-x-2');
  });

  it('keeps an empty viewport available without rendering placeholder notifications', () => {
    const viewport = ToastViewport({ toasts: [] });
    expect(viewport.props.id).toBe('toastContainer');
    expect(viewport.props.children).toEqual([]);
  });
});
