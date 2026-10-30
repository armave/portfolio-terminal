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

  it('delivers typed requests for Preact-owned command and backup controls', () => {
    const commandListener = vi.fn();
    const backupListener = vi.fn();
    addUiEventListener('terminal:command-prefill', commandListener);
    addUiEventListener('terminal:backup-import-request', backupListener);

    emitUiEvent('terminal:command-prefill', { command: 'bought [shares] [TICKER]', selectText: '[shares]' });
    emitUiEvent('terminal:backup-import-request');

    expect(commandListener).toHaveBeenCalledTimes(1);
    expect(commandListener.mock.calls[0][0].detail).toEqual({ command: 'bought [shares] [TICKER]', selectText: '[shares]' });
    emitUiEvent('terminal:command-prefill', { command: 'help', cursorAtEnd: true });
    expect(commandListener.mock.calls[1][0].detail).toEqual({ command: 'help', cursorAtEnd: true });
    expect(backupListener).toHaveBeenCalledTimes(1);
    expect(backupListener.mock.calls[0][0].detail).toBeUndefined();

    removeUiEventListener('terminal:command-prefill', commandListener);
    removeUiEventListener('terminal:backup-import-request', backupListener);
  });

  it('delivers Preact-owned workspace scroll requests without DOM lookup payloads', () => {
    const listener = vi.fn();
    addUiEventListener('terminal:scroll-workspace', listener);

    emitUiEvent('terminal:scroll-workspace');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toBeUndefined();
    removeUiEventListener('terminal:scroll-workspace', listener);
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


describe('portfolio UI action requests', () => {
  it('delivers navigation and execution requests with their typed payloads', () => {
    const navigation = vi.fn();
    const execution = vi.fn();
    addUiEventListener('portfolio:set-active-view', navigation);
    addUiEventListener('terminal:execute-command', execution);

    emitUiEvent('portfolio:set-active-view', { view: 'AAPL' });
    emitUiEvent('terminal:execute-command', { command: 'quote AAPL' });

    expect(navigation.mock.calls[0][0].detail).toEqual({ view: 'AAPL' });
    expect(execution.mock.calls[0][0].detail).toEqual({ command: 'quote AAPL' });
    removeUiEventListener('portfolio:set-active-view', navigation);
    removeUiEventListener('terminal:execute-command', execution);
  });

  it('allows the quote refresh owner to complete a Preact request', () => {
    const listener = vi.fn((event) => event.detail.resolve());
    const resolve = vi.fn();
    addUiEventListener('portfolio:refresh-live-prices', listener);

    emitUiEvent('portfolio:refresh-live-prices', { resolve });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledTimes(1);
    removeUiEventListener('portfolio:refresh-live-prices', listener);
  });
});


describe('UI event listener identity', () => {
  it('removes the same callback from only the requested event channel', () => {
    const listener = vi.fn();
    addUiEventListener('terminal:auth-visibility', listener);
    addUiEventListener('terminal:command-prefill', listener);

    removeUiEventListener('terminal:auth-visibility', listener);
    emitUiEvent('terminal:auth-visibility', { isOpen: true });
    emitUiEvent('terminal:command-prefill', { command: 'help' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      type: 'terminal:command-prefill',
      detail: { command: 'help' }
    });

    removeUiEventListener('terminal:command-prefill', listener);
  });
});
