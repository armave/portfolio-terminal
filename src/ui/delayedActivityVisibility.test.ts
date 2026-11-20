import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVITY_INDICATOR_MIN_VISIBLE_MS,
  ACTIVITY_INDICATOR_SHOW_DELAY_MS,
  createDelayedActivityVisibilityController
} from './delayedActivityVisibility';

describe('delayed activity visibility', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps fast background tasks from flashing the indicator', () => {
    const controller = createDelayedActivityVisibilityController();
    const changes: boolean[] = [];
    controller.subscribe((visible) => changes.push(visible));

    controller.setActive(true);
    vi.advanceTimersByTime(ACTIVITY_INDICATOR_SHOW_DELAY_MS - 1);
    expect(controller.isVisible()).toBe(false);

    controller.setActive(false);
    vi.advanceTimersByTime(ACTIVITY_INDICATOR_SHOW_DELAY_MS * 2);
    expect(controller.isVisible()).toBe(false);
    expect(changes).not.toContain(true);
    controller.dispose();
  });

  it('shows slow tasks after the delay and holds the indicator for its minimum duration', () => {
    const controller = createDelayedActivityVisibilityController();
    controller.setActive(true);
    vi.advanceTimersByTime(ACTIVITY_INDICATOR_SHOW_DELAY_MS);
    expect(controller.isVisible()).toBe(true);

    vi.advanceTimersByTime(200);
    controller.setActive(false);
    vi.advanceTimersByTime(ACTIVITY_INDICATOR_MIN_VISIBLE_MS - 201);
    expect(controller.isVisible()).toBe(true);

    vi.advanceTimersByTime(1);
    expect(controller.isVisible()).toBe(false);
    controller.dispose();
  });

  it('cancels a pending hide when work resumes while the indicator is visible', () => {
    const controller = createDelayedActivityVisibilityController();
    controller.setActive(true);
    vi.advanceTimersByTime(ACTIVITY_INDICATOR_SHOW_DELAY_MS);
    expect(controller.isVisible()).toBe(true);

    controller.setActive(false);
    vi.advanceTimersByTime(250);
    controller.setActive(true);
    vi.advanceTimersByTime(ACTIVITY_INDICATOR_MIN_VISIBLE_MS * 2);
    expect(controller.isVisible()).toBe(true);

    controller.setActive(false);
    vi.advanceTimersByTime(ACTIVITY_INDICATOR_MIN_VISIBLE_MS);
    expect(controller.isVisible()).toBe(false);
    controller.dispose();
  });

  it('cleans up timers on disposal and tolerates repeated state changes', () => {
    const controller = createDelayedActivityVisibilityController();
    controller.setActive(true);
    controller.setActive(true);
    controller.dispose();
    vi.advanceTimersByTime(ACTIVITY_INDICATOR_SHOW_DELAY_MS * 2);
    expect(controller.isVisible()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
