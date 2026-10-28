import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendTerminalLog,
  clearTerminalLogEntries,
  dismissScenarioReport,
  setScenarioReport,
  subscribeScenarioReport,
  subscribeTerminalLog
} from './notificationStore';

describe('notification UI store', () => {
  afterEach(() => {
    clearTerminalLogEntries();
    dismissScenarioReport();
    vi.restoreAllMocks();
  });

  it('publishes terminal entries without touching a DOM node', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTerminalLog(listener);
    clearTerminalLogEntries();

    appendTerminalLog('[CLI]: Ready', false, false);

    expect(listener).toHaveBeenLastCalledWith([
      expect.objectContaining({ message: '[CLI]: Ready', isUser: false, isError: false })
    ]);
    expect(listener.mock.calls.at(-1)?.[0][0].time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    unsubscribe();
  });

  it('publishes and dismisses scenario-report state', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeScenarioReport(listener);

    setScenarioReport('[SIM EXIT]\nDetails');
    expect(listener).toHaveBeenLastCalledWith('[SIM EXIT]\nDetails');

    dismissScenarioReport();
    expect(listener).toHaveBeenLastCalledWith(null);
    unsubscribe();
  });
});
