import { afterEach, describe, expect, it, vi } from 'vitest';
import { addUiEventListener, emitUiEvent, removeUiEventListener } from './uiEventBus';

describe('typed UI event bus', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delivers typed transient requests to active subscribers', () => {
    const listener = vi.fn();
    addUiEventListener('terminal:margin-intelligence-request', listener);

    emitUiEvent('terminal:margin-intelligence-request', { ticker: 'AAPL', refresh: true });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toEqual({ ticker: 'AAPL', refresh: true });
    removeUiEventListener('terminal:margin-intelligence-request', listener);
  });

  it('stops delivering events after a subscriber is removed', () => {
    const listener = vi.fn();
    addUiEventListener('terminal:auth-visibility', listener);
    removeUiEventListener('terminal:auth-visibility', listener);

    emitUiEvent('terminal:auth-visibility', { isOpen: true });

    expect(listener).not.toHaveBeenCalled();
  });

  it('supports events without payloads', () => {
    const listener = vi.fn();
    addUiEventListener('terminal:startup-retry', listener);

    emitUiEvent('terminal:startup-retry');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toBeUndefined();
    removeUiEventListener('terminal:startup-retry', listener);
  });
});
