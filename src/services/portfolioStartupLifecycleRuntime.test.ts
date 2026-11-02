import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitUiEvent } from '../ui/uiEventBus';
import {
  createPortfolioStartupLifecycleRuntime,
  type PortfolioStartupLifecycleDependencies,
  type StartupIntervalHandle,
  type StartupAccountRole
} from './portfolioStartupLifecycleRuntime';

function createFixture(initialRole: StartupAccountRole = 'admin') {
  let role = initialRole;
  let visible = true;
  let visibilityListener: (() => void) | null = null;
  let intervalCallback: (() => void) | null = null;
  const intervalHandle = {} as StartupIntervalHandle;
  const calls: string[] = [];

  const dependencies: PortfolioStartupLifecycleDependencies = {
    getAccountRole: () => role,
    isDocumentVisible: () => visible,
    applyOvernightRollover: vi.fn(() => calls.push('rollover')),
    refreshOnVisibilityChange: vi.fn(() => calls.push('visibility-refresh')),
    setStartupState: vi.fn((shown, failed) => calls.push(`startup-state:${shown}:${failed}`)),
    retryStartup: vi.fn(async () => { calls.push('retry'); }),
    continueStartupOffline: vi.fn(async () => { calls.push('offline'); }),
    addVisibilityChangeListener: vi.fn((listener) => {
      visibilityListener = listener;
      return () => {
        visibilityListener = null;
        calls.push('remove-visibility');
      };
    }),
    scheduleInterval: vi.fn((callback, delayMs) => {
      intervalCallback = callback;
      calls.push(`schedule:${delayMs}`);
      return intervalHandle;
    }),
    clearScheduledInterval: vi.fn(() => {
      intervalCallback = null;
      calls.push('clear-interval');
    })
  };

  return {
    dependencies,
    calls,
    setRole: (nextRole: StartupAccountRole) => { role = nextRole; },
    setVisible: (nextVisible: boolean) => { visible = nextVisible; },
    fireVisibility: () => visibilityListener?.(),
    fireInterval: () => intervalCallback?.(),
    getIntervalCallback: () => intervalCallback
  };
}

describe('portfolio startup lifecycle runtime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs the admin rollover only while the active tab is visible', () => {
    const fixture = createFixture('admin');
    const runtime = createPortfolioStartupLifecycleRuntime(fixture.dependencies);

    runtime.configureAdminRollover(true);

    expect(fixture.dependencies.scheduleInterval).toHaveBeenCalledWith(expect.any(Function), 60 * 1000);

    fixture.fireInterval();
    expect(fixture.dependencies.applyOvernightRollover).toHaveBeenCalledTimes(1);

    fixture.setVisible(false);
    fixture.fireInterval();
    expect(fixture.dependencies.applyOvernightRollover).toHaveBeenCalledTimes(1);
  });

  it('cancels an existing rollover timer when the next session is not an administrator', () => {
    const fixture = createFixture('admin');
    const runtime = createPortfolioStartupLifecycleRuntime(fixture.dependencies);

    runtime.configureAdminRollover(true);
    runtime.configureAdminRollover(false);

    expect(fixture.dependencies.clearScheduledInterval).toHaveBeenCalledWith(expect.anything());
    expect(fixture.getIntervalCallback()).toBeNull();
  });

  it('rechecks account role before a queued rollover callback executes', () => {
    const fixture = createFixture('admin');
    const runtime = createPortfolioStartupLifecycleRuntime(fixture.dependencies);

    runtime.configureAdminRollover(true);
    fixture.setRole('guest');
    fixture.fireInterval();

    expect(fixture.dependencies.applyOvernightRollover).not.toHaveBeenCalled();
  });

  it('refreshes on visibility return and only applies rollover for administrators', () => {
    const fixture = createFixture('admin');
    const runtime = createPortfolioStartupLifecycleRuntime(fixture.dependencies);
    const unbind = runtime.bind();

    fixture.setVisible(false);
    fixture.fireVisibility();
    expect(fixture.dependencies.applyOvernightRollover).not.toHaveBeenCalled();
    expect(fixture.dependencies.refreshOnVisibilityChange).not.toHaveBeenCalled();

    fixture.setVisible(true);
    fixture.fireVisibility();
    expect(fixture.calls.slice(-2)).toEqual(['rollover', 'visibility-refresh']);

    fixture.setRole('guest');
    fixture.fireVisibility();
    expect(fixture.dependencies.applyOvernightRollover).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.refreshOnVisibilityChange).toHaveBeenCalledTimes(2);

    unbind();
  });

  it('routes startup retry and offline events to injected app actions', async () => {
    const fixture = createFixture();
    const runtime = createPortfolioStartupLifecycleRuntime(fixture.dependencies);
    const unbind = runtime.bind();

    emitUiEvent('terminal:startup-retry');
    emitUiEvent('terminal:startup-offline');

    await vi.waitFor(() => {
      expect(fixture.dependencies.retryStartup).toHaveBeenCalledTimes(1);
      expect(fixture.dependencies.continueStartupOffline).toHaveBeenCalledTimes(1);
    });
    expect(fixture.dependencies.setStartupState).toHaveBeenCalledWith(true, false);
    unbind();
  });

  it('removes visibility and UI listeners and clears rollover timer when disposed', () => {
    const fixture = createFixture();
    const runtime = createPortfolioStartupLifecycleRuntime(fixture.dependencies);
    const unbind = runtime.bind();

    runtime.configureAdminRollover(true);
    unbind();

    expect(fixture.dependencies.addVisibilityChangeListener).toHaveBeenCalledTimes(1);
    expect(fixture.calls).toContain('remove-visibility');
    expect(fixture.dependencies.clearScheduledInterval).toHaveBeenCalledWith(expect.anything());

    emitUiEvent('terminal:startup-retry');
    emitUiEvent('terminal:startup-offline');

    expect(fixture.dependencies.retryStartup).not.toHaveBeenCalled();
    expect(fixture.dependencies.continueStartupOffline).not.toHaveBeenCalled();
  });
});
