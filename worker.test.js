import { describe, expect, it } from 'vitest';
import { normalizeMarketState } from './worker.js';

describe('normalizeMarketState', () => {
  it.each([
    ['PREPRE', 'PRE'],
    ['PRE', 'PRE'],
    ['REGULAR', 'REGULAR'],
    ['POSTPOST', 'POST'],
    ['POST', 'POST'],
    ['CLOSED', 'CLOSED'],
    [undefined, 'CLOSED'],
    [null, 'CLOSED']
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeMarketState(input)).toBe(expected);
  });
});
