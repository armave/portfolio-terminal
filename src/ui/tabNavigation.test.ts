import { describe, expect, it } from 'vitest';
import { resolveTabNavigationIndex } from './tabNavigation';

describe('resolveTabNavigationIndex', () => {
  it('wraps left and right navigation across the tab list', () => {
    expect(resolveTabNavigationIndex(0, 3, 'ArrowLeft')).toBe(2);
    expect(resolveTabNavigationIndex(2, 3, 'ArrowRight')).toBe(0);
    expect(resolveTabNavigationIndex(1, 3, 'ArrowLeft')).toBe(0);
    expect(resolveTabNavigationIndex(1, 3, 'ArrowRight')).toBe(2);
  });

  it('moves to the first or last tab with Home and End', () => {
    expect(resolveTabNavigationIndex(2, 3, 'Home')).toBe(0);
    expect(resolveTabNavigationIndex(0, 3, 'End')).toBe(2);
  });

  it('ignores unsupported keys and invalid tab indexes', () => {
    expect(resolveTabNavigationIndex(0, 3, 'ArrowDown')).toBeNull();
    expect(resolveTabNavigationIndex(-1, 3, 'ArrowRight')).toBeNull();
    expect(resolveTabNavigationIndex(3, 3, 'ArrowLeft')).toBeNull();
    expect(resolveTabNavigationIndex(0, 1, 'ArrowRight')).toBeNull();
  });
});
