import { describe, expect, it } from 'vitest';
import { createLatestRequestGuard } from './requestGeneration';

describe('createLatestRequestGuard', () => {
  it('only accepts the newest request when responses finish out of order', () => {
    const guard = createLatestRequestGuard();
    const firstRequest = guard.begin();
    const secondRequest = guard.begin();

    expect(guard.isCurrent(firstRequest)).toBe(false);
    expect(guard.isCurrent(secondRequest)).toBe(true);
  });

  it('lets a newly received request supersede older work before validation', () => {
    const guard = createLatestRequestGuard();
    const pendingValidRequest = guard.begin();

    // A later request can be rejected by its caller before any async work starts.
    const rejectedRequest = guard.begin();

    expect(guard.isCurrent(pendingValidRequest)).toBe(false);
    expect(guard.isCurrent(rejectedRequest)).toBe(true);
  });

  it('invalidates pending work when its owning effect is cleaned up', () => {
    const guard = createLatestRequestGuard();
    const pendingRequest = guard.begin();

    guard.invalidate();

    expect(guard.isCurrent(pendingRequest)).toBe(false);
  });
});
